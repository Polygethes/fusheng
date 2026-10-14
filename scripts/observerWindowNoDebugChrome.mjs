import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { playNext } from "../src/engine/mockEngine.js";
import { renderApp } from "../src/ui/render.js";

const state = structuredClone(initialState);
state.ui.activeTab = "observe";
state.ui.timeGrain = "day";
state.ui.focusMode = "ambient";
state.ui.engineMode = "local";
state.ui.showObserverStage = false;

const draft = playNext(state);
state.draftScenes = [draft];
state.ui.lastDraftId = draft.id;
state.ui.observerPlayback = {
  draftId: draft.id,
  visibleCount: 2,
  totalCount: 5,
  status: "playing",
};

const html = renderApp(state);

assert.ok(html.includes('data-observer-window="true"'), "observe tab should render the realtime observation window");
assert.ok(html.includes('data-observer-prose="true"'), "observe tab should render novel-like prose events");
for (const forbidden of [
  'data-observer-stage="true"',
  'data-stage-process="true"',
  'data-stage-beat=',
  "事件舞台",
  "当前一拍",
  "stage-beat",
]) {
  assert.ok(!html.includes(forbidden), `default observe tab should not expose stage/debug chrome: ${forbidden}`);
}

const debugState = structuredClone(state);
debugState.ui.showObserverStage = true;
const debugHtml = renderApp(debugState);
assert.ok(debugHtml.includes('data-observer-stage="true"'), "stage map should remain available when explicitly enabled");
assert.ok(debugHtml.includes('data-stage-process="true"'), "stage process should remain available when explicitly enabled");

console.log("observerWindowNoDebugChrome:test passed");
