import assert from "node:assert/strict";
import { characterAgent } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

function neutralize(character) {
  return {
    ...character,
    currentState: {
      ...(character.currentState || {}),
      desire: 35,
      shame: 30,
      rage: 20,
      selfDeception: 35,
      revengeImpulse: 5,
      protectionImpulse: 20,
      love: 15,
    },
  };
}

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});

state.characters = state.characters.map(neutralize);
state.characterMemories = [];
state.characterPlans = [];
state.townStateLedger = [];

const actor = state.characters.find((item) => item.id === "char_xianxia_shenheng") || state.characters[0];
const target = state.characters.find((item) => item.id === "char_xianxia_yanwujie") || state.characters[1];
const location = state.locations.find((item) => item.id === "loc_xianxia_contract_gate") || state.locations[0];

state.relationships = [{
  id: "rel_arc_visible_action",
  projectId: state.project.id,
  fromCharacterId: actor.id,
  toCharacterId: target.id,
  love: 0,
  attraction: 0,
  resentment: 0,
  fear: 0,
  dependence: 0,
  power: 0,
  shame: 0,
  jealousy: 0,
  protection: 0,
  revenge: 0,
  deception: 0,
  wantsToBeSeen: 0,
  wantsToEscape: 0,
  misreading: "",
  unspoken: "",
  relationshipArc: {
    kind: "control",
    label: "解释权被扣在见证处",
    sharedObject: "灵契",
    locationId: location.id,
    locationName: location.name,
    currentObligation: "灵契不能离开铜盘，除非阎无咎交代证据来源。",
    nextActionBias: "争夺命名权、盖印流程或规矩解释。",
    pressure: 72,
    historyCount: 3,
  },
}];
state.ui.activeCharacterIds = [actor.id, target.id];
state.ui.selectedLocationId = location.id;

const output = characterAgent({
  state,
  character: actor,
  activeCharacters: [actor, target],
  location,
});

assert.equal(output.tone, "惩罚", `control relationshipArc should override a neutral default tone, got:\n${JSON.stringify(output, null, 2)}`);
assert.match(output.visibleAction, /灵契|铜盘|见证|解释权|证据/, `relationshipArc object/obligation should shape visible action, got:\n${output.visibleAction}`);
assert.match(
  `${output.relationshipArcSummary} ${output.desireReason}`,
  /解释权被扣在见证处|灵契不能离开铜盘|证据来源/,
  "relationshipArc should still be exposed as the reason behind the action",
);

console.log("relationshipArcConstrainsVisibleAction:test passed", {
  tone: output.tone,
  visibleAction: output.visibleAction,
  arc: output.relationshipArcSummary,
});
