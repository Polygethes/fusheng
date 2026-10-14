import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { playNext } from "../src/engine/mockEngine.js";
import { buildObservationEvents, renderApp } from "../src/ui/render.js";

const state = structuredClone(initialState);
state.ui.engineMode = "mock";
state.ui.timeGrain = "day";
state.ui.focusMode = "location";
state.ui.selectedLocationId = "loc_lodgers_table";
state.ui.activeTab = "observe";

const draft = playNext(state);
const events = buildObservationEvents(draft, state);
state.draftScenes = [draft];
state.ui.lastDraftId = draft.id;
state.ui.observerPlayback = {
  draftId: draft.id,
  visibleCount: 2,
  totalCount: events.length,
  status: "playing",
};

const html = renderApp(state);
const proseRows = html.match(/data-observer-prose="true"/g) || [];
const hiddenEventText = events[2]?.text || "";

assert.equal(proseRows.length, 2, "observer playback should reveal only the current visible prose event count");
assert.ok(html.includes(`正在观察 2/${events.length}`), "observer header should show live playback progress");
assert.ok(html.includes("观察中"), "primary play action should switch to an in-progress state");
assert.ok(html.includes("写入正史") && html.includes("disabled"), "canon write should stay disabled while playback is still unfolding");
assert.ok(!html.includes(hiddenEventText), "future events should not appear before their turn");

state.ui.observerPlayback = {
  draftId: draft.id,
  visibleCount: events.length,
  totalCount: events.length,
  status: "complete",
};

const completeHtml = renderApp(state);
const completeRows = completeHtml.match(/data-observer-prose="true"/g) || [];
assert.equal(completeRows.length, events.length, "complete playback should reveal the full prose event feed");
assert.ok(completeHtml.includes(`已观察 ${events.length}/${events.length}`), "completed playback should report final progress");
assert.ok(!completeHtml.includes("观察中"), "completed playback should restore the play action");

console.log("observerPlaybackWindow:test passed", {
  revealed: proseRows.length,
  total: events.length,
});
