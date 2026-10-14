/**
 * File bridge for the three-call Character protocol, with bounded repairs and
 * durable stage checkpoints. Replies from an external controller have
 * unverified model provenance and process isolation. Use a new directory or
 * explicitly set TAVERN_V27_BRIDGE_RESUME=1 to continue a saved run.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  createTavernWorldRuntimeV27,
  projectTavernWorldRuntimeV27ForObserver,
} from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import {
  tavernCharacterAgentV2OutputSchemaForStage,
  tavernCharacterAgentV2SystemPrompt,
  tavernCharacterAgentV2UserPrompt,
} from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import { createTavernV27FixtureStageRunner } from
  "../src/server/pipeline/tavernV27FixtureStage.mjs";
import { reconcileSettledTurnRecords, summarizeSettledSimulation } from "../src/server/simulation/settledSimulationReport.mjs";

const XIE_ZHENSHI = "char_xyy_xiezenshi";
const LUO_ZHAO = "char_xyy_luozhao";

const BRIDGE_DIR = process.env.TAVERN_V27_BRIDGE_DIR;
if (!BRIDGE_DIR) {
  console.error("TAVERN_V27_BRIDGE_DIR is required.");
  process.exit(2);
}
const MAX_TURNS = Math.max(1, Number(process.env.TAVERN_V27_BRIDGE_MAX_TURNS || 2));
const MAX_REQUESTS = Math.max(
  1,
  Number(process.env.TAVERN_V27_BRIDGE_MAX_REQUESTS || MAX_TURNS * 5),
);
const STAGE_TIMEOUT_MS = Math.max(60_000, Number(process.env.TAVERN_V27_BRIDGE_STAGE_TIMEOUT_MS || 20 * 60_000));
const LOCAL_FIXTURE = process.env.TAVERN_V27_BRIDGE_LOCAL_FIXTURE === "1";
mkdirSync(BRIDGE_DIR, { recursive: true });
const CHECKPOINT_PATH = path.join(BRIDGE_DIR, "runtime.checkpoint.json");
if (existsSync(CHECKPOINT_PATH) && process.env.TAVERN_V27_BRIDGE_RESUME !== "1") throw new Error("Existing bridge run: use a new directory or explicitly set TAVERN_V27_BRIDGE_RESUME=1.");
const saved = existsSync(CHECKPOINT_PATH) ? JSON.parse(readFileSync(CHECKPOINT_PATH, "utf8")) : null;

const PHASE_MAP = {
  awaiting_subjective_appraisal_and_candidates: ["subjective_appraisal_and_candidates", "appraisalAndCandidates"],
  awaiting_character_day_planning: ["character_day_planning", "dayPlan"],
  awaiting_character_reflection: ["character_reflection", "reflection"],
  awaiting_subjective_appraisal: ["subjective_appraisal", "appraisal"],
  awaiting_agent_candidates: ["agent_candidates", "candidates"],
  awaiting_agent_choice_and_regulation: ["agent_choice_and_regulation", "choice"],
  awaiting_agent_turn_commit: ["agent_turn_commit", "turnCommit"],
};
const localFixtureStage = LOCAL_FIXTURE ? createTavernV27FixtureStageRunner() : null;

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * The operator side reads prompt files with tools that truncate very long
 * lines, so hard-wrap prose lines. Structured JSON is pretty-printed before
 * wrapping, which keeps ids and enum values on short unbroken lines.
 */
function wrapLongLines(text, width = 1800) {
  return String(text).split("\n").map((line) => {
    if (line.length <= width) return line;
    const parts = [];
    for (let index = 0; index < line.length; index += width) parts.push(line.slice(index, index + width));
    return parts.join("\n");
  }).join("\n");
}

let requestIndex = saved?.requestIndex || 0;
const requestLog = saved?.requestLog || [];
const repairEvents = saved?.repairEvents || [];
async function persistRuntime() {
  const checkpoint = await instance.runtime.checkpoint();
  const temporary = `${CHECKPOINT_PATH}.tmp`;
  writeFileSync(temporary, JSON.stringify({ checkpoint, requestIndex, requestLog, repairEvents }), { mode: 0o600 });
  renameSync(temporary, CHECKPOINT_PATH);
}

async function bridgeStage(stageInput) {
  if (requestIndex >= MAX_REQUESTS) {
    const error = new Error(`Stage request budget of ${MAX_REQUESTS} is exhausted.`);
    error.code = "TAVERN_V27_BRIDGE_BUDGET_EXHAUSTED";
    throw error;
  }
  requestIndex += 1;
  const id = String(requestIndex).padStart(3, "0");
  const phaseMapping = PHASE_MAP[stageInput.phase];
  if (!phaseMapping) {
    const error = new Error(`Unsupported atomic Character Agent phase: ${stageInput.phase}`);
    error.code = "TAVERN_V27_BRIDGE_PHASE_UNSUPPORTED";
    throw error;
  }
  const [stageName, outputKey] = phaseMapping;
  const schema = tavernCharacterAgentV2OutputSchemaForStage(stageInput);
  const prompt = wrapLongLines([
    tavernCharacterAgentV2SystemPrompt(stageInput),
    tavernCharacterAgentV2UserPrompt(stageInput),
    "<output_contract>",
    "只输出一个 JSON 对象，必须严格符合以下 JSON Schema：所有 required 字段齐全，枚举取值精确，不允许额外字段。",
    "不要输出 markdown 代码围栏、注释或任何解释文字。",
    JSON.stringify(schema, null, 1),
    "</output_contract>",
  ].join("\n\n"));
  const startedAt = Date.now();
  writeFileSync(path.join(BRIDGE_DIR, `stage-${id}.prompt.txt`), prompt);
  writeFileSync(path.join(BRIDGE_DIR, `stage-${id}.request.json`), JSON.stringify({
    id,
    stage: stageName,
    phase: stageInput.phase,
    characterId: stageInput.characterId,
    agentTurnId: stageInput.agentTurnId,
    stageInput,
    schema,
    repair: Boolean(stageInput.protocolRepairFeedback),
    promptPath: path.join(BRIDGE_DIR, `stage-${id}.prompt.txt`),
  }, null, 2));
  await persistRuntime();
  const responsePath = path.join(BRIDGE_DIR, `stage-${id}.response.json`);
  if (localFixtureStage) {
    const fixtureResult = await localFixtureStage(stageInput, { stage: stageName });
    writeFileSync(responsePath, JSON.stringify(fixtureResult[outputKey], null, 2));
  }
  const deadline = Date.now() + STAGE_TIMEOUT_MS;
  while (!existsSync(responsePath)) {
    if (Date.now() > deadline) {
      const error = new Error(`Stage ${id} response did not arrive within ${STAGE_TIMEOUT_MS}ms.`);
      error.code = "TAVERN_V27_BRIDGE_STAGE_TIMEOUT";
      throw error;
    }
    await sleep(1500);
  }
  await sleep(400);
  const parsed = JSON.parse(readFileSync(responsePath, "utf8"));
  const elapsedMs = Date.now() - startedAt;
  requestLog.push({
    id,
    characterId: stageInput.characterId,
    phase: stageInput.phase,
    repair: Boolean(stageInput.protocolRepairFeedback),
    elapsedMs,
  });
  return {
    [outputKey]: parsed,
    stage: {
      name: `TavernCharacterAgentV2:${stageName}:${stageInput.characterId}`,
      provider: "file-bridge",
      model: LOCAL_FIXTURE ? "local-fixture" : process.env.TAVERN_V27_BRIDGE_MODEL || "external",
      elapsedMs,
    },
  };
}

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});

const instance = createTavernWorldRuntimeV27(state, {
  checkpoint: saved?.checkpoint || null,
  pacingMode: process.env.TAVERN_V27_PACING_MODE || "scene",
  openingAfterSeconds: Number(process.env.TAVERN_V27_OPENING_SECONDS || 900),
  enableDayPlanning: process.env.TAVERN_V27_PACING_MODE !== "day",
  positions: { [XIE_ZHENSHI]: "hall", [LUO_ZHAO]: "hall" },
  worldId: "world:xyy:tavern:v27:file-bridge",
  runStage: bridgeStage,
  maxStageProtocolRepairs: 2,
  onExecutionCheckpoint: persistRuntime,
  onStageRejected: async (event) => {
    repairEvents.push({
      characterId: event.characterId,
      phase: event.phase,
      repairAttempt: event.repairAttempt,
      issues: event.issues,
    });
    writeFileSync(path.join(BRIDGE_DIR, "repairs.json"), JSON.stringify(repairEvents, null, 2));
  },
});

function privateTurnDetail(turn) {
  const decision = turn.privateResult?.worldBridge?.rawDecision || {};
  const selected = turn.privateResult?.worldBridge?.selectedCandidate || {};
  return {
    characterId: turn.characterId,
    agentTurnId: turn.agentTurnId,
    stageInvocations: (turn.privateResult?.stages || []).length,
    selectedIntention: selected.intention || "",
    selectedPrimitive: selected.attemptPrimitive || "",
    actionBinding: selected.actionBinding || null,
    candidateIntentions: (turn.privateResult?.worldBridge?.rawDecision ? (turn.privateResult?.decision?.generatedCandidates || []) : [])
      .map((row) => ({ candidateId: row.candidateId, intention: row.intention, primitive: row.attemptPrimitive })),
    speech: decision.speech || "",
    visibleAction: (turn.outcome?.attemptSurface || []).map(row => row.visibleAction).filter(Boolean).join("；"),
    authoredExpressionDraft: { visibility: "audit-only-unverified-not-a-world-fact", bodyDelta: decision.visibleAction || "" },
    privateDecisionBasis: decision.privateReason || "",
    actionAttempt: decision.actionAttempt || null,
    outcome: turn.outcome ? {
      primitive: turn.outcome.primitive,
      status: turn.outcome.status,
      worldVersion: turn.outcome.worldVersion,
      failedEffects: turn.outcome.failedEffects,
      deliveries: (turn.outcome.deliveries || []).map((row) => ({
        recipientCharacterId: row.recipientCharacterId,
        eventKind: row.eventKind,
        content: row.content,
      })),
    } : null,
  };
}

try {
  if (!saved) await instance.runtime.enqueueWake(XIE_ZHENSHI, {
    wakeId: `wake:tavern-v27:file-bridge:${Date.now()}`,
    kind: "opportunity_window",
    evidenceIds: [],
    evidence: [],
  });
  const turns = await instance.runtime.runUntilIdle({ maxTurns: Math.max(0, MAX_TURNS - (saved?.checkpoint?.completedTurnRecords?.length || 0)) });
  const observer = projectTavernWorldRuntimeV27ForObserver(instance, turns);
  const checkpoint = await instance.runtime.checkpoint();
  const settledTurns = reconcileSettledTurnRecords(checkpoint);
  const summary = summarizeSettledSimulation({ checkpoint, turns: settledTurns, requestedTurns: MAX_TURNS, calls: requestLog });
  const result = {
    status: summary.stopReason === "turn_limit_reached" ? "completed" : "stopped",
    completionMeaning: "run_turn_budget_only",
    summary, settledTurns,
    executionMode: LOCAL_FIXTURE ? "local-fixture-contract" : "external-file-bridge",
    externalModelCalled: LOCAL_FIXTURE ? false : null,
    provenance: { kind: LOCAL_FIXTURE ? "fixture" : "external-unverified", modelVerified: false },
    stageRequests: requestIndex,
    maxRequests: MAX_REQUESTS,
    repairEvents,
    requestLog,
    observer,
    privateTurns: turns.map(privateTurnDetail),
  };
  writeFileSync(path.join(BRIDGE_DIR, "run.result.json"), JSON.stringify(result, null, 2));
  await persistRuntime();
  writeFileSync(path.join(BRIDGE_DIR, "run.done"), `${result.status}\n`);
  console.log(JSON.stringify({ status: result.status, stopReason: summary.stopReason, stageRequests: requestIndex, turns: settledTurns.length }, null, 2));
} catch (error) {
  const failure = {
    status: "failed",
    code: error?.code || "TAVERN_V27_BRIDGE_RUN_FAILED",
    message: String(error?.message || error),
    failedPhase: error?.failedPhase || "",
    characterId: error?.characterId || "",
    issues: (error?.issues || []).map((row) => ({ code: row.code, path: row.path, message: row.message })),
    stageRequests: requestIndex,
    repairEvents,
    requestLog,
  };
  writeFileSync(path.join(BRIDGE_DIR, "run.result.json"), JSON.stringify(failure, null, 2));
  writeFileSync(path.join(BRIDGE_DIR, "run.done"), "failed\n");
  console.error(JSON.stringify(failure, null, 2));
  process.exit(1);
}
