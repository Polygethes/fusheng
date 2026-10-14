import assert from "node:assert/strict";

import {
  bridgeTavernCharacterAgentV2ResultForWorld,
  compileTavernCharacterPsychologyProfile,
  runTavernCharacterAgentTurnV2,
  tavernCharacterAgentV2OutputSchemaForStage,
  TAVERN_CHARACTER_AGENT_V2_VERSION,
} from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import { normalizeTavernCharacterDecision } from "../src/server/pipeline/tavernCausalScene.mjs";

const CHARACTER = "char:generic:v2";
const TARGET = "perceived_entity:v2:visitor";
const EVIDENCE = "evidence:v2:visitor";
const DESIRE = "desire:v2:understand-visitor";
const VALUE = "value:v2:self-command";
const LEGACY_CANDIDATE = "legacy:precomputed:must-not-leak";
const WORLD_OBLIGATION = "complete_official_visit";

const input = {
  scene: { id: "scene:tavern:test", step: 3, elapsedSeconds: 18, zoneId: "hall", zoneLabel: "堂前" },
  agent: {
    id: CHARACTER,
    name: "测试人物",
    privateState: {
      ecologyProfile: {
        personality: { selfControl: 0.7, caution: 0.52 },
      },
      ecologyState: {
        affect: { valence: 0, arousal: 0.32 },
        body: { fatigue: 0.22, pain: 0.04 },
        desires: {
          [DESIRE]: { desireId: DESIRE, strength: 0.54, urgency: 0.32, frustration: 0.12 },
        },
        characterPsychologyV2State: {
          pendingObjectiveOutcome: {
            authority: "world-resolution",
            status: "success",
            visibleOutcome: "世界审计知道，但人物尚未感知的结果",
          },
        },
      },
    },
    psychologyAnchor: { values: [{ id: VALUE }] },
    relationshipContext: [{ targetCharacterId: TARGET, closeness: 0.1, tension: 0.18 }],
    voiceContract: {
      voiceFormation: {
        parameterModel: {
          base: { directness: 0.62, compression: 0.5, warmth: 0.3, reserve: 0.62, formality: 0.38, emotionalLeakage: 0.34 },
          pressure: { directness: 0.08, compression: 0.1, warmth: -0.04, reserve: 0.08, formality: 0, emotionalLeakage: 0.14 },
          closeness: { directness: 0.02, compression: 0.04, warmth: 0.1, reserve: -0.06, formality: -0.04, emotionalLeakage: 0.04 },
          fatigue: { directness: 0, compression: 0.1, warmth: -0.04, reserve: 0.06, formality: 0, emotionalLeakage: 0.08 },
        },
      },
      voiceFoundation: {
        schemaVersion: 1,
        habits: [{
          id: "generic_evidence_first",
          kind: "attention",
          function: "先处理本人实际注意到的证据",
          baseline: { qualitativeLevel: "high" },
          modulators: [{ signal: "topic", matches: ["social"], direction: "increase", strength: "medium" }],
          realizationChannels: ["attention", "opening_move"],
          fatigue: { repeatSensitivity: "medium", cooldownTurns: 4, minimumPressure: "low" },
        }],
      },
    },
    memoryContext: { episodes: [], beliefs: [], commitments: [] },
  },
  perceivedImpacts: [{
    evidenceId: EVIDENCE,
    impactId: "impact:v2:visitor",
    modality: "visual",
    content: "一个陌生人跨过门槛，腰间佩剑。",
    sourceEntityHandle: TARGET,
  }],
  perceivedCharacters: [{ id: TARGET, identityKnown: false, noticedFeatures: ["腰间佩剑"] }],
  perceivedObjects: [],
  availableAffordances: [{ id: "affordance:v2:table", primitive: "interact", label: "使用空桌" }],
  reachableZones: [{ id: "hall" }, { id: "counter" }],
  recentOwnActions: [{
    actionId: "settled-service:v2:test",
    actionType: "serve_guest",
    visibleAction: "已经把茶交给来客",
    settled: true,
    continuitySource: "objective-settlement-provenance",
  }],
  settledInteractionEvents: [{
    id: "settled-interaction:v2:test",
    status: "settled",
    kind: "service_delivery",
    actionId: "settled-service:v2:test",
  }],
  materialFacts: [{
    kind: "institutional_economy",
    obligations: [{ id: WORLD_OBLIGATION, description: "完成正式来访" }],
  }],
  privateActionCandidates: [{ candidateId: LEGACY_CANDIDATE, expressionStrategy: { mode: "firm-boundary" } }],
};

const highControlProfile = compileTavernCharacterPsychologyProfile({
  agent: {
    privateState: { ecologyProfile: { personality: { selfControl: 0.5 } } },
    psychologyAnchor: {
      stablePsychology: {
        dispositions: {
          inhibitoryControl: { range: [0.84, 0.92], scope: "immediate-action" },
          domainExcitementGain: { range: [0.82, 0.96], scope: "novel-sword-evidence" },
        },
      },
    },
  },
});
const lowControlProfile = compileTavernCharacterPsychologyProfile({
  agent: {
    privateState: { ecologyProfile: { personality: { selfControl: 0.5 } } },
    psychologyAnchor: {
      stablePsychology: {
        dispositions: {
          inhibitoryControl: { range: [0.12, 0.24], scope: "immediate-action" },
          domainExcitementGain: { range: [0.12, 0.24], scope: "novel-sword-evidence" },
        },
      },
    },
  },
});
assert.ok(highControlProfile.personality.selfControl > lowControlProfile.personality.selfControl);
assert.ok(highControlProfile.regulation.practicedSkill > lowControlProfile.regulation.practicedSkill);
assert.ok(highControlProfile.leakage.maskingSkills.voiceOnset > lowControlProfile.leakage.maskingSkills.voiceOnset);
assert.ok(
  highControlProfile.emotionResponse.emotions.excitement.gain
    > lowControlProfile.emotionResponse.emotions.excitement.gain,
  "authored excitement sensitivity and inhibitory control must become different weights in the shared psychology formula",
);
assert.equal(highControlProfile.dispositionProjection.selection, null);

const calls = [];
async function fakeStage(stageInput, { stage }) {
  calls.push({ stage, input: structuredClone(stageInput) });
  if (stage === "subjective_appraisal") return {
    appraisal: {
      ownerAuthority: "character-agent",
      appraisalId: "appraisal:v2:test",
      agentTurnId: stageInput.agentTurnId,
      eventId: "impact:v2:visitor",
      noticedEvidenceIds: [EVIDENCE],
      interpretations: [{ evidenceIds: [EVIDENCE], meaning: "这个陌生人可能带来值得确认的信息", confidence: 0.66 }],
      beliefOperations: [],
      epistemicPositions: [],
      relevanceLinks: [{ sourceId: DESIRE, relation: "advances", strength: 0.7, confidence: 0.66 }],
      desireGroundings: [{
        desireId: DESIRE,
        feltWant: "亲自弄清这个陌生人是否值得继续留意",
        terminalExperience: "取得足以形成本人判断的第一手回应",
        terminalContractAcknowledged: true,
        promotedCriteria: [],
        activationState: "active",
        activationEvidenceIds: [EVIDENCE],
        activationPsychologicalSourceIds: [],
        missingActivationConditions: [],
        immediatePull: 0.7,
        currentlyPerceivedPossible: 0.62,
        inhibitors: [],
        acceptableTransformations: ["timing", "disclosure", "manner"],
        privateSummary: "观察和询问都只是局部取证。",
      }],
      appraisalAxes: {
        selfRelevance: 0.56,
        goalCongruence: 0.46,
        novelty: 0.58,
        expectedness: -0.24,
        opportunityValue: 0.62,
        threat: 0.2,
        controllability: 0.58,
        changeability: 0.62,
        certaintyDelta: 0.28,
        normCompatibility: 0.4,
        selfImageCongruence: 0.08,
        publicExposure: 0.54,
        relationshipMeaning: { affiliation: 0, status: 0, trust: 0, rejection: 0, care: 0, betrayal: 0 },
      },
      uncertainty: 0.42,
      alternativesConsidered: ["普通旅客", "值得留意的人"],
      entityModelUpdates: [],
      locationBeliefUpdates: [],
      sourceKnowledgeBeliefUpdates: [],
      threadAppraisals: [],
      relationshipAppraisal: {
        phase: "pending_perception_appraisal",
        targetCharacterId: "",
        sourceImpactIds: [],
        changeMode: "none",
        dimensionChanges: [],
        reason: "",
      },
      priorActionOutcomeAppraisal: {
        ownerAuthority: "character-agent",
        sourceAgentTurnId: stageInput.privateContext.state.priorRegulationCarryover?.pendingActionForecast?.sourceAgentTurnId || "",
        status: stageInput.privateContext.state.priorRegulationCarryover?.pendingActionForecast ? "unclear" : "no_prior_action",
        noticedOutcomeEvidenceIds: [],
        perceivedInformationGain: 0,
        perceivedGoalProgress: 0,
        perceivedCost: 0,
        unexpectedness: 0,
        stillUnresolved: Boolean(stageInput.privateContext.state.priorRegulationCarryover?.pendingActionForecast),
        summary: "",
      },
    },
  };
  if (stage === "agent_candidates") return {
    candidates: {
      ownerAuthority: "character-agent",
      agentTurnId: stageInput.agentTurnId,
      candidates: [{
        originAuthority: "character-agent",
        candidateId: "agent-v2:observe",
        intention: "继续手头动作，同时收集来客的第一手特征",
        attemptPrimitive: "observe",
        targetHandle: TARGET,
        perceivedPrerequisites: [EVIDENCE],
        domains: ["social"],
        expectedEffects: [{ sourceId: DESIRE, direction: "advance", magnitude: 0.38, confidence: 0.68 }],
        desireRelations: [{ desireId: DESIRE, relation: "probe", terminalConditionMatch: 0.26, counterfactualResult: "再取得一项来客特征", preservesNonSubstitutableConditions: false, confidence: 0.68 }],
      criterionUses: [],
      epistemicHandling: {
        positionIds: [],
        mode: "not_relevant",
        errorIfWrong: 0,
        actionReversibility: 1,
        learningDuringAction: 0,
        delayCost: 0,
        privateReason: "",
      },
        sharedActivity: { operation: "none", activityId: "", kind: "", participantIds: [], requestedZoneId: "", response: "none", boundaries: { intensity: "", propertyProtection: false, harmLimit: "", note: "" } },
        factorInputs: {
          emotionCompatibility: 0.6,
          valueAndSelfImage: 0.68,
          relationshipMeaning: 0,
          informationGain: 0.48,
          habitAndIntentionContinuity: 0.62,
          bodyCost: 0.04,
          threatAndNormCost: 0.1,
          exposureAndRelationshipRisk: 0.06,
          opportunityAndSwitchingCost: 0.14,
          uncertaintyCost: 0.3,
        },
        timingIntent: "during_current_action",
        disclosureNeed: "none",
        uncertainty: 0.34,
      }, {
        originAuthority: "character-agent",
        candidateId: "agent-v2:ask",
        intention: "直接问一个具体问题，观察来客怎样回应",
        attemptPrimitive: "speak",
        targetHandle: TARGET,
        perceivedPrerequisites: [EVIDENCE],
        domains: ["social"],
        expectedEffects: [{ sourceId: DESIRE, direction: "advance", magnitude: 0.7, confidence: 0.56 }],
        desireRelations: [{ desireId: DESIRE, relation: "probe", terminalConditionMatch: 0.48, counterfactualResult: "取得来客对一个具体问题的直接回应", preservesNonSubstitutableConditions: false, confidence: 0.56 }],
        criterionUses: [],
        epistemicHandling: {
          positionIds: [],
          mode: "not_relevant",
          errorIfWrong: 0,
          actionReversibility: 1,
          learningDuringAction: 0,
          delayCost: 0,
          privateReason: "",
        },
        sharedActivity: { operation: "none", activityId: "", kind: "", participantIds: [], requestedZoneId: "", response: "none", boundaries: { intensity: "", propertyProtection: false, harmLimit: "", note: "" } },
        factorInputs: {
          emotionCompatibility: 0.68,
          valueAndSelfImage: 0.54,
          relationshipMeaning: 0,
          informationGain: 0.76,
          habitAndIntentionContinuity: 0.46,
          bodyCost: 0.04,
          threatAndNormCost: 0.18,
          exposureAndRelationshipRisk: 0.42,
          opportunityAndSwitchingCost: 0.12,
          uncertaintyCost: 0.4,
        },
        timingIntent: "after_current_action",
        disclosureNeed: "partial",
        uncertainty: 0.42,
      }],
    },
  };
  if (stage === "agent_choice_and_regulation") return {
    choice: {
      ownerAuthority: "character-agent",
      agentTurnId: stageInput.agentTurnId,
      selectedCandidateId: "agent-v2:ask",
      regulationChoice: {
        ownerAuthority: "character-agent",
        regulationChoiceId: "regulation:v2:test",
        agentTurnId: stageInput.agentTurnId,
        strategies: [{ strategy: "tolerate", targetEmotionIds: ["curiosity"], effort: 0.42, contextFit: 0.62 }],
        intendedPublicEffect: "让好奇存在，但不向陌生人解释自己的全部判断",
        acceptedCosts: ["保留一点不确定"],
      },
      goalPreservation: {
        preservedDesireIds: [],
        transformedDimensions: ["disclosure", "manner"],
        terminalExperiencePreserved: false,
        acceptedDelay: false,
        acceptedResidualFrustration: 0.22,
        privateBasis: "直接提问仍只是取证，不把一次回答冒充完整判断。",
      },
      automaticCommunicationImpulse: {
        ownerAuthority: "character-agent",
        impulseId: "impulse:v2:test",
        mode: "speech",
        triggerEvidenceIds: [EVIDENCE],
        discourseAnchorIds: [],
        motiveSourceIds: [DESIRE],
        perceivedTurnDemand: "给刚进门的陌生来客一个说明来意的入口",
        feltTendency: "直接问是不是来寻人",
        urgency: 0.46,
        disclosurePressure: 0.42,
        inhibitionPressure: 0.36,
        conflict: { present: true, opposingSourceIds: [VALUE], description: "好奇推动询问，自持又要求少暴露判断。" },
      },
      continuationIntentions: [],
      privateDecisionBasis: "直接问能更快得到反应，但只公开足够形成回答的话头。",
    },
  };
  if (stage === "agent_expression_planning") return {
    expressionPlan: {
        ownerAuthority: "character-agent",
        sourceImpulseId: "impulse:v2:test",
        impulseTransformation: { treatment: "blend", privateBasis: "保留询问冲动，同时压低对佩剑的显露。" },
        mode: "mixed",
        actionIntent: "手边动作只慢一瞬，抬眼给来客一个可以回应的问题",
        publicStance: {
          interactionMove: "ask",
          releasedMeaning: "想知道来客是不是在寻人",
          audienceCharacterIds: [TARGET],
          disclosure: "partial",
          epistemicRelation: "uncertain",
          intendedEffect: "让对方自行说明来意",
          threadDisposition: "open_new",
          sharedContextAnchorIds: [],
          sharedContextTreatment: "not_applicable",
        },
        nonverbalUndertone: "好奇从目光停顿里漏出，但不解释判断",
        privateRemainderPresent: true,
        relationshipStance: "初见来客的平常招呼里保留距离",
        timing: "during_action",
        turnYield: "yield",
      },
  };
  if (stage === "agent_realization") {
    const highLeakageHandling = Object.entries(stageInput.regulationSurface?.channelLeakagePressures || {})
      .filter(([, value]) => Number(value) >= 0.6)
      .map(([channel]) => ({ channel, handling: "masked", basis: "本人选择继续压住这个高残余通道" }));
    return { realization: {
      ownerAuthority: "character-agent",
      agentTurnId: stageInput.agentTurnId,
      emotionHandling: [
        ...highLeakageHandling,
        ...(!highLeakageHandling.some((row) => row.channel === "attentionLock")
          ? [{ channel: "attentionLock", handling: "expressed", basis: "问话前目光在来客佩剑处短暂停留" }]
          : []),
      ],
      realizedSpeechHabitIds: ["generic_evidence_first"],
      surfaceRealization: {
        timing: "during_action",
        affectiveTexture: [{ cue: "voice_hesitant", channel: "voiceOnset", modality: "sound", feature: "短暂停顿后开口" }],
        relationshipRegister: "初见来客的平常招呼",
        appliedVoiceParameters: { directness: 0.62, compression: 0.58, warmth: 0.28, reserve: 0.64, formality: 0.38, emotionalLeakage: 0.4 },
        intentionalDepartureReason: "",
        selfCheck: {
          addsPrivateExplanation: false,
          interchangeableAcrossCharacters: false,
          repeatsVisibleAction: false,
          leavesListenerRoom: true,
          translatesPlanItemByItem: false,
          spellsOutDeferredOrImplied: false,
          extraExplanationHasChosenActionFunction: true,
          reopensSettledContextWithoutChosenPurpose: false,
          soundsLikeFormResponse: false,
          copiesBackendCategoryLanguage: false,
        },
      },
      embodiedIntent: { automaticReaction: "注意力被佩剑吸引", chosenRegulation: "不解释判断", manner: "话音平常，目光略停", posture: "手仍搭在原处", intendedGesture: "手上动作慢了一瞬，抬眼看向来客" },
      utterance: { literalSpeech: "客官，寻人？", vocalMode: "conversational", speechAct: "ask", speechFunctions: ["ask"] },
      actionAttempt: { primitive: "speak", objectId: "", targetCharacterId: TARGET, destinationId: "", affordanceId: "" },
    } };
  }
  throw new Error(`unexpected stage ${stage}`);
}

const acceptedStages = [];
const result = await runTavernCharacterAgentTurnV2(input, {
  runStage: fakeStage,
  async onStageAccepted(stage) {
    acceptedStages.push(stage);
  },
});
assert.equal(result.protocolVersion, TAVERN_CHARACTER_AGENT_V2_VERSION);
assert.equal(calls.length, 5);
assert.deepEqual(calls.map((row) => row.stage), [
  "subjective_appraisal",
  "agent_candidates",
  "agent_choice_and_regulation",
  "agent_expression_planning",
  "agent_realization",
]);
assert.ok(calls.every((row) => row.input.characterId === CHARACTER));
assert.ok(calls.every((row) => row.input.agentTurnId === calls[0].input.agentTurnId));
assert.deepEqual(acceptedStages.map((row) => row.stage), [
  "subjective_appraisal",
  "agent_candidates",
  "agent_choice_and_regulation",
  "agent_expression_planning",
  "agent_realization",
]);
assert.equal(JSON.stringify(calls).includes(LEGACY_CANDIDATE), false, "legacy precomputed candidates must not enter any v2 Agent stage");
assert.equal(JSON.stringify(calls).includes("firm-boundary"), false, "legacy expression modes must not enter any v2 Agent stage");
assert.equal(calls[0].input.psychologySnapshot, undefined, "psychology cannot predate appraisal");
assert.equal(JSON.stringify(calls[0].input.privateContext).includes("世界审计知道，但人物尚未感知的结果"), false, "objective settlement must not leak into subjective psychology before perception");
assert.equal(calls[0].input.worldProjection.recentOwnActions[0].settled, true);
assert.equal(calls[0].input.privateContext.priorActionOutcomeContext.hasPendingAgentAction, false, "a settled own action is continuity context, not a pending Agent outcome");
assert.equal(calls[0].input.privateContext.priorActionOutcomeContext.recentOwnActionsClassification, "settled_continuity_context_only");
assert.deepEqual(calls[0].input.referenceContract.ownedPsychologicalSourceIds, [DESIRE, VALUE]);
assert.equal(
  JSON.stringify(calls[0].input.worldProjection).includes(WORLD_OBLIGATION),
  true,
  "world obligations remain available as objective appraisal material",
);
assert.equal(
  calls[0].input.referenceContract.ownedPsychologicalSourceIds.includes(WORLD_OBLIGATION),
  false,
  "world obligations cannot enter the private psychological source namespace",
);
const appraisalSourceSchema = tavernCharacterAgentV2OutputSchemaForStage(calls[0].input)
  .properties.relevanceLinks.items.properties.sourceId;
const candidateSourceSchema = tavernCharacterAgentV2OutputSchemaForStage(calls[1].input)
  .properties.candidates.items.properties.expectedEffects.items.properties.sourceId;
const choiceSchema = tavernCharacterAgentV2OutputSchemaForStage(calls[2].input);
const expressionSchema = tavernCharacterAgentV2OutputSchemaForStage(calls[3].input);
const realizationSchema = tavernCharacterAgentV2OutputSchemaForStage(calls[4].input);
assert.deepEqual(appraisalSourceSchema.enum, [DESIRE, VALUE]);
assert.deepEqual(candidateSourceSchema.enum, [DESIRE, VALUE]);
assert.deepEqual(tavernCharacterAgentV2OutputSchemaForStage(calls[0].input).properties.desireGroundings.items.properties.desireId.enum, [DESIRE]);
assert.deepEqual(
  tavernCharacterAgentV2OutputSchemaForStage(calls[0].input).properties.desireGroundings.items.properties.activationEvidenceIds.items.enum,
  [EVIDENCE],
);
assert.deepEqual(
  tavernCharacterAgentV2OutputSchemaForStage(calls[0].input).properties.desireGroundings.items.properties.activationPsychologicalSourceIds.items.enum,
  [DESIRE, VALUE],
);
assert.deepEqual(tavernCharacterAgentV2OutputSchemaForStage(calls[1].input).properties.candidates.items.properties.desireRelations.items.properties.desireId.enum, [DESIRE]);
assert.ok(choiceSchema.required.includes("automaticCommunicationImpulse"), "the Character Agent must form its own pre-regulation communication impulse");
assert.equal(choiceSchema.required.includes("preverbalExpressionPlan"), false, "choice must not prewrite a regulated expression plan");
assert.ok(choiceSchema.required.includes("goalPreservation"));
assert.ok(expressionSchema.required.includes("impulseTransformation"), "communication strategy must be chosen after regulation and before literal wording");
assert.ok(realizationSchema.required.includes("surfaceRealization"));
assert.ok(realizationSchema.required.includes("realizedSpeechHabitIds"));
assert.deepEqual(realizationSchema.properties.realizedSpeechHabitIds.items.enum, ["generic_evidence_first"]);
assert.equal(realizationSchema.required.includes("communicationPlan"), false, "final wording must not re-plan its communication strategy");
assert.equal(realizationSchema.required.includes("speechRealizationPlan"), false, "final wording must not echo a private proposition ledger");
assert.equal(calls[1].input.psychologySnapshot.authority, "character-private-psychology-tool");
assert.equal(calls[2].input.candidateEvaluation.selection, null);
assert.equal(calls[4].input.affectiveVoiceTool.authority, "character-private-affective-voice-tool");
assert.equal(calls[3].input.speechHabitTool.authority, "character-private-speech-habit-tool");
assert.ok(calls[3].input.speechHabitTool.factorLedger.generic_evidence_first);
assert.equal(calls[4].input.speechHabitSurface.authority, "character-private-speech-habit-surface");
assert.equal(Object.hasOwn(calls[4].input.speechHabitSurface, "factorLedger"), false);
assert.equal(Object.prototype.hasOwnProperty.call(calls[4].input.affectiveVoiceTool, "expressionStrategy"), false);
assert.equal(Object.prototype.hasOwnProperty.call(calls[4].input.affectiveVoiceTool, "factorLedger"), false, "final wording must receive voice pressure, not the private factor ledger");
assert.equal(calls[4].input.worldProjection, undefined, "final wording must not reopen the complete world projection");
assert.equal(calls[4].input.privateContext, undefined, "final wording must not reopen the complete private character context");
assert.equal(calls[4].input.subjectiveAppraisal, undefined, "final wording must not receive the full private interpretation again");
assert.equal(calls[4].input.psychologySnapshot, undefined, "final wording must not receive the full psychological ledger again");
assert.equal(calls[4].input.agentChoice, undefined, "privateDecisionBasis must not leak into the wording stage through the whole choice object");
assert.equal(calls[4].input.regulatedExpressionPlan.publicStance.releasedMeaning, "想知道来客是不是在寻人");
assert.equal(calls[4].input.regulatedExpressionPlan.privateRemainder.present, true);
assert.equal(calls[4].input.regulatedExpressionPlan.communicationPlan, undefined, "abstract desired-effect prose must stop before literal wording");
assert.equal(calls[4].input.automaticCommunicationImpulse, undefined, "raw pre-regulation impulse must not enter literal wording");
assert.equal(JSON.stringify(calls[4].input).includes("对佩剑和来客目的的完整判断"), false, "deferred private meaning must be redacted before wording");
assert.equal(result.decision.selectedCandidateId, "agent-v2:ask");
assert.equal(result.decision.utterance.literalSpeech, "客官，寻人？");
assert.deepEqual(result.decision.realizedSpeechHabitIds, ["generic_evidence_first"]);
assert.equal(Object.prototype.hasOwnProperty.call(result.decision, "worldOutcome"), false);
assert.equal(result.session.phase, "ready_for_world_resolution");

const bridge = bridgeTavernCharacterAgentV2ResultForWorld(result, input);
assert.equal(bridge.compatibilityCandidates.length, 2);
assert.ok(bridge.compatibilityCandidates.every((row) => row.originAuthority === "character-agent"));
assert.equal(JSON.stringify(bridge).includes(LEGACY_CANDIDATE), false);
assert.equal(JSON.stringify(bridge).includes("expressionStrategy"), false);
assert.equal(bridge.rawDecision.candidateId, "agent-v2:ask");
assert.equal(bridge.rawDecision.speech, "客官，寻人？");
assert.equal(
  bridge.rawDecision.actionAttempt.primitive,
  "speak",
  "the world bridge must preserve the Character Agent's speak primitive instead of disguising it as a generic gesture",
);
assert.deepEqual(
  bridge.rawDecision.observableAffectiveTexture,
  [{ cue: "voice_hesitant", channel: "voiceOnset", modality: "sound", feature: "短暂停顿后开口" }],
  "already-public affective texture must cross the world boundary as observable surface rather than disappear with the private plan",
);
assert.deepEqual(bridge.rawDecision.realizedSpeechHabitIds, ["generic_evidence_first"]);
assert.equal(Object.prototype.hasOwnProperty.call(bridge.rawDecision, "worldOutcome"), false);

const placeListenResult = structuredClone(result);
const placeListenCandidate = {
  ...structuredClone(placeListenResult.session.generatedCandidates[0]),
  candidateId: "agent-v2:listen-at-room",
  attemptPrimitive: "listen",
  targetHandle: "guest_room",
  actionBinding: {
    kind: "place",
    targetCharacterId: "",
    objectId: "",
    destinationId: "guest_room",
    positionId: "",
    affordanceId: "",
  },
};
placeListenResult.session.generatedCandidates = [placeListenCandidate];
placeListenResult.session.agentChoice.selectedCandidateId = placeListenCandidate.candidateId;
placeListenResult.session.finalDecision = {
  ...structuredClone(placeListenResult.session.finalDecision),
  selectedCandidateId: placeListenCandidate.candidateId,
  generatedCandidates: [placeListenCandidate],
  communicationPlan: {
    ...structuredClone(placeListenResult.session.finalDecision.communicationPlan),
    intendedAudienceCharacterIds: [TARGET],
  },
  utterance: {
    ...structuredClone(placeListenResult.session.finalDecision.utterance),
    literalSpeech: "",
    speechAct: "none",
    speechFunctions: ["none"],
  },
  actionAttempt: {
    primitive: "listen",
    objectId: "",
    targetCharacterId: "",
    destinationId: "guest_room",
    affordanceId: "",
  },
};
placeListenResult.decision = structuredClone(placeListenResult.session.finalDecision);
const placeListenBridge = bridgeTavernCharacterAgentV2ResultForWorld(placeListenResult, input);
assert.equal(placeListenBridge.rawDecision.targetCharacterId, "", "a silent place-bound action must not inherit the expression audience as its physical target");
assert.equal(placeListenBridge.rawDecision.speechTargetCharacterId, "");
assert.deepEqual(placeListenBridge.rawDecision.actionAttempt.actionBinding, placeListenCandidate.actionBinding);

const normalized = normalizeTavernCharacterDecision(bridge.rawDecision, bridge.input, {
  characters: [{ id: CHARACTER, name: "测试人物" }, { id: TARGET, name: "来客" }],
  tavernState: { activeVisits: [], objectLedger: { objects: {} } },
}, {
  agents: {
    [CHARACTER]: { characterId: CHARACTER, characterName: "测试人物" },
    [TARGET]: { characterId: TARGET, characterName: "来客", present: true, zoneId: "hall" },
  },
  actions: [],
});
assert.equal(normalized.candidateId, "agent-v2:ask");
assert.equal(normalized.choiceAuthority, "character-agent");
assert.equal(normalized.speech, "客官，寻人？");
assert.equal(normalized.speechAct, "ask");
assert.equal(normalized.actionAttempt.primitive, "speak");
assert.deepEqual(normalized.observableAffectiveTexture, [{ channel: "voiceOnset", modality: "sound", feature: "短暂停顿后开口" }]);
assert.deepEqual(normalized.realizedSpeechHabitIds, ["generic_evidence_first"]);
assert.equal(normalized.embodiedIntent.manner, "话音平常，目光略停");
assert.deepEqual(normalized.speechRealizationPlan.minimumSufficiency, {
  listenerCanRespondAfterMustConvey: false,
  additionalPublicExplanationServesChosenAction: false,
  additionalPublicExplanationPurpose: "",
  explanationsKeptPrivate: [],
});
assert.deepEqual(normalized.speechRealizationPlan.selfCheck, {
  soundsLikePrivateSummary: false,
  interchangeableAcrossCharacters: false,
  repeatsWhatActionAlreadyShows: false,
  containsUnnecessaryExplanatoryTail: false,
}, "the legacy world adapter may expose inert defaults, but no such checklist reaches the Character Agent wording stage");
assert.deepEqual(normalized.speechRealizationPlan.withhold, ["private_remainder_present"]);
assert.equal(normalized.relationshipAppraisalAuthority, "character-agent");
assert.deepEqual(normalized.cognitiveAppraisal.entityModelUpdates, []);
assert.equal(normalized.semanticViolations.length, 0);

console.log(JSON.stringify({
  status: "passed",
  protocolVersion: result.protocolVersion,
  checks: {
    fiveCausalAgentStages: true,
    sameCharacterAndTurn: true,
    appraisalPrecedesPsychology: true,
    legacyCandidatesDoNotLeak: true,
    legacyExpressionModeDoesNotLeak: true,
    characterGeneratesCandidates: true,
    mathematicsDoesNotSelect: true,
    affectiveVoiceUsesRegulationResidue: true,
    conditionalSpeechHabitToolUsesCharacterAuthority: true,
    finalHabitSurfaceRedactsPrivateLedger: true,
    realizedHabitIdsSurviveWorldBridgePrivately: true,
    literalSpeechPreserved: true,
    worldOutcomeNotPrecommitted: true,
    agentCandidatesBridgeToWorldValidator: true,
    bridgeDoesNotRestoreExpressionStrategy: true,
    subjectiveRelationshipAppraisalReachesWorldCommitBoundary: true,
    agentOwnedMinimumSufficiencyPreserved: true,
    privateEntityAndLocationMemoryUpdatesPreserved: true,
    privateSourceIdsBoundInOutputSchema: true,
    worldObligationNamespaceSeparated: true,
    objectiveOutcomeHiddenUntilPerceived: true,
    continuationIntentionsAreAgentOwned: true,
  },
}, null, 2));
