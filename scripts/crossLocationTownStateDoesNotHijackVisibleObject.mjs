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

const actor = state.characters.find((item) => item.name === "闻夏") || state.characters.at(-1);
const target = state.characters.find((item) => item.name === "沈珩") || state.characters[0];
const market = state.locations.find((item) => item.id === "loc_xianxia_market" || item.name === "无咎市");
const teahouse = state.locations.find((item) => item.id === "loc_xianxia_teahouse" || item.name === "停剑茶楼");
assert.ok(actor && target && market && teahouse, "fixture should include 闻夏、沈珩、无咎市 and 停剑茶楼");

state.relationships = [{
  id: "rel_arc_market_carried_to_teahouse",
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
    locationId: market.id,
    locationName: market.name,
    currentObligation: "妖丹盒留在案台，摊主照完名字再动。",
    nextActionBias: "争夺命名权、盖印流程或规矩解释。",
    pressure: 78,
    historyCount: 4,
  },
}];

state.townStateLedger = [{
  id: "ledger_market_object_should_not_be_visible_in_teahouse",
  projectId: state.project.id,
  branchId: "branch_main",
  sourceDraftId: "draft_market_previous_scene",
  fromCharacterId: actor.id,
  fromCharacterName: actor.name,
  toCharacterId: target.id,
  toCharacterName: target.name,
  locationId: market.id,
  locationName: market.name,
  object: "妖丹盒",
  kind: "control",
  consequence: "妖丹盒留在无咎市案台，沈珩要改口必须回到摊主见证处。",
  createdAt: new Date().toISOString(),
}];

state.ui.activeCharacterIds = [actor.id, target.id];
state.ui.selectedLocationId = teahouse.id;

const output = characterAgent({
  state,
  character: actor,
  activeCharacters: [actor, target],
  location: teahouse,
});

assert.match(
  output.visibleAction,
  /停剑令|茶盏/,
  `teahouse scene should visibly use teahouse objects, got:\n${output.visibleAction}`,
);
assert.doesNotMatch(
  output.visibleAction,
  /妖丹盒|案台|摊主|无咎市/,
  `offsite market state may inform hidden memory, but must not appear as a visible teahouse object/action, got:\n${output.visibleAction}`,
);
assert.match(
  `${output.relationshipArcSummary} ${output.desireReason}`,
  /妖丹盒|无咎市/,
  "the old market relationship should still be remembered outside visible action",
);

console.log("crossLocationTownStateDoesNotHijackVisibleObject:test passed", {
  visibleAction: output.visibleAction,
  relationshipArcSummary: output.relationshipArcSummary,
  townStatePressureSummary: output.townStatePressureSummary,
});
