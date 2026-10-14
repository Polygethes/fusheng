import {
  mergeV27ObservationHistory,
  prepareV27LocalCommand,
  runV27LocalObservation,
  v27RuntimeIdForWorld,
} from "./v27Service.js";

function contextFromState(state = {}) {
  return {
    projectId: String(state.project?.id || ""),
    branchId: String(state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main"),
    runtimeId: v27RuntimeIdForWorld({
      runtimeInstanceId: state.project?.runtimeInstanceId,
    }),
  };
}

function sameContext(left, right) {
  return Boolean(left && right
    && left.projectId === right.projectId
    && left.branchId === right.branchId
    && left.runtimeId === right.runtimeId);
}

function requireFunction(value, label) {
  if (typeof value !== "function") throw new Error(`v2.7 session controller requires ${label}.`);
  return value;
}

/**
 * Browser-side transaction shell for one local Character Actor turn.
 *
 * It persists the transport command before any network work. If the response
 * is lost, a reload sees the same pending command and replays it idempotently.
 * Character and world checkpoints remain server-owned.
 */
export function createV27SessionController({
  getState,
  getRuntimeSessionRef,
  setRuntimeSessionRef,
  clearRuntimeSessionRef,
  getRuntimeObservation,
  setRuntimeObservation,
  commitRuntimeSessionResult = null,
  runLocalObservation = runV27LocalObservation,
} = {}) {
  const readState = requireFunction(getState, "getState");
  const readSession = requireFunction(getRuntimeSessionRef, "getRuntimeSessionRef");
  const writeSession = requireFunction(setRuntimeSessionRef, "setRuntimeSessionRef");
  const clearSession = requireFunction(clearRuntimeSessionRef, "clearRuntimeSessionRef");
  const readObservation = requireFunction(getRuntimeObservation, "getRuntimeObservation");
  const writeObservation = requireFunction(setRuntimeObservation, "setRuntimeObservation");
  const commitResult = typeof commitRuntimeSessionResult === "function"
    ? commitRuntimeSessionResult
    : null;
  const execute = requireFunction(runLocalObservation, "runLocalObservation");

  return {
    async runLocalTurn() {
      const context = contextFromState(readState());
      const existing = readSession(context.runtimeId);
      const pendingCommand = prepareV27LocalCommand({ sessionRef: existing });
      const pendingRef = writeSession({
        ...(existing || {}),
        ...context,
        sessionId: existing?.sessionId || "",
        sessionRevision: existing?.sessionRevision || 0,
        worldVersion: existing?.worldVersion || 0,
        pendingCommand,
      });
      try {
        const observation = await execute({
          ...context,
          sessionRef: pendingRef,
        });
        const currentContext = contextFromState(readState());
        if (!sameContext(context, currentContext)) {
          const error = new Error("运行期间项目或分支已经切换；结果保留在原分支待安全重放。");
          error.code = "V27_RUNTIME_CONTEXT_CHANGED";
          throw error;
        }
        const previousObservation = readObservation(context.runtimeId);
        let displayedObservation = observation.staleReplay === true && previousObservation
          ? {
            ...previousObservation,
            sessionRef: observation.sessionRef,
            worldVersion: observation.sessionRef?.worldVersion ?? observation.worldVersion,
            explanation: observation.explanation,
            completedAt: observation.completedAt,
          }
          : mergeV27ObservationHistory(previousObservation, observation);
        if (commitResult) {
          const committed = commitResult(
            context.runtimeId,
            pendingCommand.commandId,
            observation.sessionRef,
            displayedObservation,
          );
          displayedObservation = committed.observation;
        } else {
          writeSession(observation.sessionRef, { resolvedCommandId: pendingCommand.commandId });
          writeObservation(context.runtimeId, displayedObservation);
        }
        return { context, observation, displayedObservation };
      } catch (error) {
        const currentContext = contextFromState(readState());
        if (sameContext(context, currentContext)
          && error?.code === "WORLD_RUNTIME_COMMAND_IN_PROGRESS") {
          if (error?.sessionRef?.sessionId) {
            writeSession({
              ...error.sessionRef,
              pendingCommand,
            });
          }
        } else if (sameContext(context, currentContext) && error?.sessionRef?.sessionId) {
          writeSession(error.sessionRef, { resolvedCommandId: pendingCommand.commandId });
        } else if (sameContext(context, currentContext)
          && error?.code === "WORLD_RUNTIME_SESSION_NOT_FOUND") {
          clearSession(context.runtimeId);
        }
        throw error;
      }
    },
  };
}
