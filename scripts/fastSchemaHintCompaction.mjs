import assert from "node:assert/strict";
import { callOpenAIJson } from "../src/server/pipeline/responseClient.mjs";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
let body = null;
process.env.DEEPSEEK_API_KEY = "test-key";
process.env.OPENAI_API_KEY = "";
process.env.OPENAI_BASE_URL = "https://api.deepseek.com";

globalThis.fetch = async (_url, options) => {
  body = JSON.parse(options.body);
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: '{"alpha":"a","beta":[]}' } }] }),
  };
};

try {
  await callOpenAIJson({
    system: "Return JSON.",
    user: "Build payload.",
    schemaName: "large_fast_payload",
    schemaHintMode: "compact",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["alpha", "beta"],
      properties: {
        alpha: { type: "string" },
        beta: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["one", "two", "three"],
            properties: { one: { type: "string" }, two: { type: "string" }, three: { type: "string" } },
          },
        },
      },
    },
  });
  const system = body.messages[0].content;
  assert.match(system, /alpha/);
  assert.match(system, /beta/);
  assert.doesNotMatch(system, /additionalProperties/, "fast mode should not send the full recursive JSON schema");
  assert.ok(system.length < 400, `compact schema hint should stay small, got ${system.length}`);
  console.log("fastSchemaHintCompaction:test passed", { length: system.length });
} finally {
  globalThis.fetch = originalFetch;
  process.env = originalEnv;
}
