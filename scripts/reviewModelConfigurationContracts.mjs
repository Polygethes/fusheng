import assert from "node:assert/strict";
import { resolveV27CharacterModelProviderConfig } from "../src/server/v27CharacterModelProvider.mjs";
import { currentProviderConfig, callOpenAIJson } from "../src/server/pipeline/responseClient.mjs";

for (const key of ["OPENAI_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_BASE_URL", "DEEPSEEK_BASE_URL", "GTOWN_V27_MODEL_TRANSPORT", "GTOWN_MODEL_TRANSPORT"]) delete process.env[key];
Object.assign(process.env, {
  GTOWN_AGENT_SHELL: "none", CHARACTER_TOWN_API_KEY: "synthetic-key",
  CHARACTER_TOWN_BASE_URL: "https://configured.invalid/v1", CHARACTER_TOWN_MODEL: "synthetic-model",
});
assert.equal(resolveV27CharacterModelProviderConfig(process.env).transport, "model-api");
assert.equal(currentProviderConfig().apiKey, "synthetic-key");
assert.equal(currentProviderConfig().baseUrl, "https://configured.invalid/v1");
process.env.OPENAI_API_KEY = "old-key";
process.env.OPENAI_BASE_URL = "https://old.invalid/v1";
assert.equal(currentProviderConfig().apiKey, "synthetic-key", "new configuration must win consistently");
assert.equal(currentProviderConfig().baseUrl, "https://configured.invalid/v1");
let calls = 0;
globalThis.fetch = async (url, options) => {
  calls += 1;
  assert.equal(url, "https://configured.invalid/v1/responses");
  assert.equal(options.headers.authorization, "Bearer synthetic-key");
  return { ok: true, json: async () => ({ id: "synthetic-response", output_text: '{"ok":true}' }) };
};
const result = await callOpenAIJson({ system: "test", user: "test", schema: { type: "object" } });
assert.equal(result.parsed.ok, true);
assert.equal(calls, 1);
console.log("review model configuration contracts passed");
