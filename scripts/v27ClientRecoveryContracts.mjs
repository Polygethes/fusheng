import assert from "node:assert/strict";

import {
  prepareV27LocalCommand,
  runV27LocalObservation,
  v27RuntimeIdForWorld,
} from "../src/engine/v27Service.js";

assert.equal(
  v27RuntimeIdForWorld({ runtimeInstanceId: "world-instance:alpha" }),
  "tavern-v27:world-instance:alpha",
  "the server session key must distinguish separate worlds with the same project id",
);

const firstCommand = prepareV27LocalCommand({ sessionRef: null });
assert.equal(firstCommand.operation, "start");
assert.equal(firstCommand.expectedRevision, 0);
assert.match(firstCommand.commandId, /^v27:start:/);

const pendingStartRef = {
  runtimeId: "tavern-v27:world-instance:alpha",
  projectId: "project:client",
  branchId: "branch:main",
  sessionId: "",
  sessionRevision: 0,
  pendingCommand: firstCommand,
};
assert.deepEqual(
  prepareV27LocalCommand({ sessionRef: pendingStartRef }),
  firstCommand,
  "refreshing after a lost start response must reuse the persisted command id",
);

const originalFetch = globalThis.fetch;
const calls = [];
try {
  globalThis.fetch = async (url, options = {}) => {
    const body = JSON.parse(options.body || "{}");
    calls.push({ url, body });
    if (calls.length === 1) throw new TypeError("simulated response loss");
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          sessionRef: {
            projectId: body.projectId,
            branchId: body.branchId,
            runtimeId: body.runtimeId,
            sessionId: "runtime-session:recovered",
          },
          sessionRevision: 2,
          worldVersion: 1,
          observation: { schemaVersion: "test", worldVersion: 1, eventCount: 1, turns: [] },
        };
      },
    };
  };

  await assert.rejects(() => runV27LocalObservation({
    projectId: pendingStartRef.projectId,
    branchId: pendingStartRef.branchId,
    runtimeId: pendingStartRef.runtimeId,
    sessionRef: pendingStartRef,
  }), /simulated response loss/);
  const recovered = await runV27LocalObservation({
    projectId: pendingStartRef.projectId,
    branchId: pendingStartRef.branchId,
    runtimeId: pendingStartRef.runtimeId,
    sessionRef: pendingStartRef,
  });
  assert.equal(calls[0].body.commandId, firstCommand.commandId);
  assert.equal(calls[1].body.commandId, firstCommand.commandId);
  assert.equal(calls[1].url, "/api/v27/tavern/session/start");
  assert.equal(recovered.sessionRef.sessionId, "runtime-session:recovered");

  const continueRef = {
    ...recovered.sessionRef,
    pendingCommand: {
      operation: "continue",
      commandId: "v27:continue:stable",
      expectedRevision: 2,
      timestamp: "2026-07-26T00:00:00.000Z",
    },
  };
  await runV27LocalObservation({
    projectId: pendingStartRef.projectId,
    branchId: pendingStartRef.branchId,
    runtimeId: pendingStartRef.runtimeId,
    sessionRef: continueRef,
  });
  assert.equal(calls[2].body.commandId, "v27:continue:stable");
  assert.equal(calls[2].body.expectedRevision, 2);
  assert.equal(calls[2].body.sessionId, "runtime-session:recovered");

  globalThis.fetch = async () => ({
    ok: false,
    status: 409,
    async json() {
      return {
        code: "WORLD_RUNTIME_SESSION_REVISION_CONFLICT",
        error: "stale",
        sessionRef: {
          projectId: "project:client",
          branchId: "branch:main",
          runtimeId: "tavern-v27:world-instance:alpha",
          sessionId: "runtime-session:recovered",
        },
        sessionRevision: 6,
        worldVersion: 3,
      };
    },
  });
  await assert.rejects(
    async () => runV27LocalObservation({
      projectId: pendingStartRef.projectId,
      branchId: pendingStartRef.branchId,
      runtimeId: pendingStartRef.runtimeId,
      sessionRef: continueRef,
    }),
    (error) => {
      assert.equal(error.code, "WORLD_RUNTIME_SESSION_REVISION_CONFLICT");
      assert.equal(error.sessionRef.sessionId, "runtime-session:recovered");
      assert.equal(error.sessionRef.sessionRevision, 6);
      assert.equal(error.sessionRef.worldVersion, 3);
      return true;
    },
    "safe conflict metadata must let the UI advance its opaque cursor without seeing a checkpoint",
  );

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        sessionRef: {
          projectId: "project:client",
          branchId: "branch:main",
          runtimeId: "tavern-v27:world-instance:alpha",
          sessionId: "runtime-session:recovered",
        },
        sessionRevision: 10,
        worldVersion: 7,
        staleReplay: true,
        resultSessionRevision: 4,
        observation: {
          schemaVersion: "test",
          worldVersion: 2,
          turns: [{ characterId: "old", agentTurnId: "old-turn", publicRealization: {}, outcome: null }],
        },
      };
    },
  });
  const stale = await runV27LocalObservation({
    projectId: pendingStartRef.projectId,
    branchId: pendingStartRef.branchId,
    runtimeId: pendingStartRef.runtimeId,
    sessionRef: continueRef,
  });
  assert.equal(stale.staleReplay, true);
  assert.equal(stale.sessionRef.sessionRevision, 10);
  assert.equal(stale.worldVersion, 7);
  assert.deepEqual(stale.turns, [], "a late replay may repair the cursor but may not redisplay its old turn");
} finally {
  globalThis.fetch = originalFetch;
}

console.log(JSON.stringify({
  status: "all-passed",
  checks: {
    worldInstanceNamespacesRuntime: true,
    pendingStartCommandSurvivesResponseLoss: true,
    continueSendsExpectedSessionIdentity: true,
    safeConflictMetadataCanRepairClientCursor: true,
    staleReplayCannotReenterObserverHistory: true,
  },
}, null, 2));
