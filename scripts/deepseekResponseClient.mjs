import assert from "node:assert/strict";
import { callOpenAIJson, currentModel, currentProviderConfig, requireCurrentModel } from "../src/server/pipeline/responseClient.mjs";
import { modelStatus } from "../src/server/modelRouter.mjs";


// This project ships no default model. A contract that drives the real-model
// pipeline must name the model it is pretending to call.
process.env.CHARACTER_TOWN_MODEL ||= "contract-test-model";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
let request = null;

process.env.OPENAI_API_KEY = "";
process.env.DEEPSEEK_API_KEY = "test-key";
process.env.OPENAI_BASE_URL = "https://api.deepseek.com";
process.env.CHARACTER_TOWN_MODEL = "";
process.env.OPENAI_MODEL = "";
process.env.DEEPSEEK_MODEL = "";

// The project ships no default model. A key alone must not select one: the old
// behaviour inferred "deepseek-v4-flash" from the base URL, so an operator who
// configured only credentials silently ran, and recorded, a model they never
// named. An unconfigured model now resolves to empty and the run stays off the
// real-model pipeline.
assert.equal(currentModel(), "", "a base URL must never imply a model name");
assert.equal(
  modelStatus().openaiConfigured,
  false,
  "a key without an explicit model must not count as real-model configuration",
);
assert.equal(
  modelStatus().provider,
  "mock",
  "auto mode must fall to the deterministic path when no model was chosen",
);
assert.throws(
  () => requireCurrentModel(),
  (error) => error.code === "CHARACTER_TOWN_MODEL_NOT_CONFIGURED",
  "callers that need a model must fail loudly rather than receive a guess",
);

process.env.CHARACTER_TOWN_MODEL = "deepseek-v4-pro";

globalThis.fetch = async (url, options) => {
  request = { url, options, body: JSON.parse(options.body) };
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: "ds_test_response",
      choices: [{ message: { content: "{\"ok\":true,\"stage\":\"deepseek\"}" } }],
      usage: { total_tokens: 12 },
    }),
  };
};

const config = currentProviderConfig();
assert.equal(config.kind, "chat-completions", "DeepSeek should use OpenAI-compatible chat completions");
assert.equal(config.url, "https://api.deepseek.com/chat/completions");
assert.equal(config.thinkingMode, "disabled", "structured DeepSeek stages should request a final JSON commit directly");
assert.equal(currentModel(), "deepseek-v4-pro");
assert.equal(modelStatus().openaiConfigured, true, "DeepSeek key should satisfy real-model configuration");
assert.equal(modelStatus().provider, "openai-pipeline", "auto mode should resolve to the real model pipeline");

const result = await callOpenAIJson({
  system: "Return json only.",
  user: "Return an ok payload.",
  schemaName: "test_payload",
  schema: {
    type: "object",
    properties: { ok: { type: "boolean" }, stage: { type: "string" } },
    required: ["ok", "stage"],
  },
  maxTokens: 1,
});

assert.deepEqual(result.parsed, { ok: true, stage: "deepseek" });
assert.equal(request.url, "https://api.deepseek.com/chat/completions");
assert.equal(request.body.model, "deepseek-v4-pro");
assert.equal(request.body.response_format.type, "json_object");
assert.deepEqual(request.body.thinking, { type: "disabled" });
assert.equal(request.body.messages[0].role, "system");
assert.match(request.body.messages[0].content, /json/i);
assert.equal("max_tokens" in request.body, false, "chat-completions requests should not impose an output token limit");
assert.equal("max_output_tokens" in request.body, false, "responses requests should not impose an output token limit");

globalThis.fetch = originalFetch;
process.env = originalEnv;

console.log("deepseekResponseClient:test passed", {
  url: request.url,
  model: request.body.model,
});
