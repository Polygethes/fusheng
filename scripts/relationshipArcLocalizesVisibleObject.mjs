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
  setupPeoplePrompt: "正道执律剑修、邪派使者、妖医、镜灵、龙裔、鬼修、城中执法者闻夏都被中立城规矩暂时压住。",
});

state.characters = state.characters.map(neutralize);
state.characterMemories = [];
state.characterPlans = [];
state.townStateLedger = [];

const actor = state.characters.find((item) => item.name === "闻夏") || state.characters.at(-1);
const target = state.characters.find((item) => item.name === "沈珩") || state.characters[0];
const location = state.locations.find((item) => item.id === "loc_xianxia_market" || item.name === "无咎市") || state.locations[1];
assert.ok(actor && target && location, "fixture should include 闻夏、沈珩 and 无咎市");

state.relationships = [{
  id: "rel_arc_market_object",
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
    sharedObject: "妖丹盒",
    locationId: location.id,
    locationName: location.name,
    currentObligation: "妖丹盒留在案台，摊主照完名字再动。",
    nextActionBias: "争夺命名权、盖印流程或规矩解释。",
    pressure: 74,
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

assert.match(output.visibleAction, /妖丹盒/, `visible action should keep the relationshipArc object, got:\n${output.visibleAction}`);
assert.doesNotMatch(
  output.visibleAction,
  /停剑令|茶盏|桌面令牌/,
  `market relationshipArc should not be hijacked by Wenxia's default teahouse object, got:\n${output.visibleAction}`,
);

console.log("relationshipArcLocalizesVisibleObject:test passed", {
  visibleAction: output.visibleAction,
  arc: output.relationshipArcSummary,
});
