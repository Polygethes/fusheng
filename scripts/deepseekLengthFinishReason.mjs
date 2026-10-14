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
    id: "ds_truncated_response",
    choices: [
      {
        finish_reason: "length",
        message: {
          content: "{\"surfaceEvent\":\"灵契被扣住\",\"subtextMatrix\":[{\"speaker\":\"阎无咎\"",
        },
      },
    ],
    usage: { completion_tokens: 3400 },
  }),
});

await assert.rejects(
  () => callOpenAIJson({
    system: "Return JSON only.",
    user: "Return a scene interaction.",
    schemaName: "truncation_test",
    schema: {
      type: "object",
      properties: { surfaceEvent: { type: "string" } },
      required: ["surfaceEvent"],
    },
    maxTokens: 3400,
  }),
  /截断|max_tokens|length/i,
  "DeepSeek length finish_reason should produce an actionable truncation error before JSON.parse",
);

globalThis.fetch = originalFetch;
process.env = originalEnv;

console.log("deepseekLengthFinishReason:test passed");
