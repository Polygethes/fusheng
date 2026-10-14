import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import { createTavernV27SessionAdapter } from "../src/server/pipeline/tavernV27SessionAdapter.mjs";
import { createTavernV27SessionHttpHandler } from "../src/server/pipeline/tavernV27SessionHttp.mjs";
import { createFileWorldRuntimeSessionRepository } from "../src/server/simulation/worldRuntimeSessionRepository.mjs";

const XIE_ZHENSHI = "char_xyy_xiezenshi";
const LUO_ZHAO = "char_xyy_luozhao";
const rootDir = await mkdtemp(path.join(tmpdir(), "gtown-v27-http-session-"));
let stateFactoryCalls = 0;
let stageCalls = 0;

function seedEnvelope(sessionKey) {
  stateFactoryCalls += 1;
  const state = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  state.characters.find((row) => row.id === LUO_ZHAO).psychologyAnchor.httpSessionLeakProbe = `private:${sessionKey.projectId}:${sessionKey.branchId}`;
  return {
    state,
    characterIds: [XIE_ZHENSHI, LUO_ZHAO],
    positions: { [XIE_ZHENSHI]: "hall", [LUO_ZHAO]: "hall" },
    initialWake: { characterId: XIE_ZHENSHI, kind: "opportunity_window" },
  };
}

function fixtureStageFactory() {
  const runner = createTavernV27FixtureStageRunner();
  return async (...args) => {
    stageCalls += 1;
    return runner(...args);
  };
}

function stack({ stageFactory = fixtureStageFactory } = {}) {
  const repository = createFileWorldRuntimeSessionRepository({ rootDir });
  const adapter = createTavernV27SessionAdapter({
    repository,
    stateFactory: async ({ sessionKey }) => seedEnvelope(sessionKey),
    fixtureStageFactory: stageFactory,
  });
  return {
    repository,
    handler: createTavernV27SessionHttpHandler({ adapter }),
  };
}

function request(operation, overrides = {}) {
  return {
    operation,
    body: {
      projectId: "project:http",
      branchId: "branch:main",
      runtimeId: "world-main",
      commandId: `command:${operation}`,
      expectedRevision: 0,
      ...overrides,
    },
  };
}

function assertPublicSuccess(response) {
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const required = [
    "observation",
    "sessionRef",
    "sessionRevision",
    "worldVersion",
  ];
  for (const key of required) assert.ok(Object.hasOwn(response.body, key), `success response requires ${key}`);
  assert.deepEqual(
    Object.keys(response.body).filter((key) => !required.includes(key)).sort(),
    response.body.staleReplay === true ? ["resultSessionRevision", "staleReplay"] : [],
  );
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes("checkpoint"), false);
  assert.equal(serialized.includes("privateState"), false);
  assert.equal(serialized.includes("httpSessionLeakProbe"), false);
  assert.equal(serialized.includes("private:project:http"), false);
  assert.ok(response.body.observation.turns.length <= 1, "one HTTP command may advance at most one Actor turn");
}

try {
  const firstStack = stack();
  const started = await firstStack.handler(request("start", { commandId: "command:start:main" }));
  assertPublicSuccess(started);
  assert.ok(started.body.sessionRevision > 2, "accepted stages are durable revisions within a command");
  assert.equal(started.body.worldVersion, 1);
  assert.equal(started.body.observation.turns.length, 1);
  assert.equal(started.body.observation.turns[0].characterId, XIE_ZHENSHI);
  assert.equal(started.body.observation.turns[0].agentTurnId, `agent-turn:${XIE_ZHENSHI}:1`);
  assert.equal(stageCalls, 3);
  assert.equal(stateFactoryCalls, 1);

  const replayedStart = await firstStack.handler(request("start", { commandId: "command:start:main" }));
  assertPublicSuccess(replayedStart);
  assert.deepEqual(replayedStart.body, started.body, "an HTTP retry with the same command returns the same public observation");
  assert.equal(stageCalls, 3, "idempotent HTTP retry may not invoke the fixture again");
  assert.equal(stateFactoryCalls, 1, "idempotent start may not rebuild seed state");

  const secondStart = await firstStack.handler(request("start", {
    commandId: "command:start:again",
    expectedRevision: started.body.sessionRevision,
  }));
  assert.equal(secondStart.status, 409);
  assert.equal(secondStart.body.code, "TAVERN_V27_SESSION_ALREADY_STARTED");

  const continued = await firstStack.handler(request("continue", {
    commandId: "command:continue:1",
    expectedRevision: started.body.sessionRevision,
    sessionId: started.body.sessionRef.sessionId,
  }));
  assertPublicSuccess(continued);
  assert.ok(continued.body.sessionRevision > started.body.sessionRevision);
  assert.equal(continued.body.worldVersion, 2);
  assert.equal(continued.body.observation.turns[0].characterId, LUO_ZHAO);
  assert.equal(continued.body.observation.turns[0].agentTurnId, `agent-turn:${LUO_ZHAO}:1`);
  assert.equal(stageCalls, 6);
  assert.equal(stateFactoryCalls, 1, "continue restores the frozen definition instead of rebuilding the seed");

  // Recreate repository, adapter and handler to model a server restart.
  const restartedStack = stack();
  const afterRestart = await restartedStack.handler(request("continue", {
    commandId: "command:continue:2",
    expectedRevision: continued.body.sessionRevision,
    sessionId: started.body.sessionRef.sessionId,
  }));
  assertPublicSuccess(afterRestart);
  assert.ok(afterRestart.body.sessionRevision > continued.body.sessionRevision);
  assert.equal(afterRestart.body.worldVersion, 3);
  assert.equal(afterRestart.body.observation.turns[0].characterId, XIE_ZHENSHI);
  assert.equal(afterRestart.body.observation.turns[0].agentTurnId, `agent-turn:${XIE_ZHENSHI}:2`);
  assert.equal(stageCalls, 9);
  assert.equal(stateFactoryCalls, 1, "service reconstruction must load the durable definition and checkpoint");

  const reset = await restartedStack.handler(request("reset", {
    commandId: "command:reset:1",
    expectedRevision: afterRestart.body.sessionRevision,
    sessionId: started.body.sessionRef.sessionId,
  }));
  assertPublicSuccess(reset);
  assert.equal(reset.body.sessionRevision, afterRestart.body.sessionRevision + 2);
  assert.equal(reset.body.worldVersion, 0);
  assert.deepEqual(reset.body.observation.turns, []);
  assert.equal(stageCalls, 9, "reset rebuilds a checkpoint but does not run an Actor turn");
  assert.equal(stateFactoryCalls, 1, "reset uses the session's frozen definition");

  const afterReset = await restartedStack.handler(request("continue", {
    commandId: "command:continue:after-reset",
    expectedRevision: reset.body.sessionRevision,
    sessionId: started.body.sessionRef.sessionId,
  }));
  assertPublicSuccess(afterReset);
  assert.ok(afterReset.body.sessionRevision > reset.body.sessionRevision);
  assert.equal(afterReset.body.worldVersion, 1);
  assert.equal(afterReset.body.observation.turns[0].characterId, XIE_ZHENSHI);
  assert.equal(afterReset.body.observation.turns[0].agentTurnId, `agent-turn:${XIE_ZHENSHI}:1`);
  assert.equal(stageCalls, 12);

  const storedAfterReset = await restartedStack.repository.load({
    projectId: "project:http",
    branchId: "branch:main",
    runtimeId: "world-main",
  });
  const storedXie = storedAfterReset.checkpoint.actors.find((row) => row.characterId === XIE_ZHENSHI);
  assert.equal(storedXie.turnSequence, 1);
  assert.equal(storedXie.mailbox.some(wake => wake.wakeId.startsWith("wake:session-bootstrap:")), false,
    "the reset bootstrap wake is consumed once and is not recreated on continue");
  assert.deepEqual(storedXie.mailbox.map(wake => wake.kind), ["day_planning_due"],
    "scene pacing may queue private planning after the bootstrap action");
  assert.equal(storedAfterReset.checkpoint.coordinator.journal.worldVersion, 1);

  const stale = await restartedStack.handler(request("continue", {
    commandId: "command:stale",
    expectedRevision: reset.body.sessionRevision,
    sessionId: started.body.sessionRef.sessionId,
  }));
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "WORLD_RUNTIME_SESSION_REVISION_CONFLICT");

  const missingField = await restartedStack.handler(request("continue", {
    runtimeId: "",
    commandId: "command:invalid",
    expectedRevision: afterReset.body.sessionRevision,
  }));
  assert.equal(missingField.status, 400);
  assert.equal(missingField.body.code, "TAVERN_V27_SESSION_REQUEST_INCOMPLETE");

  const missingSession = await restartedStack.handler(request("continue", {
    branchId: "branch:missing",
    commandId: "command:missing",
    expectedRevision: 0,
    sessionId: "runtime-session:missing",
  }));
  assert.equal(missingSession.status, 404);
  assert.equal(missingSession.body.code, "WORLD_RUNTIME_SESSION_NOT_FOUND");

  const alternateBranch = await restartedStack.handler(request("start", {
    branchId: "branch:alternate",
    commandId: "command:start:alternate",
  }));
  assertPublicSuccess(alternateBranch);
  assert.notEqual(alternateBranch.body.sessionRef.sessionId, started.body.sessionRef.sessionId);
  assert.equal(alternateBranch.body.worldVersion, 1);
  assert.equal(stateFactoryCalls, 2);
  const mainStill = await restartedStack.repository.load({
    projectId: "project:http",
    branchId: "branch:main",
    runtimeId: "world-main",
  });
  assert.equal(mainStill.sessionRevision, afterReset.body.sessionRevision);
  assert.equal(mainStill.checkpoint.coordinator.journal.worldVersion, 1);

  const oldReplay = await restartedStack.handler(request("continue", {
    commandId: "command:continue:1",
    expectedRevision: started.body.sessionRevision,
    sessionId: started.body.sessionRef.sessionId,
  }));
  assertPublicSuccess(oldReplay);
  assert.equal(oldReplay.body.staleReplay, true);
  assert.equal(oldReplay.body.resultSessionRevision, continued.body.sessionRevision);
  assert.equal(oldReplay.body.sessionRevision, afterReset.body.sessionRevision, "an old replay must keep the public session cursor current");
  assert.equal(oldReplay.body.worldVersion, 1, "an old replay must keep the public world cursor current");

  const missingIdentity = await restartedStack.handler(request("continue", {
    commandId: "command:missing-session-id",
    expectedRevision: afterReset.body.sessionRevision,
    sessionId: "",
  }));
  assert.equal(missingIdentity.status, 400);
  assert.equal(missingIdentity.body.code, "TAVERN_V27_SESSION_ID_REQUIRED");

  const mismatchedIdentity = await restartedStack.handler(request("continue", {
    commandId: "command:mismatched-session-id",
    expectedRevision: afterReset.body.sessionRevision,
    sessionId: "runtime-session:not-the-current-world",
  }));
  assert.equal(mismatchedIdentity.status, 409);
  assert.equal(mismatchedIdentity.body.code, "TAVERN_V27_SESSION_ID_MISMATCH");
  assert.equal(Object.hasOwn(mismatchedIdentity.body, "sessionRef"), false);
  assert.equal(JSON.stringify(mismatchedIdentity.body).includes("checkpoint"), false);
  assert.equal(JSON.stringify(mismatchedIdentity.body).includes("privateState"), false);
  const mismatchedResetIdentity = await restartedStack.handler(request("reset", {
    commandId: "command:mismatched-reset-session-id",
    expectedRevision: afterReset.body.sessionRevision,
    sessionId: "runtime-session:not-the-current-world",
  }));
  assert.equal(mismatchedResetIdentity.status, 409);
  assert.equal(mismatchedResetIdentity.body.code, "TAVERN_V27_SESSION_ID_MISMATCH");
  assert.equal(Object.hasOwn(mismatchedResetIdentity.body, "sessionRef"), false);
  const afterIdentityMismatch = await restartedStack.repository.load({
    projectId: "project:http",
    branchId: "branch:main",
    runtimeId: "world-main",
  });
  assert.equal(afterIdentityMismatch.sessionRevision, afterReset.body.sessionRevision, "a mismatched client identity may not advance the world session");

  const failingStack = stack({
    stageFactory: () => async () => {
      const error = new Error("fixture stage failed");
      error.code = "FIXTURE_STAGE_FAILED";
      throw error;
    },
  });
  const failedStart = await failingStack.handler(request("start", {
    branchId: "branch:failure-recovery",
    commandId: "command:start:failure-recovery",
  }));
  assert.equal(failedStart.status, 500);
  assert.equal(failedStart.body.code, "FIXTURE_STAGE_FAILED");
  assert.deepEqual(failedStart.body.sessionRef, {
    projectId: "project:http",
    branchId: "branch:failure-recovery",
    runtimeId: "world-main",
    sessionId: failedStart.body.sessionRef.sessionId,
  });
  assert.match(failedStart.body.sessionRef.sessionId, /^runtime-session:/);
  assert.ok(failedStart.body.sessionRevision >= 2);
  assert.equal(failedStart.body.worldVersion, 0);
  const failedPublicJson = JSON.stringify(failedStart.body);
  assert.equal(failedPublicJson.includes("checkpoint"), false);
  assert.equal(failedPublicJson.includes("privateState"), false);
  assert.equal(failedPublicJson.includes("httpSessionLeakProbe"), false);
  assert.equal(failedPublicJson.includes("private:project:http"), false);

  const recoveredAfterFailure = await stack().handler(request("continue", {
    branchId: "branch:failure-recovery",
    commandId: "command:continue:failure-recovery",
    expectedRevision: failedStart.body.sessionRevision,
    sessionId: failedStart.body.sessionRef.sessionId,
  }));
  assertPublicSuccess(recoveredAfterFailure);
  assert.ok(recoveredAfterFailure.body.sessionRevision > failedStart.body.sessionRevision);
  assert.equal(recoveredAfterFailure.body.worldVersion, 1);

  console.log(JSON.stringify({
    status: "all-passed",
    checks: {
      explicitStartContinueReset: true,
      oneActorTurnPerCommand: true,
      bootstrapWakeCreatedOnce: true,
      commandReplayIsIdempotent: true,
      lateReplayKeepsCurrentPublicCursor: true,
      failedExecutionReturnsSafeRecoveryCursor: true,
      newCommandContinuesAfterFailedExecution: true,
      continueAndResetRequireMatchingSessionIdentity: true,
      repositoryAndHandlerRestart: true,
      projectBranchRuntimeIdentityRequired: true,
      staleRevisionRejected: true,
      resetUsesFrozenDefinition: true,
      publicResponseContainsNoCheckpointOrPrivateState: true,
      branchSessionsRemainIsolated: true,
    },
  }, null, 2));
} finally {
  await rm(rootDir, { recursive: true, force: true });
}
