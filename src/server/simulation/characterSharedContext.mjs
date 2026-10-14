export const CHARACTER_SHARED_CONTEXT_VERSION = "character-shared-context-v1";

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function meaningfulBoundaryFields(boundaries = {}) {
  return ["intensity", "propertyProtection", "harmLimit", "note"].filter((field) => {
    const value = boundaries?.[field];
    return typeof value === "boolean" ? value === true : Boolean(clean(value));
  });
}

function existingActivity(sharedActivities = [], activityId = "") {
  const id = clean(activityId);
  if (!id) return null;
  return (sharedActivities || []).find((row) => clean(row?.activityId || row?.id) === id) || null;
}

function boundaryStatus(field = "", selected = {}, existing = null, operation = "none") {
  if (!existing) return operation === "propose" ? "held_for_later_coordination" : "private_current_understanding";
  const previous = existing.boundaries?.[field];
  const next = selected.boundaries?.[field];
  if (JSON.stringify(previous) !== JSON.stringify(next)) return "changed_since_shared_understanding";
  if (["countered", "disputed", "refused"].includes(clean(existing.status))) return "disputed_in_shared_understanding";
  return "already_shared";
}

/**
 * A Character-private pragmatic surface. It does not write speech, decide what
 * to disclose, or delete the full shared-activity terms retained in the
 * selected candidate. It only prevents every private term from being mistaken
 * for an immediate public checklist.
 */
export function buildCharacterCommunicationNeedSurface({
  characterId = "",
  selectedAction = {},
  worldProjection = {},
  automaticCommunicationImpulse = {},
} = {}) {
  const activity = selectedAction.sharedActivity || {};
  const operation = clean(activity.operation || "none");
  const activityId = clean(activity.activityId);
  const existing = existingActivity(worldProjection.sharedActivities || [], activityId);
  const boundaryFields = meaningfulBoundaryFields(activity.boundaries || {});
  const isSharedActivityMove = operation !== "none" && Boolean(clean(activity.kind));
  const isCommunicationMove = clean(selectedAction.attemptPrimitive) === "speak" || isSharedActivityMove;
  const coreTopics = isCommunicationMove ? [{
    topicId: "selected_action_core",
    semanticRole: isSharedActivityMove
      ? (operation === "propose" ? "make_activity_recognizable_and_invite_response" : "respond_to_existing_activity")
      : "carry_out_the_character_selected_communication_move",
    activityKind: clean(activity.kind),
    counterpartResponseRelevant: isSharedActivityMove
      ? ["propose", "respond", "coordinate"].includes(operation)
      : true,
    status: isSharedActivityMove
      ? (existing ? "continues_existing_shared_context" : "new_shared_activity_move")
      : "current_selected_communication_move",
    dueStatus: "available_for_character_focus_now",
  }] : [];
  const coordinationTopics = clean(activity.requestedZoneId) ? [{
    topicId: "shared_activity_requested_zone",
    semanticRole: "coordinate_where_the_activity_might_happen",
    requestedZoneId: clean(activity.requestedZoneId),
    status: existing && clean(existing.requestedZoneId) === clean(activity.requestedZoneId)
      ? "already_shared"
      : "new_or_changed_coordination_detail",
    dueStatus: "available_for_character_focus_now",
  }] : [];
  const privateBoundaryLedger = boundaryFields.map((field) => {
    const status = boundaryStatus(field, activity, existing, operation);
    const explicitCommunicationPressure = ["changed_since_shared_understanding", "disputed_in_shared_understanding"].includes(status)
      ? "elevated"
      : "not_automatically_due_now";
    return {
      topicId: `shared_activity_boundary:${field}`,
      field,
      status,
      explicitCommunicationPressure,
      dueStatus: explicitCommunicationPressure,
    };
  });
  const recentTurns = (worldProjection.discourseContext?.recentPublicTurns || [])
    .filter((row) => clean(row?.id));
  const ownerId = clean(characterId);
  const targetHandle = clean(selectedAction.targetHandle);
  const directed = recentTurns.filter((row) => (
    (ownerId && clean(row?.addresseeId) === ownerId)
    || (targetHandle && clean(row?.speakerId) === targetHandle)
  ));
  const latestRelevantTurn = (directed.length ? directed : recentTurns).slice(-1);
  const discourseTopics = latestRelevantTurn.map((row) => ({
    topicId: `discourse_turn:${clean(row.id)}`,
    semanticRole: "respond_to_or_otherwise_handle_the_current_public_turn",
    anchorId: clean(row.id),
    speakerId: clean(row.speakerId),
    addresseeId: clean(row.addresseeId),
    speechAct: clean(row.speechAct || "none"),
    speechFunctions: unique(row.speechFunctions || []),
    status: "recent_public_turn",
    dueStatus: "available_for_character_focus_now",
  }));
  const topicLedger = [
    ...discourseTopics,
    ...coreTopics,
    ...coordinationTopics,
    ...privateBoundaryLedger,
  ];
  return {
    schemaVersion: 1,
    toolVersion: CHARACTER_SHARED_CONTEXT_VERSION,
    authority: "character-private-communication-need-tool",
    selection: null,
    literalSpeech: null,
    activityIdentity: isSharedActivityMove ? {
      operation,
      activityId,
      kind: clean(activity.kind),
      participantIds: unique(activity.participantIds || []),
      requestedZoneId: clean(activity.requestedZoneId),
      response: clean(activity.response || "none"),
    } : null,
    coreTopics,
    coordinationTopics,
    privateBoundaryLedger,
    topicLedger,
    discourseAnchorIds: unique([
      ...(worldProjection.discourseContext?.anchorIds || []),
      ...(automaticCommunicationImpulse.discourseAnchorIds || []),
    ]),
    sharedUnderstandingPresent: Boolean(existing),
    pragmaticRule: "This ledger is not a speaking checklist. The Character chooses one present focus, may add support, imply or defer the remainder, and may also deliberately speak broadly, conceal, distort, forget, repeat, or change the subject. Full private activity boundaries remain owned by the Character and the world bridge.",
    authorityBoundary: {
      mayNotSelectDisclosure: true,
      mayNotWriteLiteralSpeech: true,
      mayNotAlterSelectedActivity: true,
      mayNotDeletePrivateBoundaries: true,
    },
  };
}

export function projectSelectedActionForExpression(selectedAction = {}) {
  const activity = selectedAction.sharedActivity || null;
  return {
    ...clone(selectedAction),
    ...(activity ? {
      sharedActivity: {
        operation: clean(activity.operation || "none"),
        activityId: clean(activity.activityId),
        kind: clean(activity.kind),
        participantIds: unique(activity.participantIds || []),
        requestedZoneId: clean(activity.requestedZoneId),
        response: clean(activity.response || "none"),
        privateBoundaryTermsPresent: meaningfulBoundaryFields(activity.boundaries || {}).length > 0,
      },
    } : {}),
  };
}
