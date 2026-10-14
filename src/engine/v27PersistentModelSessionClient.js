import {
  mergeV27ObservationHistory,
  normalizeV27Observation,
} from "./v27Service.js";

export const V27_PERSISTENT_MODEL_SESSION_CLIENT_VERSION = "v27-persistent-model-session-client-v2";

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").trim();
}

function natural(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : fallback;
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseStored(storage, storageKey) {
  try {
    const raw = storage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function sessionRefFor(raw = null, coordinates = {}) {
  if (!raw || clean(raw.runtimeId) !== coordinates.runtimeId
    || clean(raw.projectId) !== coordinates.projectId
    || clean(raw.branchId) !== coordinates.branchId
    || !clean(raw.sessionId)) return null;
  return {
    projectId: coordinates.projectId,
    branchId: coordinates.branchId,
    runtimeId: coordinates.runtimeId,
    sessionId: clean(raw.sessionId),
    sessionRevision: natural(raw.sessionRevision),
    worldVersion: natural(raw.worldVersion),
  };
}

function pendingFor(raw = null) {
  const operation = clean(raw?.operation);
  const commandId = clean(raw?.commandId);
  const expectedRevision = natural(raw?.expectedRevision, -1);
  if (!["start", "continue", "reset"].includes(operation) || !commandId || expectedRevision < 0) return null;
  return { operation, commandId, expectedRevision };
}

function publicObservationFor(raw = null, sessionRef = null) {
  if (!raw || !sessionRef || clean(raw?.sessionRef?.sessionId) !== sessionRef.sessionId) return null;
  return clone(raw);
}

function normalizeResponse(payload = {}) {
  return normalizeV27Observation({
    ...payload,
    runtime: payload.observation || {},
    sessionRef: {
      ...(payload.sessionRef || {}),
      sessionRevision: payload.sessionRevision,
      worldVersion: payload.worldVersion,
    },
  });
}

function safeCursorFromError(error = {}, coordinates = {}) {
  const payload = error?.payload || {};
  const raw = payload.sessionRef;
  if (!raw?.sessionId) return null;
  return sessionRefFor({
    ...raw,
    sessionRevision: payload.sessionRevision,
    worldVersion: payload.worldVersion,
  }, coordinates);
}

export function createV27PersistentModelSessionClient({
  storage,
  storageKey = "gtown:v27:persistent-model-session:v2",
  request,
  idFactory = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  projectId = "project:v27-two-agent-test-page",
  branchId = "branch:fixed-xie-luo",
} = {}) {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
    throw fail("V27_MODEL_SESSION_STORAGE_REQUIRED", "Persistent model test client requires session storage.");
  }
  if (typeof request !== "function") {
    throw fail("V27_MODEL_SESSION_REQUEST_REQUIRED", "Persistent model test client requires a request function.");
  }
  if (typeof idFactory !== "function") {
    throw fail("V27_MODEL_SESSION_ID_FACTORY_REQUIRED", "Persistent model test client requires an id factory.");
  }

  const stored = parseStored(storage, storageKey);
  const instanceId = clean(stored?.runtimeInstanceId) || `test-page-${clean(idFactory())}`;
  const coordinates = {
    projectId: clean(projectId),
    branchId: clean(branchId),
    runtimeId: `tavern-v27-model:${instanceId}`,
  };
  const restoredSession = sessionRefFor(stored?.sessionRef, coordinates);
  let state = {
    schemaVersion: V27_PERSISTENT_MODEL_SESSION_CLIENT_VERSION,
    runtimeInstanceId: instanceId,
    coordinates,
    sessionRef: restoredSession,
    pendingCommand: pendingFor(stored?.pendingCommand),
    observation: publicObservationFor(stored?.observation, restoredSession),
  };

  function persist() {
    // No authorization flag, authorization id or provider capability is ever
    // part of this state. The checkbox grants one network attempt only.
    storage.setItem(storageKey, JSON.stringify(state));
  }

  function createPending(operation) {
    return {
      operation,
      commandId: `v27:model:${operation}:${clean(idFactory())}`,
      expectedRevision: operation === "start" ? 0 : natural(state.sessionRef?.sessionRevision),
    };
  }

  function bodyFor(pending, { authorizationAcknowledged } = {}) {
    return {
      ...coordinates,
      sessionId: clean(state.sessionRef?.sessionId),
      commandId: pending.commandId,
      expectedRevision: pending.expectedRevision,
      ...(authorizationAcknowledged === true ? { authorizationAcknowledged: true } : {}),
    };
  }

  async function commitResponse(payload, { reset = false } = {}) {
    const normalized = normalizeResponse(payload);
    const nextRef = sessionRefFor(normalized.sessionRef, coordinates);
    if (!nextRef) throw fail("V27_MODEL_SESSION_RESPONSE_IDENTITY_INVALID", "Model session response does not belong to this test world.");
    if (state.sessionRef?.sessionId && nextRef.sessionId !== state.sessionRef.sessionId) {
      throw fail("V27_MODEL_SESSION_RESPONSE_REPLACED", "Model session id changed during a continuous test.");
    }
    if (nextRef.sessionRevision < natural(state.sessionRef?.sessionRevision)
      || (!reset && nextRef.worldVersion < natural(state.sessionRef?.worldVersion))) {
      throw fail("V27_MODEL_SESSION_RESPONSE_STALE", "Model session response attempted to move the cursor backwards.");
    }
    const displayedObservation = reset
      ? normalized
      : mergeV27ObservationHistory(state.observation, normalized);
    state = {
      ...state,
      sessionRef: nextRef,
      pendingCommand: null,
      observation: displayedObservation,
    };
    persist();
    return { sessionRef: clone(nextRef), observation: normalized, displayedObservation: clone(displayedObservation) };
  }

  persist();

  return {
    snapshot() { return clone(state); },

    async runAuthorizedTurn({ authorizationAcknowledged = false } = {}) {
      if (authorizationAcknowledged !== true) {
        throw fail("V27_MODEL_SESSION_AUTHORIZATION_REQUIRED", "本次人物回合尚未获得明确的外部模型授权。");
      }
      const pending = state.pendingCommand || createPending(state.sessionRef?.sessionId ? "continue" : "start");
      if (pending.operation === "reset") {
        throw fail("V27_MODEL_SESSION_RESET_PENDING", "A reset command is pending; finish it before running a model turn.");
      }
      state = { ...state, pendingCommand: pending };
      persist();
      try {
        const payload = await request(`/api/v27/tavern/model-session/${pending.operation}`, bodyFor(pending, {
          authorizationAcknowledged: true,
        }));
        return await commitResponse(payload);
      } catch (error) {
        const cursor = safeCursorFromError(error, coordinates);
        const code = clean(error?.payload?.code || error?.code);
        const keepPending = !error?.payload || [
          "WORLD_RUNTIME_COMMAND_IN_PROGRESS",
          "TAVERN_V27_EXTERNAL_MODEL_AUTHORIZATION_REQUIRED",
        ].includes(code);
        state = {
          ...state,
          ...(cursor ? { sessionRef: cursor } : {}),
          pendingCommand: keepPending ? pending : null,
        };
        persist();
        if (cursor) error.sessionRef = clone(cursor);
        if (!error.code && code) error.code = code;
        throw error;
      }
    },

    async reset() {
      if (!state.sessionRef?.sessionId) return { sessionRef: null, observation: null, displayedObservation: null };
      if (state.pendingCommand && state.pendingCommand.operation !== "reset") {
        throw fail("V27_MODEL_SESSION_COMMAND_PENDING", "Resolve the pending model command before resetting this test session.");
      }
      const pending = state.pendingCommand || createPending("reset");
      state = { ...state, pendingCommand: pending };
      persist();
      try {
        const payload = await request("/api/v27/tavern/model-session/reset", bodyFor(pending));
        return await commitResponse(payload, { reset: true });
      } catch (error) {
        const cursor = safeCursorFromError(error, coordinates);
        const code = clean(error?.payload?.code || error?.code);
        const keepPending = !error?.payload || code === "WORLD_RUNTIME_COMMAND_IN_PROGRESS";
        state = {
          ...state,
          ...(cursor ? { sessionRef: cursor } : {}),
          pendingCommand: keepPending ? pending : null,
        };
        persist();
        throw error;
      }
    },
  };
}
