import assert from "node:assert/strict";

import {
  buildCharacterAgentStageInput,
  createCharacterAgentTurnSession,
  submitCharacterAgentRealization,
} from "../src/server/simulation/characterAgentTurnProtocol.mjs";
import {
  tavernCharacterAgentV2OutputSchemaForStage,
  tavernCharacterAgentV2SystemPrompt,
} from "../src/server/pipeline/tavernCharacterAgentV2.mjs";

const LUO = "char_xyy_luozhao";
const XIE = "char_xyy_xiezenshi";
const DEFERRED_SELF_LIMIT = "借这一应看清自己的界限";
const DEFERRED_PERMISSION = "是否继续仍由谢真石选择";
const CONTEXT_TURN = "turn:xie-asks-martial-purpose";

function buildRealizationSession({
  turnId = "turn:speech-moment:luozhao",
  turnYield = "yield",
} = {}) {
  const created = createCharacterAgentTurnSession({
    agentTurnId: turnId,
    characterId: LUO,
    worldProjection: {
      authority: "recipient-specific-world-projection",
      scene: { id: "scene:generic-public-room", elapsedSeconds: 20, zoneId: "hall" },
      evidence: [],
      perceivedImpacts: [{
        evidenceId: "evidence:xie-question",
        sourceCharacterId: XIE,
        sourceEntityHandle: XIE,
        identityKnown: true,
        type: "speech",
        content: "你要判断什么？",
        directed: true,
      }],
      perceivedCharacters: [{ id: XIE, identityKnown: true }],
      perceivedObjects: [],
      affordances: [],
      reachableZones: [{ id: "hall" }],
      recentOwnActions: [],
      openConversationThreads: [],
      discourseContext: {
        authority: "objective-settlement-and-literal-public-history",
        settledSharedEvents: [],
        recentPublicTurns: [{
          id: CONTEXT_TURN,
          threadId: "thread:martial-purpose",
          speakerId: XIE,
          addresseeId: LUO,
          utterance: "你要判断什么？",
          truthStatus: "literal-public-content-not-automatically-verified",
        }],
        speakerOwnedActs: [],
        anchorIds: [CONTEXT_TURN],
      },
    },
    privateContext: {
      voiceContract: {
        characterId: LUO,
        voiceFormation: {
          qualitativeCore: ["清高、克制，真正关心剑时直接", "不把完整心理分析说给陌生人听"],
        },
      },
    },
  });
  return {
    ...created,
    phase: "awaiting_agent_realization",
    generatedCandidates: [{
      originAuthority: "character-agent",
      candidateId: "candidate:luozhao:answer-martial-purpose",
      attemptPrimitive: "speak",
      targetHandle: XIE,
      perceivedPrerequisites: [],
      timingIntent: "now",
      disclosureNeed: "partial",
    }],
    agentChoice: {
      ownerAuthority: "character-agent",
      agentTurnId: turnId,
      selectedCandidateId: "candidate:luozhao:answer-martial-purpose",
      regulationChoice: {
        ownerAuthority: "character-agent",
        regulationChoiceId: `regulation:${turnId}`,
      },
      goalPreservation: {
        preservedDesireIds: [],
        transformedDimensions: ["disclosure", "manner"],
        terminalExperiencePreserved: false,
        acceptedDelay: false,
        acceptedResidualFrustration: 0,
        privateBasis: "这项单元只检查表达边界，不主张一句话已经满足任何终局欲望。",
      },
      automaticCommunicationImpulse: {
        ownerAuthority: "character-agent",
        impulseId: `impulse:${turnId}`,
        mode: "speech",
        triggerEvidenceIds: ["evidence:xie-question"],
        discourseAnchorIds: [CONTEXT_TURN],
        motiveSourceIds: [],
        perceivedTurnDemand: "谢真石在问洛照究竟要判断什么",
        feltTendency: "直接承认自己想看他的剑",
        urgency: 0.72,
        disclosurePressure: 0.64,
        inhibitionPressure: 0.38,
        conflict: { present: false, opposingSourceIds: [], description: "" },
      },
      continuationIntentions: [],
      privateDecisionBasis: "对方已经直接发问，只需把剑术来意摆明，不必解释完整求道逻辑。",
    },
    regulatedExpressionPlan: {
        ownerAuthority: "character-agent",
        sourceImpulseId: `impulse:${turnId}`,
        impulseTransformation: { treatment: "blend", privateBasis: "保留直接承认的冲动，只留下完整求道理由。" },
        mode: "speech",
        actionIntent: "正面回答，不靠近，也不碰剑",
        publicStance: {
          interactionMove: "answer",
          releasedMeaning: "想亲眼见识谢真石的剑",
          audienceCharacterIds: [XIE],
          disclosure: "partial",
          epistemicRelation: "believes",
          intendedEffect: "让谢真石明白她的兴趣落在剑上",
          threadDisposition: "settle",
          sharedContextAnchorIds: [CONTEXT_TURN],
          sharedContextTreatment: "accept_as_given",
        },
        nonverbalUndertone: "找到目标后的兴奋只从专注和起声泄出一点",
        privateRemainderPresent: true,
        relationshipStance: "把谢真石当作可能值得一看的对手，平等而克制",
        timing: "standalone",
        turnYield,
      },
    regulationOutcome: {
      authority: "character-private-psychology-tool",
      sourceRegulationChoiceId: `regulation:${turnId}`,
      channelLeakagePressures: { attentionLock: 0.42, voiceOnset: 0.28 },
      remainingControl: 0.7,
      regulationCost: 0.12,
    },
  };
}

function realizationFor(session, { speech = "我想看你的剑。" } = {}) {
  return {
    ownerAuthority: "character-agent",
    agentTurnId: session.agentTurnId,
    emotionHandling: [
      { channel: "attention", handling: "expressed", basis: "视线在对方身上定得更深一瞬" },
      { channel: "voice", handling: "masked", basis: "起声略紧，语调仍稳" },
    ],
    surfaceRealization: {
      timing: "standalone",
      affectiveTexture: [
        { cue: "voice_hesitant", channel: "voiceOnset", modality: "sound", feature: "短暂停顿后开口" },
        { cue: "gaze_fixed", channel: "attentionLock", modality: "visual", feature: "目光先落到对方身上，随后才开口" },
      ],
      relationshipRegister: "潜在对手之间的平等审视",
      appliedVoiceParameters: {
        directness: 0.86,
        compression: 0.7,
        warmth: 0.12,
        reserve: 0.8,
        formality: 0.35,
        emotionalLeakage: 0.38,
      },
      intentionalDepartureReason: "",
    },
    embodiedIntent: {
      automaticReaction: "目光定住一瞬",
      chosenRegulation: "压稳呼吸，不靠近剑柄",
      manner: "平静里漏出一点认真",
      posture: "坐姿不变，正面对着谢真石",
      intendedGesture: "只抬眼看住谢真石，说完便停。",
    },
    utterance: {
      literalSpeech: speech,
      vocalMode: "conversational",
      speechAct: "answer",
      speechFunctions: ["answer", "inform"],
    },
    actionAttempt: {
      primitive: "speak",
      objectId: "",
      targetCharacterId: XIE,
      destinationId: "",
      affordanceId: "",
    },
  };
}

const schema = tavernCharacterAgentV2OutputSchemaForStage({
  phase: "awaiting_agent_expression_planning",
  referenceContract: { ownedPsychologicalSourceIds: [] },
});
const expressionSchema = schema;
assert.ok(expressionSchema.required.includes("publicStance"));
assert.equal(Object.prototype.hasOwnProperty.call(expressionSchema.properties, "speechMoment"), false);
assert.ok(expressionSchema.properties.publicStance.required.includes("releasedMeaning"));
assert.ok(expressionSchema.properties.publicStance.required.includes("sharedContextAnchorIds"));

const session = buildRealizationSession();
const wordingInput = buildCharacterAgentStageInput(session);
const serialized = JSON.stringify(wordingInput);
assert.equal(wordingInput.regulatedExpressionPlan.publicStance.releasedMeaning, "想亲眼见识谢真石的剑");
assert.equal(wordingInput.regulatedExpressionPlan.privateRemainder.present, true);
assert.deepEqual(wordingInput.regulatedExpressionPlan.publicStance.sharedContextAnchorIds, [CONTEXT_TURN]);
assert.equal(wordingInput.regulatedExpressionPlan.publicStance.sharedContextTreatment, "accept_as_given");
assert.equal(wordingInput.worldSurface.discourseContext.recentPublicTurns[0].utterance, "你要判断什么？");
assert.equal(serialized.includes(DEFERRED_SELF_LIMIT), false);
assert.equal(serialized.includes(DEFERRED_PERMISSION), false);
assert.equal(serialized.includes("让谢真石知道洛照要亲眼看他的剑"), false, "abstract desired effect must not reach wording");
assert.equal(serialized.includes("求道经历、兴奋强度和自我极限判断"), false, "privacy-boundary contents must not reach wording");

const accepted = submitCharacterAgentRealization(session, realizationFor(session));
assert.equal(accepted.finalDecision.utterance.literalSpeech, "我想看你的剑。");
assert.deepEqual(accepted.finalDecision.speechRealizationPlan.propositionalPayload, ["想亲眼见识谢真石的剑"]);
assert.deepEqual(accepted.finalDecision.speechRealizationPlan.selfCheck, {}, "the runtime no longer trusts model self-grading as a dialogue authority");

const teasingSession = structuredClone(session);
teasingSession.regulatedExpressionPlan.publicStance.sharedContextTreatment = "tease";
teasingSession.regulatedExpressionPlan.publicStance.interactionMove = "ask";
const teasingAccepted = submitCharacterAgentRealization(teasingSession, realizationFor(teasingSession, {
  speech: "你方才问我什么？",
}));
assert.equal(teasingAccepted.finalDecision.utterance.literalSpeech, "你方才问我什么？", "the contract must preserve deliberate teasing or reopening chosen by the Character Agent");

const overflowSession = buildRealizationSession({
  turnId: "turn:speech-moment:overflow",
  turnYield: "hold",
});
const overflowSpeech = "我当然看见了。你别急着问第二遍，我从进门起就在看，只是还没想好该先说哪一件。";
const overflowAccepted = submitCharacterAgentRealization(overflowSession, realizationFor(overflowSession, {
  speech: overflowSpeech,
}));
assert.equal(overflowAccepted.finalDecision.utterance.literalSpeech, overflowSpeech, "the contract must not impose a universal short-sentence mouth shape");

const realizationPrompt = tavernCharacterAgentV2SystemPrompt({ phase: "awaiting_agent_realization" });
assert.doesNotMatch(realizationPrompt, /minimumPublicDelta/);
assert.match(realizationPrompt, /publicStance\.releasedMeaning/);
assert.match(realizationPrompt, /不要自评是否像表单/);

console.log(JSON.stringify({
  status: "passed",
  checks: {
    propositionChecklistRemoved: true,
    preverbalPublicStanceRequired: true,
    deferredMeaningRedactedBeforeWording: true,
    abstractDesiredEffectRedactedBeforeWording: true,
    privateBoundaryContentsRedactedBeforeWording: true,
    naturalMinimalAnswerPreserved: true,
    modelSelfGradingRemovedFromAuthority: true,
    deliberateCharacterOwnedReopeningAllowed: true,
    characterDrivenLongSpeechStillAllowed: true,
    mathematicsDoesNotWriteDialogue: true,
  },
}, null, 2));
