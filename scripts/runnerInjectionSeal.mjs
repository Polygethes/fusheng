// Contract: an injected runner set must never silently fall back to the network.
//
// Background.  Tests inject fake runners by key.  When the production path later
// started reading a different key (`runTavernCausalAgent` / `runTavernCharacterAgentV2Stage`
// instead of `runTavernAgentDecision`), the default runner table quietly supplied
// the real provider implementation for the key that was actually invoked.  The
// injected fake became dead weight and the "offline" contract reached out to a
// provider — visible only as a missing-API-key crash.
//
// Under `runnerPolicy: "strict"` an invoked-but-not-injected runner must fail
// with a code and the offending key name, so the drift is named instead of
// being replaced by a network call.
//
// The guard fires on invocation, not on property access: call sites legitimately
// read runners they may never invoke, and a read-time guard would report drift
// that never occurred.

import assert from "node:assert/strict";
import { modelRunnerTable } from "../src/server/pipeline/openaiPipeline.mjs";

function expectThrows(fn, message) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error(message);
}

// 1. Default policy keeps production behaviour: every key resolves to a real runner.
{
  const runners = modelRunnerTable({});
  assert.equal(typeof runners.runTavernCausalAgent, "function", "default policy must supply a real causal agent runner");
  assert.equal(typeof runners.runTavernCharacterAgentV2Stage, "function", "default policy must supply a real v2 stage runner");
  assert.equal(typeof runners.streamSceneNovel, "function", "default policy must supply a real novel streamer");
}

// 2. Strict policy still returns whatever the caller injected.
{
  const injected = async () => ({ decision: {}, stage: { name: "fake" } });
  const runners = modelRunnerTable({ runTavernCausalAgent: injected }, { policy: "strict" });
  assert.equal(runners.runTavernCausalAgent, injected, "strict policy must return the injected runner unchanged");
}

// 3. Strict policy refuses to substitute a network runner for a missing key.
{
  const runners = modelRunnerTable({ runTavernCausalAgent: async () => ({}) }, { policy: "strict" });
  const error = expectThrows(
    () => runners.runTavernCharacterAgentV2Stage(),
    "strict policy must refuse to run a non-injected runner",
  );
  assert.equal(error.code, "RUNNER_NOT_INJECTED", "the failure must carry a stable code");
  assert.equal(error.runnerKey, "runTavernCharacterAgentV2Stage", "the failure must carry the missing key");
  assert.match(error.message, /runTavernCharacterAgentV2Stage/, "the failure must name the missing runner key");
  assert.match(error.message, /runTavernCausalAgent/, "the failure must list what was injected so drift is diagnosable");
}

// 4. Reading a non-injected runner is safe; only invoking it fails.  Call sites
//    forward runners they may never use, and those reads must not raise.
{
  const runners = modelRunnerTable({ runTavernCausalAgent: async () => ({}) }, { policy: "strict" });
  const forwarded = runners.runTavernCharacterAgentV2Stage;
  assert.equal(typeof forwarded, "function", "a non-injected runner must still read as a function");
  const error = expectThrows(() => forwarded(), "the forwarded guard must fail when invoked");
  assert.equal(error.code, "RUNNER_NOT_INJECTED", "the forwarded guard must keep the stable code");
}

// 5. The guard covers every runner the production paths can invoke, not a hand-picked subset.
{
  const runners = modelRunnerTable({}, { policy: "strict" });
  const keys = [
    "runPrivateSimulators",
    "runVisibilityLayer",
    "runSceneInteractionSimulator",
    "runDepthAuditor",
    "runRepairPass",
    "runDialoguePsychology",
    "runLiveTurnLoop",
    "runBackgroundSlot",
    "runTavernAgentDecision",
    "runTavernCausalAgent",
    "runTavernCharacterAgentV2Stage",
    "streamSceneNovel",
  ];
  for (const key of keys) {
    const error = expectThrows(() => runners[key](), `strict policy must guard ${key}`);
    assert.equal(error.code, "RUNNER_NOT_INJECTED", `${key} must fail with RUNNER_NOT_INJECTED`);
  }
}

// 6. A typo in an injected key must surface as the same named failure rather
//    than as a silently undefined runner.
{
  const runners = modelRunnerTable({ runTavernCausalAgent: async () => ({}) }, { policy: "strict" });
  const error = expectThrows(
    () => runners.runTavernCausalAgentt(),
    "strict policy must reject unknown runner keys",
  );
  assert.equal(error.code, "RUNNER_NOT_INJECTED", "unknown keys must fail with the same code");
}

// 7. Introspection helpers used by callers/tests must stay available under strict
//    policy, otherwise object spread or logging would trip the guard.
{
  const runners = modelRunnerTable({ runTavernCausalAgent: async () => ({}) }, { policy: "strict" });
  assert.ok(Object.keys(runners).includes("runTavernCausalAgent"), "injected keys must remain enumerable");
  assert.equal("runTavernCharacterAgentV2Stage" in runners, false, "non-injected keys must report absent under strict policy");
}

console.log("runner injection seal contract passed");
