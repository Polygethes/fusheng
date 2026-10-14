import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { playNext } from "../src/engine/mockEngine.js";
import { renderApp } from "../src/ui/render.js";

const state = structuredClone(initialState);
state.ui.engineMode = "mock";
state.ui.timeGrain = "day";
state.ui.focusMode = "location";
state.ui.selectedLocationId = "loc_lodgers_table";
state.ui.activeCharacterIds = ["char_gregor"];

const draft = playNext(state);
const firstTick = draft.periodSimulation.ticks[0];

assert.equal(draft.periodSimulation.focus.locationId, "loc_lodgers_table", "period playback should focus the selected location");
assert.equal(draft.participantIds.length, state.characters.length, "period playback should include the whole town as participants");
assert.ok(firstTick.participantIds.includes("char_lodger"), "location-driven period tick should include the local pressure role");
assert.ok(!firstTick.participantIds.includes("char_gregor"), "manual scene cast should not bias period ticks away from the location cast");

state.ui.activeTab = "control";
const controlHtml = renderApp(state);
assert.ok(!controlHtml.includes("参与人物"), "control surface should not frame town playback around manual participants");
assert.ok(controlHtml.includes("焦点人物"), "manual character selection should be reframed as scene focus only");

console.log("periodIgnoresManualCast:test passed", {
  focus: firstTick.locationName,
  tickParticipants: firstTick.participantIds,
  townParticipants: draft.participantIds.length,
});
