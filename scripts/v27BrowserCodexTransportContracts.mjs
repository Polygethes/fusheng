import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";


// This project ships no default model. A contract that drives the real-model
// pipeline must name the model it is pretending to call.
process.env.CHARACTER_TOWN_MODEL ||= "contract-test-model";

let transportModule = null;
try {
  transportModule = await import("../src/server/v27CharacterModelProvider.mjs");
} catch (error) {
  assert.fail(`missing browser-selectable CharacterModel provider transport (${error?.code || error})`);
}

const {
  resolveV27CharacterModelProviderConfig,
} = transportModule;

assert.equal(typeof resolveV27CharacterModelProviderConfig, "function");

// The API transport is selected by operator-supplied credentials, not by the
// caller happening to know a model name. An empty environment configures
// nothing, so it must resolve to no model rather than quietly using one.
const unconfigured = resolveV27CharacterModelProviderConfig({ GTOWN_AGENT_SHELL: "none" }, {
  apiModel: "deepseek-v4-flash",
});
assert.equal(unconfigured.transport, "none", "an unconfigured environment must select no model");
assert.equal(unconfigured.model, "", "an unconfigured environment must not name a model");

const apiConfig = resolveV27CharacterModelProviderConfig({
  GTOWN_AGENT_SHELL: "none",
  DEEPSEEK_API_KEY: "operator-supplied",
  CHARACTER_TOWN_MODEL: "deepseek-v4-flash",
}, {
  apiModel: "deepseek-v4-flash",
});
assert.equal(apiConfig.transport, "model-api");
assert.equal(apiConfig.model, "deepseek-v4-flash");
assert.equal(apiConfig.usesApiKey, true);
assert.equal(
  apiConfig.concurrency.isolation,
  "per-character-stateless-request",
  "the API transport isolates characters as independent concurrent requests",
);

const codexConfig = resolveV27CharacterModelProviderConfig({
  GTOWN_V27_MODEL_TRANSPORT: "codex-cli",
  GTOWN_V27_CODEX_MODEL: "gpt-5.6-sol",
  GTOWN_V27_CODEX_REASONING_EFFORT: "medium",
  OPENAI_API_KEY: "must-not-select-api-transport",
  DEEPSEEK_API_KEY: "must-not-select-api-transport",
  CHARACTER_TOWN_MODEL: "must-not-select-api-transport",
}, {
  apiModel: "deepseek-v4-flash",
});
assert.equal(codexConfig.transport, "codex-cli", "an explicit codex override outranks API credentials");
assert.equal(codexConfig.model, "gpt-5.6-sol");
assert.equal(codexConfig.reasoningEffort, "medium");
assert.equal(codexConfig.authentication, "saved-chatgpt-login");
assert.equal(codexConfig.usesApiKey, false);
assert.equal(codexConfig.displayLabel, "本机 Codex · ChatGPT 登录");
assert.equal(
  codexConfig.concurrency.maxConcurrentCharacters,
  1,
  "a shell-bound transport must stay serial",
);

// An agent shell with no operator credentials borrows that shell instead.
const shellConfig = resolveV27CharacterModelProviderConfig({ CLAUDECODE: "1" }, { apiModel: "" });
assert.equal(shellConfig.transport, "subagent");
assert.equal(shellConfig.usesApiKey, false);
assert.equal(shellConfig.shell.label, "Claude Code");

assert.throws(
  () => resolveV27CharacterModelProviderConfig({ GTOWN_V27_MODEL_TRANSPORT: "unknown" }),
  /GTOWN_V27_MODEL_TRANSPORT/u,
);

const serverSource = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
assert.match(serverSource, /resolveV27CharacterModelProviderConfig/u);
assert.match(serverSource, /createV27CharacterModelProvider/u);
assert.match(serverSource, /modelTransport/u);
assert.match(serverSource, /usesApiKey/u);

const pageSource = await readFile(new URL("../src/v27-test.js", import.meta.url), "utf8");
assert.match(pageSource, /usesApiKey/u);
assert.match(pageSource, /本机 Codex/u);
assert.match(pageSource, /不使用项目 API 密钥/u);

console.log("v27 browser Codex transport contracts passed");
