const OPEN_STATUSES = new Set(["awaiting"]);
const UNRESOLVED_STATUSES = new Set(["awaiting", "unresolved", "deferred"]);

function rows(requests = []) {
  return Array.isArray(requests) ? requests : [];
}

export function latestAwaitingInteraction(requests = [], {
  participantAvailable = () => true,
  requestHasDelivery = () => true,
} = {}) {
  return [...rows(requests)].reverse().find((request) => (
    OPEN_STATUSES.has(request?.status)
    && participantAvailable(request.requesterId)
    && participantAvailable(request.responderId)
    && requestHasDelivery(request)
  )) || null;
}

export function interactionForResponder(requests = [], responderId = "", {
  sourceImpactId = "",
  deliveryForRequest = () => null,
} = {}) {
  return [...rows(requests)].reverse().find((request) => (
    OPEN_STATUSES.has(request?.status)
    && request.responderId === responderId
    && (!sourceImpactId || deliveryForRequest(request)?.impactId === sourceImpactId)
  )) || null;
}

export function recordInteractionPass(request = {}, {
  step = 0,
  maxAttempts = 2,
} = {}) {
  request.attempts = Number(request.attempts || 0) + 1;
  request.lastAttemptStep = Number(step || 0);
  if (request.attempts >= Math.max(1, Number(maxAttempts || 2))) {
    request.status = "unresolved";
    request.unresolvedAtStep = Number(step || 0);
  }
  return request;
}

export function resolveInteraction(request = {}, {
  step = 0,
  actionId = "",
  resolution = "answered",
} = {}) {
  request.status = "resolved";
  request.resolution = resolution;
  request.resolvedAtStep = Number(step || 0);
  request.latestResponseActionId = actionId || request.latestResponseActionId || "";
  return request;
}

export function unresolvedInteractions(requests = []) {
  return rows(requests).filter((request) => UNRESOLVED_STATUSES.has(request?.status));
}

export function interactionBudgetAllows({
  ordinarySteps = 0,
  baseStepBudget = 1,
  followupSteps = 0,
  maxFollowupSteps = 2,
  hasAwaitingInteraction = false,
} = {}) {
  if (Number(ordinarySteps || 0) < Math.max(1, Number(baseStepBudget || 1))) return true;
  return Boolean(hasAwaitingInteraction && Number(followupSteps || 0) < Math.max(0, Number(maxFollowupSteps || 0)));
}
