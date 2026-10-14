import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { playNext } from "../src/engine/playService.js";
import { createLivePerformance, reduceLivePerformanceEvent } from "../src/ui/livePerformance.js";
import { renderApp } from "../src/ui/render.js";

const originalFetch = globalThis.fetch;
const state = structuredClone(initialState);
state.ui.setupCompleted = true;
state.ui.activeTab = "reality";
state.ui.engineMode = "openai";
const encoder = new TextEncoder();

globalThis.fetch = async () => new Response(new ReadableStream({
  start(controller) {
    controller.enqueue(encoder.encode(`${JSON.stringify({
      seq: 1,
      type: "error",
      kind: "model_stage",
      stage: "repair_pass",
      error: "fetch failed",
    })}\n`));
    controller.close();
  },
}), { status: 200, headers: { "content-type": "application/x-ndjson" } });

try {
  let thrown = null;
  try {
    await playNext(state);
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown?.kind, "model_stage", "server model failures must not be classified as browser connection failures");
  assert.equal(thrown?.stage, "repair_pass");

  let live = createLivePerformance({ locationName: "四方法契门" });
  live = reduceLivePerformanceEvent(live, {
    type: "error",
    kind: thrown.kind,
    stage: thrown.stage,
    error: thrown.message,
  });
  state.ui.livePerformance = live;
  state.ui.lastPlayError = thrown.message;
  const html = renderApp(state);
  assert.match(html, /DeepSeek 修复阶段失败/, "the UI should name the failed model stage");
  assert.doesNotMatch(html, /<strong>连接中断<\/strong>/, "a model-stage failure must not masquerade as a local connection failure");

  console.log("modelStageErrorClassification:test passed", { kind: thrown.kind, stage: thrown.stage });
} finally {
  globalThis.fetch = originalFetch;
}
