import assert from "node:assert/strict";
import { callOpenAIJson } from "../src/server/pipeline/responseClient.mjs";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

process.env.DEEPSEEK_API_KEY = "test-key";
process.env.OPENAI_API_KEY = "";
process.env.OPENAI_BASE_URL = "https://api.deepseek.com";
process.env.CHARACTER_TOWN_MODEL = "deepseek-chat";

globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    id: "ds_json_repair_response",
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: `{"unspoken":"沈珩想：第一行
第二行","ok":true}`,
        },
      },
    ],
    usage: { completion_tokens: 24 },
  }),
});

const result = await callOpenAIJson({
  system: "Return JSON only.",
  user: "Return a payload with an inner newline.",
  schemaName: "json_repair_test",
  schema: {
    type: "object",
    properties: {
      unspoken: { type: "string" },
      ok: { type: "boolean" },
    },
    required: ["unspoken", "ok"],
  },
});

assert.equal(result.parsed.ok, true);
assert.match(result.parsed.unspoken, /沈珩想：第一行/);
assert.match(result.parsed.unspoken, /第二行/);

globalThis.fetch = originalFetch;
process.env = originalEnv;

console.log("deepseekJsonRepair:test passed");
