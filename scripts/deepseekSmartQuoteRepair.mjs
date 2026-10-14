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
    id: "ds_smart_quote_response",
    choices: [{
      finish_reason: "stop",
      message: {
        content: `{"falseBeliefs":["只要提高声音就能迫使哥哥回应”
        ],"ok":true}`,
      },
    }],
  }),
});

const result = await callOpenAIJson({
  system: "Return JSON only.",
  user: "Return a payload.",
  schemaName: "smart_quote_repair_test",
  schema: {
    type: "object",
    properties: {
      falseBeliefs: { type: "array", items: { type: "string" } },
      ok: { type: "boolean" },
    },
    required: ["falseBeliefs", "ok"],
  },
});

assert.equal(result.parsed.ok, true);
assert.deepEqual(result.parsed.falseBeliefs, ["只要提高声音就能迫使哥哥回应"]);

globalThis.fetch = originalFetch;
process.env = originalEnv;

console.log("deepseekSmartQuoteRepair:test passed");
