import { createHash, randomUUID } from "node:crypto";

import {
  WORLD_RUNTIME_SESSION_RECORD_VERSION,
  normalizeWorldRuntimeSessionKey,
} from "./worldRuntimeSessionRepository.mjs";

/**
 * Persistence orchestration around an injected runtime.
 *
 * The service may restore, execute and checkpoint a runtime, but has no action
 * vocabulary and never chooses for a character or resolves a world effect.
 */
export const WORLD_RUNTIME_SESSION_SERVICE_VERSION = "world-runtime-session-service-v1";

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

function canonicalValue(value, seen = new Set()) {
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return {
        __gtown_world_runtime_number_v1__: Number.isNaN(value)
          ? "NaN"
          : value === Number.POSITIVE_INFINITY ? "+Infinity" : "-Infinity",
      };
    }
    return value;
  }
  if (typeof value !== "object") {
    throw fail("WORLD_RUNTIME_SESSION_VALUE_NOT_SERIALIZABLE", "Session values must be JSON serializable.", {
      valueType: typeof value,
    });
  }
  if (seen.has(value)) throw fail("WORLD_RUNTIME_SESSION_VALUE_CYCLIC", "Session values may not contain cycles.");
  seen.add(value);
  let normalized;
  if (Array.isArray(value)) normalized = value.map((child) => canonicalValue(child, seen));
  else normalized = Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key], seen)]),
  );
  seen.delete(value);
  return normalized;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalValue(value));
}

function serializableClone(value) {
  // Validate the full graph and obtain a deterministic hash surface, while
  // preserving runtime-only numeric sentinels such as Infinity in memory. The
  // file repository owns their tagged JSON encoding at the storage boundary.
  canonicalStringify(value);
  return clone(value);
}

export function hashWorldRuntimeSessionValue(value) {
  return createHash("sha256").update(canonicalStringify(value)).digest("hex");
}

function commandRows(record = {}) {
  return Array.isArray(record.commands) ? record.commands : [];
}

function commandById(record = {}, commandId = "") {
  return commandRows(record).find((row) => clean(row.commandId) === clean(commandId)) || null;
}

function replaceCommand(record = {}, command = {}) {
  const rows = commandRows(record);
  const index = rows.findIndex((row) => clean(row.commandId) === clean(command.commandId));
  const commands = rows.map(clone);
  if (index >= 0) commands[index] = clone(command);
  else commands.push(clone(command));
  return commands;
}

function safeStoredError(error) {
  return {
    code: clean(error?.code) || "WORLD_RUNTIME_COMMAND_FAILED",
    message: clean(error?.message) || "World runtime command failed.",
  };
}

function previousFailure(command = {}) {
  const stored = command.error || {};
  return fail(
    clean(stored.code) || "WORLD_RUNTIME_COMMAND_PREVIOUSLY_FAILED",
    clean(stored.message) || "This world runtime command previously failed.",
    { commandId: command.commandId, replayedFailure: true },
  );
}

function recordWorldVersion(record = {}) {
  const candidates = [
    record?.checkpoint?.coordinator?.journal?.worldVersion,
    record?.checkpoint?.coordinator?.worldState?.worldVersion,
    record?.checkpoint?.worldVersion,
  ];
  const value = candidates.map(Number).find((candidate) => Number.isFinite(candidate) && candidate >= 0);
  return Number(value || 0);
}

function sessionRecoveryFor(record = null) {
  if (!record || !clean(record.sessionId)) return null;
  return {
    sessionKey: clone(record.key),
    sessionId: clean(record.sessionId),
    sessionRevision: Number(record.sessionRevision || 0),
    worldVersion: recordWorldVersion(record),
  };
}

function withSessionRecovery(error, record) {
  const target = error instanceof Error
    ? error
    : fail("WORLD_RUNTIME_COMMAND_FAILED", clean(error) || "World runtime command failed.");
  const recovery = sessionRecoveryFor(record);
  if (recovery) target.sessionRecovery = recovery;
  return target;
}

function responseFor(record = {}, command = {}, { replayed = false } = {}) {
  const resultSessionRevision = Number(command.resultSessionRevision ?? record.sessionRevision);
  const currentSessionRevision = Number(record.sessionRevision || 0);
  return {
    authority: "world-runtime-session",
    schemaVersion: WORLD_RUNTIME_SESSION_SERVICE_VERSION,
    sessionKey: clone(record.key),
    sessionId: clean(record.sessionId),
    commandId: clean(command.commandId),
    inputHash: clean(command.inputHash),
    sessionRevision: currentSessionRevision,
    currentSessionRevision,
    resultSessionRevision,
    currentWorldVersion: recordWorldVersion(record),
    replayed,
    staleReplay: replayed && resultSessionRevision < currentSessionRevision,
    result: clone(command.result),
  };
}

function assertMatchingInput(command, inputHash) {
  if (clean(command.inputHash) !== clean(inputHash)) {
    throw fail("WORLD_RUNTIME_COMMAND_ID_REUSED", "The same commandId was reused with different input.", {
      commandId: command.commandId,
      expectedInputHash: command.inputHash,
      actualInputHash: inputHash,
    });
  }
}

async function runtimeCheckpoint(runtime, suppliedCheckpoint) {
  if (suppliedCheckpoint !== undefined) return serializableClone(suppliedCheckpoint);
  if (typeof runtime?.checkpoint !== "function") {
    throw fail("WORLD_RUNTIME_SESSION_CHECKPOINT_REQUIRED", "Runtime execution must return a checkpoint or expose checkpoint().");
  }
  return serializableClone(await runtime.checkpoint());
}

async function closeRuntime(runtime) {
  if (typeof runtime?.close === "function") await runtime.close();
}

export function createWorldRuntimeSessionService({
  repository,
  runtimeFactory,
  executeCommand,
  now = () => new Date().toISOString(),
  clockMs = () => Date.now(),
  idFactory = () => `runtime-session:${randomUUID()}`,
  commandLeaseMs = 15 * 60_000,
  duplicateWaitMs = 5_000,
  duplicatePollMs = 10,
} = {}) {
  if (!repository || typeof repository.load !== "function"
    || typeof repository.createIfAbsent !== "function"
    || typeof repository.compareAndSwap !== "function") {
    throw fail("WORLD_RUNTIME_SESSION_REPOSITORY_REQUIRED", "World runtime session service requires a durable repository.");
  }
  if (typeof runtimeFactory !== "function") {
    throw fail("WORLD_RUNTIME_SESSION_FACTORY_REQUIRED", "World runtime session service requires an injected runtimeFactory.");
  }
  if (typeof executeCommand !== "function") {
    throw fail("WORLD_RUNTIME_SESSION_EXECUTOR_REQUIRED", "World runtime session service requires an injected executeCommand function.");
  }

  const serviceId = `runtime-session-service:${randomUUID()}`;

  async function createInitialSession(key, bootstrap = {}) {
    const definition = serializableClone(bootstrap.definition || {});
    const definitionHash = hashWorldRuntimeSessionValue(definition);
    const sessionId = clean(bootstrap.sessionId) || clean(idFactory(key));
    if (!sessionId) throw fail("WORLD_RUNTIME_SESSION_ID_REQUIRED", "Session id factory returned an empty id.");
    let runtime;
    let checkpoint;
    try {
      runtime = await runtimeFactory({
        purpose: "bootstrap",
        sessionKey: clone(key),
        sessionId,
        definition: clone(definition),
        checkpoint: bootstrap.checkpoint == null ? null : clone(bootstrap.checkpoint),
      });
      checkpoint = await runtimeCheckpoint(runtime, bootstrap.checkpoint);
    } finally {
      await closeRuntime(runtime);
    }
    const timestamp = now();
    const created = await repository.createIfAbsent(key, {
      schemaVersion: WORLD_RUNTIME_SESSION_RECORD_VERSION,
      sessionId,
      worldId: clean(bootstrap.worldId) || `world:${sessionId}`,
      runtimeVersion: clean(bootstrap.runtimeVersion),
      definition,
      definitionHash,
      checkpoint,
      commands: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return created.record;
  }

  function assertDefinitionCompatible(record, bootstrap) {
    if (!bootstrap || !Object.hasOwn(bootstrap, "definition")) return;
    const supplied = hashWorldRuntimeSessionValue(bootstrap.definition || {});
    if (clean(record.definitionHash) !== supplied) {
      throw fail("WORLD_RUNTIME_SESSION_DEFINITION_CONFLICT", "Existing session was created from a different runtime definition.", {
        expectedDefinitionHash: record.definitionHash,
        actualDefinitionHash: supplied,
      });
    }
  }

  async function waitForCommand(key, commandId, inputHash) {
    const deadline = clockMs() + Math.max(0, Number(duplicateWaitMs || 0));
    while (clockMs() <= deadline) {
      const record = await repository.load(key);
      const command = commandById(record, commandId);
      if (!command) return null;
      assertMatchingInput(command, inputHash);
      if (command.status === "completed") return responseFor(record, command, { replayed: true });
      if (command.status === "failed") throw previousFailure(command);
      if (Number(command.leaseExpiresAtMs || 0) <= clockMs()) return null;
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, Number(duplicatePollMs || 10))));
    }
    throw fail("WORLD_RUNTIME_COMMAND_IN_PROGRESS", "The same command is already running.", {
      commandId,
      retryable: true,
    });
  }

  async function resolveExistingCommand(record, key, commandId, inputHash, { refreshExpired = true } = {}) {
    const existing = commandById(record, commandId);
    if (!existing) return { record };
    assertMatchingInput(existing, inputHash);
    if (existing.status === "completed") {
      return { response: responseFor(record, existing, { replayed: true }) };
    }
    if (existing.status === "failed") throw previousFailure(existing);
    if (existing.status !== "prepared") {
      throw fail("WORLD_RUNTIME_COMMAND_STATE_INVALID", "Persisted world runtime command has an unsupported state.", {
        commandId,
        status: existing.status,
      });
    }
    if (Number(existing.leaseExpiresAtMs || 0) <= clockMs()) {
      if (refreshExpired) {
        return resolveExistingCommand(
          await repository.load(key),
          key,
          commandId,
          inputHash,
          { refreshExpired: false },
        );
      }
      return { record };
    }
    const waited = await waitForCommand(key, commandId, inputHash);
    if (waited) return { response: waited };

    // The owner may have committed between observing lease expiry and this
    // reload. Re-enter state resolution before attempting a takeover so a
    // completed command can never be reopened and executed twice.
    return resolveExistingCommand(
      await repository.load(key),
      key,
      commandId,
      inputHash,
      { refreshExpired: false },
    );
  }

  async function claimCommand(record, key, commandId, inputHash, expectedSessionRevision) {
    if (commandById(record, commandId)) {
      const resolved = await resolveExistingCommand(record, key, commandId, inputHash);
      if (resolved.response) return { response: resolved.response };
      record = resolved.record;
    }

    const activeOther = commandRows(record).find((row) => row.status === "prepared" && clean(row.commandId) !== commandId);
    const activeOtherExpired = activeOther && Number(activeOther.leaseExpiresAtMs || 0) <= clockMs();
    if (activeOther && !activeOtherExpired) {
      throw fail("WORLD_RUNTIME_COMMAND_IN_PROGRESS", "Another command is already running for this session.", {
        commandId: activeOther.commandId,
        retryable: true,
      });
    }

    const previous = commandById(record, commandId);
    const mayRecoverExpiredOther = activeOtherExpired && [
      Number(record.sessionRevision),
      Number(activeOther.baseSessionRevision),
    ].includes(Number(expectedSessionRevision));
    if (!previous && record.sessionRevision !== expectedSessionRevision && !mayRecoverExpiredOther) {
      throw fail("WORLD_RUNTIME_SESSION_REVISION_CONFLICT", "World runtime session changed before this command could start.", {
        expectedSessionRevision,
        actualSessionRevision: record.sessionRevision,
        key,
      });
    }

    const timestamp = now();
    let commandRecord = record;
    if (activeOtherExpired) {
      const fenced = {
        ...clone(activeOther),
        status: "failed",
        failedAt: timestamp,
        leaseOwner: "",
        leaseExpiresAtMs: 0,
        error: {
          code: "WORLD_RUNTIME_COMMAND_LEASE_EXPIRED",
          message: "The command owner did not complete before its durable lease expired.",
        },
      };
      commandRecord = {
        ...record,
        commands: replaceCommand(record, fenced),
      };
    }
    const prepared = {
      ...(previous ? clone(previous) : {}),
      commandId,
      inputHash,
      status: "prepared",
      baseSessionRevision: Number(previous?.baseSessionRevision ?? expectedSessionRevision),
      preparedAt: clean(previous?.preparedAt) || timestamp,
      leaseOwner: serviceId,
      leaseExpiresAtMs: clockMs() + Math.max(1, Number(commandLeaseMs || 1)),
      attemptCount: Number(previous?.attemptCount || 0) + 1,
      result: null,
      error: null,
    };
    try {
      const claimed = await repository.compareAndSwap(key, {
        expectedSessionRevision: record.sessionRevision,
        nextRecord: {
          ...commandRecord,
          commands: replaceCommand(commandRecord, prepared),
          updatedAt: timestamp,
        },
      });
      return { record: claimed, command: commandById(claimed, commandId) };
    } catch (error) {
      if (error?.code !== "WORLD_RUNTIME_SESSION_REVISION_CONFLICT") throw error;
      const latest = await repository.load(key);
      const winner = commandById(latest, commandId);
      if (!winner) throw error;
      const resolved = await resolveExistingCommand(latest, key, commandId, inputHash);
      if (resolved.response) return { response: resolved.response };
      return claimCommand(resolved.record, key, commandId, inputHash, expectedSessionRevision);
    }
  }

  async function recordFailure(key, claimedRecord, claimedCommand, error) {
    const failed = {
      ...clone(claimedCommand),
      status: "failed",
      failedAt: now(),
      leaseOwner: "",
      leaseExpiresAtMs: 0,
      error: safeStoredError(error),
    };
    try {
      return await repository.compareAndSwap(key, {
        expectedSessionRevision: claimedRecord.sessionRevision,
        nextRecord: {
          ...claimedRecord,
          commands: replaceCommand(claimedRecord, failed),
          updatedAt: failed.failedAt,
        },
      });
    } catch (commitError) {
      if (commitError?.code !== "WORLD_RUNTIME_SESSION_REVISION_CONFLICT") throw commitError;
      return repository.load(key);
    }
  }

  return {
    schemaVersion: WORLD_RUNTIME_SESSION_SERVICE_VERSION,
    async loadSession(inputKey = {}) {
      return repository.load(normalizeWorldRuntimeSessionKey(inputKey));
    },
    async runCommand({
      sessionKey: inputKey = {},
      commandId: rawCommandId = "",
      expectedSessionRevision,
      bootstrap = null,
      commandInput = {},
      executionContext = undefined,
    } = {}) {
      const key = normalizeWorldRuntimeSessionKey(inputKey);
      const commandId = clean(rawCommandId);
      if (!commandId) throw fail("WORLD_RUNTIME_COMMAND_ID_REQUIRED", "World runtime command requires commandId.");
      const expected = Number(expectedSessionRevision);
      if (!Number.isInteger(expected) || expected < 0) {
        throw fail("WORLD_RUNTIME_SESSION_EXPECTED_REVISION_INVALID", "World runtime command requires a non-negative expectedSessionRevision.");
      }
      const normalizedInput = serializableClone(commandInput);
      const inputHash = hashWorldRuntimeSessionValue(normalizedInput);
      let record = await repository.load(key);
      if (!record) {
        if (!bootstrap) throw fail("WORLD_RUNTIME_SESSION_NOT_FOUND", "World runtime session has not been bootstrapped.", { key });
        record = await createInitialSession(key, bootstrap);
      }
      assertDefinitionCompatible(record, bootstrap);

      let claimed;
      try {
        claimed = await claimCommand(record, key, commandId, inputHash, expected);
      } catch (error) {
        const latest = await repository.load(key).catch(() => record);
        throw withSessionRecovery(error, latest || record);
      }
      if (claimed.response) return claimed.response;

      let runtime;
      try {
        runtime = await runtimeFactory({
          purpose: "command",
          sessionKey: clone(key),
          sessionId: claimed.record.sessionId,
          definition: clone(claimed.record.definition),
          checkpoint: clone(claimed.record.checkpoint),
          // An execution capability may contain authorization-scoped objects
          // such as a provider request budget. It is deliberately neither
          // cloned nor hashed nor written into the durable command record.
          executionContext,
          async persistExecutionCheckpoint(event = {}) {
            if (!runtime) throw fail("WORLD_RUNTIME_EXECUTION_NOT_OPEN", "Execution checkpoints require an opened runtime.");
            if (event.auditRecord && repository.appendExecutionRecord) await repository.appendExecutionRecord(key, {
              sessionId: claimed.record.sessionId, expectedSessionRevision: claimed.record.sessionRevision, record: event.auditRecord,
            });
            const checkpoint = await runtimeCheckpoint(runtime);
            const command = { ...clone(claimed.command), leaseExpiresAtMs: clockMs() + Math.max(1, Number(commandLeaseMs || 1)),
              executionPhase: clean(event.phase), executionAgentTurnId: clean(event.agentTurnId), executionCheckpointAt: now() };
            const next = await repository.compareAndSwap(key, {
              expectedSessionRevision: claimed.record.sessionRevision,
              nextRecord: { ...claimed.record, checkpoint, commands: replaceCommand(claimed.record, command), updatedAt: now() },
            });
            claimed = { record: next, command: commandById(next, commandId) };
          },
        });
        const execution = await executeCommand({
          runtime,
          session: {
            key: clone(key),
            sessionId: claimed.record.sessionId,
            sessionRevision: claimed.record.sessionRevision,
            worldId: claimed.record.worldId,
            runtimeVersion: claimed.record.runtimeVersion,
          },
          command: {
            commandId,
            inputHash,
            input: clone(normalizedInput),
          },
          executionContext,
        });
        const checkpoint = await runtimeCheckpoint(runtime, execution?.checkpoint);
        const result = serializableClone(
          execution && Object.hasOwn(execution, "result") ? execution.result : execution,
        );
        const completedAt = now();
        const completed = {
          ...clone(claimed.command),
          status: "completed",
          completedAt,
          leaseOwner: "",
          leaseExpiresAtMs: 0,
          resultSessionRevision: claimed.record.sessionRevision + 1,
          result,
          error: null,
        };
        const committed = await repository.compareAndSwap(key, {
          expectedSessionRevision: claimed.record.sessionRevision,
          nextRecord: {
            ...claimed.record,
            checkpoint,
            commands: replaceCommand(claimed.record, completed),
            updatedAt: completedAt,
          },
        });
        return responseFor(committed, commandById(committed, commandId), { replayed: false });
      } catch (error) {
        let recoveryRecord = claimed.record;
        try {
          recoveryRecord = await recordFailure(key, claimed.record, claimed.command, error) || claimed.record;
        } catch (persistenceError) {
          recoveryRecord = await repository.load(key).catch(() => claimed.record);
          throw withSessionRecovery(persistenceError, recoveryRecord);
        }
        throw withSessionRecovery(error, recoveryRecord);
      } finally {
        // Closing an already-checkpointed runtime is cleanup, not a new world
        // transaction. It may not turn a committed command into an ambiguous
        // client-visible failure.
        await closeRuntime(runtime).catch(() => undefined);
      }
    },
  };
}
