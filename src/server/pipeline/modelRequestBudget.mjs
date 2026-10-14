/**
 * Authorization-scoped provider request budget.
 *
 * The budget is consumed immediately before every real provider fetch. Agent
 * stages, JSON repair attempts and transient-network retries therefore share
 * one hard limit instead of maintaining competing counters.
 */

export const MODEL_PROVIDER_REQUEST_BUDGET_VERSION = "model-provider-request-budget-v1";

const stateByBudget = new WeakMap();

function clean(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function natural(value, fallback = 0) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, structuredClone(details));
  return error;
}

function stateFor(budget) {
  const state = stateByBudget.get(budget);
  if (!state) throw fail("MODEL_PROVIDER_REQUEST_BUDGET_INVALID", "Unknown provider request budget.");
  return state;
}

function retryKind(meta = {}) {
  const parseRetries = natural(meta.parseRetryCount);
  const networkRetries = natural(meta.networkRetryCount);
  if (parseRetries > 0 && networkRetries > 0) return "json_parse_and_network_retry";
  if (parseRetries > 0) return "json_parse_retry";
  if (networkRetries > 0) return "network_retry";
  return "initial";
}

export function createModelRequestBudget({
  maxProviderRequests,
  authorizationId = "",
} = {}) {
  const limit = natural(maxProviderRequests);
  if (limit < 1) {
    throw fail(
      "MODEL_PROVIDER_REQUEST_BUDGET_LIMIT_REQUIRED",
      "Provider request budget requires a positive hard limit.",
    );
  }
  const budget = Object.freeze({
    schemaVersion: MODEL_PROVIDER_REQUEST_BUDGET_VERSION,
    authorizationId: clean(authorizationId),
    maxProviderRequests: limit,
  });
  stateByBudget.set(budget, {
    usedProviderRequests: 0,
    rejectedProviderRequests: 0,
    attempts: [],
  });
  return budget;
}

export function reserveModelProviderRequest(budget, metadata = {}) {
  const state = stateFor(budget);
  if (state.usedProviderRequests >= budget.maxProviderRequests) {
    state.rejectedProviderRequests += 1;
    throw fail(
      "MODEL_PROVIDER_REQUEST_BUDGET_EXHAUSTED",
      `Provider request authorization limit ${budget.maxProviderRequests} has been reached.`,
      { requestBudget: modelRequestBudgetSnapshot(budget) },
    );
  }
  state.usedProviderRequests += 1;
  const attempt = Object.freeze({
    requestIndex: state.usedProviderRequests,
    characterId: clean(metadata.characterId),
    agentTurnId: clean(metadata.agentTurnId),
    phase: clean(metadata.phase),
    retryKind: retryKind(metadata),
    parseRetryCount: natural(metadata.parseRetryCount),
    networkRetryCount: natural(metadata.networkRetryCount),
  });
  state.attempts.push(attempt);
  return structuredClone(attempt);
}

export function modelRequestBudgetSnapshot(budget) {
  const state = stateFor(budget);
  return {
    schemaVersion: MODEL_PROVIDER_REQUEST_BUDGET_VERSION,
    authorizationId: budget.authorizationId,
    maxProviderRequests: budget.maxProviderRequests,
    usedProviderRequests: state.usedProviderRequests,
    remainingProviderRequests: Math.max(0, budget.maxProviderRequests - state.usedProviderRequests),
    rejectedProviderRequests: state.rejectedProviderRequests,
    attempts: structuredClone(state.attempts),
  };
}
