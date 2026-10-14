import path from "node:path";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { loadWorldPack } from "../src/worlds/registry.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { worldPackDigest } from "../src/worlds/worldPack.mjs";
import { createFreshWorldSave } from "../src/worlds/freshWorld.mjs";
import { tavernCharacterAgentV2OutputSchemaForStage } from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import { authorizeCharacterTurnRetry } from "../src/server/simulation/characterTurnExecution.mjs";
import { reconcileSettledTurnRecords, summarizeSettledSimulation, renderSettledSimulationReport } from "../src/server/simulation/settledSimulationReport.mjs";
import { callGeminiCharacterStage } from "../src/server/ecology/geminiCharacterStage.mjs";
import { resolveCallMode } from "../src/worlds/callMode.mjs";
import { createWorldEventQueue } from "../src/server/simulation/worldEventQueue.mjs";
import { withGatewayWaits } from "../src/server/model/gatewayWait.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const source = arg("--resume"), output = arg("--out"), authorizationId = arg("--retry-authorization", "");
const worldArg = arg("--world");
const requestedTurns = Number(arg("--turns", "10")), maxRequests = Number(arg("--max-requests", "60"));
const maxRepairs = Number(arg("--repairs", "2"));
const dryRun = args.includes("--dry-run"), model = arg("--model", "gemini-3.8-flash");
const requestedCallMode = arg("--call-mode", "");
const wire = arg("--wire", "canonical");
if (wire !== "canonical" && wire !== "compact") {
  throw new Error(`Invalid --wire "${wire}". Must be "canonical" or "compact".`);
}
if (args.includes("--probe")) {
  const key = process.env.GEMINI_API_KEY;
  const base = process.env.GEMINI_API_BASE_URL?.replace(/\/+$/u, "");
  if (!key || !base || !output) throw new Error("Probe requires a configured gateway, key and --out FILE.");
  const body = { model, messages: [{ role: "user", content: 'Return only the JSON object {"ok":true}.' }], max_tokens: 128, stream: false };
  if (args.includes("--json-mode")) body.response_format = { type: "json_object" };
  const response = await fetch(`${base.endsWith("/v1") ? base : `${base}/v1`}/chat/completions`, {
    method: "POST", redirect: "error", headers: { "content-type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  const raw = (await response.text()).replaceAll(key, "<REDACTED>");
  const result = { httpStatus: response.status, requestedModel: model, raw: JSON.parse(raw) };
  await writeFile(path.resolve(output), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(result));
  process.exit(response.ok ? 0 : 1);
}
if (!(source || worldArg) || !output || !Number.isSafeInteger(requestedTurns) || requestedTurns < 1
  || !Number.isSafeInteger(maxRequests) || maxRequests < 1) throw new Error("Require --world ID or --resume FILE, --out NEW_DIRECTORY, and positive --turns and --max-requests.");
if (!dryRun && !process.env.GEMINI_API_KEY) throw new Error("Set GEMINI_API_KEY in the process environment; no credential is stored by this runner.");
let sourceText, inherited;
if (source) {
  sourceText = await readFile(path.resolve(source), "utf8");
  inherited = JSON.parse(sourceText);
} else {
  inherited = (await createFreshWorldSave(await loadWorldPack(worldArg), { runId: path.basename(path.resolve(output)) })).save;
  sourceText = JSON.stringify(inherited);
}
const worldPackId = worldArg || inherited.worldPackId || "xiaoyaoyou";
if (worldArg && inherited.worldPackId && inherited.worldPackId !== worldArg) {
  throw Object.assign(new Error(`The save belongs to world ${inherited.worldPackId}, not ${worldArg}.`), { code: "WORLD_PACK_MISMATCH" });
}
const worldPack = await loadWorldPack(worldPackId);
const callMode = resolveCallMode({ scale: worldPack.meta?.scale, requested: requestedCallMode, fallback: "three-call" });
const currentDigest = worldPackDigest(worldPack);
const worldPackDigestChanged = Boolean(inherited.worldPackDigest) && inherited.worldPackDigest !== currentDigest;
if (worldPackDigestChanged) console.warn(JSON.stringify({ event: "world_pack_revised", worldPackId, from: inherited.worldPackDigest, to: currentDigest }));
const checkpoint = structuredClone(inherited.checkpoint || inherited);
if (!checkpoint.coordinator || !checkpoint.actors?.length) throw new Error("Invalid source checkpoint.");
const outputDir = path.resolve(output);
await mkdir(outputDir, { mode: 0o700 }); // refuse to overwrite another run
await mkdir(path.join(outputDir, "calls"), { mode: 0o700 });
let saveSequence = 0;
const save = async (name, value) => {
  const file = path.join(outputDir, name), temporary = `${file}.${++saveSequence}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(temporary, file);
};
const report = { status: "running", requestedModel: model, requestedTurns, maxRequests,
  maxStageProtocolRepairs: maxRepairs,
  turnCounting: "character-turns-including-planning-and-reflection", source: source ? path.resolve(source) : `fresh-world:${worldPackId}`,
  worldPackId, worldPackDigest: currentDigest, worldPackDigestChanged, callMode, wire,
  sourceSha256: createHash("sha256").update(sourceText).digest("hex"), startedAt: new Date().toISOString(),
  provenance: { kind: process.env.GEMINI_API_BASE_URL ? "user-specified-gemini-api" : "google-gemini-api",
    endpoint: process.env.GEMINI_API_BASE_URL || "https://generativelanguage.googleapis.com", requestedModel: model,
    runPurpose: "real-model", fixtureFallback: false, inheritedModelVerified: false }, calls: [], rejections: [], recoveredActors: [] };
for (const actor of checkpoint.actors) {
  const execution = actor.runtimeCheckpoint?.adapterState?.inFlightTurn?.executionCheckpoint;
  if (execution && execution.status !== "stages_accepted" && !actor.pendingTurn) {
    if (!authorizationId) throw new Error("An unfinished decision needs --retry-authorization to rebind its repaired contract or retry a suspended model.");
    actor.runtimeCheckpoint.adapterState.inFlightTurn.executionCheckpoint = authorizeCharacterTurnRetry(execution, {
      authorizationId, reason: "User requested contract repairs and continuation with Gemini API", additionalCalls: Math.min(10, 3 + maxRepairs), additionalRepairs: maxRepairs });
    actor.executionControl.status = "active";
    actor.executionControl.reason = null;
    checkpoint.readyQueue = [...new Set([...(checkpoint.readyQueue || []), actor.characterId])];
    report.recoveredActors.push({ characterId: actor.characterId, agentTurnId: execution.agentTurnId, acceptedStagesPreserved: execution.acceptedStages.map(row => row.stage) });
  } else if (actor.executionControl?.status === "stalled") {
    if (authorizationId) {
      actor.executionControl.status = "active";
      actor.executionControl.reason = null;
      checkpoint.readyQueue = [...new Set([...(checkpoint.readyQueue || []), actor.characterId])];
      report.recoveredActors.push({ characterId: actor.characterId, resumedFromStalled: true });
    }
  }
}
await save("initial-checkpoint.json", checkpoint);
const previous = reconcileSettledTurnRecords(checkpoint, inherited.settledTurns || []);
const initialIds = new Set(previous.map(row => row.agentTurnId));
const seed = buildPlayableWorldFromPack(worldPack);
let instance, activeCall;
const priorStageOutputs = new Map();
for (const actor of checkpoint.actors) {
  const execution = actor.runtimeCheckpoint?.adapterState?.inFlightTurn?.executionCheckpoint;
  const prior = execution?.currentStage || execution?.retryAuthorizations?.at(-1)?.priorStage;
  if (prior?.input?.phase && (prior.response || prior.rejectedModelText)) {
    const key = `${actor.characterId}|${execution.agentTurnId}|${prior.input.phase}`;
    const outputKey = { subjective_appraisal_and_candidates: "appraisalAndCandidates", agent_choice_and_regulation: "choice", agent_turn_commit: "turnCommit" }[prior.stage];
    if (prior.rejectedModelText) priorStageOutputs.set(key, prior.rejectedModelText);
    else if (outputKey && prior.response[outputKey]) priorStageOutputs.set(key, prior.response[outputKey]);
  }
}
const persist = async () => {
  if (!instance) return;
  const current = await instance.runtime.checkpoint();
  const settledTurns = reconcileSettledTurnRecords(current, previous);
  await save(dryRun ? "prepared-world-save.json" : "world-save.json", {
    schemaVersion: 1, worldPackId, worldPackDigest: currentDigest, checkpoint: current, settledTurns, provenance: { kind: "mixed-history", inherited: inherited.provenance || null, continuation: report.provenance },
    summary: summarizeSettledSimulation({ checkpoint: current, turns: settledTurns, calls: report.calls, running: report.status === "running" }) });
  await save("report.json", report);
};
// An operator stop (SIGTERM/SIGINT from the observer or a terminal) ends the
// run after the current turn has settled and been saved.
let stopRequested = false;
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => {
  if (!stopRequested) console.log(JSON.stringify({ event: "stop_requested", signal }));
  stopRequested = true;
});
instance = createWorldRuntimeV27(seed, { worldPack, checkpoint, characterIds: checkpoint.actors.map(row => row.characterId),
  worldId: checkpoint.coordinator.worldId,
  // Performance beats carry the scene themselves; coarse day planning is a
  // separate heavy protocol and only runs in three-call mode.
  pacingMode: checkpoint.coordinator.worldState.timePolicy?.mode || "scene", enableDayPlanning: callMode === "three-call" || worldPack.meta?.scale === "town",
  characterAgentCallMode: callMode, maxStageProtocolRepairs: maxRepairs,
  onExecutionCheckpoint: persist,
  onStageAccepted() { if (activeCall) activeCall.accepted = true; },
  onStageRejected(event) { if (activeCall) activeCall.accepted = false; report.rejections.push(event); },
  async runStage(input) {
    if (dryRun) {
      await save("first-stage.json", { input, schema: input.prompt ? input.schema : tavernCharacterAgentV2OutputSchemaForStage(input) });
      throw Object.assign(new Error("Prepared without a model request."), { code: "SIMULATION_PREPARED" });
    }
    const stageKey = `${input.characterId}|${input.agentTurnId}|${input.phase}`;
    // A gateway that is down is waited out; every retry is a new request with its own
    // record and counts against the budget.
    return withGatewayWaits(async (round) => {
      if (report.calls.length >= maxRequests) throw Object.assign(new Error("API request budget reached."), { code: "GEMINI_REQUEST_BUDGET_EXHAUSTED" });
      const call = { index: report.calls.length + 1, characterId: input.characterId, agentTurnId: input.agentTurnId,
        phase: input.phase, accepted: null, startedAt: new Date().toISOString(), ...(round ? { gatewayRetry: round } : {}) };
      activeCall = call; report.calls.push(call);
      const stem = `calls/${String(call.index).padStart(3, "0")}`;
      await save(`${stem}.input.json`, input);
      console.log(JSON.stringify({ event: "request_started", ...call, model }));
      try {
        const result = await callGeminiCharacterStage(input, { model, responseFormat: arg("--response-format", "json_schema"),
          wire,
          previousOutput: priorStageOutputs.get(stageKey) ?? null,
          onRequest: request => save(`${stem}.request.json`, request),
          async onResponse(response) {
            call.elapsedMs = response.elapsedMs; call.httpStatus = response.httpStatus;
            call.attempts = response.attempts;
            call.returnedModel = response.raw.modelVersion || response.raw.model || null; call.usage = response.raw.usageMetadata || response.raw.usage || null;
            await save(`${stem}.response.json`, response);
          } });
        await save(`${stem}.output.json`, result);
        const outputKey = Object.keys(result).find(key => key !== "stage");
        priorStageOutputs.set(stageKey, structuredClone(result[outputKey]));
        return result;
      } catch (error) {
        if (error.attempts) call.attempts = error.attempts;
        if (error.code === "CHARACTER_STAGE_OUTPUT_INVALID" && typeof error.rawOutput === "string") priorStageOutputs.set(stageKey, error.rawOutput);
        throw error;
      } finally {
        console.log(JSON.stringify({ event: "request_finished", index: call.index, elapsedMs: call.elapsedMs ?? null, attempts: call.attempts?.length ?? null }));
        await save("report.json", report);
      }
    }, {
      shouldStop: () => stopRequested,
      onWait: ({ round, rounds, waitSeconds, until }) => console.log(JSON.stringify({ event: "gateway_wait", round, rounds, waitSeconds, until })),
    });
  } });
// 天意: events the player queued for this run are settled before each turn.
const worldEvents = createWorldEventQueue({ dir: outputDir, runtime: instance.runtime, log: (row) => console.log(JSON.stringify(row)) });
try {
  let decisions = 0;
  for (let count = 0; decisions < requestedTurns && count < requestedTurns * 50; count++) {
    if (stopRequested) { report.status = "stopped_by_operator"; break; }
    if (await worldEvents.applyQueued()) await persist();
    const turn = await instance.runtime.runNext();
    if (!turn) { report.status = "stopped"; break; }
    if (turn.privateResult?.turnKind !== "own_plan_step") decisions += 1;
    console.log(JSON.stringify({ event: "turn_settled", index: previous.length + count + 1, characterId: turn.characterId, status: turn.outcome?.status || turn.privateResult?.turnKind,
      ownPlanStep: turn.privateResult?.turnKind === "own_plan_step" }));
    await persist();
    const integrity = instance.runtime.executionStatus.integrity;
    if (integrity) throw Object.assign(new Error(integrity.message), integrity);
  }
  if (report.status === "running") report.status = "turn_limit_reached";
} catch (error) {
  // A stop while waiting out a silent gateway is an ordinary operator stop.
  if (error.code === "STOPPED_WHILE_WAITING") {
    report.status = "stopped_by_operator";
  } else {
    report.status = error.code === "SIMULATION_PREPARED" ? "prepared" : "failed";
    report.error = { evidence: error.evidence || null, code: error.code || "ERROR", message: String(error.message).replaceAll(process.env.GEMINI_API_KEY || "\0", "<REDACTED>") };
    if (report.status === "failed") process.exitCode = 1;
  }
} finally {
  const final = await instance.runtime.checkpoint();
  report.newTurns = reconcileSettledTurnRecords(final).filter(row => !initialIds.has(row.agentTurnId));
  report.summary = summarizeSettledSimulation({ checkpoint: final, turns: report.newTurns, requestedTurns, calls: report.calls,
    runtimeError: report.status === "failed" ? report.error : null });
  report.finishedAt = new Date().toISOString();
  await persist();
  await writeFile(path.join(outputDir, "simulation-report.md"), renderSettledSimulationReport(report.newTurns, report.provenance, report.summary), { mode: 0o600 });
  for (const actor of instance.runtime.actors.values()) await actor.close();
  console.log(JSON.stringify({ event: "run_finished", status: report.status, newTurns: report.newTurns.length, requests: report.calls.length, outputDir, error: report.error }));
}
