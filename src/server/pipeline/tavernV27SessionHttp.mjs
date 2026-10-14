export const TAVERN_V27_SESSION_HTTP_VERSION = "tavern-v27-session-http-v1";

const OPERATIONS = new Set(["start", "continue", "reset", "snapshot", "restore"]);

function clean(value = "") {
  return String(value ?? "").trim();
}

function errorStatus(code = "") {
  if (code === "TAVERN_V27_EXTERNAL_MODEL_AUTHORIZATION_REQUIRED") return 403;
  if (["WORLD_RUNTIME_SESSION_NOT_FOUND", "WORLD_RUNTIME_SNAPSHOT_UNAVAILABLE"].includes(code)) return 404;
  if ([
    "TAVERN_V27_SESSION_ALREADY_STARTED",
    "WORLD_RUNTIME_SESSION_REVISION_CONFLICT",
    "WORLD_RUNTIME_COMMAND_ID_REUSED",
    "WORLD_RUNTIME_COMMAND_IN_PROGRESS",
    "WORLD_RUNTIME_SESSION_DEFINITION_CONFLICT",
    "TAVERN_V27_SESSION_ID_MISMATCH",
    "TAVERN_V27_SESSION_MODE_MISMATCH",
    "WORLD_RUNTIME_SNAPSHOT_PROVIDER_UNSUPPORTED",
  ].includes(code)) return 409;
  if (/_(REQUIRED|INCOMPLETE|INVALID|UNKNOWN)$/u.test(code)) return 400;
  return 500;
}

function requestError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function publicRecovery(error) {
  const source = error?.sessionRecovery;
  const key = source?.sessionKey;
  const sessionId = clean(source?.sessionId);
  const sessionRevision = Number(source?.sessionRevision);
  const worldVersion = Number(source?.worldVersion);
  if (!key || !clean(key.projectId) || !clean(key.branchId) || !clean(key.runtimeId) || !sessionId
    || !Number.isInteger(sessionRevision) || sessionRevision < 0
    || !Number.isFinite(worldVersion) || worldVersion < 0) return null;
  return {
    sessionRef: {
      projectId: clean(key.projectId),
      branchId: clean(key.branchId),
      runtimeId: clean(key.runtimeId),
      sessionId,
    },
    sessionRevision,
    worldVersion,
  };
}

function requestFromBody(operation, body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw requestError("TAVERN_V27_SESSION_REQUEST_INVALID", "Request body must be a JSON object.");
  }
  const projectId = clean(body.projectId);
  const branchId = clean(body.branchId);
  const runtimeId = clean(body.runtimeId);
  const commandId = clean(body.commandId);
  const sessionId = clean(body.sessionId);
  for (const [field, value] of Object.entries({ projectId, branchId, runtimeId, commandId })) {
    if (!value) throw requestError("TAVERN_V27_SESSION_REQUEST_INCOMPLETE", `Request requires ${field}.`);
  }
  const expectedSessionRevision = Number(body.expectedRevision);
  if (!Number.isInteger(expectedSessionRevision) || expectedSessionRevision < 0) {
    throw requestError("TAVERN_V27_SESSION_EXPECTED_REVISION_INVALID", "expectedRevision must be a non-negative integer.");
  }
  if (!["start", "restore"].includes(operation) && !sessionId) {
    throw requestError("TAVERN_V27_SESSION_ID_REQUIRED", "continue and reset require the opaque sessionId returned by start.");
  }
  return {
    operation,
    sessionKey: { projectId, branchId, runtimeId },
    commandId,
    sessionId,
    expectedSessionRevision,
    ...(operation === "restore" ? { snapshotRef: structuredClone(body.snapshotRef) } : {}),
  };
}

/**
 * Framework-neutral HTTP handler. It validates transport identity and maps
 * safe error codes, while the adapter remains responsible for persistence and
 * the injected Character/World runtime remains responsible for behavior.
 */
export function createTavernV27SessionHttpHandler({
  adapter,
  executionContextFactory = null,
  projectError = null,
} = {}) {
  if (!adapter || typeof adapter.execute !== "function") {
    throw requestError("TAVERN_V27_SESSION_ADAPTER_REQUIRED", "HTTP handler requires a tavern session adapter.");
  }
  if (executionContextFactory != null && typeof executionContextFactory !== "function") {
    throw requestError("TAVERN_V27_SESSION_EXECUTION_CONTEXT_FACTORY_INVALID", "executionContextFactory must be a function.");
  }
  if (projectError != null && typeof projectError !== "function") {
    throw requestError("TAVERN_V27_SESSION_ERROR_PROJECTOR_INVALID", "projectError must be a function.");
  }
  return async function handleTavernV27SessionHttp({ operation: rawOperation, body } = {}) {
    const operation = clean(rawOperation);
    try {
      if (!OPERATIONS.has(operation)) {
        throw requestError("TAVERN_V27_SESSION_OPERATION_INVALID", "Operation must be start, continue or reset.");
      }
      const request = requestFromBody(operation, body);
      const executionContext = executionContextFactory
        ? await executionContextFactory({ operation, body, request: structuredClone(request) })
        : undefined;
      const response = await adapter.execute({ ...request, executionContext });
      return { status: 200, body: response };
    } catch (error) {
      const code = clean(error?.code) || "TAVERN_V27_SESSION_FAILED";
      if (process.env.GTOWN_V27_SAFE_DIAGNOSTICS === "1" && (error?.evidence || error?.issues)) {
        // Temporary operator diagnostic: violations stay server-side and are
        // never added to the public response body.
        console.error(JSON.stringify({ type: "tavern-v27-adapter-error", code, evidence: error.evidence ?? null, issues: error.issues ?? null }, null, 2));
      }
      const recovery = publicRecovery(error);
      const status = errorStatus(code);
      const projected = projectError
        ? await projectError({ error, code, status, operation, recovery: structuredClone(recovery) })
        : null;
      const safeExtras = projected && typeof projected === "object" && !Array.isArray(projected)
        ? structuredClone(projected)
        : {};
      for (const reserved of ["code", "error", "sessionRef", "sessionRevision", "worldVersion"]) {
        delete safeExtras[reserved];
      }
      return {
        status,
        body: {
          code,
          // Unexpected execution errors can contain provider payload fragments.
          // Keep their diagnostic code server-visible while the public body
          // exposes only a generic message and the safe recovery cursor.
          error: status >= 500
            ? "Persistent tavern session command failed."
            : clean(error?.message) || "Persistent tavern session failed.",
          ...(recovery || {}),
          ...safeExtras,
        },
      };
    }
  };
}
