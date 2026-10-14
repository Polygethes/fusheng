import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { playNext } from "../src/engine/playService.js";

const originalFetch = globalThis.fetch;
const state = structuredClone(initialState);
state.ui.engineMode = "openai";
const finalDraft = {
  id: "draft_streamed",
  provider: "openai-realtime-simulation",
  sceneText: "沈珩把契牌留在铜盘上。阎无咎没有收回魔印。",
};
const lines = [
  { type: "run_started", runId: "run_1", locationName: "四方法契门" },
  { type: "agent_thinking", characterId: "char_shen", characterName: "沈珩" },
  { type: "dialogue", speakerId: "char_shen", speakerName: "沈珩", targetName: "阎无咎", line: "名字写明白再说。" },
  { type: "complete", runId: "run_1", draft: finalDraft },
].map((event) => `${JSON.stringify(event)}\n`).join("");
const chunks = [lines.slice(0, 37), lines.slice(37, 91), lines.slice(91)];
let requestUrl = "";
let requestBody = null;

globalThis.fetch = async (url, options) => {
  requestUrl = url;
  requestBody = JSON.parse(options.body);
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      setTimeout(() => controller.error(new TypeError("socket closed after complete")), 0);
    },
  }), {
    status: 200,
    headers: { "content-type": "application/x-ndjson; charset=utf-8" },
  });
};

try {
  const received = [];
  const draft = await playNext(state, {
    onEvent: async (event) => { received.push(event); },
  });

  assert.equal(requestUrl, "/api/engine/play/stream");
  assert.equal(requestBody.allowFallback, false);
  assert.deepEqual(received.map((event) => event.type), ["run_started", "agent_thinking", "dialogue", "complete"]);
  assert.equal(draft.id, finalDraft.id);
  assert.equal(draft.sceneText, finalDraft.sceneText);
  console.log("livePlayStream:test passed", { events: received.length, draftId: draft.id });
} finally {
  globalThis.fetch = originalFetch;
}
