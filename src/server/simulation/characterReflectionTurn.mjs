import { projectCharacterLifeContinuityForOwner } from "./characterLifeContinuity.mjs";
import { runCharacterMaintenanceStage } from "./characterMaintenanceStageProtocol.mjs";
import { settleCharacterReflectionOpportunity } from "./characterReflection.mjs";

export const CHARACTER_REFLECTION_TURN_VERSION = "character-reflection-turn-v1";

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function unique(values = []) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function nonNegativeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : Math.max(0, Number(fallback || 0));
}

function fail(code, message, evidence = {}) {
  const error = new Error(message);
  error.code = code;
  error.evidence = clone(evidence);
  return error;
}

function assertClaimedOwner(ownerCharacterId, claimedOwnerCharacterId, field) {
  const claimed = clean(claimedOwnerCharacterId);
  if (claimed && claimed !== ownerCharacterId) {
    throw fail(
      "CHARACTER_REFLECTION_TURN_OWNER_MISMATCH",
      "A private reflection turn cannot read another Character's state.",
      { field, ownerCharacterId, claimedOwnerCharacterId: claimed },
    );
  }
}

function assertOwnedTurnInputs(ownerCharacterId, privateState, opportunity) {
  if (!ownerCharacterId) {
    throw fail(
      "CHARACTER_REFLECTION_TURN_OWNER_REQUIRED",
      "A private reflection turn requires its owning Character id.",
    );
  }
  assertClaimedOwner(ownerCharacterId, privateState?.ownerCharacterId, "privateState.ownerCharacterId");
  assertClaimedOwner(ownerCharacterId, privateState?.memoryContext?.ownerCharacterId, "privateState.memoryContext.ownerCharacterId");
  assertClaimedOwner(ownerCharacterId, privateState?.reflectionState?.ownerCharacterId, "privateState.reflectionState.ownerCharacterId");
  assertClaimedOwner(ownerCharacterId, opportunity?.ownerCharacterId, "pendingOpportunity.ownerCharacterId");

  for (const [collection, rows] of [
    ["episodes", privateState?.memoryContext?.episodes || []],
    ["beliefs", privateState?.memoryContext?.beliefs || []],
  ]) {
    rows.forEach((row, index) => {
      assertClaimedOwner(
        ownerCharacterId,
        row?.ownerCharacterId,
        `privateState.memoryContext.${collection}[${index}].ownerCharacterId`,
      );
    });
  }
  for (const [index, row] of (opportunity?.sourceMemorySnapshots || []).entries()) {
    assertClaimedOwner(
      ownerCharacterId,
      row?.ownerCharacterId,
      `pendingOpportunity.sourceMemorySnapshots[${index}].ownerCharacterId`,
    );
  }
  for (const [collection, rows] of [
    ["currentClaims", privateState?.memoryContext?.selfNarrative?.currentClaims || []],
    ["pendingCandidates", privateState?.memoryContext?.selfNarrative?.pendingCandidates || []],
    ["versions", privateState?.memoryContext?.selfNarrative?.versions || []],
  ]) {
    rows.forEach((row, index) => {
      assertClaimedOwner(
        ownerCharacterId,
        row?.ownerCharacterId,
        `privateState.memoryContext.selfNarrative.${collection}[${index}].ownerCharacterId`,
      );
    });
  }

  const opportunityId = clean(opportunity?.opportunityId);
  const ledgerOpportunity = privateState?.reflectionState?.pendingOpportunity;
  const ledgerOpportunityId = clean(ledgerOpportunity?.opportunityId);
  assertClaimedOwner(
    ownerCharacterId,
    ledgerOpportunity?.ownerCharacterId,
    "privateState.reflectionState.pendingOpportunity.ownerCharacterId",
  );
  const requestedSourceMemoryIds = unique(opportunity?.sourceMemoryIds);
  const ledgerSourceMemoryIds = unique(ledgerOpportunity?.sourceMemoryIds);
  const sourcesMatch = requestedSourceMemoryIds.length === ledgerSourceMemoryIds.length
    && requestedSourceMemoryIds.every((memoryId) => ledgerSourceMemoryIds.includes(memoryId));
  if (
    !opportunityId
    || clean(opportunity?.status || "due") !== "due"
    || clean(ledgerOpportunity?.status || "due") !== "due"
    || opportunityId !== ledgerOpportunityId
    || !sourcesMatch
  ) {
    throw fail(
      "CHARACTER_REFLECTION_TURN_OPPORTUNITY_NOT_DUE",
      "The requested private reflection opportunity is not the Character's current due opportunity.",
      {
        opportunityId,
        ledgerOpportunityId,
        requestedSourceMemoryIds,
        ledgerSourceMemoryIds,
      },
    );
  }
  return clone(ledgerOpportunity);
}

function projectOpportunityMemorySlice(memoryContext = {}, opportunity = {}, ownerCharacterId = "") {
  const sourceMemoryIds = unique(opportunity.sourceMemoryIds);
  const liveEpisodes = new Map((memoryContext.episodes || [])
    .map((row) => [clean(row?.id), row])
    .filter(([memoryId]) => sourceMemoryIds.includes(memoryId)));
  const liveBeliefs = new Map((memoryContext.beliefs || [])
    .map((row) => [clean(row?.id), row])
    .filter(([memoryId]) => sourceMemoryIds.includes(memoryId)));
  const frozen = new Map((opportunity.sourceMemorySnapshots || []).flatMap((row) => {
    const memoryId = clean(row?.id);
    if (!memoryId || !sourceMemoryIds.includes(memoryId)) return [];
    assertClaimedOwner(
      ownerCharacterId,
      row?.ownerCharacterId,
      `pendingOpportunity.sourceMemorySnapshots.${memoryId}.ownerCharacterId`,
    );
    return [[memoryId, row]];
  }));
  const episodes = [];
  const beliefs = [];
  const availableSourceMemoryIds = [];
  for (const memoryId of sourceMemoryIds) {
    const liveEpisode = liveEpisodes.get(memoryId);
    const liveBelief = liveBeliefs.get(memoryId);
    const snapshot = frozen.get(memoryId);
    const row = liveEpisode || liveBelief || snapshot;
    if (!row) continue;
    availableSourceMemoryIds.push(memoryId);
    if (liveBelief || (!liveEpisode && !row.perceivedAt && !row.objectiveEventId && row.proposition)) {
      beliefs.push(row);
    } else episodes.push(row);
  }
  return {
    projection: {
      schemaVersion: CHARACTER_REFLECTION_TURN_VERSION,
      authority: "character-private-reflection-memory-slice",
      ownerCharacterId,
      sourceMemoryIds: availableSourceMemoryIds,
      episodes: clone(episodes),
      beliefs: clone(beliefs),
      selection: null,
    },
    unavailableSourceMemoryIds: sourceMemoryIds.filter((memoryId) => !availableSourceMemoryIds.includes(memoryId)),
  };
}

function projectSelfNarrative(memoryContext = {}, ownerCharacterId = "") {
  const source = memoryContext.selfNarrative || {};
  return {
    authority: "character-private-self-narrative-projection",
    ownerCharacterId,
    currentClaims: clone((source.currentClaims || []).slice(-24)),
    pendingCandidates: clone((source.pendingCandidates || []).slice(-16)),
    versions: clone((source.versions || []).slice(-16)),
  };
}

function ownerPlanProjection(privateState = {}, ownerCharacterId = "", nowSeconds = 0) {
  const psychology = privateState.ecologyState?.characterPsychologyV2State || {};
  const continuationIntentions = (psychology.continuationIntentions || []).filter((row) => {
    const claimedOwner = clean(row?.ownerCharacterId);
    return !claimedOwner || claimedOwner === ownerCharacterId;
  });
  return projectCharacterLifeContinuityForOwner({
    ownerCharacterId,
    ecologyState: {
      characterPsychologyV2State: {
        continuationIntentions: clone(continuationIntentions),
      },
    },
  }, { nowSeconds });
}

function projectReflectionOpportunity(opportunity = {}, ownerCharacterId = "") {
  return {
    schemaVersion: clean(opportunity.schemaVersion),
    authority: "character-private-reflection-opportunity",
    ownerCharacterId,
    opportunityId: clean(opportunity.opportunityId),
    sequence: Math.max(1, Math.floor(Number(opportunity.sequence || 1))),
    status: "due",
    dueAtSeconds: nonNegativeNumber(opportunity.dueAtSeconds),
    accumulatedImportance: nonNegativeNumber(opportunity.accumulatedImportance),
    ...(opportunity.executionReviewReason ? { executionReviewReason: clean(opportunity.executionReviewReason) } : {}),
    sourceMemoryIds: unique(opportunity.sourceMemoryIds),
    decisionAuthority: "character-agent",
    selection: null,
  };
}

function reflectionStageInput({ ownerCharacterId, agentTurnId, privateState, opportunity, nowSeconds }) {
  const projectedMemory = projectOpportunityMemorySlice(
    privateState.memoryContext || {},
    opportunity,
    ownerCharacterId,
  );
  const memorySlice = projectedMemory.projection;
  return {
    schemaVersion: CHARACTER_REFLECTION_TURN_VERSION,
    authority: "character-private-reflection-stage-input",
    phase: "awaiting_character_reflection",
    stage: "character_reflection",
    characterId: ownerCharacterId,
    agentTurnId: clean(agentTurnId),
    ownerCharacterId,
    nowSeconds,
    opportunity: projectReflectionOpportunity({
      ...opportunity,
      sourceMemoryIds: memorySlice.sourceMemoryIds,
    }, ownerCharacterId),
    privateContext: {
      authority: "character-private-reflection-context-projection",
      ownerCharacterId,
      memorySlice,
      selfNarrative: projectSelfNarrative(privateState.memoryContext || {}, ownerCharacterId),
      activePlanProjection: ownerPlanProjection(privateState, ownerCharacterId, nowSeconds),
      selection: null,
    },
    submissionContract: {
      ownerAuthority: "character-agent",
      maxInsights: 5,
      requiredInsightFields: ["proposition", "sourceMemoryIds"],
      allowedSourceMemoryIds: clone(memorySlice.sourceMemoryIds),
      sourceReadingRule: "An episode's perception.content and semanticFrame.actionResult describe what this Character perceived; its interpretations and private beliefs are this Character's conclusions. A source id alone does not support an unrelated claim. Do not treat an intention, a failed operation, or another Character's uncommitted draft as an observed success or spoken line. Reflections remain private beliefs, never world facts.",
      forbiddenOutputAuthority: ["world", "action", "speech"],
    },
    sourceMemoryDegraded: projectedMemory.unavailableSourceMemoryIds.length > 0,
  };
}

/**
 * Run one due Character-owned reflection opportunity through an injected model
 * stage. The model receives only a source-bounded private projection; the
 * existing reflection settlement remains the sole write authority.
 */
export async function runCharacterReflectionTurn({
  ownerCharacterId = "",
  agentTurnId = "",
  privateState = {},
  pendingOpportunity = null,
  nowSeconds = 0,
  runStage,
  signal,
  maxStageProtocolRepairs = 0,
  onStageAccepted,
  onStageRejected,
  executionOptions,
} = {}) {
  const owner = clean(ownerCharacterId);
  const now = nonNegativeNumber(nowSeconds);
  const dueOpportunity = assertOwnedTurnInputs(owner, privateState, pendingOpportunity);
  if (typeof runStage !== "function") {
    throw fail(
      "CHARACTER_REFLECTION_TURN_STAGE_REQUIRED",
      "A private reflection turn requires an injected runStage function.",
    );
  }

  const stageInput = reflectionStageInput({
    ownerCharacterId: owner,
    agentTurnId,
    privateState,
    opportunity: dueOpportunity,
    nowSeconds: now,
  });
  if (!stageInput.privateContext.memorySlice.sourceMemoryIds.length) {
    const settled = settleCharacterReflectionOpportunity({
      ownerCharacterId: owner,
      memoryState: clone(privateState.memoryContext || {}),
      reflectionState: clone(privateState.reflectionState || {}),
      opportunityId: clean(dueOpportunity?.opportunityId),
      submission: { ownerAuthority: "character-agent", insights: [] },
      nowSeconds: now,
    });
    return {
      schemaVersion: CHARACTER_REFLECTION_TURN_VERSION,
      authority: "character-private-reflection-turn",
      ownerCharacterId: owner,
      opportunityId: clean(dueOpportunity?.opportunityId),
      privateStatePatch: {
        memoryContext: clone(settled.memoryState),
        reflectionState: clone(settled.reflectionState),
      },
      actionAttempt: null,
      worldChanged: false,
      stages: [],
      protocolRepairCount: 0,
      sourceMemoryDegraded: true,
      degradationReason: "source-memory-aged-out",
    };
  }
  const execution = await runCharacterMaintenanceStage({
    stageInput,
    stage: "character_reflection",
    runStage,
    signal,
    maxStageProtocolRepairs,
    onStageAccepted,
    onStageRejected,
    executionOptions,
    settle(stageResult) {
      const submission = stageResult?.reflection || stageResult?.submission || stageResult;
      return settleCharacterReflectionOpportunity({
        ownerCharacterId: owner,
        memoryState: clone(privateState.memoryContext || {}),
        reflectionState: clone(privateState.reflectionState || {}),
        opportunityId: clean(dueOpportunity?.opportunityId),
        submission: clone(submission || {}),
        nowSeconds: now,
      });
    },
  });
  const settled = execution.settled;

  return {
    schemaVersion: CHARACTER_REFLECTION_TURN_VERSION,
    authority: "character-private-reflection-turn",
    ownerCharacterId: owner,
    opportunityId: clean(dueOpportunity?.opportunityId),
    privateStatePatch: {
      memoryContext: clone(settled.memoryState),
      reflectionState: clone(settled.reflectionState),
    },
    actionAttempt: null,
    worldChanged: false,
    stages: clone(execution.stages),
    protocolRepairCount: execution.protocolRepairCount,
    sourceMemoryDegraded: stageInput.sourceMemoryDegraded,
  };
}
