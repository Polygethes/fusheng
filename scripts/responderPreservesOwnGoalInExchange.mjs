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
const ticks = draft.periodSimulation?.ticks || [];
const exchangeTick = ticks.find((tick) => (tick.agentOutputs || []).some((output) => (
  output.interactionRole === "responder"
  && state.characters.find((character) => character.id === output.characterId)?.name === "阎无咎"
)));
const responder = (exchangeTick?.agentOutputs || []).find((output) => (
  output.interactionRole === "responder"
  && state.characters.find((character) => character.id === output.characterId)?.name === "阎无咎"
));

assert.ok(responder, "the day simulation should include Yan Wugui as a responder");

const ownGoal = responder.realtimePublicGoal || responder.privatePublicGoal || "";
assert.match(ownGoal, /魔印/, "fixture should give the responder an independent goal advanced with the magic seal");
assert.match(
  responder.interactionInput?.observedVisibleAction || "",
  /灵契/,
  "fixture should make the responder answer an action centered on the spirit contract",
);
assert.match(
  responder.visibleAction || "",
  /魔印/,
  `the responder should use its own leverage while answering the other agent, got:\n${responder.visibleAction}`,
);
assert.equal(
  responder.interactionInput?.ownPublicGoalBeforeResponse,
  ownGoal,
  "the exchange should preserve the responder's own goal from before it observed the initiator",
);
assert.equal(
  responder.interactionInput?.ownObjectBeforeResponse,
  "魔印",
  "the exchange should preserve the responder's own leverage object",
);

console.log("responderPreservesOwnGoalInExchange:test passed", {
  ownGoal,
  observed: responder.interactionInput.observedVisibleAction,
  response: responder.visibleAction,
});
