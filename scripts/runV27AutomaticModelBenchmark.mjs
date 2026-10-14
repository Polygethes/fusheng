import { TAVERN_SCENE_CHARACTER_IDS, TAVERN_SCENE_POSITIONS } from "../src/server/pipeline/tavernSceneConfiguration.mjs";
// Explicit real-model experiment. Never executed by the offline contract suite.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernWorldRuntimeV27, projectTavernV27TurnForObserver } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { createV27CharacterModelProvider } from "../src/server/v27CharacterModelProvider.mjs";
import { executeCodexTrustedBlindProbeInvocation } from "../src/server/ecology/codexTrustedBlindProbeChannel.mjs";
import { createCharacterModelSessionPool, restoreCharacterModelSessionPool } from "../src/server/simulation/characterModelSession.mjs";
import { createModelRequestBudget, modelRequestBudgetSnapshot } from "../src/server/pipeline/modelRequestBudget.mjs";
import { reconcileSettledTurnRecords, summarizeSettledSimulation, renderSettledSimulationReport } from "../src/server/simulation/settledSimulationReport.mjs";

const arg = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const dryRun = process.argv.includes("--dry-run");
if (!process.argv.includes("--run") && !dryRun) {
  console.log("Use --run --fresh --turns 10 --model gpt-5.6-luna --reasoning-effort high for 10 real character turns (including planning/reflection), or --dry-run to prepare without model calls. Model defaults to gpt-5.6-sol / medium. Fresh runs default to --pacing scene (five characters, near-term plans); --pacing day preserves day-scale diagnostics. --opening-seconds 900 configures scene opening preparation. Use --checkpoint FILE to continue explicitly; saved cast and time policy are preserved. Without --turns, the original two-action benchmark requires --checkpoint FILE or --preconditions-dir DIR. Production uses --call-mode three-call. Legacy diagnostics require --diagnostic-legacy-call-mode. Optional --prompt-format expanded|compact|shared, --max-stage-repairs 0..2 and --output-root DIR. Outputs go to a new private directory.");
  process.exit(0);
}
const callMode = arg("--call-mode", "three-call");
assert.ok(["two-call", "three-call"].includes(callMode));
assert.ok(callMode === "three-call" || process.argv.includes("--diagnostic-legacy-call-mode"), "Production simulations require three-call; legacy latency experiments must opt into --diagnostic-legacy-call-mode.");
const promptFormat = arg("--prompt-format", "shared");
assert.ok(["expanded", "compact", "shared"].includes(promptFormat));
process.env.GTOWN_CHARACTER_PROMPT_FORMAT = promptFormat;
const checkpointFile = arg("--checkpoint", null);
const modelCheckpointFile = arg("--model-checkpoint", null);
assert.ok(!modelCheckpointFile || checkpointFile, "--model-checkpoint requires an explicit --checkpoint world save.");
const preconditionsDir = arg("--preconditions-dir", null);
const fresh = process.argv.includes("--fresh");
const simulation = process.argv.includes("--turns");
const requestedTurns = simulation ? Number(arg("--turns", "")) : 2;
assert.ok(Number.isSafeInteger(requestedTurns) && requestedTurns > 0, "INVALID_TURN_LIMIT");
assert.equal([checkpointFile, preconditionsDir, fresh].filter(Boolean).length, 1,
  "Choose exactly one of --fresh, --checkpoint FILE, or --preconditions-dir DIR; never implicitly use a live simulation's files.");
assert.ok(!fresh || simulation, "--fresh requires --turns so the full simulation has an explicit limit.");
assert.ok(!simulation || !preconditionsDir, "A full simulation must generate fresh maintenance output; use --fresh or an explicit checkpoint.");
const model = arg("--model", "gpt-5.6-sol"), reasoningEffort = arg("--reasoning-effort", "medium");
const codexCommand = arg("--codex-command", "codex");
const requestedActionTurns = simulation ? null : requestedTurns;
const maxStageProtocolRepairs = Number(arg("--max-stage-repairs", simulation ? "2" : "1"));
assert.ok(Number.isSafeInteger(maxStageProtocolRepairs) && maxStageProtocolRepairs >= 0 && maxStageProtocolRepairs <= 2, "INVALID_STAGE_REPAIR_LIMIT");
const maxRequests = requestedTurns * ((callMode === "three-call" ? 3 : 2) + maxStageProtocolRepairs);
const outputRoot = path.resolve(arg("--output-root", os.tmpdir()));
await mkdir(outputRoot, { recursive: true, mode: 0o700 });
const outputDir = await mkdtemp(path.join(outputRoot, `gtown-auto-${callMode}-${promptFormat}-`));
await mkdir(path.join(outputDir, "calls"), { mode: 0o700 });
const hash = value => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
let saveSequence = 0;
const save = async (name, value) => {
  const destination = path.join(outputDir, name), temporary = `${destination}.${process.pid}.${++saveSequence}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(temporary, destination);
};
const log = value => console.log(JSON.stringify(value));
const report = { schemaVersion: 2, status: "running", model, reasoningEffort, callMode, promptFormat, codexCommand,
  requestedActionTurns, requestedTurns, maxStageProtocolRepairs, maxRequests, outputDir, startedAt: new Date().toISOString(),
  turnCounting: simulation ? "all-character-turns-including-planning-and-reflection" : "action-turns-after-fixed-preconditions",
  provenance: { driver: "codex-cli", evidence: "per-call invocation settings, input and raw output files", fixtureFallback: false },
  measurement: "Automatic Codex CLI provider; command launch to final output includes CLI, network and model. CLI item events are not token timestamps. " + (preconditionsDir ? "Recorded day plans are fixed preconditions, not fresh model outputs." : "Every generated day plan uses the requested model; no recorded preconditions."),
  warmups: [], calls: [], turns: [], rejections: [], counts: {},
};
function updateCounts() {
  report.counts = {
    completedTurns: report.turns.length,
    actionTurns: report.turns.filter(row => row.observation.turnKind === "action").length,
    dayPlanningTurns: report.turns.filter(row => row.observation.turnKind === "day_planning").length,
    reflectionTurns: report.turns.filter(row => row.observation.turnKind === "reflection").length,
    worldAttempts: report.turns.filter(row => row.hasWorldAttempt).length,
    worldOutcomes: report.turns.filter(row => row.hasWorldOutcome).length,
    turnsWithModelOutput: report.turns.filter(row => row.hasFreshModelOutput).length,
    providerCalls: report.calls.length,
    providerReturns: report.calls.filter(row => row.outputFile).length,
  };
}
updateCounts();
const start = performance.now();
let activeCall = null, previousReturnAt = null, turnIndex = 0, warming = Boolean(preconditionsDir);
const requestBudget = createModelRequestBudget({ maxProviderRequests: maxRequests, authorizationId: `automatic-${model}-${reasoningEffort}:${path.basename(outputDir)}` });
const provider = createV27CharacterModelProvider({ transport: "codex-cli", model, reasoningEffort }, {
  tempRoot: outputDir,
  async execute(invocation, options) {
    invocation = { ...invocation, command: codexCommand };
    assert.equal(invocation.model, model);
    assert.equal(invocation.reasoningEffort, reasoningEffort);
    assert.equal(invocation.args[invocation.args.indexOf("--model") + 1], model);
    assert.ok(invocation.args.includes(`model_reasoning_effort="${reasoningEffort}"`));
    const call = activeCall;
    assert.ok(call, "a provider request must belong to the current character stage");
    const stem = `calls/${String(call.index).padStart(3, "0")}`;
    await save(`${stem}.invocation.json`, { command: invocation.command, args: invocation.args,
      cwd: invocation.cwd, model: invocation.model, reasoningEffort: invocation.reasoningEffort,
      sessionOperation: invocation.sessionOperation, providerConversationId: invocation.providerConversationId || null });
    const schema = await readFile(invocation.schemaPath, "utf8");
    call.promptBytes = Buffer.byteLength(invocation.stdin);
    call.promptSha256 = hash(invocation.stdin);
    call.schemaBytes = Buffer.byteLength(schema);
    call.schemaSha256 = hash(schema);
    call.sessionOperation = invocation.sessionOperation;
    call.providerConversationId = invocation.providerConversationId || null;
    await writeFile(path.join(outputDir, `${stem}.prompt.txt`), invocation.stdin, { mode: 0o600 });
    await writeFile(path.join(outputDir, `${stem}.schema.json`), schema, { mode: 0o600 });
    await save("report.json", report);
    call.invokedAt = new Date().toISOString();
    const invokedAt = performance.now();
    call.model = invocation.model;
    call.reasoningEffort = invocation.reasoningEffort;
    log({ type: "request_started", index: call.index, turnIndex, phase: call.phase, promptBytes: call.promptBytes, model, reasoningEffort });
    try {
      const result = await executeCodexTrustedBlindProbeInvocation(invocation, { ...options,
        onProgress(event) {
          if (call.progress.length < 100) call.progress.push(event);
          if (call.firstEventMs == null) call.firstEventMs = event.elapsedMs;
          if (event.type === "turn.started") call.turnStartedMs = event.elapsedMs;
          if (event.itemType === "agent_message" && call.firstAgentMessageMs == null) call.firstAgentMessageMs = event.elapsedMs;
          if (event.type === "turn.completed") { call.turnCompletedMs = event.elapsedMs; call.usage = event.usage; }
        },
      });
      call.invocationMs = performance.now() - invokedAt;
      const output = await readFile(invocation.outputPath, "utf8");
      call.outputBytes = Buffer.byteLength(output);
      call.outputSha256 = hash(output);
      call.outputFile = `${stem}.output.json`;
      await writeFile(path.join(outputDir, call.outputFile), output, { mode: 0o600 });
      log({ type: "request_finished", index: call.index, phase: call.phase, invocationMs: call.invocationMs,
        firstEventMs: call.firstEventMs, firstAgentMessageMs: call.firstAgentMessageMs, usage: call.usage });
      return result;
    } catch (error) {
      call.invocationMs = performance.now() - invokedAt;
      call.error = { code: error.code, message: error.message, exitCode: error.exitCode };
      if (error.stderr) await writeFile(path.join(outputDir, `${stem}.stderr.txt`), error.stderr, { mode: 0o600 });
      throw error;
    } finally { await save("report.json", report); }
  },
});
const modelCheckpoint = modelCheckpointFile ? JSON.parse(await readFile(modelCheckpointFile, "utf8")) : null;
report.sourceModelCheckpoint = modelCheckpointFile;
report.sourceModelCheckpointSha256 = modelCheckpoint ? hash(modelCheckpoint) : null;
const pool = modelCheckpoint
  ? restoreCharacterModelSessionPool(modelCheckpoint, { providerPort: provider })
  : createCharacterModelSessionPool({ providerPort: provider });
const pacingMode = arg("--pacing", preconditionsDir ? "day" : "scene");
const characterIds = pacingMode === "scene" ? [...TAVERN_SCENE_CHARACTER_IDS] : ["char_xyy_xiezenshi", "char_xyy_luozhao", "char_xyy_zhoumin"];
const seed = buildPlayableWorldFromSetup({ setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。", setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。" });
const checkpointDocument = checkpointFile ? JSON.parse(await readFile(checkpointFile, "utf8")) : null;
const checkpoint = checkpointDocument?.checkpoint || checkpointDocument;
let initialTurnIds = new Set((checkpoint?.completedTurnRecords || []).map(row => row.agentTurnId));
report.inheritedTurns = checkpointDocument?.settledTurns?.length || 0;
report.sourceCheckpointSha256 = checkpointDocument ? hash(checkpointDocument) : null;
const instance = createTavernWorldRuntimeV27(seed, {
  characterIds, pacingMode, openingAfterSeconds: Number(arg("--opening-seconds", "900")),
  positions: pacingMode === "scene" ? TAVERN_SCENE_POSITIONS : Object.fromEntries(characterIds.map(id => [id, "hall"])),
  worldId: "world:xyy:tavern:v27:pi-model-sim20", enableDayPlanning: true,
  characterAgentCallMode: callMode, maxStageProtocolRepairs, checkpoint,
  async onExecutionCheckpoint() {
    await save("latest-world-checkpoint.json", await instance.runtime.checkpoint());
    await save("model-checkpoint.json", await pool.checkpoint());
  },
  async runStage(input, options) {
    if (warming && input.phase === "awaiting_character_day_planning") {
      const names = { char_xyy_xiezenshi: "xiezenshi_plan.json", char_xyy_luozhao: "luozhao_plan_v2.json", char_xyy_zhoumin: "zhoumin_plan_v2.json" };
      const file = path.resolve(preconditionsDir, names[input.characterId]);
      const text = await readFile(file, "utf8");
      report.warmups.push({ characterId: input.characterId, sourceFile: file, sha256: hash(text) });
      return { dayPlan: JSON.parse(text), stage: { provider: "recorded-precondition", elapsedMs: 0 } };
    }
    assert.ok(!warming, "unexpected action before fixed day plans finish");
    if (!simulation) assert.ok(!["awaiting_character_day_planning", "awaiting_character_reflection"].includes(input.phase), "benchmark expects two complete action turns");
    if (dryRun) {
      await save("first-stage-input.json", input);
      report.firstStageInputSha256 = hash(input);
      throw Object.assign(new Error("Prepared without a model call"), { code: "BENCHMARK_PREPARED" });
    }
    assert.ok(report.calls.length < maxRequests, "hard request limit");
    const at = performance.now();
    const call = { index: report.calls.length + 1, turnIndex, characterId: input.characterId, agentTurnId: input.agentTurnId,
      phase: input.phase, repair: !!input.protocolRepairFeedback, inputSha256: hash(input),
      handoffSincePreviousReturnMs: previousReturnAt == null ? null : at - previousReturnAt,
      progress: [], accepted: null, stageEnteredAt: new Date().toISOString() };
    activeCall = call;
    report.calls.push(call);
    await save(`calls/${String(call.index).padStart(3, "0")}.input.json`, input);
    try {
      return await pool.runStage(input, { ...options, requestBudget, signal: AbortSignal.timeout(600_000) });
    } finally {
      call.stageMs = performance.now() - at;
      call.providerOverheadMs = call.stageMs - (call.invocationMs || 0);
      previousReturnAt = performance.now();
      activeCall = null;
      await save("report.json", report);
    }
  },
  async onStageAccepted() { const last = report.calls.at(-1); if (last) last.accepted = true; },
  async onStageRejected(event) {
    const last = report.calls.at(-1); if (last) last.accepted = false;
    report.rejections.push({ turnIndex, ...event });
    log({ type: "protocol_rejected", turnIndex, phase: event.phase, issues: event.issues });
  },
});
report.pacingMode = instance.coordinator.worldState.timePolicy?.mode || "day";
report.characterIds = [...instance.characterIds];
report.sceneDeadlines = (instance.coordinator.worldState.temporalAgenda || []).map(row => ({ id: row.id, dueAtSeconds: row.dueAtSeconds }));
log({ type: "run_started", outputDir, model, reasoningEffort, callMode, promptFormat, pacingMode: report.pacingMode, requestedActionTurns, requestedTurns, dryRun });
try {
  if (warming) {
    for (let i = 0; i < 3; i++) {
      const turn = await instance.runtime.runNext();
      assert.equal(projectTavernV27TurnForObserver(turn, seed.characters).turnKind, "day_planning");
    }
  }
  const initial = await instance.runtime.checkpoint();
  initialTurnIds = new Set((initial.completedTurnRecords || []).map(row => row.agentTurnId));
  await save("initial-checkpoint.json", initial);
  report.initialCheckpointSha256 = hash(initial);
  report.sourceCheckpoint = checkpointFile;
  warming = false;
  for (turnIndex = 1; turnIndex <= requestedTurns; turnIndex++) {
    const at = performance.now(), firstCall = report.calls.length;
    const turn = await instance.runtime.runNext();
    if (!turn) { report.status = "stopped"; break; }
    const observation = projectTavernV27TurnForObserver(turn, seed.characters);
    if (!simulation) assert.equal(observation.turnKind, "action");
    const calls = report.calls.slice(firstCall);
    assert.ok(calls.every(call => call.outputFile), "completed turns must not contain a missing provider return");
    assert.ok(calls.length > 0 || observation.turnKind === "reflection" || turn.privateResult?.stages?.length,
      "actions and day plans require actual model returns; a reflection with aged-out sources may settle without a model");
    const elapsedMs = performance.now() - at;
    const invocationMs = calls.reduce((sum, call) => sum + call.invocationMs, 0);
    report.turns.push({ index: turnIndex, elapsedMs, invocationMs, otherMs: elapsedMs - invocationMs,
      hasWorldAttempt: Boolean(turn.actionAttempt), hasWorldOutcome: Boolean(turn.outcome),
      hasFreshModelOutput: calls.length > 0, observation, callIndexes: calls.map(call => call.index) });
    updateCounts();
    await save("latest-world-checkpoint.json", await instance.runtime.checkpoint());
    await save("model-checkpoint.json", await pool.checkpoint());
    await save("report.json", report);
    log({ type: simulation ? "turn_complete" : "action_complete", index: turnIndex, turnKind: observation.turnKind,
      elapsedMs, calls: calls.length, otherMs: elapsedMs - invocationMs,
      characterName: observation.characterName, publicRealization: observation.publicRealization, outcome: observation.outcome?.status });
  }
  if (report.status === "running") report.status = "complete";
} catch (error) {
  report.status = error.code === "BENCHMARK_PREPARED" ? "prepared" : "failed";
  report.error = { code: error.code, message: error.message };
  if (report.status === "failed") process.exitCode = 1;
} finally {
  const finalCheckpoint = await instance.runtime.checkpoint();
  report.settledTurns = reconcileSettledTurnRecords(finalCheckpoint).filter(row => !initialTurnIds.has(row.agentTurnId))
    .map((row, index) => ({ ...row, index: index + 1 }));
  report.summary = summarizeSettledSimulation({ checkpoint: finalCheckpoint, turns: report.settledTurns,
    requestedTurns, calls: report.calls, runtimeError: report.status === "failed" ? report.error : null });
  report.stopReason = report.status === "prepared" ? null : report.summary.stopReason;
  report.completionMeaning = "run_turn_budget_only";
  await save("latest-world-checkpoint.json", finalCheckpoint);
  await save("model-checkpoint.json", await pool.checkpoint());
  await writeFile(path.join(outputDir, "simulation-report.md"), renderSettledSimulationReport(report.settledTurns, { kind: "codex-cli-requested-model", ...report.provenance }, report.summary), { mode: 0o600 });
  updateCounts();
  report.elapsedMs = performance.now() - start;
  report.finishedAt = new Date().toISOString();
  report.requestBudget = modelRequestBudgetSnapshot(requestBudget);
  await save("report.json", report);
  await pool.close();
  for (const actor of instance.runtime.actors.values()) await actor.close();
  log({ type: "run_finished", status: report.status, completedActionTurns: report.counts.actionTurns,
    stopReason: report.stopReason,
    counts: report.counts, calls: report.calls.length, outputDir, error: report.error });
}
