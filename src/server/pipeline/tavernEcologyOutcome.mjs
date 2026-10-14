import { operationalSustenanceFactors } from "../simulation/cultivationSustenance.mjs";

export const TAVERN_ECOLOGY_OUTCOME_VERSION = 1;

export const DEFAULT_TAVERN_ECOLOGY_OUTCOME_POLICY = deepFreeze({
  recentActionLimit: 12,
  bodyPerHour: {
    hunger: 0.018,
    thirst: 0.024,
    fatigue: 0.006,
    painRecovery: 0.001,
    staminaDrain: 0.004,
  },
  desirePerHour: {
    cueDecay: 0.04,
  },
  deferFrustration: 0.08,
  passFrustration: 0.04,
});

const DEFER_KINDS = new Set(["defer", "delay", "postpone"]);
const PASS_KINDS = new Set(["pass", "decline_to_act", "do_nothing"]);
const EAT_KINDS = new Set(["eat", "have_meal", "consume_food", "serve_self_meal"]);
const DRINK_KINDS = new Set(["drink", "have_drink", "consume_drink", "drink_tea", "drink_water"]);
const REST_KINDS = new Set(["rest", "sleep", "recover", "sit_and_recover"]);
const EXERTION_KINDS = new Set([
  "work",
  "practice",
  "spar",
  "fight",
  "carry",
  "chop",
  "chop_wood",
  "fetch_water",
  "physical_labor",
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneValue(nested)]));
  }
  return value;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp01(value, fallback = 0) {
  return Math.min(1, Math.max(0, finite(value, fallback)));
}

function asUnit(value, fallback = 0) {
  const numeric = finite(value, fallback);
  return clamp01(Math.abs(numeric) > 1 ? numeric / 100 : numeric, fallback);
}

function asSignedUnit(value, fallback = 0) {
  const numeric = finite(value, fallback);
  return Math.min(1, Math.max(-1, Math.abs(numeric) > 1 ? numeric / 100 : numeric));
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(finite(value) * factor) / factor;
}

function compactText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function firstRecord(...values) {
  return values.find(isRecord) || {};
}

function firstText(...values) {
  for (const value of values) {
    const normalized = compactText(value);
    if (normalized) return normalized;
  }
  return "";
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function readActionKind(action, candidate, evaluation) {
  const candidates = [
    action?.actionKind,
    action?.actionType,
    action?.speechAct,
    candidate?.actionKind,
    evaluation?.actionKind,
  ].map((value) => compactText(value).toLowerCase()).filter(Boolean);
  // A spoken defer/pass is semantically more important to the desire updater
  // than its generic carrier action such as `speak`.
  return candidates.find((value) => DEFER_KINDS.has(value) || PASS_KINDS.has(value)) || candidates[0] || "";
}

function readDriveId(action, candidate, evaluation) {
  return firstText(
    action?.driveId,
    action?.desireId,
    candidate?.driveId,
    candidate?.desireId,
    evaluation?.driveId,
    evaluation?.desireId,
    evaluation?.desirePressure?.desireId,
  );
}

function readTargetCharacterId(action, candidate, evaluation) {
  return firstText(
    action?.targetCharacterId,
    action?.targetId,
    candidate?.targetCharacterId,
    candidate?.targetId,
    evaluation?.targetCharacterId,
    evaluation?.targetId,
  );
}

function readCandidateId(action, candidate, evaluation) {
  return firstText(
    action?.candidateId,
    candidate?.candidateId,
    candidate?.id,
    evaluation?.candidateId,
  );
}

function actionWasCommitted(action, materialConsequence) {
  if (action?.committed === true || action?.executed === true || materialConsequence?.committed === true) return true;
  const status = firstText(action?.status, action?.executionStatus, materialConsequence?.status).toLowerCase();
  return ["committed", "executed", "applied", "success", "succeeded", "completed"].includes(status);
}

function hardGateResult(candidate, evaluation) {
  const gates = [
    ...(Array.isArray(candidate?.hardGates) ? candidate.hardGates : []),
    ...(Array.isArray(evaluation?.hardGates) ? evaluation.hardGates : []),
  ];
  const failedGates = [...new Set(gates
    .filter((gate) => gate === false || gate?.passed === false)
    .map((gate, index) => typeof gate === "object" ? firstText(gate.id, `gate-${index + 1}`) : `gate-${index + 1}`))];
  const feasible = candidate?.feasible !== false && evaluation?.feasible !== false && failedGates.length === 0;
  return { feasible, failedGates };
}

function canonicalBody(body = {}) {
  const fatigue = clamp01(firstDefined(body.fatigue, body.exertion, 0));
  const stamina = clamp01(firstDefined(body.stamina, body.energy, 1 - fatigue));
  return {
    ...cloneValue(body),
    hunger: clamp01(body.hunger),
    thirst: clamp01(body.thirst),
    fatigue,
    pain: clamp01(body.pain),
    stamina,
  };
}

function bodyDemand(candidate, action, materialConsequence) {
  return firstRecord(
    materialConsequence?.bodyDemand,
    action?.bodyDemand,
    candidate?.bodyDemand,
    candidate?.bodyForecast,
  );
}

function explicitBodyDeltas(materialConsequence, currentBody) {
  const source = firstRecord(
    materialConsequence?.bodyDeltas,
    materialConsequence?.bodyChanges,
    materialConsequence?.physicalChanges?.bodyDeltas,
  );
  const after = firstRecord(
    materialConsequence?.bodyAfter,
    materialConsequence?.physicalChanges?.bodyAfter,
  );
  const result = {};
  for (const key of ["hunger", "thirst", "fatigue", "pain", "stamina"]) {
    const rawDelta = firstDefined(source[`${key}Delta`], source[key]);
    if (rawDelta !== undefined) result[key] = asSignedUnit(rawDelta);
    const rawAfter = after[key];
    if (rawAfter !== undefined) result[key] = clamp01(Math.abs(finite(rawAfter)) > 1 ? finite(rawAfter) / 100 : rawAfter) - currentBody[key];
  }
  if (materialConsequence?.foodEffect !== undefined && result.hunger === undefined) {
    result.hunger = -asUnit(materialConsequence.foodEffect);
  }
  if (materialConsequence?.restRecovery !== undefined) {
    const recovery = asUnit(materialConsequence.restRecovery);
    if (result.fatigue === undefined) result.fatigue = -recovery;
    if (result.stamina === undefined) result.stamina = recovery;
  }
  return result;
}

function semanticBodyDeltas({ actionKind, candidate, action, materialConsequence, elapsedSeconds, policy, sustenanceProfile }) {
  const hours = Math.max(0, finite(elapsedSeconds)) / 3600;
  const demand = bodyDemand(candidate, action, materialConsequence);
  const sustenance = operationalSustenanceFactors(sustenanceProfile || {});
  const consumedNutrition = firstRecord(materialConsequence?.sustenance, action?.sustenance, candidate?.sustenance);
  const result = {
    hunger: finite(policy.bodyPerHour.hunger) * hours * sustenance.basalHungerGrowth,
    thirst: finite(policy.bodyPerHour.thirst) * hours,
    fatigue: finite(policy.bodyPerHour.fatigue) * hours,
    pain: -finite(policy.bodyPerHour.painRecovery) * hours,
    stamina: -finite(policy.bodyPerHour.staminaDrain) * hours,
  };

  if (EAT_KINDS.has(actionKind) || materialConsequence?.foodConsumed === true) {
    const hungerRelief = demand.hungerRelief === undefined ? 0.28 : asUnit(demand.hungerRelief) * 0.5;
    const recoveryEfficiency = consumedNutrition.class === "spiritual_food"
      ? sustenance.spiritualFoodConversion * asUnit(consumedNutrition.spiritualNutrition ?? 1)
      : sustenance.ordinaryFoodRecoveryEfficiency * asUnit(consumedNutrition.mundaneNutrition ?? 1);
    result.hunger -= hungerRelief * recoveryEfficiency;
    result.fatigue -= (demand.recovery === undefined ? 0.03 : asUnit(demand.recovery) * 0.08) * recoveryEfficiency;
    result.stamina += (demand.recovery === undefined ? 0.07 : asUnit(demand.recovery) * 0.14) * recoveryEfficiency;
  }

  if (DRINK_KINDS.has(actionKind) || materialConsequence?.drinkConsumed === true) {
    const thirstRelief = demand.thirstRelief === undefined ? 0.28 : asUnit(demand.thirstRelief) * 0.5;
    result.thirst -= thirstRelief;
  }

  if (REST_KINDS.has(actionKind) || materialConsequence?.restCompleted === true) {
    const durationScale = Math.max(0.25, Math.min(2, Math.max(0, finite(elapsedSeconds)) / 600 || 1));
    const recovery = demand.recovery === undefined ? 0.18 : asUnit(demand.recovery) * 0.25;
    result.fatigue -= recovery * durationScale;
    result.stamina += recovery * 1.15 * durationScale;
    result.pain -= (demand.painRelief === undefined ? 0.015 : asUnit(demand.painRelief) * 0.1) * durationScale;
  }

  const hasForecastExertion = [demand.exertion, demand.energyDemand, demand.painRisk].some((value) => value !== undefined);
  if (EXERTION_KINDS.has(actionKind) || materialConsequence?.exertionCompleted === true || hasForecastExertion) {
    const exertion = demand.exertion === undefined ? 0.18 : asUnit(demand.exertion);
    const energyDemand = demand.energyDemand === undefined ? exertion : asUnit(demand.energyDemand);
    const painRisk = demand.painRisk === undefined ? 0 : asUnit(demand.painRisk);
    result.hunger += energyDemand * 0.08 * sustenance.exertionHungerCoupling;
    result.thirst += energyDemand * 0.1;
    result.fatigue += exertion * 0.28;
    result.pain += painRisk * 0.12;
    result.stamina -= exertion * 0.34;
  }

  return result;
}

function applyBodyChanges(currentBody, inferredDeltas, explicitDeltas) {
  const next = { ...currentBody };
  const applied = {};
  for (const key of ["hunger", "thirst", "fatigue", "pain", "stamina"]) {
    const delta = Object.prototype.hasOwnProperty.call(explicitDeltas, key)
      ? finite(explicitDeltas[key])
      : finite(inferredDeltas[key]);
    next[key] = round(clamp01(currentBody[key] + delta));
    const actual = round(next[key] - currentBody[key]);
    if (actual !== 0) applied[key] = actual;
  }
  // Keep the legacy body aliases synchronized while older readers still exist.
  if (Object.prototype.hasOwnProperty.call(next, "energy")) next.energy = next.stamina;
  if (Object.prototype.hasOwnProperty.call(next, "exertion")) next.exertion = next.fatigue;
  return { body: next, applied };
}

function desireRecords(source) {
  if (Array.isArray(source)) {
    return {
      kind: "array",
      map: new Map(source.filter(isRecord).map((entry) => [firstText(entry.desireId, entry.id), cloneValue(entry)])),
    };
  }
  const record = isRecord(source) ? source : {};
  return {
    kind: "object",
    map: new Map(Object.entries(record).map(([id, entry]) => [id, cloneValue(entry)])),
  };
}

function materialDesireEffects(materialConsequence, selectedDriveId) {
  const effects = [];
  const arraySources = [
    materialConsequence?.desireEffects,
    materialConsequence?.desireChanges,
    materialConsequence?.desireProgress,
  ];
  for (const source of arraySources) {
    if (Array.isArray(source)) effects.push(...source.filter(isRecord));
    else if (isRecord(source)) effects.push(source);
  }
  const hasGlobalDesireFields = [
    "satisfactionDelta",
    "desireSatisfaction",
    "frustrationDelta",
    "cueDelta",
    "urgencyDelta",
    "satisfactionEvidence",
  ].some((key) => materialConsequence?.[key] !== undefined);
  if (hasGlobalDesireFields) {
    effects.push({
      driveId: selectedDriveId,
      satisfactionDelta: firstDefined(materialConsequence.satisfactionDelta, materialConsequence.desireSatisfaction),
      frustrationDelta: materialConsequence.frustrationDelta,
      cueDelta: materialConsequence.cueDelta,
      urgencyDelta: materialConsequence.urgencyDelta,
      satisfactionEvidence: materialConsequence.satisfactionEvidence,
      satisfactionConditionMet: materialConsequence.satisfactionConditionMet,
    });
  }
  return effects;
}

function evidenceRecord(effect, materialConsequence) {
  const evidence = firstDefined(
    effect?.satisfactionEvidence,
    effect?.evidence,
    materialConsequence?.satisfactionEvidence,
  );
  if (evidence === true) return { verified: true, kind: "explicit_verification" };
  return isRecord(evidence) ? evidence : null;
}

function normalizedDesireState(entry, desireId) {
  const cue = clamp01(firstDefined(entry?.cue, entry?.cueActivation, 0));
  return {
    ...cloneValue(entry || {}),
    desireId: firstText(entry?.desireId, entry?.id, desireId),
    strength: clamp01(entry?.strength),
    satisfaction: clamp01(entry?.satisfaction),
    frustration: clamp01(entry?.frustration),
    cue,
    cueActivation: cue,
    urgency: clamp01(entry?.urgency),
  };
}

function applyDesireChanges({
  source,
  driveId,
  actionKind,
  materialConsequence,
  elapsedSeconds,
  nowSecond,
  policy,
}) {
  const records = desireRecords(source);
  const changes = [];
  const verifiedEvidence = [];
  const ignoredSatisfactionClaims = [];
  const hours = Math.max(0, finite(elapsedSeconds)) / 3600;

  for (const [id, entry] of records.map) {
    const normalized = normalizedDesireState(entry, id);
    const decay = finite(policy.desirePerHour.cueDecay) * hours;
    normalized.cue = round(clamp01(normalized.cue - decay));
    normalized.cueActivation = normalized.cue;
    normalized.urgency = round(clamp01(
      normalized.urgency + finite(normalized.urgencyGrowthPerHour) * hours,
    ));
    normalized.strength = round(clamp01(
      normalized.strength + finite(normalized.growthPerHour) * hours,
    ));
    records.map.set(id, normalized);
  }

  const effects = materialDesireEffects(materialConsequence, driveId);
  for (const effect of effects) {
    const effectDriveId = firstText(effect.driveId, effect.desireId, driveId);
    if (!effectDriveId) continue;
    const current = normalizedDesireState(records.map.get(effectDriveId), effectDriveId);
    const before = cloneValue(current);
    const evidence = evidenceRecord(effect, materialConsequence);
    const satisfactionClaim = firstDefined(effect.satisfactionDelta, effect.desireSatisfaction);
    const conditionMet = effect.satisfactionConditionMet === true || effect.satisfied === true;

    if (conditionMet || finite(satisfactionClaim) > 0) {
      if (evidence?.verified === true) {
        const requested = conditionMet && satisfactionClaim === undefined
          ? 1 - current.satisfaction
          : asUnit(satisfactionClaim);
        const delta = Math.max(0, requested);
        current.satisfaction = round(clamp01(current.satisfaction + delta));
        current.frustration = round(clamp01(current.frustration - delta * 0.5));
        current.urgency = round(clamp01(current.urgency - delta * 0.3));
        if (current.satisfaction > before.satisfaction) current.lastSatisfiedAtSecond = nowSecond;
        verifiedEvidence.push({
          driveId: effectDriveId,
          evidenceId: firstText(evidence.id, evidence.eventId, evidence.outcomeId),
          kind: firstText(evidence.kind, evidence.type, "verified_satisfaction"),
          amount: round(current.satisfaction - before.satisfaction),
          conditionMet,
          fullySatisfied: current.satisfaction >= 1,
        });
      } else {
        ignoredSatisfactionClaims.push({
          driveId: effectDriveId,
          amount: round(asUnit(satisfactionClaim)),
          reason: "positive satisfaction requires explicit verified evidence",
        });
      }
    }

    if (effect.frustrationDelta !== undefined) {
      current.frustration = round(clamp01(current.frustration + asSignedUnit(effect.frustrationDelta)));
    }
    if (effect.cueDelta !== undefined) {
      current.cue = round(clamp01(current.cue + asSignedUnit(effect.cueDelta)));
      current.cueActivation = current.cue;
    }
    if (effect.urgencyDelta !== undefined) {
      current.urgency = round(clamp01(current.urgency + asSignedUnit(effect.urgencyDelta)));
    }
    records.map.set(effectDriveId, current);
    if (JSON.stringify(before) !== JSON.stringify(current)) {
      changes.push({ driveId: effectDriveId, before, after: cloneValue(current), source: "material_consequence" });
    }
  }

  const selected = driveId ? normalizedDesireState(records.map.get(driveId), driveId) : null;
  const selectedWasSatisfied = verifiedEvidence.some((entry) => entry.driveId === driveId && entry.amount > 0);
  if (selected && selected.satisfaction < 1 && !selectedWasSatisfied && (DEFER_KINDS.has(actionKind) || PASS_KINDS.has(actionKind))) {
    const before = cloneValue(selected);
    const delta = DEFER_KINDS.has(actionKind) ? finite(policy.deferFrustration) : finite(policy.passFrustration);
    selected.frustration = round(clamp01(selected.frustration + delta));
    selected.cue = round(clamp01(selected.cue + delta * 0.5));
    selected.cueActivation = selected.cue;
    selected.urgency = round(clamp01(selected.urgency + delta * 0.25));
    selected.lastBlockedAtSecond = nowSecond;
    records.map.set(driveId, selected);
    changes.push({ driveId, before, after: cloneValue(selected), source: actionKind });
  }

  const output = records.kind === "array"
    ? [...records.map.values()]
    : Object.fromEntries(records.map.entries());
  return { desires: output, changes, verifiedEvidence, ignoredSatisfactionClaims };
}

function activeIntention(intention) {
  return Boolean(
    intention
    && typeof intention === "object"
    && firstText(intention.intentionId, intention.sourceId, intention.driveId, intention.actionId),
  );
}

function blankIntention(previous, nowSecond, reason) {
  return {
    ...(isRecord(previous) ? cloneValue(previous) : {}),
    intentionId: null,
    sourceKind: null,
    sourceId: null,
    actionId: null,
    target: null,
    utility: null,
    committedAtSecond: null,
    interruptedAtSecond: null,
    completedAtSecond: nowSecond,
    completionReason: reason,
    ageSeconds: 0,
    driveId: null,
    actionKind: null,
    targetCharacterId: null,
  };
}

function updateIntention({
  previous,
  driveId,
  actionKind,
  targetCharacterId,
  candidateId,
  evaluation,
  materialConsequence,
  elapsedSeconds,
  nowSecond,
  verifiedEvidence,
}) {
  const current = isRecord(previous) ? cloneValue(previous) : {};
  const previousDriveId = firstText(current.sourceId, current.driveId);
  const ageSeconds = Math.max(0, finite(current.ageSeconds)) + Math.max(0, finite(elapsedSeconds));
  const satisfied = verifiedEvidence.some((entry) => (
    entry.driveId === driveId && (entry.conditionMet === true || entry.fullySatisfied === true)
  ));
  if (materialConsequence?.intentionCompleted === true || (satisfied && materialConsequence?.keepIntentionOpen !== true)) {
    return { intention: blankIntention(current, nowSecond, "verified_satisfaction"), transition: "completed" };
  }
  if (DEFER_KINDS.has(actionKind) || PASS_KINDS.has(actionKind)) {
    return { intention: { ...current, ageSeconds: round(ageSeconds) }, transition: "retained_while_deferred" };
  }
  if (!driveId) return { intention: { ...current, ageSeconds: round(ageSeconds) }, transition: "unchanged" };

  const target = targetCharacterId
    ? { type: "character", id: targetCharacterId }
    : firstDefined(current.target, null);
  const utilityRaw = firstDefined(evaluation?.activationScore, evaluation?.utility, current.utility, 0.6);
  const utility = Math.abs(finite(utilityRaw)) > 1 ? clamp01(finite(utilityRaw) / 100) : clamp01(utilityRaw);
  if (activeIntention(current) && previousDriveId === driveId) {
    return {
      intention: {
        ...current,
        sourceKind: "desire",
        sourceId: driveId,
        driveId,
        actionId: candidateId || current.actionId,
        actionKind: actionKind || current.actionKind,
        target,
        targetCharacterId: targetCharacterId || current.targetCharacterId || null,
        utility: Math.max(clamp01(current.utility), utility),
        // Advancing the same intention refreshes its inertia without changing
        // its identity or original committedAtSecond.
        ageSeconds: 0,
        lastAdvancedAtSecond: nowSecond,
        interruptedAtSecond: null,
      },
      transition: "continued",
    };
  }
  return {
    intention: {
      intentionId: firstText(materialConsequence?.intentionId, `intention:${driveId}:${candidateId || actionKind || "act"}`),
      sourceKind: "desire",
      sourceId: driveId,
      driveId,
      actionId: candidateId || actionKind || null,
      actionKind: actionKind || null,
      target,
      targetCharacterId: targetCharacterId || null,
      utility,
      committedAtSecond: nowSecond,
      interruptedAtSecond: null,
      ageSeconds: 0,
    },
    transition: activeIntention(current) ? "switched" : "adopted",
  };
}

function ageIntention(previous, elapsedSeconds) {
  if (!isRecord(previous)) return previous ?? null;
  return {
    ...cloneValue(previous),
    ageSeconds: round(Math.max(0, finite(previous.ageSeconds)) + Math.max(0, finite(elapsedSeconds))),
  };
}

function actionSignature({ action, candidateId, actionKind, driveId, targetCharacterId }) {
  const explicit = firstText(action?.signature, action?.actionSignature);
  if (explicit) return explicit;
  return [candidateId || actionKind || "action", driveId || "no-drive", targetCharacterId || "no-target"].join("|");
}

function cappedSignatures(source, signature, limit) {
  const previous = Array.isArray(source) ? source.map(cloneValue) : [];
  if (signature) previous.push(signature);
  return previous.slice(-Math.max(1, Math.floor(finite(limit, 12))));
}

/**
 * Applies only consequences of an action that was both feasible and explicitly
 * committed by the executor. Candidate forecasts never count as proof that a
 * desire was satisfied. The function is deterministic and never mutates any
 * input object.
 */
export function applyTavernEcologyOutcome({
  ecologyState = {},
  selectedCandidate = {},
  evaluation = selectedCandidate?.evaluation || {},
  action = {},
  materialConsequence = {},
  elapsedSeconds = 0,
  sustenanceProfile = {},
  policy: policyOverrides = {},
} = {}) {
  const stateBefore = cloneValue(ecologyState || {});
  const policy = {
    ...DEFAULT_TAVERN_ECOLOGY_OUTCOME_POLICY,
    ...cloneValue(policyOverrides || {}),
    bodyPerHour: {
      ...DEFAULT_TAVERN_ECOLOGY_OUTCOME_POLICY.bodyPerHour,
      ...(policyOverrides?.bodyPerHour || {}),
    },
    desirePerHour: {
      ...DEFAULT_TAVERN_ECOLOGY_OUTCOME_POLICY.desirePerHour,
      ...(policyOverrides?.desirePerHour || {}),
    },
  };
  const deltaSeconds = Math.max(0, finite(elapsedSeconds));
  const previousSecond = Math.max(0, finite(stateBefore.elapsedSeconds));
  const nowSecond = round(previousSecond + deltaSeconds);
  const candidate = firstRecord(selectedCandidate?.candidate, selectedCandidate);
  const committed = actionWasCommitted(action, materialConsequence);
  const gates = hardGateResult(candidate, evaluation);
  const applied = committed && gates.feasible;
  const actionKind = readActionKind(action, candidate, evaluation);
  const driveId = readDriveId(action, candidate, evaluation);
  const targetCharacterId = readTargetCharacterId(action, candidate, evaluation);
  const candidateId = readCandidateId(action, candidate, evaluation);

  const next = {
    ...stateBefore,
    elapsedSeconds: nowSecond,
    body: canonicalBody(stateBefore.body),
    currentIntention: ageIntention(stateBefore.currentIntention, deltaSeconds),
    recentActionSignatures: Array.isArray(stateBefore.recentActionSignatures)
      ? stateBefore.recentActionSignatures.map(cloneValue)
      : [],
  };
  let bodyChanges = {};
  let desireResult = {
    desires: cloneValue(stateBefore.desires || {}),
    changes: [],
    verifiedEvidence: [],
    ignoredSatisfactionClaims: [],
  };
  let intentionTransition = applied ? "unchanged" : "not_applied";
  let signature = null;

  if (applied) {
    const inferredDeltas = semanticBodyDeltas({
      actionKind,
      candidate,
      action,
      materialConsequence,
      elapsedSeconds: deltaSeconds,
      policy,
      sustenanceProfile,
    });
    const explicitDeltas = explicitBodyDeltas(materialConsequence, next.body);
    const bodyResult = applyBodyChanges(next.body, inferredDeltas, explicitDeltas);
    next.body = bodyResult.body;
    bodyChanges = bodyResult.applied;

    desireResult = applyDesireChanges({
      source: stateBefore.desires,
      driveId,
      actionKind,
      materialConsequence,
      elapsedSeconds: deltaSeconds,
      nowSecond,
      policy,
    });
    next.desires = desireResult.desires;

    const intentionResult = updateIntention({
      previous: stateBefore.currentIntention,
      driveId,
      actionKind,
      targetCharacterId,
      candidateId,
      evaluation,
      materialConsequence,
      elapsedSeconds: deltaSeconds,
      nowSecond,
      verifiedEvidence: desireResult.verifiedEvidence,
    });
    next.currentIntention = intentionResult.intention;
    intentionTransition = intentionResult.transition;
    signature = actionSignature({ action, candidateId, actionKind, driveId, targetCharacterId });
    next.recentActionSignatures = cappedSignatures(
      stateBefore.recentActionSignatures,
      signature,
      policy.recentActionLimit,
    );
  }

  const status = !gates.feasible ? "blocked" : committed ? "applied" : "uncommitted";
  next.lastOutcome = {
    schemaVersion: TAVERN_ECOLOGY_OUTCOME_VERSION,
    status,
    committed,
    feasible: gates.feasible,
    applied,
    failedGates: [...gates.failedGates],
    candidateId: candidateId || null,
    actionKind: actionKind || null,
    driveId: driveId || null,
    targetCharacterId: targetCharacterId || null,
    elapsedSeconds: deltaSeconds,
    occurredAtSecond: nowSecond,
    bodyChanges,
    desireChanges: desireResult.changes,
    satisfactionEvidence: desireResult.verifiedEvidence,
    ignoredSatisfactionClaims: desireResult.ignoredSatisfactionClaims,
    intentionTransition,
    actionSignature: signature,
    materialConsequenceId: firstText(materialConsequence.id, materialConsequence.outcomeId, materialConsequence.eventId) || null,
  };
  return next;
}

export const updateTavernEcologyState = applyTavernEcologyOutcome;
