/**
 * Generic Character-Agent epistemic action utility.
 *
 * This module estimates information value, presupposition fit and reverse
 * disclosure from the character's owned beliefs. It never reads canonical
 * truth and never selects the public action.
 */

export const EPISTEMIC_ACTION_UTILITY_VERSION = "epistemic-action-utility-v1";

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, finite(value)));
}

function unit(value, fallback = 0) {
  let number = finite(value, fallback);
  if (Math.abs(number) > 1 && Math.abs(number) <= 100) number /= 100;
  return clamp(number);
}

function clean(value = "", limit = 260) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function stable(value = "") {
  return clean(value, 220).replace(/[^\p{L}\p{N}:._-]+/gu, "_") || "none";
}

function shortHash(value = "") {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function epistemicCandidateId(primitive = "action", ...parts) {
  const safePrimitive = stable(primitive).slice(0, 32);
  const hint = stable(parts[0]).slice(0, 28);
  return `epistemic:${safePrimitive}:${hint}:${shortHash(parts.join("|"))}`.slice(0, 118);
}

function normalizedDistribution(values = []) {
  const nonnegative = (values || []).map((value) => Math.max(0, finite(value)));
  const total = nonnegative.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return nonnegative.map(() => 0);
  return nonnegative.map((value) => value / total);
}

function entropy(values = []) {
  return normalizedDistribution(values).reduce((sum, probability) => (
    probability > 0 ? sum - probability * Math.log2(probability) : sum
  ), 0);
}

function priorDistribution(beliefState = {}) {
  return normalizedDistribution((beliefState.hypotheses || []).map((row) => row.probability));
}

export function estimateExpectedInformationGain({ beliefState = {}, action = {} } = {}) {
  if (Number.isFinite(Number(action.expectedInformationGain))) return unit(action.expectedInformationGain);
  const prior = priorDistribution(beliefState);
  if (!prior.length) return 0;
  const priorEntropy = entropy(prior);
  if (priorEntropy <= 0) return 0;
  const rows = action.expectedPosteriors || [];
  if (!rows.length) return 0;
  const probabilityTotal = rows.reduce((sum, row) => sum + Math.max(0, finite(row.probability)), 0) || 1;
  const expectedPosteriorEntropy = rows.reduce((sum, row) => (
    sum + Math.max(0, finite(row.probability)) / probabilityTotal * entropy(row.distribution || [])
  ), 0);
  const normalizedGain = clamp((priorEntropy - expectedPosteriorEntropy) / priorEntropy);
  const baseRatePenalty = 1 - unit(action.descriptorBaseRate) * 0.5;
  return clamp(normalizedGain * baseRatePenalty);
}

function locationLikelihood(beliefState, subjectHandle, locationHandle) {
  const row = (beliefState.locationBeliefs || []).find((entry) => (
    clean(entry.subjectHandle) === clean(subjectHandle)
  ));
  return unit((row?.locations || []).find((entry) => (
    clean(entry.locationHandle) === clean(locationHandle)
  ))?.likelihood);
}

function priorPresenceLikelihood(beliefState, subjectHandle, locationHandle) {
  return unit((beliefState.priorPresenceBeliefs || []).find((entry) => (
    clean(entry.subjectHandle) === clean(subjectHandle)
    && clean(entry.locationHandle) === clean(locationHandle)
  ))?.likelihood);
}

function sourceKnowledgeLikelihood(beliefState, sourceHandle, subjectHandle) {
  return unit((beliefState.sourceKnowledgeBeliefs || []).find((entry) => (
    clean(entry.sourceHandle) === clean(sourceHandle)
    && clean(entry.subjectHandle) === clean(subjectHandle)
  ))?.likelihood);
}

function evidenceForPresupposition(presupposition, beliefState) {
  if (presupposition.kind === "target_at_location") {
    return locationLikelihood(beliefState, presupposition.subjectHandle, presupposition.locationHandle);
  }
  if (presupposition.kind === "prior_presence") {
    return priorPresenceLikelihood(beliefState, presupposition.subjectHandle, presupposition.locationHandle);
  }
  if (presupposition.kind === "source_knows_subject") {
    return sourceKnowledgeLikelihood(beliefState, presupposition.sourceHandle, presupposition.subjectHandle);
  }
  if (presupposition.kind === "belief") return unit(presupposition.ownedLikelihood);
  return 0.5;
}

export function evaluateQuestionPresuppositions({ questionPlan = {}, beliefState = {} } = {}) {
  const evaluations = (questionPlan.presuppositions || []).map((row, index) => {
    const minimumLikelihood = Math.max(0.01, unit(row.minimumLikelihood, 0.5));
    const ownedLikelihood = evidenceForPresupposition(row, beliefState);
    const mismatch = clamp((minimumLikelihood - ownedLikelihood) / minimumLikelihood);
    return {
      id: clean(row.id) || `presupposition:${index + 1}`,
      kind: clean(row.kind),
      ownedLikelihood,
      minimumLikelihood,
      mismatch,
      source: "character-owned-belief",
    };
  });
  const mismatch = evaluations.length
    ? evaluations.reduce((sum, row) => sum + row.mismatch, 0) / evaluations.length
    : 0;
  return {
    mismatch,
    blocked: false,
    evaluations,
    rule: "presupposition mismatch is advisory private cost, never speech censorship",
  };
}

function styleOf(actorProfile = {}) {
  const source = actorProfile.informationStyle || {};
  return {
    directInquiry: unit(source.directInquiry, 0.5),
    concealmentNeed: unit(source.concealmentNeed, 0.5),
    patience: unit(source.patience, 0.5),
    verificationThreshold: unit(source.verificationThreshold, 0.62),
    socialRiskSensitivity: unit(source.socialRiskSensitivity, 0.5),
    reactionReadingConfidence: unit(source.reactionReadingConfidence, 0.5),
  };
}

function factor(id, value, weight, polarity = "positive") {
  const contribution = unit(value) * Math.max(0, finite(weight)) * (polarity === "negative" ? -1 : 1);
  return { id, value: unit(value), weight, polarity, contribution };
}

function evaluateCandidate(candidate, actorProfile, beliefState, context) {
  const style = styleOf(actorProfile);
  const urgency = unit(context.urgency);
  const presupposition = evaluateQuestionPresuppositions({ questionPlan: candidate, beliefState });
  const informationGain = estimateExpectedInformationGain({ beliefState, action: candidate });
  const primitive = clean(candidate.primitive);
  const isDirect = primitive.includes("ask_direct")
    || ["ask_source_knowledge", "ask_current_presence", "ask_prior_presence", "ask_claim_reaction"].includes(primitive);
  const isIndirect = primitive.includes("ask_indirect") || primitive === "ask_by_descriptor";
  const directFit = isDirect ? style.directInquiry : isIndirect ? (1 - style.directInquiry) * 0.45 : 0;
  const concealmentCover = isIndirect ? style.concealmentNeed * (1 - unit(candidate.disclosurePayload)) : 0;
  const positiveFactors = [
    factor("expected-information-gain", informationGain, 1.25),
    factor("reaction-diagnosticity", candidate.reactionDiagnosticity, 0.45 + style.reactionReadingConfidence * 0.8),
    factor("goal-progress", candidate.goalProgress, 1.05),
    factor("control-value", candidate.controlValue, 0.38),
    factor("style-fit", directFit, 0.72),
    factor("concealment-cover", concealmentCover, 0.25),
    factor("urgency-directness", isDirect ? urgency : 0, 0.65 * style.directInquiry),
  ];
  const timeWeight = 0.4 + (1 - style.patience) * 1.2 + urgency * 1.3;
  const negativeFactors = [
    factor("reverse-disclosure", candidate.disclosurePayload, 0.35 + style.concealmentNeed * 1.65, "negative"),
    factor("social-cost", candidate.socialCost, 0.5 + style.socialRiskSensitivity, "negative"),
    factor("time-cost", candidate.timeCost, timeWeight, "negative"),
    factor("uncertainty-risk", candidate.uncertaintyRisk, 0.45 + style.verificationThreshold * 0.55, "negative"),
    factor("presupposition-mismatch", presupposition.mismatch, 0.72 + style.verificationThreshold * 0.55, "negative"),
  ];
  const score = [...positiveFactors, ...negativeFactors].reduce((sum, row) => sum + row.contribution, 0);
  return {
    candidateId: clean(candidate.candidateId || candidate.id),
    primitive: clean(candidate.primitive),
    targetHandle: clean(candidate.targetHandle),
    feasible: candidate.feasible !== false,
    expectedInformationGain: informationGain,
    presupposition,
    disclosurePayload: unit(candidate.disclosurePayload),
    score,
    factorLedger: [...positiveFactors, ...negativeFactors],
    ownedClaimReference: candidate.ownedClaimReference ? { ...candidate.ownedClaimReference } : null,
  };
}

function affordancesOfType(availableAffordances, primitive) {
  return (availableAffordances || []).filter((row) => clean(row.epistemicPrimitive) === primitive);
}

/**
 * Generates semantic information-seeking options from current affordances and
 * owned beliefs. It deliberately emits no line, preferred candidate or result.
 */
export function generateEpistemicActionCandidates({
  informationGoal = {},
  currentLocationHandle = "",
  perceivedSources = [],
  availableAffordances = [],
  beliefState = {},
} = {}) {
  const goalId = clean(informationGoal.goalId) || "information-goal";
  const subjectHandle = clean(informationGoal.subjectHandle);
  const locationHandle = clean(currentLocationHandle);
  const sourcesByHandle = new Map((perceivedSources || []).map((row) => [clean(row.handle), row]));
  const candidates = [];
  for (const affordance of affordancesOfType(availableAffordances, "listen")) {
    candidates.push({
      candidateId: epistemicCandidateId("listen", goalId, affordance.id),
      primitive: "listen",
      targetHandle: "",
      informationGoal: goalId,
      expectedInformationGain: 0.24,
      reactionDiagnosticity: 0.08,
      disclosurePayload: 0,
      goalProgress: 0.24,
      controlValue: 0.35,
      socialCost: 0.02,
      timeCost: 0.3,
      uncertaintyRisk: 0.4,
      feasible: true,
      affordanceId: clean(affordance.id),
    });
  }
  for (const affordance of affordancesOfType(availableAffordances, "observe")) {
    const targetHandle = clean(affordance.targetHandle);
    candidates.push({
      candidateId: epistemicCandidateId("observe", goalId, targetHandle || affordance.id, affordance.id),
      primitive: "observe",
      targetHandle,
      informationGoal: goalId,
      expectedInformationGain: targetHandle ? 0.3 : 0.2,
      reactionDiagnosticity: targetHandle ? 0.14 : 0.05,
      disclosurePayload: 0.04,
      goalProgress: 0.28,
      controlValue: 0.44,
      socialCost: targetHandle ? 0.08 : 0.03,
      timeCost: 0.22,
      uncertaintyRisk: 0.32,
      feasible: true,
      affordanceId: clean(affordance.id),
    });
  }
  for (const affordance of affordancesOfType(availableAffordances, "ask")) {
    const targetHandle = clean(affordance.targetHandle);
    if (!targetHandle || !sourcesByHandle.has(targetHandle)) continue;
    const sourceLikelihood = sourceKnowledgeLikelihood(beliefState, targetHandle, subjectHandle);
    for (const belief of (beliefState.claimBeliefs || []).filter((row) => (
      clean(row.subjectHandle) === subjectHandle && clean(row.claimSummary)
    ))) {
      const ownedLikelihood = unit(belief.confidence, 0.56);
      candidates.push({
        candidateId: epistemicCandidateId("ask-claim-reaction", goalId, targetHandle, belief.beliefId, affordance.id),
        primitive: "ask_claim_reaction",
        targetHandle,
        informationGoal: goalId,
        presuppositions: [{
          id: `owned-claim:${clean(belief.beliefId)}`,
          kind: "belief",
          ownedLikelihood,
          minimumLikelihood: 0.2,
        }],
        expectedInformationGain: 0.48 + sourceLikelihood * 0.16,
        reactionDiagnosticity: 0.72,
        disclosurePayload: 0.64,
        goalProgress: 0.58,
        controlValue: 0.61,
        socialCost: 0.1,
        timeCost: 0.08,
        uncertaintyRisk: 0.3 + (1 - ownedLikelihood) * 0.22,
        feasible: true,
        affordanceId: clean(affordance.id),
        ownedClaimReference: {
          beliefId: clean(belief.beliefId),
          subjectHandle,
          claimSummary: clean(belief.claimSummary),
          confidence: ownedLikelihood,
          confidenceBand: clean(belief.confidenceBand),
          sourceStatus: clean(belief.sourceStatus),
          basisEvidenceIds: [...new Set((belief.basisEvidenceIds || []).map((value) => clean(value)).filter(Boolean))],
          truthStatus: "character-owned-unverified-claim",
        },
      });
    }
    candidates.push({
      candidateId: epistemicCandidateId("ask-source-knowledge", goalId, targetHandle, affordance.id),
      primitive: "ask_source_knowledge",
      targetHandle,
      informationGoal: goalId,
      presuppositions: [{
        kind: "source_knows_subject",
        sourceHandle: targetHandle,
        subjectHandle,
        minimumLikelihood: 0.28,
      }],
      expectedInformationGain: 0.38 + sourceLikelihood * 0.28,
      reactionDiagnosticity: 0.3,
      disclosurePayload: 0.72,
      goalProgress: 0.55,
      controlValue: 0.55,
      socialCost: 0.1,
      timeCost: 0.1,
      uncertaintyRisk: 0.28,
      feasible: true,
      affordanceId: clean(affordance.id),
    });
    candidates.push({
      candidateId: epistemicCandidateId("ask-current-presence", goalId, targetHandle, affordance.id),
      primitive: "ask_current_presence",
      targetHandle,
      informationGoal: goalId,
      presuppositions: [
        { kind: "target_at_location", subjectHandle, locationHandle, minimumLikelihood: 0.4 },
        { kind: "source_knows_subject", sourceHandle: targetHandle, subjectHandle, minimumLikelihood: 0.3 },
      ],
      expectedInformationGain: 0.52 + sourceLikelihood * 0.25,
      reactionDiagnosticity: 0.32,
      disclosurePayload: 0.88,
      goalProgress: 0.76,
      controlValue: 0.66,
      socialCost: 0.1,
      timeCost: 0.08,
      uncertaintyRisk: 0.2,
      feasible: true,
      affordanceId: clean(affordance.id),
    });
    candidates.push({
      candidateId: epistemicCandidateId("ask-prior-presence", goalId, targetHandle, affordance.id),
      primitive: "ask_prior_presence",
      targetHandle,
      informationGoal: goalId,
      presuppositions: [
        { kind: "prior_presence", subjectHandle, locationHandle, minimumLikelihood: 0.45 },
        { kind: "source_knows_subject", sourceHandle: targetHandle, subjectHandle, minimumLikelihood: 0.3 },
      ],
      expectedInformationGain: 0.48 + sourceLikelihood * 0.22,
      reactionDiagnosticity: 0.3,
      disclosurePayload: 0.9,
      goalProgress: 0.68,
      controlValue: 0.6,
      socialCost: 0.1,
      timeCost: 0.09,
      uncertaintyRisk: 0.24,
      feasible: true,
      affordanceId: clean(affordance.id),
    });
    for (const descriptor of informationGoal.descriptors || []) {
      const baseRate = unit(descriptor.baseRate, 0.5);
      candidates.push({
        candidateId: epistemicCandidateId("ask-descriptor", goalId, targetHandle, descriptor.id, affordance.id),
        primitive: "ask_by_descriptor",
        targetHandle,
        informationGoal: goalId,
        descriptorId: clean(descriptor.id),
        descriptorBaseRate: baseRate,
        expectedInformationGain: Math.max(0.03, (1 - baseRate) * 0.48),
        reactionDiagnosticity: 0.42,
        disclosurePayload: 0.28,
        goalProgress: 0.25,
        controlValue: 0.35,
        socialCost: 0.08,
        timeCost: 0.12,
        uncertaintyRisk: 0.45 + baseRate * 0.35,
        feasible: true,
        affordanceId: clean(affordance.id),
      });
    }
  }
  for (const primitive of ["wait", "leave", "reposition"]) {
    for (const affordance of affordancesOfType(availableAffordances, primitive)) {
      candidates.push({
        candidateId: epistemicCandidateId(primitive, goalId, affordance.id),
        primitive,
        targetHandle: "",
        informationGoal: goalId,
        expectedInformationGain: primitive === "reposition" ? 0.3 : primitive === "wait" ? 0.18 : 0.08,
        reactionDiagnosticity: 0.04,
        disclosurePayload: 0,
        goalProgress: primitive === "leave" ? 0.08 : 0.2,
        controlValue: primitive === "leave" ? 0.62 : 0.4,
        socialCost: 0.02,
        timeCost: primitive === "wait" ? 0.42 : 0.2,
        uncertaintyRisk: primitive === "leave" ? 0.55 : 0.32,
        feasible: true,
        affordanceId: clean(affordance.id),
      });
    }
  }
  return candidates;
}

export function scoreEpistemicActionCandidates({
  actorProfile = {},
  beliefState = {},
  candidates = [],
  context = {},
} = {}) {
  const evaluations = (candidates || []).map((candidate) => evaluateCandidate(
    candidate,
    actorProfile,
    beliefState,
    context,
  ));
  const pool = evaluations.filter((row) => row.feasible)
    .sort((left, right) => right.score - left.score || left.candidateId.localeCompare(right.candidateId))
    .map((row) => ({ candidateId: row.candidateId, score: row.score, selected: false }));
  return {
    formulaVersion: EPISTEMIC_ACTION_UTILITY_VERSION,
    authority: "character-private-epistemic-tool",
    evaluations,
    selection: {
      authority: "character-agent",
      selectedCandidateId: null,
      pool,
    },
  };
}

export function valueInformationLocation({
  beliefState = {},
  subjectHandle = "",
  locationHandle = "",
  informationValue = 0,
  otherNeedFit = 0,
  travelCost = 0,
  timeCost = 0,
  exposureCost = 0,
  socialCost = 0,
} = {}) {
  const likelihood = locationLikelihood(beliefState, subjectHandle, locationHandle);
  const score = likelihood * unit(informationValue)
    + unit(otherNeedFit)
    - unit(travelCost)
    - unit(timeCost)
    - unit(exposureCost)
    - unit(socialCost);
  return {
    subjectHandle: clean(subjectHandle),
    locationHandle: clean(locationHandle),
    ownedLikelihood: likelihood,
    score,
    worldTruthUsed: false,
    authority: "character-owned-location-belief",
  };
}
