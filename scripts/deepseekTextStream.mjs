import assert from "node:assert/strict";
import { callOpenAITextStream } from "../src/server/pipeline/responseClient.mjs";

const previous = {
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
  CHARACTER_TOWN_MODEL: process.env.CHARACTER_TOWN_MODEL,
};

process.env.DEEPSEEK_API_KEY = "test-key";
delete process.env.OPENAI_API_KEY;
process.env.DEEPSEEK_BASE_URL = "https://api.deepseek.test";
process.env.CHARACTER_TOWN_MODEL = "deepseek-v4-flash";

const encoder = new TextEncoder();
const chunks = [
  'data: {"choices":[{"delta":{"content":"雨落在"}}]}\n',
  '\ndata: {"choices":[{"delta":{"content":"铜盘上。"},"finish_reason":null}]}\n\n',
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"completion_tokens":8}}\n\ndata: [DONE]\n\n',
];
const raw = chunks.join("");
const splitPoints = [7, 19, 44, 83, 121, raw.length];
let cursor = 0;
let requestBody = null;
const received = [];

globalThis.fetch = async (_url, options) => {
  requestBody = JSON.parse(options.body);
  return new Response(new ReadableStream({
    pull(controller) {
      const end = splitPoints.shift();
      if (end === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(raw.slice(cursor, end)));
      cursor = end;
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
};

try {
  const result = await callOpenAITextStream({
    system: "写小说。",
    user: "继续。",
    onDelta: async (delta) => received.push(delta),
  });
  assert.equal(result.text, "雨落在铜盘上。", "the completed text should equal the streamed deltas");
  assert.deepEqual(received, ["雨落在", "铜盘上。"], "content must reach the caller as model deltas arrive");
  assert.equal(requestBody.stream, true, "DeepSeek chat completions must use native streaming");
  assert.equal(requestBody.stream_options?.include_usage, true, "the final SSE chunk should include usage");
  assert.ok(!("response_format" in requestBody), "novel prose must not be wrapped in JSON mode");
  assert.ok(!("max_tokens" in requestBody), "the user requested no client-side token cap");
} finally {
  globalThis.fetch = undefined;
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log("deepseekTextStream:test passed", { received });
