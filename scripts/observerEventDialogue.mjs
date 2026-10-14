import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildObservationEvents } from "../src/ui/render.js";
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
const firstTick = ticks[0];
const exchange = firstTick?.sceneInteraction?.agentExchanges?.[0];

assert.ok(exchange, "first tick should have a concrete agent exchange");
assert.ok(Array.isArray(exchange.dialogueTurns) && exchange.dialogueTurns.length >= 2, "agent exchange should include at least two dialogue turns");
assert.ok(exchange.dialogueTurns.some((turn) => turn.speakerId === exchange.sourceCharacterId), "dialogue should include the initiating agent");
assert.ok(exchange.dialogueTurns.some((turn) => turn.speakerId === exchange.responseCharacterId), "dialogue should include the responding agent");
assert.ok(exchange.eventOutcome, "agent exchange should produce a changed event outcome");

const events = buildObservationEvents(draft, state);
const actionEvents = events.filter((event) => event.movementSource === "period-tick");
const firstText = actionEvents[0]?.text || "";
const allActionText = actionEvents.map((event) => event.text).join("\n");

assert.ok(/“[^”]+”[^“]+“[^”]+”/.test(firstText), "first action paragraph should show a dialogue exchange, not just action");
assert.match(firstText, /暂扣|盖印|锁住|截住|封上|压回|扣到|留在|失效|合上/, "first action paragraph should include an event outcome");
assert.ok(actionEvents.filter((event) => /“[^”]+”/.test(event.text)).length >= 4, "most period events should include dialogue");
assert.ok(!/没有立刻回答|旁边的人先听见椅脚|私人模拟|后台运行|低精度|行动候选/.test(allActionText), "dialogue and outcome should not use generic filler or engine language");

console.log("observerEventDialogue:test passed", {
  dialogue: exchange.dialogueTurns,
  outcome: exchange.eventOutcome,
  sample: firstText,
});
