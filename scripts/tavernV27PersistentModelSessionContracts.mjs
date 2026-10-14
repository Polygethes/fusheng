import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import { createTavernV27SessionAdapter } from "../src/server/pipeline/tavernV27SessionAdapter.mjs";
import { createFileWorldRuntimeSessionRepository } from "../src/server/simulation/worldRuntimeSessionRepository.mjs";

const XIE = "char_xyy_xiezenshi";
const LUO = "char_xyy_luozhao";
const rootDir = await mkdtemp(path.join(tmpdir(), "gtown-v27-model-session-"));
const sessionKey = {
  projectId: "project:model-baseline",
  branchId: "branch:main",
  runtimeId: "tavern-v27-model:world-baseline",
};
let stateFactoryCalls = 0;
let forbiddenLocalFactoryCalls = 0;
let modelStageFactoryCalls = 0;
let providerStageCalls = 0;
let modelStageExecutionCloseCalls = 0;
const stageInputs = [];
const restoredCharacterModelCheckpoints = [];

function seedEnvelope() {
  stateFactoryCalls += 1;
  const state = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  return {
    state,
    characterIds: [XIE, LUO],
    positions: { [XIE]: "hall", [LUO]: "hall" },
    initialWake: { characterId: XIE, kind: "opportunity_window" },
  };
}

function modelStageFactory({ purpose, executionContext, characterModelSessionCheckpoint = null }) {
  if (purpose !== "command") {
    return async () => {
      throw Object.assign(new Error("a bootstrap/reset runtime may not invoke a model stage"), {
        code: "MODEL_STAGE_OUTSIDE_AUTHORIZED_COMMAND",
      });
    };
  }
  modelStageFactoryCalls += 1;
  restoredCharacterModelCheckpoints.push(structuredClone(characterModelSessionCheckpoint));
  assert.equal(executionContext?.authorizationAcknowledged, true);
  assert.match(executionContext?.authorizationId || "", /^authorization:model-command:/);
  const fixture = createTavernV27FixtureStageRunner();
  const restoredStageCount = Number(characterModelSessionCheckpoint?.acceptedStageCount || 0);
  let invocations = 0;
  return {
    runStage: async (input, options) => {
      invocations += 1;
      providerStageCalls += 1;
      stageInputs.push(structuredClone(input));
      const result = await fixture(input, options);
      return {
        ...result,
        stage: { ...result.stage, provider: "injected-model-stub", model: "test-model" },
      };
    },
    publicMetadata: () => ({
      mode: "persistent-external-character-agent",
      model: "test-model",
      externalModelCalled: invocations > 0,
      stageInvocations: invocations,
      providerRequestBudget: {
        maxProviderRequests: 6,
        usedProviderRequests: invocations,
        remainingProviderRequests: Math.max(0, 6 - invocations),
      },
      protocolRepairEvents: [],
      authorQualityVerdict: "pending",
    }),
    checkpoint: async () => ({
      schemaVersion: "test-character-model-session-pool-v1",
      acceptedStageCount: restoredStageCount + invocations,
      characters: [XIE, LUO],
    }),
    close: async () => {
      modelStageExecutionCloseCalls += 1;
    },
  };
}

function commandContext(index) {
  return {
    authorizationAcknowledged: true,
    authorizationId: `authorization:model-command:${index}:must-not-persist`,
  };
}

try {
  const repository = createFileWorldRuntimeSessionRepository({ rootDir });
  const adapter = createTavernV27SessionAdapter({
    repository,
    stateFactory: async () => seedEnvelope(),
    fixtureStageFactory: () => {
      forbiddenLocalFactoryCalls += 1;
      throw new Error("persistent model session must not construct the local fixture factory");
    },
    stageRunnerFactory: modelStageFactory,
    maxStageProtocolRepairs: 1,
    projectExecutionMetadata: (metadata) => metadata ? { agentExecution: metadata } : {},
  });

  let sessionId = "";
  let expectedSessionRevision = 0;
  const responses = [];
  for (let index = 1; index <= 4; index += 1) {
    const operation = index === 1 ? "start" : "continue";
    const response = await adapter.execute({
      operation,
      sessionKey,
      sessionId,
      commandId: `command:model:${index}`,
      expectedSessionRevision,
      executionContext: commandContext(index),
    });
    responses.push(response);
    sessionId = response.sessionRef.sessionId;
    expectedSessionRevision = response.sessionRevision;
    assert.equal(response.observation.turns.length, 1, "one authorized command advances at most one Character Actor");
    assert.equal(response.observation.turns[0].submissionMode, "atomic");
    assert.equal(response.observation.turns[0].characterAgentCompleted, true);
    assert.equal(response.observation.turns[0].acceptedStageCount, 4);
    assert.equal(response.observation.turns[0].expectedAcceptedStageCount, 4);
    assert.equal(response.observation.turns[0].fiveStageAgentCompleted, false);
    assert.equal(response.agentExecution.stageInvocations, 3);
    assert.equal(response.agentExecution.providerRequestBudget.usedProviderRequests, 3);
  }

  assert.ok(responses.every((row, index) => row.sessionRevision > (responses[index - 1]?.sessionRevision || 0)), "durable stage checkpoints monotonically advance session revisions");
  assert.deepEqual(responses.map((row) => row.worldVersion), [1, 2, 3, 4]);
  assert.deepEqual(responses.map((row) => row.observation.turns[0].characterId), [XIE, LUO, XIE, LUO]);
  assert.equal(stateFactoryCalls, 1, "all four commands must reuse one frozen world definition");
  assert.equal(forbiddenLocalFactoryCalls, 0, "the model session must not construct the default fixture runner");
  assert.equal(modelStageFactoryCalls, 4);
  assert.equal(providerStageCalls, 12);
  assert.deepEqual(
    restoredCharacterModelCheckpoints.map((row) => Number(row?.acceptedStageCount || 0)),
    [0, 3, 6, 9],
    "each command must restore the committed private model-session checkpoint",
  );
  assert.equal(modelStageExecutionCloseCalls, 4, "each command-scoped provider handle must close after checkpointing");

  const xieSecondTurnInput = stageInputs.find((row) => (
    row.agentTurnId === `agent-turn:${XIE}:2`
    && row.phase === "awaiting_subjective_appraisal_and_candidates"
  ));
  const luoSecondTurnInput = stageInputs.find((row) => (
    row.agentTurnId === `agent-turn:${LUO}:2`
    && row.phase === "awaiting_subjective_appraisal_and_candidates"
  ));
  assert.ok(xieSecondTurnInput, "Xie Zhenshi must receive a second persistent Agent activation");
  assert.ok(luoSecondTurnInput, "Luo Zhao must receive a second persistent Agent activation");
  assert.equal(xieSecondTurnInput.worldProjection.scene.step, 2);
  assert.equal(luoSecondTurnInput.worldProjection.scene.step, 3);
  assert.equal(JSON.stringify(xieSecondTurnInput.worldProjection.evidence).includes("来壶好茶"), true, "Xie's second activation must contain Luo's newly delivered committed speech");
  assert.equal(JSON.stringify(xieSecondTurnInput.privateContext.memoryContext.episodes).includes("来壶好茶"), false, "newly delivered speech may not become memory before Xie appraises it in this turn");
  assert.equal(xieSecondTurnInput.privateContext.priorActionOutcomeContext.hasPendingAgentAction, true, "Xie must appraise the outcome of his own prior Character Agent action");
  assert.equal(JSON.stringify(luoSecondTurnInput.worldProjection.recentOwnActions).includes("来壶好茶"), true, "Luo's second activation must retain her own settled action continuity");
  assert.equal(JSON.stringify(luoSecondTurnInput.privateContext.memoryContext.episodes).includes("客官，要些什么"), true, "Luo's private memory must retain Xie's first speech");
  assert.equal(luoSecondTurnInput.privateContext.priorActionOutcomeContext.hasPendingAgentAction, true, "Luo must appraise the outcome of her own prior Character Agent action");

  const stored = await repository.load(sessionKey);
  const storedJson = JSON.stringify(stored);
  assert.equal(storedJson.includes("authorization:model-command"), false);
  assert.equal(storedJson.includes("authorizationAcknowledged"), false);
  assert.deepEqual(stored.checkpoint.actors.map((row) => [row.characterId, row.turnSequence]), [[XIE, 2], [LUO, 2]]);
  assert.equal(stored.checkpoint.characterModelSessions.acceptedStageCount, 12);
  const storedXie = stored.checkpoint.actors.find((row) => row.characterId === XIE);
  assert.equal(JSON.stringify(storedXie.privateState.memoryContext.episodes).includes("来壶好茶"), true, "Xie's completed appraisal must write Luo's speech into his next checkpoint");

  const beforeReplayCalls = providerStageCalls;
  const replay = await adapter.execute({
    operation: "continue",
    sessionKey,
    sessionId,
    commandId: "command:model:4",
    expectedSessionRevision: 6,
    executionContext: commandContext(99),
  });
  assert.notEqual(replay.staleReplay, true);
  assert.equal(providerStageCalls, beforeReplayCalls, "completed model command replay may not call the provider again");
  assert.equal(modelStageFactoryCalls, 4, "completed replay may not reconstruct an authorized model runtime");

  console.log(JSON.stringify({
    status: "all-passed",
    checks: {
      fourCommandsShareOneSession: true,
      bothActorsCompleteTwoAtomicTurns: true,
      laterActivationsReadCommittedContinuity: true,
      commandScopedAuthorityNeverPersists: true,
      localFixtureFactoryNeverRuns: true,
      completedReplayMakesNoProviderCall: true,
      characterModelCheckpointPersistsAcrossCommands: true,
    },
  }, null, 2));
} finally {
  await rm(rootDir, { recursive: true, force: true });
}
