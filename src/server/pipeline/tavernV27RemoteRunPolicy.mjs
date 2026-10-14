/** Honest remote-run limits and safe failure projection for the v2.7 tavern. */

export const TAVERN_V27_REMOTE_RUN_POLICY_VERSION = "tavern-v27-remote-run-policy-v1";

function clean(value = "", maxLength = 600) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function clampTurns(value) {
  const numeric = Math.floor(Number(value || 2));
  return Math.max(1, Math.min(4, Number.isFinite(numeric) ? numeric : 2));
}

function natural(value) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function safeIssue(issue = {}) {
  return {
    code: clean(issue.code, 120) || "VALIDATION_ISSUE",
    path: clean(issue.path, 240),
    message: clean(issue.message, 600),
  };
}

function safeBudget(snapshot = {}) {
  return {
    schemaVersion: clean(snapshot.schemaVersion, 120),
    authorizationId: clean(snapshot.authorizationId, 160),
    maxProviderRequests: natural(snapshot.maxProviderRequests),
    usedProviderRequests: natural(snapshot.usedProviderRequests),
    remainingProviderRequests: natural(snapshot.remainingProviderRequests),
    rejectedProviderRequests: natural(snapshot.rejectedProviderRequests),
    attempts: (snapshot.attempts || []).map((row) => ({
      requestIndex: natural(row.requestIndex),
      characterId: clean(row.characterId, 160),
      agentTurnId: clean(row.agentTurnId, 200),
      phase: clean(row.phase, 160),
      retryKind: clean(row.retryKind, 80),
      parseRetryCount: natural(row.parseRetryCount),
      networkRetryCount: natural(row.networkRetryCount),
    })),
  };
}

export function buildTavernV27RemoteRunPolicy({ maxTurns } = {}) {
  const turns = clampTurns(maxTurns);
  const maxProtocolRepairsPerTurn = 2;
  const baseStageRequests = turns * 3;
  const maxProtocolRepairRequests = turns * maxProtocolRepairsPerTurn;
  return {
    schemaVersion: TAVERN_V27_REMOTE_RUN_POLICY_VERSION,
    maxTurns: turns,
    baseStageRequests,
    maxProtocolRepairRequests,
    maxProviderRequests: baseStageRequests + maxProtocolRepairRequests,
    maxProtocolRepairsPerTurn,
  };
}

export function projectTavernV27RemoteFailure(error, {
  model = "",
  stageInvocations = 0,
  requestBudget = {},
} = {}) {
  return {
    code: clean(error?.code, 160) || "TAVERN_V27_REMOTE_RUN_FAILED",
    message: clean(error?.message, 600) || "Remote Character Agent run failed.",
    model: clean(model, 160),
    failedPhase: clean(error?.failedPhase, 160),
    failedStage: clean(error?.failedStage, 160),
    characterId: clean(error?.characterId, 160),
    agentTurnId: clean(error?.agentTurnId, 200),
    protocolRepairAttempts: natural(error?.protocolRepairAttempts),
    stageInvocations: natural(stageInvocations),
    providerRequestBudget: safeBudget(requestBudget),
    issues: (error?.issues || []).map(safeIssue),
  };
}
