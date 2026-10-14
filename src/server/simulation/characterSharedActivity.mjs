/**
 * Generic negotiated activity and scoped-access state.
 *
 * Each participant owns only their response. The world stores the resulting
 * public state and may issue a scoped access grant when an authorized person
 * actually does so; it never infers consent from personality or utility.
 */

export const CHARACTER_SHARED_ACTIVITY_VERSION = "character-shared-activity-v1.1";

const RESPONSES = new Set(["accept", "refuse", "counter"]);

function clean(value = "") {
  return String(value ?? "").trim();
}

/**
 * A conversation turn is already represented by the conversation-thread
 * ledger.  It does not require the world to manufacture a second consent
 * protocol merely because two people are speaking.  Shared activities are
 * reserved for commitments whose execution needs mutual participation,
 * coordination, access, or continuing terms beyond ordinary turn-taking.
 *
 * This classifies structured activity kinds, never literal dialogue.  A
 * character remains free to ask, answer, evade, lie, tease, or stay silent.
 */
export function isConversationTurnTakingOnlyKind(kind = "") {
  const normalized = clean(kind).toLowerCase();
  if (!normalized) return false;
  const latinTokens = normalized
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (latinTokens.some((token) => [
    "conversation", "dialogue", "dialog", "chat", "inquiry", "question", "answer", "qna",
  ].includes(token))) return true;
  return /(对话|交谈|谈话|聊天|问答|问询|询问|答话)/u.test(normalized);
}

function unique(values = []) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function clone(value) {
  return structuredClone(value);
}

function activityError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

export function createCharacterSharedActivityProposal({
  activityId = "",
  kind = "custom",
  initiatorId = "",
  participantIds = [],
  requestedZoneId = "",
  boundaries = {},
  sourceActionId = "",
} = {}) {
  const id = clean(activityId);
  const initiator = clean(initiatorId);
  const participants = unique([initiator, ...participantIds]);
  if (!id) throw activityError("SHARED_ACTIVITY_ID_REQUIRED", "A shared activity needs an id.");
  if (!initiator) throw activityError("SHARED_ACTIVITY_INITIATOR_REQUIRED", "A shared activity needs an initiator.");
  if (participants.length < 2) throw activityError("SHARED_ACTIVITY_PARTICIPANTS_REQUIRED", "A shared activity needs at least two participants.");
  if (isConversationTurnTakingOnlyKind(kind)) {
    throw activityError(
      "SHARED_ACTIVITY_TURN_TAKING_ONLY",
      "Ordinary asking, answering, and conversation belong to the conversation thread, not the negotiated shared-activity ledger.",
      { kind: clean(kind) },
    );
  }
  return {
    schemaVersion: CHARACTER_SHARED_ACTIVITY_VERSION,
    authority: "world-shared-activity-ledger",
    activityId: id,
    kind: clean(kind) || "custom",
    initiatorId: initiator,
    participantIds: participants,
    status: "proposed",
    requestedZoneId: clean(requestedZoneId),
    boundaries: clone(boundaries || {}),
    consentByCharacterId: Object.fromEntries(participants.map((characterId) => [
      characterId,
      characterId === initiator ? "accepted" : "pending",
    ])),
    responseByCharacterId: {},
    responseHistory: [],
    pendingResponseCharacterIds: participants.filter((characterId) => characterId !== initiator),
    counteredByCharacterId: "",
    accessGrantIds: [],
    sourceActionIds: unique([sourceActionId]),
  };
}

export function applyCharacterSharedActivityResponse(activity = {}, {
  responderId = "",
  response = "",
  sourceActionId = "",
  counter = {},
} = {}) {
  const responder = clean(responderId);
  const normalizedResponse = clean(response);
  if (!(activity.participantIds || []).includes(responder)) {
    throw activityError("SHARED_ACTIVITY_RESPONDER_NOT_PARTICIPANT", "Only a participant may respond to a shared activity.", { responderId: responder });
  }
  if (activity.consentByCharacterId?.[responder] !== "pending") {
    throw activityError("SHARED_ACTIVITY_RESPONSE_NOT_OWNED", "This participant has no pending consent response to own.", { responderId: responder });
  }
  if (!RESPONSES.has(normalizedResponse)) {
    throw activityError("SHARED_ACTIVITY_RESPONSE_INVALID", "Unknown shared-activity response.", { response: normalizedResponse });
  }
  const next = clone(activity);
  const responseRecord = {
    response: normalizedResponse,
    counter: normalizedResponse === "counter" ? clone(counter || {}) : {},
    sourceActionId: clean(sourceActionId),
  };
  next.responseByCharacterId[responder] = responseRecord;
  next.responseHistory = [
    ...(next.responseHistory || []),
    { responderId: responder, ...clone(responseRecord) },
  ];
  if (normalizedResponse === "counter") {
    // A counteroffer is a new set of terms owned by the counterer.  The
    // counterer has accepted those revised terms; every other participant must
    // now answer for themselves.  Leaving the counterer as `countered` would
    // strand the activity with no participant who legally owns the next reply.
    next.consentByCharacterId = Object.fromEntries((next.participantIds || []).map((characterId) => [
      characterId,
      characterId === responder ? "accepted" : "pending",
    ]));
    next.counteredByCharacterId = responder;
    if (clean(counter?.kind)) next.kind = clean(counter.kind);
    if (clean(counter?.requestedZoneId)) next.requestedZoneId = clean(counter.requestedZoneId);
    if (counter?.boundaries && typeof counter.boundaries === "object" && !Array.isArray(counter.boundaries)) {
      next.boundaries = { ...(next.boundaries || {}), ...clone(counter.boundaries) };
    }
  } else {
    next.consentByCharacterId[responder] = normalizedResponse === "accept" ? "accepted" : "refused";
  }
  next.sourceActionIds = unique([...(next.sourceActionIds || []), sourceActionId]);
  const consentStates = Object.values(next.consentByCharacterId || {});
  next.pendingResponseCharacterIds = (next.participantIds || [])
    .filter((characterId) => next.consentByCharacterId?.[characterId] === "pending");
  next.status = consentStates.includes("refused")
    ? "refused"
    : consentStates.every((value) => value === "accepted")
      ? "accepted"
      : next.counteredByCharacterId
      ? "countered"
      : "proposed";
  return next;
}

export function createScopedCharacterAccessGrant({
  grantId = "",
  grantorId = "",
  authorizedGrantorIds = [],
  beneficiaryIds = [],
  zoneIds = [],
  activity = {},
  issuedAtStep = 0,
  expiresAtStep = 0,
} = {}) {
  const grantor = clean(grantorId);
  if (!new Set(unique(authorizedGrantorIds)).has(grantor)) {
    throw activityError("SCOPED_ACCESS_GRANTOR_UNAUTHORIZED", "Only an authorized person may issue this access grant.", { grantorId: grantor });
  }
  if (!["accepted", "coordinating", "active"].includes(clean(activity.status))) {
    throw activityError("SCOPED_ACCESS_ACTIVITY_NOT_ACCEPTED", "Scoped activity access requires accepted participant intent.", { activityId: activity.activityId, status: activity.status });
  }
  const participants = new Set(unique(activity.participantIds || []));
  const beneficiaries = unique(beneficiaryIds);
  if (!beneficiaries.length || beneficiaries.some((id) => !participants.has(id))) {
    throw activityError("SCOPED_ACCESS_BENEFICIARY_INVALID", "Access beneficiaries must be participants in the accepted activity.");
  }
  const zones = unique(zoneIds);
  if (!zones.length) throw activityError("SCOPED_ACCESS_ZONE_REQUIRED", "A scoped access grant needs at least one zone.");
  const start = Math.max(0, Number(issuedAtStep) || 0);
  const end = Math.max(start, Number(expiresAtStep) || start);
  return {
    schemaVersion: CHARACTER_SHARED_ACTIVITY_VERSION,
    authority: "world-access-ledger",
    grantId: clean(grantId),
    grantorId: grantor,
    beneficiaryIds: beneficiaries,
    zoneIds: zones,
    activityId: clean(activity.activityId),
    issuedAtStep: start,
    expiresAtStep: end,
    status: "active",
  };
}

export function canCharacterUseScopedAccessGrant(grant = {}, {
  characterId = "",
  zoneId = "",
  step = 0,
} = {}) {
  const currentStep = Math.max(0, Number(step) || 0);
  return grant.status === "active"
    && (grant.beneficiaryIds || []).includes(clean(characterId))
    && (grant.zoneIds || []).includes(clean(zoneId))
    && currentStep >= Number(grant.issuedAtStep || 0)
    && currentStep <= Number(grant.expiresAtStep || 0);
}
