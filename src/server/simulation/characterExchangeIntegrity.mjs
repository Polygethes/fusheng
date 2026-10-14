function clean(value = "") {
  return String(value ?? "").trim();
}

function unique(values = []) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function isCommittedAction(action = {}) {
  return action.committed !== false && clean(action.actorId);
}

function directlyContinues(earlier = {}, later = {}) {
  if (!clean(earlier.actorId) || !clean(later.actorId)) return false;
  if (clean(earlier.actorId) === clean(later.actorId)) return false;
  if (clean(earlier.targetCharacterId) !== clean(later.actorId)) return false;

  const earlierImpactIds = new Set((earlier.impactFactors || []).map((impact) => clean(impact?.id)).filter(Boolean));
  const sameThread = clean(earlier.sourceThreadId)
    && clean(earlier.sourceThreadId) === clean(later.sourceThreadId);
  const directImpact = clean(later.causalParentImpactId)
    && earlierImpactIds.has(clean(later.causalParentImpactId));
  const directTurn = clean(later.responseToTurnId)
    && clean(later.responseToTurnId) === clean(earlier.id);
  const hasPreciseParent = Boolean(clean(later.causalParentImpactId) || clean(later.responseToTurnId));
  // A shared thread proves that two turns belong to the same conversation, not
  // that every later utterance directly answers every earlier utterance. Use
  // the thread-only fallback solely for migrated records that predate exact
  // turn/impact provenance.
  return hasPreciseParent ? Boolean(directImpact || directTurn) : Boolean(sameThread);
}

/**
 * Evaluates whether an acceptance sample contains an actual causal exchange.
 * It does not judge literary quality and does not require dialogue: a visible
 * action can continue a directed turn when provenance proves the connection.
 */
export function evaluateCharacterExchangeIntegrity({
  requiredCharacterIds = [],
  decisions = [],
  actions = [],
  stopReason = "",
  unresolvedRequests = [],
} = {}) {
  const required = unique(requiredCharacterIds);
  const acceptedDecisionCharacterIds = unique((decisions || [])
    .filter((row) => row?.decision?.choiceAuthority === "character-agent"
      && row?.decision?.actionType !== "pass")
    .map((row) => row.characterId));
  const committedActions = (actions || []).filter(isCommittedAction);
  const committedCharacterIds = unique(committedActions.map((action) => action.actorId));
  const missingAcceptedDecisionCharacterIds = required.filter((id) => !acceptedDecisionCharacterIds.includes(id));
  const missingCommittedCharacterIds = required.filter((id) => !committedCharacterIds.includes(id));
  const technicalRejections = (decisions || []).filter((row) => (
    row?.choiceAuthority === "character-agent:technical-rejection"
    || (
      row?.repair?.attempted === true
      && row?.repair?.accepted === false
      && (row?.decision?.semanticViolations || []).length > 0
    )
  )).map((row) => ({
    step: Number(row.step || 0),
    characterId: clean(row.characterId),
    violationCodes: unique((row.decision?.semanticViolations || []).map((violation) => violation?.code)),
  }));
  const openRequests = (unresolvedRequests || []).map((request) => ({
    id: clean(request.id),
    threadId: clean(request.threadId || request.sourceThreadId),
    requesterId: clean(request.requesterId),
    responderId: clean(request.responderId),
    status: clean(request.status),
  }));

  const causalPairs = [];
  for (let laterIndex = 1; laterIndex < committedActions.length; laterIndex += 1) {
    for (let earlierIndex = 0; earlierIndex < laterIndex; earlierIndex += 1) {
      const earlier = committedActions[earlierIndex];
      const later = committedActions[laterIndex];
      if (!directlyContinues(earlier, later)) continue;
      causalPairs.push({
        sourceActionId: clean(earlier.id),
        sourceCharacterId: clean(earlier.actorId),
        responseActionId: clean(later.id),
        responseCharacterId: clean(later.actorId),
        sourceThreadId: clean(later.sourceThreadId || earlier.sourceThreadId),
      });
    }
  }
  const requiredSet = new Set(required);
  const requiredCausalPair = causalPairs.find((pair) => (
    requiredSet.has(pair.sourceCharacterId)
    && requiredSet.has(pair.responseCharacterId)
  )) || null;

  const issues = [];
  if (missingAcceptedDecisionCharacterIds.length) issues.push({
    code: "REQUIRED_CHARACTER_DECISION_MISSING",
    characterIds: missingAcceptedDecisionCharacterIds,
  });
  if (missingCommittedCharacterIds.length) issues.push({
    code: "REQUIRED_CHARACTER_ACTION_MISSING",
    characterIds: missingCommittedCharacterIds,
  });
  if (!requiredCausalPair) issues.push({ code: "CAUSAL_EXCHANGE_MISSING" });
  if (technicalRejections.length || clean(stopReason) === "character-decision-unrealized") issues.push({
    code: "CHARACTER_DECISION_TECHNICAL_REJECTION",
    stopReason: clean(stopReason),
    decisions: technicalRejections,
  });
  if (openRequests.length || clean(stopReason) === "unresolved-request") issues.push({
    code: "UNRESOLVED_CHARACTER_REQUEST",
    stopReason: clean(stopReason),
    requests: openRequests,
  });

  return {
    complete: issues.length === 0,
    requiredCharacterIds: required,
    acceptedDecisionCharacterIds,
    committedCharacterIds,
    causalPairs,
    stopReason: clean(stopReason),
    technicalRejections,
    unresolvedRequests: openRequests,
    issues,
  };
}
