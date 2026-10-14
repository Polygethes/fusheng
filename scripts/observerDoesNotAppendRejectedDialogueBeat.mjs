import assert from "node:assert/strict";
import { renderApp } from "../src/ui/render.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});
const gate = state.locations.find((location) => location.id === "loc_xianxia_contract_gate");
const source = state.characters.find((character) => character.id === "char_xianxia_shenheng") || state.characters[0];
const responder = state.characters.find((character) => character.id === "char_xianxia_yanwujie") || state.characters[1];
const draft = {
  id: "draft_rejected_dialogue_beat",
  locationId: gate.id,
  participantIds: [source.id, responder.id],
  periodSimulation: {
    ticks: [{
      id: "tick_rejected_dialogue_beat",
      label: "上午",
      locationId: gate.id,
      locationName: gate.name,
      resolution: "focused_scene",
      participantIds: [source.id, responder.id],
      surfaceEvent: "灵契留在铜盘",
      agentOutputs: [{
        outputId: "output_source",
        characterId: source.id,
        targetCharacterId: responder.id,
        interactionRole: "initiator",
        visibleAction: `${source.name}扣住灵契，按到界石前。${source.name}说：“旧档案里的原话。”`,
      }, {
        outputId: "output_responder",
        characterId: responder.id,
        targetCharacterId: source.id,
        interactionRole: "responder",
        interactionInput: {
          sourceOutputId: "output_source",
          sourceCharacterId: source.id,
          sharedObject: "灵契",
        },
        visibleAction: `${responder.name}把魔印压到铜盘边。${responder.name}说：“人物卡上的旧口号。”`,
      }],
      sceneInteraction: {
        agentExchanges: [{
          sourceOutputId: "output_source",
          responseOutputId: "output_responder",
          dialogueTurns: [{
            speakerId: source.id,
            speakerName: source.name,
            targetId: responder.id,
            targetName: responder.name,
            line: "灵契压进铜盘，碰过它的人站到界石前。",
            turnRole: "claim",
          }, {
            speakerId: responder.id,
            speakerName: responder.name,
            targetId: source.id,
            targetName: source.name,
            line: "魔印先别入账，证人的名字还没写下。",
            turnRole: "response",
          }],
          eventOutcome: "灵契和魔印都留在铜盘边。",
        }],
      },
    }],
  },
};

state.draftScenes = [draft];
state.ui = {
  ...state.ui,
  activeTab: "observe",
  focusMode: "location",
  selectedLocationId: gate.id,
  lastDraftId: draft.id,
  observerPlayback: {
    draftId: draft.id,
    visibleCount: 1,
    totalCount: 1,
    status: "complete",
  },
};

const html = renderApp(state);

assert.match(html, /灵契压进铜盘，碰过它的人站到界石前/, "observer should keep the resolved exchange dialogue");
assert.match(html, /魔印先别入账，证人的名字还没写下/, "observer should keep the responder's resolved line");
assert.doesNotMatch(html, /旧档案里的原话|人物卡上的旧口号/, "observer must not append rejected candidate dialogue after the resolved exchange");

console.log("observerDoesNotAppendRejectedDialogueBeat:test passed");
