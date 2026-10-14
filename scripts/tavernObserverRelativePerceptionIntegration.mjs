import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { runTavernCausalScene } from "../src/server/pipeline/tavernCausalScene.mjs";

const LUO_ID = "char_xyy_luozhao";
const XIE_ID = "char_xyy_xiezenshi";

function integrationWorld() {
  const state = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  for (const character of state.characters || []) {
    character.lifeState ||= {};
    character.lifeState.present = [LUO_ID, XIE_ID].includes(character.id);
    if (character.lifeState.present) character.currentLocationId = "loc_xyy_tavern";
  }
  return state;
}

const seedImpacts = Array.from({ length: 7 }, (_, index) => ({
  id: `phase74_signal_${index + 1}`,
  sourceCharacterId: `world:phase74-source-${index + 1}`,
  sourceZoneId: "hall",
  type: index % 2 ? "information" : "physical",
  modality: index % 2 ? "sound" : "visual",
  intensity: 100 - index,
  radius: 0,
  directedTargetId: LUO_ID,
  content: `第${index + 1}条可传播但未必被注意的现场信号`,
  topic: `phase74-topic-${index + 1}`,
}));

let capturedInput = null;
const result = await runTavernCausalScene(integrationWorld(), {
  allowOrphanVisitors: true,
  characterIds: [LUO_ID, XIE_ID],
  positions: { [LUO_ID]: "hall", [XIE_ID]: "hall" },
  seedImpacts,
  maxSteps: 1,
  minimumActivationScore: 0,
  async runAgent(input) {
    capturedInput = structuredClone(input);
    const candidate = input.privateActionCandidates.find((row) => row.feasible);
    assert.ok(candidate, "the character must retain at least one feasible action");
    return {
      decision: {
        candidateId: candidate.candidateId,
        actionType: "pass",
        speechAct: "none",
        targetCharacterId: "",
        speech: "",
        visibleAction: "",
        moveToZoneId: "",
        vocalMode: "conversational",
        affordanceId: "",
        informationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: "",
        decisionValue: "none",
        privateReason: "本测试只验证人物相对感知，不预写人物答案。",
      },
    };
  },
});

assert.ok(capturedInput, "the live Character Agent input must be captured");
assert.equal(capturedInput.agent.id, LUO_ID, "the seven directed signals should activate their actual recipient");
assert.ok(capturedInput.agent.perceptionProfile, "the live Agent must receive its compiled private perception profile");
assert.equal(capturedInput.perceptionFrame?.authority, "character-private-perception-tool");
assert.equal(Object.hasOwn(capturedInput.perceptionFrame || {}, "serverAudit"), false, "raw received signals must stay server-only");
assert.ok(capturedInput.perceptionFrame.noticedEvidence.length > 0);
assert.ok(
  capturedInput.perceptionFrame.noticedEvidence.length
    <= capturedInput.perceptionFrame.attentionState.effectiveBudget,
  "noticed evidence must respect the character's finite attention budget",
);
assert.ok(capturedInput.perceivedImpacts.length > 0);
assert.ok(capturedInput.perceivedImpacts.length < seedImpacts.length, "delivery must not automatically become conscious perception");
assert.ok(capturedInput.perceivedImpacts.every((row) => row.evidenceId.startsWith("noticed:")));
assert.ok(capturedInput.perceivedImpacts.every((row) => (
  capturedInput.perceptionFrame.noticedEvidence.some((evidence) => evidence.evidenceId === row.evidenceId)
)));

assert.equal(capturedInput.epistemicBeliefState?.authority, "character-owned-epistemic-state");
assert.equal(capturedInput.epistemicDecisionSupport?.authority, "character-private-epistemic-tool");
assert.equal(capturedInput.epistemicDecisionSupport?.selection?.authority, "character-agent");
assert.equal(capturedInput.epistemicDecisionSupport?.selection?.selectedCandidateId, null);
assert.ok(capturedInput.epistemicDecisionSupport.evaluations.length >= 4);
assert.ok(capturedInput.epistemicDecisionSupport.evaluations.every((row) => !Object.hasOwn(row, "speech")));
assert.ok(capturedInput.privateActionCandidates.some((row) => row.candidateClass === "epistemic"));

const rawForLuo = result.deliveries.filter((delivery) => delivery.recipientId === LUO_ID);
assert.equal(rawForLuo.length, seedImpacts.length, "the server audit must retain every physically delivered signal");
assert.ok(rawForLuo.every((delivery) => delivery.serverAudit?.worldEventId));
const noticedImpactIds = new Set(capturedInput.perceivedImpacts.map((row) => row.impactId));
const storedPerceptions = result.privateSceneRuntime.agents[LUO_ID].perceptionMemory
  .filter((row) => seedImpacts.some((impact) => impact.id === row.impactId));
assert.ok(storedPerceptions.length > 0);
assert.ok(storedPerceptions.length < rawForLuo.length, "unnoticed deliveries must not enter perception memory");
assert.ok(storedPerceptions.every((row) => noticedImpactIds.has(row.impactId)));
const patch = result.characterPatches.find((row) => row.id === LUO_ID);
const encodedSeedImpactIds = new Set((patch?.agentMemory?.episodes || [])
  .map((episode) => episode.sourceImpactId)
  .filter((impactId) => seedImpacts.some((impact) => impact.id === impactId)));
assert.ok([...encodedSeedImpactIds].every((impactId) => noticedImpactIds.has(impactId)));
assert.ok(encodedSeedImpactIds.size < rawForLuo.length, "unnoticed delivery must not be encoded as episodic memory");

console.log("tavernObserverRelativePerceptionIntegration:test passed", {
  delivered: rawForLuo.length,
  noticed: capturedInput.perceptionFrame.noticedEvidence.length,
  remembered: storedPerceptions.length,
  epistemicCandidates: capturedInput.epistemicDecisionSupport.evaluations.length,
});

let cognitiveInput = null;
const cognitiveRun = await runTavernCausalScene(integrationWorld(), {
  allowOrphanVisitors: true,
  characterIds: [LUO_ID, XIE_ID],
  positions: { [LUO_ID]: "hall", [XIE_ID]: "hall" },
  seedImpacts: [{
    id: "phase74_epistemic_claim",
    sourceCharacterId: XIE_ID,
    sourceZoneId: "hall",
    type: "speech",
    modality: "sound",
    intensity: 96,
    radius: 1,
    directedTargetId: LUO_ID,
    content: "谢真石今日也许还在酒馆里。",
    topic: "谢真石是否在酒馆",
  }],
  maxSteps: 1,
  minimumActivationScore: 0,
  async runAgent(input) {
    cognitiveInput = structuredClone(input);
    const candidate = input.privateActionCandidates.find((row) => row.feasible);
    const perceived = input.perceivedCharacters.find((row) => row.identityKnown === false);
    const known = input.agent.psychologyAnchor.epistemics.knownEntities.find((row) => (
      row.knowsName === true && row.recognizesIdentity === false
    ));
    const evidenceId = input.perceivedImpacts[0]?.evidenceId;
    assert.ok(perceived?.id.startsWith("perceived_entity:"));
    assert.ok(known?.entityId.startsWith("known_entity:"));
    assert.ok(evidenceId?.startsWith("noticed:"));
    return { decision: {
      candidateId: candidate.candidateId,
      actionType: "pass",
      speechAct: "none",
      targetCharacterId: "",
      speech: "",
      visibleAction: "",
      moveToZoneId: "",
      vocalMode: "conversational",
      affordanceId: "",
      informationSourceImpactId: "",
      commitmentAction: "none",
      commitmentTopic: "",
      decisionValue: "none",
      privateReason: "只写回本人对匿名者、地点和信息源的暂时认识。",
      cognitiveAppraisal: {
        noticedEvidenceIds: [evidenceId],
        interpretations: [{
          evidenceIds: [evidenceId],
          meaning: "眼前这个人声称谢真石今日可能在酒馆，但其身份与消息可靠性都未确认。",
          confidenceBand: "medium",
        }],
        beliefOperations: [],
        threadAppraisals: [],
        entityModelUpdates: [{
          perceivedEntityHandle: perceived.id,
          noticedEvidenceIds: [evidenceId],
          hypotheses: [{
            hypothesisId: "hypothesis:may-know-local-target",
            proposition: "此人可能知道谢真石的行踪",
            operation: "revise",
            confidenceBand: "low",
            basisEvidenceIds: [evidenceId],
          }],
          identityCandidates: [{
            knownEntityHandle: known.entityId,
            operation: "doubt",
            confidenceBand: "low",
            basisEvidenceIds: [evidenceId],
          }],
          affectiveResponse: { label: "提高查证优先级", valence: 0.1, arousal: 0.35 },
          attentionPriority: 0.66,
        }],
        locationBeliefUpdates: [{
          subjectHandle: known.entityId,
          locationHandle: "location:loc_xyy_tavern",
          operation: "revise",
          assertedLikelihood: 0.62,
          sourceReliability: 0.35,
          confidenceBand: "low",
          basisEvidenceIds: [evidenceId],
          sourceType: "unverified_direct_claim",
        }],
        sourceKnowledgeBeliefUpdates: [{
          sourceHandle: perceived.id,
          subjectHandle: known.entityId,
          operation: "revise",
          assertedLikelihood: 0.7,
          sourceReliability: 0.5,
          confidenceBand: "medium",
          basisEvidenceIds: [evidenceId],
        }],
      },
    } };
  },
});
assert.ok(cognitiveInput);
const cognitiveMemory = cognitiveRun.characterPatches.find((row) => row.id === LUO_ID).agentMemory;
assert.equal(cognitiveMemory.privateEntityModels.length, 1);
assert.equal(cognitiveMemory.locationBeliefs.length, 1);
assert.equal(cognitiveMemory.sourceKnowledgeBeliefs.length, 1);
assert.equal(cognitiveMemory.impressions.length, 0, "an epistemic first impression must not create a relationship");
assert.ok(cognitiveMemory.privateEntityModels[0].perceivedEntityHandle.startsWith("perceived_entity:"));
assert.ok(cognitiveMemory.locationBeliefs[0].subjectHandle.startsWith("known_entity:"));

async function receivedVisualStrength(light) {
  const state = integrationWorld();
  state.tavernState.perceptionEnvironment = {
    schemaVersion: 1,
    authority: "world-state",
    light,
    ambientNoise: 0.18,
    modalityTransmission: { visual: 1, sound: 1 },
  };
  const sample = await runTavernCausalScene(state, {
    allowOrphanVisitors: true,
    characterIds: [LUO_ID, XIE_ID],
    positions: { [LUO_ID]: "hall", [XIE_ID]: "hall" },
    seedImpacts: [{
      id: "phase74_environment_visual",
      sourceCharacterId: XIE_ID,
      sourceZoneId: "hall",
      type: "physical",
      modality: "visual",
      intensity: 88,
      radius: 1,
      directedTargetId: LUO_ID,
      content: "对面的人抬起左手。",
      topic: "现场动作",
    }],
    maxSteps: 1,
    minimumActivationScore: 0,
    async runAgent(input) {
      const candidate = input.privateActionCandidates.find((row) => row.feasible);
      return { decision: {
        candidateId: candidate?.candidateId || "",
        actionType: "pass",
        speechAct: "none",
        targetCharacterId: "",
        speech: "",
        visibleAction: "",
        moveToZoneId: "",
        vocalMode: "conversational",
        affordanceId: "",
        informationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: "",
        decisionValue: "none",
        privateReason: "只采集世界环境对物理信号的影响。",
      } };
    },
  });
  const audit = sample.privateSceneRuntime.perceptionAudits.find((row) => row.characterId === LUO_ID);
  const received = audit?.frame?.serverAudit?.receivedSignals.find((row) => (
    row.signalId === "delivery:delivery:phase74_environment_visual:char_xyy_luozhao"
    || row.featureId.includes("phase74_environment_visual")
  ));
  assert.ok(received, "the server audit must retain the physical reception trace");
  return received.receivedStrength;
}

const brightReceivedStrength = await receivedVisualStrength(1);
const darkReceivedStrength = await receivedVisualStrength(0.04);
assert.ok(
  brightReceivedStrength > darkReceivedStrength * 2,
  "light must come from objective world state rather than a hidden Character-layer tavern constant",
);

const surfaceState = integrationWorld();
const surfaceSubject = surfaceState.characters.find((character) => character.id === XIE_ID);
surfaceSubject.publicSignalFeatures = [{
  featureId: "test-sword-hand-wear",
  modality: "visual",
  physicalFeature: "右手虎口覆着一层旧茧",
  domainTags: ["hand", "weapon", "sword"],
  intensity: 0.9,
  durationSeconds: 1,
}, {
  featureId: "test-worn-sleeve",
  modality: "visual",
  physicalFeature: "窄袖短褐的袖口洗得发白",
  domainTags: ["clothing", "work"],
  intensity: 0.7,
  durationSeconds: 1,
}, {
  featureId: "test-forbidden-conclusion",
  modality: "visual",
  physicalFeature: "视线落在堂前",
  domainTags: ["gaze"],
  intensity: 0.7,
  hiddenIntent: "正在等洛照发问",
}];
const surfaceInputs = [];
const surfaceRun = await runTavernCausalScene(surfaceState, {
  allowOrphanVisitors: true,
  characterIds: [LUO_ID, XIE_ID],
  positions: { [LUO_ID]: "hall", [XIE_ID]: "hall" },
  seedImpacts: [{
    id: "phase74_surface_activation",
    sourceCharacterId: "world:door-frame",
    sourceZoneId: "hall",
    type: "physical",
    modality: "sound",
    intensity: 58,
    radius: 1,
    directedTargetId: LUO_ID,
    content: "门框轻响了一声。",
    topic: "现场声响",
  }],
  maxSteps: 2,
  minimumActivationScore: 0,
  async runAgent(input) {
    surfaceInputs.push(structuredClone(input));
    const candidate = input.privateActionCandidates.find((row) => row.feasible);
    return { decision: {
      candidateId: candidate?.candidateId || "",
      actionType: "pass",
      speechAct: "none",
      targetCharacterId: "",
      speech: "",
      visibleAction: "",
      moveToZoneId: "",
      vocalMode: "conversational",
      affordanceId: "",
      informationSourceImpactId: "",
      commitmentAction: "none",
      commitmentTopic: "",
      decisionValue: "none",
      privateReason: "只验证当前世界表面信号进入人物自己的有限注意力。",
    } };
  },
});
const surfaceInput = surfaceInputs.find((input) => input.agent.id === LUO_ID);
assert.equal(surfaceInput?.agent?.id, LUO_ID);
const surfacePerceivedCharacter = surfaceInput.perceivedCharacters.find((row) => (
  row.noticedFeatures?.some((feature) => feature.feature.includes("右手虎口"))
));
assert.ok(surfacePerceivedCharacter, "an authored physical surface must become observer-owned noticed evidence");
assert.ok(surfacePerceivedCharacter.id.startsWith("perceived_entity:"), "surface evidence must not certify canonical identity");
assert.equal(Object.hasOwn(surfacePerceivedCharacter, "publicSignalFeatures"), false, "unnoticed authored features must not bypass attention");
assert.doesNotMatch(JSON.stringify(surfaceInput.perceivedCharacters), new RegExp(XIE_ID, "u"));
assert.doesNotMatch(JSON.stringify(surfaceInput.perceptionFrame), /正在等洛照发问/u, "hidden intent must not enter a world surface signal");
assert.ok(surfaceRun.privateSceneRuntime.worldSignalValidationIssues.some((issue) => (
  issue.code === "WORLD_SIGNAL_HIDDEN_SEMANTIC_LEAK"
)));
assert.equal(Object.hasOwn(surfaceRun.sceneRuntime, "worldSignalValidationIssues"), false, "raw authoring validation stays server-only");
assert.equal(Object.hasOwn(surfaceRun.sceneRuntime.agents[XIE_ID], "publicSignalFeatures"), false, "raw surface inventory must not enter public scene runtime");

const focusInputs = [];
const focusRun = await runTavernCausalScene(integrationWorld(), {
  allowOrphanVisitors: true,
  characterIds: [LUO_ID, XIE_ID],
  positions: { [LUO_ID]: "hall", [XIE_ID]: "hall" },
  seedImpacts: [{
    id: "phase74_focus_trigger",
    sourceCharacterId: XIE_ID,
    sourceZoneId: "hall",
    type: "physical",
    modality: "visual",
    intensity: 94,
    radius: 1,
    directedTargetId: LUO_ID,
    content: "对面的人抬手扶了一下贴身佩带的剑鞘。",
    topic: "眼前人物的佩剑动作",
  }],
  maxSteps: 3,
  minimumActivationScore: 0,
  async runAgent(input) {
    focusInputs.push(structuredClone(input));
    if (input.agent.id === LUO_ID && focusInputs.filter((row) => row.agent.id === LUO_ID).length === 1) {
      const observe = input.privateActionCandidates.find((row) => (
        row.feasible
        && row.candidateClass === "epistemic"
        && row.realization?.epistemicPrimitive === "observe"
      ));
      assert.ok(observe, "active observation must be offered as a Character-owned epistemic action");
      return { decision: {
        candidateId: observe.candidateId,
        actionType: "act",
        speechAct: "none",
        targetCharacterId: observe.targetCharacterId,
        speech: "",
        visibleAction: "洛照侧过脸，目光沿着对方的步幅和剑鞘扫过。",
        moveToZoneId: "",
        vocalMode: "conversational",
        affordanceId: "",
        informationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: "",
        decisionValue: "none",
        privateReason: "她选择继续取证；测试不规定之后必须询问或接近。",
      } };
    }
    if (input.agent.id === XIE_ID) {
      const candidate = input.privateActionCandidates.find((row) => row.feasible);
      const luo = input.perceivedCharacters[0];
      assert.ok(candidate && luo);
      return { decision: {
        candidateId: candidate.candidateId,
        actionType: "speak",
        speechAct: "ask",
        targetCharacterId: luo.id,
        speech: "有事？",
        visibleAction: "谢真石抬眼看向她。",
        moveToZoneId: "",
        vocalMode: "conversational",
        affordanceId: "",
        informationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: "",
        decisionValue: "none",
        privateReason: "只制造下一轮可感知反馈，不替洛照决定回应。",
      } };
    }
    const candidate = input.privateActionCandidates.find((row) => row.feasible);
    return { decision: {
      candidateId: candidate?.candidateId || "",
      actionType: "pass",
      speechAct: "none",
      targetCharacterId: "",
      speech: "",
      visibleAction: "",
      moveToZoneId: "",
      vocalMode: "conversational",
      affordanceId: "",
      informationSourceImpactId: "",
      commitmentAction: "none",
      commitmentTopic: "",
      decisionValue: "none",
      privateReason: "本轮只检查跨轮注意反馈。",
    } };
  },
});
const luoFocusInputs = focusInputs.filter((input) => input.agent.id === LUO_ID);
assert.ok(
  luoFocusInputs.length >= 2,
  `the observer must receive a later turn rather than completing observation instantly: ${focusInputs.map((row) => row.agent.id).join(" -> ")}`,
);
assert.ok(
  focusInputs.some((input) => input.agent.id === XIE_ID),
  `the observed person must retain their own turn and response authority: ${focusInputs.map((row) => row.agent.id).join(" -> ")}`,
);
assert.ok(focusRun.actions[0].endedAtSeconds > focusRun.actions[0].startedAtSeconds, "active observation must consume micro-clock time");
assert.equal(
  focusRun.privateSceneRuntime.agents[LUO_ID].attentionFocus?.authority,
  "character-agent-attention-choice",
  "the focus must come from the chosen Character action",
);
assert.equal(
  Object.hasOwn(focusRun.sceneRuntime.agents[LUO_ID], "attentionFocus"),
  false,
  "the private focus must not become another character's world fact or persist forever across macro scenes",
);
assert.ok(
  luoFocusInputs[1].perceptionFrame.noticedEvidence.some((evidence) => (
    evidence.attentionReasonTags.includes("goal:attention-target")
  )),
  "the next private perception pass must receive the bounded focus bias",
);
assert.equal(
  Object.hasOwn(luoFocusInputs[1].perceptionFrame, "serverAudit"),
  false,
  "cross-round observation must still hide raw reception from the Agent",
);
