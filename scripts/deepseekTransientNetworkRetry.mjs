import assert from "node:assert/strict";
import { callOpenAIJson } from "../src/server/pipeline/responseClient.mjs";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

process.env.DEEPSEEK_API_KEY = "test-key";
process.env.OPENAI_API_KEY = "";
process.env.OPENAI_BASE_URL = "https://api.deepseek.com";
process.env.CHARACTER_TOWN_MODEL = "deepseek-v4-flash";

let transientCalls = 0;
globalThis.fetch = async () => {
  transientCalls += 1;
  if (transientCalls <= 2) {
    const error = new TypeError("fetch failed");
    error.cause = { code: "ECONNRESET" };
    throw error;
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: "ds_after_network_retry",
      choices: [{ finish_reason: "stop", message: { content: `{"ok":true}` } }],
    }),
  };
};

const recovered = await callOpenAIJson({
  system: "Return JSON only.",
  user: "Return ok.",
  schemaName: "network_retry_test",
  schema: {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
  },
});

assert.equal(recovered.parsed.ok, true);
assert.equal(transientCalls, 3, "two consecutive transient failures should retry only the current stage and recover on the third attempt");
assert.equal(recovered.meta.networkRetryCount, 2);

let authCalls = 0;
globalThis.fetch = async () => {
  authCalls += 1;
  return {
    ok: false,
    status: 401,
    json: async () => ({ error: { message: "invalid key" } }),
  };
};

await assert.rejects(
  () => callOpenAIJson({ system: "Return JSON only.", user: "Return ok." }),
  /invalid key/,
);
assert.equal(authCalls, 1, "deterministic authentication errors must not consume a retry");

globalThis.fetch = originalFetch;
process.env = originalEnv;

console.log("deepseekTransientNetworkRetry:test passed", { transientCalls, authCalls });
