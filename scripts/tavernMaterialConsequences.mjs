import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.timeGrain = "week";
const draft = playNext(state);
const events = draft.periodSimulation.ticks.flatMap((tick) => tick.lifeEvents || []);
const cooked = events.filter((event) => Number(event.resourceDelta?.meals || 0) > 0);
const deliveries = events.filter((event) => Number(event.resourceDelta?.grain || 0) > 0);

assert.ok(cooked.length, "prepared meals must be produced by a visible duty");
assert.ok(cooked.every((event) => Number(event.resourceDelta.grain) < 0 && Number(event.resourceDelta.firewood) < 0 && Number(event.resourceDelta.water) < 0), "cooking cannot create meals from nothing");
assert.ok(deliveries.every((event) => Number(event.resourceDelta.cashBox) < 0), "incoming grain must cost the tavern cash");
assert.ok(Object.values(draft.updateBundle.tavernState.stock).every((value) => Number(value) >= 0), "stock cannot become negative");

console.log("tavernMaterialConsequences:test passed", { stock: draft.updateBundle.tavernState.stock });
