// External-response relay. A receipt proves submission, not model provenance.
// Use the automatic model runner when actual provider-call evidence is required.
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { mkdir, readFile, writeFile, rename, access } from "node:fs/promises";
import path from "node:path";

import { loadWorldPack } from "../src/worlds/registry.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { worldPackDigest } from "../src/worlds/worldPack.mjs";
import {
  createWorldRuntimeV27,
  projectTavernV27TurnForObserver,
} from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { tavernCharacterAgentV2OutputSchemaForStage } from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import { buildV27RelayModelRequest } from "../src/server/pipeline/v27RelayModelRequest.mjs";
import { CHARACTER_STAGE_SUBMISSION_VERSION, characterStageSubmissionContract, prepareCharacterStageSubmission } from "../src/server/simulation/characterStageSubmission.mjs";
import { renderSettledSimulationReport, reconcileSettledTurnRecords, summarizeSettledSimulation } from "../src/server/simulation/settledSimulationReport.mjs";

const PORT = Number(process.env.RELAY_PORT || 8791);
const RESUME_PATH = process.env.RELAY_RESUME_PATH ? path.resolve(process.env.RELAY_RESUME_PATH) : null;
const SAVE_PATH = process.env.RELAY_SAVE_PATH ? path.resolve(process.env.RELAY_SAVE_PATH) : RESUME_PATH
  || path.resolve("sim-runs", `relay-${randomUUID()}`, "world-save.json");
const saved = RESUME_PATH ? JSON.parse(await readFile(RESUME_PATH, "utf8")) : null;
if (saved && (!saved.checkpoint || !Array.isArray(saved.settledTurns))) throw new Error("RELAY_INVALID_SAVE");
if (SAVE_PATH && SAVE_PATH !== RESUME_PATH) {
  // A fresh run must never overwrite an earlier report or the archived evidence.
  try { await access(SAVE_PATH); throw new Error("RELAY_SAVE_EXISTS_USE_A_NEW_PATH_OR_EXPLICIT_RESUME"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
const INPUT_KIND = process.env.RELAY_INPUT_KIND || saved?.provenance?.kind || "external-unverified";
if (!["external-unverified", "fixture"].includes(INPUT_KIND)) throw new Error("RELAY_INVALID_INPUT_KIND");
if (saved?.provenance?.kind && saved.provenance.kind !== INPUT_KIND) throw new Error("RELAY_RESUME_PROVENANCE_MISMATCH");
const RUN_PURPOSE = process.env.RELAY_RUN_PURPOSE || (INPUT_KIND === "fixture" ? "rehearsal" : "real-model");
if (RUN_PURPOSE !== "rehearsal") throw new Error("RELAY_REAL_MODEL_REQUIRES_DIRECT_PROVIDER: Use gemini:simulate for API-authored decisions; external submissions require RELAY_RUN_PURPOSE=rehearsal.");
const provenance = { kind: INPUT_KIND, runPurpose: RUN_PURPOSE, modelVerified: false,
  note: INPUT_KIND === "fixture" ? "Deterministic rehearsal; no real model evidence."
    : "External replies; the relay cannot verify which model or controller authored them." };
let TURN_LIMIT = Number(process.env.RELAY_TURN_LIMIT || saved?.turnLimit || 20);
if (!Number.isSafeInteger(TURN_LIMIT) || TURN_LIMIT < 1) throw new Error("RELAY_INVALID_TURN_LIMIT");
if (TURN_LIMIT < (saved?.settledTurns?.length || 0)) throw new Error("RELAY_TURN_LIMIT_BELOW_SAVED_COUNT");
const WORLD_PACK_ID = process.env.RELAY_WORLD || saved?.worldPackId || "xiaoyaoyou";
if (process.env.RELAY_WORLD && saved?.worldPackId && saved.worldPackId !== process.env.RELAY_WORLD) throw new Error("RELAY_WORLD_PACK_MISMATCH");
const worldPack = await loadWorldPack(WORLD_PACK_ID);
const WORLD_PACK_DIGEST = worldPackDigest(worldPack);
const PACING_MODE = saved?.checkpoint?.coordinator?.worldState?.timePolicy?.mode || process.env.RELAY_PACING_MODE || "scene";
const CHARACTER_IDS = saved?.checkpoint?.actors?.map(row => row.characterId) || (PACING_MODE === "scene" ? [...worldPack.stage.sceneCast] : [
  "char_xyy_xiezenshi",
  "char_xyy_luozhao",
  "char_xyy_zhoumin",
].filter(id => WORLD_PACK_ID === "xiaoyaoyou" || worldPack.stage.sceneCast.includes(id)));

const state = buildPlayableWorldFromPack(worldPack);

const OUTPUT_KEYS = {
  awaiting_character_day_planning: "dayPlan",
  awaiting_character_reflection: "reflection",
  awaiting_subjective_appraisal_and_candidates: "appraisalAndCandidates",
  awaiting_agent_choice_and_turn_commit: "choiceAndTurnCommit",
  awaiting_agent_turn_commit: "turnCommit",
  awaiting_agent_choice_and_regulation: "choice",
  awaiting_agent_expression_planning: "expressionPlan",
  awaiting_agent_realization: "realization",
  awaiting_subjective_appraisal: "appraisal",
  awaiting_agent_candidates: "candidates",
};

let pending = null;
const settledTurns = saved?.settledTurns || [];
const relayErrors = saved?.errors || [];
let halted = saved?.halted === true;
let failure = saved?.failure || null;
const runId = randomUUID();
const startedAt = performance.now();
const stageTimings = saved?.stageTimings || [];
const turnTimings = saved?.turnTimings || [];
const receivedReplies = new Map(saved?.receivedReplies || []);
const preflightRejections = saved?.preflightRejections || [];
let lastRuntimeResumeAt = startedAt;

const runStage = async (stageInput, options = {}) => {
  const stageStartedAt = performance.now();
  const phase = String(stageInput.phase || "");
  const outputKey = OUTPUT_KEYS[phase];
  if (!outputKey) {
    throw new Error(`RELAY_UNKNOWN_PHASE:${phase}`);
  }
  if (pending) throw new Error("RELAY_CONCURRENT_STAGE");
  const stageId = `${runId}:${stageTimings.length + 1}`;
  const schema = tavernCharacterAgentV2OutputSchemaForStage(stageInput);
  const schemaMs = performance.now() - stageStartedAt;
  const payload = {
    stageId,
    characterId: stageInput.characterId,
    agentTurnId: stageInput.agentTurnId,
    phase,
    provenance,
    stage: options.stage || null,
    stageInput,
    protocolRepairFeedback: stageInput.protocolRepairFeedback || null,
    schema,
    submissionContract: characterStageSubmissionContract(stageInput, schema, stageId),
  };
  const archivePath = path.join(`${SAVE_PATH}.stages`, `${runId}-${stageTimings.length + 1}.json`);
  await mkdir(path.dirname(archivePath), { recursive: true });
  await writeFile(archivePath, JSON.stringify({ ...payload, output: null, received: false }), { mode: 0o600 });
  const timing = {
    stageId, characterId: stageInput.characterId, agentTurnId: stageInput.agentTurnId, phase,
    localPreparationMs: stageStartedAt - lastRuntimeResumeAt,
    schemaMs,
    inputBytes: Buffer.byteLength(JSON.stringify(stageInput)),
    schemaBytes: Buffer.byteLength(JSON.stringify(schema)),
    readyAt: new Date().toISOString(), respondedAt: null, responseWaitMs: null,
    validation: "awaiting_output",
    archivePath,
  };
  timing.payloadBuildMs = performance.now() - stageStartedAt;
  const readyAt = performance.now();
  stageTimings.push(timing);
  const wrapOutput = output => ({
    [outputKey]: output,
    stage: {
      name: `ExternalRelay:${phase}:${stageInput.characterId || "unknown"}`,
      provider: INPUT_KIND === "fixture" ? "local-fixture-relay" : "external-unverified-relay",
      provenance,
      elapsedMs: performance.now() - stageStartedAt,
    },
  });
  const response = await new Promise((resolve, reject) => {
    pending = { payload, resolve, reject, timing, readyAt, async capture(output) {
      const response = wrapOutput(output);
      if (options.onResponseReceived) await options.onResponseReceived(response);
      return response;
    } };
  });
  lastRuntimeResumeAt = performance.now();
  return response;
};

function recordValidation(event, validation) {
  const timing = stageTimings.findLast(row => (
    row.agentTurnId === event.agentTurnId && row.phase === event.phase
  ));
  if (timing) {
    timing.validation = validation;
    if (event.issues) timing.issueCodes = event.issues.map(issue => String(issue.code || ""));
  }
}

const instance = createWorldRuntimeV27(state, {
  worldPack,
  checkpoint: saved?.checkpoint || null,
  characterIds: CHARACTER_IDS,
  pacingMode: PACING_MODE,
  openingAfterSeconds: Number(process.env.RELAY_OPENING_SECONDS || 900),
  positions: PACING_MODE === "scene" ? worldPack.stage.scenePositions
    : Object.fromEntries(CHARACTER_IDS.map((id) => [id, worldPack.stage.topology.defaultZoneId])),
  worldId: WORLD_PACK_ID === "xiaoyaoyou" ? "world:xyy:tavern:v27:pi-model-sim20" : `world:${WORLD_PACK_ID}:relay`,
  enableDayPlanning: true,
  characterAgentCallMode: "three-call",
  onExecutionCheckpoint: () => persist(),
  maxStageProtocolRepairs: 2,
  runStage,
  onStageAccepted: event => recordValidation(event, "accepted"),
  onStageRejected: event => recordValidation(event, "rejected"),
});

function compactTurn(turn = {}) {
  const observer = projectTavernV27TurnForObserver(turn, instance.sourceState?.characters || []);
  const outcome = observer.outcome || {};
  const speechEmitted = (turn.outcome?.resolvedEffects || []).some(row => row.kind === "speech_emitted");
  const settledSpeech = speechEmitted ? (turn.outcome?.committedFacts || [])
    .filter(row => row.kind === "utterance_emitted").map(row => String(row.utterance || "")).join("\n") : "";
  return {
    index: settledTurns.length + 1,
    characterName: observer.characterName,
    characterId: observer.characterId,
    turnKind: observer.turnKind,
    wakeKind: observer.wakeKind,
    intention: observer.observerOnlyPsychology?.selectedIntention || "",
    speech: settledSpeech,
    visibleAction: observer.publicRealization?.visibleAction || "",
    outcome: {
      primitive: outcome.primitive || "",
      status: outcome.status || "",
      worldVersion: outcome.worldVersion ?? null,
    },
    agentTurnId: observer.agentTurnId,
    hasWorldAttempt: Boolean(turn.actionAttempt),
    hasWorldOutcome: Boolean(turn.outcome),
    failureCodes: [...new Set((turn.outcome?.failedEffects || []).map(row => row.code).filter(Boolean))],
    resolvedEffectKinds: [...new Set((turn.outcome?.resolvedEffects || []).map(row => row.kind).filter(Boolean))],
    provenance,
  };
}

let persistTail = Promise.resolve();
let lastSummary = null;
function persist() {
  const operation = persistTail.then(persistSnapshot);
  persistTail = operation.catch(() => undefined);
  return operation;
}
async function persistSnapshot() {
  if (!SAVE_PATH) return;
  const checkpoint = await instance.runtime.checkpoint();
  const reconciled = reconcileSettledTurnRecords(checkpoint, settledTurns);
  settledTurns.splice(0, settledTurns.length, ...reconciled);
  const effectiveFailure = failure || (instance.runtime.executionStatus.integrity ? {
    code: instance.runtime.executionStatus.integrity.code,
    message: instance.runtime.executionStatus.integrity.message,
    evidence: instance.runtime.executionStatus.integrity.evidence || null,
  } : null);
  lastSummary = summarizeSettledSimulation({ checkpoint, turns: settledTurns, requestedTurns: TURN_LIMIT,
    calls: stageTimings, runtimeError: effectiveFailure, running: Boolean(pending || pumpPromise) && !halted
      && checkpoint.actors.some(actor => actor.executionControl?.status === "active") });
  await mkdir(path.dirname(SAVE_PATH), { recursive: true });
  const temporary = `${SAVE_PATH}.${runId}.tmp`;
  await writeFile(temporary, JSON.stringify({ schemaVersion: 2, runId, worldPackId: WORLD_PACK_ID, worldPackDigest: WORLD_PACK_DIGEST, turnLimit: TURN_LIMIT,
    provenance, settledTurns, halted, failure: effectiveFailure, summary: lastSummary, errors: relayErrors, preflightRejections, stageTimings, turnTimings, receivedReplies: [...receivedReplies], checkpoint }), { mode: 0o600 });
  await rename(temporary, SAVE_PATH);
  const reportPath = `${SAVE_PATH}.report.md`;
  const reportTemporary = `${reportPath}.${runId}.tmp`;
  await writeFile(reportTemporary, renderSettledSimulationReport(settledTurns, provenance, lastSummary), { mode: 0o600 });
  await rename(reportTemporary, reportPath);
}

function halt(error) {
  halted = true;
  failure = { code: String(error?.code || "RELAY_RUNTIME_ERROR"),
    message: String(error?.message || error).slice(0, 400),
    evidence: error?.evidence || null,
    issues: error?.issues ? JSON.parse(JSON.stringify(error.issues)) : undefined,
    stageId: stageTimings.at(-1)?.stageId || null, at: new Date().toISOString() };
  relayErrors.push(`RUNNEXT_ERROR:${failure.code}:${failure.message}${error?.issues ? ' ISSUES=' + JSON.stringify(error.issues).slice(0, 800) : ''}`);
  console.log(JSON.stringify({ ev: "halt", code: failure.code, issues: failure.issues || null }));
}

let pumpPromise = null;
async function doPump() {
  while (settledTurns.length < TURN_LIMIT && !pending && !halted) {
    const turnStartedAt = performance.now();
    const firstStage = stageTimings.length;
    lastRuntimeResumeAt = turnStartedAt;
    let turnState = "idle";
    try {
      const result = await instance.runtime.runNext();
      if (!result) {
        if (settledTurns.length < TURN_LIMIT) {
          relayErrors.push("RUNNEXT_IDLE:没有就绪的人物回合，世界暂时静止");
        }
        break;
      }
      if (result.privateResult || result.actionAttempt) {
        const record = compactTurn(result);
        const prior = settledTurns.findIndex(row => row.agentTurnId === record.agentTurnId);
        if (prior < 0) settledTurns.push(record);
        else settledTurns[prior] = { ...record, index: prior + 1 };
        turnState = "settled";
        const integrity = instance.runtime.executionStatus.integrity;
        if (integrity) halt(Object.assign(new Error(integrity.message), integrity));
        for (const row of stageTimings.slice(firstStage)) {
          if (row.validation === "submitted") row.validation = "accepted";
        }
      }
    } catch (error) {
      turnState = "error";
      halt(error);
      break;
    } finally {
      const elapsedMs = performance.now() - turnStartedAt;
      const externalWaitMs = stageTimings.slice(firstStage).reduce((sum, row) => sum + (row.responseWaitMs || 0), 0);
      const timing = {
        settledCount: settledTurns.length, state: turnState,
        elapsedMs, externalWaitMs, localElapsedMs: Math.max(0, elapsedMs - externalWaitMs),
        persistenceMs: null,
      };
      turnTimings.push(timing);
      const persistenceStartedAt = performance.now();
      try { await persist(); }
      finally { timing.persistenceMs = performance.now() - persistenceStartedAt; }
    }
  }
}

function schedulePump() {
  // A single pump owns runNext, including all of its awaited model stages.
  // Submitting a reply resumes that pump; it must never enqueue or await another.
  if (pumpPromise || halted) return;
  if ([...instance.runtime.actors.values()].every(actor => actor.executionControl?.status !== "active")) return;
  pumpPromise = doPump().catch((error) => {
    halt(error);
  }).finally(async () => { pumpPromise = null; await persist(); });
}

function pendingSummary() {
  if (!pending) return null;
  const { stageId, characterId, agentTurnId, phase } = pending.payload;
  return { stageId, characterId, agentTurnId, phase,
    waitingMs: performance.now() - pending.readyAt,
    inputBytes: pending.timing.inputBytes, schemaBytes: pending.timing.schemaBytes };
}

function metrics() {
  return {
    runId, elapsedMs: performance.now() - startedAt, provenance, halted,
    failure: failure || (instance.runtime.executionStatus.integrity ? {
      code: instance.runtime.executionStatus.integrity.code,
      message: instance.runtime.executionStatus.integrity.message,
      evidence: instance.runtime.executionStatus.integrity.evidence || null,
    } : null),
    submissionProtocol: CHARACTER_STAGE_SUBMISSION_VERSION,
    measurement: "responseWaitMs includes external model/controller time; localElapsedMs measures runtime/relay work before checkpoint I/O, not pure CPU. persistenceMs is separate; the latest on-disk timing is null until a later save.",
    receivedCount: receivedReplies.size, pending: pendingSummary(),
    preflightRejections,
    stages: stageTimings, turns: turnTimings,
  };
}

const server = http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/report") {
      res.writeHead(200, { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" });
      return res.end(renderSettledSimulationReport(settledTurns, provenance, lastSummary));
    }
    if (req.method === "GET" && url.pathname === "/metrics") return send(200, metrics());
    if (req.method === "GET" && url.pathname === "/pending") {
      return send(200, { pending: url.searchParams.get("format") === "model"
        ? buildV27RelayModelRequest(pending?.payload) : pending?.payload || null });
    }
    if (req.method === "GET" && url.pathname === "/status") {
      return send(200, {
        runId,
        submissionProtocol: CHARACTER_STAGE_SUBMISSION_VERSION,
        provenance,
        halted,
        failure: failure || (instance.runtime.executionStatus.integrity ? {
          code: instance.runtime.executionStatus.integrity.code,
          message: instance.runtime.executionStatus.integrity.message,
          evidence: instance.runtime.executionStatus.integrity.evidence || null,
        } : null),
        settledCount: settledTurns.length,
        turnLimit: TURN_LIMIT,
        actionTurnCount: settledTurns.filter((row) => row.turnKind === "action").length,
        maintenanceTurnCount: settledTurns.filter((row) => row.turnKind !== "action").length,
        worldAttemptCount: settledTurns.filter((row) => row.hasWorldAttempt === true || row.outcome?.status).length,
        worldOutcomeCount: settledTurns.filter((row) => row.hasWorldOutcome === true || row.outcome?.status).length,
        noWorldActionCount: settledTurns.filter((row) => row.turnKind === "action" && row.hasWorldAttempt === false).length,
        unclassifiedActionTurnCount: settledTurns.filter((row) => row.turnKind === "action"
          && typeof row.hasWorldAttempt !== "boolean" && !row.outcome?.status).length,
        complete: false,
        budgetReached: settledTurns.length >= TURN_LIMIT,
        qualityVerdict: "not_evaluated",
        runPurpose: RUN_PURPOSE,
        completionMeaning: "run_turn_budget_only",
        stopReason: instance.runtime.executionStatus.integrity?.stopReason || (halted ? "runtime_error" : settledTurns.length >= TURN_LIMIT ? "turn_limit_reached" : pending || pumpPromise ? null : instance.runtime.executionStatus.status),
        execution: instance.runtime.executionStatus,
        settledTurns,
        errors: relayErrors,
        preflightRejectedCount: preflightRejections.length,
        pending: url.searchParams.get("compact") === "1" ? pendingSummary() : pending?.payload || null,
      });
    }
    if (req.method === "POST" && url.pathname === "/extend") {
      if (halted) return send(409, { ok: false, error: "RELAY_HALTED", failure });
      if (["suspended_model_error", "stalled", "stalled_no_progress"].includes(instance.runtime.executionStatus.status)) return send(409, { ok: false, error: "RELAY_EXECUTION_SUSPENDED", execution: instance.runtime.executionStatus });
      let body = "";
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body || "{}");
      const requested = Number(parsed.limit);
      if (!Number.isSafeInteger(requested) || requested < TURN_LIMIT) {
        return send(400, { ok: false, error: "INVALID_TURN_LIMIT" });
      }
      TURN_LIMIT = requested;
      setImmediate(schedulePump);
      return send(202, { ok: true, turnLimit: TURN_LIMIT, settledCount: settledTurns.length });
    }
    if (req.method === "POST" && ["/respond", "/validate"].includes(url.pathname)) {
      let body = "";
      for await (const chunk of req) body += chunk;
      let envelope;
      try { envelope = JSON.parse(body); } catch { return send(400, { ok: false, error: "BAD_JSON" }); }
      const stageId = envelope?.stageId;
      if (typeof stageId !== "string" || !stageId || !Object.hasOwn(envelope, "output")) {
        return send(400, { ok: false, error: "STAGE_ID_AND_OUTPUT_REQUIRED" });
      }
      const { output } = envelope;
      if (envelope.source?.kind === "fixture" && INPUT_KIND !== "fixture") {
        return send(400, { ok: false, error: "FIXTURE_OUTPUT_REQUIRES_FIXTURE_RELAY" });
      }
      const digest = createHash("sha256").update(JSON.stringify(output)).digest("hex");
      if (receivedReplies.has(stageId)) {
        if (url.pathname === "/validate") return send(409, { ok: false, received: false, error: "STAGE_ALREADY_RECEIVED", stageId });
        if (receivedReplies.get(stageId) !== digest) return send(409, { ok: false, error: "STAGE_OUTPUT_CONFLICT", stageId });
        return send(200, { ok: true, received: true, duplicate: true, stageId });
      }
      // Read the entire request first, then match the current invocation. Two
      // concurrent bodies must not capture the same resolve or consume its successor.
      if (pending?.payload.stageId !== stageId) {
        return send(409, { ok: false, error: "STALE_STAGE", stageId, pendingStageId: pending?.payload.stageId || null });
      }
      const current = pending;
      const checked = prepareCharacterStageSubmission(current.payload.stageInput, output, current.payload.schema);
      if (!checked.valid) {
        const rejection = { stageId, phase: current.payload.phase, at: new Date().toISOString(),
          issues: checked.issues.slice(0, 32) };
        if (url.pathname === "/respond") {
          preflightRejections.push(rejection);
          if (preflightRejections.length > 200) preflightRejections.shift();
        }
        if (url.pathname === "/validate") return send(422, { ok: false, received: false, error: "STAGE_OUTPUT_INVALID", ...rejection,
          submissionContract: current.payload.submissionContract,
          retry: "Validation is read-only. Submit an authored response to consume this stage." });
      }
      if (url.pathname === "/validate") return send(200, { ok: true, valid: true, received: false, stageId,
        filledMetadata: checked.filledMetadata });
      receivedReplies.set(stageId, digest);
      current.timing.respondedAt = new Date().toISOString();
      current.timing.responseWaitMs = performance.now() - current.readyAt;
      current.timing.validation = "submitted";
      pending = null;
      let captured;
      try {
        const temporary = `${current.timing.archivePath}.tmp`;
        await writeFile(temporary, JSON.stringify({ ...current.payload, output, received: true, receivedAt: current.timing.respondedAt,
          preflightValid: checked.valid, issues: checked.issues || [] }), { mode: 0o600 });
        await rename(temporary, current.timing.archivePath);
        captured = await current.capture(checked.valid ? checked.output : output);
        await persist();
      } catch (error) {
        current.reject(error);
        throw error;
      }
      // Acknowledge receipt before running validation or waiting for another
      // Character Agent. Domain acceptance remains visible in /metrics.
      setImmediate(() => current.resolve(captured));
      if (!checked.valid) return send(422, { ok: false, received: true, error: "STAGE_OUTPUT_INVALID", stageId,
        issues: checked.issues.slice(0, 32), retry: "This response consumes a bounded repair attempt. Read the next pending stage; do not reuse this stageId with different content." });
      return send(202, { ok: true, received: true, duplicate: false, stageId, filledMetadata: checked.filledMetadata });
    }
    send(404, { ok: false });
  } catch (error) {
    send(500, { ok: false, error: String(error?.stack || error).slice(0, 800) });
  }
});

// Persist the restored/initial state before advertising readiness, including a
// completed or halted run that will not enter the pump at startup.
await persist();
server.listen(PORT, "127.0.0.1", () => {
  console.log(`relay listening on http://127.0.0.1:${server.address().port}`);
  console.log(`durable save: ${SAVE_PATH}`);
});
schedulePump();
