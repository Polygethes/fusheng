import assert from "node:assert/strict";

import {
  buildCharacterAgentStageInput,
  createCharacterAgentTurnSession,
  submitCharacterAgentExpressionPlan,
} from "../src/server/simulation/characterAgentTurnProtocol.mjs";

const CHARACTER = "character:language-impulse";
const TARGET = "character:listener";
const EVIDENCE = "evidence:listener-question";
const TURN_ANCHOR = "turn:listener-question";
const DESIRE = "desire:protect-purpose";
const VALUE = "value:answer-without-submission";
const IMPULSE = "impulse:language:1";

const created = createCharacterAgentTurnSession({
  agentTurnId: "agent-turn:language-impulse:1",
  characterId: CHARACTER,
  worldProjection: {
    authority: "recipient-specific-world-projection",
    scene: { id: "scene:generic-room", elapsedSeconds: 12, zoneId: "hall" },
    evidence: [{ evidenceId: EVIDENCE, sourceCharacterId: TARGET, content: "你来找谁？" }],
    perceivedImpacts: [{ evidenceId: EVIDENCE, sourceCharacterId: TARGET, content: "你来找谁？", type: "speech" }],
    perceivedCharacters: [{ id: TARGET, identityKnown: true }],
    perceivedObjects: [],
    materialFacts: [],
    recentOwnActions: [{ actionId: "action:tea-served", actionType: "serve_guest", settled: true }],
    openConversationThreads: [],
    socialContext: { participantIds: [CHARACTER, TARGET], thirdPartyObserverIds: [] },
    discourseContext: {
      authority: "objective-settlement-and-literal-public-history",
      settledSharedEvents: [],
      speakerOwnedActs: [{ id: "action:tea-served", actionType: "serve_guest", settled: true }],
      recentPublicTurns: [{ id: TURN_ANCHOR, speakerId: TARGET, addresseeId: CHARACTER, utterance: "你来找谁？" }],
      anchorIds: ["action:tea-served", TURN_ANCHOR],
    },
  },
  privateContext: {
    profile: { personality: { selfControl: 0.76 } },
    state: { body: { fatigue: 0.18, thirst: 0.1 }, mood: { valence: 0.05, arousal: 0.42 } },
    desires: [{ desireId: DESIRE }],
    values: [{ valueId: VALUE }],
    relationships: [{ relationshipId: `relationship:${CHARACTER}:${TARGET}`, targetCharacterId: TARGET, familiarity: 0.2 }],
    memoryContext: { episodes: [], beliefs: [], commitments: [] },
    voiceContract: { characterId: CHARACTER, voiceFormation: { qualitativeCore: ["克制、直接，不主动交代完整目的"] } },
  },
});

const impulse = {
  ownerAuthority: "character-agent",
  impulseId: IMPULSE,
  mode: "speech",
  triggerEvidenceIds: [EVIDENCE],
  discourseAnchorIds: [TURN_ANCHOR],
  motiveSourceIds: [DESIRE, VALUE],
  perceivedTurnDemand: "对方在问来意，但人物不愿把完整目的交出去",
  feltTendency: "先把问题挡回去，只给最少的回答入口",
  urgency: 0.64,
  disclosurePressure: 0.42,
  inhibitionPressure: 0.7,
  conflict: {
    present: true,
    opposingSourceIds: [DESIRE, VALUE],
    description: "既需要继续交谈，又不愿把目的完整暴露",
  },
};

const choiceStage = {
  ...structuredClone(created),
  phase: "awaiting_agent_choice_and_regulation",
  subjectiveAppraisal: { ownerAuthority: "character-agent" },
  psychologySnapshot: { authority: "character-private-psychology-tool", emotionMixture: [{ emotionId: "wariness", value: 0.58 }] },
  generatedCandidates: [{ candidateId: "candidate:answer-partially", attemptPrimitive: "speak", targetHandle: TARGET }],
  candidateEvaluation: { authority: "character-private-psychology-tool", selection: null, evaluations: [] },
};
const choiceInput = buildCharacterAgentStageInput(choiceStage);
assert.equal(choiceInput.impulseGroundingSurface.discourseContext.recentPublicTurns[0].utterance, "你来找谁？");
assert.equal(choiceInput.impulseGroundingSurface.recentOwnActions[0].actionType, "serve_guest");
assert.equal(choiceInput.impulseGroundingSurface.relationshipContext[0].targetCharacterId, TARGET);
assert.deepEqual(choiceInput.impulseGroundingSurface.bodyState, { fatigue: 0.18, thirst: 0.1 });
assert.ok(choiceInput.impulseGroundingSurface.voiceDisposition.voiceFormation);

const postRegulation = {
  ...structuredClone(choiceStage),
  phase: "awaiting_agent_expression_planning",
  agentChoice: {
    ownerAuthority: "character-agent",
    agentTurnId: created.agentTurnId,
    selectedCandidateId: "candidate:answer-partially",
    regulationChoice: { ownerAuthority: "character-agent", regulationChoiceId: "regulation:1", agentTurnId: created.agentTurnId },
    goalPreservation: { preservedDesireIds: [DESIRE] },
    automaticCommunicationImpulse: impulse,
    continuationIntentions: [],
    privateDecisionBasis: "选择只回答一部分。",
  },
  regulationOutcome: {
    authority: "character-private-psychology-tool",
    sourceRegulationChoiceId: "regulation:1",
    channelLeakagePressures: { voiceOnset: 0.38, attentionLock: 0.52 },
    remainingControl: 0.66,
    regulationCost: 0.18,
  },
};

const expressionInput = buildCharacterAgentStageInput(postRegulation);
assert.equal(expressionInput.requestedOutput, "regulated_expression_plan_only");
assert.equal(expressionInput.automaticCommunicationImpulse.impulseId, IMPULSE);
assert.equal(expressionInput.regulationSurface.sourceRegulationChoiceId, "regulation:1");
assert.equal(expressionInput.preverbalGroundingSurface.discourseContext.recentPublicTurns[0].utterance, "你来找谁？");
assert.equal(expressionInput.preverbalGroundingSurface.voiceDisposition.characterId, CHARACTER);

const regulatedExpressionPlan = {
  ownerAuthority: "character-agent",
  sourceImpulseId: IMPULSE,
  impulseTransformation: {
    treatment: "mask",
    privateBasis: "保留继续交谈的倾向，压住完整披露冲动。",
  },
  mode: "speech",
  actionIntent: "维持原位，给出最少回应",
  publicStance: {
    interactionMove: "answer",
    releasedMeaning: "只承认自己是来打听消息的",
    audienceCharacterIds: [TARGET],
    disclosure: "partial",
    epistemicRelation: "believes",
    intendedEffect: "让谈话继续但不交出完整来意",
    threadDisposition: "defer",
    sharedContextAnchorIds: [TURN_ANCHOR],
    sharedContextTreatment: "accept_as_given",
  },
  nonverbalUndertone: "戒备仍在起声和目光里",
  privateRemainderPresent: true,
  relationshipStance: "对不熟悉的询问者保持边界",
  timing: "standalone",
  turnYield: "yield",
};

assert.throws(
  () => submitCharacterAgentExpressionPlan({ ...structuredClone(postRegulation), phase: "awaiting_agent_choice_and_regulation" }, regulatedExpressionPlan),
  (error) => error.code === "CHARACTER_AGENT_TURN_PHASE_VIOLATION",
  "regulated expression planning must happen after the mathematical regulation outcome exists",
);

const realizationReady = submitCharacterAgentExpressionPlan(postRegulation, regulatedExpressionPlan);
assert.equal(realizationReady.phase, "awaiting_agent_realization");
assert.equal(realizationReady.regulatedExpressionPlan.sourceImpulseId, IMPULSE);
const realizationInput = buildCharacterAgentStageInput(realizationReady);
const serialized = JSON.stringify(realizationInput);
assert.equal(realizationInput.regulatedExpressionPlan.publicStance.releasedMeaning, "只承认自己是来打听消息的");
assert.equal(realizationInput.worldSurface.discourseContext.recentPublicTurns[0].utterance, "你来找谁？");
assert.equal(serialized.includes(impulse.feltTendency), false, "raw impulse wording must be withheld before literal realization");
assert.equal(serialized.includes(regulatedExpressionPlan.impulseTransformation.privateBasis), false, "private transformation reasoning must be withheld before literal realization");

const invalidAuthority = structuredClone(regulatedExpressionPlan);
invalidAuthority.ownerAuthority = "character-private-psychology-tool";
assert.throws(
  () => submitCharacterAgentExpressionPlan(postRegulation, invalidAuthority),
  (error) => error.code === "CHARACTER_AGENT_EXPRESSION_PLAN_REJECTED",
  "mathematics may calculate regulation residue but may not author the regulated expression plan",
);

console.log(JSON.stringify({
  status: "passed",
  checks: {
    choiceReceivesActualImpulseGrounding: true,
    automaticImpulseIsCharacterOwned: true,
    regulationOutcomePrecedesExpressionPlan: true,
    regulatedExpressionPlanIsCharacterOwned: true,
    finalWordingDoesNotReceiveRawImpulseLedger: true,
    mathematicsDoesNotSelectOrWriteExpression: true,
  },
}, null, 2));
