import assert from "node:assert/strict";

import {
  CHARACTER_MODEL_TRANSPORTS,
  detectAgentShell,
  mapCharactersWithConcurrency,
  resolveCharacterModelEnvironment,
  resolveOperatorApi,
} from "../src/server/modelEnvironment.mjs";
import {
  createV27CharacterModelProvider,
  resolveV27CharacterModelProviderConfig,
} from "../src/server/v27CharacterModelProvider.mjs";

const BARE = Object.freeze({ GTOWN_AGENT_SHELL: "none" });

// --- no default model -------------------------------------------------------

const bare = resolveCharacterModelEnvironment(BARE);
assert.equal(bare.transport, "none", "an unconfigured run must select no model at all");
assert.equal(bare.model, "", "an unconfigured run must not name a model");
assert.equal(bare.reason, "no-model-configured");

const keyOnly = resolveCharacterModelEnvironment({ ...BARE, DEEPSEEK_API_KEY: "k" });
assert.equal(
  keyOnly.transport,
  "none",
  "credentials alone must not select a model; the base URL must never imply one",
);
assert.equal(resolveOperatorApi({ ...BARE, DEEPSEEK_API_KEY: "k" }).configured, false);

// --- operator-supplied API --------------------------------------------------

const api = resolveCharacterModelEnvironment({
  ...BARE,
  DEEPSEEK_API_KEY: "k",
  CHARACTER_TOWN_MODEL: "some-model",
});
assert.equal(api.transport, "model-api");
assert.equal(api.model, "some-model");
assert.equal(api.usesApiKey, true);
assert.equal(api.reason, "operator-supplied-api");
assert.equal(
  api.concurrency.isolation,
  "per-character-stateless-request",
  "an API transport isolates characters as independent concurrent requests",
);
assert.ok(api.concurrency.maxConcurrentCharacters > 1);

assert.throws(
  () => resolveCharacterModelEnvironment({
    ...BARE,
    GTOWN_MODEL_TRANSPORT: "model-api",
    DEEPSEEK_API_KEY: "k",
  }),
  (error) => error.code === "GTOWN_MODEL_API_INCOMPLETE",
  "an API transport without an explicit model must fail loudly, not guess",
);

// --- borrowed from the surrounding agent shell ------------------------------

for (const [marker, label] of [
  ["CLAUDECODE", "Claude Code"],
  ["CODEX_SANDBOX", "Codex CLI"],
  ["CURSOR_AGENT", "Cursor"],
]) {
  const shell = detectAgentShell({ [marker]: "1" });
  assert.equal(shell.present, true, `${marker} should be recognised as an agent shell`);
  assert.equal(shell.label, label);
  const resolved = resolveCharacterModelEnvironment({ [marker]: "1" });
  assert.equal(resolved.transport, "subagent", `${label} should trigger the subagent transport`);
  assert.equal(resolved.usesApiKey, false);
  assert.equal(
    resolved.concurrency.maxConcurrentCharacters,
    1,
    "a shell transport is bound to one orchestrator and must stay serial",
  );
}

assert.equal(
  detectAgentShell({ ...BARE, CLAUDECODE: "1" }).present,
  false,
  "GTOWN_AGENT_SHELL=none must suppress detection",
);

// Operator credentials win over the surrounding shell: an explicit choice
// outranks an inherited one.
const both = resolveCharacterModelEnvironment({
  CLAUDECODE: "1",
  DEEPSEEK_API_KEY: "k",
  CHARACTER_TOWN_MODEL: "some-model",
});
assert.equal(both.transport, "model-api", "an explicitly supplied API outranks the ambient shell");

// --- transport validation ---------------------------------------------------

assert.throws(
  () => resolveCharacterModelEnvironment({ ...BARE, GTOWN_MODEL_TRANSPORT: "telepathy" }),
  (error) => error.code === "GTOWN_MODEL_TRANSPORT_UNSUPPORTED",
);
for (const transport of CHARACTER_MODEL_TRANSPORTS) {
  assert.equal(typeof transport, "string");
}

// --- provider construction refuses to invent a model ------------------------

assert.throws(
  () => createV27CharacterModelProvider(resolveV27CharacterModelProviderConfig(BARE)),
  (error) => error.code === "GTOWN_MODEL_NOT_CONFIGURED",
  "building a provider with no configured model must fail rather than pick one",
);

assert.throws(
  () => createV27CharacterModelProvider(
    resolveV27CharacterModelProviderConfig({ CLAUDECODE: "1" }),
    { environment: {} },
  ),
  (error) => error.code === "GTOWN_SUBAGENT_EXCHANGE_REQUIRED",
  "the subagent transport must name where stages are exchanged",
);

// --- per-character concurrency ---------------------------------------------

let inFlight = 0;
let peak = 0;
const order = await mapCharactersWithConcurrency(
  ["a", "b", "c", "d", "e"],
  async (characterId) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => { setTimeout(resolve, 5); });
    inFlight -= 1;
    return characterId.toUpperCase();
  },
  { maxConcurrentCharacters: 2 },
);
assert.deepEqual(order, ["A", "B", "C", "D", "E"], "results must stay in character order");
assert.ok(peak > 1, "independent characters should actually overlap");
assert.ok(peak <= 2, "the configured concurrency cap must hold");

let settled = 0;
await assert.rejects(
  () => mapCharactersWithConcurrency(
    ["a", "b", "c"],
    async (characterId) => {
      await new Promise((resolve) => { setTimeout(resolve, 5); });
      settled += 1;
      if (characterId === "b") throw new Error("character b failed");
      return characterId;
    },
    { maxConcurrentCharacters: 3 },
  ),
  (error) => error.code === "GTOWN_MODEL_CHARACTER_TASKS_FAILED",
  "one character's failure must surface, not be swallowed",
);
assert.equal(settled, 3, "a failure must not abandon other characters mid-request");

console.log("characterModelEnvironment:test passed", {
  transports: CHARACTER_MODEL_TRANSPORTS.join(", "),
  apiConcurrency: api.concurrency.maxConcurrentCharacters,
});
