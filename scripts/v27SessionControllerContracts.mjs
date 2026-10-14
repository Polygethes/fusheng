import assert from "node:assert/strict";

import { createV27SessionController } from "../src/engine/v27SessionController.js";

const project = {
  id: "project:controller",
  runtimeInstanceId: "world:controller",
  activeBranchId: "branch:main",
};
let activeBranchId = "branch:main";
const sessions = new Map();
const observations = new Map();
const calls = [];

function key(runtimeId) {
  return `${activeBranchId}:${runtimeId}`;
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function fakeStore() {
  return {
    getState: () => ({ project: { ...project, activeBranchId }, ui: { activeBranchId } }),
    getRuntimeSessionRef(runtimeId) { return clone(sessions.get(key(runtimeId)) || null); },
    setRuntimeSessionRef(input, { resolvedCommandId = "" } = {}) {
      const row = clone(input);
      const existing = sessions.get(key(row.runtimeId));
      if (existing?.pendingCommand && !row.pendingCommand) {
        assert.equal(resolvedCommandId, existing.pendingCommand.commandId);
      }
      sessions.set(key(row.runtimeId), row);
      return clone(row);
    },
    clearRuntimeSessionRef(runtimeId) { sessions.delete(key(runtimeId)); },
    getRuntimeObservation(runtimeId) { return clone(observations.get(key(runtimeId)) || null); },
    setRuntimeObservation(runtimeId, observation) { observations.set(key(runtimeId), clone(observation)); },
  };
}

const store = fakeStore();
let responseMode = "network-loss";
const controller = createV27SessionController({
  ...store,
  async runLocalObservation(input) {
    calls.push(clone(input));
    if (responseMode === "network-loss") throw new TypeError("response lost");
    if (responseMode === "switch-branch") {
      activeBranchId = "branch:fork";
    }
    if (responseMode === "in-progress") {
      const error = new Error("command still running");
      error.code = "WORLD_RUNTIME_COMMAND_IN_PROGRESS";
      error.sessionRef = {
        ...input.sessionRef,
        sessionId: "runtime-session:controller",
        pendingCommand: null,
        sessionRevision: 3,
        worldVersion: 1,
      };
      throw error;
    }
    if (responseMode === "safe-conflict") {
      const error = new Error("stale revision");
      error.code = "WORLD_RUNTIME_SESSION_REVISION_CONFLICT";
      error.sessionRef = {
        ...input.sessionRef,
        sessionId: "runtime-session:controller",
        pendingCommand: null,
        sessionRevision: 6,
        worldVersion: 3,
      };
      throw error;
    }
    if (responseMode === "not-found") {
      const error = new Error("not found");
      error.code = "WORLD_RUNTIME_SESSION_NOT_FOUND";
      throw error;
    }
    return {
      sessionRef: {
        runtimeId: input.runtimeId,
        projectId: input.projectId,
        branchId: input.branchId,
        sessionId: "runtime-session:controller",
        sessionRevision: 2,
        worldVersion: 1,
      },
      worldVersion: 1,
      eventCount: 1,
      turns: [{ index: 1, characterId: "c1", agentTurnId: "turn:c1:1", outcome: { status: "quiet" } }],
    };
  },
});

await assert.rejects(() => controller.runLocalTurn(), /response lost/);
const runtimeId = "tavern-v27:world:controller";
const pendingAfterLoss = store.getRuntimeSessionRef(runtimeId);
assert.ok(pendingAfterLoss.pendingCommand.commandId);
assert.equal(pendingAfterLoss.sessionId, "");

responseMode = "success";
const recovered = await controller.runLocalTurn();
assert.equal(calls[1].sessionRef.pendingCommand.commandId, calls[0].sessionRef.pendingCommand.commandId);
assert.equal(store.getRuntimeSessionRef(runtimeId).sessionRevision, 2);
assert.equal(store.getRuntimeObservation(runtimeId).turns[0].agentTurnId, "turn:c1:1");
assert.equal(recovered.displayedObservation.turns.length, 1);

responseMode = "in-progress";
await assert.rejects(() => controller.runLocalTurn(), /still running/);
const pendingWhileRunning = store.getRuntimeSessionRef(runtimeId);
assert.ok(pendingWhileRunning.pendingCommand.commandId, "an in-progress server command must remain replayable");
assert.equal(pendingWhileRunning.sessionRevision, 3, "the safe cursor may advance without resolving the command");

responseMode = "switch-branch";
activeBranchId = "branch:main";
await assert.rejects(() => controller.runLocalTurn(), (error) => error.code === "V27_RUNTIME_CONTEXT_CHANGED");
activeBranchId = "branch:main";
const pendingAfterSwitch = store.getRuntimeSessionRef(runtimeId);
assert.ok(pendingAfterSwitch.pendingCommand.commandId, "the origin branch must retain the in-flight command");

responseMode = "safe-conflict";
await assert.rejects(() => controller.runLocalTurn(), /stale revision/);
assert.equal(store.getRuntimeSessionRef(runtimeId).sessionRevision, 6);
assert.equal(store.getRuntimeSessionRef(runtimeId).pendingCommand, null);

responseMode = "not-found";
await assert.rejects(() => controller.runLocalTurn(), /not found/);
assert.equal(store.getRuntimeSessionRef(runtimeId), null);

console.log(JSON.stringify({
  status: "all-passed",
  checks: {
    commandPersistedBeforeNetwork: true,
    responseLossReusesSameCommand: true,
    inProgressCommandRemainsPending: true,
    branchSwitchLeavesOriginPending: true,
    safeErrorCursorRepairsRevision: true,
    missingServerSessionClearsDeadReference: true,
  },
}, null, 2));
