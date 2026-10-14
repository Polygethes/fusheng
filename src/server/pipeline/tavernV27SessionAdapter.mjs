import { TAVERN_SCENE_CHARACTER_IDS, TAVERN_SCENE_POSITIONS } from "./tavernSceneConfiguration.mjs";
import { characterTimePolicy } from "../simulation/characterTimePolicy.mjs";
import { randomUUID } from "node:crypto";
import { createTavernV27FixtureStageRunner } from "./tavernV27FixtureStage.mjs";
import {
  TAVERN_V27_DEFAULT_CHARACTER_IDS,
  createTavernWorldRuntimeV27,
  projectTavernWorldRuntimeV27ForObserver,
} from "./tavernWorldRuntimeV27.mjs";
import { normalizeWorldRuntimeSessionKey } from "../simulation/worldRuntimeSessionRepository.mjs";
import { createWorldRuntimeSessionService } from "../simulation/worldRuntimeSessionService.mjs";

export const TAVERN_V27_SESSION_ADAPTER_VERSION = "tavern-v27-persistent-session-v2";

const OPERATIONS = new Set(["start", "continue", "reset", "snapshot", "restore"]);

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").trim();
}

function fail(code, message, evidence = {}) {
  const error = new Error(message);
  error.code = code;
  error.evidence = clone(evidence);
  return error;
}

function unique(values = []) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function normalizedDefinition(source = {}) {
  const envelope = source?.state && typeof source.state === "object"
    ? source
    : { state: source };
  const state = clone(envelope.state || {});
  const pacingMode = characterTimePolicy(envelope.pacingMode || "scene").mode;
  const characterIds = unique(envelope.characterIds?.length
    ? envelope.characterIds
    : pacingMode === "scene" ? TAVERN_SCENE_CHARACTER_IDS : TAVERN_V27_DEFAULT_CHARACTER_IDS);
  if (!characterIds.length) {
    throw fail("TAVERN_V27_SESSION_CHARACTERS_REQUIRED", "Persistent tavern session requires at least one character.");
  }
  return {
    state,
    characterIds,
    pacingMode,
    openingAfterSeconds: Number(envelope.openingAfterSeconds ?? 900),
    positions: clone(pacingMode === "scene" ? { ...TAVERN_SCENE_POSITIONS, ...envelope.positions } : envelope.positions || {}),
    initialWake: {
      characterId: clean(envelope.initialWake?.characterId) || characterIds[0],
      kind: clean(envelope.initialWake?.kind) || "opportunity_window",
      evidenceIds: unique(envelope.initialWake?.evidenceIds || []),
      evidence: clone(envelope.initialWake?.evidence || []),
    },
  };
}

async function closeInstance(instance) {
  const actors = instance?.runtime?.actors;
  if (!(actors instanceof Map)) return;
  for (const actor of actors.values()) await actor.close?.();
}

function publicResponse(serviceResponse = {}, projectExecutionMetadata = () => ({})) {
  const result = serviceResponse.result || {};
  const observation = clone(result.observation || {});
  const projectedExecution = result.executionMetadata == null
    ? {}
    : clone(projectExecutionMetadata(clone(result.executionMetadata)) || {});
  if (!projectedExecution || typeof projectedExecution !== "object" || Array.isArray(projectedExecution)) {
    throw fail("TAVERN_V27_SESSION_EXECUTION_PROJECTION_INVALID", "Execution metadata projector must return an object.");
  }
  for (const reserved of ["sessionRef", "sessionRevision", "worldVersion", "observation", "staleReplay", "resultSessionRevision"]) {
    if (Object.hasOwn(projectedExecution, reserved)) {
      throw fail("TAVERN_V27_SESSION_EXECUTION_PROJECTION_FORBIDDEN", "Execution metadata may not replace a session authority field.", {
        field: reserved,
      });
    }
  }
  // Match the actual JSON transport on both first execution and durable replay;
  // in-memory `undefined` fields must not make the first response differ from
  // the same command loaded from disk.
  return JSON.parse(JSON.stringify({
    sessionRef: {
      projectId: clean(serviceResponse.sessionKey?.projectId),
      branchId: clean(serviceResponse.sessionKey?.branchId),
      runtimeId: clean(serviceResponse.sessionKey?.runtimeId),
      sessionId: clean(serviceResponse.sessionId),
    },
    sessionRevision: Number(serviceResponse.currentSessionRevision ?? serviceResponse.sessionRevision ?? 0),
    worldVersion: Number(serviceResponse.currentWorldVersion ?? observation.worldVersion ?? 0),
    observation,
    ...projectedExecution,
    ...(serviceResponse.staleReplay === true ? {
      staleReplay: true,
      resultSessionRevision: Number(serviceResponse.resultSessionRevision || 0),
    } : {}),
  }));
}

function dormantStageRunner() {
  throw fail(
    "TAVERN_V27_SESSION_STAGE_OUTSIDE_COMMAND",
    "A Character Agent stage may only run inside an active session command.",
  );
}

function normalizeStageExecution(candidate) {
  if (typeof candidate === "function") {
    return {
      runStage: candidate,
      onStageAccepted: undefined,
      onStageRejected: undefined,
      publicMetadata: undefined,
      checkpoint: undefined,
      close: undefined,
    };
  }
  if (candidate && typeof candidate === "object" && typeof candidate.runStage === "function") {
    return {
      runStage: candidate.runStage,
      onStageAccepted: typeof candidate.onStageAccepted === "function"
        ? candidate.onStageAccepted
        : undefined,
      onStageRejected: typeof candidate.onStageRejected === "function"
        ? candidate.onStageRejected
        : undefined,
      publicMetadata: typeof candidate.publicMetadata === "function"
        ? candidate.publicMetadata
        : undefined,
      checkpoint: typeof candidate.checkpoint === "function"
        ? candidate.checkpoint
        : undefined,
      close: typeof candidate.close === "function"
        ? candidate.close
        : undefined,
    };
  }
  return {
    runStage: dormantStageRunner,
    onStageAccepted: undefined,
    onStageRejected: undefined,
    publicMetadata: undefined,
    checkpoint: undefined,
    close: undefined,
  };
}

function safeSessionRecovery(record = null) {
  if (!record || !clean(record.sessionId)) return null;
  const worldVersion = [
    record?.checkpoint?.coordinator?.journal?.worldVersion,
    record?.checkpoint?.coordinator?.worldState?.worldVersion,
    record?.checkpoint?.worldVersion,
  ].map(Number).find((value) => Number.isFinite(value) && value >= 0);
  return {
    sessionKey: clone(record.key),
    sessionId: clean(record.sessionId),
    sessionRevision: Number(record.sessionRevision || 0),
    worldVersion: Number(worldVersion || 0),
  };
}

function assertSnapshotRestorable(record) {
  const externalMutableProviders = new Set([
    "codex-trusted-character-model-provider-checkpoint-v1",
    "subagent-character-model-provider-checkpoint-v1",
  ]);
  if (record?.checkpoint?.characterModelSessions?.sessions?.some(session => (
    externalMutableProviders.has(session.providerCheckpoint?.schemaVersion)
  ))) {
    throw fail("WORLD_RUNTIME_SNAPSHOT_PROVIDER_UNSUPPORTED",
      "当前模型通道的外部会话尚不支持历史分支，无法创建或读取完整存档。主界面本地模拟与 JSON API 模型上下文支持快照恢复。");
  }
}

/**
 * Bridges the generic durable session service to the v2.7 tavern runtime.
 * The default remains the local fixture, while an injected stageRunnerFactory
 * may install a command-scoped Character Agent provider. The adapter only
 * restores a runtime, advances at most one queued Actor and checkpoints it.
 * Character decisions and world settlement remain inside the injected
 * Character/World runtime pair.
 */
export function createTavernV27SessionAdapter({
  repository,
  stateFactory,
  fixtureStageFactory = createTavernV27FixtureStageRunner,
  stageRunnerFactory = null,
  sessionMode = stageRunnerFactory ? "model" : "fixture",
  maxStageProtocolRepairs = 2,
  enableDayPlanning = false,
  characterAgentCallMode = "three-call",
  projectExecutionMetadata = () => ({}),
  sessionServiceFactory = createWorldRuntimeSessionService,
} = {}) {
  if (!repository || typeof repository.load !== "function") {
    throw fail("TAVERN_V27_SESSION_REPOSITORY_REQUIRED", "Tavern session adapter requires a durable repository.");
  }
  if (typeof stateFactory !== "function") {
    throw fail("TAVERN_V27_SESSION_STATE_FACTORY_REQUIRED", "Tavern session adapter requires an injected stateFactory.");
  }
  const resolvedStageRunnerFactory = stageRunnerFactory || fixtureStageFactory;
  if (typeof resolvedStageRunnerFactory !== "function") {
    throw fail("TAVERN_V27_SESSION_FIXTURE_FACTORY_REQUIRED", "Tavern session adapter requires an injected fixture stage factory.");
  }
  if (typeof projectExecutionMetadata !== "function") {
    throw fail("TAVERN_V27_SESSION_EXECUTION_PROJECTOR_REQUIRED", "Execution metadata projector must be a function.");
  }
  if (!["fixture", "model"].includes(sessionMode)) {
    throw fail("TAVERN_V27_SESSION_MODE_INVALID", "Session mode must be fixture or model.");
  }

  function assertSessionMode(sessionKey, record = null) {
    const namespaceMode = sessionKey.runtimeId.startsWith("tavern-v27-model:") ? "model" : "fixture";
    // Old records predate the explicit mode field. Their namespace still
    // determines ownership; an adapter must never rewrite the other mode.
    if (namespaceMode !== sessionMode || (record?.definition?.sessionMode || namespaceMode) !== sessionMode) {
      throw fail("TAVERN_V27_SESSION_MODE_MISMATCH", "This session belongs to a different runtime mode.");
    }
  }

  async function buildRuntime({ purpose, sessionKey, sessionId, definition, checkpoint, executionContext, persistExecutionCheckpoint }) {
    // A restored save starts an independent session while preserving the
    // original journal's world identity and event hashes.
    const worldId = clean(checkpoint?.coordinator?.worldId) || `world:${sessionId}`;
    const stageExecution = normalizeStageExecution(await resolvedStageRunnerFactory({
      purpose,
      sessionKey: clone(sessionKey),
      sessionId,
      characterModelSessionCheckpoint: clone(checkpoint?.characterModelSessions || null),
      // This command-scoped capability must never become part of definition,
      // checkpoint or observable world state.
      executionContext,
    }));
    const instance = createTavernWorldRuntimeV27(definition.state, {
      characterIds: definition.characterIds,
      pacingMode: definition.pacingMode || "day",
      openingAfterSeconds: definition.openingAfterSeconds ?? 900,
      positions: definition.positions,
      worldId,
      checkpoint,
      runStage: stageExecution.runStage,
      onStageAccepted: stageExecution.onStageAccepted,
      onStageRejected: stageExecution.onStageRejected,
      maxStageProtocolRepairs,
      enableDayPlanning: enableDayPlanning || definition.pacingMode === "scene",
      characterAgentCallMode,
      onExecutionCheckpoint: persistExecutionCheckpoint,
    });
    if (!checkpoint && (purpose === "bootstrap" || purpose === "reset")) {
      const characterId = clean(definition.initialWake?.characterId);
      if (!instance.runtime.actors.has(characterId)) {
        await closeInstance(instance);
        throw fail("TAVERN_V27_SESSION_INITIAL_ACTOR_UNKNOWN", "Initial wake targets a character outside this session.", {
          characterId,
        });
      }
      await instance.runtime.enqueueWake(characterId, {
        wakeId: `wake:session-bootstrap:${sessionId}:${characterId}`,
        kind: clean(definition.initialWake?.kind) || "opportunity_window",
        evidenceIds: clone(definition.initialWake?.evidenceIds || []),
        evidence: clone(definition.initialWake?.evidence || []),
      });
    }
    return {
      instance,
      definition: clone(definition),
      stageExecution,
      async checkpoint() {
        const worldCheckpoint = await instance.runtime.checkpoint();
        if (!stageExecution.checkpoint) return worldCheckpoint;
        const characterModelSessions = clone(await stageExecution.checkpoint());
        return {
          ...worldCheckpoint,
          characterModelSessions,
        };
      },
      async close() {
        await closeInstance(instance);
        if (stageExecution.close) await stageExecution.close();
      },
    };
  }

  const sessionService = sessionServiceFactory({
    repository,
    runtimeFactory: buildRuntime,
    async executeCommand({ runtime, session, command }) {
      const operation = clean(command.input?.operation);
      if (!OPERATIONS.has(operation)) {
        throw fail("TAVERN_V27_SESSION_OPERATION_INVALID", "Unknown persistent tavern session operation.", { operation });
      }
      if (operation === "reset") {
        const fresh = await buildRuntime({
          purpose: "reset",
          sessionKey: session.key,
          sessionId: session.sessionId,
          definition: runtime.definition,
          checkpoint: null,
          executionContext: undefined,
        });
        try {
          const checkpoint = await fresh.checkpoint();
          const observation = projectTavernWorldRuntimeV27ForObserver(fresh.instance, []);
          return { checkpoint, result: { operation, observation } };
        } finally {
          await fresh.close();
        }
      }
      try {
        const turn = await runtime.instance.runtime.runNext();
        const turns = turn ? [turn] : [];
        const observation = projectTavernWorldRuntimeV27ForObserver(runtime.instance, turns);
        const executionMetadata = runtime.stageExecution.publicMetadata
          ? clone(await runtime.stageExecution.publicMetadata())
          : null;
        return { result: { operation, observation, executionMetadata, executionStatus: runtime.instance.runtime.executionStatus.status } };
      } catch (error) {
        if (runtime.stageExecution.publicMetadata) {
          error.publicExecutionMetadata = clone(await runtime.stageExecution.publicMetadata());
        }
        throw error;
      }
    },
  });

  function recordReference(record) {
    const recovery = safeSessionRecovery(record);
    return { ...recovery.sessionKey, sessionId: recovery.sessionId,
      sessionRevision: recovery.sessionRevision, worldVersion: recovery.worldVersion };
  }

  async function restoreSnapshot(sessionKey, snapshotRef, expectedSessionRevision) {
    if (Number(expectedSessionRevision) !== 0) {
      throw fail("WORLD_RUNTIME_SESSION_REVISION_CONFLICT", "Restore requires a new session at revision 0.");
    }
    const source = await repository.loadSnapshot(snapshotRef?.snapshotId);
    assertSessionMode(source.key, source);
    assertSnapshotRestorable(source);
    const sourceRef = recordReference(source);
    if (source.key.projectId !== sessionKey.projectId || source.key.branchId !== sessionKey.branchId
      || Object.entries(sourceRef).some(([field, value]) => snapshotRef?.[field] !== value)
      || source.key.runtimeId === sessionKey.runtimeId) {
      throw fail("WORLD_RUNTIME_SNAPSHOT_REFERENCE_INVALID", "Restore requires the matching snapshot and a new runtime in the same project branch.");
    }
    const sessionId = `runtime-session:${randomUUID()}`;
    const timestamp = new Date().toISOString();
    const restored = await repository.createIfAbsent(sessionKey, {
      sessionId,
      worldId: source.worldId,
      runtimeVersion: source.runtimeVersion,
      definition: clone(source.definition), definitionHash: source.definitionHash,
      checkpoint: clone(source.checkpoint), commands: [],
      restoredFromSnapshotId: snapshotRef.snapshotId,
      createdAt: timestamp, updatedAt: timestamp,
    });
    assertSessionMode(sessionKey, restored.record);
    if (restored.record.restoredFromSnapshotId !== snapshotRef.snapshotId || restored.record.sessionRevision !== 0) {
      throw fail("WORLD_RUNTIME_SESSION_REVISION_CONFLICT", "The restore target has already been used.");
    }
    const reference = recordReference(restored.record);
    return { sessionRef: reference, sessionRevision: reference.sessionRevision, worldVersion: reference.worldVersion };
  }

  return {
    schemaVersion: TAVERN_V27_SESSION_ADAPTER_VERSION,
    async execute({
      operation: rawOperation,
      sessionKey: inputKey,
      commandId,
      sessionId: rawSessionId = "",
      expectedSessionRevision,
      snapshotRef = null,
      executionContext = undefined,
    } = {}) {
      const operation = clean(rawOperation);
      if (!OPERATIONS.has(operation)) {
        throw fail("TAVERN_V27_SESSION_OPERATION_INVALID", "Operation must be start, continue or reset.", { operation });
      }
      const sessionKey = normalizeWorldRuntimeSessionKey(inputKey);
      const sessionId = clean(rawSessionId);
      try {
        assertSessionMode(sessionKey);
        const existing = await repository.load(sessionKey);
        assertSessionMode(sessionKey, existing);
        if (operation === "restore") return await restoreSnapshot(sessionKey, snapshotRef, expectedSessionRevision);
        if (operation !== "start" && !sessionId) {
          throw fail("TAVERN_V27_SESSION_ID_REQUIRED", "continue and reset require the opaque sessionId returned by start.");
        }
        if (existing && sessionId && clean(existing.sessionId) !== sessionId) {
          throw fail("TAVERN_V27_SESSION_ID_MISMATCH", "The supplied sessionId does not identify the current world session.");
        }
        if (operation === "snapshot") {
          assertSnapshotRestorable(existing);
          const saved = await repository.saveSnapshot(sessionKey, { sessionId, sessionRevision: expectedSessionRevision });
          assertSessionMode(sessionKey, saved.record);
          assertSnapshotRestorable(saved.record);
          return { snapshotRef: { snapshotId: saved.snapshotId, ...recordReference(saved.record) } };
        }
        let bootstrap = null;
        if (operation === "start") {
          const replay = existing?.commands?.some((row) => clean(row.commandId) === clean(commandId));
          if (existing && !replay) {
            throw fail("TAVERN_V27_SESSION_ALREADY_STARTED", "This project branch already has a persistent tavern session.", {
              sessionKey,
            });
          }
          if (!existing) {
            if (Number(expectedSessionRevision) !== 0) {
              throw fail("WORLD_RUNTIME_SESSION_REVISION_CONFLICT", "A new session must start at expected revision 0.", {
                actualSessionRevision: null,
                expectedSessionRevision,
              });
            }
            const definition = normalizedDefinition(await stateFactory({ sessionKey: clone(sessionKey) }));
            definition.sessionMode = sessionMode;
            bootstrap = {
              definition,
              runtimeVersion: TAVERN_V27_SESSION_ADAPTER_VERSION,
            };
          }
        } else if (!existing) {
          throw fail("WORLD_RUNTIME_SESSION_NOT_FOUND", "Start this project branch session before continuing or resetting it.", {
            sessionKey,
          });
        }

        const response = await sessionService.runCommand({
          sessionKey,
          commandId,
          expectedSessionRevision: Number(expectedSessionRevision),
          bootstrap,
          commandInput: { operation },
          executionContext,
        });
        return publicResponse(response, projectExecutionMetadata);
      } catch (error) {
        const current = await repository.load(sessionKey).catch(() => null);
        const recovery = safeSessionRecovery(current);
        if (recovery && ![
          "TAVERN_V27_SESSION_ID_REQUIRED",
          "TAVERN_V27_SESSION_ID_MISMATCH",
          "TAVERN_V27_SESSION_MODE_MISMATCH",
        ].includes(clean(error?.code))) error.sessionRecovery = recovery;
        throw error;
      }
    },
  };
}
