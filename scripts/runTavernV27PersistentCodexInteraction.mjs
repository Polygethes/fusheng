import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  auditCodexTrustedTavernCharacterAgentV2Input,
} from "../src/server/ecology/codexTrustedTavernCharacterAgentV2Channel.mjs";
import { createCodexTrustedCharacterModelProvider } from
  "../src/server/ecology/codexTrustedCharacterModelProvider.mjs";
import { createSubagentCharacterModelProvider } from
  "../src/server/ecology/subagentCharacterModelProvider.mjs";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import {
  createTavernV27CharacterModelSessionStageFactory,
  projectTavernV27PersistentModelExecution,
} from "../src/server/pipeline/tavernV27PersistentModelSession.mjs";
import { createTavernV27SessionAdapter } from "../src/server/pipeline/tavernV27SessionAdapter.mjs";
import { createFileWorldRuntimeSessionRepository } from "../src/server/simulation/worldRuntimeSessionRepository.mjs";

const XIE = "char_xyy_xiezenshi";
const LUO = "char_xyy_luozhao";
const MODEL = String(process.env.GTOWN_V27_CODEX_MODEL || "gpt-5.6-sol").trim();
const REASONING_EFFORT = String(process.env.GTOWN_V27_CODEX_REASONING_EFFORT || "medium").trim();
const TARGET_ACTOR_TURNS = Number.parseInt(String(process.env.GTOWN_V27_CODEX_ACTOR_TURNS || "20"), 10);
const REQUESTS_PER_ACTOR_TURN = Number.parseInt(
  String(process.env.GTOWN_V27_CODEX_REQUESTS_PER_ACTOR_TURN || "5"),
  10,
);
const THEORETICAL_PROVIDER_REQUEST_LIMIT = TARGET_ACTOR_TURNS * REQUESTS_PER_ACTOR_TURN;
const AUTHORIZATION_TOTAL_PROVIDER_REQUEST_LIMIT = Number.parseInt(
  String(process.env.GTOWN_V27_CODEX_AUTHORIZATION_TOTAL_REQUEST_LIMIT || THEORETICAL_PROVIDER_REQUEST_LIMIT),
  10,
);
const AUTHORIZATION_PRIOR_PROVIDER_REQUESTS = Number.parseInt(
  String(process.env.GTOWN_V27_CODEX_AUTHORIZATION_PRIOR_REQUESTS || "0"),
  10,
);
const AUTHORIZATION_REMAINING_PROVIDER_REQUEST_LIMIT = AUTHORIZATION_TOTAL_PROVIDER_REQUEST_LIMIT
  - AUTHORIZATION_PRIOR_PROVIDER_REQUESTS;
const SUBAGENT_EXCHANGE_ROOT = String(process.env.GTOWN_V27_SUBAGENT_EXCHANGE || "").trim();
const DRY_RUN = process.env.GTOWN_V27_CODEX_DRY_RUN === "1";
const REPLAY_ONLY = process.env.GTOWN_V27_CODEX_REPLAY_ONLY === "1";
const AUTHORIZED = process.env.GTOWN_V27_CODEX_AUTHORIZED === "1";
const ENABLE_DAY_PLANNING = process.env.GTOWN_V27_CODEX_ENABLE_DAY_PLANNING !== "0";
const REPORT_PATH = path.resolve(
  process.env.GTOWN_V27_CODEX_REPORT_PATH
    || path.join(os.tmpdir(), "gtown-v27-persistent-codex-interaction-latest.json"),
);
const REPLAY_REPORT_PATH = cleanPath(process.env.GTOWN_V27_CODEX_REPLAY_REPORT);
const RESUME_SESSION_RECORD_PATH = cleanPath(process.env.GTOWN_V27_CODEX_RESUME_SESSION_RECORD);
const RESUME_COMPLETED_ACTOR_TURNS = Number.parseInt(
  String(process.env.GTOWN_V27_CODEX_RESUME_COMPLETED_ACTOR_TURNS || "0"),
  10,
);
const CHECKPOINT_REPORT_PATH = cleanPath(
  process.env.GTOWN_V27_CODEX_CHECKPOINT_REPORT
  || `${REPORT_PATH}.checkpoint.json`,
);
const REPLAY_ACCEPTED_STAGE_LIMIT_RAW = String(process.env.GTOWN_V27_CODEX_REPLAY_ACCEPTED_STAGE_LIMIT || "").trim();
const REPLAY_ACCEPTED_STAGE_LIMIT = REPLAY_ACCEPTED_STAGE_LIMIT_RAW
  ? Number.parseInt(REPLAY_ACCEPTED_STAGE_LIMIT_RAW, 10)
  : Number.POSITIVE_INFINITY;

function cleanPath(value = "") {
  const source = String(value || "").trim();
  return source ? path.resolve(source) : "";
}

if (!Number.isInteger(TARGET_ACTOR_TURNS) || TARGET_ACTOR_TURNS < 1 || TARGET_ACTOR_TURNS > 20) {
  throw new RangeError("GTOWN_V27_CODEX_ACTOR_TURNS must be an integer from 1 through 20.");
}
if (!Number.isInteger(REQUESTS_PER_ACTOR_TURN)
  || REQUESTS_PER_ACTOR_TURN < 4
  || REQUESTS_PER_ACTOR_TURN > 5) {
  throw new RangeError("GTOWN_V27_CODEX_REQUESTS_PER_ACTOR_TURN must be 4 or 5.");
}
if (!Number.isInteger(AUTHORIZATION_TOTAL_PROVIDER_REQUEST_LIMIT)
  || AUTHORIZATION_TOTAL_PROVIDER_REQUEST_LIMIT < 1
  || AUTHORIZATION_TOTAL_PROVIDER_REQUEST_LIMIT > THEORETICAL_PROVIDER_REQUEST_LIMIT) {
  throw new RangeError("GTOWN_V27_CODEX_AUTHORIZATION_TOTAL_REQUEST_LIMIT must be within this run's theoretical request limit.");
}
if (!Number.isInteger(AUTHORIZATION_PRIOR_PROVIDER_REQUESTS)
  || AUTHORIZATION_PRIOR_PROVIDER_REQUESTS < 0
  || AUTHORIZATION_PRIOR_PROVIDER_REQUESTS >= AUTHORIZATION_TOTAL_PROVIDER_REQUEST_LIMIT) {
  throw new RangeError("GTOWN_V27_CODEX_AUTHORIZATION_PRIOR_REQUESTS must be non-negative and below the authorization total.");
}
if (!DRY_RUN && !REPLAY_ONLY && !AUTHORIZED) {
  const error = new Error("Real trusted-channel execution requires GTOWN_V27_CODEX_AUTHORIZED=1.");
  error.code = "TAVERN_V27_CODEX_EXPLICIT_AUTHORIZATION_REQUIRED";
  throw error;
}
if (!Number.isInteger(RESUME_COMPLETED_ACTOR_TURNS)
  || RESUME_COMPLETED_ACTOR_TURNS < 0
  || RESUME_COMPLETED_ACTOR_TURNS >= TARGET_ACTOR_TURNS) {
  if (RESUME_SESSION_RECORD_PATH || RESUME_COMPLETED_ACTOR_TURNS !== 0) {
    throw new RangeError("A resumed run requires 0 <= GTOWN_V27_CODEX_RESUME_COMPLETED_ACTOR_TURNS < target actor turns.");
  }
}
if (!(REPLAY_ACCEPTED_STAGE_LIMIT === Number.POSITIVE_INFINITY
  || (Number.isInteger(REPLAY_ACCEPTED_STAGE_LIMIT) && REPLAY_ACCEPTED_STAGE_LIMIT >= 0))) {
  throw new RangeError("GTOWN_V27_CODEX_REPLAY_ACCEPTED_STAGE_LIMIT must be a non-negative integer when provided.");
}

const runId = `v27-codex-${Date.now()}`;
const replayReport = REPLAY_REPORT_PATH
  ? JSON.parse(await fs.readFile(REPLAY_REPORT_PATH, "utf8"))
  : null;
const resumeSessionRecord = RESUME_SESSION_RECORD_PATH
  ? JSON.parse(await fs.readFile(RESUME_SESSION_RECORD_PATH, "utf8"))
  : null;
if (Boolean(resumeSessionRecord) !== (RESUME_COMPLETED_ACTOR_TURNS > 0)) {
  throw new Error("Resume session record and completed actor-turn count must be supplied together.");
}
if (replayReport) {
  if (replayReport.configuration?.model !== MODEL
    || replayReport.configuration?.reasoningEffort !== REASONING_EFFORT
    || Number(replayReport.counters?.actorTurnsCompleted || 0) < RESUME_COMPLETED_ACTOR_TURNS) {
    throw new Error("Replay report model, reasoning effort, or completed actor-turn coverage does not match this run.");
  }
}
const replaySourceStageCalls = replayReport?.stageCalls || [];
const replayHasExplicitAcceptance = replaySourceStageCalls
  .some((call) => typeof call?.accepted === "boolean");
const replayableStageCalls = replaySourceStageCalls
  .filter((call) => call?.output && !call?.error
    && (replayHasExplicitAcceptance ? call.accepted === true : true))
  .slice(0, REPLAY_ACCEPTED_STAGE_LIMIT);
if (REPLAY_ONLY || (replayableStageCalls.length && !resumeSessionRecord)) {
  const error = new Error(
    "Accepted stage outputs cannot recreate the private provider conversation. Resume from a durable session record containing CharacterModel provider checkpoints.",
  );
  error.code = "TAVERN_V27_CODEX_REPLAY_CONVERSATION_UNAVAILABLE";
  throw error;
}
if (resumeSessionRecord && !DRY_RUN) {
  const modelSessions = resumeSessionRecord.checkpoint?.characterModelSessions?.sessions;
  const resumable = Array.isArray(modelSessions) && modelSessions.length > 0
    && modelSessions.every((row) => (
      clean(row?.characterId)
      && clean(row?.providerConversationId)
      && clean(row?.providerCheckpoint?.privateState?.codexThreadId)
    ));
  if (!resumable) {
    const error = new Error(
      "Durable resume record does not contain restorable private Codex CharacterModel conversations.",
    );
    error.code = "TAVERN_V27_CODEX_RESUME_PROVIDER_CHECKPOINT_REQUIRED";
    throw error;
  }
}
const priorProviderRequestsAttempted = Number(replayReport?.counters?.providerRequestsAttempted || 0);
if (resumeSessionRecord && priorProviderRequestsAttempted !== AUTHORIZATION_PRIOR_PROVIDER_REQUESTS) {
  throw new RangeError("Resume authorization prior-request count must exactly match the replay report.");
}
if (priorProviderRequestsAttempted > AUTHORIZATION_TOTAL_PROVIDER_REQUEST_LIMIT) {
  throw new RangeError("Replay report has already exceeded this authorization's cumulative provider request limit.");
}
// A durable CharacterModel checkpoint is the only continuation authority.
// Historical accepted outputs remain report evidence and are never injected
// into a fresh provider conversation.
const sessionRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gtown-v27-persistent-codex-session-"));
const replayAuthorReviewTurns = replayReport?.authorReviewTurns || replayReport?.visibleExchange || [];
const baselineAuthorReviewTurns = resumeSessionRecord
  ? cloneBeforeDeclaration(replayAuthorReviewTurns).slice(0, RESUME_COMPLETED_ACTOR_TURNS)
  : [];
const baselineActorTurnCounts = baselineAuthorReviewTurns.reduce((counts, turn) => {
  const characterId = String(turn?.characterId || "").trim();
  if (characterId) counts[characterId] = Number(counts[characterId] || 0) + 1;
  return counts;
}, { [XIE]: 0, [LUO]: 0 });
const report = {
  schemaVersion: "tavern-v27-persistent-codex-interaction-report-v2",
  visibility: "author-review-private",
  runId,
  status: "running",
  startedAt: new Date().toISOString(),
  completedAt: "",
  configuration: {
    dryRun: DRY_RUN,
    replayOnly: REPLAY_ONLY,
    enableDayPlanning: ENABLE_DAY_PLANNING,
    model: MODEL,
    reasoningEffort: REASONING_EFFORT,
    targetActorTurns: TARGET_ACTOR_TURNS,
    targetActorTurnPairs: Math.floor(TARGET_ACTOR_TURNS / 2),
    requestsPerActorTurn: REQUESTS_PER_ACTOR_TURN,
    totalProviderRequestLimit: AUTHORIZATION_TOTAL_PROVIDER_REQUEST_LIMIT,
    theoreticalProviderRequestLimit: THEORETICAL_PROVIDER_REQUEST_LIMIT,
    authorizationTotalProviderRequestLimit: AUTHORIZATION_TOTAL_PROVIDER_REQUEST_LIMIT,
    authorizationPriorProviderRequests: AUTHORIZATION_PRIOR_PROVIDER_REQUESTS,
    authorizationRemainingProviderRequestLimit: AUTHORIZATION_REMAINING_PROVIDER_REQUEST_LIMIT,
    replaySource: REPLAY_REPORT_PATH || "",
    resumeSessionRecordSource: RESUME_SESSION_RECORD_PATH || "",
    resumeCompletedActorTurns: RESUME_COMPLETED_ACTOR_TURNS,
    checkpointReport: CHECKPOINT_REPORT_PATH,
    replayAcceptedStageLimit: Number.isFinite(REPLAY_ACCEPTED_STAGE_LIMIT)
      ? REPLAY_ACCEPTED_STAGE_LIMIT
      : null,
    replayableAcceptedStageCount: replayableStageCalls.length,
    dataBoundary: "isolated Xie Zhenshi and Luo Zhao foundations, private continuity, relationships, psychology, and recipient-specific tavern projection",
  },
  counters: {
    actorTurnsCompleted: RESUME_COMPLETED_ACTOR_TURNS,
    actorTurnPairsCompleted: Math.floor(RESUME_COMPLETED_ACTOR_TURNS / 2),
    ...dialogueCountersForVisibleExchange(baselineAuthorReviewTurns),
    providerRequestsAttempted: priorProviderRequestsAttempted,
    replayedAcceptedStages: 0,
    protocolRepairs: 0,
  },
  actorTurnCounts: baselineActorTurnCounts,
  commands: resumeSessionRecord
    ? cloneBeforeDeclaration(replayReport?.commands || []).slice(0, RESUME_COMPLETED_ACTOR_TURNS)
      .map((row) => ({ ...row, restoredBaseline: true }))
    : [],
  stageCalls: [],
  authorReviewTurns: baselineAuthorReviewTurns,
  publicExchange: baselineAuthorReviewTurns.map(publicTurnProjection),
  stopReason: "",
  failure: null,
};

function cloneBeforeDeclaration(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function auditTrustedStageInput(input = {}) {
  if (clean(input.phase) !== "awaiting_agent_turn_commit") {
    return auditCodexTrustedTavernCharacterAgentV2Input(input);
  }
  const valid = Boolean(
    clean(input.characterId)
    && clean(input.agentTurnId)
    && clean(input.requestedOutput) === "character_turn_commit_only",
  );
  return {
    valid,
    errors: valid ? [] : [{
      code: "V2_ATOMIC_COMMIT_STAGE_INVALID",
      path: "stageInput",
      message: "Atomic commit stage is missing its character, turn, or requested output identity.",
    }],
    serializedBytes: Buffer.byteLength(JSON.stringify(input), "utf8"),
  };
}

function diagnosticTail(value = "", maxLength = 4_000) {
  const source = String(value || "");
  return source.length <= maxLength ? source : source.slice(source.length - maxLength);
}

function stageOutput(result = {}, phase = "") {
  if (phase === "awaiting_character_day_planning") return result.dayPlan || null;
  if (phase === "awaiting_character_reflection") return result.reflection || null;
  if (phase === "awaiting_subjective_appraisal") return result.appraisal || null;
  if (phase === "awaiting_agent_candidates") return result.candidates || null;
  if (phase === "awaiting_agent_choice_and_regulation") return result.choice || null;
  if (phase === "awaiting_agent_expression_planning") return result.expressionPlan || null;
  if (phase === "awaiting_agent_realization") return result.realization || null;
  if (phase === "awaiting_agent_turn_commit") return result.turnCommit || null;
  return null;
}

function visibleTurn(turn = {}, commandIndex = 0) {
  return {
    commandIndex,
    characterId: clean(turn.characterId),
    characterName: clean(turn.characterName),
    agentTurnId: clean(turn.agentTurnId),
    wakeKind: clean(turn.wakeKind),
    turnKind: clean(turn.turnKind || "action"),
    submissionMode: clean(turn.submissionMode),
    characterAgentCompleted: turn.characterAgentCompleted === true,
    protocolRepairCount: Number(turn.protocolRepairCount || 0),
    publicRealization: clone(turn.publicRealization || {}),
    observerOnlyPsychology: clone(turn.observerOnlyPsychology || {}),
    outcome: clone(turn.outcome || null),
  };
}

function publicTurnProjection(turn = {}) {
  return {
    commandIndex: Number(turn.commandIndex || 0),
    characterId: clean(turn.characterId),
    characterName: clean(turn.characterName),
    turnKind: clean(turn.turnKind || "action"),
    publicRealization: clone(turn.publicRealization || {}),
    outcome: turn.outcome ? {
      primitive: clean(turn.outcome.primitive),
      status: clean(turn.outcome.status),
      worldVersion: Number(turn.outcome.worldVersion || 0),
      durationSeconds: Number(turn.outcome.durationSeconds || 0),
    } : null,
  };
}

function conversationProvenanceForVisibleTurn(turn = {}) {
  const rows = [
    ...(turn.outcome?.committedFacts || []),
    ...(turn.outcome?.attemptSurface || []),
  ];
  return rows.find((row) => clean(row?.provenance?.sourceThreadId))?.provenance || {};
}

function dialogueCountersForVisibleExchange(turns = []) {
  const spokenTurns = (turns || []).filter((turn) => clean(turn?.publicRealization?.speech));
  const provenanceRows = spokenTurns.map(conversationProvenanceForVisibleTurn);
  return {
    spokenTurnsCompleted: spokenTurns.length,
    causalSpeechRepliesCompleted: provenanceRows.filter((row) => clean(row?.responseToTurnId)).length,
    conversationThreadsObserved: new Set(
      provenanceRows.map((row) => clean(row?.sourceThreadId)).filter(Boolean),
    ).size,
  };
}

function markLatestMatchingStage(event = {}, accepted = false) {
  const matching = [...report.stageCalls].reverse().find((call) => (
    clean(call.characterId) === clean(event.characterId)
    && clean(call.agentTurnId) === clean(event.agentTurnId)
    && clean(call.phase) === clean(event.phase)
    && typeof call.accepted !== "boolean"
  ));
  if (!matching) return;
  matching.accepted = accepted;
  if (!accepted) matching.protocolIssues = clone(event.issues || []);
}

async function writeReport() {
  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  const temporary = `${REPORT_PATH}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, REPORT_PATH);
}

async function writeCheckpointRecord(record = {}) {
  if (!CHECKPOINT_REPORT_PATH) return;
  await fs.mkdir(path.dirname(CHECKPOINT_REPORT_PATH), { recursive: true });
  const temporary = `${CHECKPOINT_REPORT_PATH}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, CHECKPOINT_REPORT_PATH);
}

function sameSessionKey(left = {}, right = {}) {
  return ["projectId", "branchId", "runtimeId"]
    .every((field) => clean(left?.[field]) === clean(right?.[field]));
}

function createSeededMemoryRepository(seedRecord = {}) {
  let current = clone(seedRecord);
  return {
    schemaVersion: "seeded-memory-session-repository-v1",
    async load(key = {}) {
      return sameSessionKey(current?.key, key) ? clone(current) : null;
    },
    async createIfAbsent(key = {}) {
      return { created: false, record: sameSessionKey(current?.key, key) ? clone(current) : null };
    },
    async compareAndSwap(key = {}, { expectedSessionRevision, nextRecord = {} } = {}) {
      if (!sameSessionKey(current?.key, key)) throw new Error("Seeded resume repository key mismatch.");
      if (Number(current.sessionRevision) !== Number(expectedSessionRevision)) {
        const error = new Error("Seeded resume repository revision conflict.");
        error.code = "WORLD_RUNTIME_SESSION_REVISION_CONFLICT";
        throw error;
      }
      current = {
        ...clone(nextRecord),
        schemaVersion: current.schemaVersion,
        key: clone(current.key),
        sessionRevision: Number(expectedSessionRevision) + 1,
      };
      await writeCheckpointRecord(current);
      return clone(current);
    },
  };
}

function seedEnvelope() {
  return {
    state: buildPlayableWorldFromSetup({
      setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
      setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
    }),
    characterIds: [XIE, LUO],
    positions: { [XIE]: "hall", [LUO]: "threshold" },
    initialWake: { characterId: LUO, kind: "opportunity_window" },
  };
}

function dryStageFactory({ purpose } = {}) {
  if (purpose !== "command") return null;
  const fixture = createTavernV27FixtureStageRunner();
  let stageInvocations = 0;
  return {
    async runStage(input, options) {
      stageInvocations += 1;
      const audit = auditTrustedStageInput(input);
      if (!audit.valid) {
        const error = new Error("Dry-run stage input failed trusted-channel isolation audit.");
        error.code = "TAVERN_V27_CODEX_INPUT_AUDIT_FAILED";
        error.issues = audit.errors;
        throw error;
      }
      const result = await fixture(input, options);
      report.stageCalls.push({
        callIndex: report.stageCalls.length + 1,
        executionMode: "local-dry-run",
        characterId: clean(input.characterId),
        agentTurnId: clean(input.agentTurnId),
        phase: clean(input.phase),
        repairAttempt: input.protocolRepairFeedback ? 1 : 0,
        inputAudit: { valid: true, serializedBytes: audit.serializedBytes },
        output: clone(stageOutput(result, input.phase)),
        stage: clone(result.stage || null),
        accepted: null,
      });
      await writeReport();
      return result;
    },
    async onStageAccepted(event = {}) {
      markLatestMatchingStage(event, true);
      await writeReport();
    },
    async onStageRejected(event = {}) {
      markLatestMatchingStage(event, false);
      await writeReport();
    },
    publicMetadata: () => ({
      mode: "persistent-local-dry-run",
      externalModelCalled: false,
      model: "local-fixture",
      stageInvocations,
      providerRequestBudget: {
        maxProviderRequests: REQUESTS_PER_ACTOR_TURN,
        usedProviderRequests: 0,
        remainingProviderRequests: REQUESTS_PER_ACTOR_TURN,
      },
      protocolRepairEvents: [],
      authorQualityVerdict: "not_claimed",
    }),
  };
}

const trustedStageFactory = createTavernV27CharacterModelSessionStageFactory({
  model: MODEL,
  onStageAccepted: async (event = {}) => {
    markLatestMatchingStage(event, true);
    await writeReport();
  },
  onStageRejected: async (event = {}) => {
    markLatestMatchingStage(event, false);
    await writeReport();
  },
  providerPortFactory: ({ model }) => {
    const provider = SUBAGENT_EXCHANGE_ROOT
      ? createSubagentCharacterModelProvider({
        model,
        reasoningEffort: REASONING_EFFORT,
        exchangeRoot: SUBAGENT_EXCHANGE_ROOT,
      })
      : createCodexTrustedCharacterModelProvider({
        model,
        reasoningEffort: REASONING_EFFORT,
        tempRoot: sessionRoot,
      });
    return {
      ...provider,
      async runStage(handle, input, context = {}) {
        const audit = auditTrustedStageInput(input);
        if (!audit.valid) {
          const error = new Error("Stage input failed trusted-channel isolation audit before external execution.");
          error.code = "TAVERN_V27_CODEX_INPUT_AUDIT_FAILED";
          error.issues = audit.errors;
          throw error;
        }
        if (report.counters.providerRequestsAttempted >= AUTHORIZATION_TOTAL_PROVIDER_REQUEST_LIMIT) {
          const error = new RangeError(`Cumulative provider request limit ${AUTHORIZATION_TOTAL_PROVIDER_REQUEST_LIMIT} reached.`);
          error.code = "TAVERN_V27_CODEX_TOTAL_REQUEST_LIMIT_REACHED";
          throw error;
        }
        report.counters.providerRequestsAttempted += 1;
        const call = {
          callIndex: report.stageCalls.length + 1,
          executionMode: "trusted-codex-persistent-character-session",
          characterId: clean(input.characterId),
          agentTurnId: clean(input.agentTurnId),
          phase: clean(input.phase),
          repairAttempt: input.protocolRepairFeedback ? 1 : 0,
          inputAudit: { valid: true, serializedBytes: audit.serializedBytes },
          output: null,
          stage: null,
          error: null,
          accepted: null,
        };
        report.stageCalls.push(call);
        await writeReport();
        process.stdout.write(`stage local=${call.callIndex} cumulative=${report.counters.providerRequestsAttempted}/${AUTHORIZATION_TOTAL_PROVIDER_REQUEST_LIMIT} ${call.characterId} ${call.phase}${call.repairAttempt ? " repair" : ""}\n`);
        try {
          const result = await provider.runStage(handle, input, context);
          call.output = clone(stageOutput(result, input.phase));
          call.stage = clone(result.stage || null);
          await writeReport();
          return result;
        } catch (error) {
          call.error = {
            code: clean(error?.code || "CODEX_TRUSTED_STAGE_FAILED"),
            message: clean(error?.message || error),
            exitCode: error?.exitCode ?? null,
            issues: clone(error?.issues || []),
            stderr: diagnosticTail(error?.stderr),
            stdout: diagnosticTail(error?.stdout),
          };
          await writeReport();
          throw error;
        }
      },
    };
  },
});

try {
  await writeReport();
  if (resumeSessionRecord) await writeCheckpointRecord(resumeSessionRecord);
  const repository = resumeSessionRecord
    ? createSeededMemoryRepository(resumeSessionRecord)
    : createFileWorldRuntimeSessionRepository({ rootDir: sessionRoot });
  const adapter = createTavernV27SessionAdapter({
    repository,
    stateFactory: async () => seedEnvelope(),
    stageRunnerFactory: DRY_RUN ? dryStageFactory : trustedStageFactory,
    maxStageProtocolRepairs: 1,
    enableDayPlanning: ENABLE_DAY_PLANNING,
    projectExecutionMetadata: projectTavernV27PersistentModelExecution,
  });
  const sessionKey = resumeSessionRecord ? clone(resumeSessionRecord.key) : {
    projectId: "project:v27-sol-medium-ten-exchanges",
    branchId: "branch:fixed-xie-luo",
    runtimeId: `tavern-v27-model:${runId}`,
  };
  let sessionId = clean(resumeSessionRecord?.sessionId);
  let expectedSessionRevision = Number(resumeSessionRecord?.sessionRevision || 0);

  for (let commandIndex = RESUME_COMPLETED_ACTOR_TURNS + 1; commandIndex <= TARGET_ACTOR_TURNS; commandIndex += 1) {
    const operation = resumeSessionRecord || commandIndex > 1 ? "continue" : "start";
    const command = {
      commandIndex,
      commandId: `command:${runId}:actor-turn:${commandIndex}`,
      operation,
      expectedSessionRevision,
      status: "running",
      sessionRevision: null,
      worldVersion: null,
      stageInvocations: 0,
      providerRequestsUsed: 0,
      turn: null,
      error: null,
    };
    report.commands.push(command);
    await writeReport();
    process.stdout.write(`actor-turn ${commandIndex}/${TARGET_ACTOR_TURNS} start revision=${expectedSessionRevision}\n`);
    try {
      const response = await adapter.execute({
        operation,
        sessionKey,
        sessionId,
        commandId: command.commandId,
        expectedSessionRevision,
        executionContext: {
          operation,
          authorizationAcknowledged: true,
          authorizationId: `authorization:${runId}:actor-turn:${commandIndex}`,
          model: MODEL,
        },
      });
      const durableRecord = await repository.load(sessionKey);
      if (durableRecord) await writeCheckpointRecord(durableRecord);
      sessionId = response.sessionRef.sessionId;
      expectedSessionRevision = response.sessionRevision;
      const turn = response.observation?.turns?.[0] || null;
      command.status = turn ? "completed" : "quiescent";
      command.sessionRevision = response.sessionRevision;
      command.worldVersion = response.worldVersion;
      command.stageInvocations = Number(response.stageInvocations || 0);
      command.providerRequestsUsed = Number(response.providerRequestBudget?.usedProviderRequests || 0);
      command.turn = turn ? visibleTurn(turn, commandIndex) : null;
      if (!turn) {
        report.stopReason = "world_quiescent_no_ready_character";
        await writeReport();
        process.stdout.write(`actor-turn ${commandIndex}/${TARGET_ACTOR_TURNS} quiescent\n`);
        break;
      }
      report.authorReviewTurns.push(command.turn);
      report.publicExchange.push(publicTurnProjection(command.turn));
      report.counters.actorTurnsCompleted += 1;
      report.counters.actorTurnPairsCompleted = Math.floor(report.counters.actorTurnsCompleted / 2);
      Object.assign(report.counters, dialogueCountersForVisibleExchange(report.authorReviewTurns));
      report.actorTurnCounts[turn.characterId] = Number(report.actorTurnCounts[turn.characterId] || 0) + 1;
      report.counters.protocolRepairs += Number(turn.protocolRepairCount || 0);
      await writeReport();
      process.stdout.write(`actor-turn ${commandIndex}/${TARGET_ACTOR_TURNS} done actor=${turn.characterName} world=${response.worldVersion} requests=${command.providerRequestsUsed}\n`);
    } catch (error) {
      try {
        const durableRecord = await repository.load(sessionKey);
        if (durableRecord) await writeCheckpointRecord(durableRecord);
      } catch {
        // Preserve the original command failure. A missing checkpoint remains
        // visible through the absent checkpoint artifact and cannot authorize
        // a forged provider continuation.
      }
      command.status = "failed";
      const failedExecution = projectTavernV27PersistentModelExecution(error?.publicExecutionMetadata || {});
      command.stageInvocations = Math.max(
        Number(command.stageInvocations || 0),
        Number(failedExecution.stageInvocations || 0),
      );
      command.providerRequestsUsed = Math.max(
        Number(command.providerRequestsUsed || 0),
        Number(failedExecution.providerRequestBudget?.usedProviderRequests || 0),
      );
      command.error = {
        code: clean(error?.code || "TAVERN_V27_CODEX_COMMAND_FAILED"),
        message: clean(error?.message || error),
        issues: clone(error?.issues || []),
        stderr: diagnosticTail(error?.stderr),
        stdout: diagnosticTail(error?.stdout),
        execution: failedExecution,
      };
      report.stopReason = "actor_turn_failed";
      report.failure = { commandIndex, ...clone(command.error) };
      await writeReport();
      throw error;
    }
  }

  if (!report.stopReason) {
    report.stopReason = report.counters.actorTurnsCompleted === TARGET_ACTOR_TURNS
      ? "target_actor_turns_completed"
      : "target_not_reached";
  }
  report.status = report.stopReason === "target_actor_turns_completed"
    ? "author_review_required"
    : "incomplete";
} catch (error) {
  report.status = "execution_failed";
  if (!report.failure) {
    report.failure = {
      code: clean(error?.code || "TAVERN_V27_CODEX_RUN_FAILED"),
      message: clean(error?.message || error),
      issues: clone(error?.issues || []),
    };
  }
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  await writeReport();
  await fs.rm(sessionRoot, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    reportPath: REPORT_PATH,
    actorTurnsCompleted: report.counters.actorTurnsCompleted,
    actorTurnPairsCompleted: report.counters.actorTurnPairsCompleted,
    spokenTurnsCompleted: report.counters.spokenTurnsCompleted,
    causalSpeechRepliesCompleted: report.counters.causalSpeechRepliesCompleted,
    conversationThreadsObserved: report.counters.conversationThreadsObserved,
    providerRequestsAttempted: report.counters.providerRequestsAttempted,
    replayedAcceptedStages: report.counters.replayedAcceptedStages,
    protocolRepairs: report.counters.protocolRepairs,
    actorTurnCounts: report.actorTurnCounts,
    stopReason: report.stopReason,
    failure: report.failure,
  }, null, 2)}\n`);
}
