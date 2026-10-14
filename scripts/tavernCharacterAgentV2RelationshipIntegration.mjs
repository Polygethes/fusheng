import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  publicCommittedAction,
  runTavernCausalScene,
} from "../src/server/pipeline/tavernCausalScene.mjs";

const XIE = "char_xyy_xiezenshi";
const ZHOU = "char_xyy_zhoumin";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});

function directedRelationship(snapshot, fromCharacterId, toCharacterId) {
  return snapshot.relationships.find((row) => (
    row.fromCharacterId === fromCharacterId && row.toCharacterId === toCharacterId
  ));
}

const beforeZhouToXie = structuredClone(directedRelationship(state, ZHOU, XIE));
const beforeXieToZhou = structuredClone(directedRelationship(state, XIE, ZHOU));
assert.ok(beforeZhouToXie && beforeXieToZhou);

const firstStageByTurn = new Map();
const calls = [];

function contextFor(stageInput) {
  return firstStageByTurn.get(stageInput.agentTurnId) || stageInput;
}

async function fakeStage(stageInput, { stage }) {
  calls.push({ characterId: stageInput.characterId, stage, input: structuredClone(stageInput) });
  if (stage === "subjective_appraisal") firstStageByTurn.set(stageInput.agentTurnId, structuredClone(stageInput));
  const context = contextFor(stageInput);
  const perceivedImpact = context.worldProjection?.perceivedImpacts?.[0] || {};
  const evidenceId = context.worldProjection?.evidence?.[0]?.evidenceId || perceivedImpact.evidenceId || perceivedImpact.impactId || "";
  const impactId = perceivedImpact.impactId || "";
  const counterpart = context.worldProjection?.perceivedCharacters?.find((row) => row.id !== stageInput.characterId)?.id || "";
  const isXie = stageInput.characterId === XIE;
  const candidateId = `agent-v2:${stageInput.characterId}:${isXie ? "answer" : "acknowledge"}`;

  if (stage === "subjective_appraisal") return {
    appraisal: {
      ownerAuthority: "character-agent",
      appraisalId: `appraisal:${stageInput.agentTurnId}`,
      agentTurnId: stageInput.agentTurnId,
      eventId: impactId || `event:${stageInput.agentTurnId}`,
      noticedEvidenceIds: evidenceId ? [evidenceId] : [],
      interpretations: evidenceId ? [{
        evidenceIds: [evidenceId],
        meaning: isXie ? "周珉在等我本人回应" : "真石确实正面接住了我的话",
        confidence: 0.92,
      }] : [],
      beliefOperations: [],
      epistemicPositions: [],
      relevanceLinks: [],
      desireGroundings: [],
      appraisalAxes: {
        selfRelevance: 0.86,
        goalCongruence: isXie ? 0.18 : 0.66,
        novelty: 0.12,
        expectedness: 0.54,
        opportunityValue: 0.48,
        threat: 0.08,
        controllability: 0.84,
        changeability: 0.72,
        certaintyDelta: isXie ? 0.24 : 0.7,
        normCompatibility: 0.84,
        selfImageCongruence: 0.4,
        publicExposure: 0.32,
        relationshipMeaning: {
          affiliation: 0.72,
          status: 0.08,
          trust: isXie ? 0.42 : 0.68,
          rejection: 0,
          care: 0.34,
          betrayal: 0,
        },
      },
      uncertainty: isXie ? 0.18 : 0.08,
      alternativesConsidered: isXie ? ["现在答", "再想一会"] : ["只是敷衍", "确实接下了"],
      entityModelUpdates: [],
      locationBeliefUpdates: [],
      sourceKnowledgeBeliefUpdates: [],
      threadAppraisals: [],
      relationshipAppraisal: isXie ? {
        phase: "pending_perception_appraisal",
        targetCharacterId: "",
        sourceImpactIds: [],
        changeMode: "none",
        dimensionChanges: [],
        reason: "这次催问没有改变我对周珉的长期看法。",
      } : {
        phase: "pending_perception_appraisal",
        targetCharacterId: counterpart,
        sourceImpactIds: impactId ? [impactId] : [],
        changeMode: "retained",
        dimensionChanges: [{ metric: "dependence", direction: "increase", strengthBand: "low" }],
        reason: "我亲耳听见真石正面接住这件事，因此略微更愿意依赖他的答复。",
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
    stage: { name: `fake-v2-relationship-appraisal:${stageInput.characterId}`, provider: "test", elapsedMs: 0 },
  };

  if (stage === "agent_candidates") return {
    candidates: {
      ownerAuthority: "character-agent",
      agentTurnId: stageInput.agentTurnId,
      candidates: [{
        originAuthority: "character-agent",
        candidateId,
        intention: isXie ? "正面告诉周珉我已经听见" : "不添一句套话，只让动作表明我听见了",
        attemptPrimitive: isXie ? "speak" : "gesture",
        targetHandle: counterpart,
        perceivedPrerequisites: evidenceId ? [evidenceId] : [],
        domains: ["relationship", "social"],
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
          emotionCompatibility: 0.7,
          valueAndSelfImage: 0.66,
          relationshipMeaning: 0.74,
          informationGain: 0.18,
          habitAndIntentionContinuity: 0.72,
          bodyCost: 0.02,
          threatAndNormCost: 0.02,
          exposureAndRelationshipRisk: 0.03,
          opportunityAndSwitchingCost: 0.04,
          uncertaintyCost: 0.04,
        },
        timingIntent: "immediate",
        disclosureNeed: isXie ? "partial" : "none",
        uncertainty: 0.08,
      }],
    },
    stage: { name: `fake-v2-relationship-candidates:${stageInput.characterId}`, provider: "test", elapsedMs: 0 },
  };

  if (stage === "agent_choice_and_regulation") return {
    choice: {
      ownerAuthority: "character-agent",
      agentTurnId: stageInput.agentTurnId,
      selectedCandidateId: candidateId,
      regulationChoice: {
        ownerAuthority: "character-agent",
        regulationChoiceId: `regulation:${stageInput.agentTurnId}`,
        agentTurnId: stageInput.agentTurnId,
        strategies: [],
        intendedPublicEffect: isXie ? "把这件事接住" : "让对方知道我听见了",
        acceptedCosts: [],
      },
      goalPreservation: {
        preservedDesireIds: [],
        transformedDimensions: ["disclosure", "manner"],
        terminalExperiencePreserved: true,
        acceptedDelay: false,
        acceptedResidualFrustration: 0,
        privateBasis: "这次只处理熟人之间的当下回应，没有把私人欲望替换成代理目标。",
      },
      automaticCommunicationImpulse: {
        ownerAuthority: "character-agent",
        impulseId: `impulse:${stageInput.agentTurnId}`,
        mode: isXie ? "speech" : "nonverbal",
        triggerEvidenceIds: evidenceId ? [evidenceId] : [],
        discourseAnchorIds: [],
        motiveSourceIds: [],
        perceivedTurnDemand: isXie ? "周珉在等本人接下答复责任" : "是否还需要口头重复已经听见的回应",
        feltTendency: isXie ? "直接把答复责任接回自己手里" : "不再多说",
        urgency: isXie ? 0.62 : 0.18,
        disclosurePressure: isXie ? 0.56 : 0.06,
        inhibitionPressure: isXie ? 0.24 : 0.72,
        conflict: { present: false, opposingSourceIds: [], description: "" },
      },
      continuationIntentions: [],
      privateDecisionBasis: isXie ? "他在等我的话，我先正面接住。" : "已经得到回应，不必再复述一遍。",
    },
    stage: { name: `fake-v2-relationship-choice:${stageInput.characterId}`, provider: "test", elapsedMs: 0 },
  };

  if (stage === "agent_expression_planning") return {
    expressionPlan: {
        ownerAuthority: "character-agent",
        sourceImpulseId: `impulse:${stageInput.agentTurnId}`,
        impulseTransformation: {
          treatment: isXie ? "express" : "withhold",
          privateBasis: isXie ? "熟人正在等答复，直接接住即可。" : "对方已经把话说清，沉默比套话更贴近此刻。",
        },
        mode: isXie ? "mixed" : "nonverbal",
        actionIntent: isXie ? "停下手里的事，看着周珉把答复责任接过来" : "收回搭在柜台边的手，让放松一点的动作代替回话",
        communicationPlan: {
          goal: isXie ? "inform" : "none",
          tactic: isXie ? "direct" : "silence",
          disclosure: isXie ? "partial" : "withhold",
          epistemicRelation: isXie ? "believes" : "not_applicable",
          intendedAudienceCharacterIds: counterpart ? [counterpart] : [],
          desiredEffect: isXie ? "让周珉知道自己会亲自回应" : "让真石知道自己听见了",
          threadDisposition: isXie ? "settle" : "none",
          epistemicActionCandidateId: "",
          presuppositionStance: "not_applicable",
          epistemicBasisEvidenceIds: [],
          subtext: isXie ? "这件事不用父亲替我说" : "这句话我记住了",
        },
        speechMoment: {
          currentTurnDemand: isXie ? "周珉在等本人接下答复责任" : "是否还需要口头重复已经听见的回应",
          regulatedOpeningMove: isXie ? "直接把答复责任接回自己手里" : "不再多说",
          minimumPublicDelta: isXie ? "举荐答复由本人亲自给" : "",
          listenerCanRespondAfterDelta: isXie,
          expansionFunction: isXie ? "none" : "not_applicable",
          expansionPurpose: "",
          deferredOrImplied: [isXie ? "尚未作出的最终举荐决定" : "听见后的依赖感变化"],
          sharedContext: { anchorIds: [], treatment: "not_applicable", reopeningPurpose: "" },
        },
        nonverbalUndertone: isXie ? "这件事不用父亲替我说" : "这句话已经听进去了",
        privacyBoundary: isXie ? "尚未作出的最终举荐决定仍属私下" : "听见后的依赖感变化仍属私下",
        relationshipStance: "一起长大的熟人，不作公事客套",
        timing: isXie ? "standalone" : "silence",
        turnYield: isXie ? "yield" : "not_applicable",
      },
    stage: { name: `fake-v2-relationship-expression:${stageInput.characterId}`, provider: "test", elapsedMs: 0 },
  };

  if (stage === "agent_realization") {
    const highLeakageHandling = Object.entries(stageInput.regulationSurface?.channelLeakagePressures || {})
      .filter(([, value]) => Number(value) >= 0.6)
      .map(([channel]) => ({ channel, handling: "masked", basis: "本人选择把这个高残余通道留在私下" }));
    return { realization: {
      ownerAuthority: "character-agent",
      agentTurnId: stageInput.agentTurnId,
      emotionHandling: highLeakageHandling,
      realizedSpeechHabitIds: isXie && stageInput.speechHabitSurface?.habitPressures?.xie_familiar_shared_context_ellipsis
        ? ["xie_familiar_shared_context_ellipsis"]
        : [],
      surfaceRealization: {
        timing: isXie ? "standalone" : "silence",
        affectiveTexture: isXie
          ? [{ cue: "gaze_fixed", channel: "attentionLock", modality: "visual", feature: "看着熟人说，不作客套" }]
          : [{ cue: "posture_relaxed", channel: "posture", modality: "visual", feature: "肩背的动作放松一点" }],
        relationshipRegister: "一起长大的熟人",
        appliedVoiceParameters: { directness: 0.68, compression: 0.6, warmth: 0.44, reserve: 0.42, formality: 0.1, emotionalLeakage: 0.36 },
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
        automaticReaction: "注意力落到对方身上",
        chosenRegulation: "不把熟人之间的话说成公事",
        manner: isXie ? "直看着周珉" : "肩膀略松下来",
        posture: "仍站在原处",
        bodyActions: isXie ? [] : [{ kind: "lower_hand", direction: "down", amplitude: "small", speed: "normal" }],
        intendedGesture: isXie ? "谢真石停下手里的事，看向周珉。" : "周珉把搭在柜台边的手收了回来。",
      },
      utterance: {
        literalSpeech: isXie ? "听见了。这事我自己给你回话。" : "",
        vocalMode: "conversational",
        speechAct: isXie ? "answer" : "none",
        speechFunctions: isXie ? ["answer", "inform"] : [],
      },
      actionAttempt: {
        primitive: isXie ? "speak" : "gesture",
        objectId: "",
        targetCharacterId: counterpart,
        destinationId: "",
        affordanceId: "",
      },
    }, stage: { name: `fake-v2-relationship-realization:${stageInput.characterId}`, provider: "test", elapsedMs: 0 } };
  }

  throw new Error(`Unexpected stage ${stage}`);
}

const result = await runTavernCausalScene(state, {
  allowOrphanVisitors: true,
  characterIds: [XIE, ZHOU],
  positions: { [XIE]: "hall", [ZHOU]: "hall" },
  seedImpacts: [{
    id: "impact:v2:zhou-asks-xie",
    sourceCharacterId: ZHOU,
    sourceZoneId: "hall",
    type: "speech",
    modality: "sound",
    intensity: 98,
    radius: 2.5,
    directedTargetId: XIE,
    content: "真石，举荐的事，你听见没有？",
    topic: "举荐答复",
    speechAct: "ask",
  }],
  maxSteps: 2,
  minimumActivationScore: 0,
  characterAgentProtocolVersion: 2,
  runAgentV2Stage: fakeStage,
  async runAgent() {
    throw new Error("legacy Agent must remain inactive in v2 relationship integration");
  },
});

assert.deepEqual(result.actions.map((row) => row.actorId), [XIE, ZHOU]);
assert.equal(result.actions[0].speech, "听见了。这事我自己给你回话。");
assert.equal(result.actions[1].speech, "");
assert.equal(calls.length, 10);
assert.deepEqual(calls.slice(0, 5).map((row) => row.characterId), [XIE, XIE, XIE, XIE, XIE]);
assert.deepEqual(calls.slice(5).map((row) => row.characterId), [ZHOU, ZHOU, ZHOU, ZHOU, ZHOU]);
assert.equal(calls[3].input.speechHabitTool?.authority, "character-private-speech-habit-tool");
assert.ok(calls[3].input.speechHabitTool?.factorLedger?.xie_familiar_shared_context_ellipsis);
assert.equal(calls[4].input.speechHabitSurface?.authority, "character-private-speech-habit-surface");
assert.equal(Object.hasOwn(calls[4].input.speechHabitSurface || {}, "factorLedger"), false);
assert.ok(calls[4].input.speechHabitSurface?.habitPressures?.xie_familiar_shared_context_ellipsis);
const xiePatch = result.characterPatches.find((row) => row.id === XIE);
assert.deepEqual(xiePatch.ecologyState.voiceHabitUsage, [{
  actionId: result.actions[0].id,
  characterId: XIE,
  committed: true,
  turnIndex: 1,
  realizedHabitIds: ["xie_familiar_shared_context_ellipsis"],
}]);
assert.equal(Object.hasOwn(publicCommittedAction(result.actions[0]), "realizedSpeechHabitIds"), false);
assert.deepEqual(publicCommittedAction(result.actions[0]).observableAffectiveTexture, [
  { channel: "attentionLock", modality: "visual", feature: "看着熟人说，不作客套" },
]);
assert.equal(Object.hasOwn(publicCommittedAction(result.actions[0]), "speechRealizationPlan"), false);

const continuedState = structuredClone(state);
for (const patch of result.characterPatches) {
  const character = continuedState.characters.find((row) => row.id === patch.id);
  if (!character) continue;
  character.currentLocationId = patch.currentLocationId;
  character.currentActivity = structuredClone(patch.currentActivity);
  character.lifeState = structuredClone(patch.lifeState);
  character.ecologyState = structuredClone(patch.ecologyState);
  character.agentMemory = structuredClone(patch.agentMemory);
}
firstStageByTurn.clear();
const secondCallOffset = calls.length;
const continued = await runTavernCausalScene(continuedState, {
  allowOrphanVisitors: true,
  characterIds: [XIE, ZHOU],
  positions: { [XIE]: "hall", [ZHOU]: "hall" },
  seedImpacts: [{
    id: "impact:v2:zhou-follows-up-with-xie",
    sourceCharacterId: ZHOU,
    sourceZoneId: "hall",
    type: "speech",
    modality: "sound",
    intensity: 98,
    radius: 2.5,
    directedTargetId: XIE,
    content: "真石，我等你自己回话。",
    topic: "举荐答复",
    speechAct: "inform",
  }],
  maxSteps: 1,
  minimumActivationScore: 0,
  characterAgentProtocolVersion: 2,
  runAgentV2Stage: fakeStage,
  async runAgent() {
    throw new Error("legacy Agent must remain inactive in v2 speech-habit continuation");
  },
});
const secondCalls = calls.slice(secondCallOffset);
assert.equal(secondCalls.length, 5);
const repeatedHabitLedger = secondCalls[3].input.speechHabitTool.factorLedger.xie_familiar_shared_context_ellipsis;
assert.equal(repeatedHabitLedger.repetitionFatigue.committedUseCount, 1);
assert.ok(repeatedHabitLedger.repetitionFatigue.penalty > 0);
const continuedXiePatch = continued.characterPatches.find((row) => row.id === XIE);
assert.equal(continuedXiePatch.ecologyState.voiceHabitUsage.length, 2);
assert.equal(continuedXiePatch.ecologyState.voiceHabitUsage.every((row) => !Object.hasOwn(row, "literalSpeech")), true);

const shift = result.relationshipShifts.find((row) => (
  row.fromCharacterId === ZHOU && row.toCharacterId === XIE
));
assert.ok(shift, "Zhou's own appraisal should create the one directional relationship shift");
assert.equal(shift.generatedFrom, "character-agent-owned-appraisal");
assert.deepEqual(shift.deltas, { dependence: 1 });
assert.ok(!result.relationshipShifts.some((row) => (
  row.fromCharacterId === XIE && row.toCharacterId === ZHOU
)), "Xie's spoken answer must not automatically create the reverse relationship shift");

assert.deepEqual(directedRelationship(state, ZHOU, XIE), beforeZhouToXie, "the caller snapshot remains immutable");
assert.deepEqual(directedRelationship(state, XIE, ZHOU), beforeXieToZhou, "the reverse caller edge remains immutable");

console.log(JSON.stringify({
  status: "passed",
  checks: {
    bothCharactersUseIndependentFiveStageAgents: true,
    listenerAppraisesReceivedActionBeforeRelationshipChange: true,
    directionalRelationshipChangeOnly: true,
    speechDoesNotAutomaticallyChangeRelationship: true,
    silenceCanRemainARealAction: true,
    characterUsesPrivateHabitToolBeforeWording: true,
    finalWordingReceivesRedactedHabitSurface: true,
    onlyCommittedRealizedHabitIdsPersistPrivately: true,
    publicActionDoesNotLeakHabitUse: true,
    nextTurnUsesCommittedHistoryForFatigue: true,
    repetitionMemoryNeverStoresLiteralSpeech: true,
  },
}, null, 2));
