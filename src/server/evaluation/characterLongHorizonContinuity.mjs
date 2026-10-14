export const CHARACTER_LONG_HORIZON_CONTINUITY_VERSION = "character-long-horizon-continuity-v1";

const PRIVATE_PUBLIC_KEYS = new Set([
  "activePlanProjection",
  "lifePlanState",
  "privatePurpose",
  "reflectionState",
  "pendingOpportunity",
  "completedOpportunities",
  "insights",
]);

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").trim();
}

function unique(values = []) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function speechRecord(turn = {}, turnIndex = 0) {
  if (!turn?.actionAttempt) return null;
  const outcome = turn.outcome || {};
  const delivery = (outcome.deliveries || []).find((row) => (
    clean(row?.eventKind) === "speech"
    && clean(row?.sourceCharacterId || outcome.actorId) === clean(turn.characterId)
  ));
  const surface = (outcome.attemptSurface || []).find((row) => clean(row?.kind) === "utterance_emitted");
  const utterance = clean(delivery?.content || surface?.utterance || turn.actionAttempt?.payload?.utterance);
  if (!utterance) return null;
  const provenance = clone(
    delivery?.provenance
    || surface?.provenance
    || turn.actionAttempt?.payload?.provenance
    || {},
  );
  return {
    turnIndex,
    agentTurnId: clean(turn.agentTurnId),
    actorId: clean(turn.characterId),
    attemptId: clean(turn.actionAttempt?.attemptId),
    targetCharacterId: clean(
      delivery?.recipientCharacterId
      || surface?.targetCharacterId
      || turn.actionAttempt?.payload?.speechTargetCharacterId
      || turn.actionAttempt?.targetCharacterId,
    ),
    utterance,
    speechAct: clean(delivery?.speechAct || surface?.speechAct || turn.actionAttempt?.payload?.speechAct || "none"),
    sourceActionId: clean(provenance?.sourceActionId),
    sourceThreadId: clean(provenance?.sourceThreadId),
    responseToTurnId: clean(provenance?.responseToTurnId),
  };
}

function actionSignature(turn = {}) {
  const attempt = turn.actionAttempt || {};
  const payload = attempt.payload || {};
  return [
    clean(attempt.primitive),
    clean(
      attempt.targetCharacterId
      || payload.targetId
      || payload.targetCharacterId
      || payload.objectId
      || payload.destinationId
      || payload.affordanceId,
    ),
    clean(payload.utterance),
  ].join("::");
}

function findPrivatePublicLeak(value, path = "publicWorld", seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findPrivatePublicLeak(value[index], `${path}[${index}]`, seen);
      if (found) return found;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value)) {
    if (PRIVATE_PUBLIC_KEYS.has(key)) return `${path}.${key}`;
    const found = findPrivatePublicLeak(child, `${path}.${key}`, seen);
    if (found) return found;
  }
  return null;
}

function memoryOwnerIssues(checkpoint = {}) {
  const issues = [];
  for (const actor of checkpoint?.actors || []) {
    const actorId = clean(actor?.characterId);
    const privateState = actor?.privateState || {};
    const stateOwner = clean(privateState.ownerCharacterId);
    const memory = privateState.memoryContext || {};
    if ((stateOwner && stateOwner !== actorId) || (clean(memory.ownerCharacterId) && clean(memory.ownerCharacterId) !== actorId)) {
      issues.push({
        code: "MEMORY_OWNER_MISMATCH",
        characterId: actorId,
        memoryId: "",
        claimedOwnerCharacterId: clean(memory.ownerCharacterId || stateOwner),
      });
    }
    for (const record of [...(memory.episodes || []), ...(memory.beliefs || [])]) {
      if (!clean(record?.ownerCharacterId) || clean(record.ownerCharacterId) === actorId) continue;
      issues.push({
        code: "MEMORY_OWNER_MISMATCH",
        characterId: actorId,
        memoryId: clean(record.id),
        claimedOwnerCharacterId: clean(record.ownerCharacterId),
      });
    }
  }
  return issues;
}

/**
 * Structural audit for a long autonomous Character-Agent run. It checks
 * causal and ownership invariants; it deliberately does not score prose.
 */
export function auditCharacterLongHorizonContinuity({
  requiredCharacterIds = [],
  turns = [],
  checkpoint = {},
  publicWorld = {},
  policy: policyInput = {},
} = {}) {
  const policy = {
    minTurnsPerCharacter: Math.max(0, Math.floor(Number(policyInput.minTurnsPerCharacter ?? 1))),
    requireAutonomousWake: policyInput.requireAutonomousWake === true,
    maxConsecutiveSameAction: Math.max(1, Math.floor(Number(policyInput.maxConsecutiveSameAction ?? 2))),
    startWorldSeconds: Math.max(0, Number(policyInput.startWorldSeconds || 0)),
    minimumCoveredWorldSeconds: Math.max(0, Number(policyInput.minimumCoveredWorldSeconds || 0)),
    requireQuiescentEnd: policyInput.requireQuiescentEnd === true,
    endedByTurnLimit: policyInput.endedByTurnLimit === true,
  };
  const issues = [];
  const required = unique(requiredCharacterIds);
  const turnCountByCharacter = Object.fromEntries(required.map((characterId) => [characterId, 0]));
  const consumedWakeAt = new Map();
  const speechByActionId = new Map();
  const speeches = [];
  const repeatedByCharacter = new Map();
  let previousWorldVersion = -1;
  let actionCount = 0;
  let silentTurnCount = 0;
  let speechActionCount = 0;
  let planWakeCount = 0;
  let reflectionWakeCount = 0;
  let externalWakeCount = 0;
  let autonomousWakeCount = 0;
  let maxObservedConsecutiveSameAction = 0;

  for (const [turnIndex, turn] of (turns || []).entries()) {
    const characterId = clean(turn?.characterId);
    if (Object.hasOwn(turnCountByCharacter, characterId)) turnCountByCharacter[characterId] += 1;
    const wakeId = clean(turn?.wake?.wakeId || turn?.wake?.id);
    const wakeType = clean(turn?.wake?.causeType || turn?.wake?.kind);
    if (wakeId) {
      if (consumedWakeAt.has(wakeId)) issues.push({
        code: "WAKE_CONSUMED_TWICE",
        wakeId,
        firstTurnIndex: consumedWakeAt.get(wakeId),
        repeatedTurnIndex: turnIndex,
      });
      else consumedWakeAt.set(wakeId, turnIndex);
    }
    if (wakeType === "plan_due") planWakeCount += 1;
    if (wakeType === "reflection_due") reflectionWakeCount += 1;
    if (["world_evidence", "new_external_impact"].includes(wakeType)) externalWakeCount += 1;
    if (["plan_due", "reflection_due", "opportunity_window", "internal_pressure"].includes(wakeType)) autonomousWakeCount += 1;

    const attempt = turn?.actionAttempt || null;
    if (!attempt) {
      silentTurnCount += 1;
      continue;
    }
    actionCount += 1;
    if (clean(attempt.actorId) !== characterId) issues.push({
      code: "ACTION_OWNER_MISMATCH",
      agentTurnId: clean(turn.agentTurnId),
      characterId,
      actionActorId: clean(attempt.actorId),
    });
    if (!turn.outcome) issues.push({
      code: "ACTION_OUTCOME_MISSING",
      agentTurnId: clean(turn.agentTurnId),
      actionAttemptId: clean(attempt.attemptId),
    });
    if (turn.outcome && clean(turn.outcome.actionAttemptId) !== clean(attempt.attemptId)) issues.push({
      code: "ACTION_OUTCOME_ATTEMPT_MISMATCH",
      agentTurnId: clean(turn.agentTurnId),
      actionAttemptId: clean(attempt.attemptId),
      outcomeActionAttemptId: clean(turn.outcome.actionAttemptId),
    });
    if (turn.outcome) {
      const worldVersion = Number(turn.outcome.worldVersion);
      if (!Number.isFinite(worldVersion) || worldVersion <= previousWorldVersion) issues.push({
        code: "WORLD_VERSION_NON_MONOTONIC",
        agentTurnId: clean(turn.agentTurnId),
        previousWorldVersion,
        worldVersion,
      });
      else previousWorldVersion = worldVersion;
    }

    const registeredWait = clean(attempt.primitive) === "wait"
      && (turn.outcome?.resolvedEffects || []).some(row => row.kind === "actor_wait_registered");
    const signature = registeredWait ? "" : actionSignature(turn);
    const previousRepeat = repeatedByCharacter.get(characterId) || { signature: "", count: 0 };
    const repetitionMotivated = turn?.privateResult?.decision?.repetitionMotivation?.intentional === true;
    const repeat = signature && signature === previousRepeat.signature
      ? { signature, count: previousRepeat.count + 1 }
      : { signature, count: signature ? 1 : 0 };
    repeatedByCharacter.set(characterId, repeat);
    maxObservedConsecutiveSameAction = Math.max(maxObservedConsecutiveSameAction, repeat.count);
    if (!repetitionMotivated && repeat.count === policy.maxConsecutiveSameAction + 1) issues.push({
      code: "UNMOTIVATED_ACTION_LOOP",
      characterId,
      signature,
      consecutiveCount: repeat.count,
    });

    const speech = speechRecord(turn, turnIndex);
    if (!speech) continue;
    speechActionCount += 1;
    speeches.push(speech);
    if (!speech.sourceActionId || !speech.sourceThreadId || speech.sourceActionId !== speech.attemptId) issues.push({
      code: "SPEECH_PROVENANCE_MISSING",
      agentTurnId: speech.agentTurnId,
      actionAttemptId: speech.attemptId,
      sourceActionId: speech.sourceActionId,
      sourceThreadId: speech.sourceThreadId,
    });
    if (speech.responseToTurnId) {
      const parent = speechByActionId.get(speech.responseToTurnId);
      if (!parent) issues.push({
        code: "SPEECH_PARENT_MISSING",
        actionAttemptId: speech.attemptId,
        responseToTurnId: speech.responseToTurnId,
      });
      else if (parent.sourceThreadId !== speech.sourceThreadId) issues.push({
        code: "SPEECH_PARENT_THREAD_MISMATCH",
        actionAttemptId: speech.attemptId,
        responseToTurnId: speech.responseToTurnId,
        parentThreadId: parent.sourceThreadId,
        responseThreadId: speech.sourceThreadId,
      });
    }
    if (speech.sourceActionId) speechByActionId.set(speech.sourceActionId, speech);
  }

  for (const characterId of required) {
    const count = Number(turnCountByCharacter[characterId] || 0);
    if (count < policy.minTurnsPerCharacter) issues.push({
      code: "CHARACTER_LONG_HORIZON_STARVATION",
      characterId,
      turnCount: count,
      requiredTurnCount: policy.minTurnsPerCharacter,
    });
  }
  if (policy.requireAutonomousWake && autonomousWakeCount === 0) issues.push({
    code: "AUTONOMOUS_WAKE_MISSING",
  });
  const endWorldSeconds = Math.max(0, Number(publicWorld?.nowSeconds || 0));
  const coveredWorldSeconds = Math.max(0, endWorldSeconds - policy.startWorldSeconds);
  if (coveredWorldSeconds < policy.minimumCoveredWorldSeconds) issues.push({
    code: "WORLD_HORIZON_UNDER_COVERED",
    coveredWorldSeconds,
    requiredWorldSeconds: policy.minimumCoveredWorldSeconds,
  });
  if (policy.requireQuiescentEnd && (publicWorld?.readyQueue || []).length) issues.push({
    code: "LONG_HORIZON_NOT_QUIESCENT",
    readyQueue: clone(publicWorld.readyQueue),
  });
  if (policy.endedByTurnLimit) issues.push({
    code: "LONG_HORIZON_TURN_LIMIT_EXHAUSTED",
  });
  const publicLeakPath = findPrivatePublicLeak(publicWorld);
  if (publicLeakPath) issues.push({
    code: "PRIVATE_CONTINUITY_PUBLIC_LEAK",
    path: publicLeakPath,
  });
  issues.push(...memoryOwnerIssues(checkpoint));

  const causalResponseCount = speeches.filter((speech) => (
    speech.responseToTurnId && speechByActionId.has(speech.responseToTurnId)
  )).length;
  return {
    schemaVersion: CHARACTER_LONG_HORIZON_CONTINUITY_VERSION,
    valid: issues.length === 0,
    issues,
    metrics: {
      turnCount: (turns || []).length,
      actionCount,
      silentTurnCount,
      speechActionCount,
      causalResponseCount,
      planWakeCount,
      reflectionWakeCount,
      externalWakeCount,
      autonomousWakeCount,
      maxObservedConsecutiveSameAction,
      turnCountByCharacter,
      lastWorldVersion: previousWorldVersion,
      coveredWorldSeconds,
      endWorldSeconds,
    },
  };
}
