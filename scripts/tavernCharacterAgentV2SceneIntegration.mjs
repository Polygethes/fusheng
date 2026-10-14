import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { runTavernCausalScene } from "../src/server/pipeline/tavernCausalScene.mjs";
import { playTavernCausalSceneWithRunners } from "../src/server/pipeline/openaiPipeline.mjs";


// This project ships no default model. A contract that drives the real-model
// pipeline must name the model it is pretending to call.
process.env.CHARACTER_TOWN_MODEL ||= "contract-test-model";

const MOTHER = "char_xyy_xiemu";
const FATHER = "char_xyy_xieheng";
const CANDIDATE = "agent-v2:answer-heard";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});

const stageCalls = [];
const firstStageByTurn = new Map();
let legacyAgentCalls = 0;

async function fakeV2Stage(stageInput, { stage }) {
  stageCalls.push({ stage, input: structuredClone(stageInput) });
  if (stage === "subjective_appraisal") firstStageByTurn.set(stageInput.agentTurnId, structuredClone(stageInput));
  const turnContext = firstStageByTurn.get(stageInput.agentTurnId) || stageInput;
  const target = turnContext.worldProjection?.perceivedCharacters?.find((row) => row.id !== stageInput.characterId)?.id
    || FATHER;
  const evidence = turnContext.worldProjection?.evidence?.[0]?.evidenceId || "";

  if (stage === "subjective_appraisal") return {
    appraisal: {
      ownerAuthority: "character-agent",
      appraisalId: "appraisal:v2:scene:mother",
      agentTurnId: stageInput.agentTurnId,
      eventId: "event:v2:scene:father-question",
      noticedEvidenceIds: evidence ? [evidence] : [],
      interpretations: evidence ? [{ evidenceIds: [evidence], meaning: "当家的在问我账目的进度", confidence: 0.94 }] : [],
      beliefOperations: [],
      epistemicPositions: [],
      relevanceLinks: [],
      desireGroundings: [],
      appraisalAxes: {
        selfRelevance: 0.84,
        goalCongruence: 0.42,
        novelty: -0.3,
        expectedness: 0.62,
        opportunityValue: 0.24,
        threat: 0.08,
        controllability: 0.9,
        changeability: 0.72,
        certaintyDelta: 0.46,
        normCompatibility: 0.88,
        selfImageCongruence: 0.64,
        publicExposure: 0.22,
        relationshipMeaning: { affiliation: 0.58, status: 0, trust: 0.42, rejection: 0, care: 0.18, betrayal: 0 },
      },
      uncertainty: 0.06,
      alternativesConsidered: ["是在催我", "只是顺口确认"],
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
    stage: { name: "fake-v2-appraisal", provider: "test", elapsedMs: 0 },
  };

  if (stage === "agent_candidates") return {
    candidates: {
      ownerAuthority: "character-agent",
      agentTurnId: stageInput.agentTurnId,
      candidates: [{
        originAuthority: "character-agent",
        candidateId: CANDIDATE,
        intention: "把账目进度直接告诉当家的",
        attemptPrimitive: "speak",
        targetHandle: target,
        perceivedPrerequisites: evidence ? [evidence] : [],
        domains: ["duty", "relationship"],
        expectedEffects: [],
        desireRelations: [],
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
          emotionCompatibility: 0.78,
          valueAndSelfImage: 0.72,
          relationshipMeaning: 0.68,
          informationGain: 0.2,
          habitAndIntentionContinuity: 0.82,
          bodyCost: 0.02,
          threatAndNormCost: 0.02,
          exposureAndRelationshipRisk: 0.02,
          opportunityAndSwitchingCost: 0.04,
          uncertaintyCost: 0.04,
        },
        timingIntent: "immediate",
        disclosureNeed: "full",
        uncertainty: 0.04,
      }],
    },
    stage: { name: "fake-v2-candidates", provider: "test", elapsedMs: 0 },
  };

  if (stage === "agent_choice_and_regulation") return {
    choice: {
      ownerAuthority: "character-agent",
      agentTurnId: stageInput.agentTurnId,
      selectedCandidateId: CANDIDATE,
      regulationChoice: {
        ownerAuthority: "character-agent",
        regulationChoiceId: "regulation:v2:scene:mother",
        agentTurnId: stageInput.agentTurnId,
        strategies: [{ strategy: "express", targetEmotionIds: ["trust"], effort: 0.08, contextFit: 0.9 }],
        intendedPublicEffect: "平常地把眼前事实说清",
        acceptedCosts: [],
      },
      goalPreservation: {
        preservedDesireIds: [],
        transformedDimensions: ["manner", "disclosure"],
        terminalExperiencePreserved: true,
        acceptedDelay: false,
        acceptedResidualFrustration: 0,
        privateBasis: "这次只是回应眼前事实，没有把一个私人欲望换成代理目标。",
      },
      automaticCommunicationImpulse: {
        ownerAuthority: "character-agent",
        impulseId: `impulse:v2:scene:${stageInput.agentTurnId}`,
        mode: "speech",
        triggerEvidenceIds: evidence ? [evidence] : [],
        discourseAnchorIds: [],
        motiveSourceIds: [],
        perceivedTurnDemand: "当家的只需要知道账是否已经核清",
        feltTendency: "顺口给出结果，不再解释过程",
        urgency: 0.34,
        disclosurePressure: 0.58,
        inhibitionPressure: 0.12,
        conflict: { present: false, opposingSourceIds: [], description: "" },
      },
      continuationIntentions: [],
      privateDecisionBasis: "这件事没有必要绕开，直接回一句就能让他继续手上的事。",
    },
    stage: { name: "fake-v2-choice", provider: "test", elapsedMs: 0 },
  };

  if (stage === "agent_expression_planning") return {
    expressionPlan: {
        ownerAuthority: "character-agent",
        sourceImpulseId: `impulse:v2:scene:${stageInput.agentTurnId}`,
        impulseTransformation: { treatment: "express", privateBasis: "轻微的被催感不必进入答话，事实本身直接说清。" },
        mode: "mixed",
        actionIntent: "不特意停下手里的账，只顺势抬眼答一句",
        communicationPlan: {
          goal: "inform",
          tactic: "direct",
          disclosure: "full",
          epistemicRelation: "believes",
          intendedAudienceCharacterIds: [target],
          desiredEffect: "让当家的知道账已经核清",
          threadDisposition: "settle",
          epistemicActionCandidateId: "",
          presuppositionStance: "not_applicable",
          epistemicBasisEvidenceIds: evidence ? [evidence] : [],
          subtext: "这点家常事不用反复确认",
        },
        speechMoment: {
          currentTurnDemand: "当家的只需要知道账是否已经核清",
          regulatedOpeningMove: "顺口给出结果，不再解释过程",
          minimumPublicDelta: "账已经对完",
          listenerCanRespondAfterDelta: true,
          expansionFunction: "none",
          expansionPurpose: "",
          deferredOrImplied: ["这件事不用再催", "轻微的被催感"],
          sharedContext: { anchorIds: [], treatment: "not_applicable", reopeningPurpose: "" },
        },
        nonverbalUndertone: "夫妻间省略共享前情",
        privacyBoundary: "轻微的被催感仍属私下",
        relationshipStance: "夫妻间省略共享前情",
        timing: "during_action",
        turnYield: "yield",
      },
    stage: { name: "fake-v2-expression", provider: "test", elapsedMs: 0 },
  };

  if (stage === "agent_realization") {
    const highLeakageHandling = Object.entries(stageInput.regulationSurface?.channelLeakagePressures || {})
      .filter(([, value]) => Number(value) >= 0.6)
      .map(([channel]) => ({ channel, handling: "masked", basis: "本人选择不让这个高残余通道打断眼下答话" }));
    return { realization: {
      ownerAuthority: "character-agent",
      agentTurnId: stageInput.agentTurnId,
      emotionHandling: [
        ...highLeakageHandling,
        ...(!highLeakageHandling.some((row) => row.channel === "voice")
          ? [{ channel: "voice", handling: "expressed", basis: "熟悉的人之间不必另作解释" }]
          : []),
      ],
      surfaceRealization: {
        timing: "during_action",
        affectiveTexture: [{ cue: "voice_soft", channel: "volume", modality: "sound", feature: "语气自然，没有特意停下手里的活" }],
        relationshipRegister: "夫妻间省略共享前情",
        appliedVoiceParameters: { directness: 0.66, compression: 0.62, warmth: 0.52, reserve: 0.34, formality: 0.12, emotionalLeakage: 0.3 },
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
      embodiedIntent: {
        automaticReaction: "听见熟悉的声音便抬了下眼",
        chosenRegulation: "不把轻微的被催感放进话里",
        manner: "顺着手上的动作答话",
        posture: "仍站在柜台里侧",
        intendedGesture: "谢母把最后一页账纸压平，抬眼看向谢恒。",
      },
      utterance: {
        literalSpeech: "对完了。你忙你的。",
        vocalMode: "conversational",
        speechAct: "answer",
        speechFunctions: ["answer", "inform"],
      },
      actionAttempt: {
        primitive: "speak",
        objectId: "",
        targetCharacterId: target,
        destinationId: "",
        affordanceId: "",
      },
    }, stage: { name: "fake-v2-realization", provider: "test", elapsedMs: 0 } };
  }

  throw new Error(`Unexpected v2 stage: ${stage}`);
}

const result = await runTavernCausalScene(state, {
  allowOrphanVisitors: true,
  characterIds: [MOTHER, FATHER],
  positions: { [MOTHER]: "hall", [FATHER]: "hall" },
  seedImpacts: [{
    id: "impact:v2:scene:father-question",
    sourceCharacterId: FATHER,
    sourceZoneId: "hall",
    type: "speech",
    modality: "sound",
    intensity: 98,
    radius: 2.5,
    directedTargetId: MOTHER,
    content: "他娘，账对完没有？",
    topic: "核对账目",
    speechAct: "ask",
  }],
  maxSteps: 1,
  minimumActivationScore: 0,
  characterAgentProtocolVersion: 2,
  runAgentV2Stage: fakeV2Stage,
  async runAgent() {
    legacyAgentCalls += 1;
    throw new Error("legacy Character Agent must not run in a v2 activation");
  },
});

assert.equal(legacyAgentCalls, 0);
assert.deepEqual(stageCalls.map((row) => row.stage), [
  "subjective_appraisal",
  "agent_candidates",
  "agent_choice_and_regulation",
  "agent_expression_planning",
  "agent_realization",
]);
assert.ok(stageCalls.every((row) => row.input.characterId === MOTHER));
assert.ok(stageCalls.every((row) => row.input.agentTurnId === stageCalls[0].input.agentTurnId));
assert.equal(JSON.stringify(stageCalls).includes("privateActionCandidates"), false);
assert.equal(JSON.stringify(stageCalls).includes("expressionStrategy"), false);
assert.equal(stageCalls[2].input.candidateEvaluation.selection, null);

assert.equal(result.actions.length, 1);
const action = result.actions[0];
assert.equal(action.actorId, MOTHER);
assert.equal(action.targetCharacterId, FATHER);
assert.equal(action.candidateId, CANDIDATE);
assert.equal(action.speech, "对完了。你忙你的。");
assert.equal(action.speechAct, "answer");
assert.equal(action.embodiedIntent.manner, "顺着手上的动作答话");
assert.equal(action.actionAttempt.primitive, "speak");
assert.deepEqual(action.observableAffectiveTexture, [{ channel: "volume", modality: "sound", feature: "语气自然，没有特意停下手里的活" }]);
assert.deepEqual(action.worldResolution.observableAffectiveTexture, [{ channel: "volume", modality: "sound", feature: "语气自然，没有特意停下手里的活" }]);
assert.ok(
  action.impactFactors.some((impact) => impact.observableAffectiveTexture?.some((row) => row.feature === "语气自然，没有特意停下手里的活")),
  "the committed public affective surface must travel with the resulting impact instead of remaining in the Agent's private decision",
);
assert.ok(
  action.deliveries.some((delivery) => delivery.observableAffectiveTexture?.some((row) => row.modality === "sound" && row.feature === "语气自然，没有特意停下手里的活")),
  "the listener-facing delivery must retain only the typed public surface that travelled through its sound channel",
);
assert.equal(action.worldResolution.status, "success");
assert.equal(action.worldResolution.authority, "world-kernel");

assert.equal(result.decisions.length, 1);
const trace = result.decisions[0];
assert.equal(trace.characterAgentProtocolVersion, 2);
assert.equal(trace.choiceAuthority, "character-agent");
assert.equal(trace.privatePsychology.candidateEvaluation.selection, null);
assert.equal(trace.privatePsychology.agentChoice.selectedCandidateId, CANDIDATE);
assert.equal(trace.characterAgentV2WorldOutcome.authority, "world-resolution");
assert.equal(trace.characterAgentV2WorldOutcome.status, "success");
assert.equal(trace.characterPsychologyV2Carryover.pendingObjectiveOutcome.requiresCharacterAppraisal, true);
assert.equal(trace.characterPsychologyV2Carryover.pendingObjectiveOutcome.inferredSatisfaction, null);
const motherPatch = result.characterPatches.find((row) => row.id === MOTHER);
assert.equal(motherPatch.ecologyState.characterPsychologyV2State.lastAgentTurnId, trace.characterAgentTurnId);
assert.equal(motherPatch.ecologyState.characterPsychologyV2State.pendingObjectiveOutcome.status, "success");

const pipelineStageOffset = stageCalls.length;
let pipelineLegacyAgentCalls = 0;
const draft = await playTavernCausalSceneWithRunners(state, {
  allowOrphanVisitors: true,
  characterIds: [MOTHER, FATHER],
  positions: { [MOTHER]: "hall", [FATHER]: "hall" },
  seedImpacts: [{
    id: "impact:v2:scene:father-question",
    sourceCharacterId: FATHER,
    sourceZoneId: "hall",
    type: "speech",
    modality: "sound",
    intensity: 98,
    radius: 2.5,
    directedTargetId: MOTHER,
    content: "他娘，账对完没有？",
    topic: "核对账目",
    speechAct: "ask",
  }],
  maxSteps: 1,
  minimumActivationScore: 0,
  runners: {
    runTavernCharacterAgentV2Stage: fakeV2Stage,
    async runTavernCausalAgent() {
      pipelineLegacyAgentCalls += 1;
      throw new Error("formal pipeline default must not call the legacy Character Agent");
    },
  },
});
assert.equal(pipelineLegacyAgentCalls, 0);
assert.deepEqual(stageCalls.slice(pipelineStageOffset).map((row) => row.stage), [
  "subjective_appraisal",
  "agent_candidates",
  "agent_choice_and_regulation",
  "agent_expression_planning",
  "agent_realization",
]);
assert.equal(draft.causalScene.actions.length, 1);
assert.equal(draft.causalScene.actions[0].candidateId, CANDIDATE);
assert.equal(draft.causalScene.actions[0].speech, "对完了。你忙你的。");
assert.equal(draft.pipelineMeta.stages.filter((row) => String(row.name || "").startsWith("fake-v2-")).length, 5);

console.log(JSON.stringify({
  status: "passed",
  checks: {
    formalSceneUsesFiveStageV2Agent: true,
    legacyAgentNotCalled: true,
    legacyCandidatesAndExpressionStrategyDoNotLeak: true,
    mathematicsDoesNotSelect: true,
    agentLiteralSpeechAndEmbodimentPreserved: true,
    publicAffectiveTexturePropagatesByModality: true,
    worldAloneSettlesOutcome: true,
    worldOutcomeReturnsToSameTurnTrace: true,
    regulationCostPersistsWithoutAutomaticSatisfaction: true,
    formalPipelineDefaultsToV2: true,
  },
}, null, 2));
