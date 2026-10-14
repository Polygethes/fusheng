import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createOpenAIJsonCharacterModelProvider } from
  "../src/server/ecology/openAIJsonCharacterModelProvider.mjs";
import { createTavernV27FixtureStageRunner } from
  "../src/server/pipeline/tavernV27FixtureStage.mjs";
import {
  createTavernV27CharacterModelSessionStageFactory,
  createTavernV27PersistentModelSessionHttpHandler,
  projectTavernV27PersistentModelExecution,
} from "../src/server/pipeline/tavernV27PersistentModelSession.mjs";
import { createTavernV27SessionAdapter } from
  "../src/server/pipeline/tavernV27SessionAdapter.mjs";
import { reserveModelProviderRequest } from
  "../src/server/pipeline/modelRequestBudget.mjs";
import { createFileWorldRuntimeSessionRepository } from
  "../src/server/simulation/worldRuntimeSessionRepository.mjs";

const XIE = "char_xyy_xiezenshi";
const LUO = "char_xyy_luozhao";
const FIXED_PROVIDER_DELAY_MS = 75;
const DESIRED_MAX_SERIAL_PROVIDER_CALLS = 1;
const CLI_SAMPLES = 3;

const STAGE_BY_PHASE = Object.freeze({
  awaiting_subjective_appraisal: "subjective_appraisal",
  awaiting_agent_candidates: "agent_candidates",
  awaiting_agent_choice_and_regulation: "agent_choice_and_regulation",
  awaiting_agent_turn_commit: "agent_turn_commit",
});

const OUTPUT_KEY_BY_PHASE = Object.freeze({
  awaiting_subjective_appraisal: "appraisal",
  awaiting_agent_candidates: "candidates",
  awaiting_agent_choice_and_regulation: "choice",
  awaiting_agent_turn_commit: "turnCommit",
});

function round(value) {
  return Math.round(Number(value) * 10) / 10;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function firstJsonObject(value = "") {
  const source = String(value || "");
  const start = source.indexOf("{");
  if (start < 0) throw new SyntaxError("provider request did not contain a JSON object");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && (depth -= 1) === 0) {
      return JSON.parse(source.slice(start, index + 1));
    }
  }
  throw new SyntaxError("provider request JSON object was incomplete");
}

function seedEnvelope() {
  return {
    state: buildPlayableWorldFromSetup({
      setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
      setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
    }),
    characterIds: [XIE, LUO],
    positions: { [XIE]: "hall", [LUO]: "hall" },
    initialWake: { characterId: XIE, kind: "opportunity_window" },
  };
}

function startRequest() {
  return {
    operation: "start",
    body: {
      projectId: "project:latency-diagnostic",
      branchId: "branch:main",
      runtimeId: "tavern-v27-model:latency-diagnostic",
      commandId: "command:latency-diagnostic:start",
      sessionId: "",
      expectedRevision: 0,
      authorizationAcknowledged: true,
    },
  };
}

function percentile50(values = []) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return round(sorted[Math.floor(sorted.length / 2)]);
}

function measureCliProcessFloor(args) {
  const samplesMs = [];
  for (let index = 0; index < CLI_SAMPLES; index += 1) {
    const startedAt = performance.now();
    const result = spawnSync("codex", args, {
      stdio: "ignore",
      timeout: 5_000,
    });
    const elapsedMs = performance.now() - startedAt;
    if (result.error || result.status !== 0) {
      return {
        available: false,
        sampleCount: samplesMs.length,
        failureKind: result.error?.code || `exit-${result.status}`,
      };
    }
    samplesMs.push(round(elapsedMs));
  }
  return {
    available: true,
    sampleCount: samplesMs.length,
    medianMs: percentile50(samplesMs),
    minMs: round(Math.min(...samplesMs)),
    maxMs: round(Math.max(...samplesMs)),
  };
}

function cliProcessFloor() {
  const start = measureCliProcessFloor(["exec", "--help"]);
  const resume = measureCliProcessFloor(["exec", "resume", "--help"]);
  const usable = start.available && resume.available;
  return {
    measurement: "local-process-and-argument-parsing-lower-bound-only",
    start,
    resume,
    estimatedNewConversationFourStageFloorMs: usable
      ? round(start.medianMs + (3 * resume.medianMs))
      : null,
    estimatedRestoredConversationFourStageFloorMs: usable
      ? round(4 * resume.medianMs)
      : null,
  };
}

async function runTurnDiagnostic(rootDir) {
  const fixture = createTavernV27FixtureStageRunner();
  const trace = [];
  const clockStartedAt = performance.now();
  let activeCalls = 0;
  let maxConcurrentCalls = 0;
  let responseSequence = 0;

  const callJson = async (request = {}) => {
    reserveModelProviderRequest(request.requestBudget, request.requestContext);
    const input = firstJsonObject(request.user);
    const phase = String(request.requestContext?.phase || input.phase || "");
    const stage = STAGE_BY_PHASE[phase];
    const outputKey = OUTPUT_KEY_BY_PHASE[phase];
    if (!stage || !outputKey) throw new Error(`unsupported diagnostic phase: ${phase}`);

    const row = {
      callIndex: trace.length + 1,
      phase,
      sessionOperation: request.conversationContext?.previousResponseId ? "resume" : "start",
      startedAtMs: round(performance.now() - clockStartedAt),
    };
    trace.push(row);
    activeCalls += 1;
    maxConcurrentCalls = Math.max(maxConcurrentCalls, activeCalls);
    try {
      await delay(FIXED_PROVIDER_DELAY_MS);
      const result = await fixture(input, { stage });
      if (phase === "awaiting_agent_turn_commit") {
        const privateTrace = result.turnCommit.privateExpressionTrace;
        result.turnCommit.privateExpressionTrace = {
          affectiveInfluence: privateTrace.affectiveInfluence,
          interactionMove: privateTrace.interactionMove,
          disclosure: privateTrace.disclosure,
          epistemicRelation: privateTrace.epistemicRelation,
          threadDisposition: privateTrace.threadDisposition,
          communicationFocus: privateTrace.communicationFocus,
        };
      }
      responseSequence += 1;
      const responseId = `response:latency-diagnostic:${responseSequence}`;
      return {
        parsed: structuredClone(result[outputKey]),
        meta: {
          provider: "responses",
          model: "diagnostic-no-network",
          elapsedMs: round(performance.now() - clockStartedAt - row.startedAtMs),
          conversationCheckpoint: {
            schemaVersion: "model-conversation-context-v1",
            kind: "responses",
            previousResponseId: responseId,
          },
        },
      };
    } finally {
      activeCalls -= 1;
      row.endedAtMs = round(performance.now() - clockStartedAt);
      row.durationMs = round(row.endedAtMs - row.startedAtMs);
    }
  };

  const repository = createFileWorldRuntimeSessionRepository({ rootDir });
  const stageRunnerFactory = createTavernV27CharacterModelSessionStageFactory({
    model: "diagnostic-no-network",
    providerPortFactory: ({ model }) => createOpenAIJsonCharacterModelProvider({
      model,
      callJson,
      opaqueConversationIdFactory: (characterId) => `diagnostic:${characterId}`,
    }),
  });
  const adapter = createTavernV27SessionAdapter({
    repository,
    stateFactory: async () => seedEnvelope(),
    stageRunnerFactory,
    maxStageProtocolRepairs: 1,
    projectExecutionMetadata: projectTavernV27PersistentModelExecution,
    enableDayPlanning: false,
  });
  const handler = createTavernV27PersistentModelSessionHttpHandler({
    adapter,
    model: "diagnostic-no-network",
    authorizationIdFactory: () => "authorization:latency-diagnostic",
  });

  const commandStartedAt = performance.now();
  const response = await handler(startRequest());
  const commandElapsedMs = round(performance.now() - commandStartedAt);
  if (response.status !== 200) {
    const error = new Error(`diagnostic command failed with HTTP ${response.status}`);
    error.code = "V27_LATENCY_DIAGNOSTIC_COMMAND_FAILED";
    throw error;
  }

  const fullySerial = trace.length > 1 && trace.every((row, index) => (
    index === 0 || row.startedAtMs >= trace[index - 1].endedAtMs
  ));
  const sumProviderDurationsMs = round(trace.reduce((sum, row) => sum + row.durationMs, 0));
  const criticalPathProviderSpanMs = trace.length
    ? round(trace.at(-1).endedAtMs - trace[0].startedAtMs)
    : 0;
  const expectedRed = trace.length > DESIRED_MAX_SERIAL_PROVIDER_CALLS
    && maxConcurrentCalls === 1
    && fullySerial;

  return {
    expectedRed,
    result: {
      status: expectedRed ? "RED_MULTIPLE_SERIAL_PROVIDER_CALLS" : "GREEN",
      contract: {
        desiredMaxSerialProviderCallsPerActorTurn: DESIRED_MAX_SERIAL_PROVIDER_CALLS,
        noExternalModelOrNetworkUsed: true,
        fixedProviderDelayMs: FIXED_PROVIDER_DELAY_MS,
      },
      observed: {
        providerCallCount: trace.length,
        maxConcurrentProviderCalls: maxConcurrentCalls,
        fullySerial,
        commandElapsedMs,
        sumProviderDurationsMs,
        criticalPathProviderSpanMs,
        stageInvocations: Number(response.body.stageInvocations || 0),
        usedProviderRequests: Number(response.body.providerRequestBudget?.usedProviderRequests || 0),
        maxProviderRequests: Number(response.body.providerRequestBudget?.maxProviderRequests || 0),
      },
      stageTrace: trace.map((row) => ({
        callIndex: row.callIndex,
        phase: row.phase,
        sessionOperation: row.sessionOperation,
        startedAtMs: row.startedAtMs,
        endedAtMs: row.endedAtMs,
        durationMs: row.durationMs,
      })),
    },
  };
}

const rootDir = await mkdtemp(path.join(tmpdir(), "gtown-v27-latency-diagnostic-"));
try {
  const { expectedRed, result } = await runTurnDiagnostic(rootDir);
  result.codexCliProcessFloor = cliProcessFloor();
  console.log(JSON.stringify(result, null, 2));
  if (expectedRed) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({
    status: "DIAGNOSTIC_ERROR",
    code: String(error?.code || "UNEXPECTED_DIAGNOSTIC_ERROR"),
    message: String(error?.message || error),
  }, null, 2));
  process.exitCode = 2;
} finally {
  await rm(rootDir, { recursive: true, force: true });
}
