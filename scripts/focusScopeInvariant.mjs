import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { playNext } from "../src/engine/mockEngine.js";
import { renderApp } from "../src/ui/render.js";

const state = structuredClone(initialState);
state.ui.setupCompleted = true;
state.ui.activeTab = "reality";
state.ui.engineMode = "local";
state.ui.timeGrain = "day";
state.ui.selectedLocationId = state.locations.at(-1).id;
state.ui.focusMode = "ambient";

const ambientHtml = renderApp(state);
assert.match(ambientHtml, /data-scope-summary="ambient"/, "ambient mode should show one noninteractive town-wide scope summary");
assert.doesNotMatch(ambientHtml, /data-key="selectedLocationId"/, "ambient mode must not expose a contradictory location selector");
assert.match(ambientHtml, new RegExp(`${state.town.name}静止在第一秒`), "ambient empty state should name the town, not a stale location");
assert.doesNotMatch(ambientHtml, new RegExp(`${state.locations.at(-1).name}静止在第一秒`));
const ambientDraft = playNext(state);
assert.equal(ambientDraft.periodSimulation.ticks[0].locationId, state.locations[0].id, "ambient scheduling must ignore a stale selected location");

state.ui.focusMode = "location";
const locationHtml = renderApp(state);
assert.match(locationHtml, /data-key="selectedLocationId"/, "location focus should expose the location selector");
assert.doesNotMatch(locationHtml, /data-scope-summary="ambient"/);
const focusedDraft = playNext(state);
assert.equal(focusedDraft.periodSimulation.ticks[0].locationId, state.ui.selectedLocationId, "location focus must start at the selected location");

console.log("focusScopeInvariant:test passed");
