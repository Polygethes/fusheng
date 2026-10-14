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
const responder = (tick?.agentOutputs || []).find((output) => (
  output.interactionRole === "responder"
  && state.characters.find((character) => character.id === output.characterId)?.name === "阎无咎"
));
const lu = state.characters.find((character) => character.name === "鹿青萝");
const exchange = (tick?.sceneInteraction?.agentExchanges || []).find((item) => (
  item.responseCharacterId === responder?.characterId || item.targetId === responder?.characterId
));
const outcome = exchange?.eventOutcome || "";

assert.ok(responder, "fixture should include Yan Wugui responding at the contract gate");
assert.ok(lu, "fixture should include Lu Qingluo as Yan Wugui's independent relationship target");
assert.match(
  responder.interactionInput?.ownCandidateBeforeResponse || "",
  /鹿青萝/,
  "fixture should make Yan Wugui intend to protect Lu Qingluo before Shen Heng acts",
);
assert.equal(
  responder.interactionInput?.ownTargetCharacterIdBeforeResponse,
  lu.id,
  "the exchange should retain the responder's original third-party target",
);
assert.equal(
  responder.interactionInput?.ownTargetNameBeforeResponse,
  "鹿青萝",
  "the exchange should retain the original target's stage identity",
);
assert.match(
  responder.visibleAction || "",
  /鹿青萝/,
  `the resolved response should visibly stage who Yan Wugui is protecting, got:\n${responder.visibleAction}`,
);
assert.match(
  outcome,
  /阎无咎.*魔印.*护住鹿青萝/,
  `the event consequence should resolve the actual three-character conflict, got:\n${outcome}`,
);
assert.doesNotMatch(
  outcome,
  /护住被扣押的人/,
  "the consequence should not replace a known character with a generic role",
);

console.log("thirdPartyIntentSurvivesResponse:test passed", {
  candidate: responder.interactionInput.ownCandidateBeforeResponse,
  response: responder.visibleAction,
  outcome,
});
