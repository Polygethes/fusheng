import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { playNext } from "../src/engine/mockEngine.js";

const state = structuredClone(initialState);
state.ui.engineMode = "mock";
state.ui.timeGrain = "day";
state.ui.activeCharacterIds = ["char_gregor", "char_grete"];
state.ui.selectedLocationId = "loc_hallway";
state.ui.userDirective = "让萨姆沙公寓自己运转一天，不要只写房门里的一场谈话。";
state.ui.injectedEvent = "公司书记员提前来到公寓门口。";
state.ui.eventImpact = 68;

const draft = playNext(state);
const allCharacterIds = new Set(state.characters.map((character) => character.id));
const participantIds = new Set(draft.participantIds || []);
const period = draft.periodSimulation;

assert.equal(draft.timeGrain, "day", "draft should preserve day grain");
assert.ok(period, "day playback should create a periodSimulation object");
assert.equal(period.duration, "day", "periodSimulation should use day duration");
assert.ok(Array.isArray(period.ticks), "periodSimulation should expose ticks");
assert.ok(period.ticks.length >= 4, "day playback should include multiple town ticks");
assert.ok(period.ticks.every((tick) => tick.simulationTick && tick.sceneInteraction), "each town tick should include simulation and interaction");
assert.ok(new Set(period.ticks.map((tick) => tick.locationId)).size >= 2, "day playback should move through multiple locations");
assert.ok([...allCharacterIds].every((id) => participantIds.has(id)), "day playback should include all town characters, not only manually selected characters");
assert.ok(Array.isArray(period.townStateChanges) && period.townStateChanges.length >= 3, "day playback should summarize town-level state changes");
assert.ok(Array.isArray(period.offscreenActions) && period.offscreenActions.length >= 2, "day playback should include offscreen actions");
assert.ok(/上午|中午|下午|傍晚|夜/.test(draft.sceneText), "day scene text should read like a full-day timeline");
assert.ok(draft.irreversibleTraces.length >= period.ticks.length, "period playback should leave traces across the town");
assert.ok(draft.updateBundle.stateChangeReasons.some((item) => item.kind === "period_simulation"), "state reasons should record period simulation");

console.log("townPeriodSimulation:test passed", {
  draftId: draft.id,
  ticks: period.ticks.length,
  locations: new Set(period.ticks.map((tick) => tick.locationId)).size,
  participants: participantIds.size,
});
