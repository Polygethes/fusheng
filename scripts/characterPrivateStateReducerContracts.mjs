import assert from "node:assert/strict";

import { createCharacterAgentMemoryState } from "../src/engine/characterAgentMemory.js";
import { reduceCharacterPrivateTurn } from "../src/server/simulation/characterPrivateStateReducer.mjs";

const OWNER = "char:private-owner";
const TARGET = "char:private-target";
const TURN = `agent-turn:${OWNER}:1`;
const EVIDENCE = "evidence:target-spoke";
const IMPACT = "event:target-spoke";

const previousPrivateState = {
  ownerCharacterId: OWNER,
  memoryContext: createCharacterAgentMemoryState(OWNER),
  relationshipContext: [{
    id: `relationship:${OWNER}:${TARGET}`,
    fromCharacterId: OWNER,
    toCharacterId: TARGET,
    trust: 20,
  }],
  ecologyState: {
    characterPsychologyV2State: {},
    voiceHabitUsage: [],
  },
  recentOwnActions: [],
  appliedPrivateTransitionIds: [],
  reflectionState: {
    schemaVersion: "character-reflection-v1",
    authority: "character-private-reflection-ledger",
    ownerCharacterId: OWNER,
    threshold: 1,
    accumulatedImportance: 0.5,
    accountedImportanceByMemoryId: {},
    accumulationSourceMemoryIds: [],
    pendingOpportunity: null,
    completedOpportunityIds: [],
    completedOpportunities: [],
    nextOpportunitySequence: 1,
  },
};
const before = structuredClone(previousPrivateState);

const acceptedSession = {
  characterId: OWNER,
  agentTurnId: TURN,
  phase: "ready_for_world_resolution",
  history: [
    { stage: "subjective_appraisal_accepted" },
    { stage: "agent_candidates_accepted" },
    { stage: "agent_choice_accepted" },
    { stage: "agent_expression_plan_accepted" },
    { stage: "agent_realization_accepted" },
  ],
  privateContext: { profile: {} },
  subjectiveAppraisal: {
    noticedEvidenceIds: [EVIDENCE],
    interpretations: [{ evidenceIds: [EVIDENCE], meaning: "对方认真给出了答复", confidence: 0.82 }],
    beliefOperations: [{
      proposition: "对方愿意认真回应我",
      operation: "adopt",
      confidence: 0.76,
      sourceEvidenceIds: [EVIDENCE],
      reasoningMode: "direct",
    }],
    epistemicPositions: [{
      positionId: "epistemic-position:target-intent",
      domain: "intent",
      subjectHandle: TARGET,
      proposition: "对方此刻愿意认真回应我",
      confidence: 0.76,
      status: "provisional",
      workingStance: "provisional_for_reversible_action",
      relianceScope: "ordinary_reversible",
      basisEvidenceIds: [EVIDENCE],
      basisPsychologicalSourceIds: [],
      privateReason: "这足以继续当前交谈，但不是对他长期意图的最终结论。",
    }],
    entityModelUpdates: [],
    locationBeliefUpdates: [],
    sourceKnowledgeBeliefUpdates: [],
    threadAppraisals: [],
    relationshipAppraisal: {
      phase: "pending_perception_appraisal",
      targetCharacterId: TARGET,
      sourceImpactIds: [IMPACT],
      changeMode: "retained",
      dimensionChanges: [{ metric: "trust", direction: "increase", strengthBand: "medium" }],
      reason: "他没有敷衍。",
    },
  },
  psychologySnapshot: {
    authority: "character-private-psychology-tool",
    agentTurnId: TURN,
    affectSummary: { valence: 0.35, arousal: 0.42 },
    desireActivations: [{ desireId: "desire:test", value: 0.72 }],
    epistemicPositions: [{
      positionId: "epistemic-position:target-intent",
      domain: "intent",
      subjectHandle: TARGET,
      proposition: "对方此刻愿意认真回应我",
      confidence: 0.76,
      status: "provisional",
      workingStance: "provisional_for_reversible_action",
      relianceScope: "ordinary_reversible",
      basisEvidenceIds: [EVIDENCE],
      basisPsychologicalSourceIds: [],
      privateReason: "这足以继续当前交谈，但不是对他长期意图的最终结论。",
    }],
    sourceNoticedEvidenceIds: [EVIDENCE],
    maturedContinuationIntentions: [],
    priorActionOutcomeFeedback: {},
  },
  generatedCandidates: [{
    candidateId: "candidate:ask",
    attemptPrimitive: "speak",
    targetHandle: TARGET,
    perceivedPrerequisites: [EVIDENCE],
    factorInputs: { informationGain: 0.5 },
  }],
  candidateEvaluation: {
    evaluations: [{ candidateId: "candidate:ask", expectedUtility: 0.58, factorVector: [] }],
  },
  agentChoice: {
    selectedCandidateId: "candidate:ask",
    automaticCommunicationImpulse: { triggerEvidenceIds: [EVIDENCE] },
    continuationIntentions: [{
      ownerAuthority: "character-agent",
      intentionId: "continuation:listen-for-answer",
      triggerType: "target_response",
      intendedPrimitive: "listen",
      targetHandle: TARGET,
      linkedSourceIds: ["desire:test"],
      minimumDelaySeconds: 0,
      triggerThreshold: 0.5,
      maxDeferrals: 2,
      privatePurpose: "等他的回答",
    }],
  },
  regulationOutcome: {
    authority: "character-private-psychology-tool",
    agentTurnId: TURN,
    remainingControl: 0.7,
    regulationCost: 0.18,
    reboundRisk: 0.08,
    residualEmotion: [],
    channelLeakagePressures: {},
  },
  finalDecision: {
    selectedCandidateId: "candidate:ask",
    realizedSpeechHabitIds: ["habit:evidence-first"],
    continuationIntentions: [{ intentionId: "continuation:listen-for-answer" }],
    communicationPlan: { epistemicBasisEvidenceIds: [EVIDENCE] },
    utterance: { literalSpeech: "我听着。" },
    embodiedIntent: { intendedGesture: "抬眼看向对方" },
    actionAttempt: { primitive: "speak", targetCharacterId: TARGET },
  },
};

const result = reduceCharacterPrivateTurn({
  ownerCharacterId: OWNER,
  previousPrivateState,
  acceptedSession,
  ownedEvidenceRecords: [{
    eventId: IMPACT,
    impactId: IMPACT,
    evidenceId: EVIDENCE,
    recipientCharacterId: OWNER,
    sourceCharacterId: TARGET,
    sourceEntityHandle: TARGET,
    identityKnown: true,
    modality: "direct_speech",
    content: "我会认真答你。",
    topic: "答复",
    directed: true,
    receivedIntensity: 82,
    personalRelevance: 78,
    semanticFrame: {
      kind: "social_response",
      predicate: "answer",
      topicId: "topic:answer",
      roles: { speaker: TARGET, receiver: OWNER },
      object: { id: "answer:1", label: "明确答复" },
      importance: 0.72,
    },
    provenance: { kind: "firsthand", sourceCharacterChain: [TARGET], confidence: 0.98 },
  }],
  nowSeconds: 12,
  relationshipPolicy: {
    metricIds: ["trust"],
    deltaByStrength: { low: 1, medium: 3, high: 6 },
  },
});

assert.equal(result.authority, "character-private-state-reducer");
assert.deepEqual(previousPrivateState, before, "the reducer must not mutate the Actor's previous private state");
assert.ok(result.privateStatePatch.memoryContext.episodes.some((row) => row.evidenceIds.includes(EVIDENCE)), "noticed firsthand evidence should become the owner's episodic memory");
assert.ok(result.privateStatePatch.memoryContext.beliefs.some((row) => row.proposition === "对方愿意认真回应我"), "the owner's subjective belief operation should survive into the next turn");
assert.equal(result.privateStatePatch.relationshipContext[0].trust, 23, "a retained owner-to-target appraisal should update only the configured private relation metric");
assert.equal(result.privateStatePatch.ecologyState.characterPsychologyV2State.lastAgentTurnId, TURN);
assert.deepEqual(
  result.privateStatePatch.ecologyState.characterPsychologyV2State.epistemicPositions
    .map((row) => [row.positionId, row.workingStance]),
  [["epistemic-position:target-intent", "provisional_for_reversible_action"]],
  "the Character Agent's revisable working stance must survive into its next private turn",
);
assert.deepEqual(
  result.privateStatePatch.ecologyState.characterPsychologyV2State.continuationIntentions.map((row) => row.intentionId),
  ["continuation:listen-for-answer"],
  "continuation intentions must survive as private psychology state",
);
assert.deepEqual(result.receiptTransitions.noticedEvidenceIds, [EVIDENCE]);
assert.deepEqual(result.receiptTransitions.appraisedEvidenceIds, [EVIDENCE]);
assert.deepEqual(result.receiptTransitions.consumedEvidenceIds, [], "Phase 85 must not invent evidence consumption without an Agent disposition");
assert.equal(result.privateStatePatch.pendingAttemptContinuityById[`action-attempt:${TURN}`].selectedCandidateId, "candidate:ask");
assert.ok(result.privateStatePatch.appliedPrivateTransitionIds.includes(`private-turn:${TURN}`));
assert.equal(
  result.privateStatePatch.reflectionState.pendingOpportunity.status,
  "due",
  "newly noticed important memory must advance the owner's private reflection ledger",
);
assert.ok(
  result.privateStatePatch.reflectionState.pendingOpportunity.sourceMemoryIds
    .some((memoryId) => result.privateStatePatch.memoryContext.episodes.some((episode) => episode.id === memoryId)),
  "a reflection opportunity must cite the exact newly encoded owned episode",
);
assert.equal(JSON.stringify(result).includes("worldProjection"), false, "raw world projections must not be stored in the Character's private state");

const knownCanonicalTarget = "char_xyy_known_target";
const knownCanonicalSession = structuredClone(acceptedSession);
knownCanonicalSession.subjectiveAppraisal.relationshipAppraisal = {
  phase: "pending_perception_appraisal",
  targetCharacterId: knownCanonicalTarget,
  sourceImpactIds: [],
  changeMode: "none",
  dimensionChanges: [],
  reason: "本轮只验证已知身份句柄的私人认识写回。",
};
knownCanonicalSession.subjectiveAppraisal.entityModelUpdates = [{
  perceivedEntityHandle: knownCanonicalTarget,
  noticedEvidenceIds: [EVIDENCE],
  hypotheses: [{
    hypothesisId: "hypothesis:known-target-present",
    proposition: "这个已经确认身份的人正在面前回应我",
    operation: "adopt",
    confidenceBand: "high",
    basisEvidenceIds: [EVIDENCE],
  }],
  identityCandidates: [{
    knownEntityHandle: knownCanonicalTarget,
    operation: "adopt",
    confidenceBand: "high",
    basisEvidenceIds: [EVIDENCE],
  }],
  affectiveResponse: { label: "确认", valence: 0.1, arousal: 0.2 },
  attentionPriority: 0.7,
}];
knownCanonicalSession.subjectiveAppraisal.locationBeliefUpdates = [{
  subjectHandle: knownCanonicalTarget,
  locationHandle: "hall",
  operation: "revise",
  assertedLikelihood: 0.98,
  sourceReliability: 0.97,
  confidenceBand: "high",
  basisEvidenceIds: [EVIDENCE],
  sourceType: "directly_heard_nearby_speech",
}];
const knownCanonicalResult = reduceCharacterPrivateTurn({
  ownerCharacterId: OWNER,
  previousPrivateState,
  acceptedSession: knownCanonicalSession,
  ownedEvidenceRecords: [{
    eventId: IMPACT,
    impactId: IMPACT,
    evidenceId: EVIDENCE,
    recipientCharacterId: OWNER,
    sourceCharacterId: knownCanonicalTarget,
    perceivedSourceCharacterId: knownCanonicalTarget,
    identityKnown: true,
    modality: "direct_speech",
    content: "我就在这里。",
  }],
  nowSeconds: 12,
  relationshipPolicy: { metricIds: ["trust"] },
});
assert.equal(
  knownCanonicalResult.privateStatePatch.memoryContext.privateEntityModels[0].perceivedEntityHandle,
  knownCanonicalTarget,
  "a canonical handle may be used only when owned evidence identifies that known person",
);
assert.equal(
  knownCanonicalResult.privateStatePatch.memoryContext.locationBeliefs[0].subjectHandle,
  knownCanonicalTarget,
);

const unownedCanonicalSession = structuredClone(knownCanonicalSession);
assert.throws(() => reduceCharacterPrivateTurn({
  ownerCharacterId: OWNER,
  previousPrivateState,
  acceptedSession: unownedCanonicalSession,
  ownedEvidenceRecords: [{
    eventId: IMPACT,
    impactId: IMPACT,
    evidenceId: EVIDENCE,
    recipientCharacterId: OWNER,
    sourceCharacterId: "",
    perceivedSourceCharacterId: "",
    identityKnown: false,
    modality: "sound",
    content: "有人在附近说话。",
  }],
}), (error) => error?.code === "CHARACTER_PRIVATE_REDUCER_SPECIALIZED_UPDATE_REJECTED");

assert.throws(() => reduceCharacterPrivateTurn({
  ownerCharacterId: "char:other",
  previousPrivateState,
  acceptedSession,
  ownedEvidenceRecords: [],
}), (error) => error?.code === "CHARACTER_PRIVATE_REDUCER_OWNER_MISMATCH");

const invalidSession = structuredClone(acceptedSession);
invalidSession.subjectiveAppraisal.entityModelUpdates = [{
  perceivedEntityHandle: "unknown-person",
  noticedEvidenceIds: ["evidence:not-owned"],
  hypotheses: [],
  identityCandidates: [],
  affectiveResponse: {},
  attentionPriority: 0.4,
}];
assert.throws(() => reduceCharacterPrivateTurn({
  ownerCharacterId: OWNER,
  previousPrivateState,
  acceptedSession: invalidSession,
  ownedEvidenceRecords: [],
}), (error) => error?.code === "CHARACTER_PRIVATE_REDUCER_EVIDENCE_NOT_OWNED");
assert.deepEqual(previousPrivateState, before, "a rejected private transition must be atomic");

console.log(JSON.stringify({
  status: "all-passed",
  checks: {
    acceptedTurnWritesMemory: true,
    relationshipWriteIsDirectionalAndPolicyBound: true,
    psychologyAndContinuationCarry: true,
    receiptClaimIsExplicitAndNonConsuming: true,
    forbiddenAuthorityDoesNotLeak: true,
    confirmedCanonicalIdentityCanEnterPrivateBelief: true,
    unconfirmedCanonicalIdentityRemainsForbidden: true,
    reducerIsAtomic: true,
  },
}, null, 2));
