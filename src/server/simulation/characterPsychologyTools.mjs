/**
 * Character-owned psychology instruments.
 *
 * These pure functions turn a Character Agent's subjective appraisal and
 * authored parameter profile into private pressures. They never originate or
 * select an action, prescribe an expression mode, write dialogue, or resolve
 * the world. The same Character Agent owns appraisal, candidate generation,
 * regulation choice, final choice, embodiment, and literal speech.
 */

import { isConversationTurnTakingOnlyKind } from "./characterSharedActivity.mjs";
import { validateCapabilityActionBinding } from "./physicalActionContract.mjs";

export const CHARACTER_PSYCHOLOGY_TOOLS_VERSION = "character-psychology-tools-v2.6";

export const CHARACTER_DESIRE_RELATION_TYPES = Object.freeze([
  "direct_contact",
  "enable",
  "probe",
  "defer",
  "avoid",
  "substitute",
  "unrelated",
]);

export const CHARACTER_DESIRE_CRITERION_PROMOTION_MODES = Object.freeze([
  "monitor",
  "current_concern",
]);

export const CHARACTER_DESIRE_CRITERION_USE_TYPES = Object.freeze([
  "verify",
  "protect",
  "advance",
  "avoid_invalidation",
]);

export const CHARACTER_DESIRE_CRITERION_STATE_FACTORS = Object.freeze([
  "body",
  "relationship",
  "role",
  "commitment",
  "personality",
  "memory",
  "current_activity",
  "immediate_risk",
  "other",
]);

/**
 * A Character may use different evidence standards for different questions.
 * Identity, ability and intent are deliberately separate: uncertainty in one
 * domain must not silently spread into every other domain.
 */
export const CHARACTER_EPISTEMIC_DOMAINS = Object.freeze([
  "identity",
  "ability",
  "intent",
  "claim",
  "location",
  "object_state",
  "relationship",
  "event",
  "other",
]);

export const CHARACTER_EPISTEMIC_STATUSES = Object.freeze([
  "settled",
  "provisional",
  "suspended",
  "rejected",
  "unknown",
]);

export const CHARACTER_EPISTEMIC_WORKING_STANCES = Object.freeze([
  "rely_as_settled",
  "provisional_for_reversible_action",
  "verify_before_reliance",
  "withhold_final_judgment",
  "reject_for_action",
]);

export const CHARACTER_EPISTEMIC_RELIANCE_SCOPES = Object.freeze([
  "none",
  "low_cost_reversible",
  "ordinary_reversible",
  "high_cost",
  "irreversible",
  "final_judgment",
]);

export const CHARACTER_EPISTEMIC_ACTION_MODES = Object.freeze([
  "not_relevant",
  "rely_provisionally",
  "verify_while_acting",
  "verify_before_acting",
  "suspend_and_continue",
  "avoid_due_to_uncertainty",
  "act_against_belief",
  "exploit_ambiguity",
]);

const CHARACTER_EPISTEMIC_ACTION_PARAMETERS = Object.freeze({
  not_relevant: { reliance: 0, verification: 0, delay: 0 },
  rely_provisionally: { reliance: 0.78, verification: 0.08, delay: 0.04 },
  verify_while_acting: { reliance: 0.62, verification: 0.88, delay: 0.14 },
  verify_before_acting: { reliance: 0.1, verification: 0.96, delay: 1 },
  suspend_and_continue: { reliance: 0.18, verification: 0.18, delay: 0.34 },
  avoid_due_to_uncertainty: { reliance: 0.04, verification: 0.12, delay: 0.86 },
  act_against_belief: { reliance: 0.92, verification: 0.04, delay: 0.04 },
  exploit_ambiguity: { reliance: 0.58, verification: 0.28, delay: 0.08 },
});

const CHARACTER_DESIRE_RELATION_CAPS = Object.freeze({
  direct_contact: 1,
  enable: 0.58,
  probe: 0.24,
  defer: 0.04,
  avoid: -0.32,
  substitute: 0.08,
  unrelated: 0,
});

export const CHARACTER_CONTINUATION_TRIGGER_TYPES = Object.freeze([
  "target_response",
  "target_attention_confirmed",
  "new_relevant_evidence",
  "own_action_settled",
  "elapsed_without_progress",
  "internal_pressure",
  "opportunity_window",
]);

export const CHARACTER_PSYCHOLOGY_EMOTION_IDS = Object.freeze([
  "surprise",
  "curiosity",
  "anticipation",
  "excitement",
  "joy",
  "pride",
  "affection",
  "wariness",
  "fear",
  "irritation",
  "anger",
  "shame",
  "guilt",
  "disappointment",
  "sadness",
  "aversion",
]);

export const CHARACTER_PSYCHOLOGY_LEAKAGE_CHANNELS = Object.freeze([
  "gaze",
  "attentionLock",
  "responseLatency",
  "breath",
  "voiceOnset",
  "pace",
  "pitch",
  "volume",
  "lexicalSharpness",
  "movementInterruption",
  "posture",
  "handTension",
  "objectHandling",
  "orientation",
  "proximity",
]);

export const CHARACTER_PSYCHOLOGY_REGULATION_STRATEGIES = Object.freeze([
  "suppress",
  "reappraise",
  "delay",
  "redirect",
  "conceal",
  "express",
  "seek_support",
  "disengage",
  "tolerate",
]);

export const PSYCHOLOGY_TOOL_FORBIDDEN_KEYS = Object.freeze([
  "selectedCandidateId",
  "chosenAction",
  "chosenActionId",
  "actionAttempt",
  "expressionStrategy",
  "expressionMode",
  "communicationPlan",
  "tactic",
  "disclosureChoice",
  "literalSpeech",
  "suggestedLine",
  "shouldSay",
  "visibleAction",
  "intendedGesture",
  "worldOutcome",
  "relationshipDeltaAsFact",
]);

export const CHARACTER_AGENT_EXCLUSIVE_FIELDS = Object.freeze([
  "noticedEvidenceIds",
  "interpretations",
  "beliefOperations",
  "epistemicPositions",
  "generatedCandidates",
  "selectedCandidateId",
  "regulationChoice",
  "communicationPlan",
  "speechRealizationPlan",
  "embodiedIntent",
  "utterance",
  "actionAttempt",
]);

const APPRAISAL_AXIS_IDS = Object.freeze([
  "selfRelevance",
  "goalCongruence",
  "novelty",
  "expectedness",
  "opportunityValue",
  "threat",
  "controllability",
  "changeability",
  "certaintyDelta",
  "normCompatibility",
  "selfImageCongruence",
  "publicExposure",
]);

const RELATIONSHIP_MEANING_IDS = Object.freeze([
  "affiliation",
  "status",
  "trust",
  "rejection",
  "care",
  "betrayal",
]);

const CANDIDATE_POSITIVE_FACTORS = Object.freeze([
  "goalProgress",
  "enablingProgress",
  "probeProgress",
  "emotionCompatibility",
  "valueAndSelfImage",
  "relationshipMeaning",
  "informationGain",
  "habitAndIntentionContinuity",
]);

const CANDIDATE_NEGATIVE_FACTORS = Object.freeze([
  "bodyCost",
  "threatAndNormCost",
  "exposureAndRelationshipRisk",
  "opportunityAndSwitchingCost",
  "uncertaintyCost",
  "proxySubstitution",
  "perceivedFeasibilityRisk",
]);

const CANDIDATE_LEARNING_POSITIVE_FACTORS = Object.freeze([
  "continuationIntentionMaturity",
  "epistemicLearningValue",
]);

const CANDIDATE_LEARNING_NEGATIVE_FACTORS = Object.freeze([
  "repetitionWithoutGain",
  "negativePredictionError",
  "epistemicRisk",
  "epistemicDelayCost",
]);

const DEFAULT_CANDIDATE_WEIGHTS = Object.freeze({
  goalProgress: 1,
  enablingProgress: 0.62,
  probeProgress: 0.28,
  emotionCompatibility: 0.72,
  valueAndSelfImage: 0.9,
  relationshipMeaning: 0.82,
  informationGain: 0.78,
  habitAndIntentionContinuity: 0.64,
  bodyCost: 0.84,
  threatAndNormCost: 1,
  exposureAndRelationshipRisk: 0.92,
  opportunityAndSwitchingCost: 0.68,
  uncertaintyCost: 0.74,
  proxySubstitution: 1.06,
  perceivedFeasibilityRisk: 0.88,
  continuationIntentionMaturity: 0.72,
  epistemicLearningValue: 0.64,
  repetitionWithoutGain: 0.92,
  negativePredictionError: 0.58,
  epistemicRisk: 0.92,
  epistemicDelayCost: 0.7,
});

const DEFAULT_BEHAVIOR_LEARNING = Object.freeze({
  noGainThreshold: 0.14,
  goalProgressThreshold: 0.08,
  feedbackLearningRate: 0.72,
  repetitionSensitivity: 0.68,
  predictionErrorSensitivity: 0.66,
  persistenceInsulation: 0.5,
  compulsiveRepetitionBias: 0,
  continuationCommitmentWeight: 0.62,
  regulationDebtSensitivity: 0.58,
});

const DEFAULT_EMOTION_MODELS = Object.freeze({
  surprise: {
    baseline: -1.9,
    appraisalWeights: { novelty: 1.15, expectedness: -0.82, certaintyDelta: 0.28 },
  },
  curiosity: {
    baseline: -1.65,
    appraisalWeights: { novelty: 0.62, opportunityValue: 0.58, selfRelevance: 0.38 },
    uncertaintyWeight: 0.42,
    desireWeight: 0.18,
  },
  anticipation: {
    baseline: -1.72,
    appraisalWeights: { goalCongruence: 0.68, opportunityValue: 0.82, certaintyDelta: 0.24 },
    desireWeight: 0.42,
  },
  excitement: {
    baseline: -1.95,
    appraisalWeights: { goalCongruence: 0.78, opportunityValue: 0.72, novelty: 0.38 },
    desireWeight: 0.56,
    moodArousalWeight: 0.3,
  },
  joy: {
    baseline: -2.05,
    appraisalWeights: { goalCongruence: 1.08, opportunityValue: 0.32 },
    desireWeight: 0.28,
    moodValenceWeight: 0.35,
  },
  pride: {
    baseline: -2.05,
    appraisalWeights: { selfImageCongruence: 0.92, selfRelevance: 0.38 },
    relationshipWeights: { status: 0.52 },
    desireWeight: 0.24,
  },
  affection: {
    baseline: -2.1,
    appraisalWeights: { goalCongruence: 0.2 },
    relationshipWeights: { affiliation: 0.72, care: 0.88, trust: 0.54 },
  },
  wariness: {
    baseline: -1.68,
    appraisalWeights: { threat: 0.82, publicExposure: 0.34, controllability: -0.22 },
    relationshipWeights: { rejection: 0.22, betrayal: 0.36, trust: -0.2 },
    uncertaintyWeight: 0.62,
    bodyWeights: { fatigue: 0.18, pain: 0.16 },
  },
  fear: {
    baseline: -2.05,
    appraisalWeights: { threat: 1.18, controllability: -0.52, changeability: -0.18 },
    relationshipWeights: { betrayal: 0.26 },
    uncertaintyWeight: 0.24,
    bodyWeights: { fatigue: 0.2, pain: 0.28 },
  },
  irritation: {
    baseline: -2,
    appraisalWeights: { goalCongruence: -0.72, normCompatibility: -0.24, controllability: 0.18 },
    desireWeight: 0.34,
    bodyWeights: { fatigue: 0.3, pain: 0.26 },
  },
  anger: {
    baseline: -2.22,
    appraisalWeights: { goalCongruence: -0.88, threat: 0.38, normCompatibility: -0.4, controllability: 0.28 },
    relationshipWeights: { betrayal: 0.72, rejection: 0.28 },
    desireWeight: 0.28,
  },
  shame: {
    baseline: -2.12,
    appraisalWeights: { selfImageCongruence: -1.08, publicExposure: 0.86, selfRelevance: 0.34 },
    relationshipWeights: { status: 0.24, rejection: 0.4 },
  },
  guilt: {
    baseline: -2.3,
    appraisalWeights: { normCompatibility: -1.02, selfImageCongruence: -0.46 },
    relationshipWeights: { care: 0.28, affiliation: 0.18 },
  },
  disappointment: {
    baseline: -2.02,
    appraisalWeights: { goalCongruence: -0.96, opportunityValue: 0.34, certaintyDelta: -0.18 },
    desireWeight: 0.42,
  },
  sadness: {
    baseline: -2.28,
    appraisalWeights: { goalCongruence: -0.82, controllability: -0.34, changeability: -0.44 },
    relationshipWeights: { care: 0.24, affiliation: 0.18 },
    desireWeight: 0.28,
  },
  aversion: {
    baseline: -2.12,
    appraisalWeights: { normCompatibility: -0.72, threat: 0.52, goalCongruence: -0.34 },
    relationshipWeights: { betrayal: 0.32 },
  },
});

const DEFAULT_LEAKAGE_MODELS = Object.freeze({
  gaze: { curiosity: 0.32, anticipation: 0.24, wariness: 0.2, shame: 0.16 },
  attentionLock: { curiosity: 0.4, anticipation: 0.34, excitement: 0.28, wariness: 0.2 },
  responseLatency: { surprise: 0.34, wariness: 0.25, shame: 0.24, disappointment: 0.16 },
  breath: { excitement: 0.26, fear: 0.4, anger: 0.25, shame: 0.18 },
  voiceOnset: { surprise: 0.28, excitement: 0.2, wariness: 0.2, shame: 0.2 },
  pace: { excitement: 0.34, fear: 0.24, irritation: 0.22, anger: 0.32 },
  pitch: { excitement: 0.2, fear: 0.3, anger: 0.16, shame: 0.16 },
  volume: { excitement: 0.16, irritation: 0.24, anger: 0.42, fear: -0.1 },
  lexicalSharpness: { wariness: 0.18, irritation: 0.38, anger: 0.42, aversion: 0.24 },
  movementInterruption: { surprise: 0.34, curiosity: 0.2, fear: 0.22, disappointment: 0.18 },
  posture: { pride: 0.18, fear: 0.26, shame: 0.32, anger: 0.2 },
  handTension: { excitement: 0.18, wariness: 0.28, fear: 0.3, anger: 0.3 },
  objectHandling: { excitement: 0.14, wariness: 0.2, irritation: 0.22, shame: 0.16 },
  orientation: { curiosity: 0.28, anticipation: 0.22, wariness: 0.24, aversion: -0.12 },
  proximity: { affection: 0.24, anticipation: 0.18, fear: -0.28, aversion: -0.32 },
});

const STRATEGY_COSTS = Object.freeze({
  suppress: 0.58,
  reappraise: 0.36,
  delay: 0.28,
  redirect: 0.34,
  conceal: 0.48,
  express: 0.14,
  seek_support: 0.22,
  disengage: 0.3,
  tolerate: 0.24,
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, finite(value)));
}

function signed(value, fallback = 0) {
  let number = finite(value, fallback);
  if (Math.abs(number) > 1 && Math.abs(number) <= 100) number /= 100;
  return clamp(number, -1, 1);
}

function unit(value, fallback = 0) {
  let number = finite(value, fallback);
  if (Math.abs(number) > 1 && Math.abs(number) <= 100) number /= 100;
  return clamp(number);
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round((finite(value) + Number.EPSILON) * scale) / scale;
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-finite(value)));
}

function clean(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function issue(code, path, message, evidence = undefined) {
  return { code, path, message, ...(evidence === undefined ? {} : { evidence }) };
}

function asSet(values = []) {
  return new Set((values || []).map(clean).filter(Boolean));
}

function unique(values = []) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function criterionPathRows(value, path = "criteria", rows = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => criterionPathRows(item, `${path}.${index}`, rows));
    return rows;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value).sort()) {
      criterionPathRows(value[key], `${path}.${key}`, rows);
    }
    return rows;
  }
  rows.push({ path, requirement: structuredClone(value) });
  return rows;
}

/**
 * Give authored terminal conditions stable private handles. A criterion is an
 * acceptance condition for the desire, not an action instruction. It may only
 * originate a present candidate after the Character Agent explicitly promotes
 * it in this turn.
 */
export function deriveDesireCriterionLedger(desires = []) {
  return (Array.isArray(desires) ? desires : []).flatMap((desire) => {
    const desireId = clean(desire?.desireId || desire?.id);
    if (!desireId) return [];
    const condition = safeRecord(desire?.authoredSatisfactionCondition || desire?.satisfactionCondition);
    const criteria = safeRecord(condition.criteria);
    return criterionPathRows(criteria).map(({ path, requirement }) => ({
      authority: "character-private-terminal-contract",
      criterionId: `criterion:${desireId}:${path}`,
      desireId,
      authoredPath: `satisfactionCondition.${path}`,
      requirement,
      defaultCandidateRole: "terminal_evaluation_only",
    }));
  });
}

function axis(appraisal = {}, id) {
  return signed(appraisal.appraisalAxes?.[id]);
}

function relationshipAxis(appraisal = {}, id) {
  return signed(appraisal.appraisalAxes?.relationshipMeaning?.[id]);
}

function bodyValue(state = {}, id) {
  return unit(state.body?.[id] ?? state[id]);
}

function emotionMap(snapshot = {}) {
  return Object.fromEntries((snapshot.emotionMixture || []).map((row) => [row.emotionId, unit(row.value)]));
}

function safeRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function behaviorLearningProfile(profile = {}) {
  const authored = safeRecord(profile.behaviorLearning);
  return Object.fromEntries(Object.entries(DEFAULT_BEHAVIOR_LEARNING).map(([id, fallback]) => [
    id,
    unit(authored[id], fallback),
  ]));
}

function candidateLinkedSourceIds(candidate = {}) {
  return unique((candidate.expectedEffects || []).map((effect) => effect?.sourceId)).sort();
}

function candidateDesireRelationSignature(candidate = {}) {
  return (candidate.desireRelations || [])
    .map((row) => `${clean(row?.desireId)}:${clean(row?.relation)}`)
    .filter((row) => !row.startsWith(":"))
    .sort()
    .join(",") || "untyped-relation";
}

function candidateSharedActivitySignature(candidate = {}) {
  const activity = safeRecord(candidate.sharedActivity);
  return [clean(activity.operation), clean(activity.kind), clean(activity.activityId)]
    .filter(Boolean)
    .join(":") || "no-shared-activity";
}

/**
 * A paraphrased candidate id is not an action history. This signature keeps the
 * means, target and owned motive sources stable across model calls while
 * deliberately excluding wording and stage-local ids.
 */
export function characterActionLearningSignature(candidate = {}) {
  return [
    clean(candidate.attemptPrimitive) || "none",
    clean(candidate.targetHandle) || "no-target",
    unique(candidate.domains || []).sort().join(",") || "no-domain",
    candidateDesireRelationSignature(candidate),
    candidateSharedActivitySignature(candidate),
  ].join("|");
}

function continuationIntentionMatchesCandidate(intention = {}, candidate = {}) {
  const intendedPrimitive = clean(intention.intendedPrimitive);
  const intendedTarget = clean(intention.targetHandle);
  const linkedSources = unique(intention.linkedSourceIds || []);
  if (intendedPrimitive && intendedPrimitive !== clean(candidate.attemptPrimitive)) return false;
  if (intendedTarget && intendedTarget !== clean(candidate.targetHandle)) return false;
  if (linkedSources.length && !linkedSources.some((id) => candidateLinkedSourceIds(candidate).includes(id))) return false;
  return Boolean(intendedPrimitive || intendedTarget || linkedSources.length);
}

function characterWorldTime(worldProjection = {}, previous = {}) {
  const value = worldProjection.scene?.characterElapsedSeconds
    ?? worldProjection.scene?.elapsedSeconds
    ?? previous.lastCharacterElapsedSeconds
    ?? 0;
  return Math.max(0, finite(value));
}

function outcomeEvidenceSources(worldProjection = {}) {
  return new Map([
    ...(worldProjection.evidence || []),
    ...(worldProjection.perceivedImpacts || []),
  ].map((row) => [
    clean(row?.evidenceId || row?.impactId || row?.id),
    clean(row?.sourceEntityHandle || row?.perceivedSourceCharacterId || row?.sourceCharacterId),
  ]).filter(([id]) => id));
}

function shortFingerprint(value = "") {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function perceivedOutcomeFeatureSignatures(worldProjection = {}, evidenceIds = []) {
  const wanted = new Set(unique(evidenceIds || []));
  const rows = [...(worldProjection.evidence || []), ...(worldProjection.perceivedImpacts || [])]
    .filter((row) => wanted.has(clean(row?.evidenceId || row?.impactId || row?.id)));
  const signatures = [];
  for (const row of rows) {
    const source = clean(row?.sourceEntityHandle || row?.perceivedSourceCharacterId || row?.sourceCharacterId || "self-or-scene");
    const observation = safeRecord(row?.semanticFrame?.observationResult);
    if (Object.keys(observation).length) {
      const features = Array.isArray(observation.observableFeatures) ? observation.observableFeatures : [];
      if (!features.length) {
        signatures.push(`feature:${shortFingerprint(`${source}|observation:none|${unique(observation.attentionTags || []).sort().join(",")}`)}`);
      } else {
        for (const feature of features) {
          signatures.push(`feature:${shortFingerprint([
            source,
            "observation",
            clean(feature?.kind),
            clean(feature?.text),
            unique(feature?.domainTags || []).sort().join(","),
          ].join("|"))}`);
        }
      }
      continue;
    }
    const actionResult = safeRecord(row?.semanticFrame?.actionResult);
    if (Object.keys(actionResult).length) {
      signatures.push(`feature:${shortFingerprint([
        source,
        "own-action-result",
        clean(actionResult.status),
        clean(actionResult.primitive),
        unique(actionResult.failureCodes || []).sort().join(","),
        unique(actionResult.resolvedEffectKinds || []).sort().join(","),
      ].join("|"))}`);
      continue;
    }
    signatures.push(`feature:${shortFingerprint([
      source,
      clean(row?.eventKind || row?.type || row?.actionKind),
      clean(row?.content),
      clean(row?.topic),
    ].join("|"))}`);
  }
  return unique(signatures);
}

function priorPerceivedOutcomeFeatureSignatures(previous = {}) {
  return new Set(unique((previous.actionLearningHistory || []).flatMap((row) => (
    row?.noticedOutcomeFeatureSignatures || []
  ))));
}

function intentionMaturity(intention = {}, appraisal = {}, worldProjection = {}, previous = {}) {
  const noticed = new Set(unique(appraisal.noticedEvidenceIds || []));
  const baseline = new Set(unique(intention.baselineEvidenceIds || []));
  const novelEvidenceIds = [...noticed].filter((id) => !baseline.has(id));
  const evidenceSources = outcomeEvidenceSources(worldProjection);
  const targetHandle = clean(intention.targetHandle);
  const sourceMatchedEvidence = novelEvidenceIds.filter((id) => !targetHandle || evidenceSources.get(id) === targetHandle);
  const currentTime = characterWorldTime(worldProjection, previous);
  const ageSeconds = Math.max(0, currentTime - finite(intention.createdAtCharacterSeconds));
  const minimumDelaySeconds = Math.max(0, finite(intention.minimumDelaySeconds));
  const delayMaturity = minimumDelaySeconds > 0 ? clamp(ageSeconds / minimumDelaySeconds) : 1;
  const threshold = unit(intention.triggerThreshold, 0.5);
  const internalPressure = unit(previous.internalWakePressure);
  const opportunity = Math.max(0, axis(appraisal, "opportunityValue"));
  const triggerType = clean(intention.triggerType);
  let maturity = 0;
  let evidenceIds = [];
  let reason = "trigger_not_perceived";
  if (triggerType === "target_response" || triggerType === "target_attention_confirmed") {
    evidenceIds = sourceMatchedEvidence;
    maturity = sourceMatchedEvidence.length ? 1 : 0;
    reason = maturity ? "new_target_originated_evidence_perceived" : reason;
  } else if (triggerType === "new_relevant_evidence") {
    evidenceIds = novelEvidenceIds;
    const relevance = Math.max(0, ...(appraisal.relevanceLinks || []).map((row) => unit(row?.strength) * unit(row?.confidence, 1)));
    maturity = novelEvidenceIds.length ? Math.max(relevance, 0.5) : 0;
    reason = maturity ? "new_relevant_evidence_perceived" : reason;
  } else if (triggerType === "own_action_settled") {
    const settled = clean(worldProjection.activationCause?.type) === "own_action_settled"
      && (worldProjection.activationCause?.continuationIntentionIds || [])
        .map(clean)
        .includes(clean(intention.intentionId));
    maturity = settled ? 1 : 0;
    reason = settled ? "owned_action_objectively_settled" : reason;
  } else if (triggerType === "elapsed_without_progress") {
    maturity = delayMaturity;
    reason = minimumDelaySeconds > 0 && ageSeconds >= minimumDelaySeconds
      ? "authored_delay_elapsed"
      : "authored_delay_not_elapsed";
  } else if (triggerType === "internal_pressure") {
    maturity = internalPressure;
    reason = maturity >= threshold ? "internal_pressure_reached" : "internal_pressure_below_threshold";
  } else if (triggerType === "opportunity_window") {
    maturity = opportunity;
    reason = maturity >= threshold ? "opportunity_appraised" : "opportunity_below_threshold";
  }
  return {
    ...structuredClone(intention),
    ageSeconds: round(ageSeconds),
    maturity: round(maturity),
    threshold: round(threshold),
    mature: triggerType === "elapsed_without_progress"
      ? minimumDelaySeconds > 0 && ageSeconds >= minimumDelaySeconds
      : maturity >= threshold,
    evidenceIds,
    reason,
  };
}

/**
 * Reconcile an earlier prediction with what the same Character Agent now says
 * it actually perceived. Objective resolution remains evidence; it does not get
 * to write satisfaction, progress or failure into the person's mind.
 */
export function reconcileCharacterPerceivedOutcome({
  appraisal = {},
  previous = {},
  profile = {},
  worldProjection = {},
} = {}) {
  if (appraisal.ownerAuthority !== "character-agent") {
    const error = new Error("Perceived outcome reconciliation requires Character-Agent-authored appraisal.");
    error.code = "CHARACTER_OUTCOME_APPRAISAL_AUTHORITY_REQUIRED";
    throw error;
  }
  const forecast = safeRecord(previous.pendingActionForecast);
  const report = safeRecord(appraisal.priorActionOutcomeAppraisal);
  const learning = behaviorLearningProfile(profile);
  const hasForecast = Boolean(clean(forecast.sourceAgentTurnId));
  const reportedPerceivedInformationGain = hasForecast ? unit(report.perceivedInformationGain) : 0;
  const noticedOutcomeFeatureSignatures = hasForecast
    ? perceivedOutcomeFeatureSignatures(worldProjection, report.noticedOutcomeEvidenceIds || [])
    : [];
  const priorFeatureSignatures = priorPerceivedOutcomeFeatureSignatures(previous);
  const novelFeatureCount = noticedOutcomeFeatureSignatures.filter((id) => !priorFeatureSignatures.has(id)).length;
  const evidenceNoveltyRatio = noticedOutcomeFeatureSignatures.length
    ? novelFeatureCount / noticedOutcomeFeatureSignatures.length
    : 1;
  const observationRows = [...(worldProjection.evidence || []), ...(worldProjection.perceivedImpacts || [])]
    .filter((row) => (report.noticedOutcomeEvidenceIds || []).map(clean)
      .includes(clean(row?.evidenceId || row?.impactId || row?.id)))
    .map((row) => safeRecord(row?.semanticFrame?.observationResult))
    .filter((row) => Object.keys(row).length);
  const observedNoRelevantDetail = observationRows.length > 0
    && observationRows.every((row) => !(row.observableFeatures || []).length);
  const perceivedInformationGain = hasForecast
    ? observedNoRelevantDetail
      ? Math.min(reportedPerceivedInformationGain, 0.05)
      : reportedPerceivedInformationGain * (0.12 + evidenceNoveltyRatio * 0.88)
    : 0;
  const perceivedGoalProgress = hasForecast ? signed(report.perceivedGoalProgress) : 0;
  const predictedInformationGain = hasForecast ? unit(forecast.predictedInformationGain) : 0;
  const predictedGoalProgress = hasForecast ? signed(forecast.predictedGoalProgress) : 0;
  const currentCharacterSeconds = characterWorldTime(worldProjection, previous);
  const elapsedWithoutProgressSeconds = hasForecast && report.stillUnresolved === true
    ? Math.max(0, currentCharacterSeconds - Math.max(0, finite(forecast.createdAtCharacterSeconds)))
    : 0;
  const noGain = hasForecast
    && report.stillUnresolved === true
    && perceivedInformationGain < learning.noGainThreshold
    && perceivedGoalProgress < learning.goalProgressThreshold;
  const baseUnresolvedPressure = noGain
    ? clamp(
      (learning.noGainThreshold - perceivedInformationGain) * 1.8
      + Math.max(0, learning.goalProgressThreshold - perceivedGoalProgress) * 0.8
      + unit(report.unexpectedness) * 0.2,
    )
    : 0;
  const stagnationPressure = report.stillUnresolved === true
    ? clamp((1 - Math.exp(-elapsedWithoutProgressSeconds / 90)) * learning.repetitionSensitivity * 0.42)
    : 0;
  const opportunityDecayPressure = report.stillUnresolved === true
    ? clamp(
      (1 - Math.exp(-elapsedWithoutProgressSeconds / 120))
      * Math.max(0, axis(appraisal, "opportunityValue"))
      * 0.38,
    )
    : 0;
  const unresolvedPressure = clamp(baseUnresolvedPressure + stagnationPressure + opportunityDecayPressure);
  const continuationIntentions = (previous.continuationIntentions || [])
    .filter((row) => clean(row?.status || "active") === "active")
    .map((row) => intentionMaturity(row, appraisal, worldProjection, previous));
  const result = {
    schemaVersion: CHARACTER_PSYCHOLOGY_TOOLS_VERSION,
    authority: "character-private-psychology-tool",
    sourceAgentTurnId: hasForecast ? clean(forecast.sourceAgentTurnId) : "",
    sourceCandidateId: hasForecast ? clean(forecast.sourceCandidateId) : "",
    semanticSignature: hasForecast ? clean(forecast.semanticSignature) : "",
    status: hasForecast ? clean(report.status || "unclear") : "no_prior_action",
    perceivedInformationGain: round(perceivedInformationGain),
    reportedPerceivedInformationGain: round(reportedPerceivedInformationGain),
    evidenceNoveltyRatio: round(evidenceNoveltyRatio),
    noticedOutcomeFeatureSignatures,
    predictedInformationGain: round(predictedInformationGain),
    informationPredictionError: round(perceivedInformationGain - predictedInformationGain),
    perceivedGoalProgress: round(perceivedGoalProgress),
    predictedGoalProgress: round(predictedGoalProgress),
    goalPredictionError: round(perceivedGoalProgress - predictedGoalProgress),
    perceivedCost: round(hasForecast ? unit(report.perceivedCost) : 0),
    unexpectedness: round(hasForecast ? unit(report.unexpectedness) : 0),
    stillUnresolved: hasForecast && report.stillUnresolved === true,
    noGain,
    unresolvedPressure: round(unresolvedPressure),
    elapsedWithoutProgressSeconds: round(elapsedWithoutProgressSeconds),
    stagnationPressure: round(stagnationPressure),
    opportunityDecayPressure: round(opportunityDecayPressure),
    linkedSourceIds: unique(forecast.linkedSourceIds || []),
    noticedOutcomeEvidenceIds: unique(report.noticedOutcomeEvidenceIds || []),
    summary: clean(report.summary),
    continuationIntentions,
    maturedContinuationIntentions: continuationIntentions.filter((row) => row.mature),
    selection: null,
  };
  return assertPsychologyToolAuthority(result, "reconcileCharacterPerceivedOutcome");
}

function nestedForbiddenAgentProposalFields(value, forbidden, basePath, errors, code) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => nestedForbiddenAgentProposalFields(entry, forbidden, `${basePath}[${index}]`, errors, code));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const path = basePath ? `${basePath}.${key}` : key;
    if (forbidden.has(key)) errors.push(issue(code, path, `Field ${key} does not belong in this stage.`));
    nestedForbiddenAgentProposalFields(child, forbidden, path, errors, code);
  }
}

/** Report any field that would let a private mathematical tool act as the person. */
export function auditCharacterPsychologyToolOutput(output = {}) {
  const issues = [];
  const forbidden = new Set(PSYCHOLOGY_TOOL_FORBIDDEN_KEYS);
  function walk(value, path = "") {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (forbidden.has(key)) {
        issues.push(issue(
          "PSYCHOLOGY_TOOL_FORBIDDEN_FIELD",
          nextPath,
          `A Character Agent psychology tool may not emit ${key}.`,
        ));
      }
      if (key === "selection" && child !== null) {
        issues.push(issue(
          "PSYCHOLOGY_TOOL_SELECTION_NOT_NULL",
          nextPath,
          "A Character Agent psychology tool may evaluate candidates but selection must remain null.",
        ));
      }
      walk(child, nextPath);
    }
  }
  walk(output);
  return { valid: issues.length === 0, issues };
}

function assertPsychologyToolAuthority(output, toolName) {
  const audit = auditCharacterPsychologyToolOutput(output);
  if (!audit.valid) {
    const error = new Error(`${toolName} violated Character Agent authority: ${audit.issues.map((row) => row.path).join(", ")}`);
    error.code = "CHARACTER_PSYCHOLOGY_TOOL_AUTHORITY_VIOLATION";
    error.issues = audit.issues;
    throw error;
  }
  return output;
}

/** Validate an appraisal authored by the Character Agent before tools consume it. */
export function validateCharacterSubjectiveAppraisal(appraisal = {}, context = {}) {
  const errors = [];
  if (!appraisal || typeof appraisal !== "object" || Array.isArray(appraisal)) {
    return { valid: false, errors: [issue("SUBJECTIVE_APPRAISAL_MISSING", "appraisal", "Subjective appraisal must be an object.")] };
  }
  if (appraisal.ownerAuthority !== "character-agent") {
    errors.push(issue("SUBJECTIVE_APPRAISAL_AUTHORITY_INVALID", "ownerAuthority", "Only the Character Agent may author subjective appraisal."));
  }
  if (!clean(appraisal.appraisalId)) errors.push(issue("SUBJECTIVE_APPRAISAL_ID_MISSING", "appraisalId", "Subjective appraisal needs an id."));
  if (clean(context.agentTurnId) && clean(appraisal.agentTurnId) !== clean(context.agentTurnId)) {
    errors.push(issue("SUBJECTIVE_APPRAISAL_TURN_MISMATCH", "agentTurnId", "Subjective appraisal must belong to the active Agent turn."));
  }
  const knownEvidenceIds = asSet(context.knownEvidenceIds);
  const knownTargetHandles = asSet(context.knownTargetHandles);
  const knownSourceIds = asSet(context.knownSourceIds);
  const knownDesireIds = asSet(context.knownDesireIds);
  const criterionLedger = Array.isArray(context.desireCriterionLedger)
    ? context.desireCriterionLedger
    : deriveDesireCriterionLedger(context.desires || []);
  const knownCriterionIds = new Set([
    ...asSet(context.knownCriterionIds),
    ...criterionLedger.map((row) => clean(row?.criterionId)).filter(Boolean),
  ]);
  const criterionIdsByDesire = new Map();
  for (const row of criterionLedger) {
    const desireId = clean(row?.desireId);
    const criterionId = clean(row?.criterionId);
    if (!desireId || !criterionId) continue;
    if (!criterionIdsByDesire.has(desireId)) criterionIdsByDesire.set(desireId, new Set());
    criterionIdsByDesire.get(desireId).add(criterionId);
  }
  for (const [desireId, criterionIds] of Object.entries(context.criterionIdsByDesire || {})) {
    if (!criterionIdsByDesire.has(clean(desireId))) criterionIdsByDesire.set(clean(desireId), new Set());
    for (const criterionId of criterionIds || []) criterionIdsByDesire.get(clean(desireId)).add(clean(criterionId));
  }
  const priorForecast = safeRecord(context.priorActionForecast);
  const outcomeReport = safeRecord(appraisal.priorActionOutcomeAppraisal);
  const evidenceReferences = [
    ...(appraisal.noticedEvidenceIds || []),
    ...(appraisal.interpretations || []).flatMap((row) => row?.evidenceIds || []),
    ...(appraisal.beliefOperations || []).flatMap((row) => row?.sourceEvidenceIds || []),
  ].map(clean).filter(Boolean);
  for (const evidenceId of evidenceReferences) {
    if (knownEvidenceIds.size && !knownEvidenceIds.has(evidenceId)) {
      errors.push(issue(
        "SUBJECTIVE_APPRAISAL_EVIDENCE_UNKNOWN",
        "noticedEvidenceIds",
        `Evidence ${evidenceId} did not reach this Character Agent.`,
      ));
    }
  }
  const epistemicPositions = Array.isArray(appraisal.epistemicPositions)
    ? appraisal.epistemicPositions
    : null;
  if (context.requireEpistemicPositions === true && !epistemicPositions) {
    errors.push(issue(
      "SUBJECTIVE_EPISTEMIC_POSITIONS_MISSING",
      "epistemicPositions",
      "The Character Agent must provide zero or more domain-specific epistemic positions and working stances.",
    ));
  }
  const epistemicPositionIds = new Set();
  for (const [index, position] of (epistemicPositions || []).entries()) {
    const path = `epistemicPositions[${index}]`;
    const positionId = clean(position?.positionId);
    const domain = clean(position?.domain);
    const subjectHandle = clean(position?.subjectHandle);
    if (!positionId || epistemicPositionIds.has(positionId)) {
      errors.push(issue("SUBJECTIVE_EPISTEMIC_POSITION_ID_INVALID", `${path}.positionId`, "Each epistemic position needs a unique id."));
    }
    epistemicPositionIds.add(positionId);
    if (!CHARACTER_EPISTEMIC_DOMAINS.includes(domain)) {
      errors.push(issue("SUBJECTIVE_EPISTEMIC_DOMAIN_INVALID", `${path}.domain`, `Unknown epistemic domain ${domain || "(empty)"}.`));
    }
    if (subjectHandle && knownTargetHandles.size && !knownTargetHandles.has(subjectHandle)) {
      errors.push(issue("SUBJECTIVE_EPISTEMIC_SUBJECT_UNKNOWN", `${path}.subjectHandle`, `Epistemic subject ${subjectHandle} was not available to this Character Agent.`));
    }
    if (!clean(position?.proposition)) errors.push(issue("SUBJECTIVE_EPISTEMIC_PROPOSITION_MISSING", `${path}.proposition`, "An epistemic position needs the Character Agent's private proposition."));
    if (!Number.isFinite(Number(position?.confidence)) || Number(position.confidence) < 0 || Number(position.confidence) > 1) {
      errors.push(issue("SUBJECTIVE_EPISTEMIC_CONFIDENCE_INVALID", `${path}.confidence`, "Epistemic confidence must be between zero and one."));
    }
    if (!CHARACTER_EPISTEMIC_STATUSES.includes(clean(position?.status))) {
      errors.push(issue("SUBJECTIVE_EPISTEMIC_STATUS_INVALID", `${path}.status`, "Unknown epistemic status."));
    }
    if (!CHARACTER_EPISTEMIC_WORKING_STANCES.includes(clean(position?.workingStance))) {
      errors.push(issue("SUBJECTIVE_EPISTEMIC_WORKING_STANCE_INVALID", `${path}.workingStance`, "Unknown working stance."));
    }
    if (!CHARACTER_EPISTEMIC_RELIANCE_SCOPES.includes(clean(position?.relianceScope))) {
      errors.push(issue("SUBJECTIVE_EPISTEMIC_RELIANCE_SCOPE_INVALID", `${path}.relianceScope`, "Unknown epistemic reliance scope."));
    }
    if (!Array.isArray(position?.basisEvidenceIds)) {
      errors.push(issue("SUBJECTIVE_EPISTEMIC_EVIDENCE_MISSING", `${path}.basisEvidenceIds`, "An epistemic position needs zero or more personally noticed evidence ids."));
    }
    for (const evidenceId of unique(position?.basisEvidenceIds || [])) {
      if (knownEvidenceIds.size && !knownEvidenceIds.has(evidenceId)) errors.push(issue("SUBJECTIVE_EPISTEMIC_EVIDENCE_UNKNOWN", `${path}.basisEvidenceIds`, `Epistemic evidence ${evidenceId} did not reach this Character Agent.`));
      if (!(appraisal.noticedEvidenceIds || []).map(clean).includes(evidenceId)) errors.push(issue("SUBJECTIVE_EPISTEMIC_EVIDENCE_NOT_NOTICED", `${path}.basisEvidenceIds`, `Epistemic evidence ${evidenceId} must be personally noticed in this appraisal.`));
    }
    for (const sourceId of unique(position?.basisPsychologicalSourceIds || [])) {
      if (knownSourceIds.size && !knownSourceIds.has(sourceId)) errors.push(issue("SUBJECTIVE_EPISTEMIC_SOURCE_UNKNOWN", `${path}.basisPsychologicalSourceIds`, `Epistemic source ${sourceId} is not owned by this Character Agent.`));
    }
    if (!clean(position?.privateReason)) errors.push(issue("SUBJECTIVE_EPISTEMIC_REASON_MISSING", `${path}.privateReason`, "The Character Agent must privately distinguish confidence from its present working use."));
  }
  const currentPositionSlots = new Set((epistemicPositions || []).map((position) => (
    `${clean(position?.domain)}::${clean(position?.subjectHandle)}`
  )));
  const currentlyPerceivedTargets = asSet(context.knownTargetHandles);
  const unresolvedPriorStatuses = new Set(["unknown", "provisional", "suspended"]);
  for (const priorPosition of context.priorEpistemicPositions || []) {
    const priorStatus = clean(priorPosition?.status);
    const priorSubject = clean(priorPosition?.subjectHandle);
    const priorDomain = clean(priorPosition?.domain);
    if (!unresolvedPriorStatuses.has(priorStatus)) continue;
    if (!priorSubject || !currentlyPerceivedTargets.has(priorSubject)) continue;
    const slot = `${priorDomain}::${priorSubject}`;
    if (!currentPositionSlots.has(slot)) errors.push(issue(
      "SUBJECTIVE_EPISTEMIC_POSITION_SILENTLY_DROPPED",
      "epistemicPositions",
      `The still-perceived ${priorDomain || "other"} position ${clean(priorPosition?.positionId) || slot} must be retained, revised, settled, or rejected; omission cannot erase Character-owned working memory.`,
    ));
  }
  if (!appraisal.priorActionOutcomeAppraisal || typeof appraisal.priorActionOutcomeAppraisal !== "object") {
    errors.push(issue(
      "SUBJECTIVE_PRIOR_OUTCOME_APPRAISAL_MISSING",
      "priorActionOutcomeAppraisal",
      "The Character Agent must explicitly report whether it perceived any result from its prior action.",
    ));
  } else {
    if (outcomeReport.ownerAuthority !== "character-agent") {
      errors.push(issue(
        "SUBJECTIVE_PRIOR_OUTCOME_AUTHORITY_INVALID",
        "priorActionOutcomeAppraisal.ownerAuthority",
        "Only the Character Agent may appraise the result it experienced.",
      ));
    }
    const hasPriorForecast = Boolean(clean(priorForecast.sourceAgentTurnId));
    const sourceAgentTurnId = clean(outcomeReport.sourceAgentTurnId);
    if (hasPriorForecast && sourceAgentTurnId !== clean(priorForecast.sourceAgentTurnId)) {
      errors.push(issue(
        "SUBJECTIVE_PRIOR_OUTCOME_TURN_MISMATCH",
        "priorActionOutcomeAppraisal.sourceAgentTurnId",
        "The outcome appraisal must refer to the pending prior action forecast.",
      ));
    }
    if (!hasPriorForecast && clean(outcomeReport.status) !== "no_prior_action") {
      errors.push(issue(
        "SUBJECTIVE_PRIOR_OUTCOME_NOT_APPLICABLE",
        "priorActionOutcomeAppraisal.status",
        "Without a pending prior action, the outcome appraisal status must be no_prior_action.",
      ));
    }
    if (hasPriorForecast && clean(outcomeReport.status) === "no_prior_action") {
      errors.push(issue(
        "SUBJECTIVE_PRIOR_OUTCOME_IGNORED",
        "priorActionOutcomeAppraisal.status",
        "A pending prior action must be appraised as perceived, unclear, or unnoticed.",
      ));
    }
    for (const evidenceId of unique(outcomeReport.noticedOutcomeEvidenceIds || [])) {
      if (knownEvidenceIds.size && !knownEvidenceIds.has(evidenceId)) {
        errors.push(issue(
          "SUBJECTIVE_PRIOR_OUTCOME_EVIDENCE_UNKNOWN",
          "priorActionOutcomeAppraisal.noticedOutcomeEvidenceIds",
          `Outcome evidence ${evidenceId} did not reach this Character Agent.`,
        ));
      }
      if (!(appraisal.noticedEvidenceIds || []).map(clean).includes(evidenceId)) {
        errors.push(issue(
          "SUBJECTIVE_PRIOR_OUTCOME_EVIDENCE_NOT_NOTICED",
          "priorActionOutcomeAppraisal.noticedOutcomeEvidenceIds",
          `Outcome evidence ${evidenceId} must also be listed as noticed evidence.`,
        ));
      }
    }
  }
  for (const [index, link] of (appraisal.relevanceLinks || []).entries()) {
    const sourceId = clean(link?.sourceId);
    if (!sourceId) errors.push(issue("SUBJECTIVE_APPRAISAL_SOURCE_MISSING", `relevanceLinks[${index}].sourceId`, "A relevance link needs an owned source."));
    if (sourceId && knownSourceIds.size && !knownSourceIds.has(sourceId)) {
      errors.push(issue("SUBJECTIVE_APPRAISAL_SOURCE_UNKNOWN", `relevanceLinks[${index}].sourceId`, `Unknown private source ${sourceId}.`));
    }
  }
  const desireGroundings = Array.isArray(appraisal.desireGroundings) ? appraisal.desireGroundings : null;
  const desireById = new Map((context.desires || []).map((row) => [clean(row?.desireId || row?.id), row]));
  if (context.requireDesireGrounding === true && !desireGroundings) {
    errors.push(issue(
      "DESIRE_GROUNDING_MISSING",
      "desireGroundings",
      "The Character Agent must explicitly ground each currently relevant desire before generating candidates.",
    ));
  }
  const groundedIds = new Set();
  for (const [index, grounding] of (desireGroundings || []).entries()) {
    const path = `desireGroundings[${index}]`;
    const desireId = clean(grounding?.desireId);
    if (!desireId) errors.push(issue("DESIRE_GROUNDING_ID_MISSING", `${path}.desireId`, "Desire grounding needs an owned desire id."));
    if (desireId && groundedIds.has(desireId)) errors.push(issue("DESIRE_GROUNDING_ID_DUPLICATE", `${path}.desireId`, `Desire ${desireId} was grounded more than once.`));
    groundedIds.add(desireId);
    if (desireId && knownDesireIds.size && !knownDesireIds.has(desireId)) {
      errors.push(issue("DESIRE_GROUNDING_ID_UNKNOWN", `${path}.desireId`, `Unknown desire ${desireId}.`));
    }
    if (!clean(grounding?.feltWant)) errors.push(issue("DESIRE_GROUNDING_FELT_WANT_MISSING", `${path}.feltWant`, "The Character Agent must name what this desire feels like now."));
    if (!clean(grounding?.terminalExperience)) errors.push(issue("DESIRE_GROUNDING_TERMINAL_EXPERIENCE_MISSING", `${path}.terminalExperience`, "The Character Agent must preserve the experience that would actually count."));
    if (grounding?.terminalContractAcknowledged !== true) errors.push(issue(
      "DESIRE_GROUNDING_TERMINAL_CONTRACT_NOT_ACKNOWLEDGED",
      `${path}.terminalContractAcknowledged`,
      "The Character Agent must acknowledge the authored terminal contract without restating it as a current checklist.",
    ));
    if (!Array.isArray(grounding?.promotedCriteria)) errors.push(issue(
      "DESIRE_CRITERION_PROMOTIONS_MISSING",
      `${path}.promotedCriteria`,
      "Grounding must explicitly provide zero or more criteria that this Character Agent made salient now.",
    ));
    const promotedCriterionIds = new Set();
    for (const [promotionIndex, promotion] of (grounding?.promotedCriteria || []).entries()) {
      const promotionPath = `${path}.promotedCriteria[${promotionIndex}]`;
      const criterionId = clean(promotion?.criterionId);
      if (!criterionId) errors.push(issue("DESIRE_CRITERION_PROMOTION_ID_MISSING", `${promotionPath}.criterionId`, "A promoted criterion needs its private terminal-contract id."));
      if (criterionId && promotedCriterionIds.has(criterionId)) errors.push(issue("DESIRE_CRITERION_PROMOTION_DUPLICATE", `${promotionPath}.criterionId`, `Criterion ${criterionId} was promoted more than once.`));
      promotedCriterionIds.add(criterionId);
      if (criterionId && knownCriterionIds.size && !knownCriterionIds.has(criterionId)) {
        errors.push(issue("DESIRE_CRITERION_PROMOTION_UNKNOWN", `${promotionPath}.criterionId`, `Unknown terminal criterion ${criterionId}.`));
      }
      const ownedForDesire = criterionIdsByDesire.get(desireId);
      if (criterionId && ownedForDesire?.size && !ownedForDesire.has(criterionId)) {
        errors.push(issue("DESIRE_CRITERION_PROMOTION_DESIRE_MISMATCH", `${promotionPath}.criterionId`, `Criterion ${criterionId} does not belong to desire ${desireId}.`));
      }
      if (!CHARACTER_DESIRE_CRITERION_PROMOTION_MODES.includes(clean(promotion?.mode))) {
        errors.push(issue("DESIRE_CRITERION_PROMOTION_MODE_INVALID", `${promotionPath}.mode`, "Criterion promotion must be monitor or current_concern."));
      }
      if (!Array.isArray(promotion?.basisEvidenceIds)) errors.push(issue("DESIRE_CRITERION_PROMOTION_EVIDENCE_MISSING", `${promotionPath}.basisEvidenceIds`, "Criterion promotion needs zero or more personally noticed evidence ids."));
      if (!Array.isArray(promotion?.basisPsychologicalSourceIds)) errors.push(issue("DESIRE_CRITERION_PROMOTION_SOURCES_MISSING", `${promotionPath}.basisPsychologicalSourceIds`, "Criterion promotion needs zero or more Character-owned psychological sources."));
      if (!Array.isArray(promotion?.basisStateFactors)) errors.push(issue("DESIRE_CRITERION_PROMOTION_STATE_FACTORS_MISSING", `${promotionPath}.basisStateFactors`, "Criterion promotion needs zero or more current private state factors."));
      const evidenceBasis = unique(promotion?.basisEvidenceIds || []);
      const psychologicalBasis = unique(promotion?.basisPsychologicalSourceIds || []);
      const stateBasis = unique(promotion?.basisStateFactors || []);
      const independentPsychologicalBasis = psychologicalBasis.filter((sourceId) => sourceId !== desireId);
      if (!evidenceBasis.length && !independentPsychologicalBasis.length && !stateBasis.length) {
        errors.push(issue(
          "DESIRE_CRITERION_PROMOTION_BASIS_MISSING",
          promotionPath,
          "A terminal criterion cannot become a present concern merely because it belongs to the active desire.",
        ));
      }
      for (const evidenceId of evidenceBasis) {
        if (knownEvidenceIds.size && !knownEvidenceIds.has(evidenceId)) errors.push(issue("DESIRE_CRITERION_PROMOTION_EVIDENCE_UNKNOWN", `${promotionPath}.basisEvidenceIds`, `Promotion evidence ${evidenceId} did not reach this Character Agent.`));
        if (!(appraisal.noticedEvidenceIds || []).map(clean).includes(evidenceId)) errors.push(issue("DESIRE_CRITERION_PROMOTION_EVIDENCE_NOT_NOTICED", `${promotionPath}.basisEvidenceIds`, `Promotion evidence ${evidenceId} must be personally noticed in this appraisal.`));
      }
      for (const sourceId of psychologicalBasis) {
        if (knownSourceIds.size && !knownSourceIds.has(sourceId)) errors.push(issue("DESIRE_CRITERION_PROMOTION_SOURCE_UNKNOWN", `${promotionPath}.basisPsychologicalSourceIds`, `Promotion source ${sourceId} is not owned by this Character Agent.`));
      }
      for (const factor of stateBasis) {
        if (!CHARACTER_DESIRE_CRITERION_STATE_FACTORS.includes(factor)) errors.push(issue("DESIRE_CRITERION_PROMOTION_STATE_FACTOR_INVALID", `${promotionPath}.basisStateFactors`, `Unknown criterion-promotion state factor ${factor}.`));
      }
      if (!clean(promotion?.privateReason)) errors.push(issue("DESIRE_CRITERION_PROMOTION_REASON_MISSING", `${promotionPath}.privateReason`, "The Character Agent must privately explain why this terminal condition matters now rather than merely at final evaluation."));
    }
    if (!["inactive", "latent", "uncertain", "triggered", "active"].includes(clean(grounding?.activationState))) {
      errors.push(issue("DESIRE_GROUNDING_ACTIVATION_STATE_INVALID", `${path}.activationState`, "Grounding must distinguish latent potential from a currently triggered desire."));
    }
    if (!Array.isArray(grounding?.activationEvidenceIds)) errors.push(issue("DESIRE_GROUNDING_ACTIVATION_EVIDENCE_MISSING", `${path}.activationEvidenceIds`, "Grounding must state which personally noticed evidence activated this desire."));
    if (!Array.isArray(grounding?.activationPsychologicalSourceIds)) errors.push(issue(
      "DESIRE_GROUNDING_ACTIVATION_SOURCES_MISSING",
      `${path}.activationPsychologicalSourceIds`,
      "Grounding must separately state which owned memories, beliefs, values, self-schemas, relationships, commitments or desires make this desire current.",
    ));
    if (!Array.isArray(grounding?.missingActivationConditions)) errors.push(issue("DESIRE_GROUNDING_ACTIVATION_CONDITIONS_MISSING", `${path}.missingActivationConditions`, "Grounding must preserve any authored activation conditions that are still missing."));
    const authoredDesire = desireById.get(desireId) || {};
    const cueGated = clean(authoredDesire.activationMode || authoredDesire.activationPolicy?.mode) === "cue_gated";
    const activationState = clean(grounding?.activationState);
    if (!cueGated && ["inactive", "latent"].includes(activationState)) {
      errors.push(issue(
        "DESIRE_GROUNDING_PERSISTENT_MARKED_LATENT",
        `${path}.activationState`,
        "A persistent desire remains Character-owned pressure while terminal conditions are unresolved; do not turn it into a cue-gated latent desire.",
      ));
    }
    if (cueGated && ["triggered", "active"].includes(activationState) && !(grounding?.activationEvidenceIds || []).length) {
      errors.push(issue("DESIRE_GROUNDING_ACTIVE_WITHOUT_EVIDENCE", `${path}.activationEvidenceIds`, "A cue-gated desire cannot become current without personally noticed activation evidence."));
    }
    for (const evidenceId of unique(grounding?.activationEvidenceIds || [])) {
      if (knownEvidenceIds.size && !knownEvidenceIds.has(evidenceId)) {
        errors.push(issue("DESIRE_GROUNDING_ACTIVATION_EVIDENCE_UNKNOWN", `${path}.activationEvidenceIds`, `Activation evidence ${evidenceId} did not reach this Character Agent.`));
      }
      if (!(appraisal.noticedEvidenceIds || []).map(clean).includes(evidenceId)) {
        errors.push(issue("DESIRE_GROUNDING_ACTIVATION_EVIDENCE_NOT_NOTICED", `${path}.activationEvidenceIds`, `Activation evidence ${evidenceId} must also be listed as noticed evidence.`));
      }
    }
    for (const sourceId of unique(grounding?.activationPsychologicalSourceIds || [])) {
      if (knownSourceIds.size && !knownSourceIds.has(sourceId)) {
        errors.push(issue(
          "DESIRE_GROUNDING_ACTIVATION_SOURCE_UNKNOWN",
          `${path}.activationPsychologicalSourceIds`,
          `Activation source ${sourceId} is not owned by this Character Agent.`,
        ));
      }
    }
    if (!Array.isArray(grounding?.acceptableTransformations)) errors.push(issue("DESIRE_GROUNDING_TRANSFORMATIONS_MISSING", `${path}.acceptableTransformations`, "Grounding must state which action dimensions may change while preserving the desire."));
    for (const field of ["immediatePull", "currentlyPerceivedPossible"]) {
      if (!Number.isFinite(Number(grounding?.[field]))) errors.push(issue("DESIRE_GROUNDING_NUMBER_INVALID", `${path}.${field}`, `${field} must be numeric.`));
    }
    for (const [inhibitorIndex, inhibitor] of (grounding?.inhibitors || []).entries()) {
      for (const evidenceId of unique(inhibitor?.basisEvidenceIds || [])) {
        if (knownEvidenceIds.size && !knownEvidenceIds.has(evidenceId)) {
          errors.push(issue("DESIRE_GROUNDING_INHIBITOR_EVIDENCE_UNKNOWN", `${path}.inhibitors[${inhibitorIndex}].basisEvidenceIds`, `Inhibitor evidence ${evidenceId} did not reach this Character Agent.`));
        }
      }
    }
  }
  if (context.requireDesireGrounding === true) {
    const currentlyRelevantDesireIds = unique((appraisal.relevanceLinks || [])
      .filter((row) => unit(row?.strength) * unit(row?.confidence, 1) > 0.05)
      .map((row) => row?.sourceId))
      .filter((sourceId) => !knownDesireIds.size || knownDesireIds.has(sourceId));
    for (const desireId of currentlyRelevantDesireIds) {
      if (!groundedIds.has(desireId)) errors.push(issue(
        "DESIRE_GROUNDING_RELEVANT_DESIRE_OMITTED",
        "desireGroundings",
        `Relevant desire ${desireId} must be grounded before candidate generation.`,
      ));
    }
  }
  for (const id of APPRAISAL_AXIS_IDS) {
    const value = appraisal.appraisalAxes?.[id];
    if (value != null && !Number.isFinite(Number(value))) {
      errors.push(issue("SUBJECTIVE_APPRAISAL_AXIS_INVALID", `appraisalAxes.${id}`, `Appraisal axis ${id} must be numeric.`));
    }
  }
  for (const id of RELATIONSHIP_MEANING_IDS) {
    const value = appraisal.appraisalAxes?.relationshipMeaning?.[id];
    if (value != null && !Number.isFinite(Number(value))) {
      errors.push(issue("SUBJECTIVE_APPRAISAL_RELATIONSHIP_AXIS_INVALID", `appraisalAxes.relationshipMeaning.${id}`, `Relationship meaning ${id} must be numeric.`));
    }
  }
  nestedForbiddenAgentProposalFields(
    appraisal,
    new Set(["generatedCandidates", "selectedCandidateId", "regulationChoice", "communicationPlan", "utterance", "actionAttempt", "worldOutcome"]),
    "appraisal",
    errors,
    "SUBJECTIVE_APPRAISAL_STAGE_LEAK",
  );
  return { valid: errors.length === 0, errors };
}

function relevanceForDesire(appraisal, desireId) {
  const rows = (appraisal.relevanceLinks || []).filter((row) => clean(row?.sourceId) === desireId);
  if (!rows.length) return 0;
  return clamp(Math.max(...rows.map((row) => unit(row.strength) * unit(row.confidence, 1))));
}

function desireActivation(desire = {}, appraisal = {}, outcomeFeedback = {}) {
  const desireId = clean(desire.desireId || desire.id);
  const previous = unit(desire.previousActivation ?? desire.activation ?? desire.strength);
  const retention = unit(desire.retention, 0.9);
  const grounding = (appraisal.desireGroundings || []).find((row) => clean(row?.desireId) === desireId) || {};
  const activationMode = clean(desire.activationMode || desire.activationPolicy?.mode) || "persistent";
  const activationState = clean(grounding.activationState) || (activationMode === "cue_gated" ? "latent" : "active");
  const cueGated = activationMode === "cue_gated";
  const cueGrounded = ["triggered", "active"].includes(activationState);
  const latentCap = unit(desire.latentActivationCap ?? desire.activationPolicy?.latentActivationCap, 0.12);
  const noticedConfidence = Math.max(
    0,
    ...(appraisal.interpretations || []).map((row) => unit(row?.confidence)),
    (appraisal.noticedEvidenceIds || []).length ? 0.5 : 0,
  );
  const relevance = relevanceForDesire(appraisal, desireId);
  const cueMatch = unit(desire.cueMatch ?? desire.cueActivation, relevance);
  const outcomeApplies = (outcomeFeedback.linkedSourceIds || []).includes(desireId);
  const activationPotential = cueGrounded
    ? Math.max(previous, unit(desire.potentialStrength, previous))
    : previous;
  const retained = cueGated && !cueGrounded
    ? Math.min(activationPotential * retention, activationState === "uncertain" ? Math.max(latentCap, 0.28) : latentCap)
    : activationPotential * retention;
  const groundedPull = unit(grounding.immediatePull);
  const contributors = {
    retained,
    subjectivelyGroundedPull: cueGated
      ? cueGrounded ? groundedPull * 0.32 : activationState === "uncertain" ? groundedPull * 0.08 : 0
      : groundedPull * 0.32,
    noticedRelevantCue: (!cueGated || cueGrounded)
      ? cueMatch * noticedConfidence * Math.max(relevance, unit(axis(appraisal, "selfRelevance"))) * 0.72
      : 0,
    urgency: unit(desire.urgency) * 0.34,
    frustration: unit(desire.frustration) * 0.3,
    relationshipExpectation: unit(desire.relationshipExpectation) * 0.2,
    bodyNeedCoupling: unit(desire.bodyNeedCoupling) * 0.22,
    satisfaction: -unit(desire.satisfaction) * 0.68,
    adaptation: -unit(desire.adaptation) * 0.28,
    perceivedOutcomeFrustration: outcomeApplies
      ? unit(outcomeFeedback.unresolvedPressure) * 0.28
      : 0,
  };
  const value = clamp(Object.values(contributors).reduce((sum, item) => sum + item, 0));
  return {
    desireId,
    value: round(value),
    activationMode,
    activationState,
    contributors: Object.fromEntries(Object.entries(contributors).map(([key, item]) => [key, round(item)])),
  };
}

function mergedEmotionModel(profile = {}, emotionId) {
  const base = DEFAULT_EMOTION_MODELS[emotionId] || { baseline: -2, appraisalWeights: {} };
  const custom = profile.emotionResponse?.emotions?.[emotionId] || {};
  return {
    ...base,
    ...custom,
    appraisalWeights: { ...(base.appraisalWeights || {}), ...(custom.appraisalWeights || {}) },
    relationshipWeights: { ...(base.relationshipWeights || {}), ...(custom.relationshipWeights || {}) },
    bodyWeights: { ...(base.bodyWeights || {}), ...(custom.bodyWeights || {}) },
  };
}

function computeEmotion(emotionId, appraisal, profile, state, desireAggregate) {
  const model = mergedEmotionModel(profile, emotionId);
  const globalGain = finite(profile.emotionResponse?.globalGain, 1);
  const gain = finite(model.gain, 1) * globalGain;
  const terms = {
    baseline: finite(model.baseline, -2),
  };
  for (const [id, weight] of Object.entries(model.appraisalWeights || {})) {
    terms[`appraisal.${id}`] = axis(appraisal, id) * finite(weight);
  }
  for (const [id, weight] of Object.entries(model.relationshipWeights || {})) {
    terms[`relationship.${id}`] = relationshipAxis(appraisal, id) * finite(weight);
  }
  for (const [id, weight] of Object.entries(model.bodyWeights || {})) {
    terms[`body.${id}`] = bodyValue(state, id) * finite(weight);
  }
  terms.uncertainty = unit(appraisal.uncertainty) * finite(model.uncertaintyWeight);
  terms.desireActivation = desireAggregate * finite(model.desireWeight);
  terms.moodValence = signed(state.mood?.valence) * finite(model.moodValenceWeight);
  terms.moodArousal = unit(state.mood?.arousal) * finite(model.moodArousalWeight);
  const priorCarryover = safeRecord(state.priorRegulationCarryover);
  const priorResidual = (priorCarryover.residualEmotion || [])
    .find((row) => clean(row?.emotionId) === emotionId) || {};
  const priorResidualValue = unit(priorResidual.value);
  terms.priorResidualAffect = priorResidualValue * 0.72;
  terms.priorRebound = (
    unit(priorResidual.rebound) * 0.32
    + unit(priorCarryover.reboundPressure) * (priorResidualValue >= 0.18 ? 0.24 : 0.06)
  );
  const weighted = Object.entries(terms).reduce((sum, [key, value]) => (
    key === "baseline" ? sum : sum + finite(value)
  ), 0);
  const score = finite(terms.baseline) + weighted * gain;
  return {
    emotionId,
    value: round(sigmoid(score)),
    contributors: Object.fromEntries(Object.entries(terms).map(([key, value]) => [key, round(value)])),
  };
}

function affectSummary(emotions, state) {
  const values = Object.fromEntries(emotions.map((row) => [row.emotionId, row.value]));
  const positive = ["curiosity", "anticipation", "excitement", "joy", "pride", "affection"]
    .reduce((sum, id) => sum + unit(values[id]), 0) / 6;
  const negative = ["wariness", "fear", "irritation", "anger", "shame", "guilt", "disappointment", "sadness", "aversion"]
    .reduce((sum, id) => sum + unit(values[id]), 0) / 9;
  const arousal = clamp(
    unit(state.mood?.arousal) * 0.22
    + unit(values.surprise) * 0.12
    + unit(values.excitement) * 0.16
    + unit(values.wariness) * 0.12
    + unit(values.fear) * 0.14
    + unit(values.irritation) * 0.1
    + unit(values.anger) * 0.14,
  );
  const dominance = clamp(
    0.5
    + unit(values.pride) * 0.2
    + unit(values.anger) * 0.12
    - unit(values.fear) * 0.22
    - unit(values.shame) * 0.2
    - unit(values.sadness) * 0.1,
  );
  return {
    valence: round(clamp(positive - negative + signed(state.mood?.valence) * 0.22, -1, 1)),
    arousal: round(arousal),
    dominance: round(dominance),
  };
}

function actionTendencies(values) {
  return {
    orient: round(clamp(values.surprise * 0.28 + values.curiosity * 0.42 + values.wariness * 0.2 + values.anticipation * 0.18)),
    approach: round(clamp(values.anticipation * 0.3 + values.excitement * 0.26 + values.curiosity * 0.22 + values.joy * 0.14 + values.affection * 0.12 - values.fear * 0.18 - values.aversion * 0.2)),
    withdraw: round(clamp(values.fear * 0.38 + values.wariness * 0.24 + values.shame * 0.2 + values.aversion * 0.3 - values.curiosity * 0.1)),
    confront: round(clamp(values.anger * 0.4 + values.irritation * 0.28 + values.pride * 0.12 + values.excitement * 0.1 - values.fear * 0.12)),
    conceal: round(clamp(values.shame * 0.32 + values.wariness * 0.26 + values.fear * 0.16 + values.pride * 0.1)),
    affiliate: round(clamp(values.affection * 0.46 + values.joy * 0.2 + values.guilt * 0.12 + values.sadness * 0.08 - values.aversion * 0.18)),
    persist: round(clamp(values.anticipation * 0.28 + values.pride * 0.2 + values.anger * 0.12 + values.disappointment * 0.16 + values.curiosity * 0.12)),
  };
}

function controlCapacity(profile, state, affect) {
  const personality = safeRecord(profile.personality);
  const regulation = safeRecord(profile.regulation);
  const terms = {
    baseline: 0.08,
    traitSelfControl: unit(personality.selfControl, 0.5) * 0.32,
    practicedSkill: unit(regulation.practicedSkill, 0.5) * 0.2,
    roleDiscipline: unit(regulation.roleDiscipline, 0.4) * 0.12,
    feltSafety: unit(state.feltSafety, 0.5) * 0.11,
    preparation: unit(state.preparation, 0.25) * 0.08,
    arousalLoad: -unit(affect.arousal) * 0.2,
    fatigue: -bodyValue(state, "fatigue") * 0.22,
    pain: -bodyValue(state, "pain") * 0.16,
    cognitiveLoad: -unit(state.cognitiveLoad) * 0.16,
    traumaActivation: -unit(state.traumaActivation) * 0.16,
  };
  return {
    value: round(clamp(Object.values(terms).reduce((sum, value) => sum + value, 0))),
    terms: Object.fromEntries(Object.entries(terms).map(([key, value]) => [key, round(value)])),
  };
}

function regulationOptions(profile, capacity, emotionLoad, publicExposure) {
  const skills = safeRecord(profile.regulation?.strategySkills);
  return CHARACTER_PSYCHOLOGY_REGULATION_STRATEGIES.map((strategy) => {
    const skill = unit(skills[strategy], 0.45);
    const contextFit = strategy === "suppress" || strategy === "conceal"
      ? clamp(0.35 + publicExposure * 0.45)
      : strategy === "express"
        ? clamp(0.72 - publicExposure * 0.36)
        : 0.5;
    const expected = clamp(capacity * 0.55 + skill * 0.3 + contextFit * 0.15 - emotionLoad * 0.18);
    const spread = clamp(0.12 + emotionLoad * 0.12 + (1 - skill) * 0.1, 0.08, 0.32);
    const costBase = STRATEGY_COSTS[strategy] ?? 0.3;
    return {
      strategy,
      estimatedEffectRange: {
        low: round(clamp(expected - spread)),
        expected: round(expected),
        high: round(clamp(expected + spread)),
      },
      costRange: {
        low: round(clamp(costBase * emotionLoad * 0.5)),
        expected: round(clamp(costBase * emotionLoad)),
        high: round(clamp(costBase * emotionLoad * 1.5)),
      },
    };
  });
}

/** Compute private state from the Character Agent's own appraisal. */
export function computeCharacterPsychologySnapshot({
  agentTurnId = "",
  appraisal = {},
  profile = {},
  state = {},
  desires = [],
  outcomeFeedback = {},
} = {}) {
  if (appraisal.ownerAuthority !== "character-agent") {
    const error = new Error("Subjective appraisal must be authored by the Character Agent before psychology tools run.");
    error.code = "CHARACTER_APPRAISAL_AUTHORITY_REQUIRED";
    throw error;
  }
  if (clean(agentTurnId) && clean(appraisal.agentTurnId) && clean(agentTurnId) !== clean(appraisal.agentTurnId)) {
    const error = new Error("Subjective appraisal belongs to a different Agent turn.");
    error.code = "CHARACTER_APPRAISAL_TURN_MISMATCH";
    throw error;
  }
  const desireActivations = (desires || []).map((desire) => desireActivation(desire, appraisal, outcomeFeedback));
  const desireAggregate = desireActivations.length
    ? Math.max(...desireActivations.map((row) => row.value))
    : 0;
  const emotionMixture = CHARACTER_PSYCHOLOGY_EMOTION_IDS.map((emotionId) => (
    computeEmotion(emotionId, appraisal, profile, state, desireAggregate)
  ));
  const affect = affectSummary(emotionMixture, state);
  const values = Object.fromEntries(emotionMixture.map((row) => [row.emotionId, row.value]));
  const capacity = controlCapacity(profile, state, affect);
  const emotionLoad = clamp(Math.max(0, ...emotionMixture.map((row) => row.value)) * 0.62 + affect.arousal * 0.38);
  const result = {
    schemaVersion: CHARACTER_PSYCHOLOGY_TOOLS_VERSION,
    authority: "character-private-psychology-tool",
    agentTurnId: clean(agentTurnId || appraisal.agentTurnId),
    sourceAppraisalId: clean(appraisal.appraisalId),
    desireActivations,
    desireGroundings: structuredClone(appraisal.desireGroundings || []),
    epistemicPositions: structuredClone(appraisal.epistemicPositions || []),
    emotionMixture,
    affectSummary: affect,
    actionTendencies: actionTendencies(values),
    controlCapacity: capacity.value,
    cognitiveLoad: round(unit(state.cognitiveLoad)),
    regulationOptions: regulationOptions(profile, capacity.value, emotionLoad, unit(axis(appraisal, "publicExposure"))),
    uncertainty: round(unit(appraisal.uncertainty)),
    sourceNoticedEvidenceIds: unique(appraisal.noticedEvidenceIds || []),
    priorActionOutcomeFeedback: structuredClone(outcomeFeedback || {}),
    maturedContinuationIntentions: structuredClone(outcomeFeedback.maturedContinuationIntentions || []),
    privateFactorLedger: {
      controlCapacity: capacity.terms,
      appraisalAxes: Object.fromEntries(APPRAISAL_AXIS_IDS.map((id) => [id, round(axis(appraisal, id))])),
      relationshipMeaning: Object.fromEntries(RELATIONSHIP_MEANING_IDS.map((id) => [id, round(relationshipAxis(appraisal, id))])),
      emotionLoad: round(emotionLoad),
      affectiveCarryover: {
        residualEmotion: structuredClone(state.priorRegulationCarryover?.residualEmotion || []),
        reboundPressure: round(unit(state.priorRegulationCarryover?.reboundPressure)),
        controlDepletion: round(unit(state.priorRegulationCarryover?.controlDepletion)),
        selection: null,
      },
    },
  };
  return assertPsychologyToolAuthority(result, "computeCharacterPsychologySnapshot");
}

/** Validate action possibilities originated by the Character Agent, not a tool. */
const CANDIDATE_ACTION_BINDING_FIELDS = Object.freeze({
  character: "targetCharacterId",
  object: "objectId",
  place: "destinationId",
  position: "positionId",
  affordance: "affordanceId",
});

/**
 * A typed action binding names exactly one concrete world anchor for the
 * candidate. It is validated here so that after choice the realization stage
 * inherits an unambiguous action identity instead of re-deciding it.
 * Legacy candidates without a binding remain valid.
 */
function validateCandidateActionBinding(binding, path, knownTargetHandles, knownTargetHandlesByKind = null) {
  if (binding == null) return [];
  const errors = [];
  if (typeof binding !== "object" || Array.isArray(binding)) {
    return [issue("AGENT_CANDIDATE_BINDING_INVALID", path, "An action binding must be an object.")];
  }
  const kind = clean(binding.kind);
  if (!["none", ...Object.keys(CANDIDATE_ACTION_BINDING_FIELDS)].includes(kind)) {
    return [issue("AGENT_CANDIDATE_BINDING_INVALID", `${path}.kind`, `Unknown action binding kind ${kind || "(empty)"}.`)];
  }
  const boundField = CANDIDATE_ACTION_BINDING_FIELDS[kind] || "";
  const kindSpecificTargets = knownTargetHandlesByKind
    && Object.prototype.hasOwnProperty.call(knownTargetHandlesByKind, kind)
    ? asSet(knownTargetHandlesByKind[kind])
    : null;
  for (const [bindingKind, field] of Object.entries(CANDIDATE_ACTION_BINDING_FIELDS)) {
    const value = clean(binding[field]);
    if (field === boundField) {
      if (!value) {
        errors.push(issue("AGENT_CANDIDATE_BINDING_INCOMPLETE", `${path}.${field}`, `A ${kind} binding must name its concrete ${field}.`));
      } else if (kindSpecificTargets && !kindSpecificTargets.has(value)) {
        errors.push(knownTargetHandles.has(value)
          ? issue("AGENT_CANDIDATE_BINDING_TARGET_KIND_MISMATCH", `${path}.${field}`, `Binding cites ${value}, but it is not a perceived ${bindingKind} anchor.`)
          : issue("AGENT_CANDIDATE_BINDING_TARGET_UNKNOWN", `${path}.${field}`, `Binding cites unknown ${bindingKind} anchor ${value}.`));
      } else if (!kindSpecificTargets && knownTargetHandles.size && !knownTargetHandles.has(value)) {
        errors.push(issue("AGENT_CANDIDATE_BINDING_TARGET_UNKNOWN", `${path}.${field}`, `Binding cites unknown ${bindingKind} anchor ${value}.`));
      }
    } else if (value) {
      errors.push(issue("AGENT_CANDIDATE_BINDING_AMBIGUOUS", `${path}.${field}`, `A ${kind || "none"} binding must leave ${field} empty so the action has exactly one anchor.`));
    }
  }
  return errors;
}

/**
 * move is a structured spatial choice: the Character Agent must pick a real
 * adjacent destination itself. Anchoring a move to a person, leaving the
 * destination empty, or "moving" to the zone already occupied can never
 * settle, so the combination is rejected here instead of burning a world
 * step and returning a generic failure the model tends to retry verbatim.
 */
function validateMovementCandidateBinding(candidate, path, context) {
  if (clean(candidate.attemptPrimitive) !== "move") return [];
  const binding = candidate.actionBinding && typeof candidate.actionBinding === "object" && !Array.isArray(candidate.actionBinding)
    ? candidate.actionBinding : null;
  const kind = clean(binding?.kind);
  if (kind === "position" && clean(binding?.positionId)) return [];
  const currentZoneId = clean(context.currentZoneId);
  const adjacentZoneIds = [...asSet(context.adjacentZoneIds)];
  // A world that projects no spatial anchors has no destination to name, so
  // demanding one would forbid move outright. Only structured worlds (zones or
  // positions) can require, and check, a concrete spatial binding.
  const spatialAnchors = context.knownTargetHandlesByKind && typeof context.knownTargetHandlesByKind === "object"
    ? [...asSet(context.knownTargetHandlesByKind.place), ...asSet(context.knownTargetHandlesByKind.position)]
    : [];
  if (!spatialAnchors.length && !currentZoneId && !adjacentZoneIds.length) return [];
  const reachableList = adjacentZoneIds.length ? ` Adjacent destinations actually reachable in one move: ${adjacentZoneIds.join(", ")}.` : "";
  if (kind !== "place" || !clean(binding?.destinationId)) {
    return [issue("AGENT_CANDIDATE_MOVE_DESTINATION_REQUIRED", `${path}.actionBinding`,
      `move requires actionBinding kind "place" naming a concrete destinationId (or kind "position" naming a positionId). A character or object anchor is not a destination, and an empty destinationId can only settle as MOVEMENT_ZONE_UNKNOWN.${reachableList} Leaving the establishment entirely is the leave primitive, not move.`)];
  }
  const destinationId = clean(binding.destinationId);
  if (currentZoneId && destinationId === currentZoneId) {
    return [issue("AGENT_CANDIDATE_MOVE_DESTINATION_IS_CURRENT_ZONE", `${path}.actionBinding.destinationId`,
      `The Character is already in ${destinationId}; a move to the current zone can never succeed and is not "stepping over the threshold". To depart this establishment use the leave primitive; otherwise pick a different destination.${reachableList}`)];
  }
  if (adjacentZoneIds.length && !adjacentZoneIds.includes(destinationId)) {
    return [issue("AGENT_CANDIDATE_MOVE_DESTINATION_NOT_ADJACENT", `${path}.actionBinding.destinationId`,
      `${destinationId} is not directly reachable from ${currentZoneId || "the current zone"}; one move crosses exactly one adjacent edge.${reachableList}`)];
  }
  return [];
}

export function validateAgentGeneratedCandidates(candidates = [], context = {}) {
  const errors = [];
  if (!Array.isArray(candidates) || !candidates.length) {
    return { valid: false, errors: [issue("AGENT_CANDIDATES_MISSING", "generatedCandidates", "The Character Agent must originate at least one candidate.")] };
  }
  if (candidates.length > 7) errors.push(issue("AGENT_CANDIDATE_LIMIT_EXCEEDED", "generatedCandidates", "One Agent turn may propose at most seven candidates."));
  const knownEvidenceIds = asSet(context.knownEvidenceIds);
  // World adapters declare their action interface. Generic Character sessions
  // remain extensible, while schema-bypassing relay output gets the same check.
  const supportedPrimitives = Array.isArray(context.supportedAttemptPrimitives)
    ? asSet(context.supportedAttemptPrimitives) : null;
  const knownTargetHandles = asSet(context.knownTargetHandles);
  const knownTargetHandlesByKind = context.knownTargetHandlesByKind || null;
  const knownSourceIds = asSet(context.knownSourceIds);
  const knownDesireIds = asSet(context.knownDesireIds);
  const knownCriterionIds = asSet(context.knownCriterionIds);
  const knownEpistemicPositionIds = asSet(context.knownEpistemicPositionIds);
  const actionFeasibilityById = new Map((context.actionFeasibilities || []).map((row) => [
    clean(row?.feasibilityId),
    row,
  ]).filter(([feasibilityId]) => feasibilityId));
  const sharedActivityById = new Map((context.sharedActivities || []).map((row) => [
    clean(row?.activityId),
    row,
  ]).filter(([activityId]) => activityId));
  const currentConcernCriterionIds = asSet(context.currentConcernCriterionIds);
  const criterionIdsByDesire = new Map(Object.entries(context.criterionIdsByDesire || {}).map(([desireId, criterionIds]) => [
    clean(desireId),
    asSet(criterionIds),
  ]));
  const ids = new Set();
  const forbidden = new Set(["selected", "selectedCandidateId", "expressionStrategy", "expressionMode", "literalSpeech", "utterance", "visibleAction", "worldOutcome"]);
  for (const [index, candidate] of candidates.entries()) {
    const path = `generatedCandidates[${index}]`;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      errors.push(issue("AGENT_CANDIDATE_INVALID", path, "An Agent candidate must be an object."));
      continue;
    }
    if (candidate.originAuthority !== "character-agent") {
      errors.push(issue("AGENT_CANDIDATE_AUTHORITY_INVALID", `${path}.originAuthority`, "Only the Character Agent may originate an action candidate."));
    }
    const candidateId = clean(candidate.candidateId);
    if (!candidateId) errors.push(issue("AGENT_CANDIDATE_ID_MISSING", `${path}.candidateId`, "An Agent candidate needs an id."));
    if (candidateId && ids.has(candidateId)) errors.push(issue("AGENT_CANDIDATE_ID_DUPLICATE", `${path}.candidateId`, `Duplicate Agent candidate ${candidateId}.`));
    ids.add(candidateId);
    if (!clean(candidate.intention)) errors.push(issue("AGENT_CANDIDATE_INTENTION_MISSING", `${path}.intention`, "An Agent candidate needs a private intention."));
    if (!clean(candidate.attemptPrimitive)) errors.push(issue("AGENT_CANDIDATE_PRIMITIVE_MISSING", `${path}.attemptPrimitive`, "An Agent candidate needs an attempt primitive."));
    if (supportedPrimitives && !supportedPrimitives.has(clean(candidate.attemptPrimitive))) {
      errors.push(issue("AGENT_CANDIDATE_PRIMITIVE_UNSUPPORTED", `${path}.attemptPrimitive`,
        `Unsupported action primitive ${clean(candidate.attemptPrimitive) || "(empty)"}; supported primitives: ${[...supportedPrimitives].join(", ")}.`));
    }
    for (const evidenceId of unique(candidate.perceivedPrerequisites || [])) {
      if (knownEvidenceIds.size && !knownEvidenceIds.has(evidenceId)) {
        errors.push(issue("AGENT_CANDIDATE_EVIDENCE_UNKNOWN", `${path}.perceivedPrerequisites`, `Candidate cites unknown evidence ${evidenceId}.`));
      }
    }
    const targetHandle = clean(candidate.targetHandle);
    if (targetHandle && knownTargetHandles.size && !knownTargetHandles.has(targetHandle)) {
      errors.push(issue("AGENT_CANDIDATE_TARGET_UNKNOWN", `${path}.targetHandle`, `Candidate cites unknown target ${targetHandle}.`));
    }
    errors.push(...validateCandidateActionBinding(
      candidate.actionBinding,
      `${path}.actionBinding`,
      knownTargetHandles,
      knownTargetHandlesByKind,
    ));
    errors.push(...validateCapabilityActionBinding(candidate, context.availableAffordances || [], path));
    errors.push(...validateMovementCandidateBinding(candidate, path, context));
    const feasibilityHandling = candidate.feasibilityHandling;
    if (context.requireActionFeasibilityHandling === true
      && (!feasibilityHandling || typeof feasibilityHandling !== "object" || Array.isArray(feasibilityHandling))) {
      errors.push(issue(
        "AGENT_CANDIDATE_FEASIBILITY_HANDLING_MISSING",
        `${path}.feasibilityHandling`,
        "A candidate must state how this Character Agent uses the perceived action-feasibility surface.",
      ));
    }
    if (feasibilityHandling && typeof feasibilityHandling === "object" && !Array.isArray(feasibilityHandling)) {
      const handlingPath = `${path}.feasibilityHandling`;
      const surfaceId = clean(feasibilityHandling.surfaceId);
      const relationToGoal = clean(feasibilityHandling.relationToGoal);
      const stance = clean(feasibilityHandling.stance);
      const surface = actionFeasibilityById.get(surfaceId) || null;
      const boundObjectId = clean(candidate.actionBinding?.objectId);
      const boundDestinationId = clean(candidate.actionBinding?.destinationId);
      const matchingBoundSurface = [...actionFeasibilityById.values()].find((row) => (
        (clean(row?.bindingKind) === "object" && boundObjectId && clean(row?.targetHandle) === boundObjectId)
        || (clean(row?.bindingKind) === "place" && boundDestinationId && clean(row?.targetHandle) === boundDestinationId)
      )) || null;
      const matchingSocialAccess = matchingBoundSurface?.socialAccess || null;
      if (!surfaceId
        && matchingSocialAccess?.permissionRequiredByNorm === true
        && matchingSocialAccess?.permissionCurrentlyGranted === false) {
        errors.push(issue(
          "AGENT_CANDIDATE_RELEVANT_FEASIBILITY_OMITTED",
          `${handlingPath}.surfaceId`,
          "This destination has a known physical/social access surface. The Character may question, ignore or deliberately violate it, but may not label it irrelevant.",
        ));
      }
      if (surfaceId && !surface) errors.push(issue("AGENT_CANDIDATE_FEASIBILITY_UNKNOWN", `${handlingPath}.surfaceId`, `Unknown action-feasibility surface ${surfaceId}.`));
      if (!surfaceId && stance !== "not_applicable") errors.push(issue("AGENT_CANDIDATE_FEASIBILITY_SURFACE_REQUIRED", `${handlingPath}.surfaceId`, "A feasibility stance other than not_applicable must cite a perceived surface."));
      if (surfaceId && stance === "not_applicable") errors.push(issue("AGENT_CANDIDATE_FEASIBILITY_NOT_APPLICABLE_CONTRADICTION", `${handlingPath}.stance`, "A cited feasibility surface cannot be marked not_applicable."));
      if (!["direct_attempt", "prerequisite_step", "exploratory", "unrelated"].includes(relationToGoal)) errors.push(issue("AGENT_CANDIDATE_FEASIBILITY_GOAL_RELATION_INVALID", `${handlingPath}.relationToGoal`, "Unknown action-feasibility relation to goal."));
      if (!["follow", "question", "deliberate_attempt", "unknown", "not_applicable"].includes(stance)) errors.push(issue("AGENT_CANDIDATE_FEASIBILITY_STANCE_INVALID", `${handlingPath}.stance`, "Unknown action-feasibility stance."));
      if (surface && boundObjectId && clean(surface.targetHandle) !== boundObjectId) errors.push(issue("AGENT_CANDIDATE_FEASIBILITY_TARGET_MISMATCH", `${handlingPath}.surfaceId`, "The cited feasibility surface belongs to a different action target."));
      if (surface && clean(surface.bindingKind) === "place" && boundDestinationId && clean(surface.targetHandle) !== boundDestinationId) {
        errors.push(issue("AGENT_CANDIDATE_FEASIBILITY_TARGET_MISMATCH", `${handlingPath}.surfaceId`, "The cited movement-feasibility surface belongs to a different destination."));
      }
      if (surface
        && relationToGoal === "direct_attempt"
        && stance === "follow"
        && (surface.directAttempt?.currentlyAttemptable
          ?? surface.directManipulation?.currentlyAttemptable) === false) {
        errors.push(issue(
          "AGENT_CANDIDATE_KNOWN_PREREQUISITE_SKIPPED",
          handlingPath,
          "The candidate says it follows known feasibility while directly attempting an action whose perceived prerequisite is still missing.",
        ));
      }
      if (surface && relationToGoal === "prerequisite_step" && stance === "follow") {
        const primitive = clean(candidate.attemptPrimitive);
        const destinationId = clean(candidate.actionBinding?.destinationId);
        const matchesKnownStep = (surface.knownPrerequisiteOptions || []).some((option) => (
          clean(option?.primitive) === primitive
          && clean(option?.destinationId) === destinationId
          && option?.currentlyAttemptable !== false
        ));
        if (!matchesKnownStep) errors.push(issue(
          "AGENT_CANDIDATE_PREREQUISITE_STEP_MISMATCH",
          handlingPath,
          "A candidate claiming to follow a known prerequisite must bind the corresponding currently attemptable step.",
        ));
      }
      const citedSocialAccess = relationToGoal === "prerequisite_step"
        ? (surface?.knownPrerequisiteOptions || []).find((option) => (
          clean(option?.primitive) === clean(candidate.attemptPrimitive)
          && clean(option?.destinationId) === boundDestinationId
        ))?.socialAccess
        : surface?.socialAccess;
      if (citedSocialAccess?.permissionRequiredByNorm === true
        && citedSocialAccess?.permissionCurrentlyGranted === false
        && stance === "follow") {
        errors.push(issue(
          "AGENT_CANDIDATE_KNOWN_SOCIAL_PERMISSION_MISSING",
          handlingPath,
          "A candidate cannot claim to follow a known access surface while crossing a boundary whose permission is not granted. It may question, overlook or deliberately violate that norm instead.",
        ));
      }
      if (stance !== "not_applicable" && !clean(feasibilityHandling.privateReason)) errors.push(issue("AGENT_CANDIDATE_FEASIBILITY_REASON_MISSING", `${handlingPath}.privateReason`, "The Character Agent must privately state why it follows, questions, or acts against this feasibility estimate."));
    }
    if (context.requireDesireRelations === true && !Array.isArray(candidate.desireRelations)) {
      errors.push(issue("AGENT_CANDIDATE_DESIRE_RELATIONS_MISSING", `${path}.desireRelations`, "A v2.4 candidate must state how it relates to the Character Agent's desire terminal state."));
    }
    if (context.requireDesireRelations === true && !Array.isArray(candidate.domains)) {
      errors.push(issue("AGENT_CANDIDATE_DOMAINS_MISSING", `${path}.domains`, "A v2.4 candidate must identify the psychological domains it engages."));
    }
    const relationDesireIds = new Set();
    for (const [relationIndex, relation] of (candidate.desireRelations || []).entries()) {
      const relationPath = `${path}.desireRelations[${relationIndex}]`;
      const desireId = clean(relation?.desireId);
      const relationType = clean(relation?.relation);
      if (!desireId) errors.push(issue("AGENT_CANDIDATE_DESIRE_RELATION_ID_MISSING", `${relationPath}.desireId`, "A desire relation needs a desire id."));
      if (desireId && relationDesireIds.has(desireId)) errors.push(issue("AGENT_CANDIDATE_DESIRE_RELATION_DUPLICATE", `${relationPath}.desireId`, `Desire ${desireId} has more than one relation in the same candidate.`));
      relationDesireIds.add(desireId);
      if (desireId && knownDesireIds.size && !knownDesireIds.has(desireId)) errors.push(issue("AGENT_CANDIDATE_DESIRE_RELATION_UNKNOWN", `${relationPath}.desireId`, `Unknown desire ${desireId}.`));
      if (!CHARACTER_DESIRE_RELATION_TYPES.includes(relationType)) errors.push(issue("AGENT_CANDIDATE_DESIRE_RELATION_INVALID", `${relationPath}.relation`, `Unknown desire relation ${relationType}.`));
      if (!Number.isFinite(Number(relation?.terminalConditionMatch))) errors.push(issue("AGENT_CANDIDATE_TERMINAL_MATCH_INVALID", `${relationPath}.terminalConditionMatch`, "Terminal-condition match must be numeric."));
      if (!Number.isFinite(Number(relation?.confidence))) errors.push(issue("AGENT_CANDIDATE_DESIRE_RELATION_CONFIDENCE_INVALID", `${relationPath}.confidence`, "Desire-relation confidence must be numeric."));
      if (!clean(relation?.counterfactualResult)) errors.push(issue("AGENT_CANDIDATE_COUNTERFACTUAL_RESULT_MISSING", `${relationPath}.counterfactualResult`, "The Agent must state what would actually happen if this candidate fully succeeded."));
      if (typeof relation?.preservesNonSubstitutableConditions !== "boolean") errors.push(issue("AGENT_CANDIDATE_NON_SUBSTITUTABLE_CHECK_MISSING", `${relationPath}.preservesNonSubstitutableConditions`, "The Agent must check whether the desire's non-substitutable conditions remain intact."));
    }
    if (context.requireCriterionUses === true && !Array.isArray(candidate.criterionUses)) {
      errors.push(issue(
        "AGENT_CANDIDATE_CRITERION_USES_MISSING",
        `${path}.criterionUses`,
        "A candidate must explicitly list zero or more terminal criteria that the Character Agent is using as present action sources.",
      ));
    }
    const usedCriterionIds = new Set();
    for (const [criterionIndex, criterionUse] of (candidate.criterionUses || []).entries()) {
      const criterionPath = `${path}.criterionUses[${criterionIndex}]`;
      const desireId = clean(criterionUse?.desireId);
      const criterionId = clean(criterionUse?.criterionId);
      if (!desireId) errors.push(issue("AGENT_CANDIDATE_CRITERION_DESIRE_MISSING", `${criterionPath}.desireId`, "A criterion use must name its owning desire."));
      if (desireId && knownDesireIds.size && !knownDesireIds.has(desireId)) errors.push(issue("AGENT_CANDIDATE_CRITERION_DESIRE_UNKNOWN", `${criterionPath}.desireId`, `Unknown desire ${desireId}.`));
      if (!criterionId) errors.push(issue("AGENT_CANDIDATE_CRITERION_ID_MISSING", `${criterionPath}.criterionId`, "A criterion use must name its private terminal criterion."));
      if (criterionId && usedCriterionIds.has(criterionId)) errors.push(issue("AGENT_CANDIDATE_CRITERION_DUPLICATE", `${criterionPath}.criterionId`, `Criterion ${criterionId} is used more than once in this candidate.`));
      usedCriterionIds.add(criterionId);
      if (criterionId && knownCriterionIds.size && !knownCriterionIds.has(criterionId)) errors.push(issue("AGENT_CANDIDATE_CRITERION_UNKNOWN", `${criterionPath}.criterionId`, `Unknown terminal criterion ${criterionId}.`));
      const ownedForDesire = criterionIdsByDesire.get(desireId);
      if (criterionId && ownedForDesire?.size && !ownedForDesire.has(criterionId)) errors.push(issue("AGENT_CANDIDATE_CRITERION_DESIRE_MISMATCH", `${criterionPath}.criterionId`, `Criterion ${criterionId} does not belong to desire ${desireId}.`));
      if (criterionId && !currentConcernCriterionIds.has(criterionId)) errors.push(issue(
        "AGENT_CANDIDATE_CRITERION_NOT_PROMOTED",
        `${criterionPath}.criterionId`,
        `Terminal criterion ${criterionId} remains evaluation-only and was not promoted by this Character Agent as a current concern.`,
      ));
      if (!CHARACTER_DESIRE_CRITERION_USE_TYPES.includes(clean(criterionUse?.use))) errors.push(issue("AGENT_CANDIDATE_CRITERION_USE_INVALID", `${criterionPath}.use`, "Criterion use must be verify, protect, advance, or avoid_invalidation."));
      if (!clean(criterionUse?.privatePurpose)) errors.push(issue("AGENT_CANDIDATE_CRITERION_PURPOSE_MISSING", `${criterionPath}.privatePurpose`, "A criterion use needs the Character Agent's private present purpose."));
    }
    const epistemicHandling = candidate.epistemicHandling;
    if (context.requireEpistemicHandling === true && (!epistemicHandling || typeof epistemicHandling !== "object" || Array.isArray(epistemicHandling))) {
      errors.push(issue(
        "AGENT_CANDIDATE_EPISTEMIC_HANDLING_MISSING",
        `${path}.epistemicHandling`,
        "A candidate must state how this Character Agent treats any relevant uncertainty while attempting this action.",
      ));
    }
    if (epistemicHandling && typeof epistemicHandling === "object" && !Array.isArray(epistemicHandling)) {
      const handlingPath = `${path}.epistemicHandling`;
      const mode = clean(epistemicHandling.mode);
      const positionIds = unique(epistemicHandling.positionIds || []);
      if (!Array.isArray(epistemicHandling.positionIds)) errors.push(issue("AGENT_CANDIDATE_EPISTEMIC_POSITIONS_MISSING", `${handlingPath}.positionIds`, "Epistemic handling needs zero or more current position ids."));
      if (!CHARACTER_EPISTEMIC_ACTION_MODES.includes(mode)) errors.push(issue("AGENT_CANDIDATE_EPISTEMIC_MODE_INVALID", `${handlingPath}.mode`, "Unknown uncertainty-action mode."));
      if (mode === "not_relevant" && positionIds.length) errors.push(issue("AGENT_CANDIDATE_EPISTEMIC_NOT_RELEVANT_CONTRADICTION", `${handlingPath}.positionIds`, "A not-relevant handling mode cannot claim to rely on an epistemic position."));
      if (mode && mode !== "not_relevant" && !positionIds.length) errors.push(issue("AGENT_CANDIDATE_EPISTEMIC_POSITION_REQUIRED", `${handlingPath}.positionIds`, "A candidate treating uncertainty must name the Character Agent's relevant position."));
      for (const positionId of positionIds) {
        if (knownEpistemicPositionIds.size && !knownEpistemicPositionIds.has(positionId)) errors.push(issue(
          "AGENT_CANDIDATE_EPISTEMIC_POSITION_UNKNOWN",
          `${handlingPath}.positionIds`,
          `Epistemic position ${positionId} does not belong to this Character Agent's current appraisal.`,
        ));
      }
      for (const field of ["errorIfWrong", "actionReversibility", "learningDuringAction", "delayCost"]) {
        const value = Number(epistemicHandling[field]);
        if (!Number.isFinite(value) || value < 0 || value > 1) errors.push(issue("AGENT_CANDIDATE_EPISTEMIC_FACTOR_INVALID", `${handlingPath}.${field}`, `${field} must be between zero and one.`));
      }
      if (mode !== "not_relevant" && !clean(epistemicHandling.privateReason)) errors.push(issue("AGENT_CANDIDATE_EPISTEMIC_REASON_MISSING", `${handlingPath}.privateReason`, "The Character Agent must privately say how this action lives with uncertainty."));
    }
    const sharedActivity = candidate.sharedActivity;
    if (sharedActivity != null) {
      const operation = clean(sharedActivity?.operation);
      const kind = clean(sharedActivity?.kind);
      const activityId = clean(sharedActivity?.activityId);
      const existingActivity = sharedActivityById.get(activityId) || null;
      const existingStatus = clean(existingActivity?.status);
      if (!["none", "propose", "respond", "coordinate", "start", "complete", "withdraw"].includes(operation)) errors.push(issue("AGENT_CANDIDATE_SHARED_ACTIVITY_OPERATION_INVALID", `${path}.sharedActivity.operation`, "Unknown shared-activity operation."));
      if (operation !== "none" && !activityId) errors.push(issue("AGENT_CANDIDATE_SHARED_ACTIVITY_ID_MISSING", `${path}.sharedActivity.activityId`, "A shared-activity operation needs an activity id."));
      if (operation !== "none" && !kind) errors.push(issue("AGENT_CANDIDATE_SHARED_ACTIVITY_KIND_MISSING", `${path}.sharedActivity.kind`, "A negotiated shared activity needs the actual joint commitment kind."));
      if (operation !== "none" && isConversationTurnTakingOnlyKind(kind)) {
        errors.push(issue(
          "AGENT_CANDIDATE_SHARED_ACTIVITY_TURN_TAKING_ONLY",
          `${path}.sharedActivity.kind`,
          "Ordinary asking, answering, and conversation use the conversation thread; sharedActivity is only for a mutual world commitment such as sparring, escorting, cooperation, or a joint task.",
        ));
      }
      if (context.enforceSharedActivityLifecycle === true && operation !== "none" && activityId) {
        const terminalStatuses = new Set(["completed", "abandoned", "refused"]);
        if (operation === "propose" && existingActivity && !terminalStatuses.has(existingStatus)) {
          errors.push(issue(
            "AGENT_CANDIDATE_SHARED_ACTIVITY_ALREADY_LIVE",
            `${path}.sharedActivity.activityId`,
            `Shared activity ${activityId} already exists with status ${existingStatus}; continue its lifecycle instead of renegotiating it.`,
          ));
        }
        if (operation !== "propose" && !existingActivity) {
          errors.push(issue(
            "AGENT_CANDIDATE_SHARED_ACTIVITY_UNKNOWN",
            `${path}.sharedActivity.activityId`,
            `Shared activity ${activityId} is not part of this Character's current understanding.`,
          ));
        }
        const legalStatuses = {
          // A counteroffer transfers consent authority back to the other
          // participant.  The shared-activity ledger represents that state as
          // `countered`, so the pending participant must still be able to
          // answer it with the existing activity id.
          respond: new Set(["proposed", "proposed_to_me", "countered", "coordinating"]),
          coordinate: new Set(["accepted", "coordinating"]),
          start: new Set(["accepted", "coordinating"]),
          complete: new Set(["active"]),
          withdraw: new Set(["proposed", "proposed_to_me", "countered", "accepted", "coordinating", "active"]),
        };
        if (existingActivity && legalStatuses[operation] && !legalStatuses[operation].has(existingStatus)) {
          errors.push(issue(
            "AGENT_CANDIDATE_SHARED_ACTIVITY_TRANSITION_INVALID",
            `${path}.sharedActivity.operation`,
            `Operation ${operation} is not available while shared activity ${activityId} is ${existingStatus}.`,
          ));
        }
        if (existingActivity && kind && clean(existingActivity.kind) && kind !== clean(existingActivity.kind)) {
          errors.push(issue(
            "AGENT_CANDIDATE_SHARED_ACTIVITY_KIND_DRIFT",
            `${path}.sharedActivity.kind`,
            "Continuing a shared activity cannot silently change its kind.",
          ));
        }
      }
    }
    for (const [effectIndex, effect] of (candidate.expectedEffects || []).entries()) {
      const sourceId = clean(effect?.sourceId);
      if (!sourceId) {
        errors.push(issue(
          "AGENT_CANDIDATE_EFFECT_SOURCE_MISSING",
          `${path}.expectedEffects[${effectIndex}].sourceId`,
          "An expected effect needs an owned psychological source.",
        ));
      } else if (knownSourceIds.size && !knownSourceIds.has(sourceId)) {
        errors.push(issue(
          "AGENT_CANDIDATE_EFFECT_SOURCE_UNKNOWN",
          `${path}.expectedEffects[${effectIndex}].sourceId`,
          `Candidate effect cites unknown private source ${sourceId}.`,
        ));
      }
    }
    nestedForbiddenAgentProposalFields(candidate, forbidden, path, errors, "AGENT_CANDIDATE_STAGE_LEAK");
  }
  return { valid: errors.length === 0, errors };
}

function legacyCandidateGoalProgress(candidate, desireActivations) {
  const activationById = new Map((desireActivations || []).map((row) => [clean(row.desireId), unit(row.value)]));
  const effects = candidate.expectedEffects || [];
  if (!effects.length) return 0;
  let total = 0;
  let weight = 0;
  for (const effect of effects) {
    const direction = ["block", "reduce", "harm", "retreat"].includes(clean(effect.direction)) ? -1 : 1;
    const activation = activationById.get(clean(effect.sourceId)) ?? 0.5;
    const confidence = unit(effect.confidence, 0.5);
    const magnitude = unit(effect.magnitude);
    total += direction * activation * confidence * magnitude;
    weight += Math.max(0.2, activation);
  }
  return clamp(weight ? total / weight : 0, -1, 1);
}

function candidateEffectMagnitude(candidate = {}, desireId = "") {
  const rows = (candidate.expectedEffects || []).filter((row) => clean(row?.sourceId) === clean(desireId));
  if (!rows.length) return 1;
  return Math.max(...rows.map((row) => unit(row?.magnitude)));
}

function candidateDesireRelationLedger(candidate = {}, desireActivations = []) {
  const activationById = new Map((desireActivations || []).map((row) => [clean(row.desireId), unit(row.value)]));
  const relationRows = candidate.desireRelations || [];
  if (!relationRows.length) {
    const legacyGoalProgress = legacyCandidateGoalProgress(candidate, desireActivations);
    return {
      goalProgress: legacyGoalProgress,
      enablingProgress: 0,
      probeProgress: 0,
      proxySubstitution: 0,
      rows: [],
      authority: "legacy-untyped-effect-compatibility",
    };
  }
  let direct = 0;
  let enabling = 0;
  let probing = 0;
  let proxy = 0;
  let normalization = 0;
  const rows = relationRows.map((row) => {
    const desireId = clean(row?.desireId);
    const relation = clean(row?.relation);
    const activation = activationById.get(desireId) ?? 0.5;
    const confidence = unit(row?.confidence, 0.5);
    const terminalConditionMatch = unit(row?.terminalConditionMatch);
    const magnitude = candidateEffectMagnitude(candidate, desireId);
    const preserves = row?.preservesNonSubstitutableConditions === true ? 1 : 0;
    const relationCap = finite(CHARACTER_DESIRE_RELATION_CAPS[relation]);
    const base = activation * confidence * magnitude;
    // Only direct contact can count as terminal progress. Enabling and probing
    // retain their own ledgers below; folding them back into goalProgress would
    // recreate the exact proxy-goal substitution this vocabulary is meant to
    // expose. Avoidance is a real movement away from the terminal state even
    // when the candidate (correctly) reports no terminal-condition match.
    const terminalProgress = relation === "direct_contact"
      ? relationCap * terminalConditionMatch * preserves * base
      : relation === "avoid"
        ? relationCap * Math.max(0.25, 1 - terminalConditionMatch) * base
        : 0;
    const enablingProgress = relation === "enable" ? base * terminalConditionMatch * 0.58 : 0;
    const probeProgress = relation === "probe" ? base * terminalConditionMatch * 0.24 : 0;
    const proxySubstitution = relation === "substitute" ? base * (1 - terminalConditionMatch) : 0;
    direct += terminalProgress;
    enabling += enablingProgress;
    probing += probeProgress;
    proxy += proxySubstitution;
    normalization += Math.max(0.2, activation);
    return {
      desireId,
      relation,
      activation: round(activation),
      confidence: round(confidence),
      magnitude: round(magnitude),
      relationCap: round(relationCap),
      terminalConditionMatch: round(terminalConditionMatch),
      preservesNonSubstitutableConditions: Boolean(preserves),
      terminalProgress: round(terminalProgress),
      enablingProgress: round(enablingProgress),
      probeProgress: round(probeProgress),
      proxySubstitution: round(proxySubstitution),
      counterfactualResult: clean(row?.counterfactualResult),
    };
  });
  const divisor = normalization || 1;
  return {
    goalProgress: round(clamp(direct / divisor, -1, 1)),
    enablingProgress: round(clamp(enabling / divisor)),
    probeProgress: round(clamp(probing / divisor)),
    proxySubstitution: round(clamp(proxy / divisor)),
    rows,
    authority: "character-agent-typed-desire-relations",
  };
}

function candidateWeight(profile, id, candidate = {}) {
  const authoredBase = profile.candidateValuation?.weights?.[id];
  const base = Number.isFinite(Number(authoredBase)) ? Number(authoredBase) : DEFAULT_CANDIDATE_WEIGHTS[id] ?? 1;
  const domains = unique(candidate.domains || []);
  const multipliers = domains.map((domain) => {
    const value = profile.domainValuation?.[domain]?.[id];
    return Number.isFinite(Number(value)) ? Number(value) : 1;
  });
  const domainMultiplier = multipliers.length
    ? multipliers.reduce((sum, value) => sum + value, 0) / multipliers.length
    : 1;
  return {
    base,
    domains,
    domainMultiplier: clamp(domainMultiplier, 0.35, 1.8),
    effective: base * clamp(domainMultiplier, 0.35, 1.8),
  };
}

function softmax(values, temperature) {
  if (!values.length) return [];
  const safeTemperature = clamp(temperature, 0.08, 2);
  const maximum = Math.max(...values);
  const exponents = values.map((value) => Math.exp((value - maximum) / safeTemperature));
  const total = exponents.reduce((sum, value) => sum + value, 0) || 1;
  return exponents.map((value) => value / total);
}

function learningHistoryWithCurrentFeedback(state = {}, outcomeFeedback = {}) {
  const previous = Array.isArray(state.priorRegulationCarryover?.actionLearningHistory)
    ? state.priorRegulationCarryover.actionLearningHistory.map((row) => ({ ...row }))
    : [];
  if (!clean(outcomeFeedback.sourceAgentTurnId) || !clean(outcomeFeedback.semanticSignature)) return previous.slice(-12);
  if (previous.some((row) => clean(row.sourceAgentTurnId) === clean(outcomeFeedback.sourceAgentTurnId))) return previous.slice(-12);
  return [...previous, {
    sourceAgentTurnId: clean(outcomeFeedback.sourceAgentTurnId),
    sourceCandidateId: clean(outcomeFeedback.sourceCandidateId),
    semanticSignature: clean(outcomeFeedback.semanticSignature),
    perceivedInformationGain: round(unit(outcomeFeedback.perceivedInformationGain)),
    predictedInformationGain: round(unit(outcomeFeedback.predictedInformationGain)),
    informationPredictionError: round(signed(outcomeFeedback.informationPredictionError)),
    perceivedGoalProgress: round(signed(outcomeFeedback.perceivedGoalProgress)),
    predictedGoalProgress: round(signed(outcomeFeedback.predictedGoalProgress)),
    goalPredictionError: round(signed(outcomeFeedback.goalPredictionError)),
    noGain: outcomeFeedback.noGain === true,
    stillUnresolved: outcomeFeedback.stillUnresolved === true,
    evidenceNoveltyRatio: round(unit(outcomeFeedback.evidenceNoveltyRatio, 1)),
    noticedOutcomeFeatureSignatures: unique(outcomeFeedback.noticedOutcomeFeatureSignatures || []),
  }].slice(-12);
}

function consecutiveNoGainForSignature(history = [], semanticSignature = "") {
  let streak = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const row = history[index];
    if (clean(row.semanticSignature) !== semanticSignature) break;
    if (row.noGain !== true) break;
    streak += 1;
  }
  return streak;
}

function candidateLearningModifiers(candidate = {}, state = {}, profile = {}, outcomeFeedback = {}) {
  const semanticSignature = characterActionLearningSignature(candidate);
  const history = learningHistoryWithCurrentFeedback(state, outcomeFeedback);
  const sameMeansHistory = history.filter((row) => clean(row.semanticSignature) === semanticSignature);
  const noGainStreak = consecutiveNoGainForSignature(history, semanticSignature);
  const learning = behaviorLearningProfile(profile);
  const recentErrors = sameMeansHistory.slice(-3).map((row) => signed(row.informationPredictionError));
  const negativePredictionError = recentErrors.length
    ? clamp(recentErrors.reduce((sum, value) => sum + Math.max(0, -value), 0) / recentErrors.length)
    : 0;
  const persistenceProtection = 1 - learning.persistenceInsulation * 0.38;
  const compulsiveRelief = 1 - learning.compulsiveRepetitionBias * 0.82;
  const repetitionWithoutGain = clamp(
    (1 - Math.exp(-noGainStreak * 0.72))
    * learning.repetitionSensitivity
    * persistenceProtection
    * compulsiveRelief,
  );
  const currentInformationGain = unit(candidate.factorInputs?.informationGain);
  const calibratedInformationGain = clamp(
    currentInformationGain
    * (1 - negativePredictionError * learning.feedbackLearningRate * learning.predictionErrorSensitivity),
  );
  const maturedIntentions = outcomeFeedback.maturedContinuationIntentions
    || state.priorRegulationCarryover?.maturedContinuationIntentions
    || [];
  const matchingIntention = (maturedIntentions || [])
    .filter((row) => row.mature !== false && continuationIntentionMatchesCandidate(row, candidate))
    .sort((left, right) => unit(right.maturity) - unit(left.maturity))[0] || null;
  const continuationIntentionMaturity = matchingIntention
    ? unit(matchingIntention.maturity, 1) * learning.continuationCommitmentWeight
    : 0;
  return {
    semanticSignature,
    historyCount: sameMeansHistory.length,
    noGainStreak,
    rawInformationGain: round(currentInformationGain),
    calibratedInformationGain: round(calibratedInformationGain),
    repetitionWithoutGain: round(repetitionWithoutGain),
    negativePredictionError: round(negativePredictionError * learning.predictionErrorSensitivity),
    continuationIntentionMaturity: round(continuationIntentionMaturity),
    matchedContinuationIntentionId: clean(matchingIntention?.intentionId),
  };
}

/**
 * Calculate the cost and learning opportunity of an uncertainty policy already
 * authored inside one candidate. The tool never decides whether the Character
 * should trust, verify, delay or proceed.
 */
export function computeCharacterEpistemicActionAssessment({
  epistemicPositions = [],
  epistemicHandling = {},
} = {}) {
  const mode = clean(epistemicHandling?.mode || "not_relevant");
  const parameters = CHARACTER_EPISTEMIC_ACTION_PARAMETERS[mode]
    || CHARACTER_EPISTEMIC_ACTION_PARAMETERS.not_relevant;
  const positionsById = new Map((epistemicPositions || [])
    .map((row) => [clean(row?.positionId), row])
    .filter(([id]) => id));
  const referenced = unique(epistemicHandling?.positionIds || [])
    .map((id) => positionsById.get(id))
    .filter(Boolean);
  const meanUncertainty = referenced.length
    ? referenced.reduce((sum, row) => sum + (1 - unit(row?.confidence)), 0) / referenced.length
    : 0;
  const errorIfWrong = unit(epistemicHandling?.errorIfWrong);
  const reversibility = unit(epistemicHandling?.actionReversibility);
  const learningDuringAction = unit(epistemicHandling?.learningDuringAction);
  const authoredDelayCost = unit(epistemicHandling?.delayCost);
  const epistemicRisk = clamp(
    meanUncertainty
    * errorIfWrong
    * (0.34 + (1 - reversibility) * 0.66)
    * parameters.reliance,
  );
  const learningValue = clamp(
    meanUncertainty
    * learningDuringAction
    * parameters.verification
    * (0.4 + reversibility * 0.6),
  );
  const delayCost = clamp(authoredDelayCost * parameters.delay);
  const result = {
    schemaVersion: CHARACTER_PSYCHOLOGY_TOOLS_VERSION,
    authority: "character-private-psychology-tool",
    mode,
    sourcePositionIds: referenced.map((row) => clean(row.positionId)),
    meanUncertainty: round(meanUncertainty),
    epistemicRisk: round(epistemicRisk),
    learningValue: round(learningValue),
    delayCost: round(delayCost),
    actionReversibility: round(reversibility),
    selection: null,
    realization: null,
  };
  return assertPsychologyToolAuthority(result, "computeCharacterEpistemicActionAssessment");
}

/**
 * Calculate how one Character-authored candidate relates to that Character's
 * current feasibility information. This tool never removes a candidate or
 * selects the safer action; deliberate attempts remain possible and simply
 * retain their perceived failure risk.
 */
export function computeCharacterActionFeasibilityAssessment({
  candidate = {},
  actionFeasibilities = [],
  profile = {},
} = {}) {
  const handling = candidate.feasibilityHandling || {};
  const surfaceId = clean(handling.surfaceId);
  const surface = (actionFeasibilities || []).find((row) => clean(row?.feasibilityId) === surfaceId) || null;
  const stance = clean(handling.stance || "not_applicable");
  const relationToGoal = clean(handling.relationToGoal || "unrelated");
  const knownAttemptability = surface?.directAttempt?.currentlyAttemptable
    ?? surface?.directManipulation?.currentlyAttemptable;
  const prerequisiteStepMatches = Boolean(surface && relationToGoal === "prerequisite_step"
    && (surface.knownPrerequisiteOptions || []).some((option) => (
      clean(option?.primitive) === clean(candidate.attemptPrimitive)
      && clean(option?.destinationId) === clean(candidate.actionBinding?.destinationId)
      && option?.currentlyAttemptable !== false
    )));
  const prerequisiteOption = prerequisiteStepMatches
    ? (surface?.knownPrerequisiteOptions || []).find((option) => (
      clean(option?.primitive) === clean(candidate.attemptPrimitive)
      && clean(option?.destinationId) === clean(candidate.actionBinding?.destinationId)
    )) || null
    : null;
  const socialAccess = prerequisiteOption?.socialAccess || surface?.socialAccess || null;
  const permissionConflict = socialAccess?.permissionRequiredByNorm === true
    && socialAccess?.permissionCurrentlyGranted === false;
  const personality = safeRecord(profile.personality);
  const caution = unit(personality.caution, 0.5);
  const selfControl = unit(personality.selfControl, 0.5);
  const impulsivity = unit(personality.impulsivity, 0.5);
  const socialApprovalNeed = unit(
    profile.stableDispositionProjection?.socialApprovalNeed?.level
      ?? personality.socialApprovalNeed,
    0.5,
  );
  const stanceAwareness = stance === "deliberate_attempt"
    ? 1
    : stance === "question"
      ? 0.72
      : stance === "unknown"
        ? 0.46
        : stance === "not_applicable"
          ? 0
          : 1;
  const responseTags = unique(socialAccess?.possibleResponseTags || []);
  const noticePotential = responseTags.includes("owner_may_notice") ? 0.72 : responseTags.length ? 0.55 : 0.35;
  const objectionPotential = responseTags.includes("owner_may_object") ? 0.2 : 0;
  const perceivedNormFriction = permissionConflict
    ? clamp((0.34 + caution * 0.28 + selfControl * 0.24 + (1 - impulsivity) * 0.14) * stanceAwareness)
    : 0;
  const perceivedExposureRisk = permissionConflict
    ? clamp((noticePotential + objectionPotential)
      * (0.42 + caution * 0.22 + selfControl * 0.18 + socialApprovalNeed * 0.18)
      * stanceAwareness)
    : 0;
  let feasibilitySupport = 0;
  let perceivedFailureRisk = 0;
  if (!surface || stance === "not_applicable") {
    feasibilitySupport = 0;
    perceivedFailureRisk = 0;
  } else if (prerequisiteStepMatches) {
    feasibilitySupport = stance === "follow" ? unit(surface.confidence, 0.7) : 0.18;
    perceivedFailureRisk = 0.04;
  } else if (knownAttemptability === true) {
    feasibilitySupport = stance === "follow" ? unit(surface.confidence, 0.7) : 0.18;
    perceivedFailureRisk = stance === "unknown" ? 0.15 : 0.03;
  } else if (knownAttemptability === false) {
    feasibilitySupport = stance === "question" ? 0.18 : stance === "deliberate_attempt" ? 0.06 : 0;
    perceivedFailureRisk = stance === "question"
      ? 0.58 * unit(surface.confidence, 0.7)
      : stance === "deliberate_attempt"
        ? 0.92 * unit(surface.confidence, 0.7)
        : 0.78 * unit(surface.confidence, 0.7);
  } else {
    feasibilitySupport = stance === "follow" ? 0.28 : 0.08;
    perceivedFailureRisk = stance === "unknown" ? 0.5 : 0.34;
  }
  const result = {
    schemaVersion: CHARACTER_PSYCHOLOGY_TOOLS_VERSION,
    authority: "character-private-psychology-tool",
    sourceFeasibilityId: surfaceId,
    stance,
    relationToGoal,
    knownAttemptability: typeof knownAttemptability === "boolean" ? knownAttemptability : null,
    prerequisiteStepMatches,
    feasibilitySupport: round(clamp(feasibilitySupport)),
    perceivedFailureRisk: round(clamp(perceivedFailureRisk)),
    socialAccessAssessment: {
      permissionConflict,
      permissionRequiredByNorm: socialAccess?.permissionRequiredByNorm === true,
      permissionCurrentlyGranted: socialAccess?.permissionCurrentlyGranted === true,
      violationPhysicallyPossible: socialAccess?.violationPhysicallyPossible === true,
      boundaryIds: unique(socialAccess?.boundaryIds || []),
      claimantIds: unique(socialAccess?.claimantIds || []),
      possibleResponseTags: responseTags,
      perceivedNormFriction: round(perceivedNormFriction),
      perceivedExposureRisk: round(perceivedExposureRisk),
      interpretationAuthority: "character-agent",
    },
    selection: null,
    realization: null,
  };
  return assertPsychologyToolAuthority(result, "computeCharacterActionFeasibilityAssessment");
}

/** Evaluate candidates already authored by the Character Agent; never select. */
export function evaluateCharacterAgentCandidates({
  agentTurnId = "",
  candidates = [],
  snapshot = {},
  profile = {},
  state = {},
  outcomeFeedback = {},
  candidateValidationContext = {},
} = {}) {
  const authorityValidation = validateAgentGeneratedCandidates(candidates, candidateValidationContext);
  if (!authorityValidation.valid) {
    const error = new Error("Candidate evaluation requires Character-Agent-originated candidates.");
    error.code = "CHARACTER_AGENT_CANDIDATES_REQUIRED";
    error.issues = authorityValidation.errors;
    throw error;
  }
  if (snapshot.authority !== "character-private-psychology-tool") {
    const error = new Error("Candidate evaluation requires a Character Agent private psychology snapshot.");
    error.code = "CHARACTER_PSYCHOLOGY_SNAPSHOT_REQUIRED";
    throw error;
  }
  const provisional = candidates.map((candidate) => {
    const inputs = safeRecord(candidate.factorInputs);
    const learning = candidateLearningModifiers(candidate, state, profile, outcomeFeedback);
    const desireLedger = candidateDesireRelationLedger(candidate, snapshot.desireActivations);
    const epistemicAssessment = computeCharacterEpistemicActionAssessment({
      epistemicPositions: candidateValidationContext.epistemicPositions || snapshot.epistemicPositions || [],
      epistemicHandling: candidate.epistemicHandling || { mode: "not_relevant", positionIds: [] },
    });
    const actionFeasibilityAssessment = computeCharacterActionFeasibilityAssessment({
      candidate,
      actionFeasibilities: candidateValidationContext.actionFeasibilities || [],
      profile,
    });
    const values = {
      goalProgress: desireLedger.goalProgress,
      enablingProgress: desireLedger.enablingProgress,
      probeProgress: desireLedger.probeProgress,
      proxySubstitution: desireLedger.proxySubstitution,
      ...Object.fromEntries([...CANDIDATE_POSITIVE_FACTORS, ...CANDIDATE_NEGATIVE_FACTORS]
        .filter((id) => !["goalProgress", "enablingProgress", "probeProgress", "proxySubstitution"].includes(id))
        .map((id) => [id, unit(inputs[id])])),
      informationGain: learning.calibratedInformationGain,
      continuationIntentionMaturity: learning.continuationIntentionMaturity,
      epistemicLearningValue: epistemicAssessment.learningValue,
      repetitionWithoutGain: learning.repetitionWithoutGain,
      negativePredictionError: learning.negativePredictionError,
      epistemicRisk: epistemicAssessment.epistemicRisk,
      epistemicDelayCost: epistemicAssessment.delayCost,
      perceivedFeasibilityRisk: actionFeasibilityAssessment.perceivedFailureRisk,
    };
    values.threatAndNormCost = Math.max(
      finite(values.threatAndNormCost),
      finite(actionFeasibilityAssessment.socialAccessAssessment?.perceivedNormFriction),
    );
    values.exposureAndRelationshipRisk = Math.max(
      finite(values.exposureAndRelationshipRisk),
      finite(actionFeasibilityAssessment.socialAccessAssessment?.perceivedExposureRisk),
    );
    const factorVector = [];
    const weightTrace = {};
    let expectedUtility = 0;
    for (const id of CANDIDATE_POSITIVE_FACTORS) {
      const weight = candidateWeight(profile, id, candidate);
      const contribution = finite(values[id]) * weight.effective;
      expectedUtility += contribution;
      weightTrace[id] = { base: round(weight.base), domainMultiplier: round(weight.domainMultiplier), effective: round(weight.effective) };
      factorVector.push({ id, polarity: "positive", value: round(values[id]), weight: round(weight.effective), contribution: round(contribution) });
    }
    for (const id of CANDIDATE_NEGATIVE_FACTORS) {
      const socialPressureActive = actionFeasibilityAssessment.socialAccessAssessment?.permissionConflict === true
        && ["threatAndNormCost", "exposureAndRelationshipRisk"].includes(id);
      const weight = candidateWeight(
        profile,
        id,
        socialPressureActive ? { ...candidate, domains: ["social"] } : candidate,
      );
      const contribution = -finite(values[id]) * weight.effective;
      expectedUtility += contribution;
      weightTrace[id] = { base: round(weight.base), domainMultiplier: round(weight.domainMultiplier), effective: round(weight.effective) };
      factorVector.push({ id, polarity: "negative", value: round(values[id]), weight: round(weight.effective), contribution: round(contribution) });
    }
    for (const id of CANDIDATE_LEARNING_POSITIVE_FACTORS) {
      const weight = candidateWeight(profile, id, candidate);
      const contribution = finite(values[id]) * weight.effective;
      expectedUtility += contribution;
      weightTrace[id] = { base: round(weight.base), domainMultiplier: round(weight.domainMultiplier), effective: round(weight.effective) };
      factorVector.push({ id, polarity: "positive", value: round(values[id]), weight: round(weight.effective), contribution: round(contribution) });
    }
    for (const id of CANDIDATE_LEARNING_NEGATIVE_FACTORS) {
      const weight = candidateWeight(profile, id, candidate);
      const contribution = -finite(values[id]) * weight.effective;
      expectedUtility += contribution;
      weightTrace[id] = { base: round(weight.base), domainMultiplier: round(weight.domainMultiplier), effective: round(weight.effective) };
      factorVector.push({ id, polarity: "negative", value: round(values[id]), weight: round(weight.effective), contribution: round(contribution) });
    }
    const uncertainty = clamp((unit(candidate.uncertainty) + unit(snapshot.uncertainty)) / 2);
    const spread = uncertainty * (0.35 + Math.abs(expectedUtility) * 0.18);
    return {
      candidateId: clean(candidate.candidateId),
      utilityRange: {
        low: round(expectedUtility - spread),
        expected: round(expectedUtility),
        high: round(expectedUtility + spread),
      },
      expectedUtility: round(expectedUtility),
      factorVector,
      desireRelationLedger: desireLedger,
      weightTrace: {
        domains: unique(candidate.domains || []),
        factors: weightTrace,
      },
      uncertainty: round(uncertainty),
      predictedTendencyProbability: 0,
      conflicts: factorVector.filter((row) => row.polarity === "negative" && Math.abs(row.contribution) >= 0.35).map((row) => row.id),
      unmodeledFactorRisk: round(clamp(0.12 + uncertainty * 0.58)),
      learningTrace: learning,
      epistemicAssessment,
      actionFeasibilityAssessment,
    };
  });
  const probabilities = softmax(
    provisional.map((row) => row.expectedUtility),
    unit(profile.candidateValuation?.temperature, 0.65),
  );
  const evaluations = provisional.map((row, index) => ({
    ...row,
    predictedTendencyProbability: round(probabilities[index]),
  }));
  // Preserve an exact normalized sum after rounding without implying selection.
  if (evaluations.length) {
    const roundedTotal = evaluations.reduce((sum, row) => sum + row.predictedTendencyProbability, 0);
    evaluations[evaluations.length - 1].predictedTendencyProbability = round(
      evaluations[evaluations.length - 1].predictedTendencyProbability + (1 - roundedTotal),
    );
  }
  const result = {
    schemaVersion: CHARACTER_PSYCHOLOGY_TOOLS_VERSION,
    authority: "character-private-psychology-tool",
    agentTurnId: clean(agentTurnId || snapshot.agentTurnId),
    evaluations,
    selection: null,
    factorLedger: {
      formula: "typed terminal-desire contact + enabling/probe information + Character-Agent-entered gains and costs, with recipient-known feasibility used only to estimate failure risk rather than create reward; domain-specific uncertainty risk, learning-while-acting value, delay cost, proxy substitution, perceived prediction error and no-gain repetition stay separate",
      weightSource: "character-profile",
      candidateSource: "character-agent",
      desireRelationCaps: structuredClone(CHARACTER_DESIRE_RELATION_CAPS),
    },
  };
  return assertPsychologyToolAuthority(result, "evaluateCharacterAgentCandidates");
}

function strategyEffectiveness(strategyRow, profile, snapshot, emotionValue) {
  const strategy = clean(strategyRow.strategy);
  const skill = unit(profile.regulation?.strategySkills?.[strategy], 0.45);
  const effort = unit(strategyRow.effort);
  const contextFit = unit(strategyRow.contextFit, 0.5);
  const overload = Math.max(0, effort - unit(snapshot.controlCapacity));
  return clamp(
    unit(snapshot.controlCapacity) * 0.5
    + skill * 0.28
    + contextFit * 0.18
    + effort * 0.2
    - emotionValue * 0.18
    - overload * 0.36,
  );
}

function mergedLeakageWeights(profile, channel) {
  return {
    ...(DEFAULT_LEAKAGE_MODELS[channel] || {}),
    ...(profile.leakage?.channels?.[channel]?.emotionWeights || {}),
  };
}

/** Compute the residue of a regulation choice already made by the Agent. */
export function computeCharacterRegulationOutcome({
  agentTurnId = "",
  snapshot = {},
  profile = {},
  state = {},
  regulationChoice = {},
} = {}) {
  if (regulationChoice.ownerAuthority !== "character-agent") {
    const error = new Error("Regulation choice must belong to the Character Agent.");
    error.code = "CHARACTER_REGULATION_AUTHORITY_REQUIRED";
    throw error;
  }
  const allowedStrategies = new Set(CHARACTER_PSYCHOLOGY_REGULATION_STRATEGIES);
  const strategies = (regulationChoice.strategies || []).filter((row) => allowedStrategies.has(clean(row?.strategy)));
  const originals = emotionMap(snapshot);
  let regulationCost = 0;
  let reboundRisk = 0;
  const effectiveRegulation = [];
  const residualEmotion = CHARACTER_PSYCHOLOGY_EMOTION_IDS.map((emotionId) => {
    const original = unit(originals[emotionId]);
    const applicable = strategies.filter((row) => {
      const targets = unique(row.targetEmotionIds || []);
      return !targets.length || targets.includes(emotionId);
    });
    let retained = 1;
    const applied = [];
    for (const row of applicable) {
      const strategy = clean(row.strategy);
      const effort = unit(row.effort);
      const effectiveness = strategyEffectiveness(row, profile, snapshot, original);
      const reduction = clamp(effort * effectiveness);
      retained *= (1 - reduction);
      const failureRate = 1 - effectiveness;
      const strategyCost = (STRATEGY_COSTS[strategy] ?? 0.3) * effort * original * (1 + failureRate);
      regulationCost += strategyCost;
      if (["suppress", "conceal"].includes(strategy)) reboundRisk += effort * original * failureRate * 0.24;
      applied.push({ strategy, effort: round(effort), effectiveness: round(effectiveness), reduction: round(reduction) });
    }
    const rebound = applicable.some((row) => ["suppress", "conceal"].includes(clean(row.strategy)))
      ? clamp(reboundRisk * 0.08)
      : 0;
    const value = clamp(original * retained + rebound);
    effectiveRegulation.push({ emotionId, applied, retainedFraction: round(retained) });
    return { emotionId, before: round(original), value: round(value), rebound: round(rebound) };
  });
  regulationCost = clamp(regulationCost / Math.max(1, CHARACTER_PSYCHOLOGY_EMOTION_IDS.length * 0.35));
  reboundRisk = clamp(reboundRisk);
  const residuals = Object.fromEntries(residualEmotion.map((row) => [row.emotionId, row.value]));
  const remainingControl = clamp(unit(snapshot.controlCapacity) - regulationCost * 0.58);
  const channelLeakagePressures = {};
  for (const channel of CHARACTER_PSYCHOLOGY_LEAKAGE_CHANNELS) {
    const weights = mergedLeakageWeights(profile, channel);
    const emotionalPressure = Object.entries(weights).reduce((sum, [emotionId, weight]) => (
      sum + unit(residuals[emotionId]) * finite(weight)
    ), 0);
    const baseline = unit(profile.leakage?.channels?.[channel]?.baseline, 0.06);
    const maskingSkill = unit(profile.leakage?.maskingSkills?.[channel], 0.45);
    const value = clamp(
      baseline
      + emotionalPressure
      + unit(snapshot.affectSummary?.arousal) * 0.2
      + bodyValue(state, "instability") * 0.16
      - maskingSkill * 0.22
      - remainingControl * 0.16,
    );
    channelLeakagePressures[channel] = round(value);
  }
  const result = {
    schemaVersion: CHARACTER_PSYCHOLOGY_TOOLS_VERSION,
    authority: "character-private-psychology-tool",
    agentTurnId: clean(agentTurnId || snapshot.agentTurnId),
    sourceRegulationChoiceId: clean(regulationChoice.regulationChoiceId),
    effectiveRegulation,
    residualEmotion,
    channelLeakagePressures,
    regulationCost: round(regulationCost),
    remainingControl: round(remainingControl),
    reboundRisk: round(reboundRisk),
    selection: null,
    realization: null,
  };
  return assertPsychologyToolAuthority(result, "computeCharacterRegulationOutcome");
}

function normalizedContinuationIntention(row = {}, {
  createdAtCharacterSeconds = 0,
  baselineEvidenceIds = [],
} = {}) {
  return {
    ownerAuthority: "character-agent",
    intentionId: clean(row.intentionId),
    triggerType: clean(row.triggerType),
    intendedPrimitive: clean(row.intendedPrimitive),
    targetHandle: clean(row.targetHandle),
    linkedSourceIds: unique(row.linkedSourceIds || []),
    minimumDelaySeconds: Math.max(0, finite(row.minimumDelaySeconds)),
    triggerThreshold: round(unit(row.triggerThreshold, 0.5)),
    maxDeferrals: Math.max(0, Math.min(6, Math.round(finite(row.maxDeferrals, 2)))),
    deferrals: Math.max(0, Math.round(finite(row.deferrals))),
    privatePurpose: clean(row.privatePurpose),
    createdAtCharacterSeconds: Math.max(0, finite(row.createdAtCharacterSeconds, createdAtCharacterSeconds)),
    baselineEvidenceIds: unique(row.baselineEvidenceIds?.length ? row.baselineEvidenceIds : baselineEvidenceIds),
    status: clean(row.status || "active"),
  };
}

function carryContinuationIntentions(previous = {}, snapshot = {}, agentChoice = {}, selectedCandidate = {}, worldTimeSeconds = 0) {
  const maturedById = new Map((snapshot.maturedContinuationIntentions || []).map((row) => [clean(row.intentionId), row]));
  const surviving = [];
  for (const raw of previous.continuationIntentions || []) {
    const intention = normalizedContinuationIntention(raw);
    if (!intention.intentionId || intention.status !== "active") continue;
    if (continuationIntentionMatchesCandidate(intention, selectedCandidate)) continue;
    if (maturedById.get(intention.intentionId)?.mature) intention.deferrals += 1;
    if (intention.deferrals > intention.maxDeferrals) continue;
    surviving.push(intention);
  }
  const newRows = (agentChoice.continuationIntentions || [])
    .map((row) => normalizedContinuationIntention(row, {
      createdAtCharacterSeconds: worldTimeSeconds,
      baselineEvidenceIds: snapshot.sourceNoticedEvidenceIds || [],
    }))
    .filter((row) => row.intentionId && CHARACTER_CONTINUATION_TRIGGER_TYPES.includes(row.triggerType));
  return [...new Map([...surviving, ...newRows].map((row) => [row.intentionId, row])).values()].slice(-3);
}

function appendActionLearningHistory(previous = {}, feedback = {}) {
  const rows = Array.isArray(previous.actionLearningHistory)
    ? previous.actionLearningHistory.map((row) => ({ ...row }))
    : [];
  if (!clean(feedback.sourceAgentTurnId) || !clean(feedback.semanticSignature)) return rows.slice(-12);
  if (rows.some((row) => clean(row.sourceAgentTurnId) === clean(feedback.sourceAgentTurnId))) return rows.slice(-12);
  rows.push({
    sourceAgentTurnId: clean(feedback.sourceAgentTurnId),
    sourceCandidateId: clean(feedback.sourceCandidateId),
    semanticSignature: clean(feedback.semanticSignature),
    perceivedInformationGain: round(unit(feedback.perceivedInformationGain)),
    predictedInformationGain: round(unit(feedback.predictedInformationGain)),
    informationPredictionError: round(signed(feedback.informationPredictionError)),
    perceivedGoalProgress: round(signed(feedback.perceivedGoalProgress)),
    predictedGoalProgress: round(signed(feedback.predictedGoalProgress)),
    goalPredictionError: round(signed(feedback.goalPredictionError)),
    noGain: feedback.noGain === true,
    stillUnresolved: feedback.stillUnresolved === true,
    evidenceNoveltyRatio: round(unit(feedback.evidenceNoveltyRatio, 1)),
    noticedOutcomeFeatureSignatures: unique(feedback.noticedOutcomeFeatureSignatures || []),
  });
  return rows.slice(-12);
}

/**
 * Carry only consequences that already belong to this character across turns.
 *
 * Regulation cost and residual affect come from the Agent's own regulation.
 * Prediction error comes from the Agent's next subjective outcome appraisal.
 * Objective resolution is retained as pending evidence only; it still cannot
 * infer satisfaction, frustration, relationship change or identity change.
 */
export function advanceCharacterPsychologyCarryover({
  previous = {},
  snapshot = {},
  regulationOutcome = {},
  profile = {},
  objectiveOutcome = null,
  selectedCandidate = null,
  selectedEvaluation = null,
  agentChoice = {},
  worldTimeSeconds = 0,
} = {}) {
  if (snapshot.authority !== "character-private-psychology-tool") {
    const error = new Error("Psychology carryover requires a Character Agent private psychology snapshot.");
    error.code = "CHARACTER_PSYCHOLOGY_CARRYOVER_SNAPSHOT_REQUIRED";
    throw error;
  }
  if (regulationOutcome.authority !== "character-private-psychology-tool") {
    const error = new Error("Psychology carryover requires a Character Agent private regulation outcome.");
    error.code = "CHARACTER_PSYCHOLOGY_CARRYOVER_REGULATION_REQUIRED";
    throw error;
  }
  const previousMood = safeRecord(previous.mood);
  const affect = safeRecord(snapshot.affectSummary);
  const residualEmotion = (regulationOutcome.residualEmotion || []).map((row) => ({
    emotionId: clean(row?.emotionId),
    value: round(unit(row?.value)),
    rebound: round(unit(row?.rebound)),
  })).filter((row) => row.emotionId);
  const residualPeak = Math.max(0, ...residualEmotion.map((row) => row.value));
  const regulationCost = unit(regulationOutcome.regulationCost);
  const reboundRisk = unit(regulationOutcome.reboundRisk);
  const previousLoad = unit(previous.cognitiveLoad);
  const previousDepletion = unit(previous.controlDepletion);
  const previousRebound = unit(previous.reboundPressure);
  const learning = behaviorLearningProfile(profile);
  const nextCognitiveLoad = clamp(
    previousLoad * 0.72
    + regulationCost * (0.25 + learning.regulationDebtSensitivity * 0.3),
  );
  const nextControlDepletion = clamp(
    previousDepletion * 0.62
    + regulationCost * (0.28 + learning.regulationDebtSensitivity * 0.42),
  );
  const nextReboundPressure = clamp(previousRebound * 0.7 + reboundRisk * 0.5);
  const feedback = safeRecord(snapshot.priorActionOutcomeFeedback);
  const actionLearningHistory = appendActionLearningHistory(previous, feedback);
  const candidate = safeRecord(selectedCandidate);
  const evaluation = safeRecord(selectedEvaluation);
  const semanticSignature = clean(candidate.candidateId)
    ? characterActionLearningSignature(candidate)
    : "";
  const predictedGoalProgress = signed((evaluation.factorVector || [])
    .find((row) => row?.id === "goalProgress")?.value);
  const normalizedWorldTime = Math.max(0, finite(worldTimeSeconds, previous.lastCharacterElapsedSeconds));
  const continuationIntentions = carryContinuationIntentions(
    previous,
    snapshot,
    agentChoice,
    candidate,
    normalizedWorldTime,
  );
  const strongestDesire = Math.max(0, ...(snapshot.desireActivations || []).map((row) => unit(row?.value)));
  const unresolvedPressure = unit(feedback.unresolvedPressure);
  const internalWakePressure = clamp(
    strongestDesire * 0.55
    + unresolvedPressure * 0.25
    + nextControlDepletion * 0.16
    + nextReboundPressure * 0.12
    + regulationCost * 0.1,
  );
  const result = {
    schemaVersion: CHARACTER_PSYCHOLOGY_TOOLS_VERSION,
    authority: "character-private-psychology-state-transition",
    lastAgentTurnId: clean(snapshot.agentTurnId || regulationOutcome.agentTurnId),
    mood: {
      valence: round(clamp(signed(previousMood.valence) * 0.55 + signed(affect.valence) * 0.45, -1, 1)),
      arousal: round(clamp(unit(previousMood.arousal) * 0.5 + unit(affect.arousal) * 0.3 + residualPeak * 0.2)),
    },
    cognitiveLoad: round(nextCognitiveLoad),
    controlDepletion: round(nextControlDepletion),
    reboundPressure: round(nextReboundPressure),
    remainingControl: round(unit(regulationOutcome.remainingControl)),
    residualEmotion,
    epistemicPositions: structuredClone(snapshot.epistemicPositions || []),
    channelLeakagePressures: Object.fromEntries(Object.entries(regulationOutcome.channelLeakagePressures || {})
      .map(([id, value]) => [id, round(unit(value))])),
    internalWakePressure: round(internalWakePressure),
    lastCharacterElapsedSeconds: round(normalizedWorldTime),
    actionLearningHistory,
    lastPerceivedOutcomeFeedback: clean(feedback.sourceAgentTurnId) ? structuredClone(feedback) : null,
    pendingActionForecast: semanticSignature ? {
      authority: "character-agent-owned-prediction-record",
      sourceAgentTurnId: clean(snapshot.agentTurnId),
      sourceCandidateId: clean(candidate.candidateId),
      semanticSignature,
      attemptPrimitive: clean(candidate.attemptPrimitive),
      targetHandle: clean(candidate.targetHandle),
      linkedSourceIds: candidateLinkedSourceIds(candidate),
      predictedInformationGain: round(unit(candidate.factorInputs?.informationGain)),
      predictedGoalProgress: round(predictedGoalProgress),
      predictedUtility: round(finite(evaluation.expectedUtility)),
      knownEvidenceIdsAtChoice: unique(snapshot.sourceNoticedEvidenceIds || []),
      createdAtCharacterSeconds: round(normalizedWorldTime),
      requiresCharacterAppraisal: true,
    } : null,
    continuationIntentions,
    maturedContinuationIntentions: structuredClone(snapshot.maturedContinuationIntentions || []),
    pendingObjectiveOutcome: objectiveOutcome && typeof objectiveOutcome === "object" ? {
      authority: "world-resolution",
      outcomeId: clean(objectiveOutcome.outcomeId),
      status: clean(objectiveOutcome.status),
      committed: Boolean(objectiveOutcome.committed),
      visibleOutcome: clean(objectiveOutcome.visibleOutcome),
      failureCodes: unique(objectiveOutcome.failureCodes || []),
      requiresCharacterAppraisal: true,
      inferredSatisfaction: null,
      inferredRelationshipChange: null,
    } : null,
    forbiddenInference: {
      desireSatisfactionNotInferred: true,
      frustrationNotInferred: true,
      relationshipChangeNotInferred: true,
      identityRevisionNotInferred: true,
    },
  };
  return assertPsychologyToolAuthority(result, "advanceCharacterPsychologyCarryover");
}

/** Validate the final decision while preserving the Character Agent's freedom. */
export function validateCharacterAgentDecisionV3(decision = {}, context = {}) {
  const errors = [];
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    return { valid: false, errors: [issue("AGENT_DECISION_MISSING", "decision", "Character Agent decision must be an object.")] };
  }
  if (decision.ownerAuthority !== "character-agent") {
    errors.push(issue("AGENT_DECISION_AUTHORITY_INVALID", "ownerAuthority", "Only the Character Agent may own the final decision."));
  }
  const candidateIds = asSet(context.candidateIds?.length
    ? context.candidateIds
    : (decision.generatedCandidates || []).map((row) => row?.candidateId));
  const selectedCandidateId = clean(decision.selectedCandidateId);
  if (!selectedCandidateId || !candidateIds.has(selectedCandidateId)) {
    errors.push(issue("AGENT_DECISION_CANDIDATE_UNKNOWN", "selectedCandidateId", "Final choice must reference one candidate generated by this Character Agent."));
  }
  if (Object.prototype.hasOwnProperty.call(decision, "worldOutcome")) {
    errors.push(issue("AGENT_DECISION_WORLD_OUTCOME_FORBIDDEN", "worldOutcome", "A Character Agent owns an attempt, not the world's outcome."));
  }
  if (decision.regulationChoice?.ownerAuthority !== "character-agent") {
    errors.push(issue("AGENT_DECISION_REGULATION_AUTHORITY_INVALID", "regulationChoice.ownerAuthority", "Regulation choice must belong to this Character Agent."));
  }
  if (!decision.goalPreservation || typeof decision.goalPreservation !== "object" || Array.isArray(decision.goalPreservation)) {
    errors.push(issue("AGENT_DECISION_GOAL_PRESERVATION_MISSING", "goalPreservation", "Final choice must retain the Character Agent's account of whether regulation preserved or replaced the desire."));
  }
  if (!Array.isArray(decision.emotionHandling)) {
    errors.push(issue("AGENT_DECISION_EMOTION_HANDLING_MISSING", "emotionHandling", "The Character Agent must account for residual affect before realization."));
  } else {
    const handlingModes = new Set(["expressed", "displaced", "masked", "unavailable"]);
    for (const [index, row] of decision.emotionHandling.entries()) {
      if (!handlingModes.has(clean(row?.handling))) {
        errors.push(issue("AGENT_DECISION_EMOTION_HANDLING_INVALID", `emotionHandling[${index}].handling`, "Unknown residual-affect handling mode."));
      }
    }
  }
  for (const field of ["communicationPlan", "speechRealizationPlan", "embodiedIntent", "utterance", "actionAttempt"]) {
    if (!decision[field] || typeof decision[field] !== "object" || Array.isArray(decision[field])) {
      errors.push(issue("AGENT_DECISION_LAYER_MISSING", field, `Final Character Agent decision needs ${field}.`));
    }
  }
  if (!clean(decision.privateDecisionBasis)) {
    errors.push(issue("AGENT_DECISION_PRIVATE_BASIS_MISSING", "privateDecisionBasis", "Final choice needs a private basis, never an obligatory public explanation."));
  }
  return { valid: errors.length === 0, errors };
}
