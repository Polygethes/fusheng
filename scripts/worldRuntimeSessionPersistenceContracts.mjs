import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createFileWorldRuntimeSessionRepository,
  worldRuntimeSessionStorageId,
} from "../src/server/simulation/worldRuntimeSessionRepository.mjs";
import {
  createWorldRuntimeSessionService,
  hashWorldRuntimeSessionValue,
} from "../src/server/simulation/worldRuntimeSessionService.mjs";

const rootDir = await mkdtemp(path.join(tmpdir(), "gtown-world-runtime-sessions-"));
const executionCounts = new Map();
let blockedCommandStarted;
let releaseBlockedCommand;
const blockedStarted = new Promise((resolve) => { blockedCommandStarted = resolve; });
const blockedGate = new Promise((resolve) => { releaseBlockedCommand = resolve; });

function clone(value) {
  return structuredClone(value);
}

function initialCheckpoint(definition = {}) {
  const actorId = definition.actorId || "char:probe";
  return {
    coordinator: {
      journal: { worldVersion: 0, events: [] },
      worldState: { marker: definition.marker || "", worldVersion: 0 },
      outcomes: [],
    },
    actors: [{
      characterId: actorId,
      privateState: { ownerCharacterId: actorId, commandHistory: [] },
      mailbox: [{ wakeId: `wake:bootstrap:${actorId}`, kind: "opportunity_window" }],
      privateJournal: [],
      seenWakeIds: [],
      pendingAttemptIds: [],
      turnSequence: 0,
      runtimeCheckpoint: null,
    }],
    receiptLedger: { receipts: [] },
    readyQueue: [actorId],
  };
}

async function runtimeFactory({ definition, checkpoint }) {
  const state = checkpoint ? clone(checkpoint) : initialCheckpoint(definition);
  return {
    state,
    async checkpoint() { return clone(state); },
  };
}

async function executeCommand({ runtime, session, command }) {
  const storageId = worldRuntimeSessionStorageId(session.key);
  executionCounts.set(storageId, Number(executionCounts.get(storageId) || 0) + 1);
  if (command.input.blockUntilReleased) {
    blockedCommandStarted();
    await blockedGate;
  }
  const actor = runtime.state.actors[0];
  actor.turnSequence += 1;
  actor.privateState.commandHistory.push(command.commandId);
  actor.mailbox.shift();
  runtime.state.readyQueue = [];
  if (command.input.kind !== "silent") {
    const nextVersion = runtime.state.coordinator.journal.worldVersion + 1;
    runtime.state.coordinator.journal.worldVersion = nextVersion;
    runtime.state.coordinator.journal.events.push({
      eventId: `event:${session.sessionId}:${nextVersion}`,
      worldVersion: nextVersion,
      commandId: command.commandId,
    });
    runtime.state.coordinator.worldState.worldVersion = nextVersion;
  }
  return {
    result: {
      marker: runtime.state.coordinator.worldState.marker,
      actorTurnSequence: actor.turnSequence,
      worldVersion: runtime.state.coordinator.journal.worldVersion,
      commandId: command.commandId,
    },
  };
}

function service(repository, overrides = {}) {
  return createWorldRuntimeSessionService({
    repository,
    runtimeFactory,
    executeCommand,
    duplicateWaitMs: 2_000,
    duplicatePollMs: 5,
    ...overrides,
  });
}

const mainKey = { projectId: "project:one", branchId: "branch:main", runtimeId: "world-main" };
const mainDefinition = { actorId: "char:main", marker: "project-one-main" };
const repositoryA = createFileWorldRuntimeSessionRepository({ rootDir });
const serviceA = service(repositoryA);

try {
  const first = await serviceA.runCommand({
    sessionKey: mainKey,
    commandId: "command:main:1",
    expectedSessionRevision: 0,
    bootstrap: { definition: mainDefinition, runtimeVersion: "fixture-v1" },
    commandInput: { kind: "silent", payload: { b: 2, a: 1 } },
  });
  assert.equal(first.sessionRevision, 2, "preparation and atomic completion use independent session revisions");
  assert.equal(first.result.worldVersion, 0, "a private/silent turn can persist without incrementing worldVersion");
  assert.equal(first.result.actorTurnSequence, 1);

  const duplicate = await serviceA.runCommand({
    sessionKey: mainKey,
    commandId: "command:main:1",
    expectedSessionRevision: 0,
    bootstrap: { definition: { marker: "project-one-main", actorId: "char:main" } },
    commandInput: { payload: { a: 1, b: 2 }, kind: "silent" },
  });
  assert.equal(duplicate.replayed, true);
  assert.equal(duplicate.result.actorTurnSequence, 1);
  assert.equal(executionCounts.get(worldRuntimeSessionStorageId(mainKey)), 1, "an idempotent replay may not execute the command again");

  await assert.rejects(serviceA.runCommand({
    sessionKey: mainKey,
    commandId: "command:main:1",
    expectedSessionRevision: 2,
    commandInput: { kind: "act", payload: { a: 1, b: 2 } },
  }), (error) => error.code === "WORLD_RUNTIME_COMMAND_ID_REUSED");

  // Recreate both repository and service. No module-level Map or live runtime
  // object is available to the second command.
  const repositoryAfterRestart = createFileWorldRuntimeSessionRepository({ rootDir });
  const serviceAfterRestart = service(repositoryAfterRestart);
  const second = await serviceAfterRestart.runCommand({
    sessionKey: mainKey,
    commandId: "command:main:2",
    expectedSessionRevision: 2,
    commandInput: { kind: "act" },
  });
  assert.equal(second.sessionRevision, 4);
  assert.equal(second.result.actorTurnSequence, 2, "actor sequence must survive repository/service reconstruction");
  assert.equal(second.result.worldVersion, 1);
  const restoredMain = await repositoryAfterRestart.load(mainKey);
  assert.deepEqual(restoredMain.checkpoint.actors[0].privateState.commandHistory, ["command:main:1", "command:main:2"]);
  assert.equal(restoredMain.checkpoint.coordinator.journal.events.length, 1);

  const lateReplay = await serviceAfterRestart.runCommand({
    sessionKey: mainKey,
    commandId: "command:main:1",
    expectedSessionRevision: 0,
    commandInput: { payload: { a: 1, b: 2 }, kind: "silent" },
  });
  assert.equal(lateReplay.replayed, true);
  assert.equal(lateReplay.staleReplay, true, "a completed command replayed after later commits must be marked stale");
  assert.equal(lateReplay.resultSessionRevision, 2);
  assert.equal(lateReplay.sessionRevision, 4, "a late replay must return the current cursor, not roll it back to its result revision");
  assert.equal(lateReplay.currentSessionRevision, 4);
  assert.equal(executionCounts.get(worldRuntimeSessionStorageId(mainKey)), 2);

  await assert.rejects(serviceAfterRestart.runCommand({
    sessionKey: mainKey,
    commandId: "command:main:definition-conflict",
    expectedSessionRevision: 4,
    bootstrap: { definition: { actorId: "char:main", marker: "silently-replaced" } },
    commandInput: { kind: "silent" },
  }), (error) => error.code === "WORLD_RUNTIME_SESSION_DEFINITION_CONFLICT");

  const alternateBranchKey = { projectId: "project:one", branchId: "branch:alternate", runtimeId: "world-main" };
  const otherProjectKey = { projectId: "project:two", branchId: "branch:main", runtimeId: "world-main" };
  await serviceAfterRestart.runCommand({
    sessionKey: alternateBranchKey,
    commandId: "command:alternate:1",
    expectedSessionRevision: 0,
    bootstrap: { definition: { actorId: "char:alternate", marker: "project-one-alternate" } },
    commandInput: { kind: "act" },
  });
  await serviceAfterRestart.runCommand({
    sessionKey: otherProjectKey,
    commandId: "command:other-project:1",
    expectedSessionRevision: 0,
    bootstrap: { definition: { actorId: "char:other", marker: "project-two-main" } },
    commandInput: { kind: "act" },
  });
  const [mainRecord, alternateRecord, otherRecord] = await Promise.all([
    repositoryAfterRestart.load(mainKey),
    repositoryAfterRestart.load(alternateBranchKey),
    repositoryAfterRestart.load(otherProjectKey),
  ]);
  assert.equal(mainRecord.checkpoint.coordinator.worldState.marker, "project-one-main");
  assert.equal(alternateRecord.checkpoint.coordinator.worldState.marker, "project-one-alternate");
  assert.equal(otherRecord.checkpoint.coordinator.worldState.marker, "project-two-main");
  assert.equal(new Set([
    worldRuntimeSessionStorageId(mainKey),
    worldRuntimeSessionStorageId(alternateBranchKey),
    worldRuntimeSessionStorageId(otherProjectKey),
  ]).size, 3, "project, branch and runtime must all participate in durable isolation");

  // Two independent repository objects perform CAS against the same durable
  // generation. Exactly one is allowed to advance it.
  const casKey = { projectId: "project:cas", branchId: "branch:main", runtimeId: "world-main" };
  await repositoryA.createIfAbsent(casKey, {
    sessionId: "session:cas",
    definition: {},
    definitionHash: hashWorldRuntimeSessionValue({}),
    checkpoint: { winner: "none" },
    commands: [],
  });
  const casBase = await repositoryA.load(casKey);
  const casResults = await Promise.allSettled([
    repositoryA.compareAndSwap(casKey, {
      expectedSessionRevision: 0,
      nextRecord: { ...casBase, checkpoint: { winner: "left" } },
    }),
    repositoryAfterRestart.compareAndSwap(casKey, {
      expectedSessionRevision: 0,
      nextRecord: { ...casBase, checkpoint: { winner: "right" } },
    }),
  ]);
  assert.equal(casResults.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal(casResults.filter((row) => row.status === "rejected").length, 1);
  assert.equal(
    casResults.find((row) => row.status === "rejected").reason.code,
    "WORLD_RUNTIME_SESSION_REVISION_CONFLICT",
  );

  // Concurrent duplicates across separate service/repository objects share one
  // durable prepared command; the second waits and replays the completed one.
  const concurrentKey = { projectId: "project:concurrent", branchId: "branch:main", runtimeId: "world-main" };
  const concurrentA = service(createFileWorldRuntimeSessionRepository({ rootDir }));
  const concurrentB = service(createFileWorldRuntimeSessionRepository({ rootDir }));
  const firstConcurrent = concurrentA.runCommand({
    sessionKey: concurrentKey,
    commandId: "command:concurrent:1",
    expectedSessionRevision: 0,
    bootstrap: { definition: { actorId: "char:concurrent", marker: "concurrent" } },
    commandInput: { kind: "act", blockUntilReleased: true },
  });
  await blockedStarted;
  const duplicateConcurrent = concurrentB.runCommand({
    sessionKey: concurrentKey,
    commandId: "command:concurrent:1",
    expectedSessionRevision: 0,
    commandInput: { blockUntilReleased: true, kind: "act" },
  });
  setTimeout(releaseBlockedCommand, 25);
  const concurrentResponses = await Promise.all([firstConcurrent, duplicateConcurrent]);
  assert.equal(executionCounts.get(worldRuntimeSessionStorageId(concurrentKey)), 1);
  assert.equal(concurrentResponses.filter((row) => row.replayed).length, 1);
  assert.equal(concurrentResponses[0].result.commandId, concurrentResponses[1].result.commandId);

  // A failed execution is durably recorded, but its safe recovery cursor must
  // accompany the error so a new command can continue without reading the
  // private checkpoint.
  const failedKey = { projectId: "project:failed", branchId: "branch:main", runtimeId: "world-main" };
  const failedRepository = createFileWorldRuntimeSessionRepository({ rootDir });
  const failingService = service(failedRepository, {
    async executeCommand() {
      const error = new Error("fixture execution failed");
      error.code = "FIXTURE_EXECUTION_FAILED";
      throw error;
    },
  });
  let failedExecution;
  try {
    await failingService.runCommand({
      sessionKey: failedKey,
      commandId: "command:failed:1",
      expectedSessionRevision: 0,
      bootstrap: { definition: { actorId: "char:failed", marker: "failed" } },
      commandInput: { kind: "act" },
    });
    assert.fail("the injected execution failure must reject");
  } catch (error) {
    failedExecution = error;
  }
  assert.equal(failedExecution.code, "FIXTURE_EXECUTION_FAILED");
  assert.deepEqual(failedExecution.sessionRecovery?.sessionKey, failedKey);
  assert.equal(failedExecution.sessionRecovery?.sessionRevision, 2);
  assert.equal(failedExecution.sessionRecovery?.worldVersion, 0);
  const failedSerialized = JSON.stringify(failedExecution.sessionRecovery);
  assert.equal(failedSerialized.includes("checkpoint"), false);
  assert.equal(failedSerialized.includes("privateState"), false);
  const continuedAfterFailure = await service(failedRepository).runCommand({
    sessionKey: failedKey,
    commandId: "command:failed:2",
    expectedSessionRevision: failedExecution.sessionRecovery.sessionRevision,
    commandInput: { kind: "act" },
  });
  assert.equal(continuedAfterFailure.sessionRevision, 4);
  assert.equal(continuedAfterFailure.result.actorTurnSequence, 1);

  // A process may disappear after the durable prepare. Once its lease expires,
  // another command may fence that owner and continue from the unchanged
  // checkpoint, even when the caller still has the pre-prepare cursor.
  const expiredKey = { projectId: "project:expired", branchId: "branch:main", runtimeId: "world-main" };
  const expiredRepository = createFileWorldRuntimeSessionRepository({ rootDir });
  const expiredDefinition = { actorId: "char:expired", marker: "expired" };
  await expiredRepository.createIfAbsent(expiredKey, {
    sessionId: "session:expired",
    worldId: "world:expired",
    runtimeVersion: "fixture-v1",
    definition: expiredDefinition,
    definitionHash: hashWorldRuntimeSessionValue(expiredDefinition),
    checkpoint: initialCheckpoint(expiredDefinition),
    commands: [],
  });
  const expiredBase = await expiredRepository.load(expiredKey);
  await expiredRepository.compareAndSwap(expiredKey, {
    expectedSessionRevision: 0,
    nextRecord: {
      ...expiredBase,
      commands: [{
        commandId: "command:expired:owner",
        inputHash: hashWorldRuntimeSessionValue({ kind: "silent" }),
        status: "prepared",
        baseSessionRevision: 0,
        leaseOwner: "dead-process",
        leaseExpiresAtMs: 0,
        attemptCount: 1,
      }],
    },
  });
  const recoveredExpired = await service(expiredRepository).runCommand({
    sessionKey: expiredKey,
    commandId: "command:expired:replacement",
    expectedSessionRevision: 0,
    commandInput: { kind: "act" },
  });
  assert.equal(recoveredExpired.result.actorTurnSequence, 1);
  const afterExpiredRecovery = await expiredRepository.load(expiredKey);
  const fencedOwner = afterExpiredRecovery.commands.find((row) => row.commandId === "command:expired:owner");
  assert.equal(fencedOwner.status, "failed");
  assert.equal(fencedOwner.error?.code, "WORLD_RUNTIME_COMMAND_LEASE_EXPIRED");

  // If the original owner commits after an observer has noticed lease expiry
  // but before that observer reloads, the completed command must be replayed.
  // It must never be reopened as prepared and executed twice.
  const raceKey = { projectId: "project:lease-race", branchId: "branch:main", runtimeId: "world-main" };
  const raceBaseRepository = createFileWorldRuntimeSessionRepository({ rootDir });
  const raceDefinition = { actorId: "char:lease-race", marker: "lease-race" };
  const raceInput = { kind: "silent" };
  await raceBaseRepository.createIfAbsent(raceKey, {
    sessionId: "session:lease-race",
    worldId: "world:lease-race",
    runtimeVersion: "fixture-v1",
    definition: raceDefinition,
    definitionHash: hashWorldRuntimeSessionValue(raceDefinition),
    checkpoint: initialCheckpoint(raceDefinition),
    commands: [],
  });
  const raceBase = await raceBaseRepository.load(raceKey);
  const racePrepared = {
    commandId: "command:lease-race:1",
    inputHash: hashWorldRuntimeSessionValue(raceInput),
    status: "prepared",
    baseSessionRevision: 0,
    leaseOwner: "slow-owner",
    leaseExpiresAtMs: 0,
    attemptCount: 1,
  };
  await raceBaseRepository.compareAndSwap(raceKey, {
    expectedSessionRevision: 0,
    nextRecord: { ...raceBase, commands: [racePrepared] },
  });
  const raceRepository = {
    ...raceBaseRepository,
    loadCount: 0,
    async load(key) {
      const observed = await raceBaseRepository.load(key);
      this.loadCount += 1;
      if (this.loadCount === 2) {
        const completedCheckpoint = initialCheckpoint(raceDefinition);
        completedCheckpoint.actors[0].turnSequence = 1;
        completedCheckpoint.actors[0].privateState.commandHistory = [racePrepared.commandId];
        completedCheckpoint.actors[0].mailbox = [];
        completedCheckpoint.readyQueue = [];
        await raceBaseRepository.compareAndSwap(key, {
          expectedSessionRevision: 1,
          nextRecord: {
            ...observed,
            checkpoint: completedCheckpoint,
            commands: [{
              ...racePrepared,
              status: "completed",
              leaseOwner: "",
              leaseExpiresAtMs: 0,
              resultSessionRevision: 2,
              result: {
                marker: "lease-race",
                actorTurnSequence: 1,
                worldVersion: 0,
                commandId: racePrepared.commandId,
              },
            }],
          },
        });
      }
      return observed;
    },
  };
  const raceReplay = await service(raceRepository).runCommand({
    sessionKey: raceKey,
    commandId: racePrepared.commandId,
    expectedSessionRevision: 0,
    commandInput: raceInput,
  });
  assert.equal(raceReplay.replayed, true);
  assert.equal(raceReplay.result.actorTurnSequence, 1);
  assert.equal(Number(executionCounts.get(worldRuntimeSessionStorageId(raceKey)) || 0), 0);

  // The completed generation contains the checkpoint and matching command
  // result together. A torn temporary file is ignored after reconstruction.
  const mainDirectory = path.join(rootDir, worldRuntimeSessionStorageId(mainKey));
  const generationNames = (await readdir(mainDirectory))
    .filter((name) => /^generation-\d{16}\.json$/u.test(name))
    .sort();
  assert.ok(generationNames.length <= 4, "each session must retain only a bounded number of finalized generations");
  const latestGeneration = JSON.parse(await readFile(path.join(mainDirectory, generationNames.at(-1)), "utf8"));
  const latestCommand = latestGeneration.commands.find((row) => row.commandId === "command:main:2");
  assert.equal(latestGeneration.sessionRevision, 4);
  assert.equal(latestGeneration.checkpoint.coordinator.journal.worldVersion, 1);
  assert.equal(latestCommand.status, "completed");
  assert.equal(latestCommand.result.worldVersion, 1);
  await writeFile(path.join(mainDirectory, ".generation-9999999999999999.json.torn.tmp"), "{\"checkpoint\":", "utf8");
  const afterTornWrite = await createFileWorldRuntimeSessionRepository({ rootDir }).load(mainKey);
  assert.equal(afterTornWrite.sessionRevision, 4);
  assert.equal(afterTornWrite.checkpoint.coordinator.journal.worldVersion, 1);

  assert.equal(
    hashWorldRuntimeSessionValue({ b: 2, a: { y: 2, x: 1 } }),
    hashWorldRuntimeSessionValue({ a: { x: 1, y: 2 }, b: 2 }),
    "input hashes must not depend on object key insertion order",
  );

  console.log(JSON.stringify({
    status: "all-passed",
    checks: {
      projectBranchRuntimeIsolation: true,
      independentSessionRevision: true,
      commandInputIdempotency: true,
      concurrentDuplicateSingleExecution: true,
      failedCommandRecoveryCursor: true,
      expiredLeaseFencedByNewCommand: true,
      leaseExpiryCompletionRaceDoesNotReexecute: true,
      lateReplayReturnsCurrentRevision: true,
      compareAndSwapConflict: true,
      checkpointAndResultAtomicGeneration: true,
      finalizedGenerationRetentionBounded: true,
      repositoryAndServiceRestart: true,
      tornTemporaryGenerationIgnored: true,
      definitionReplacementRejected: true,
      injectedRuntimeAndExecutor: true,
    },
  }, null, 2));
} finally {
  await rm(rootDir, { recursive: true, force: true });
}
