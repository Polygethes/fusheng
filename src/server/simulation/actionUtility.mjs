/**
 * Generic, deterministic action utility.
 *
 * Scene adapters provide candidates and normalized signals; this module knows
 * nothing about story-specific actors, places, duties, or dialogue. Every
 * candidate is evaluated by the same formula. Individual variation comes only
 * from actor weights, traits, momentary state, relationships, environment, and
 * interaction obligations supplied as data.
 */

export const ACTION_UTILITY_FORMULA_VERSION = "generic-action-utility-v3";

const POSITIVE_FACTOR_IDS = [
  "desire",
  "duty",
  "opportunity",
  "relationshipPull",
  "emotionalPull",
  "traumaDrive",
  "bodyReward",
  "commitmentPressure",
  "commitmentPriority",
];

const NEGATIVE_FACTOR_IDS = [
  "safetyCost",
  "bodyCost",
  "environmentFriction",
  "socialInhibition",
  "relationshipHarmCost",
  "switchingCost",
  "repetitionPenalty",
];

const DEFAULT_WEIGHTS = Object.freeze({
  desire: 1,
  duty: 1,
  opportunity: 1,
  relationshipPull: 1,
  emotionalPull: 1,
  traumaDrive: 1,
  bodyReward: 1,
  commitmentPressure: 1,
  commitmentPriority: 12,
  safetyCost: 1,
  bodyCost: 1,
  environmentFriction: 1,
  socialInhibition: 1,
  relationshipHarmCost: 1,
  switchingCost: 1,
  repetitionPenalty: 1,
});

const FACTOR_LABELS = Object.freeze({
  desire: "current desire fit",
  duty: "role and duty pull",
  opportunity: "environmental opportunity",
  relationshipPull: "relationship pull",
  emotionalPull: "current emotion pull",
  traumaDrive: "trauma-triggered impulse after relationship regulation",
  bodyReward: "current bodily need relieved by the proposed action",
  commitmentPressure: "commitment pressure",
  commitmentPriority: "delivered request response priority",
  safetyCost: "safety cost",
  bodyCost: "body cost after current-state amplification",
  environmentFriction: "environmental friction",
  socialInhibition: "social inhibition",
  relationshipHarmCost: "anticipated relationship harm",
  switchingCost: "intention switching cost",
  repetitionPenalty: "recent repetition penalty",
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, finite(value)));
}

/** Accept either 0..1 or 0..100 simulation data without scene-specific glue. */
function normalized(value, { allowNegative = false } = {}) {
  let number = finite(value);
  if (Math.abs(number) > 1 && Math.abs(number) <= 100) number /= 100;
  return allowNegative ? Math.max(-1, Math.min(1, number)) : clamp(number);
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round((finite(value) + Number.EPSILON) * scale) / scale;
}

function actorIdOf(actor) {
  return String(actor?.id || actor?.actorId || actor?.characterId || "");
}

function targetIdOf(candidate) {
  return String(candidate?.targetActorId || candidate?.targetCharacterId || candidate?.targetId || "");
}

function candidateIdOf(candidate, index) {
  return String(candidate?.id || candidate?.candidateId || candidate?.actionId || `candidate-${index + 1}`);
}

function signal(candidate, id, fallback = 0) {
  const sources = [candidate?.factors, candidate?.signals, candidate?.factorInputs, candidate];
  for (const source of sources) {
    if (source && Object.prototype.hasOwnProperty.call(source, id)) return source[id];
  }
  return fallback;
}

function level(source, keys, fallback = 0) {
  for (const key of keys) {
    if (source && Object.prototype.hasOwnProperty.call(source, key)) return normalized(source[key]);
  }
  return fallback;
}

function weightFor(actor, candidate, id) {
  const candidateWeights = candidate?.weights || candidate?.factorWeights || {};
  const actorWeights = actor?.weights || actor?.actionWeights || actor?.utilityWeights || {};
  if (Number.isFinite(Number(candidateWeights[id]))) return Number(candidateWeights[id]);
  if (Number.isFinite(Number(actorWeights[id]))) return Number(actorWeights[id]);
  return DEFAULT_WEIGHTS[id] ?? 1;
}

function relationshipFor(actor, candidate, relationships) {
  const actorId = actorIdOf(actor);
  const targetId = targetIdOf(candidate);
  if (!actorId || !targetId) return null;
  const rows = Array.isArray(relationships)
    ? relationships
    : Object.values(relationships || {}).flatMap((value) => (Array.isArray(value) ? value : [value]));
  const forward = rows.find((relationship) => {
    const from = String(
      relationship?.fromActorId
      || relationship?.sourceActorId
      || relationship?.actorId
      || relationship?.fromCharacterId
      || "",
    );
    const to = String(
      relationship?.toActorId
      || relationship?.targetActorId
      || relationship?.targetId
      || relationship?.toCharacterId
      || "",
    );
    return from === actorId && to === targetId;
  });
  // Relationship state is directional. A scene adapter that owns a genuinely
  // symmetric bond must provide both directed rows explicitly.
  return forward || null;
}

function relationshipState(relationship) {
  if (!relationship) return { closeness: 0, trust: 0, care: 0, affinity: 0, conflict: 0 };
  const closeness = level(relationship, ["closeness", "intimacy", "bond"]);
  const trust = level(relationship, ["trust"]);
  const care = level(relationship, ["care", "attachment", "affection"]);
  const conflict = level(relationship, ["conflict", "hostility", "resentment"]);
  const available = [
    ["closeness", "intimacy", "bond"].some((key) => Object.prototype.hasOwnProperty.call(relationship, key)) ? closeness : null,
    Object.prototype.hasOwnProperty.call(relationship, "trust") ? trust : null,
    ["care", "attachment", "affection"].some((key) => Object.prototype.hasOwnProperty.call(relationship, key)) ? care : null,
  ].filter((value) => value !== null);
  const affinity = available.length
    ? available.reduce((sum, value) => sum + value, 0) / available.length
    : 0;
  return { closeness, trust, care, affinity: clamp(affinity), conflict };
}

function atmosphereState(context) {
  const atmosphere = context?.atmosphere || context?.environment?.atmosphere || {};
  return {
    danger: Math.max(
      level(atmosphere, ["danger", "threat", "hostility"]),
      level(atmosphere, ["stormRisk", "hazard"]),
    ),
    crowding: level(atmosphere, ["crowding", "crowd", "publicness"]),
    privacy: level(atmosphere, ["privacy"], 0.5),
    opportunity: level(atmosphere, ["opportunity", "affordanceAvailability"]),
    urgency: level(atmosphere, ["urgency", "pressure"]),
  };
}

function currentState(actor) {
  const state = actor?.state || actor?.currentState || {};
  const body = actor?.bodyState || state?.body || {};
  const emotion = actor?.emotionalState || state?.emotion || {};
  return {
    fatigue: Math.max(level(state, ["fatigue"]), level(body, ["fatigue"])),
    hunger: Math.max(level(state, ["hunger"]), level(body, ["hunger"])),
    pain: Math.max(level(state, ["pain"]), level(body, ["pain"])),
    arousal: Math.max(level(state, ["arousal"]), level(emotion, ["arousal", "intensity"])),
    traumaActivation: Math.max(
      level(state, ["traumaActivation", "traumaTrigger", "triggerActivation"]),
      level(emotion, ["traumaActivation", "triggerActivation"]),
    ),
  };
}

function traitState(actor) {
  const traits = actor?.traits || actor?.personality || {};
  return {
    impulsivity: level(traits, ["impulsivity", "impulse"]),
    conscientiousness: level(traits, ["conscientiousness", "diligence", "responsibility"], 0.5),
    caution: level(traits, ["caution", "riskAversion"], 0.5),
    attachmentSensitivity: level(traits, ["attachmentSensitivity", "attachment", "relationalSensitivity"], 0.5),
  };
}

function pendingInteractions(context) {
  return Array.isArray(context?.pendingInteractions)
    ? context.pendingInteractions
    : Array.isArray(context?.requests)
      ? context.requests
      : [];
}

function matchingPendingRequest(actor, candidate, context) {
  const responseId = String(
    candidate?.respondsToRequestId
    || candidate?.requestId
    || candidate?.interactionRequestId
    || "",
  );
  if (!responseId) return null;
  const actorId = actorIdOf(actor);
  return pendingInteractions(context).find((request) => (
    String(request?.id || "") === responseId
    && ["awaiting", "unresolved"].includes(String(request?.status || "awaiting"))
    && (!request?.responderId || String(request.responderId) === actorId)
  )) || null;
}

function currentIntention(actor, context) {
  return context?.currentIntention || actor?.currentIntention || actor?.intention || null;
}

function derivedSwitchingCost(actor, candidate, context) {
  const explicit = normalized(signal(candidate, "switchingCost"));
  if (explicit > 0) return explicit;
  const intention = currentIntention(actor, context);
  if (!intention || typeof intention !== "object") return 0;
  const candidateAction = String(candidate?.actionKind || candidate?.kind || candidate?.id || "");
  const intentionAction = String(intention?.actionKind || intention?.candidateId || intention?.actionId || "");
  const candidateTarget = targetIdOf(candidate);
  const intentionTarget = String(intention?.targetActorId || intention?.targetCharacterId || intention?.targetId || "");
  const changedAction = Boolean(intentionAction && candidateAction && intentionAction !== candidateAction);
  const changedTarget = Boolean(intentionTarget && candidateTarget && intentionTarget !== candidateTarget);
  if (!changedAction && !changedTarget) return 0;
  const strength = normalized(intention?.retainedStrength ?? intention?.strength ?? 0.5);
  const ageSeconds = Math.max(0, finite(intention?.ageSeconds));
  const halfLifeSeconds = Math.max(1, finite(intention?.halfLifeSeconds, 180));
  const retention = Math.exp(-Math.LN2 * ageSeconds / halfLifeSeconds);
  return clamp(strength * retention * ((changedAction ? 0.7 : 0) + (changedTarget ? 0.3 : 0)));
}

function derivedRepetitionPenalty(actor, candidate, context) {
  const explicit = normalized(signal(candidate, "repetitionPenalty"));
  if (explicit > 0) return explicit;
  const recentActions = Array.isArray(context?.recentActions)
    ? context.recentActions
    : Array.isArray(actor?.recentActions)
      ? actor.recentActions
      : [];
  const candidateId = String(candidate?.id || candidate?.candidateId || "");
  const actionKind = String(candidate?.actionKind || candidate?.kind || "");
  const repeated = recentActions.filter((action) => (
    (candidateId && String(action?.candidateId || action?.id || "") === candidateId)
    || (actionKind && String(action?.actionKind || action?.kind || "") === actionKind)
  )).length;
  return clamp(repeated * 0.22);
}

function hardGateResult(candidate) {
  const gates = Array.isArray(candidate?.hardGates) ? candidate.hardGates : [];
  const failed = gates.filter((gate) => {
    if (typeof gate === "boolean") return !gate;
    return gate?.passed === false || gate?.feasible === false;
  });
  if (candidate?.feasible === false) failed.push({ id: "candidate-feasible", passed: false });
  return {
    feasible: failed.length === 0,
    blockedBy: failed.map((gate, index) => String(gate?.id || `gate-${index + 1}`)),
  };
}

function ledgerFactor({ id, rawValue, effectiveValue, weight, polarity, detail = {} }) {
  const signed = polarity === "negative" ? -1 : 1;
  const contribution = signed * finite(effectiveValue) * finite(weight, 1);
  return {
    id,
    label: FACTOR_LABELS[id] || id,
    polarity,
    rawValue: round(rawValue),
    effectiveValue: round(effectiveValue),
    weight: round(weight),
    contribution: round(contribution),
    ...detail,
  };
}

function evaluateCandidate(actor, candidate, context, index) {
  const state = currentState(actor);
  const traits = traitState(actor);
  const atmosphere = atmosphereState(context);
  const relationship = relationshipState(relationshipFor(actor, candidate, context?.relationships));
  const pendingRequest = matchingPendingRequest(actor, candidate, context);
  const isResponseObligation = Boolean(
    pendingRequest
    || candidate?.priorityClass === "response_obligation"
      && candidate?.respondsToRequestId,
  );
  const obligationPriority = normalized(candidate?.obligationPriority ?? 1);
  const isCommitmentObligation = candidate?.priorityClass === "commitment_obligation";
  const responsibilityPriority = candidate?.priorityClass === "responsibility_obligation"
    ? obligationPriority
    : 0;
  const waitingOnly = candidate?.waitingOnly === true || candidate?.producesWorldStateChange === false;
  // Priority is categorical before utility is compared. A currently delivered
  // question is the tightest local obligation; an accepted transaction or task
  // comes next; an unaccepted role responsibility comes after that; private
  // desire remains free to compete inside the ordinary tier.
  const priorityTier = waitingOnly
    ? 0
    : isResponseObligation
      ? 3
      : isCommitmentObligation
        ? 1 + obligationPriority
        : responsibilityPriority;

  const raw = {
    desire: normalized(signal(candidate, "desire")),
    duty: normalized(signal(candidate, "duty")),
    opportunity: normalized(signal(candidate, "opportunity")),
    relationshipPull: normalized(signal(candidate, "relationshipPull")),
    emotionalPull: normalized(signal(candidate, "emotionalPull")),
    traumaDrive: normalized(signal(candidate, "traumaDrive")),
    bodyReward: normalized(signal(candidate, "bodyReward")),
    commitmentPressure: normalized(signal(candidate, "commitmentPressure")),
    commitmentPriority: waitingOnly ? 0 : isResponseObligation ? 1 : isCommitmentObligation ? obligationPriority : 0,
    safetyCost: normalized(signal(candidate, "safetyCost")),
    // A cost below zero is malformed rather than an implicit body reward.
    // Recovery and relief are represented explicitly by the positive factor.
    bodyCost: normalized(signal(candidate, "bodyCost")),
    environmentFriction: normalized(signal(candidate, "environmentFriction")),
    socialInhibition: normalized(signal(candidate, "socialInhibition")),
    relationshipHarmCost: normalized(signal(candidate, "relationshipHarmCost")),
    switchingCost: derivedSwitchingCost(actor, candidate, context),
    repetitionPenalty: derivedRepetitionPenalty(actor, candidate, context),
  };

  const dutyModifier = 0.5 + 0.5 * traits.conscientiousness;
  const opportunityModifier = 1 + 0.25 * atmosphere.opportunity;
  const relationshipPullModifier = 0.5 + 0.5 * relationship.affinity;
  const emotionModifier = 0.5 + state.arousal;
  const traumaActivationModifier = state.traumaActivation;
  const impulsivityModifier = 0.5 + 0.5 * traits.impulsivity;
  const arousalModifier = 0.5 + 0.5 * state.arousal;
  // Affection regulates an impulse; it does not delete an active trigger. Even
  // at maximum affinity the drive retains at least 15% of its pre-buffer force.
  const relationshipBuffer = Math.min(
    0.85,
    relationship.affinity * (0.45 + 0.35 * traits.attachmentSensitivity),
  );
  const traumaRetention = Math.max(0.15, 1 - relationshipBuffer);
  const bodyCostModifier = 1 + 0.65 * state.fatigue + 0.35 * state.hunger + 0.50 * state.pain;
  const safetyCostModifier = 1 + 0.60 * traits.caution + 0.50 * atmosphere.danger;
  const environmentFrictionModifier = 1 + atmosphere.danger + 0.35 * atmosphere.crowding;
  const socialInhibitionModifier = 0.5 + atmosphere.crowding + 0.5 * (1 - atmosphere.privacy);
  const relationshipHarmModifier = 0.35 + 0.65 * relationship.affinity;
  const urgencyModifier = 1 + 0.25 * atmosphere.urgency;

  const effective = {
    desire: raw.desire,
    duty: raw.duty * dutyModifier,
    opportunity: raw.opportunity * opportunityModifier,
    relationshipPull: raw.relationshipPull * relationshipPullModifier,
    emotionalPull: raw.emotionalPull * emotionModifier,
    traumaDrive: raw.traumaDrive
      * traumaActivationModifier
      * impulsivityModifier
      * arousalModifier
      * traumaRetention,
    bodyReward: raw.bodyReward,
    commitmentPressure: raw.commitmentPressure * urgencyModifier,
    commitmentPriority: raw.commitmentPriority,
    safetyCost: raw.safetyCost * safetyCostModifier,
    bodyCost: raw.bodyCost * bodyCostModifier,
    environmentFriction: raw.environmentFriction * environmentFrictionModifier,
    socialInhibition: raw.socialInhibition * socialInhibitionModifier,
    relationshipHarmCost: raw.relationshipHarmCost * relationshipHarmModifier,
    switchingCost: raw.switchingCost,
    repetitionPenalty: raw.repetitionPenalty,
  };

  const detail = {
    duty: { modifier: round(dutyModifier) },
    opportunity: { modifier: round(opportunityModifier) },
    relationshipPull: { relationshipAffinity: round(relationship.affinity), modifier: round(relationshipPullModifier) },
    emotionalPull: { arousal: round(state.arousal), modifier: round(emotionModifier) },
    traumaDrive: {
      traumaActivation: round(state.traumaActivation),
      impulsivity: round(traits.impulsivity),
      arousal: round(state.arousal),
      relationshipAffinity: round(relationship.affinity),
      relationshipBuffer: round(relationshipBuffer),
      retainedAfterBuffer: round(traumaRetention),
    },
    bodyReward: {
      fatigue: round(state.fatigue),
      hunger: round(state.hunger),
      pain: round(state.pain),
    },
    commitmentPressure: { urgency: round(atmosphere.urgency), modifier: round(urgencyModifier) },
    commitmentPriority: {
      requestId: String(pendingRequest?.id || candidate?.respondsToRequestId || ""),
      priorityClass: String(candidate?.priorityClass || ""),
      obligationPriority: round(obligationPriority),
      hardPriority: !waitingOnly && (isResponseObligation || isCommitmentObligation),
      waitingOnly,
    },
    safetyCost: { caution: round(traits.caution), danger: round(atmosphere.danger), modifier: round(safetyCostModifier) },
    bodyCost: {
      fatigue: round(state.fatigue),
      hunger: round(state.hunger),
      pain: round(state.pain),
      modifier: round(bodyCostModifier),
    },
    environmentFriction: { danger: round(atmosphere.danger), crowding: round(atmosphere.crowding), modifier: round(environmentFrictionModifier) },
    socialInhibition: { crowding: round(atmosphere.crowding), privacy: round(atmosphere.privacy), modifier: round(socialInhibitionModifier) },
    relationshipHarmCost: { relationshipAffinity: round(relationship.affinity), modifier: round(relationshipHarmModifier) },
  };

  const factorLedger = [
    ...POSITIVE_FACTOR_IDS.map((id) => ledgerFactor({
      id,
      rawValue: raw[id],
      effectiveValue: effective[id],
      weight: weightFor(actor, candidate, id),
      polarity: "positive",
      detail: detail[id],
    })),
    ...NEGATIVE_FACTOR_IDS.map((id) => ledgerFactor({
      id,
      rawValue: raw[id],
      effectiveValue: effective[id],
      weight: weightFor(actor, candidate, id),
      polarity: "negative",
      detail: detail[id],
    })),
  ];
  const gates = hardGateResult(candidate);
  const ungatedScore = factorLedger.reduce((sum, factor) => sum + factor.contribution, 0);
  const score = gates.feasible ? round(ungatedScore) : -1_000_000_000;

  return {
    candidateId: candidateIdOf(candidate, index),
    targetActorId: targetIdOf(candidate),
    feasible: gates.feasible,
    blockedBy: gates.blockedBy,
    priorityTier,
    waitingOnly,
    respondsToRequestId: String(candidate?.respondsToRequestId || ""),
    score,
    utility: score,
    factorLedger,
  };
}

/**
 * Score a candidate list without mutating actor, candidates, context, or any
 * nested relationship/interaction record.
 */
export function scoreActionCandidates({ actor = {}, candidates = [], context = {} } = {}) {
  const evaluated = (Array.isArray(candidates) ? candidates : []).map(
    (candidate, index) => evaluateCandidate(actor, candidate || {}, context, index),
  );
  const ranked = [...evaluated].sort((left, right) => (
    Number(right.feasible) - Number(left.feasible)
    || right.priorityTier - left.priorityTier
    || right.score - left.score
    || left.candidateId.localeCompare(right.candidateId)
  )).map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  const selected = ranked.find((candidate) => candidate.feasible) || null;

  return {
    formulaVersion: ACTION_UTILITY_FORMULA_VERSION,
    actorId: actorIdOf(actor),
    selectedCandidateId: selected?.candidateId || null,
    ranked,
    evaluations: ranked,
  };
}
