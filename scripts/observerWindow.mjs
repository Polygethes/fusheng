import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { playNext } from "../src/engine/mockEngine.js";
import { renderApp } from "../src/ui/render.js";

assert.equal(initialState.ui.activeTab, "setup", "the default surface should be the town-building flow before observation");

const state = structuredClone(initialState);
state.ui.timeGrain = "day";
state.ui.focusMode = "location";
state.ui.selectedLocationId = "loc_gregor_room";
state.ui.engineMode = "mock";
state.ui.activeTab = "observe";

const draft = playNext(state);
state.draftScenes = [draft];
state.ui.lastDraftId = draft.id;

const html = renderApp(state);
const proseRows = html.match(/data-observer-prose="true"/g) || [];

assert.ok(html.includes('data-observer-window="true"'), "observe tab should render a dedicated realtime observation window");
assert.ok(html.includes("实时观察窗"), "observe tab should identify the window");
assert.ok(html.includes("开始观察") || html.includes("继续观察"), "observe tab should expose one primary observation action");
assert.ok(proseRows.length >= 5, "latest draft should render as a scrolling prose observation feed");
assert.ok(!html.includes("observer-line-meta"), "observation feed should not expose event metadata chips");
assert.ok(!html.includes('data-observer-beats="true"'), "observation feed should not render beat tables");
assert.ok(!html.includes(">近景<") && !html.includes(">远景<"), "observation feed should not show camera-distance labels");
assert.ok(!html.includes("参与人物"), "observe tab should not show the complex control deck by default");

console.log("observerWindow:test passed", {
  events: proseRows.length,
  draftId: draft.id,
});
