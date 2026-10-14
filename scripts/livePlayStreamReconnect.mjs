import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { playNext } from "../src/engine/playService.js";

const originalFetch = globalThis.fetch;
const state = structuredClone(initialState);
state.ui.engineMode = "openai";
const requestBodies = [];
const finalDraft = {
  id: "draft_resumed",
  provider: "openai-realtime-simulation",
  sceneText: "契牌仍在铜盘上。",
  novelText: "雨落在铜盘上。契牌仍在原处。",
};

function streamResponse(events, { failAfterChunk = false } = {}) {
  const encoder = new TextEncoder();
  const payload = events.map((event) => `${JSON.stringify(event)}\n`).join("");
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      if (failAfterChunk) setTimeout(() => controller.error(new TypeError("fetch failed")), 0);
      else controller.close();
    },
  }), {
    status: 200,
    headers: { "content-type": "application/x-ndjson; charset=utf-8" },
  });
}

globalThis.fetch = async (_url, options) => {
  const body = JSON.parse(options.body);
  requestBodies.push(body);
  if (requestBodies.length === 1) {
    return streamResponse([
      { seq: 1, type: "run_started", runId: body.runId, locationName: "四方法契门" },
      { seq: 2, type: "novel_delta", runId: body.runId, text: "雨落在铜盘上。" },
    ], { failAfterChunk: true });
  }
  return streamResponse([
    { seq: 3, type: "novel_delta", runId: body.runId, text: "契牌仍在原处。" },
    { seq: 4, type: "complete", runId: body.runId, draft: finalDraft },
  ]);
};

try {
  const received = [];
  const draft = await playNext(state, {
    onEvent: async (event) => { received.push(event); },
  });

  assert.equal(requestBodies.length, 2, "one broken browser stream should reconnect once");
  assert.ok(requestBodies[0].runId, "the browser should assign a stable run id before the first request");
  assert.equal(requestBodies[1].runId, requestBodies[0].runId, "reconnect must reuse the paid run instead of starting another one");
  assert.equal(requestBodies[0].afterSeq, 0);
  assert.equal(requestBodies[1].afterSeq, 2, "reconnect should request only events after the last received sequence");
  assert.deepEqual(
    received.map((event) => event.type),
    ["run_started", "novel_delta", "connection_retrying", "novel_delta", "complete"],
  );
  assert.equal(received.filter((event) => event.text === "雨落在铜盘上。").length, 1, "replayed events must not duplicate manuscript deltas");
  assert.equal(received.filter((event) => event.type === "novel_delta").map((event) => event.text).join(""), finalDraft.novelText);
  assert.equal(draft.id, finalDraft.id);
  console.log("livePlayStreamReconnect:test passed", { requests: requestBodies.length, events: received.length });
} finally {
  globalThis.fetch = originalFetch;
}
