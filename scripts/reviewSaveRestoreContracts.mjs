import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as store from "../src/state/store.js";
import { createV27SessionController } from "../src/engine/v27SessionController.js";
import { captureV27SaveState, restoreV27SaveState } from "../src/engine/v27SaveService.js";
import { createTavernV27SessionAdapter } from "../src/server/pipeline/tavernV27SessionAdapter.mjs";
import { createTavernV27SessionHttpHandler } from "../src/server/pipeline/tavernV27SessionHttp.mjs";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import { createFileWorldRuntimeSessionRepository } from "../src/server/simulation/worldRuntimeSessionRepository.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const rootDir = await mkdtemp(path.join(tmpdir(), "gtown-review-saves-"));
const originalFetch = globalThis.fetch;
try {
  const repository = createFileWorldRuntimeSessionRepository({ rootDir, generationRetention: 2 });
  const stateFactory = () => ({ state: buildPlayableWorldFromSetup({ setupWorldPrompt: "逍遥游，望梯酒馆", setupPeoplePrompt: "谢真石、洛照" }) });
  const adapter = createTavernV27SessionAdapter({ repository, stateFactory });
  const handler = createTavernV27SessionHttpHandler({ adapter });
  globalThis.fetch = async (url, options) => {
    const result = await handler({ operation: String(url).split("/").at(-1), body: JSON.parse(options.body) });
    return new Response(JSON.stringify(result.body), { status: result.status });
  };
  const controller = createV27SessionController(store);
  await controller.runLocalTurn();
  const firstState = store.getState();
  const firstRef = firstState.runtimeSessions[0];
  const firstRecord = await repository.load(firstRef);
  const saved = await captureV27SaveState(firstState);
  assert.equal(saved.runtimeSnapshots.length, 1);
  assert.equal(saved.runtimeSnapshots[0].worldVersion, 1);
  assert.equal(saved.runtimeSnapshots[0].checkpoint, undefined);
  const forkKey = { ...firstRef, branchId: "branch:save-fork" };
  const forkStarted = await adapter.execute({ operation: "start", sessionKey: forkKey, commandId: "start-fork", expectedSessionRevision: 0 });
  const forkRef = { ...forkStarted.sessionRef, sessionRevision: forkStarted.sessionRevision, worldVersion: forkStarted.worldVersion,
    runtimeInstanceId: firstState.project.runtimeInstanceId, pendingCommand: null };
  const forkRecord = await repository.load(forkRef);
  const multiBranchState = structuredClone(firstState);
  multiBranchState.branches.push({ ...structuredClone(firstState.branches[0]), id: forkRef.branchId,
    runtimeClientState: { schemaVersion: 1, sessions: [forkRef], observations: [] } });
  const multiBranchSave = await captureV27SaveState(multiBranchState);
  assert.equal(multiBranchSave.runtimeSnapshots.length, 2);
  for (let i = 0; i < 5; i += 1) await controller.runLocalTurn();
  const advancedOriginal = await repository.load(firstRef);
  assert(advancedOriginal.sessionRevision > firstRecord.sessionRevision);
  // Legacy cursor-only saves fail clearly after their exact generation is pruned.
  await assert.rejects(() => restoreV27SaveState(firstState), error => error.code === "WORLD_RUNTIME_SNAPSHOT_UNAVAILABLE");

  const restored = await restoreV27SaveState(JSON.stringify(saved));
  const restoredRef = restored.runtimeSessions[0];
  assert.notEqual(restoredRef.runtimeId, firstRef.runtimeId);
  assert.notEqual(restoredRef.sessionId, firstRef.sessionId);
  assert.equal(restoredRef.sessionRevision, 0);
  assert.deepEqual((await repository.load(restoredRef)).checkpoint, firstRecord.checkpoint);
  assert.equal(restored.branches.find(row => row.id === firstRef.branchId).runtimeClientState.sessions[0].runtimeId, restoredRef.runtimeId);
  store.importState(JSON.stringify(restored), { preserveRuntimeIdentity: true });
  await controller.runLocalTurn();
  const afterLoadTurn = store.getState();
  assert.equal(afterLoadTurn.runtimeSessions[0].worldVersion, 2, "first continue after load must succeed at saved world + 1");
  assert.deepEqual(afterLoadTurn.ui.v27Observation.turns.map(row => row.outcome.worldVersion), [1, 2]);
  assert.deepEqual(await repository.load(firstRef), advancedOriginal, "restoring must not rewind or advance the original session");
  const restoredAgain = await restoreV27SaveState(saved);
  assert.notEqual(restoredAgain.runtimeSessions[0].runtimeId, restoredRef.runtimeId);
  assert.deepEqual((await repository.load(restoredAgain.runtimeSessions[0])).checkpoint, firstRecord.checkpoint);
  const multiRestored = await restoreV27SaveState(multiBranchSave);
  const forkRestored = multiRestored.branches.find(branch => branch.id === forkRef.branchId).runtimeClientState.sessions[0];
  assert.deepEqual((await repository.load(forkRestored)).checkpoint, forkRecord.checkpoint);
  store.importState(JSON.stringify(multiRestored), { preserveRuntimeIdentity: true });
  store.setActiveBranch(forkRef.branchId);
  await controller.runLocalTurn();
  assert.equal(store.getState().runtimeSessions[0].worldVersion, 2);
  assert.deepEqual(await repository.load(forkRef), forkRecord);
  const legacyBranchOnly = structuredClone(multiBranchSave);
  delete legacyBranchOnly.runtimeSessions;
  delete legacyBranchOnly.runtimeObservations;
  for (const branch of legacyBranchOnly.branches) {
    branch.snapshot.runtimeSessions = branch.runtimeClientState.sessions;
    branch.snapshot.runtimeObservations = branch.runtimeClientState.observations;
    delete branch.runtimeClientState;
  }
  const legacyRestored = await restoreV27SaveState(legacyBranchOnly);
  assert.equal(legacyRestored.runtimeSessions.length, 1);
  assert.equal(legacyRestored.branches.find(branch => branch.id === forkRef.branchId).runtimeClientState.sessions.length, 1);
  await assert.rejects(() => captureV27SaveState({ ...firstState, runtimeSessions: [{ ...firstRef, pendingCommand: { commandId: "pending" } }] }), /待决/);

  // Provider session messages are preserved privately too; save/restore never
  // creates a Character provider or runs another model stage.
  let stageFactories = 0;
  const privateModelMarker = { owner: "actor", messages: [{ role: "user", content: "private-checkpoint-marker" }] };
  const modelAdapter = createTavernV27SessionAdapter({ repository, stateFactory,
    stageRunnerFactory: input => {
      stageFactories += 1;
      return { runStage: createTavernV27FixtureStageRunner(), checkpoint: () => input.characterModelSessionCheckpoint || privateModelMarker };
    },
  });
  const modelKey = { projectId: "review-model", branchId: "main", runtimeId: "tavern-v27-model:original" };
  const modelStarted = await modelAdapter.execute({ operation: "start", sessionKey: modelKey, commandId: "start", expectedSessionRevision: 0 });
  const modelBefore = await repository.load(modelKey);
  const beforeFactories = stageFactories;
  const modelSnapshot = await modelAdapter.execute({ operation: "snapshot", sessionKey: modelKey, sessionId: modelStarted.sessionRef.sessionId, expectedSessionRevision: modelStarted.sessionRevision });
  assert(!JSON.stringify(modelSnapshot).includes("private-checkpoint-marker"));
  const modelRestored = await modelAdapter.execute({ operation: "restore", sessionKey: { ...modelKey, runtimeId: "tavern-v27-model:restored" }, snapshotRef: modelSnapshot.snapshotRef, expectedSessionRevision: 0 });
  assert.deepEqual((await repository.load(modelRestored.sessionRef)).checkpoint, modelBefore.checkpoint);
  assert.equal(stageFactories, beforeFactories, "snapshot and restore do not instantiate providers");
  const wrongMode = await handler({ operation: "restore", body: { ...modelKey, runtimeId: "tavern-v27:illegal", snapshotRef: modelSnapshot.snapshotRef, commandId: "restore", expectedRevision: 0 } });
  assert.equal(wrongMode.status, 409);
  assert.equal(wrongMode.body.sessionRef, undefined);
  for (const providerKind of ["codex-trusted", "subagent"]) {
    const unsupportedKey = { ...modelKey, runtimeId: `tavern-v27-model:${providerKind}` };
    const record = structuredClone(modelBefore);
    record.key = unsupportedKey;
    record.checkpoint.characterModelSessions = { sessions: [{
      providerCheckpoint: { schemaVersion: `${providerKind}-character-model-provider-checkpoint-v1`, privateState: { codexThreadId: "mutable-external-thread" } },
    }] };
    await repository.createIfAbsent(unsupportedKey, record);
    await assert.rejects(() => modelAdapter.execute({ operation: "snapshot", sessionKey: unsupportedKey, sessionId: record.sessionId, expectedSessionRevision: 0 }),
      error => error.code === "WORLD_RUNTIME_SNAPSHOT_PROVIDER_UNSUPPORTED");
    const unsafeSnapshot = await repository.saveSnapshot(unsupportedKey, { sessionId: record.sessionId, sessionRevision: 0 });
    await assert.rejects(() => modelAdapter.execute({ operation: "restore", sessionKey: { ...unsupportedKey, runtimeId: `${unsupportedKey.runtimeId}:restored` }, snapshotRef: { snapshotId: unsafeSnapshot.snapshotId }, expectedSessionRevision: 0 }),
      error => error.code === "WORLD_RUNTIME_SNAPSHOT_PROVIDER_UNSUPPORTED");
  }
  console.log("review complete world/actor save and restore contracts passed");
} finally { globalThis.fetch = originalFetch; await rm(rootDir, { recursive: true, force: true }); }
