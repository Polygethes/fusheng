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
  setupPeoplePrompt: "城中执法者闻夏和正道执律剑修沈珩在停剑茶楼谈判。",
});

state.characters = state.characters.map(neutralize);
state.characterMemories = [];
state.characterPlans = [];
state.townStateLedger = [];

const actor = state.characters.find((item) => item.name === "闻夏") || state.characters.at(-1);
const target = state.characters.find((item) => item.name === "沈珩") || state.characters[0];
const location = state.locations.find((item) => item.id === "loc_xianxia_teahouse" || item.name === "停剑茶楼");
assert.ok(actor && target && location, "fixture should include 闻夏、沈珩 and 停剑茶楼");

state.relationships = [{
  id: "rel_teahouse_control_no_duplicate_move",
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
    sharedObject: "停剑令",
    locationId: location.id,
    locationName: location.name,
    currentObligation: "停剑令压在茶盏旁，谁先拔剑谁先失去谈判资格。",
    nextActionBias: "争夺命名权、停剑流程或规矩解释。",
    pressure: 76,
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

assert.doesNotMatch(
  output.visibleAction,
  /把(停剑令|妖丹盒|灵契|照骨镜|渡令|庇护牌)推到两人中间。[^。！？]*把\1推到两人中间/u,
  `visible action should not immediately repeat the same prop move, got:\n${output.visibleAction}`,
);

console.log("visibleActionNoImmediateDuplicateMove:test passed", {
  visibleAction: output.visibleAction,
});
