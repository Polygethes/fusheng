import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

state.ui.timeGrain = "day";
state.ui.focusMode = "ambient";
state.ui.activeTab = "observe";

const draft = playNext(state);
const tick = (draft.periodSimulation?.ticks || []).find((item) => item.locationName === "四方法契门");
const idByName = Object.fromEntries(state.characters.map((character) => [character.name, character.id]));
const shifts = tick?.sceneInteraction?.agentRelationshipShifts || [];
const yanToLu = shifts.find((shift) => (
  shift.fromCharacterId === idByName.阎无咎
  && shift.toCharacterId === idByName.鹿青萝
  && shift.relationshipSource === "agent-third-party-protection"
));
const luToYan = shifts.find((shift) => (
  shift.fromCharacterId === idByName.鹿青萝
  && shift.toCharacterId === idByName.阎无咎
  && shift.relationshipSource === "agent-third-party-protection"
));
const yanToShen = shifts.find((shift) => (
  shift.fromCharacterId === idByName.阎无咎
  && shift.toCharacterId === idByName.沈珩
  && shift.eventOutcome?.includes("护住鹿青萝")
));

assert.ok(yanToLu, "protecting Lu Qingluo should create a Yan Wugui -> Lu Qingluo relationship change");
assert.ok(Number(yanToLu.deltas?.protection || 0) > 0, "Yan Wugui's protection should increase toward Lu Qingluo");
assert.ok(luToYan, "being protected should create a Lu Qingluo -> Yan Wugui relationship change");
assert.ok(
  Number(luToYan.deltas?.dependence || 0) > 0 || Number(luToYan.deltas?.fear || 0) > 0,
  "Lu Qingluo should register the protection as dependence, fear, or both",
);
assert.ok(yanToShen, "the same exchange should still change Yan Wugui's relationship with Shen Heng");
assert.equal(
  Number(yanToShen.deltas?.protection || 0),
  0,
  "protection aimed at Lu Qingluo must not be written onto Yan Wugui's relationship with Shen Heng",
);

console.log("thirdPartyProtectionRoutesRelationshipChange:test passed", {
  yanToLu: yanToLu.deltas,
  luToYan: luToYan.deltas,
  yanToShen: yanToShen.deltas,
});
