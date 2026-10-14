import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.timeGrain = "week";

const draft = playNext(state);
const ticks = draft.periodSimulation?.ticks || [];
assert.equal(ticks.length, 35, "a week must contain seven lived days, not one renamed day");
assert.equal(new Set(ticks.map((tick) => tick.day)).size, 7);
assert.equal(draft.updateBundle.tavernState.day, 7);
assert.equal(draft.updateBundle.tavernState.tick, 35);
assert.ok(ticks.every((tick) => tick.locationId === "loc_xyy_tavern"));
assert.ok(ticks.every((tick) => tick.lifeEvents?.length));

console.log("tavernSevenDayWeek:test passed", { days: [...new Set(ticks.map((tick) => tick.day))], ticks: ticks.length });
