import assert from "node:assert/strict";
import { callOpenAIJson } from "../src/server/pipeline/responseClient.mjs";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
let requestCount = 0;

process.env.DEEPSEEK_API_KEY = "test-key";
process.env.OPENAI_API_KEY = "";
process.env.OPENAI_BASE_URL = "https://api.deepseek.com";
process.env.CHARACTER_TOWN_MODEL = "deepseek-chat";

globalThis.fetch = async () => {
  requestCount += 1;
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: `ds_retry_${requestCount}`,
      choices: [{
        finish_reason: "stop",
        message: { content: requestCount === 1 ? `{"ok":true` : `{"ok":true}` },
      }],
    }),
  };
};

const result = await callOpenAIJson({
  system: "Return JSON only.",
  user: "Return an ok payload.",
  schemaName: "invalid_json_retry_test",
  schema: {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
  },
});

assert.equal(result.parsed.ok, true);
assert.equal(requestCount, 2, "malformed non-truncated JSON should trigger exactly one retry");
assert.equal(result.meta.retryCount, 1);

globalThis.fetch = originalFetch;
process.env = originalEnv;

console.log("deepseekInvalidJsonRetry:test passed", { requestCount });
