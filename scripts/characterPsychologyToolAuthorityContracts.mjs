import assert from "node:assert/strict";

import {
  CHARACTER_PSYCHOLOGY_TOOLS_VERSION,
  advanceCharacterPsychologyCarryover,
  auditCharacterPsychologyToolOutput,
  computeCharacterPsychologySnapshot,
  computeCharacterRegulationOutcome,
  evaluateCharacterAgentCandidates,
  validateAgentGeneratedCandidates,
  validateCharacterAgentDecisionV3,
  validateCharacterSubjectiveAppraisal,
} from "../src/server/simulation/characterPsychologyTools.mjs";

const TURN_ID = "agent-turn:generic:001";
const EVIDENCE_ID = "evidence:anonymous-skilled-visitor";
const DESIRE_ID = "desire:verify-demanding-opponent";

function clone(value) {
  return structuredClone(value);
}

function appraisal() {
  return {
    ownerAuthority: "character-agent",
    appraisalId: "appraisal:generic:001",
    agentTurnId: TURN_ID,
    eventId: "event:generic:visitor-arrival",
    noticedEvidenceIds: [EVIDENCE_ID],
    interpretations: [{
      evidenceIds: [EVIDENCE_ID],
      meaning: "眼前来客可能与本人长期寻找的高水平对手有关，但身份尚未确认。",
      confidence: 0.68,
    }],
    beliefOperations: [],
    relevanceLinks: [{
      sourceId: DESIRE_ID,
      relation: "advances",
      strength: 0.88,
      confidence: 0.68,
    }],
    appraisalAxes: {
      selfRelevance: 0.82,
      goalCongruence: 0.72,
      novelty: 0.76,
      expectedness: -0.42,
      opportunityValue: 0.84,
      threat: 0.34,
      controllability: 0.55,
      changeability: 0.62,
      certaintyDelta: 0.48,
      normCompatibility: 0.22,
      selfImageCongruence: 0.18,
      publicExposure: 0.67,
      relationshipMeaning: {
        affiliation: 0,
        status: 0.24,
        trust: 0,
        rejection: 0,
        care: 0,
        betrayal: 0,
      },
    },
    uncertainty: 0.44,
    alternativesConsidered: ["只是普通来客", "可能是传闻目标"],
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

function profile({ curiosityGain = 1.15, warinessGain = 0.9 } = {}) {
  return {
    personality: {
      selfControl: 0.76,
      caution: 0.56,
      impulsivity: 0.28,
    },
    emotionResponse: {
      globalGain: 1,
      emotions: {
        curiosity: { gain: curiosityGain },
        wariness: { gain: warinessGain },
      },
    },
    regulation: {
      practicedSkill: 0.74,
      roleDiscipline: 0.58,
      strategySkills: { suppress: 0.72, reappraise: 0.62, tolerate: 0.66 },
    },
    leakage: {
      maskingSkills: {
        gaze: 0.52,
        attentionLock: 0.38,
        responseLatency: 0.45,
        voiceOnset: 0.58,
      },
    },
    candidateValuation: {
      weights: {
        goalProgress: 1.2,
        informationGain: 1.1,
        exposureRisk: 0.92,
        uncertaintyCost: 0.72,
      },
      temperature: 0.66,
    },
  };
}

function currentState({ fatigue = 0.18, pain = 0.04, cognitiveLoad = 0.22 } = {}) {
  return {
    mood: { valence: 0.05, arousal: 0.28 },
    body: { fatigue, pain, instability: fatigue * 0.25 },
    cognitiveLoad,
    traumaActivation: 0.08,
    feltSafety: 0.62,
    preparation: 0.35,
  };
}

function desires() {
  return [{
    desireId: DESIRE_ID,
    previousActivation: 0.52,
    retention: 0.9,
    cueMatch: 0.86,
    urgency: 0.36,
    frustration: 0.24,
    relationshipExpectation: 0,
    bodyNeedCoupling: 0,
    satisfaction: 0,
    adaptation: 0.08,
  }];
}

const appraisalValidation = validateCharacterSubjectiveAppraisal(appraisal(), {
  agentTurnId: TURN_ID,
  knownEvidenceIds: [EVIDENCE_ID],
  knownSourceIds: [DESIRE_ID],
});
assert.equal(appraisalValidation.valid, true, JSON.stringify(appraisalValidation.errors));

const unknownEvidence = appraisal();
unknownEvidence.noticedEvidenceIds = ["evidence:not-owned"];
assert.ok(
  validateCharacterSubjectiveAppraisal(unknownEvidence, {
    agentTurnId: TURN_ID,
    knownEvidenceIds: [EVIDENCE_ID],
    knownSourceIds: [DESIRE_ID],
  }).errors.some((entry) => entry.code === "SUBJECTIVE_APPRAISAL_EVIDENCE_UNKNOWN"),
  "the Character Agent may only appraise evidence that reached this character",
);

const persistentDesireCannotBecomeCueLatent = appraisal();
persistentDesireCannotBecomeCueLatent.desireGroundings = [{
  desireId: DESIRE_ID,
  feltWant: "仍想亲自验证眼前可能出现的对手",
  terminalExperience: "取得一次真实的第一手交锋判断",
  terminalContractAcknowledged: true,
  promotedCriteria: [],
  activationState: "latent",
  activationEvidenceIds: [],
  activationPsychologicalSourceIds: [DESIRE_ID],
  missingActivationConditions: ["先确认终局条件"],
  immediatePull: 0.1,
  currentlyPerceivedPossible: 0.2,
  inhibitors: [],
  acceptableTransformations: ["timing", "manner"],
  privateSummary: "错误地把终局条件当成激活开关。",
}];
assert.ok(
  validateCharacterSubjectiveAppraisal(persistentDesireCannotBecomeCueLatent, {
    agentTurnId: TURN_ID,
    knownEvidenceIds: [EVIDENCE_ID],
    knownSourceIds: [DESIRE_ID],
    desires: [{ desireId: DESIRE_ID, activationMode: "persistent" }],
  }).errors.some((entry) => entry.code === "DESIRE_GROUNDING_PERSISTENT_MARKED_LATENT"),
  "a persistent authored desire cannot be converted into a cue-gated latent desire merely because terminal conditions remain unknown",
);

const persistentLowPull = clone(persistentDesireCannotBecomeCueLatent);
persistentLowPull.desireGroundings[0].activationState = "active";
persistentLowPull.desireGroundings[0].missingActivationConditions = [];
persistentLowPull.desireGroundings[0].immediatePull = 0.1;
const persistentHighPull = clone(persistentLowPull);
persistentHighPull.desireGroundings[0].immediatePull = 0.9;
const persistentDesireState = [{
  ...desires()[0],
  activationMode: "persistent",
  previousActivation: 0.2,
  potentialStrength: 0.2,
  cueMatch: 0,
  urgency: 0,
  frustration: 0,
  adaptation: 0,
}];
const persistentLowSnapshot = computeCharacterPsychologySnapshot({
  agentTurnId: TURN_ID,
  appraisal: persistentLowPull,
  profile: profile(),
  state: currentState(),
  desires: persistentDesireState,
});
const persistentHighSnapshot = computeCharacterPsychologySnapshot({
  agentTurnId: TURN_ID,
  appraisal: persistentHighPull,
  profile: profile(),
  state: currentState(),
  desires: persistentDesireState,
});
assert.ok(
  persistentHighSnapshot.desireActivations[0].value > persistentLowSnapshot.desireActivations[0].value,
  "the same persistent desire must react to the Character Agent's different current felt pull instead of using only retained baseline",
);

const input = {
  agentTurnId: TURN_ID,
  appraisal: appraisal(),
  profile: profile(),
  state: currentState(),
  desires: desires(),
};
const inputBefore = clone(input);
const snapshot = computeCharacterPsychologySnapshot(input);
assert.deepEqual(input, inputBefore, "psychology tools must not mutate Character Agent input");
assert.equal(snapshot.schemaVersion, CHARACTER_PSYCHOLOGY_TOOLS_VERSION);
assert.equal(snapshot.authority, "character-private-psychology-tool");
assert.equal(snapshot.agentTurnId, TURN_ID);
assert.equal(Object.prototype.hasOwnProperty.call(snapshot, "dominantEmotion"), false);
assert.equal(Object.prototype.hasOwnProperty.call(snapshot.actionTendencies, "dominant"), false);
assert.ok(snapshot.emotionMixture.filter((row) => row.value >= 0.3).length >= 2, "mixed emotions must coexist");
assert.equal(auditCharacterPsychologyToolOutput(snapshot).valid, true);

const repeatedSnapshot = computeCharacterPsychologySnapshot(input);
assert.deepEqual(repeatedSnapshot, snapshot, "the same private state and appraisal must produce a reproducible tool result");

const fatiguedSnapshot = computeCharacterPsychologySnapshot({
  ...input,
  state: currentState({ fatigue: 0.88, pain: 0.42, cognitiveLoad: 0.72 }),
});
assert.ok(
  fatiguedSnapshot.controlCapacity < snapshot.controlCapacity,
  "the same character in a depleted state must have less regulation capacity",
);

const warySnapshot = computeCharacterPsychologySnapshot({
  ...input,
  profile: profile({ curiosityGain: 0.55, warinessGain: 1.55 }),
});
const emotionValue = (result, emotionId) => result.emotionMixture.find((row) => row.emotionId === emotionId)?.value || 0;
assert.ok(
  emotionValue(warySnapshot, "wariness") > emotionValue(snapshot, "wariness"),
  "stable personal response weights must differentiate reactions to the same event",
);
assert.ok(
  emotionValue(warySnapshot, "curiosity") < emotionValue(snapshot, "curiosity"),
  "personality differences must not collapse into one shared emotional response",
);

const regulationChoice = {
  ownerAuthority: "character-agent",
  regulationChoiceId: "regulation:generic:001",
  agentTurnId: TURN_ID,
  strategies: [{
    strategy: "suppress",
    targetEmotionIds: ["excitement", "anticipation"],
    effort: 0.78,
    contextFit: 0.72,
  }],
  intendedPublicEffect: "不让尚未确认的机会破坏公共场合秩序",
  acceptedCosts: ["控制消耗", "稍后可能反弹"],
};
const regulation = computeCharacterRegulationOutcome({
  agentTurnId: TURN_ID,
  snapshot,
  profile: profile(),
  state: currentState(),
  regulationChoice,
});
assert.equal(regulation.authority, "character-private-psychology-tool");
assert.equal(regulation.selection, null);
assert.equal(regulation.realization, null);
assert.ok(regulation.regulationCost > 0);
assert.ok(
  regulation.residualEmotion.find((row) => row.emotionId === "excitement").value
    < emotionValue(snapshot, "excitement"),
  "chosen regulation may reduce an emotion without dictating expression",
);
assert.ok(
  Math.max(...Object.values(regulation.channelLeakagePressures)) > 0,
  "successful restraint must not automatically erase every affective channel",
);
assert.equal(auditCharacterPsychologyToolOutput(regulation).valid, true);

const carryover = advanceCharacterPsychologyCarryover({
  previous: { mood: { valence: -0.05, arousal: 0.24 }, cognitiveLoad: 0.18, controlDepletion: 0.08, reboundPressure: 0.04 },
  snapshot,
  regulationOutcome: regulation,
  objectiveOutcome: {
    authority: "world-resolution",
    outcomeId: "outcome:generic:001",
    status: "failed",
    committed: false,
    visibleOutcome: "剑尖在木柱前停住",
    failureCodes: ["TARGET_MOVED"],
  },
});
assert.equal(carryover.authority, "character-private-psychology-state-transition");
assert.ok(carryover.controlDepletion > 0);
assert.ok(carryover.reboundPressure >= 0);
assert.equal(carryover.pendingObjectiveOutcome.requiresCharacterAppraisal, true);
assert.equal(carryover.pendingObjectiveOutcome.inferredSatisfaction, null);
assert.equal(carryover.pendingObjectiveOutcome.inferredRelationshipChange, null);
assert.equal(auditCharacterPsychologyToolOutput(carryover).valid, true);

const carriedSnapshot = computeCharacterPsychologySnapshot({
  ...input,
  state: {
    ...currentState(),
    priorRegulationCarryover: carryover,
  },
});
assert.ok(
  emotionValue(carriedSnapshot, "excitement") > emotionValue(snapshot, "excitement"),
  "post-regulation residual affect and rebound must influence the Character's next private emotional state",
);
assert.equal(
  carriedSnapshot.privateFactorLedger.affectiveCarryover.selection,
  null,
  "affective carryover remains a private mathematical input and cannot select expression or action",
);

const candidates = [{
  originAuthority: "character-agent",
  candidateId: "candidate:observe-without-disclosing",
  intention: "继续收集能确认对方身份与水平的第一手证据",
  attemptPrimitive: "observe",
  targetHandle: "perceived_entity:visitor",
  perceivedPrerequisites: [EVIDENCE_ID],
  expectedEffects: [{ sourceId: DESIRE_ID, direction: "advance", magnitude: 0.42, confidence: 0.72 }],
  factorInputs: {
    emotionCompatibility: 0.62,
    valueAndSelfImage: 0.74,
    relationshipMeaning: 0,
    informationGain: 0.58,
    habitAndIntentionContinuity: 0.66,
    bodyCost: 0.04,
    threatAndNormCost: 0.12,
    exposureAndRelationshipRisk: 0.08,
    opportunityAndSwitchingCost: 0.18,
    uncertaintyCost: 0.32,
  },
  timingIntent: "continue_current_action",
  disclosureNeed: "none",
  uncertainty: 0.36,
}, {
  originAuthority: "character-agent",
  candidateId: "candidate:direct-test",
  intention: "直接制造一次能验证对方反应的社会试探",
  attemptPrimitive: "speak",
  targetHandle: "perceived_entity:visitor",
  perceivedPrerequisites: [EVIDENCE_ID],
  expectedEffects: [{ sourceId: DESIRE_ID, direction: "advance", magnitude: 0.78, confidence: 0.58 }],
  factorInputs: {
    emotionCompatibility: 0.76,
    valueAndSelfImage: 0.62,
    relationshipMeaning: 0,
    informationGain: 0.82,
    habitAndIntentionContinuity: 0.52,
    bodyCost: 0.06,
    threatAndNormCost: 0.26,
    exposureAndRelationshipRisk: 0.56,
    opportunityAndSwitchingCost: 0.12,
    uncertaintyCost: 0.46,
  },
  timingIntent: "after_current_action",
  disclosureNeed: "partial",
  uncertainty: 0.44,
}];

const candidateValidation = validateAgentGeneratedCandidates(candidates, {
  agentTurnId: TURN_ID,
  knownEvidenceIds: [EVIDENCE_ID],
  knownTargetHandles: ["perceived_entity:visitor"],
});
assert.equal(candidateValidation.valid, true, JSON.stringify(candidateValidation.errors));

const processHandle = "owned_process:char:test:work:1";
const processAsObjectCandidate = [{
  ...clone(candidates[0]),
  candidateId: "candidate:mistype-process-as-object",
  targetHandle: processHandle,
  actionBinding: {
    kind: "object",
    targetCharacterId: "",
    objectId: processHandle,
    destinationId: "",
    positionId: "",
    affordanceId: "",
  },
}];
const processAsObjectValidation = validateAgentGeneratedCandidates(processAsObjectCandidate, {
  agentTurnId: TURN_ID,
  knownEvidenceIds: [EVIDENCE_ID],
  knownTargetHandles: [processHandle],
  knownTargetHandlesByKind: {
    character: [],
    object: ["object:axe"],
    place: [],
    position: [],
    affordance: ["affordance:work:resume"],
  },
});
assert.ok(
  processAsObjectValidation.errors.some((entry) => entry.code === "AGENT_CANDIDATE_BINDING_TARGET_KIND_MISMATCH"),
  "an owned world-process handle must not pass as an object binding",
);

const resumeAsAffordanceCandidate = clone(processAsObjectCandidate);
resumeAsAffordanceCandidate[0].candidateId = "candidate:resume-through-affordance";
resumeAsAffordanceCandidate[0].targetHandle = "affordance:work:resume";
resumeAsAffordanceCandidate[0].actionBinding = {
  kind: "affordance",
  targetCharacterId: "",
  objectId: "",
  destinationId: "",
  positionId: "",
  affordanceId: "affordance:work:resume",
};
const resumeAsAffordanceValidation = validateAgentGeneratedCandidates(resumeAsAffordanceCandidate, {
  agentTurnId: TURN_ID,
  knownEvidenceIds: [EVIDENCE_ID],
  knownTargetHandles: ["affordance:work:resume"],
  knownTargetHandlesByKind: {
    character: [],
    object: ["object:axe"],
    place: [],
    position: [],
    affordance: ["affordance:work:resume"],
  },
});
assert.equal(resumeAsAffordanceValidation.valid, true, JSON.stringify(resumeAsAffordanceValidation.errors));

const liveActivity = {
  activityId: "activity:test:accepted-spar",
  kind: "controlled_spar",
  status: "accepted",
  participantIds: ["char:self", "perceived_entity:visitor"],
  consentByCharacterId: { "char:self": "accepted", "perceived_entity:visitor": "accepted" },
};
const repeatedProposalCandidate = clone(candidates[1]);
repeatedProposalCandidate.candidateId = "candidate:repeat-live-proposal";
repeatedProposalCandidate.sharedActivity = {
  operation: "propose",
  activityId: liveActivity.activityId,
  kind: liveActivity.kind,
  participantIds: liveActivity.participantIds,
  requestedZoneId: "courtyard",
  response: "none",
  boundaries: {},
};
const repeatedProposalValidation = validateAgentGeneratedCandidates([repeatedProposalCandidate], {
  agentTurnId: TURN_ID,
  knownEvidenceIds: [EVIDENCE_ID],
  knownTargetHandles: ["perceived_entity:visitor"],
  characterId: "char:self",
  sharedActivities: [liveActivity],
  enforceSharedActivityLifecycle: true,
});
assert.ok(
  repeatedProposalValidation.errors.some((entry) => entry.code === "AGENT_CANDIDATE_SHARED_ACTIVITY_ALREADY_LIVE"),
  "an accepted activity must continue from shared memory instead of being proposed again",
);

const startAcceptedCandidate = clone(repeatedProposalCandidate);
startAcceptedCandidate.candidateId = "candidate:start-accepted-activity";
startAcceptedCandidate.sharedActivity.operation = "start";
const startAcceptedValidation = validateAgentGeneratedCandidates([startAcceptedCandidate], {
  agentTurnId: TURN_ID,
  knownEvidenceIds: [EVIDENCE_ID],
  knownTargetHandles: ["perceived_entity:visitor"],
  characterId: "char:self",
  sharedActivities: [liveActivity],
  enforceSharedActivityLifecycle: true,
});
assert.equal(startAcceptedValidation.valid, true, JSON.stringify(startAcceptedValidation.errors));

const counteredActivity = {
  ...clone(liveActivity),
  activityId: "activity:test:countered-spar",
  status: "countered",
  consentByCharacterId: { "char:self": "pending", "perceived_entity:visitor": "accepted" },
};
const acceptCounterCandidate = clone(repeatedProposalCandidate);
acceptCounterCandidate.candidateId = "candidate:accept-countered-activity";
acceptCounterCandidate.sharedActivity = {
  ...acceptCounterCandidate.sharedActivity,
  operation: "respond",
  activityId: counteredActivity.activityId,
  response: "accept",
};
const acceptCounterValidation = validateAgentGeneratedCandidates([acceptCounterCandidate], {
  agentTurnId: TURN_ID,
  knownEvidenceIds: [EVIDENCE_ID],
  knownTargetHandles: ["perceived_entity:visitor"],
  characterId: "char:self",
  sharedActivities: [counteredActivity],
  enforceSharedActivityLifecycle: true,
});
assert.equal(
  acceptCounterValidation.valid,
  true,
  `the pending participant must be able to respond to a counteroffer: ${JSON.stringify(acceptCounterValidation.errors)}`,
);

const withdrawCounterCandidate = clone(acceptCounterCandidate);
withdrawCounterCandidate.candidateId = "candidate:withdraw-countered-activity";
withdrawCounterCandidate.sharedActivity.operation = "withdraw";
withdrawCounterCandidate.sharedActivity.response = "none";
const withdrawCounterValidation = validateAgentGeneratedCandidates([withdrawCounterCandidate], {
  agentTurnId: TURN_ID,
  knownEvidenceIds: [EVIDENCE_ID],
  knownTargetHandles: ["perceived_entity:visitor"],
  characterId: "char:self",
  sharedActivities: [counteredActivity],
  enforceSharedActivityLifecycle: true,
});
assert.equal(
  withdrawCounterValidation.valid,
  true,
  `a participant must be able to leave a countered activity: ${JSON.stringify(withdrawCounterValidation.errors)}`,
);

const toolGeneratedCandidate = clone(candidates);
toolGeneratedCandidate[0].originAuthority = "psychology-tool";
assert.ok(
  validateAgentGeneratedCandidates(toolGeneratedCandidate, {
    agentTurnId: TURN_ID,
    knownEvidenceIds: [EVIDENCE_ID],
    knownTargetHandles: ["perceived_entity:visitor"],
  }).errors.some((entry) => entry.code === "AGENT_CANDIDATE_AUTHORITY_INVALID"),
  "a mathematical tool may not originate a Character Agent candidate",
);

const evaluation = evaluateCharacterAgentCandidates({
  agentTurnId: TURN_ID,
  candidates,
  snapshot,
  profile: profile(),
});
assert.equal(evaluation.authority, "character-private-psychology-tool");
assert.equal(evaluation.selection, null);
assert.equal(evaluation.evaluations.length, candidates.length);
assert.ok(evaluation.evaluations.every((row) => Number.isFinite(row.predictedTendencyProbability)));
assert.ok(Math.abs(evaluation.evaluations.reduce((sum, row) => sum + row.predictedTendencyProbability, 0) - 1) < 0.00001);
assert.equal(auditCharacterPsychologyToolOutput(evaluation).valid, true);

const forbiddenSelection = clone(evaluation);
forbiddenSelection.selectedCandidateId = candidates[0].candidateId;
assert.ok(
  auditCharacterPsychologyToolOutput(forbiddenSelection).issues.some((entry) => entry.code === "PSYCHOLOGY_TOOL_FORBIDDEN_FIELD"),
  "a psychology tool output must fail if it selects an action",
);

const forbiddenExpression = clone(snapshot);
forbiddenExpression.privateFactorLedger.expressionStrategy = { mode: "firm-boundary" };
assert.ok(
  auditCharacterPsychologyToolOutput(forbiddenExpression).issues.some((entry) => entry.path.endsWith("expressionStrategy")),
  "a psychology tool output must fail if it prescribes an expression mode",
);

const lowerRankedCandidateId = evaluation.evaluations
  .slice()
  .sort((left, right) => left.expectedUtility - right.expectedUtility)[0].candidateId;
const decision = {
  ownerAuthority: "character-agent",
  schemaVersion: 3,
  agentTurnId: TURN_ID,
  generatedCandidates: candidates,
  selectedCandidateId: lowerRankedCandidateId,
  regulationChoice,
  goalPreservation: {
    preservedDesireIds: [],
    transformedDimensions: ["timing"],
    terminalExperiencePreserved: false,
    acceptedDelay: true,
    acceptedResidualFrustration: 0.36,
    privateBasis: "这次选择只保留未来机会，不把观察说成已经得到亲历验证。",
  },
  emotionHandling: [{ channel: "attentionLock", handling: "masked", basis: "继续承担控制成本" }],
  communicationPlan: { goal: "obtain_information", disclosure: "partial" },
  speechRealizationPlan: { timing: "after_action", propositionalPayload: [], affectiveTexture: [] },
  embodiedIntent: { automaticReaction: "", chosenRegulation: "", intendedGesture: "" },
  utterance: { literalSpeech: "", vocalMode: "conversational" },
  actionAttempt: { primitive: "observe", objectId: "", targetCharacterId: "perceived_entity:visitor", destinationId: "", affordanceId: "" },
  privateDecisionBasis: "本人选择承担较慢的信息收益，而不是服从最高预测值。",
};
assert.equal(
  validateCharacterAgentDecisionV3(decision, { candidateIds: candidates.map((candidate) => candidate.candidateId) }).valid,
  true,
  "the Character Agent may deliberately choose a non-maximum candidate",
);

const decisionWithWorldOutcome = clone(decision);
decisionWithWorldOutcome.worldOutcome = { success: true };
assert.ok(
  validateCharacterAgentDecisionV3(decisionWithWorldOutcome, { candidateIds: candidates.map((candidate) => candidate.candidateId) })
    .errors.some((entry) => entry.code === "AGENT_DECISION_WORLD_OUTCOME_FORBIDDEN"),
  "the Character Agent may attempt an action but may not pre-commit the world's result",
);

console.log(JSON.stringify({
  version: CHARACTER_PSYCHOLOGY_TOOLS_VERSION,
  status: "passed",
  checks: {
    subjectiveAppraisalAuthority: true,
    mixedEmotion: true,
    stateDependentControl: true,
    personalityDifferentiation: true,
    regulationWithoutExpressionPrescription: true,
    characterOwnedCandidates: true,
    mathematicalEvaluationWithoutSelection: true,
    nonMaximumChoiceAllowed: true,
    worldOutcomeBoundary: true,
    regulationCarryoverWithoutPsychologicalOutcomeInference: true,
  },
}, null, 2));
