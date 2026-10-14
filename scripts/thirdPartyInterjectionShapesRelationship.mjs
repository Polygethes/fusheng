import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

const lu = state.characters.find((character) => character.name === "鹿青萝");
lu.currentState = { ...lu.currentState, protectionImpulse: 95, revengeImpulse: 0, rage: 10 };
lu.defenseLanguage = ["庇护牌先护住人，后问案。"];
lu.agentProfile = { ...lu.agentProfile, dialogueMoves: ["庇护牌先护住人，后问案。"] };
lu.actionLines = { ...lu.actionLines, defense: "庇护牌先护住人，后问案。" };

state.ui.timeGrain = "day";
state.ui.focusMode = "ambient";
state.ui.activeTab = "observe";

const draft = playNext(state);
const tick = (draft.periodSimulation?.ticks || []).find((item) => item.locationName === "四方法契门");
const idByName = Object.fromEntries(state.characters.map((character) => [character.name, character.id]));
const exchange = (tick?.sceneInteraction?.agentExchanges || []).find((item) => (
  item.thirdPartyCharacterId === idByName.鹿青萝 && item.eventOutcome?.includes("护住鹿青萝")
));
const interjection = (exchange?.dialogueTurns || []).find((turn) => turn.turnRole === "third_party_interjection");
const luToYan = (exchange?.relationshipDeltas || []).find((shift) => (
  shift.fromCharacterId === idByName.鹿青萝
  && shift.toCharacterId === idByName.阎无咎
  && shift.relationshipSource === "agent-third-party-protection"
));

assert.ok(exchange && interjection && luToYan, "fixture should include Lu Qingluo's interjection and routed relationship shift");
assert.equal(
  exchange.dialogueDecision?.thirdPartyResponseMove,
  "protect",
  `Lu Qingluo's own line should be classified as protecting the person under the token, got:\n${interjection.line}`,
);
assert.ok(
  Number(luToYan.deltas?.protection || 0) > 0,
  `accepting and extending the protection should increase Lu Qingluo's protection toward Yan Wugui, got:\n${JSON.stringify(luToYan.deltas)}`,
);
assert.equal(luToYan.finalTurn, interjection.line, "the relationship memory should end on the third party's actual line");

console.log("thirdPartyInterjectionShapesRelationship:test passed", {
  line: interjection.line,
  move: exchange.dialogueDecision.thirdPartyResponseMove,
  deltas: luToYan.deltas,
});
