// The browser-side reader for server-sent events splits blocks across chunk
// boundaries and parses each event's JSON.
import assert from "node:assert/strict";
import { readEvents } from "../src/play/sse.js";

const text = 'event: progress\ndata: {"stage":"world"}\n\nevent: progress\ndata: {"stage":"resid';
const rest = 'ents"}\n\nevent: result\ndata: {"ok":true,"requests":8}\n\n';
const encoder = new TextEncoder();
const body = new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(text)); controller.enqueue(encoder.encode(rest)); controller.close(); } });
const seen = [];
for await (const row of readEvents({ body })) seen.push(row);
assert.deepEqual(seen, [
  { event: "progress", data: { stage: "world" } },
  { event: "progress", data: { stage: "residents" } },
  { event: "result", data: { ok: true, requests: 8 } },
]);
console.log("SSE reader passed: events split across chunks are joined and parsed.");
