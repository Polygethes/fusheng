// Local synthetic performance evidence, not a real model/character-quality run.
// Uses the actual runtime and HTTP relay. Never contacts an external provider.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import { createTavernWorldRuntimeV27, projectTavernV27TurnForObserver } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { tavernCharacterAgentV2OutputSchemaForStage } from "../src/server/pipeline/tavernCharacterAgentV2.mjs";

const seed = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
const characterIds = ["char_xyy_xiezenshi", "char_xyy_luozhao", "char_xyy_zhoumin"];
const config = {
  characterIds, positions: Object.fromEntries(characterIds.map(id => [id, "hall"])),
  worldId: "world:xyy:tavern:v27:pi-model-sim20", enableDayPlanning: true,
};
const turnCount = Number(process.env.GTOWN_BENCHMARK_TURNS || 20);
assert.ok(Number.isSafeInteger(turnCount) && turnCount > 0, "positive integer benchmark turn limit required");
const clone = globalThis.structuredClone;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const outputKeys = {
  character_day_planning: "dayPlan", character_reflection: "reflection",
  subjective_appraisal_and_candidates: "appraisalAndCandidates",
  agent_choice_and_turn_commit: "choiceAndTurnCommit", agent_turn_commit: "turnCommit",
};
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] || 0;
  return { count: sorted.length, total: sorted.reduce((s, n) => s + n, 0), p50: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1) || 0 };
}
function replay(reference, input, stage) {
  const saved = reference.get(input.agentTurnId);
  assert.ok(saved, "replay must match the current character turn, never arrival order");
  if (stage === "subjective_appraisal_and_candidates") return {
    appraisalAndCandidates: { appraisal: clone(saved.get("subjective_appraisal").appraisal), candidates: clone(saved.get("agent_candidates").candidates) },
  };
  if (stage === "agent_choice_and_turn_commit") return {
    choiceAndTurnCommit: { choice: clone(saved.get("agent_choice_and_regulation").choice), turnCommit: clone(saved.get("agent_turn_commit").turnCommit) },
  };
  return clone(saved.get(stage));
}
async function captureReference(candidateCount) {
  const reference = new Map(), turns = [];
  const fixture = createTavernV27FixtureStageRunner();
  const instance = createTavernWorldRuntimeV27(seed, { ...config, runStage: async (input, options) => {
    const result = await fixture(input, options);
    if (options.stage === "agent_candidates" && candidateCount > 1) {
      const first = result.candidates.candidates[0];
      // Seven separately identified copies stress the context path, without
      // pretending that a fixture supplies diverse model-authored decisions.
      result.candidates.candidates = Array.from({ length: candidateCount }, (_, i) => ({
        ...clone(first), candidateId: first.candidateId + (i ? `:alternative-${i}` : ""),
      }));
    }
    if (!reference.has(input.agentTurnId)) reference.set(input.agentTurnId, new Map());
    reference.get(input.agentTurnId).set(options.stage, clone(result));
    return result;
  } });
  try {
    for (let i = 0; i < turnCount; i++) {
      const turn = await instance.runtime.runNext();
      assert.ok(turn, "reference must complete every requested turn");
      turns.push(projectTavernV27TurnForObserver(turn, seed.characters));
    }
  } finally { for (const actor of instance.runtime.actors.values()) await actor.close(); }
  return { reference, turns };
}
async function measureLocal(candidateCount, reference, expected) {
  let cloneCount = 0, cloneMs = 0;
  const stages = [], turns = [];
  let resumedAt;
  const instance = createTavernWorldRuntimeV27(seed, { ...config, characterAgentCallMode: "two-call", runStage: async (input, options) => {
    const at = performance.now();
    const schema = tavernCharacterAgentV2OutputSchemaForStage(input);
    const schemaMs = performance.now() - at;
    stages.push({ agentTurnId: input.agentTurnId, phase: input.phase,
      localPreparationMs: at - resumedAt, schemaMs,
      payloadBytes: Buffer.byteLength(JSON.stringify({ stageInput: input, schema })),
      candidateCount: input.candidateCommitContexts?.length || 0 });
    const result = replay(reference, input, options.stage);
    resumedAt = performance.now();
    return result;
  } });
  globalThis.structuredClone = (...args) => {
    const at = performance.now();
    try { return clone(...args); }
    finally { cloneCount++; cloneMs += performance.now() - at; }
  };
  const start = performance.now();
  try {
    for (let i = 0; i < turnCount; i++) {
      const at = performance.now();
      resumedAt = at;
      const turn = await instance.runtime.runNext();
      const actual = projectTavernV27TurnForObserver(turn, seed.characters);
      const before = clone(expected[i]);
      // Four-call and two-call provider stage names intentionally differ. Keep
      // all public actions, deliveries, world outcomes and private choices equal.
      delete actual.stageNames;
      delete before.stageNames;
      assert.deepEqual(actual, before, `turn ${i + 1} equivalence`);
      turns.push({ turn: i + 1, kind: actual.turnKind, elapsedMs: performance.now() - at });
    }
    return { candidateCount, totalMs: performance.now() - start, cloneCount, cloneMs,
      schemaMs: summary(stages.map(row => row.schemaMs)),
      preparationMs: summary(stages.map(row => row.localPreparationMs)),
      payloadBytes: summary(stages.map(row => row.payloadBytes)),
      publicAndPrivateTurnEquivalence: true, stages, turns };
  } finally {
    globalThis.structuredClone = clone;
    for (const actor of instance.runtime.actors.values()) await actor.close();
  }
}
function compactExpected(row, index) {
  return { index: index + 1, characterName: row.characterName, characterId: row.characterId,
    turnKind: row.turnKind, wakeKind: row.wakeKind,
    intention: row.observerOnlyPsychology?.selectedIntention || "",
    speech: row.publicRealization?.speech || "", visibleAction: row.publicRealization?.visibleAction || "",
    outcome: { primitive: row.outcome?.primitive || "", status: row.outcome?.status || "", worldVersion: row.outcome?.worldVersion ?? null },
    agentTurnId: row.agentTurnId };
}
async function measureHttp(reference, expected) {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../sim-runs/2026-09-07-pi-model-20turns/sim-model-relay.mjs", import.meta.url))], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { ...process.env, RELAY_PORT: "0", RELAY_TURN_LIMIT: String(turnCount),
      RELAY_INPUT_KIND: "fixture", RELAY_SAVE_PATH: "", RELAY_RESUME_PATH: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "", errors = "";
  child.stdout.on("data", chunk => { log += chunk; });
  child.stderr.on("data", chunk => { errors += chunk; });
  const startedAt = performance.now();
  try {
    while (!log.match(/http:\/\/127\.0\.0\.1:\d+/)) {
      if (child.exitCode !== null) throw new Error(errors);
      assert.ok(performance.now() - startedAt < 10000, "relay startup deadline");
      await sleep(5);
    }
    const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
    const request = async (endpoint, body) => {
      const result = await fetch(`${url}${endpoint}`, {
        ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(2000),
      });
      return { status: result.status, body: await result.json() };
    };
    const receipts = [];
    let final;
    const injectedResponderDelayMs = 25;
    while (performance.now() - startedAt < Math.max(15000, turnCount * 1000)) {
      const status = (await request("/status?compact=1")).body;
      assert.deepEqual(status.errors, [], "HTTP replay must have no runtime failures");
      if (status.complete) { final = status; break; }
      if (!status.pending) { await sleep(5); continue; }
      const pending = (await request("/pending")).body.pending;
      assert.equal(pending.stageId, status.pending.stageId);
      const result = replay(reference, pending.stageInput, pending.stage);
      const output = result[outputKeys[pending.stage]];
      assert.ok(output, "every stage needs its own captured fixture output");
      await sleep(injectedResponderDelayMs);
      const at = performance.now();
      const receipt = await request("/respond", { stageId: pending.stageId, output });
      receipts.push({ stageId: pending.stageId, elapsedMs: performance.now() - at, status: receipt.status });
      assert.equal(receipt.status, 202, `submission must acknowledge before the next response exists: ${JSON.stringify(receipt.body)}`);
    }
    assert.ok(final?.complete, `all ${turnCount} relay turns must settle within the local replay deadline`);
    const expectedTurns = expected.map(compactExpected);
    assert.deepEqual(final.settledTurns.map(row => Object.fromEntries(
      Object.keys(expectedTurns[0]).map(key => [key, row[key]]))), expectedTurns);
    assert.equal(final.provenance.kind, "fixture");
    assert.equal(final.provenance.modelVerified, false);
    assert.equal(final.worldOutcomeCount, expected.filter(row => row.outcome?.status).length);
    for (const [index, row] of final.settledTurns.entries()) {
      assert.equal(row.provenance.kind, "fixture");
      assert.equal(row.hasWorldAttempt, Boolean(expected[index].outcome?.status));
      assert.deepEqual(row.failureCodes, [...new Set((expected[index].outcome?.failedEffects || []).map(effect => effect.code).filter(Boolean))]);
      assert.deepEqual(row.resolvedEffectKinds, [...new Set((expected[index].outcome?.resolvedEffects || []).map(effect => effect.kind).filter(Boolean))]);
    }
    const metrics = (await request("/metrics")).body;
    return { totalIncludingStartupMs: performance.now() - startedAt, injectedResponderDelayMs,
      turnCount: final.settledCount, actionTurnCount: final.actionTurnCount,
      worldOutcomeCount: final.worldOutcomeCount, maintenanceTurnCount: final.maintenanceTurnCount,
      provenance: final.provenance,
      worldVersion: final.settledTurns.map(row => row.outcome.worldVersion).filter(Number.isInteger).at(-1),
      publicTurnEquivalence: true, receiptMs: summary(receipts.map(row => row.elapsedMs)),
      localTurnMs: summary(metrics.turns.map(row => row.localElapsedMs)),
      externalWaitMs: summary(metrics.stages.map(row => row.responseWaitMs)),
      schemaMs: summary(metrics.stages.map(row => row.schemaMs)), receipts, metrics };
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, "close");
      child.kill("SIGTERM");
      await closed;
    }
  }
}

const local = [];
let stress;
for (const count of [1, 7]) {
  const reference = await captureReference(count);
  local.push(await measureLocal(count, reference.reference, reference.turns));
  stress = reference;
}
const http = await measureHttp(stress.reference, stress.turns);
console.log(JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version, platform: `${process.platform} ${process.arch}`,
  measurement: `Synthetic three-character ${turnCount}-turn fixture. Local runtime measured separately from loopback HTTP with a 25 ms responder delay. Not the user's original model outputs or an inference speed benchmark.`,
  local, http }, null, 2));
