import assert from "node:assert/strict";

import {
  deriveDesireCriterionLedger,
  validateAgentGeneratedCandidates,
  validateCharacterSubjectiveAppraisal,
} from "../src/server/simulation/characterPsychologyTools.mjs";
import {
  tavernCharacterCandidatesV2Schema,
  tavernCharacterSubjectiveAppraisalV2Schema,
  tavernCharacterAgentV2OutputSchemaForStage,
} from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import {
  buildCharacterAgentStageInput,
  createCharacterAgentTurnSession,
  submitCharacterAgentCandidates,
  submitCharacterSubjectiveAppraisal,
} from "../src/server/simulation/characterAgentTurnProtocol.mjs";

const TURN = "agent-turn:criterion-promotion:1";
const DESIRE = "desire:test-firsthand-exchange";
const TARGET = "perceived_entity:opponent";
const PRESENT = "evidence:opponent-present";
const INJURY = "evidence:opponent-favors-left-leg";

const desires = [{
  desireId: DESIRE,
  terminalExperience: "本人完成一次有效的第一手交换",
  satisfactionCondition: {
    type: "valid_firsthand_exchange",
    criteria: {
      targetCapableToRespond: true,
      directObservation: true,
      attackDefenseRoundsAtLeast: 1,
    },
  },
}];

const ledger = deriveDesireCriterionLedger(desires);
const CAPABLE = `criterion:${DESIRE}:criteria.targetCapableToRespond`;
assert.ok(ledger.some((row) => row.criterionId === CAPABLE));
assert.ok(ledger.every((row) => row.authority === "character-private-terminal-contract"));
assert.ok(ledger.every((row) => row.defaultCandidateRole === "terminal_evaluation_only"));

const groundingSchema = tavernCharacterSubjectiveAppraisalV2Schema
  .properties.desireGroundings.items;
assert.equal(Object.hasOwn(groundingSchema.properties, "satisfactionCriteriaRead"), false);
assert.equal(Object.hasOwn(groundingSchema.properties, "nonSubstitutableConditions"), false);
assert.ok(groundingSchema.required.includes("terminalContractAcknowledged"));
assert.ok(groundingSchema.required.includes("promotedCriteria"));

const candidateSchema = tavernCharacterCandidatesV2Schema.properties.candidates.items;
assert.ok(candidateSchema.required.includes("criterionUses"));

function appraisal(promotedCriteria = [], noticedEvidenceIds = [PRESENT]) {
  return {
    ownerAuthority: "character-agent",
    appraisalId: "appraisal:criterion-promotion:1",
    agentTurnId: TURN,
    eventId: "event:opponent-arrival",
    noticedEvidenceIds,
    interpretations: noticedEvidenceIds.map((evidenceId) => ({
      evidenceIds: [evidenceId],
      meaning: evidenceId === INJURY ? "对方落脚时明显避开左腿" : "对方就在眼前",
      confidence: 0.86,
    })),
    beliefOperations: [],
    epistemicPositions: [],
    relevanceLinks: [{ sourceId: DESIRE, relation: "activates", strength: 0.84, confidence: 0.9 }],
    desireGroundings: [{
      desireId: DESIRE,
      feltWant: "亲自完成这次交换",
      terminalExperience: "本人完成一次有效的第一手交换",
      terminalContractAcknowledged: true,
      promotedCriteria,
      activationState: "active",
      activationEvidenceIds: [PRESENT],
      activationPsychologicalSourceIds: [],
      missingActivationConditions: [],
      immediatePull: 0.82,
      currentlyPerceivedPossible: 0.7,
      inhibitors: [],
      acceptableTransformations: ["place", "timing", "intensity"],
      privateSummary: "终局条件仍被保留，但不自动成为这一刻的待办。",
    }],
    appraisalAxes: {
      selfRelevance: 0.8,
      goalCongruence: 0.7,
      novelty: 0.4,
      expectedness: 0.2,
      opportunityValue: 0.8,
      threat: 0.1,
      controllability: 0.7,
      changeability: 0.7,
      certaintyDelta: 0.2,
      normCompatibility: 0.5,
      selfImageCongruence: 0.7,
      publicExposure: 0.2,
      relationshipMeaning: { affiliation: 0, status: 0, trust: 0, rejection: 0, care: 0, betrayal: 0 },
    },
    uncertainty: 0.35,
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
}

const criterionIds = ledger.map((row) => row.criterionId);
const baseContext = {
  agentTurnId: TURN,
  knownEvidenceIds: [PRESENT, INJURY],
  knownSourceIds: [DESIRE],
  knownDesireIds: [DESIRE],
  knownCriterionIds: criterionIds,
  criterionIdsByDesire: { [DESIRE]: criterionIds },
  requireDesireGrounding: true,
};

function sessionWithEvidence() {
  return createCharacterAgentTurnSession({
    agentTurnId: TURN,
    characterId: "character:criterion-owner",
    worldProjection: {
      authority: "recipient-specific-world-projection",
      evidence: [
        { evidenceId: PRESENT, modality: "visual", feature: "对方就在眼前" },
        { evidenceId: INJURY, modality: "visual", feature: "对方落脚时避开左腿" },
      ],
      perceivedCharacters: [{ id: TARGET, identityKnown: false }],
    },
    privateContext: {
      profile: {},
      state: {},
      desires,
    },
  });
}

const appraisalStage = buildCharacterAgentStageInput(sessionWithEvidence());
assert.ok(appraisalStage.referenceContract.ownedDesireCriterionIds.includes(CAPABLE));
const boundAppraisalSchema = tavernCharacterAgentV2OutputSchemaForStage(appraisalStage);
assert.ok(
  boundAppraisalSchema.properties.desireGroundings.items.properties.promotedCriteria
    .items.properties.criterionId.enum.includes(CAPABLE),
);

assert.equal(
  validateCharacterSubjectiveAppraisal(appraisal(), baseContext).valid,
  true,
  "a desire may remain fully valid while none of its terminal criteria becomes a current concern",
);

const backgroundSession = submitCharacterSubjectiveAppraisal(sessionWithEvidence(), appraisal());
const backgroundCandidateInput = buildCharacterAgentStageInput(backgroundSession);
assert.deepEqual(backgroundCandidateInput.referenceContract.currentConcernCriterionIds, []);
assert.equal(
  tavernCharacterAgentV2OutputSchemaForStage(backgroundCandidateInput)
    .properties.candidates.items.properties.criterionUses.maxItems,
  0,
  "when the Character promotes nothing, structured output cannot manufacture a criterion-driven candidate",
);

const currentConcern = {
  criterionId: CAPABLE,
  mode: "current_concern",
  basisEvidenceIds: [INJURY],
  basisPsychologicalSourceIds: [],
  basisStateFactors: [],
  privateReason: "我刚看见对方回避左腿，这会直接影响眼下交换是否有效。",
};
assert.equal(
  validateCharacterSubjectiveAppraisal(
    appraisal([currentConcern], [PRESENT, INJURY]),
    baseContext,
  ).valid,
  true,
  "the Character Agent may promote a criterion after personally noticing a specific reason",
);

const concernedSession = submitCharacterSubjectiveAppraisal(
  sessionWithEvidence(),
  appraisal([currentConcern], [PRESENT, INJURY]),
);
const concernedCandidateInput = buildCharacterAgentStageInput(concernedSession);
assert.deepEqual(concernedCandidateInput.referenceContract.currentConcernCriterionIds, [CAPABLE]);
assert.deepEqual(
  tavernCharacterAgentV2OutputSchemaForStage(concernedCandidateInput)
    .properties.candidates.items.properties.criterionUses.items.properties.criterionId.enum,
  [CAPABLE],
);

const unsupportedPromotion = structuredClone(currentConcern);
unsupportedPromotion.basisEvidenceIds = [];
assert.ok(
  validateCharacterSubjectiveAppraisal(appraisal([unsupportedPromotion]), baseContext)
    .errors.some((row) => row.code === "DESIRE_CRITERION_PROMOTION_BASIS_MISSING"),
  "a terminal criterion cannot become current merely because it exists in the desire contract",
);

function candidate(criterionUses = []) {
  return {
    originAuthority: "character-agent",
    candidateId: "candidate:ask-about-condition",
    intention: "询问眼前具体异常是否妨碍下一步",
    attemptPrimitive: "speak",
    targetHandle: TARGET,
    actionBinding: {
      kind: "none",
      targetCharacterId: "",
      objectId: "",
      destinationId: "",
      positionId: "",
      affordanceId: "",
    },
    perceivedPrerequisites: [INJURY],
    domains: ["social", "physical"],
    expectedEffects: [{ sourceId: DESIRE, direction: "enable", magnitude: 0.45, confidence: 0.72 }],
    desireRelations: [{
      desireId: DESIRE,
      relation: "enable",
      terminalConditionMatch: 0.08,
      counterfactualResult: "只澄清眼前条件，不等于完成终局交换。",
      preservesNonSubstitutableConditions: true,
      confidence: 0.8,
    }],
    criterionUses,
    epistemicHandling: {
      positionIds: [],
      mode: "not_relevant",
      errorIfWrong: 0,
      actionReversibility: 1,
      learningDuringAction: 0,
      delayCost: 0,
      privateReason: "",
    },
    sharedActivity: {
      operation: "none",
      activityId: "",
      kind: "",
      participantIds: [],
      requestedZoneId: "",
      response: "none",
      boundaries: { intensity: "", propertyProtection: false, harmLimit: "", note: "" },
    },
    factorInputs: {
      emotionCompatibility: 0.5,
      valueAndSelfImage: 0.5,
      relationshipMeaning: 0,
      informationGain: 0.5,
      habitAndIntentionContinuity: 0.5,
      bodyCost: 0,
      threatAndNormCost: 0.1,
      exposureAndRelationshipRisk: 0.1,
      opportunityAndSwitchingCost: 0.1,
      uncertaintyCost: 0.2,
    },
    timingIntent: "now",
    disclosureNeed: "只说当前必要内容",
    uncertainty: 0.3,
  };
}

const criterionUse = [{
  desireId: DESIRE,
  criterionId: CAPABLE,
  use: "verify",
  privatePurpose: "核实刚刚显露的异常是否妨碍眼下交换。",
}];

const candidateContext = {
  knownEvidenceIds: [PRESENT, INJURY],
  knownTargetHandles: [TARGET],
  knownSourceIds: [DESIRE],
  knownDesireIds: [DESIRE],
  knownCriterionIds: criterionIds,
  requireDesireRelations: true,
};

assert.ok(
  validateAgentGeneratedCandidates([candidate(criterionUse)], {
    ...candidateContext,
    currentConcernCriterionIds: [],
  }).errors.some((row) => row.code === "AGENT_CANDIDATE_CRITERION_NOT_PROMOTED"),
  "an unpromoted terminal condition cannot originate a current action",
);

assert.equal(
  validateAgentGeneratedCandidates([candidate(criterionUse)], {
    ...candidateContext,
    currentConcernCriterionIds: [CAPABLE],
  }).valid,
  true,
  "a Character-owned current concern may legitimately inform a candidate",
);

assert.doesNotThrow(
  () => submitCharacterAgentCandidates(concernedSession, [candidate(criterionUse)]),
  "candidate evaluation must preserve the Character Agent's already validated current-concern context",
);

assert.equal(
  validateAgentGeneratedCandidates([candidate([])], {
    ...candidateContext,
    currentConcernCriterionIds: [],
  }).valid,
  true,
  "direct action remains legal without turning every terminal condition into a prerequisite question",
);

console.log("characterDesireCriterionPromotionContracts:test passed");
