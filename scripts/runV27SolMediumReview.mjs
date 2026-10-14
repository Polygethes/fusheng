// Explicitly authorized, real-model acceptance run. Never part of npm test.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createV27CharacterModelProvider } from "../src/server/v27CharacterModelProvider.mjs";
import { executeCodexTrustedBlindProbeInvocation } from "../src/server/ecology/codexTrustedBlindProbeChannel.mjs";
import { createTavernV27SessionAdapter } from "../src/server/pipeline/tavernV27SessionAdapter.mjs";
import { createFileWorldRuntimeSessionRepository } from "../src/server/simulation/worldRuntimeSessionRepository.mjs";
import {
  createTavernV27CharacterModelSessionStageFactory,
  createTavernV27PersistentModelSessionHttpHandler,
  projectTavernV27PersistentModelExecution,
} from "../src/server/pipeline/tavernV27PersistentModelSession.mjs";

if (!process.argv.includes("--run")) {
  console.log("Pass --run only after authorizing 10 real gpt-5.6-sol / medium actor turns (30 requests initially; up to 40 including resumed failures).");
  process.exit(0);
}
const MODEL = "gpt-5.6-sol";
const EFFORT = "medium";
const TURN_LIMIT = 10;
const resumeIndex = process.argv.indexOf("--resume");
const resumeDir = resumeIndex >= 0 ? process.argv[resumeIndex + 1] : null;
assert.ok(resumeIndex < 0 || resumeDir, "--resume requires an existing run directory");
const outputDir = resumeDir ? path.resolve(resumeDir) : await mkdtemp(path.join(os.tmpdir(), "gtown-sol-medium-10-turns-"));
const restoredReport = resumeDir ? JSON.parse(await readFile(path.join(outputDir, "report.json"), "utf8")) : null;
const REQUEST_LIMIT = Math.min(40, (restoredReport?.calls.length || 0) + (TURN_LIMIT - (restoredReport?.turns.length || 0)) * 3);
if (restoredReport) {
  assert.equal(restoredReport.status, "failed", "Only a stopped failed run can resume");
  assert.equal(restoredReport.model, MODEL);
  assert.equal(restoredReport.reasoningEffort, EFFORT);
  assert.ok(restoredReport.turns.length < TURN_LIMIT);
}
await mkdir(path.join(outputDir, "model-outputs"), { mode: 0o700, recursive: true });
const startedAt = performance.now();
const initialElapsedMs = restoredReport?.elapsedMs || 0;
const report = restoredReport || {
  schemaVersion: 1, status: "running", startedAt: new Date().toISOString(),
  model: MODEL, reasoningEffort: EFFORT, transport: "codex-cli", authentication: "saved-chatgpt-login",
  requestedActorTurns: TURN_LIMIT, maxProviderRequests: REQUEST_LIMIT, characterAgentCallMode: "two-call",
  enableDayPlanning: true, outputDir, calls: [], turns: [], rejections: [], failures: [],
  scenario: "Production v27 model-page start: Luo Zhao at threshold, Xie Zhenshi in hall; no scripted replies.",
};
if (restoredReport) {
  report.resumptions = [...(report.resumptions || []), {
    resumedAt: new Date().toISOString(), completedActorTurns: report.turns.length,
    previousError: report.error, providerRequestsAlreadyUsed: report.calls.length,
  }];
  report.status = "running";
  report.maxProviderRequests = REQUEST_LIMIT;
  delete report.error;
  delete report.finishedAt;
}
let activeStage = null;
let currentTurn = 0;
async function saveReport() {
  report.elapsedMs = initialElapsedMs + Math.round(performance.now() - startedAt);
  await writeFile(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
}
function log(event) { console.log(JSON.stringify(event)); }
async function execute(invocation, options) {
  assert.equal(invocation.model, MODEL);
  assert.equal(invocation.reasoningEffort, EFFORT);
  if (report.calls.length >= REQUEST_LIMIT) throw new Error("Authorized provider request budget exhausted");
  const call = {
    index: report.calls.length + 1, turn: currentTurn, ...activeStage,
    model: invocation.model, reasoningEffort: invocation.reasoningEffort,
    sessionOperation: invocation.sessionOperation, startedAt: new Date().toISOString(),
    promptBytes: Buffer.byteLength(invocation.stdin), accepted: null,
  };
  report.calls.push(call);
  await saveReport();
  log({ type: "model-call-start", ...call });
  const start = performance.now();
  try {
    const result = await executeCodexTrustedBlindProbeInvocation(invocation, options);
    call.elapsedMs = Math.round(performance.now() - start);
    call.exitCode = result.exitCode;
    const outputFile = `model-outputs/${String(call.index).padStart(3, "0")}.json`;
    const raw = await readFile(invocation.outputPath, "utf8");
    await writeFile(path.join(outputDir, outputFile), raw, { mode: 0o600 });
    call.outputFile = outputFile;
    // Preserve final structured output and usage; never expose model reasoning logs.
    for (const line of result.stdout.split("\n")) {
      try {
        const event = JSON.parse(line);
        if (event.type === "turn.completed") call.usage = event.usage;
      } catch { /* CLI diagnostics are not structured final output. */ }
    }
    log({ type: "model-call-complete", index: call.index, turn: currentTurn, elapsedMs: call.elapsedMs, usage: call.usage });
    return result;
  } catch (error) {
    call.elapsedMs = Math.round(performance.now() - start);
    call.error = { code: error.code, message: error.message, exitCode: error.exitCode };
    call.providerErrors = String(error.stdout || "").split("\n").flatMap(line => {
      try {
        const event = JSON.parse(line);
        return ["error", "turn.failed"].includes(event.type) ? [event] : [];
      } catch { return []; }
    });
    log({ type: "model-call-failed", index: call.index, error: call.error, providerErrors: call.providerErrors });
    if (error.stderr) await writeFile(path.join(outputDir, `call-${call.index}.stderr.txt`), error.stderr, { mode: 0o600 });
    throw error;
  } finally { await saveReport(); }
}
const stageFactory = createTavernV27CharacterModelSessionStageFactory({
  model: MODEL, maxProviderRequestsPerCommand: 3,
  providerPortFactory: () => {
    const provider = createV27CharacterModelProvider({ transport: "codex-cli", model: MODEL, reasoningEffort: EFFORT }, { tempRoot: outputDir, execute });
    return { ...provider, async runStage(handle, input, context) {
      activeStage = { characterId: input.characterId, agentTurnId: input.agentTurnId, phase: input.phase };
      try { return await provider.runStage(handle, input, context); } finally { activeStage = null; }
    } };
  },
  async onStageAccepted() { if (report.calls.length) report.calls.at(-1).accepted = true; await saveReport(); },
  async onStageRejected(event) {
    if (report.calls.length) report.calls.at(-1).accepted = false;
    report.rejections.push({ turn: currentTurn, ...event });
    log({ type: "protocol-rejection", turn: currentTurn, phase: event.phase, issues: event.issues });
    await saveReport();
  },
});
const repository = createFileWorldRuntimeSessionRepository({ rootDir: path.join(outputDir, "sessions") });
const adapter = createTavernV27SessionAdapter({
  repository, stageRunnerFactory: stageFactory, enableDayPlanning: true, maxStageProtocolRepairs: 1,
  characterAgentCallMode: "two-call", projectExecutionMetadata: projectTavernV27PersistentModelExecution,
  fixtureStageFactory: () => { throw new Error("Fixture fallback is forbidden in real-model acceptance"); },
  stateFactory: () => ({
    state: buildPlayableWorldFromSetup({
      setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
      setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
    }),
    characterIds: ["char_xyy_xiezenshi", "char_xyy_luozhao"],
    positions: { char_xyy_xiezenshi: "hall", char_xyy_luozhao: "threshold" },
    initialWake: { characterId: "char_xyy_luozhao", kind: "opportunity_window" },
  }),
});
const handle = createTavernV27PersistentModelSessionHttpHandler({ adapter, model: MODEL });
const key = { projectId: "sol-medium-acceptance", branchId: "branch-main", runtimeId: `tavern-v27-model:${path.basename(outputDir)}` };
// Continue the latest durable revision in place, including a failed command's
// recovery reference. Never restore/fork an older mutable provider conversation.
let previous = [...report.turns.map(row => row.response), ...report.failures.map(row => row.response)]
  .filter(response => response?.sessionRef && Number.isInteger(response.sessionRevision))
  .sort((a, b) => b.sessionRevision - a.sessionRevision)[0] || null;
log({ type: "run-start", outputDir, model: MODEL, reasoningEffort: EFFORT, actorTurns: TURN_LIMIT });
try {
  for (currentTurn = report.turns.length + 1; currentTurn <= TURN_LIMIT; currentTurn += 1) {
    const begin = performance.now();
    const response = await handle({ operation: previous ? "continue" : "start", body: {
      ...key, sessionId: previous?.sessionRef.sessionId || "", expectedRevision: previous?.sessionRevision || 0,
      commandId: `sol-medium-turn-${currentTurn}${report.resumptions?.length ? `-retry-${report.resumptions.length}` : ""}`,
      authorizationAcknowledged: true, maxProviderRequests: 3,
    } });
    if (response.status !== 200) {
      report.failures.push({ turn: currentTurn, status: response.status, response: response.body });
      throw new Error(`Turn ${currentTurn} failed: ${response.body.code || response.status}: ${response.body.error}`);
    }
    assert.equal(response.body.externalModelCalled, true, "Every accepted turn must have a real model call");
    assert.equal(response.body.observation.turns.length, 1);
    previous = response.body;
    const turn = { index: currentTurn, elapsedMs: Math.round(performance.now() - begin), response: response.body };
    report.turns.push(turn);
    report.sessionRef = { ...previous.sessionRef, sessionRevision: previous.sessionRevision, worldVersion: previous.worldVersion };
    await saveReport();
    log({ type: "actor-turn-complete", index: currentTurn, elapsedMs: turn.elapsedMs, modelRequests: previous.providerRequestBudget.usedProviderRequests, observation: previous.observation.turns[0] });
  }
  report.status = "complete";
} catch (error) {
  report.status = "failed";
  report.error = { code: error.code, message: error.message };
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await saveReport();
  log({ type: "run-finished", status: report.status, completedActorTurns: report.turns.length, providerRequests: report.calls.length, elapsedMs: report.elapsedMs, reportPath: path.join(outputDir, "report.json"), error: report.error });
}
