import assert from "node:assert/strict";

import {
  CHARACTER_DESIRE_RELATION_TYPES,
  computeCharacterPsychologySnapshot,
  evaluateCharacterAgentCandidates,
  validateAgentGeneratedCandidates,
  validateCharacterSubjectiveAppraisal,
} from "../src/server/simulation/characterPsychologyTools.mjs";

const TURN = "agent-turn:desire-grounding:1";
const DESIRE = "desire:experience-mutual-test";
const TARGET = "entity:other-practitioner";
const EVIDENCE = "evidence:other-practitioner-present";
const BELIEF = "belief:assessment-is-near";

assert.deepEqual(CHARACTER_DESIRE_RELATION_TYPES, [
  "direct_contact", "enable", "probe", "defer", "avoid", "substitute", "unrelated",
]);

const grounding = {
  desireId: DESIRE,
  feltWant: "亲自与对方完成一轮真实的相互检验",
  terminalExperience: "双方都能回应的有效来回",
  terminalContractAcknowledged: true,
  promotedCriteria: [],
  activationState: "active",
  activationEvidenceIds: [EVIDENCE],
  activationPsychologicalSourceIds: [],
  missingActivationConditions: [],
  immediatePull: 0.86,
  currentlyPerceivedPossible: 0.72,
  inhibitors: [],
  acceptableTransformations: ["place", "intensity", "timing"],
  privateSummary: "地点和力度可以调整，互相回应不能被换掉。",
};

const appraisal = {
  ownerAuthority: "character-agent",
  appraisalId: "appraisal:desire-grounding:1",
  agentTurnId: TURN,
  eventId: EVIDENCE,
  noticedEvidenceIds: [EVIDENCE],
  interpretations: [{ evidenceIds: [EVIDENCE], meaning: "对方在场且可以交流", confidence: 0.9 }],
  beliefOperations: [],
  relevanceLinks: [{ sourceId: DESIRE, relation: "activates", strength: 0.9, confidence: 0.9 }],
  desireGroundings: [grounding],
  appraisalAxes: {
    selfRelevance: 0.9,
    goalCongruence: 0.82,
    novelty: 0.5,
    expectedness: 0.1,
    opportunityValue: 0.86,
    threat: 0.18,
    controllability: 0.78,
    changeability: 0.8,
    certaintyDelta: 0.2,
    normCompatibility: 0.36,
    selfImageCongruence: 0.7,
    publicExposure: 0,
    relationshipMeaning: { affiliation: 0, status: 0, trust: 0, rejection: 0, care: 0, betrayal: 0 },
  },
  uncertainty: 0.2,
  alternativesConsidered: [],
  priorActionOutcomeAppraisal: {
    ownerAuthority: "character-agent",
    sourceAgentTurnId: "",
    status: "no_prior_action",
    noticedOutcomeEvidenceIds: [],
    perceivedInformationGain: 0,
    perceivedGoalProgress: 0,
    perceivedCost: 0,
    unexpectedness: 0,
    stillUnresolved: false,
    summary: "",
  },
};

const validAppraisal = validateCharacterSubjectiveAppraisal(appraisal, {
  agentTurnId: TURN,
  knownEvidenceIds: [EVIDENCE],
  knownSourceIds: [DESIRE, BELIEF],
  knownDesireIds: [DESIRE],
  requireDesireGrounding: true,
});
assert.equal(validAppraisal.valid, true, JSON.stringify(validAppraisal.errors));

const missingTerminal = structuredClone(appraisal);
missingTerminal.desireGroundings[0].terminalExperience = "";
assert.ok(validateCharacterSubjectiveAppraisal(missingTerminal, {
  agentTurnId: TURN,
  knownEvidenceIds: [EVIDENCE],
  knownSourceIds: [DESIRE],
  knownDesireIds: [DESIRE],
  requireDesireGrounding: true,
}).errors.some((row) => row.code === "DESIRE_GROUNDING_TERMINAL_EXPERIENCE_MISSING"));

const internallyActivated = structuredClone(appraisal);
internallyActivated.desireGroundings[0].activationEvidenceIds = [];
internallyActivated.desireGroundings[0].activationPsychologicalSourceIds = [BELIEF];
assert.equal(validateCharacterSubjectiveAppraisal(internallyActivated, {
  agentTurnId: TURN,
  knownEvidenceIds: [EVIDENCE],
  knownSourceIds: [DESIRE, BELIEF],
  knownDesireIds: [DESIRE],
  requireDesireGrounding: true,
}).valid, true, "a non-cue-gated desire may be made current by an owned belief without pretending that belief was perceived evidence");

const unknownInternalSource = structuredClone(internallyActivated);
unknownInternalSource.desireGroundings[0].activationPsychologicalSourceIds = ["belief:not-owned"];
assert.ok(validateCharacterSubjectiveAppraisal(unknownInternalSource, {
  agentTurnId: TURN,
  knownEvidenceIds: [EVIDENCE],
  knownSourceIds: [DESIRE, BELIEF],
  knownDesireIds: [DESIRE],
  requireDesireGrounding: true,
}).errors.some((row) => row.code === "DESIRE_GROUNDING_ACTIVATION_SOURCE_UNKNOWN"));

const cueGatedDesire = {
  desireId: DESIRE,
  activationMode: "cue_gated",
  activationCues: ["亲眼确认对方真正高明"],
  previousActivation: 0.12,
  potentialStrength: 0.7,
  latentActivationCap: 0.12,
  retention: 0.9,
};
const latentAppraisal = structuredClone(appraisal);
latentAppraisal.desireGroundings[0].activationState = "latent";
latentAppraisal.desireGroundings[0].activationEvidenceIds = [];
latentAppraisal.desireGroundings[0].missingActivationConditions = ["尚未亲眼确认对方真正高明"];
latentAppraisal.desireGroundings[0].immediatePull = 0.9;
const latentSnapshot = computeCharacterPsychologySnapshot({
  agentTurnId: TURN,
  appraisal: latentAppraisal,
  desires: [cueGatedDesire],
});
assert.ok(
  latentSnapshot.desireActivations[0].value <= cueGatedDesire.latentActivationCap,
  "a high latent potential must not become a live desire before its authored cue is personally recognized",
);

const activeSnapshot = computeCharacterPsychologySnapshot({
  agentTurnId: TURN,
  appraisal,
  desires: [cueGatedDesire],
});
assert.ok(
  activeSnapshot.desireActivations[0].value > latentSnapshot.desireActivations[0].value + 0.4,
  "the same stable person may become strongly activated after personally grounding the required cue",
);

const activeWithoutEvidence = structuredClone(appraisal);
activeWithoutEvidence.desireGroundings[0].activationEvidenceIds = [];
activeWithoutEvidence.desireGroundings[0].activationPsychologicalSourceIds = [BELIEF];
assert.ok(validateCharacterSubjectiveAppraisal(activeWithoutEvidence, {
  agentTurnId: TURN,
  knownEvidenceIds: [EVIDENCE],
  knownSourceIds: [DESIRE, BELIEF],
  knownDesireIds: [DESIRE],
  requireDesireGrounding: true,
  desires: [cueGatedDesire],
}).errors.some((row) => row.code === "DESIRE_GROUNDING_ACTIVE_WITHOUT_EVIDENCE"), "an owned belief cannot counterfeit the direct evidence required by a cue-gated desire");

const neutralFactors = {
  emotionCompatibility: 0.6,
  valueAndSelfImage: 0.7,
  relationshipMeaning: 0,
  informationGain: 0.3,
  habitAndIntentionContinuity: 0.5,
  bodyCost: 0.08,
  threatAndNormCost: 0.12,
  exposureAndRelationshipRisk: 0,
  opportunityAndSwitchingCost: 0.08,
  uncertaintyCost: 0.12,
};

function candidate({ id, relation, terminalMatch, info, primitive = "interact", sharedActivityKind = "" }) {
  return {
    originAuthority: "character-agent",
    candidateId: id,
    intention: id,
    attemptPrimitive: primitive,
    targetHandle: TARGET,
    perceivedPrerequisites: [EVIDENCE],
    domains: ["martial"],
    expectedEffects: [{ sourceId: DESIRE, direction: "advance", magnitude: 0.95, confidence: 0.9 }],
    desireRelations: [{
      desireId: DESIRE,
      relation,
      terminalConditionMatch: terminalMatch,
      counterfactualResult: id,
      preservesNonSubstitutableConditions: relation === "direct_contact",
      confidence: 0.9,
    }],
    sharedActivity: sharedActivityKind ? {
      operation: "propose",
      activityId: "activity:mutual-test",
      kind: sharedActivityKind,
      participantIds: [TARGET],
      requestedZoneId: "",
      response: "none",
      boundaries: { intensity: "controlled" },
    } : null,
    factorInputs: { ...neutralFactors, informationGain: info },
    timingIntent: "now",
    disclosureNeed: "partial",
    uncertainty: 0.16,
  };
}

const candidates = [
  candidate({ id: "direct-mutual-test", relation: "direct_contact", terminalMatch: 0.92, info: 0.78, sharedActivityKind: "mutual-test" }),
  candidate({ id: "open-a-route", relation: "enable", terminalMatch: 0.74, info: 0.32, primitive: "speak" }),
  candidate({ id: "ask-other-to-demonstrate", relation: "substitute", terminalMatch: 0.18, info: 0.9, primitive: "speak" }),
  candidate({ id: "continue-observing", relation: "probe", terminalMatch: 0.12, info: 0.64, primitive: "observe" }),
  candidate({ id: "leave-the-opportunity", relation: "avoid", terminalMatch: 0, info: 0.02, primitive: "leave" }),
];

const candidateValidation = validateAgentGeneratedCandidates(candidates, {
  knownEvidenceIds: [EVIDENCE],
  knownTargetHandles: [TARGET],
  knownSourceIds: [DESIRE],
  knownDesireIds: [DESIRE],
  requireDesireRelations: true,
});
assert.equal(candidateValidation.valid, true, JSON.stringify(candidateValidation.errors));

const evaluation = evaluateCharacterAgentCandidates({
  agentTurnId: TURN,
  candidates,
  snapshot: {
    authority: "character-private-psychology-tool",
    agentTurnId: TURN,
    desireActivations: [{ desireId: DESIRE, value: 0.9 }],
    uncertainty: 0.2,
  },
  profile: {
    candidateValuation: { weights: { goalProgress: 1, informationGain: 0.8, proxySubstitution: 1.1 } },
    domainValuation: {
      martial: { goalProgress: 1.25, informationGain: 0.72, proxySubstitution: 1.35 },
      social: { goalProgress: 0.82, informationGain: 1.08, exposureAndRelationshipRisk: 1.4 },
    },
  },
});

const byId = Object.fromEntries(evaluation.evaluations.map((row) => [row.candidateId, row]));
const factor = (row, id) => row.factorVector.find((item) => item.id === id)?.value ?? 0;
assert.ok(factor(byId["direct-mutual-test"], "goalProgress") > factor(byId["ask-other-to-demonstrate"], "goalProgress"));
assert.ok(factor(byId["ask-other-to-demonstrate"], "informationGain") > factor(byId["direct-mutual-test"], "informationGain"));
assert.ok(factor(byId["ask-other-to-demonstrate"], "proxySubstitution") > 0.5);
assert.equal(factor(byId["direct-mutual-test"], "proxySubstitution"), 0);
assert.equal(factor(byId["open-a-route"], "goalProgress"), 0, "enabling must not masquerade as terminal satisfaction");
assert.ok(factor(byId["open-a-route"], "enablingProgress") > 0, "enabling remains a useful but separate factor");
assert.equal(factor(byId["continue-observing"], "goalProgress"), 0, "probing must not masquerade as terminal satisfaction");
assert.ok(factor(byId["continue-observing"], "probeProgress") > 0, "probing remains a useful but separate factor");
assert.ok(factor(byId["leave-the-opportunity"], "goalProgress") < 0, "avoidance must remain visible as movement away from the terminal desire");
assert.equal(evaluation.selection, null);
assert.equal(byId["direct-mutual-test"].weightTrace.domains.includes("martial"), true);

const socialCandidate = structuredClone(candidates[0]);
socialCandidate.candidateId = "social-domain-version";
socialCandidate.domains = ["social"];
const socialEvaluation = evaluateCharacterAgentCandidates({
  agentTurnId: TURN,
  candidates: [socialCandidate],
  snapshot: {
    authority: "character-private-psychology-tool",
    agentTurnId: TURN,
    desireActivations: [{ desireId: DESIRE, value: 0.9 }],
    uncertainty: 0.2,
  },
  profile: {
    domainValuation: {
      martial: { goalProgress: 1.3 },
      social: { goalProgress: 0.7 },
    },
  },
});
assert.ok(
  byId["direct-mutual-test"].factorVector.find((row) => row.id === "goalProgress").weight
    > socialEvaluation.evaluations[0].factorVector.find((row) => row.id === "goalProgress").weight,
  "the same stable person may weight the same factor differently across authored domains",
);

console.log("characterDesireGroundingContracts:test passed");
