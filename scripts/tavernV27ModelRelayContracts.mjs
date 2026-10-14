import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

const fixture = createTavernV27FixtureStageRunner();
const dayPlan = async pending => (await fixture(pending.stageInput, { stage: "character_day_planning" })).dayPlan;
const temp = await mkdtemp(path.join(os.tmpdir(), "gtown-relay-contract-"));
const savePath = path.join(temp, "world-save.json");
let log = "", errors = "";
function startRelay(resume = false) {
  log = ""; errors = "";
  const child = spawn(process.execPath, [path.join(root, "scripts/runV27ModelRelay.mjs")], {
    cwd: root, env: { ...process.env, RELAY_PORT: "0", RELAY_TURN_LIMIT: "20",
      RELAY_INPUT_KIND: "fixture", RELAY_SAVE_PATH: savePath, RELAY_RESUME_PATH: resume ? savePath : "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", chunk => { log += chunk; });
  child.stderr.on("data", chunk => { errors += chunk; });
  return child;
}
let child = startRelay();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let url;
async function request(endpoint, body) {
  const start = performance.now();
  try {
    const response = await fetch(`${url}${endpoint}`, {
      ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(2000),
    });
    return { status: response.status, body: await response.json(), elapsedMs: performance.now() - start };
  } catch (error) { return { error: error.name, elapsedMs: performance.now() - start }; }
}
async function waitPending(previousId) {
  const start = performance.now();
  let lastErrors = [];
  while (performance.now() - start < 2500) {
    const result = await request("/status");
    lastErrors = result.body?.errors || [];
    const pending = result.body?.pending;
    if (pending && (!previousId || pending.stageId !== previousId)) return pending;
    await sleep(10);
  }
  assert.fail(`the next stage must become available independently of the submission response; ${JSON.stringify(lastErrors)}`);
}
try {
  const start = performance.now();
  while (!log.match(/http:\/\/127\.0\.0\.1:\d+/)) {
    if (child.exitCode !== null) throw new Error(errors);
    assert.ok(performance.now() - start < 10000, "relay startup deadline");
    await sleep(10);
  }
  url = log.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  const first = await waitPending();
  const modelRequest = (await request("/pending?format=model")).body.pending;
  assert.equal(modelRequest.stageId, first.stageId);
  assert.ok(modelRequest.systemPrompt && modelRequest.userPrompt);
  assert.deepEqual(modelRequest.schema, first.schema);
  assert.ok(modelRequest.userPrompt.includes("horizon"), "the official reader retains the complete planning context");
  assert.equal((await request("/pending")).body.pending.stageId, first.stageId, "reading a model request never consumes a stage");
  const initialStatus = (await request("/status")).body;
  const actorCount = initialStatus.execution.actors.length;
  assert.equal(actorCount, 5, "a fresh relay includes the actual household recipients");
  assert.equal(initialStatus.provenance?.kind, "fixture",
    "deterministic test responses must never be attributed to a model");
  const plan = await dayPlan(first);
  const invalidShape = await request("/validate", { stageId: first.stageId, output: {} });
  assert.equal(invalidShape.status, 422, "read-only validation must reject malformed output without consuming a request");
  assert.equal(invalidShape.body.received, false);
  assert.equal((await request("/status?compact=1")).body.pending.stageId, first.stageId);
  const withoutMetadata = structuredClone(plan);
  delete withoutMetadata.ownerAuthority;
  const preview = await request("/validate", { stageId: first.stageId, output: withoutMetadata });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.received, false);
  assert.ok(preview.body.filledMetadata.includes("output.ownerAuthority"));
  assert.equal((await request("/pending")).body.pending.stageId, first.stageId, "dry validation cannot consume or advance a stage");
  const foreignOwner = await request("/validate", { stageId: first.stageId, output: { ...plan, ownerAuthority: "world" } });
  assert.equal(foreignOwner.status, 422, "contradictory authority cannot be silently overwritten");
  // Exercise the original deadlock before asserting the new identity contract.
  // The legacy relay accepts a raw output; the fixed relay requires an envelope.
  await sleep(100);
  const envelope = first.stageId ? { stageId: first.stageId, output: plan } : plan;
  const receipt = await request("/respond", envelope);
  assert.ok([200, 202].includes(receipt.status),
    `an accepted submission must return while the next stage waits; received ${JSON.stringify(receipt)}`);
  assert.equal(receipt.status, 202, "delivery is acknowledged without claiming domain validation");
  assert.equal(receipt.body.received, true);
  assert.ok(first.stageId, "each provider invocation, including repairs, needs its own stage identity");
  const next = await waitPending(first.stageId);
  assert.notEqual(next.agentTurnId, first.agentTurnId);

  const duplicate = await request("/respond", envelope);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal((await request("/respond", { stageId: first.stageId, output: {} })).status, 409);
  assert.equal((await request("/respond", { stageId: "stale-or-other-run", output: {} })).status, 409);
  assert.equal((await request("/respond", {})).status, 400);
  assert.equal((await request("/status")).body.pending.stageId, next.stageId,
    "duplicates and stale replies must not consume the next character's stage");

  const extended = await request("/extend", { limit: 21 });
  assert.equal(extended.status, 202, "extending the limit must not wait for the active model stage");
  const compact = (await request("/status?compact=1")).body;
  assert.equal(compact.pending.stageId, next.stageId);
  assert.equal(compact.pending.stageInput, undefined, "progress checks should not retransmit private context");
  assert.ok(compact.pending.waitingMs >= 0);
  const full = (await request("/pending")).body.pending;
  assert.equal(full.stageId, next.stageId);
  assert.ok(full.stageInput && full.schema);

  const secondPlan = await dayPlan(next);
  const second = { stageId: next.stageId, output: secondPlan };
  const concurrent = await Promise.all([request("/respond", second), request("/respond", second)]);
  assert.deepEqual(concurrent.map(row => row.status).sort(), [200, 202], "only one concurrent copy is delivered");
  let pending = await waitPending(next.stageId);
  while (pending.phase === "awaiting_character_day_planning") {
    const output = await dayPlan(pending);
    assert.equal((await request("/respond", { stageId: pending.stageId, output })).status, 202);
    pending = await waitPending(pending.stageId);
  }
  assert.equal(pending.phase, "awaiting_subjective_appraisal_and_candidates");
  const invalidDomainOutput = async p => {
    const { appraisal } = await fixture(p.stageInput, { stage: "subjective_appraisal" });
    const { candidates } = await fixture({ ...p.stageInput, subjectiveAppraisal: appraisal }, { stage: "agent_candidates" });
    appraisal.appraisalId = "";
    return { appraisal, candidates };
  };
  const rejectedId = pending.stageId;
  const badDomain = await request("/respond", { stageId: rejectedId, output: await invalidDomainOutput(pending) });
  assert.equal(badDomain.status, 202, JSON.stringify(badDomain.body));
  const repaired = await waitPending(rejectedId);
  assert.equal(repaired.agentTurnId, pending.agentTurnId);
  assert.equal(repaired.phase, pending.phase);
  assert.notEqual(repaired.stageId, rejectedId, "a repair is a new invocation even with the same turn and phase");
  assert.ok(repaired.protocolRepairFeedback);
  const metrics = (await request("/metrics")).body;
  const archivedFirst = JSON.parse(await readFile(metrics.stages[0].archivePath, "utf8"));
  assert.equal(archivedFirst.received, true, "acknowledged responses must have a durable raw-stage archive");
  assert.equal(archivedFirst.stageId, first.stageId);
  assert.ok(archivedFirst.stageInput && archivedFirst.schema && archivedFirst.output);
  assert.ok(metrics.stages[0].responseWaitMs >= 80, "real external wait must not be hard-coded to 1 ms");
  assert.ok(metrics.stages[0].schemaMs >= 0);
  assert.ok(metrics.stages[0].inputBytes > 0);
  assert.equal(metrics.stages.find(row => row.stageId === rejectedId).validation, "rejected");
  assert.equal(metrics.stages.find(row => row.stageId === repaired.stageId).responseWaitMs, null);
  assert.ok(metrics.turns.every(row => row.localElapsedMs >= 0 && row.externalWaitMs >= 0));

  assert.equal((await request("/respond", { stageId: repaired.stageId, output: await invalidDomainOutput(repaired) })).status, 202);
  const secondRepair = await waitPending(repaired.stageId);
  assert.equal(secondRepair.agentTurnId, repaired.agentTurnId, "configured two repairs must remain in the same turn");
  assert.equal((await request("/respond", { stageId: secondRepair.stageId, output: await invalidDomainOutput(secondRepair) })).status, 202);
  // The first suspended participant stops the entire scene.
  let halted;
  const haltStartedAt = performance.now();
  while (performance.now() - haltStartedAt < 10000) {
    halted = (await request("/status?compact=1")).body;
    if (halted.stopReason === "suspended_model_error" && !halted.pending) break;
    if (halted.pending) {
      const invalid = await request("/respond", { stageId: halted.pending.stageId, output: {} });
      assert.equal(invalid.status, 422);
      assert.equal(invalid.body.received, true, "submitted malformed output consumes a bounded attempt");
    }
    await sleep(50);
  }
  assert.equal(halted.stopReason, "suspended_model_error");
  assert.equal(halted.pending, null);
  assert.equal(halted.worldOutcomeCount, 0, "day plans are not physical action outcomes");
  assert.equal(halted.maintenanceTurnCount, actorCount);
  assert.equal((await request("/extend", { limit: 40 })).status, 409,
    "an extension must not reset an exhausted repair budget");
  const stageCount = (await request("/metrics")).body.stages.length;
  await sleep(100);
  assert.equal((await request("/metrics")).body.stages.length, stageCount, "halted runs must not keep requesting stages");
  const saved = JSON.parse(await readFile(savePath, "utf8"));
  assert.equal(saved.settledTurns.length, actorCount);
  assert.equal(saved.summary.stopReason, "suspended_model_error");
  assert.equal(saved.provenance.kind, "fixture");
  assert.equal(saved.checkpoint.actors.filter(row => row.executionControl.status === "suspended_model_error").length, 1, "other actors must not spend model calls after the first suspension");
  assert.equal(halted.complete, false);
  assert.equal(halted.failure.code, "SIMULATION_PARTICIPANT_UNAVAILABLE");
  const report = await readFile(`${savePath}.report.md`, "utf8");
  assert.ok(report.includes(`已结算 ${actorCount} 个人物回合`));
  assert.equal(await (await fetch(`${url}/report`)).text(), report);
  const closed = once(child, "close");
  child.kill("SIGTERM");
  await closed;
  child = startRelay(true);
  const restartAt = performance.now();
  while (!log.match(/http:\/\/127\.0\.0\.1:\d+/)) {
    if (child.exitCode !== null) throw new Error(errors);
    assert.ok(performance.now() - restartAt < 10000, "relay restart deadline");
    await sleep(10);
  }
  url = log.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  const resumed = (await request("/status?compact=1")).body;
  assert.equal(resumed.stopReason, "suspended_model_error", "a process restart must preserve all spent actor budgets");
  assert.equal(resumed.settledCount, actorCount);
  assert.equal(resumed.pending, null);
  console.log(JSON.stringify({ result: "passed", firstReceiptMs: receipt.elapsedMs,
    firstExternalWaitMs: metrics.stages[0].responseWaitMs, receiptCount: metrics.receivedCount,
    stages: metrics.stages.length, assertions: "nonblocking receipt/extend, identity, idempotency, concurrent replies, repair isolation, measured timings" }));
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const closed = once(child, "close");
    child.kill("SIGTERM");
    await closed;
  }
  await rm(temp, { recursive: true, force: true });
}
