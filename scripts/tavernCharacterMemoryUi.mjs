import assert from "node:assert/strict";
import { TAVERN_RECOMMENDATION_REQUEST_FRAME } from "../src/server/ecology/tavernEcologyProfile.mjs";
import { playTavernCausalSceneWithRunners } from "../src/server/pipeline/openaiPipeline.mjs";
import { renderApp } from "../src/ui/render.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";


// This project ships no default model. A contract that drives the real-model
// pipeline must name the model it is pretending to call.
process.env.CHARACTER_TOWN_MODEL ||= "contract-test-model";

const XIE = "char_xyy_xiezenshi";
const ZHOU = "char_xyy_zhoumin";
const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.timeGrain = "scene";
state.ui.engineMode = "openai";
state.ui.activeTab = "reality";
for (const id of [XIE, ZHOU]) {
  const character = state.characters.find((item) => item.id === id);
  character.lifeState.present = true;
  character.currentLocationId = "loc_xyy_tavern";
  character.ecologyState.presence.locationId = "loc_xyy_tavern";
  character.ecologyState.presence.observableAtStage = true;
}

const draft = await playTavernCausalSceneWithRunners(state, {
  characterAgentProtocolVersion: 1,
  allowOrphanVisitors: true,
  characterIds: [XIE, ZHOU],
  positions: { [XIE]: "hall", [ZHOU]: "hall" },
  slotContext: { day: 1, slotId: "dusk", slotLabel: "黄昏" },
  seedImpacts: [{
    id: "impact:ui:recommendation-request",
    objectiveEventId: "action:ui:recommendation-request",
    sourceCharacterId: ZHOU,
    sourceZoneId: "hall",
    type: "speech",
    modality: "sound",
    intensity: 94,
    radius: 1,
    directedTargetId: XIE,
    content: "真石，内门举荐的事，请你亲口给我一个答复。",
    topic: "举荐答复",
    speechAct: "ask",
    commitmentAction: "open",
    semanticFrame: TAVERN_RECOMMENDATION_REQUEST_FRAME,
    provenance: { kind: "firsthand", sourceActionId: "action:ui:recommendation-request", speakerCharacterId: ZHOU },
  }],
  maxSteps: 1,
  minimumActivationScore: 1,
  runners: {
    async runTavernCausalAgent(input) {
      const candidate = input.privateActionCandidates.find((item) => item.actionKind === "respond_to_impact" && item.targetCharacterId === ZHOU);
      return { decision: {
        candidateId: candidate.candidateId,
        actionType: "speak",
        speechAct: "answer",
        targetCharacterId: ZHOU,
        speech: "周珉，内门举荐的事，我答应。",
        visibleAction: "谢真石停下手里的事，正面看向周珉",
        moveToZoneId: "",
        affordanceId: "",
        informationSourceImpactId: "",
        commitmentAction: "fulfill",
        commitmentTopic: "举荐答复",
        decisionValue: "accept",
        semanticFrameId: candidate.semanticFrame.id,
        semanticRoleBindings: candidate.semanticFrame.roles,
        privateReason: "这件事已经拖了太久；周珉的请求此刻就在自己记忆里，而且本人愿意承担举荐。",
      } };
    },
  },
});

assert.ok(draft.observerPsychology[0].memoryBasis?.episodes?.length, "observer psychology must retain only the memory evidence used by this decision");
assert.ok(draft.observerPsychology[0].memoryBasis?.commitments?.length);
assert.ok(draft.observerPsychology[0].memoryBasis?.influence?.total > 0);
assert.ok(draft.observerPsychology[0].memoryBasis?.influence?.scoreDelta > 0);

const renderedState = {
  ...state,
  draftScenes: [draft],
  ui: {
    ...state.ui,
    lastDraftId: draft.id,
    observerPlayback: { draftId: draft.id, visibleCount: 4, totalCount: 4, status: "complete" },
  },
};
const html = renderApp(renderedState);
assert.match(html, /这次实际想起的记忆/);
assert.match(html, /记忆中的未完承诺/);
assert.match(html, /记忆如何影响选择/);
assert.match(html, /内门考核举荐|举荐答复/);
assert.match(html, /此刻可想起/);
assert.match(html, /候选压力 \+/);

console.log("tavernCharacterMemoryUi:test passed", {
  memoryEpisodes: draft.observerPsychology[0].memoryBasis.episodes.length,
  memoryCommitments: draft.observerPsychology[0].memoryBasis.commitments.length,
  influence: draft.observerPsychology[0].memoryBasis.influence.total,
});
