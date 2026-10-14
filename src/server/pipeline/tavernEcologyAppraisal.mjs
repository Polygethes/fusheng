import { scoreActionCandidates } from "../simulation/actionUtility.mjs";

export const ECOLOGY_APPRAISAL_VERSION = "2.0.0";

export const DEFAULT_ECOLOGY_WEIGHTS = deepFreeze({
  desire: {
    baseline: 0.62,
    urgency: 0.15,
    cueActivation: 0.12,
    frustration: 0.16,
    needCoupling: 0.08,
    deadlineUrgency: 0.12,
    satiation: 0.55,
  },
  bodyReward: {
    recovery: 0.55,
    hungerRelief: 0.25,
    thirstRelief: 0.25,
    safetyGain: 0.20,
  },
  bodyCost: {
    exertion: 0.60,
    painRisk: 0.25,
    energyDemand: 0.15,
  },
  resistance: {
    persistenceRelief: 0.18,
    assertivenessRelief: 0.08,
  },
  intention: {
    driveMatch: 0.50,
    actionMatch: 0.25,
    targetMatch: 0.25,
    driveSwitch: 0.55,
    actionSwitch: 0.20,
    targetSwitch: 0.25,
  },
  activation: {
    desireFit: 0.62,
    opportunity: 0.16,
    bodyReward: 0.16,
    dutyPressure: 0.12,
    socialPull: 0.10,
    emotionalPull: 0.08,
    intentionContinuity: 0.14,
    obstacleResistance: 0.52,
    bodyCost: 0.28,
    switchingCost: 0.14,
    repetitionPenalty: 0.12,
  },
  obstacles: {},
});

export const DEFAULT_ECOLOGY_SELECTION_POLICY = deepFreeze({
  nearTopWindow: 10,
  temperature: 4.5,
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeObjects(base, ...overrides) {
  const result = isPlainObject(base) ? { ...base } : {};
  for (const override of overrides) {
    if (!isPlainObject(override)) continue;
    for (const [key, value] of Object.entries(override)) {
      result[key] = isPlainObject(value)
        ? mergeObjects(isPlainObject(result[key]) ? result[key] : {}, value)
        : Array.isArray(value) ? [...value] : value;
    }
  }
  return result;
}

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, finite(value)));
}

function relationshipsForGenericUtility(relationships = []) {
  return (Array.isArray(relationships) ? relationships : []).map((relationship) => {
    const love = clamp(relationship.love);
    const dependence = clamp(relationship.dependence);
    const protection = clamp(relationship.protection);
    const resentment = clamp(relationship.resentment);
    const fear = clamp(relationship.fear);
    const deception = clamp(relationship.deception);
    return {
      ...relationship,
      fromActorId: relationship.fromActorId || relationship.fromCharacterId || "",
      toActorId: relationship.toActorId || relationship.toCharacterId || "",
      closeness: Number.isFinite(Number(relationship.closeness))
        ? relationship.closeness
        : (love + dependence + protection) / 3,
      trust: Number.isFinite(Number(relationship.trust))
        ? relationship.trust
        : clamp((love + dependence + protection) / 3 - fear * 0.28 - deception * 0.38),
      care: Number.isFinite(Number(relationship.care))
        ? relationship.care
        : (love + protection) / 2,
      conflict: Number.isFinite(Number(relationship.conflict))
        ? relationship.conflict
        : (resentment + fear) / 2,
    };
  });
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(finite(value) * factor) / factor;
}

function compactText(value, fallback = "") {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function readPath(source, path) {
  if (!source || !path) return undefined;
  return String(path).split(".").reduce((cursor, key) => cursor?.[key], source);
}

function firstFinite(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function levelFromCharacter(character, path, fallback = 50) {
  const direct = readPath(character, path);
  const sources = [
    direct,
    readPath(character?.traits, path),
    readPath(character?.personality, path),
    readPath(character?.traumaSensitivities, path),
    readPath(character?.ecologyProfile, path),
    readPath(character?.ecologyProfile?.traits, path),
    readPath(character?.ecologyProfile?.traumaSensitivities, path),
  ];
  for (const source of sources) {
    const numeric = Number(source);
    if (Number.isFinite(numeric)) return clamp(numeric);
  }
  return clamp(fallback);
}

function factor(id, label, raw, weight, polarity = "positive", extra = {}) {
  return {
    id,
    label,
    raw: round(raw),
    weight: round(weight, 4),
    contribution: round(clamp(raw) * Math.max(0, finite(weight))),
    polarity,
    ...extra,
  };
}

function sumContributions(factors) {
  return factors.reduce((total, item) => total + finite(item.contribution), 0);
}

/**
 * Shared formula weights may be adjusted per character without changing the
 * appraisal algorithm. The accepted personal keys are factorWeights,
 * ecologyWeights, or ecologyProfile.factorWeights.
 */
export function resolveEcologyWeights(character = {}, overrides = {}) {
  return mergeObjects(
    DEFAULT_ECOLOGY_WEIGHTS,
    character.factorWeights,
    character.ecologyWeights,
    character.ecologyProfile?.factorWeights,
    overrides,
  );
}

function desireNumber(desire, key, ...aliases) {
  const values = [desire?.[key], ...aliases.map((alias) => readPath(desire, alias))];
  return clamp(firstFinite(...values));
}

/**
 * Desire pressure answers only "how much does this person want it now?".
 * Shame, public rules, distance, and fatigue do not rewrite the desire; those
 * belong to resistance, hard gates, or body cost.
 */
export function computeDesirePressure({
  desire = {},
  character = {},
  currentState = {},
  weights: weightOverrides = {},
} = {}) {
  const weights = resolveEcologyWeights(character, weightOverrides).desire;
  const raw = {
    baseline: desireNumber(desire, "baseline", "intensity", "strength"),
    urgency: desireNumber(desire, "urgency", "state.urgency"),
    cueActivation: clamp(firstFinite(
      desire?.cueActivation,
      currentState?.cueActivation,
      readPath(currentState, `desireCues.${desire?.id}`),
    )),
    frustration: clamp(firstFinite(desire?.frustration, currentState?.frustration)),
    needCoupling: clamp(firstFinite(desire?.needCoupling, currentState?.needCoupling)),
    deadlineUrgency: desireNumber(desire, "deadlineUrgency", "deadline", "state.deadlineUrgency"),
    satiation: clamp(firstFinite(desire?.satiation, currentState?.satiation)),
  };

  const positiveFactors = [
    factor("desire-baseline", "长期欲望强度", raw.baseline, weights.baseline),
    factor("desire-urgency", "当前紧迫度", raw.urgency, weights.urgency),
    factor("desire-cue", "眼前线索唤起", raw.cueActivation, weights.cueActivation),
    factor("desire-frustration", "受阻累积", raw.frustration, weights.frustration),
    factor("desire-need", "底层需要耦合", raw.needCoupling, weights.needCoupling),
    factor("desire-deadline", "时限压力", raw.deadlineUrgency, weights.deadlineUrgency),
  ];
  const negativeFactors = [
    factor("desire-satiation", "欲望已满足程度", raw.satiation, weights.satiation, "negative"),
  ];
  const unboundedScore = sumContributions(positiveFactors) - sumContributions(negativeFactors);

  return {
    desireId: compactText(desire.id),
    want: compactText(desire.want || desire.description || desire.label),
    score: round(clamp(unboundedScore)),
    unboundedScore: round(unboundedScore),
    positiveFactors,
    negativeFactors,
  };
}

function bodyDemandFor(candidate = {}) {
  return candidate.bodyDemand || candidate.bodyForecast || candidate.body || {};
}

/**
 * Rewards and costs use the same proposed action but react to the person's
 * current body. Recovery is more valuable when tired; exertion is more costly.
 */
export function computeBodyReward({
  candidate = {},
  character = {},
  bodyState = {},
  weights: weightOverrides = {},
} = {}) {
  const resolved = resolveEcologyWeights(character, weightOverrides);
  const demand = bodyDemandFor(candidate);
  const fatigue = clamp(firstFinite(bodyState.fatigue, 100 - finite(bodyState.stamina, 100)));
  const hunger = clamp(bodyState.hunger);
  const thirst = clamp(bodyState.thirst);
  const pain = clamp(bodyState.pain);
  const safetyNeed = clamp(firstFinite(bodyState.safetyNeed, 100 - finite(bodyState.safety, 100)));
  const fatigueSensitivity = levelFromCharacter(character, "fatigueSensitivity", 50);
  const painSensitivity = levelFromCharacter(character, "painSensitivity", 50);

  const rewardRaw = {
    recovery: clamp(demand.recovery) * fatigue / 100,
    hungerRelief: clamp(demand.hungerRelief) * hunger / 100,
    thirstRelief: clamp(demand.thirstRelief) * thirst / 100,
    safetyGain: clamp(demand.safetyGain) * safetyNeed / 100,
  };
  const costRaw = {
    exertion: clamp(demand.exertion)
      * (0.25 + 0.75 * fatigue / 100)
      * (0.5 + fatigueSensitivity / 200),
    painRisk: clamp(demand.painRisk)
      * (0.25 + 0.75 * pain / 100)
      * (0.5 + painSensitivity / 200),
    energyDemand: clamp(demand.energyDemand)
      * (0.25 + 0.75 * hunger / 100),
  };

  const rewardFactors = [
    factor("body-recovery", "疲劳状态下的恢复收益", rewardRaw.recovery, resolved.bodyReward.recovery),
    factor("body-hunger-relief", "饥饿状态下的进食收益", rewardRaw.hungerRelief, resolved.bodyReward.hungerRelief),
    factor("body-thirst-relief", "口渴状态下的饮水收益", rewardRaw.thirstRelief, resolved.bodyReward.thirstRelief),
    factor("body-safety", "不安全状态下的安全收益", rewardRaw.safetyGain, resolved.bodyReward.safetyGain),
  ];
  const costFactors = [
    factor("body-exertion", "疲劳放大的体力代价", costRaw.exertion, resolved.bodyCost.exertion, "negative"),
    factor("body-pain-risk", "疼痛放大的受伤风险", costRaw.painRisk, resolved.bodyCost.painRisk, "negative"),
    factor("body-energy", "饥饿放大的能量代价", costRaw.energyDemand, resolved.bodyCost.energyDemand, "negative"),
  ];

  return {
    state: {
      fatigue: round(fatigue),
      hunger: round(hunger),
      thirst: round(thirst),
      pain: round(pain),
      safetyNeed: round(safetyNeed),
    },
    rewardScore: round(clamp(sumContributions(rewardFactors))),
    costScore: round(clamp(sumContributions(costFactors))),
    rewardFactors,
    costFactors,
  };
}

function environmentalIntensity(obstacle, environment) {
  const direct = Number(obstacle?.intensity);
  if (Number.isFinite(direct)) return clamp(direct);
  const value = readPath(environment, obstacle?.environmentKey);
  return clamp(value);
}

function obstacleSensitivity(obstacle, character) {
  if (Number.isFinite(Number(obstacle?.sensitivity))) return clamp(obstacle.sensitivity);
  if (!obstacle?.sensitivityKey) return 100;
  return levelFromCharacter(character, obstacle.sensitivityKey, 50);
}

/**
 * Multiple obstacles combine as independent frictions, so two moderate
 * obstacles matter without being naively added beyond 100. Personality and
 * trauma sensitivity change each obstacle's force; persistence only reduces
 * the final resistance and never erases a hard gate.
 */
export function computeObstacleResistance({
  candidate = {},
  character = {},
  environment = {},
  weights: weightOverrides = {},
} = {}) {
  const resolved = resolveEcologyWeights(character, weightOverrides);
  const obstacles = Array.isArray(candidate.obstacles) ? candidate.obstacles : [];
  const factors = obstacles.map((obstacle, index) => {
    const id = compactText(obstacle.id, `obstacle-${index + 1}`);
    const intensity = environmentalIntensity(obstacle, environment);
    const sensitivity = obstacleSensitivity(obstacle, character);
    const personalMultiplier = Math.max(0, finite(
      readPath(resolved.obstacles, id),
      1,
    ));
    const contribution = clamp(intensity * sensitivity / 100 * personalMultiplier);
    return {
      id,
      label: compactText(obstacle.label, id),
      source: compactText(obstacle.source, obstacle.environmentKey ? "environment" : "candidate"),
      intensity: round(intensity),
      sensitivityKey: compactText(obstacle.sensitivityKey),
      sensitivity: round(sensitivity),
      personalMultiplier: round(personalMultiplier, 4),
      contribution: round(contribution),
      polarity: "negative",
    };
  });

  const remainingEase = factors.reduce(
    (remaining, item) => remaining * (1 - clamp(item.contribution) / 100),
    1,
  );
  const rawCombined = clamp((1 - remainingEase) * 100);
  const persistence = levelFromCharacter(character, "persistence", 50);
  const assertiveness = levelFromCharacter(character, "assertiveness", 50);
  const reliefRatio = clamp(
    persistence * finite(resolved.resistance.persistenceRelief)
      + assertiveness * finite(resolved.resistance.assertivenessRelief),
    0,
    45,
  ) / 100;
  const candidateRelief = clamp(candidate.resistanceRelief) / 100;
  const effectiveRelief = clamp((1 - (1 - reliefRatio) * (1 - candidateRelief)) * 100, 0, 60) / 100;
  const score = rawCombined * (1 - effectiveRelief);

  return {
    score: round(clamp(score)),
    rawCombined: round(rawCombined),
    reliefRatio: round(effectiveRelief * 100),
    persistence: round(persistence),
    assertiveness: round(assertiveness),
    factors,
  };
}

function sameIdentity(left, right) {
  return Boolean(left && right && String(left) === String(right));
}

/**
 * A current intention persists for seconds, not macro time slots. Matching it
 * earns continuity; changing it incurs a decaying switching cost.
 */
export function computeIntentionContinuity({
  intention = null,
  candidate = {},
  character = {},
  weights: weightOverrides = {},
} = {}) {
  if (!intention || typeof intention !== "object") {
    return {
      retainedStrength: 0,
      continuityScore: 0,
      switchingCost: 0,
      retention: 0,
      matches: { drive: false, action: false, target: false },
    };
  }

  const weights = resolveEcologyWeights(character, weightOverrides).intention;
  const strength = clamp(firstFinite(intention.strength, 60));
  const ageSeconds = Math.max(0, finite(intention.ageSeconds));
  const halfLifeSeconds = Math.max(1, finite(intention.halfLifeSeconds, 180));
  const retention = Math.exp(-Math.LN2 * ageSeconds / halfLifeSeconds);
  const retainedStrength = strength * retention;
  const candidateTargetId = candidate.targetCharacterId || candidate.targetId || "";
  const matches = {
    drive: sameIdentity(intention.driveId, candidate.driveId),
    action: sameIdentity(intention.actionKind, candidate.actionKind),
    target: sameIdentity(intention.targetCharacterId || intention.targetId, candidateTargetId),
  };

  const continuityRatio =
    (matches.drive ? finite(weights.driveMatch) : 0)
    + (matches.action ? finite(weights.actionMatch) : 0)
    + (matches.target ? finite(weights.targetMatch) : 0);
  const switchRatio =
    (intention.driveId && !matches.drive ? finite(weights.driveSwitch) : 0)
    + (intention.actionKind && !matches.action ? finite(weights.actionSwitch) : 0)
    + ((intention.targetCharacterId || intention.targetId) && !matches.target ? finite(weights.targetSwitch) : 0);

  return {
    retainedStrength: round(retainedStrength),
    continuityScore: round(clamp(retainedStrength * continuityRatio)),
    switchingCost: round(clamp(retainedStrength * switchRatio)),
    retention: round(retention, 4),
    ageSeconds: round(ageSeconds),
    halfLifeSeconds: round(halfLifeSeconds),
    matches,
  };
}

function compareGate(actual, operator, required) {
  switch (operator) {
    case "eq": return actual === required;
    case "neq": return actual !== required;
    case "gte": return finite(actual, -Infinity) >= finite(required, Infinity);
    case "lte": return finite(actual, Infinity) <= finite(required, -Infinity);
    case "includes": return Array.isArray(actual) && actual.includes(required);
    case "truthy": return Boolean(actual);
    case "falsy": return !actual;
    default: return false;
  }
}

function normalizeHardGate(gate, index) {
  if (typeof gate === "boolean") {
    return {
      id: `gate-${index + 1}`,
      label: `硬门控 ${index + 1}`,
      passed: gate,
      reason: gate ? "已满足" : "未满足",
    };
  }
  const record = isPlainObject(gate) ? gate : {};
  const passed = typeof record.passed === "boolean"
    ? record.passed
    : Object.prototype.hasOwnProperty.call(record, "actual")
      ? compareGate(record.actual, record.operator || "eq", record.required)
      : false;
  return {
    id: compactText(record.id, `gate-${index + 1}`),
    label: compactText(record.label, record.id || `硬门控 ${index + 1}`),
    passed,
    reason: compactText(record.reason, passed ? "已满足" : "未满足"),
  };
}

function evaluateHardGates(candidate) {
  const source = Array.isArray(candidate.hardGates) ? candidate.hardGates : [];
  const hardGates = source.map(normalizeHardGate);
  if (candidate.feasible === false) {
    hardGates.push({
      id: "candidate-feasible",
      label: "行动自身可行",
      passed: false,
      reason: compactText(candidate.infeasibleReason, "候选行动被标记为不可行"),
    });
  }
  return {
    hardGates,
    feasible: hardGates.every((gate) => gate.passed),
    blockedBy: hardGates.filter((gate) => !gate.passed).map((gate) => gate.id),
  };
}

function activationFactor(id, label, raw, weight, polarity) {
  return factor(id, label, raw, weight, polarity);
}

export function evaluateEcologyCandidate({
  candidate = {},
  character = {},
  desire = {},
  bodyState = {},
  currentState = {},
  environment = {},
  intention = null,
  weights: weightOverrides = {},
} = {}) {
  const resolved = resolveEcologyWeights(character, weightOverrides);
  const desirePressure = computeDesirePressure({ desire, character, currentState, weights: weightOverrides });
  const bodyAppraisal = computeBodyReward({ candidate, character, bodyState, weights: weightOverrides });
  const obstacleResistance = computeObstacleResistance({ candidate, character, environment, weights: weightOverrides });
  const intentionContinuity = computeIntentionContinuity({ intention, candidate, character, weights: weightOverrides });
  const gateResult = evaluateHardGates(candidate);
  const expectedSatisfaction = clamp(firstFinite(candidate.expectedSatisfaction, candidate.desireFit));
  const desireFit = desirePressure.score * expectedSatisfaction / 100;

  const positiveFactors = [
    activationFactor("activation-desire", "这项行动满足当前欲望", desireFit, resolved.activation.desireFit, "positive"),
    activationFactor("activation-opportunity", "眼前机会", clamp(candidate.opportunity), resolved.activation.opportunity, "positive"),
    activationFactor("activation-body-reward", "身体收益", bodyAppraisal.rewardScore, resolved.activation.bodyReward, "positive"),
    activationFactor("activation-duty", "职责牵引", clamp(candidate.dutyPressure), resolved.activation.dutyPressure, "positive"),
    activationFactor("activation-social", "关系与社会牵引", clamp(candidate.socialPull), resolved.activation.socialPull, "positive"),
    activationFactor("activation-emotion", "当前情绪推动", clamp(candidate.emotionalPull), resolved.activation.emotionalPull, "positive"),
    activationFactor(
      "activation-continuity",
      "延续刚才的意图",
      intentionContinuity.continuityScore,
      resolved.activation.intentionContinuity,
      "positive",
    ),
  ];
  const negativeFactors = [
    activationFactor(
      "activation-resistance",
      "阻碍合力",
      obstacleResistance.score,
      resolved.activation.obstacleResistance,
      "negative",
    ),
    activationFactor("activation-body-cost", "身体代价", bodyAppraisal.costScore, resolved.activation.bodyCost, "negative"),
    activationFactor(
      "activation-switch",
      "中断当前意图的代价",
      intentionContinuity.switchingCost,
      resolved.activation.switchingCost,
      "negative",
    ),
    activationFactor(
      "activation-repetition",
      "近期重复惩罚",
      clamp(candidate.repetitionPenalty),
      resolved.activation.repetitionPenalty,
      "negative",
    ),
  ];
  const unboundedScore = sumContributions(positiveFactors) - sumContributions(negativeFactors);
  const ungatedScore = round(clamp(unboundedScore));
  const activationScore = gateResult.feasible ? ungatedScore : 0;

  return {
    candidateId: compactText(candidate.id),
    label: compactText(candidate.label || candidate.description || candidate.id),
    driveId: compactText(candidate.driveId || desire.id),
    actionKind: compactText(candidate.actionKind),
    targetCharacterId: compactText(candidate.targetCharacterId || candidate.targetId),
    feasible: gateResult.feasible,
    blockedBy: gateResult.blockedBy,
    hardGates: gateResult.hardGates,
    activationScore,
    ungatedScore,
    unboundedScore: round(unboundedScore),
    desirePressure,
    expectedSatisfaction: round(expectedSatisfaction),
    bodyAppraisal,
    obstacleResistance,
    intentionContinuity,
    positiveFactors,
    negativeFactors,
  };
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value ?? "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededUnitInterval(seed) {
  let state = hashSeed(seed) + 0x6D2B79F5;
  state = Math.imul(state ^ state >>> 15, state | 1);
  state ^= state + Math.imul(state ^ state >>> 7, state | 61);
  return ((state ^ state >>> 14) >>> 0) / 4294967296;
}

/**
 * Randomness is allowed only among candidates close to the best score. This
 * preserves variation while preventing a low-ranked incoherent action from
 * winning a full-list lottery.
 */
export function nearTopSeededSoftmax(evaluations = [], {
  seed = "tavern-ecology",
  nearTopWindow = DEFAULT_ECOLOGY_SELECTION_POLICY.nearTopWindow,
  temperature = DEFAULT_ECOLOGY_SELECTION_POLICY.temperature,
} = {}) {
  const feasibleCandidates = evaluations.filter((candidate) => candidate?.feasible);
  const highestPriorityTier = feasibleCandidates.reduce(
    (highest, candidate) => Math.max(
      highest,
      finite(candidate.genericPriorityTier ?? candidate.priorityTier),
    ),
    0,
  );
  const feasible = feasibleCandidates
    .filter((candidate) => (
      finite(candidate.genericPriorityTier ?? candidate.priorityTier) === highestPriorityTier
    ))
    .sort((left, right) => (
      finite(right.activationScore) - finite(left.activationScore)
      || String(left.candidateId).localeCompare(String(right.candidateId))
    ));
  if (!feasible.length) {
    return {
      seed: String(seed),
      nearTopWindow: round(Math.max(0, finite(nearTopWindow))),
      temperature: round(Math.max(0.01, finite(temperature, 4.5))),
      selectedCandidateId: null,
      randomDraw: null,
      pool: [],
    };
  }

  const window = Math.max(0, finite(nearTopWindow, 10));
  const heat = Math.max(0.01, finite(temperature, 4.5));
  const topScore = finite(feasible[0].activationScore);
  const nearTop = feasible.filter((candidate) => finite(candidate.activationScore) >= topScore - window);
  const exponentials = nearTop.map((candidate) => Math.exp((finite(candidate.activationScore) - topScore) / heat));
  const denominator = exponentials.reduce((sum, value) => sum + value, 0) || 1;
  const probabilities = exponentials.map((value) => value / denominator);
  const seedMaterial = `${seed}|${nearTop.map((candidate) => candidate.candidateId).join("|")}`;
  const randomDraw = seededUnitInterval(seedMaterial);
  let cumulative = 0;
  let selectedIndex = nearTop.length - 1;
  for (let index = 0; index < nearTop.length; index += 1) {
    cumulative += probabilities[index];
    if (randomDraw < cumulative) {
      selectedIndex = index;
      break;
    }
  }

  return {
    seed: String(seed),
    nearTopWindow: round(window),
    temperature: round(heat),
    selectedCandidateId: nearTop[selectedIndex].candidateId,
    randomDraw: round(randomDraw, 6),
    pool: nearTop.map((candidate, index) => ({
      candidateId: candidate.candidateId,
      score: round(candidate.activationScore),
      probability: round(probabilities[index], 6),
      selected: index === selectedIndex,
    })),
  };
}

function desireMapFrom({ desire, desires }) {
  const collection = Array.isArray(desires) && desires.length ? desires : desire ? [desire] : [];
  return new Map(collection.filter(Boolean).map((item) => [String(item.id || ""), item]));
}

function desireForCandidate(candidate, defaultDesire, desireMap) {
  if (candidate?.desire && typeof candidate.desire === "object") return candidate.desire;
  if (candidate?.driveId && desireMap.has(String(candidate.driveId))) return desireMap.get(String(candidate.driveId));
  return defaultDesire || {};
}

/**
 * Pure tavern ecology entry point. It neither mutates world state nor writes an
 * agent memory. observerFactorTrace is deliberately marked observer-only.
 */
export function appraiseTavernEcology({
  character = {},
  bodyState = {},
  currentState = {},
  environment = {},
  desire = null,
  desires = [],
  intention = null,
  candidates = [],
  relationships = [],
  pendingInteractions = [],
  recentActions = [],
  weights = {},
  selectionPolicy = {},
  seed = "tavern-ecology",
} = {}) {
  const desireMap = desireMapFrom({ desire, desires });
  const defaultDesire = desire || (Array.isArray(desires) ? desires[0] : null) || {};
  const legacyEvaluations = candidates.map((candidate) => evaluateEcologyCandidate({
    candidate,
    character,
    desire: desireForCandidate(candidate, defaultDesire, desireMap),
    bodyState,
    currentState,
    environment,
    intention,
    weights,
  }));
  const resolvedWeights = resolveEcologyWeights(character, weights);
  const genericAppraisal = scoreActionCandidates({
    actor: {
      id: character.id,
      traits: character.traits || character.personality || character.ecologyProfile?.traits || {},
      state: {
        fatigue: firstFinite(bodyState.fatigue, 100 - finite(bodyState.stamina, 100)),
        hunger: bodyState.hunger,
        pain: bodyState.pain,
        arousal: firstFinite(currentState.arousal, currentState.affect?.arousal, currentState.emotionalIntensity),
        traumaActivation: firstFinite(currentState.traumaActivation, currentState.triggerActivation),
      },
      weights: {
        desire: resolvedWeights.activation.desireFit,
        duty: resolvedWeights.activation.dutyPressure,
        opportunity: resolvedWeights.activation.opportunity,
        relationshipPull: resolvedWeights.activation.socialPull * 2.25,
        emotionalPull: resolvedWeights.activation.emotionalPull,
        traumaDrive: resolvedWeights.activation.emotionalPull,
        bodyReward: resolvedWeights.activation.bodyReward,
        commitmentPressure: resolvedWeights.activation.dutyPressure,
        commitmentPriority: 12,
        safetyCost: resolvedWeights.activation.obstacleResistance,
        bodyCost: resolvedWeights.activation.bodyCost,
        environmentFriction: resolvedWeights.activation.obstacleResistance,
        socialInhibition: resolvedWeights.activation.obstacleResistance,
        relationshipHarmCost: resolvedWeights.activation.socialPull * 1.5,
        switchingCost: resolvedWeights.activation.switchingCost,
        repetitionPenalty: resolvedWeights.activation.repetitionPenalty,
      },
    },
    candidates: candidates.map((candidate, index) => {
      const legacy = legacyEvaluations[index];
      return {
        id: legacy.candidateId,
        actionKind: candidate.actionKind,
        targetActorId: candidate.targetCharacterId || candidate.targetId || "",
        respondsToRequestId: candidate.respondsToRequestId || "",
        priorityClass: candidate.priorityClass || "",
        obligationPriority: candidate.obligationPriority ?? 0,
        waitingOnly: candidate.waitingOnly === true,
        feasible: legacy.feasible,
        hardGates: legacy.hardGates,
        factors: {
          desire: legacy.desirePressure.score * legacy.expectedSatisfaction / 10_000,
          duty: clamp(candidate.dutyPressure) / 100,
          opportunity: clamp(candidate.opportunity) / 100,
          relationshipPull: clamp(candidate.socialPull) / 100,
          emotionalPull: clamp(candidate.emotionalPull) / 100,
          traumaDrive: clamp(candidate.traumaDrive) / 100,
          bodyReward: legacy.bodyAppraisal.rewardScore / 100,
          commitmentPressure: clamp(candidate.commitmentPressure) / 100,
          safetyCost: clamp(candidate.safetyCost) / 100,
          bodyCost: legacy.bodyAppraisal.costScore / 100,
          environmentFriction: legacy.obstacleResistance.score / 100,
          socialInhibition: clamp(candidate.socialInhibition) / 100,
          relationshipHarmCost: clamp(candidate.relationshipHarmCost) / 100,
          switchingCost: legacy.intentionContinuity.switchingCost / 100,
          repetitionPenalty: clamp(candidate.repetitionPenalty) / 100,
        },
      };
    }),
    context: {
      atmosphere: environment.atmosphere || {},
      relationships: relationshipsForGenericUtility(relationships),
      pendingInteractions,
      recentActions,
      currentIntention: intention,
    },
  });
  const genericById = new Map((genericAppraisal.evaluations || []).map((row) => [row.candidateId, row]));
  const evaluations = legacyEvaluations.map((legacy) => {
    const generic = genericById.get(legacy.candidateId);
    if (!generic) return legacy;
    return {
      ...legacy,
      activationScore: generic.feasible ? round(clamp(20 + generic.score * 50)) : 0,
      genericUtilityScore: generic.score,
      genericPriorityTier: generic.priorityTier,
      factorLedger: generic.factorLedger,
    };
  });
  const highestPriorityTier = Math.max(0, ...evaluations
    .filter((candidate) => candidate.feasible)
    .map((candidate) => Number(candidate.genericPriorityTier || 0)));
  const selectionPool = highestPriorityTier > 0
    ? evaluations.filter((candidate) => (
      !candidate.feasible || Number(candidate.genericPriorityTier || 0) === highestPriorityTier
    ))
    : evaluations;
  const characterOwnsSelection = selectionPolicy?.selectCandidate === false
    || selectionPolicy?.authority === "character-agent";
  const selection = characterOwnsSelection
    ? {
      authority: "character-agent",
      seed: String(seed),
      nearTopWindow: round(Math.max(0, finite(selectionPolicy?.nearTopWindow, DEFAULT_ECOLOGY_SELECTION_POLICY.nearTopWindow))),
      temperature: round(Math.max(0.01, finite(selectionPolicy?.temperature, DEFAULT_ECOLOGY_SELECTION_POLICY.temperature))),
      selectedCandidateId: null,
      randomDraw: null,
      pool: selectionPool
        .filter((candidate) => candidate.feasible)
        .sort((left, right) => (
          finite(right.genericPriorityTier) - finite(left.genericPriorityTier)
          || finite(right.activationScore) - finite(left.activationScore)
          || String(left.candidateId).localeCompare(String(right.candidateId))
        ))
        .map((candidate) => ({
          candidateId: candidate.candidateId,
          score: round(candidate.activationScore),
          probability: null,
          selected: false,
        })),
    }
    : {
      authority: "private-mathematical-tool",
      ...nearTopSeededSoftmax(selectionPool, {
        ...DEFAULT_ECOLOGY_SELECTION_POLICY,
        ...selectionPolicy,
        seed,
      }),
    };
  const selectedCandidate = evaluations.find(
    (candidate) => candidate.candidateId === selection.selectedCandidateId,
  ) || null;

  const observerFactorTrace = {
    schemaVersion: 1,
    formulaVersion: ECOLOGY_APPRAISAL_VERSION,
    actionUtilityFormulaVersion: genericAppraisal.formulaVersion,
    visibility: "observer-only",
    excludedFromAgentMemory: true,
    characterId: compactText(character.id),
    characterName: compactText(character.name),
    environment: {
      locationId: compactText(environment.locationId),
      zoneId: compactText(environment.zoneId),
      timeOfDay: compactText(environment.timeOfDay),
      atmosphere: isPlainObject(environment.atmosphere) ? { ...environment.atmosphere } : {},
    },
    candidates: evaluations.map((candidate) => ({
      candidateId: candidate.candidateId,
      label: candidate.label,
      feasible: candidate.feasible,
      activationScore: candidate.activationScore,
      ungatedScore: candidate.ungatedScore,
      blockedBy: [...candidate.blockedBy],
      hardGates: candidate.hardGates.map((gate) => ({ ...gate })),
      desirePressure: candidate.desirePressure,
      bodyAppraisal: candidate.bodyAppraisal,
      obstacleResistance: candidate.obstacleResistance,
      intentionContinuity: candidate.intentionContinuity,
      positiveFactors: candidate.positiveFactors,
      negativeFactors: candidate.negativeFactors,
      factorLedger: candidate.factorLedger || [],
      genericUtilityScore: candidate.genericUtilityScore,
      genericPriorityTier: candidate.genericPriorityTier,
    })),
    selection,
    highestPriorityTier,
  };

  return {
    formulaVersion: ECOLOGY_APPRAISAL_VERSION,
    actionUtilityFormulaVersion: genericAppraisal.formulaVersion,
    characterId: compactText(character.id),
    selectedCandidateId: selection.selectedCandidateId,
    selectedCandidate,
    candidates: evaluations,
    selection,
    observerFactorTrace,
  };
}
