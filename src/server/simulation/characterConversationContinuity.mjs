import { createHash } from "node:crypto";

export const CHARACTER_CONVERSATION_CONTINUITY_VERSION = "character-conversation-continuity-v1";

const DEFAULT_MAX_DURABLE_RECENT_TURNS = 24;
const DEFAULT_MAX_DURABLE_THREADS = 32;
const DEFAULT_MAX_PROCESSED_EXPERIENCES = 128;
const DEFAULT_MAX_ARCHIVED_THREAD_SUMMARIES = 32;
const DEFAULT_MAX_PROJECTED_ANCHORS = 8;
const DEFAULT_MAX_PROJECTED_RECENT_TURNS = 6;
const RAW_LINEAGE_INPUT_FIELDS = new Set([
  "conversationThreadHandle",
  "lineageBinding",
  "parentTurnId",
  "responseToTurnId",
  "sourceActionId",
  "sourceThreadId",
  "threadId",
  "worldThreadId",
]);

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function unique(values = []) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function finiteNonNegative(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : Math.max(0, Number(fallback || 0));
}

function opaqueConversationAnchorHandle(ownerCharacterId = "", worldThreadId = "") {
  const digest = createHash("sha256")
    .update(`${CHARACTER_CONVERSATION_CONTINUITY_VERSION}\u0000${clean(ownerCharacterId)}\u0000${clean(worldThreadId)}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  digest[12] = "5";
  digest[16] = ["8", "9", "a", "b"][Number.parseInt(digest[16], 16) % 4];
  const compact = digest.join("");
  return `conversation-anchor:${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function fail(code, message, evidence = {}) {
  const error = new Error(message);
  error.code = code;
  error.evidence = clone(evidence);
  return error;
}

function findRawLineageInput(value, path = "input") {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findRawLineageInput(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return "";
  }
  for (const [key, child] of Object.entries(value)) {
    if (RAW_LINEAGE_INPUT_FIELDS.has(key)) return `${path}.${key}`;
    const found = findRawLineageInput(child, `${path}.${key}`);
    if (found) return found;
  }
  return "";
}

function assertNoRawLineageInput(value, path = "input") {
  const field = findRawLineageInput(value, path);
  if (field) {
    throw fail(
      "CHARACTER_CONVERSATION_RAW_LINEAGE_INPUT_FORBIDDEN",
      "Character-authored conversation selections and appraisals may use only opaque anchor handles.",
      { field },
    );
  }
}

function positiveIntegerLimit(value, fallback) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function continuityPolicy(policy = {}) {
  return {
    maxDurableThreads: positiveIntegerLimit(policy.maxDurableThreads, DEFAULT_MAX_DURABLE_THREADS),
    maxProcessedExperiences: positiveIntegerLimit(
      policy.maxProcessedExperiences,
      DEFAULT_MAX_PROCESSED_EXPERIENCES,
    ),
    maxArchivedThreadSummaries: positiveIntegerLimit(
      policy.maxArchivedThreadSummaries,
      DEFAULT_MAX_ARCHIVED_THREAD_SUMMARIES,
    ),
  };
}

function threadAgeOrder(left = {}, right = {}) {
  return finiteNonNegative(left.lastExperiencedAtSeconds) - finiteNonNegative(right.lastExperiencedAtSeconds)
    || clean(left.worldThreadId).localeCompare(clean(right.worldThreadId));
}

function archiveAgeOrder(left = {}, right = {}) {
  return finiteNonNegative(left.archivedAtSeconds) - finiteNonNegative(right.archivedAtSeconds)
    || clean(left.worldThreadId).localeCompare(clean(right.worldThreadId));
}

function archiveSummary(thread = {}) {
  const lastExperiencedTurn = clone((thread.recentTurns || []).at(-1) || null);
  return {
    schemaVersion: CHARACTER_CONVERSATION_CONTINUITY_VERSION,
    authority: "character-private-conversation-archive-summary",
    ownerCharacterId: clean(thread.ownerCharacterId),
    archiveId: clean(thread.anchorHandle),
    worldThreadId: clean(thread.worldThreadId),
    participantHandles: unique(thread.participantHandles),
    archivedReason: "durable_thread_capacity",
    archivedAtSeconds: finiteNonNegative(thread.lastExperiencedAtSeconds),
    experiencedTurnCount: Math.max(0, Number(thread.recentTurns?.length || 0)),
    lastExperiencedTurn,
  };
}

function compactState(state, rawPolicy = {}) {
  const policy = continuityPolicy(rawPolicy);
  state.processedExperiences = (state.processedExperiences || [])
    .slice(-policy.maxProcessedExperiences)
    .map(clone);
  state.processedExperienceIds = unique(state.processedExperiences.map((row) => row?.experienceId));

  const excess = Math.max(0, (state.threads || []).length - policy.maxDurableThreads);
  if (excess > 0) {
    const evictionOrder = [...state.threads].sort((left, right) => {
      const leftClosed = clean(left.status) === "closed" || left.resumable === false;
      const rightClosed = clean(right.status) === "closed" || right.resumable === false;
      return Number(rightClosed) - Number(leftClosed) || threadAgeOrder(left, right);
    });
    const evicted = evictionOrder.slice(0, excess);
    const evictedIds = new Set(evicted.map((row) => clean(row.worldThreadId)));
    state.threads = state.threads.filter((row) => !evictedIds.has(clean(row.worldThreadId)));
    const openEvictions = evicted
      .filter((row) => clean(row.status) !== "closed" && row.resumable !== false)
      .map(archiveSummary);
    const archivedByThread = new Map((state.archivedThreadSummaries || []).map((row) => [
      clean(row.worldThreadId),
      clone(row),
    ]));
    for (const summary of openEvictions) archivedByThread.set(clean(summary.worldThreadId), summary);
    state.archivedThreadSummaries = [...archivedByThread.values()]
      .sort(archiveAgeOrder)
      .slice(-policy.maxArchivedThreadSummaries);
  } else {
    state.archivedThreadSummaries = (state.archivedThreadSummaries || [])
      .sort(archiveAgeOrder)
      .slice(-policy.maxArchivedThreadSummaries)
      .map(clone);
  }
  state.threads = [...(state.threads || [])].sort(threadAgeOrder);
  return state;
}

function normalizeState(input, ownerCharacterId, policy = {}) {
  const source = input || {};
  const claimedOwner = clean(source.ownerCharacterId);
  if (claimedOwner && claimedOwner !== ownerCharacterId) {
    throw fail(
      "CHARACTER_CONVERSATION_STATE_OWNER_MISMATCH",
      "Conversation continuity state belongs to another Character.",
      { ownerCharacterId, claimedOwnerCharacterId: claimedOwner },
    );
  }
  return compactState({
    schemaVersion: CHARACTER_CONVERSATION_CONTINUITY_VERSION,
    authority: "character-private-conversation-continuity",
    ownerCharacterId,
    threads: clone(source.threads || []),
    archivedThreadSummaries: clone(source.archivedThreadSummaries || []),
    processedExperienceIds: unique(source.processedExperienceIds),
    processedExperiences: clone(source.processedExperiences || []),
    lastAdvancedAtSeconds: finiteNonNegative(source.lastAdvancedAtSeconds),
  }, policy);
}

function requireOwner(ownerCharacterId) {
  const owner = clean(ownerCharacterId);
  if (!owner) {
    throw fail("CHARACTER_CONVERSATION_OWNER_REQUIRED", "Conversation continuity requires an owner.");
  }
  return owner;
}

function allowedModesForIncoming(record = {}) {
  if (clean(record.threadStatus || "open") === "closed" && record.resumable === false) return [];
  return ["reply", "continue"];
}

function incomingTurn(record = {}, ownerCharacterId) {
  return {
    direction: "incoming",
    speakerHandle: clean(record.sourceParticipantHandle),
    addresseeHandles: record.directed === true ? [ownerCharacterId] : [],
    utterance: clean(record.content),
    speechAct: clean(record.speechAct || "inform"),
    occurredAtSeconds: finiteNonNegative(record.occurredAtSeconds),
    runtimeTurnId: clean(record.provenance?.sourceActionId),
    runtimeExperienceId: clean(record.deliveryId),
  };
}

function replayResult({ state, owner, experienceId, worldThreadId, runtimeTurnId }) {
  if (!state.processedExperienceIds.includes(experienceId)) return null;
  const receipt = state.processedExperiences.find((row) => clean(row.experienceId) === experienceId);
  const sameWorldThread = !receipt || clean(receipt.worldThreadId) === worldThreadId;
  const sameRuntimeTurn = !receipt || clean(receipt.runtimeTurnId) === runtimeTurnId;
  if (!sameWorldThread || !sameRuntimeTurn) {
    throw fail(
      "CHARACTER_CONVERSATION_EXPERIENCE_REPLAY_CONFLICT",
      "A repeated conversation experience id carries different runtime lineage.",
      { experienceId },
    );
  }
  const existing = state.threads.find((row) => clean(row.worldThreadId) === worldThreadId);
  return {
    schemaVersion: CHARACTER_CONVERSATION_CONTINUITY_VERSION,
    ownerCharacterId: owner,
    conversationState: clone(state),
    anchorHandle: clean(receipt?.anchorHandle || existing?.anchorHandle),
    changed: false,
    worldChanged: false,
  };
}

function recordExperience(state, { experienceId, worldThreadId, runtimeTurnId, anchorHandle }) {
  state.processedExperienceIds = unique([...state.processedExperienceIds, experienceId]);
  state.processedExperiences = [
    ...state.processedExperiences.filter((row) => clean(row.experienceId) !== experienceId),
    {
      authority: "server-owned-conversation-experience-receipt",
      experienceId,
      worldThreadId,
      runtimeTurnId,
      anchorHandle,
    },
  ];
}

function advanceSettledOutgoing({ owner, state, experience, nowSeconds, policy }) {
  const record = experience.runtimeRecord || {};
  if (clean(record.authority) !== "world-settled-outgoing-speech") {
    throw fail("CHARACTER_CONVERSATION_RUNTIME_AUTHORITY_INVALID", "Outgoing speech must come from world settlement authority.");
  }
  if (
    clean(record.actorCharacterId) !== owner
    || clean(record.outcomeStatus) !== "settled"
    || clean(record.eventKind) !== "speech"
  ) {
    throw fail("CHARACTER_CONVERSATION_OUTGOING_NOT_SETTLED", "Only this Character's settled public speech can continue a conversation.");
  }
  const worldThreadId = clean(record.provenance?.sourceThreadId);
  const runtimeTurnId = clean(record.provenance?.sourceActionId);
  const settlementId = clean(record.settlementId);
  const targetHandles = unique(record.targetParticipantHandles || [])
    .filter((handle) => handle !== owner);
  const actualRecipientHandles = unique(record.actualRecipientParticipantHandles || [])
    .filter((handle) => handle !== owner);
  if (!settlementId || !worldThreadId || !runtimeTurnId || !clean(record.content)) {
    throw fail("CHARACTER_CONVERSATION_OUTGOING_INCOMPLETE", "Settled speech is missing server-owned conversation facts.");
  }
  const experienceId = `outgoing:${settlementId}`;
  const replay = replayResult({ state, owner, experienceId, worldThreadId, runtimeTurnId });
  if (replay) return replay;
  const durableTurnLimit = Math.max(1, Math.floor(Number(policy.maxDurableRecentTurns || DEFAULT_MAX_DURABLE_RECENT_TURNS)));
  let thread = state.threads.find((row) => clean(row.worldThreadId) === worldThreadId);
  if (!thread) {
    thread = {
      schemaVersion: CHARACTER_CONVERSATION_CONTINUITY_VERSION,
      authority: "character-private-conversation-thread-record",
      ownerCharacterId: owner,
      anchorHandle: opaqueConversationAnchorHandle(owner, worldThreadId),
      worldThreadId,
      participantHandles: [],
      status: "open",
      resumable: true,
      allowedModes: [],
      lastExperiencedTurnId: "",
      lastExperiencedAtSeconds: 0,
      recentTurns: [],
    };
    state.threads.push(thread);
  }
  thread.participantHandles = unique([...thread.participantHandles, ...targetHandles]);
  thread.status = clean(record.threadStatus || "open") === "closed" ? "closed" : "open";
  thread.resumable = record.resumable !== false;
  thread.allowedModes = thread.status === "closed" && !thread.resumable ? [] : ["continue"];
  thread.lastExperiencedTurnId = runtimeTurnId;
  thread.lastExperiencedAtSeconds = finiteNonNegative(record.occurredAtSeconds, nowSeconds);
  thread.recentTurns = [...thread.recentTurns, {
    direction: "outgoing",
    speakerHandle: owner,
    addresseeHandles: targetHandles,
    utterance: clean(record.content),
    speechAct: clean(record.speechAct || "inform"),
    actualRecipientHandles,
    occurredAtSeconds: finiteNonNegative(record.occurredAtSeconds),
    runtimeTurnId,
    runtimeExperienceId: settlementId,
  }].slice(-durableTurnLimit);
  recordExperience(state, {
    experienceId,
    worldThreadId,
    runtimeTurnId,
    anchorHandle: thread.anchorHandle,
  });
  state.lastAdvancedAtSeconds = Math.max(
    state.lastAdvancedAtSeconds,
    finiteNonNegative(nowSeconds),
    thread.lastExperiencedAtSeconds,
  );
  compactState(state, policy);
  return {
    schemaVersion: CHARACTER_CONVERSATION_CONTINUITY_VERSION,
    ownerCharacterId: owner,
    conversationState: clone(state),
    anchorHandle: thread.anchorHandle,
    changed: true,
    worldChanged: false,
  };
}

/**
 * Advance one Character's durable, private conversation continuity from a
 * server-verified experience. World lineage stays behind this interface.
 */
export function advanceCharacterConversationContinuity(input = {}) {
  const {
    ownerCharacterId = "",
    conversationState = null,
    experience = {},
    nowSeconds = 0,
    policy = {},
    ...inputExtensions
  } = input;
  assertNoRawLineageInput(inputExtensions, "input");
  const owner = requireOwner(ownerCharacterId);
  const state = normalizeState(conversationState, owner, policy);
  const { runtimeRecord: _runtimeRecord, ...characterSuppliedExperience } = experience || {};
  assertNoRawLineageInput(characterSuppliedExperience, "experience");
  if (clean(experience.kind) === "settled_outgoing_speech") {
    return advanceSettledOutgoing({ owner, state, experience, nowSeconds, policy });
  }
  if (clean(experience.kind) !== "noticed_speech_delivery") {
    throw fail("CHARACTER_CONVERSATION_EXPERIENCE_KIND_INVALID", "Unsupported conversation experience kind.");
  }
  const record = experience.runtimeRecord || {};
  if (clean(record.authority) !== "runtime-noticed-speech-delivery") {
    throw fail("CHARACTER_CONVERSATION_RUNTIME_AUTHORITY_INVALID", "Incoming speech must come from runtime-noticed delivery authority.");
  }
  if (clean(record.recipientCharacterId) !== owner || record.noticed !== true || clean(record.eventKind) !== "speech") {
    throw fail("CHARACTER_CONVERSATION_INCOMING_NOT_OWNED", "Only speech actually received and noticed by this Character can continue a conversation.");
  }
  const worldThreadId = clean(record.provenance?.sourceThreadId);
  const runtimeTurnId = clean(record.provenance?.sourceActionId);
  const participantHandle = clean(record.sourceParticipantHandle);
  if (!clean(record.deliveryId) || !worldThreadId || !runtimeTurnId || !participantHandle || !clean(record.content)) {
    throw fail("CHARACTER_CONVERSATION_INCOMING_INCOMPLETE", "Noticed speech is missing server-owned conversation facts.");
  }
  const experienceId = `incoming:${clean(record.deliveryId)}`;
  const replay = replayResult({ state, owner, experienceId, worldThreadId, runtimeTurnId });
  if (replay) return replay;
  const durableTurnLimit = Math.max(1, Math.floor(Number(policy.maxDurableRecentTurns || DEFAULT_MAX_DURABLE_RECENT_TURNS)));
  let thread = state.threads.find((row) => clean(row.worldThreadId) === worldThreadId);
  if (!thread) {
    thread = {
      schemaVersion: CHARACTER_CONVERSATION_CONTINUITY_VERSION,
      authority: "character-private-conversation-thread-record",
      ownerCharacterId: owner,
      anchorHandle: opaqueConversationAnchorHandle(owner, worldThreadId),
      worldThreadId,
      participantHandles: [],
      status: "open",
      resumable: true,
      allowedModes: [],
      lastExperiencedTurnId: "",
      lastExperiencedAtSeconds: 0,
      recentTurns: [],
    };
    state.threads.push(thread);
  }
  thread.participantHandles = unique([...thread.participantHandles, participantHandle]);
  thread.status = clean(record.threadStatus || "open") === "closed" ? "closed" : "open";
  thread.resumable = record.resumable !== false;
  thread.allowedModes = allowedModesForIncoming(record);
  thread.lastExperiencedTurnId = runtimeTurnId;
  thread.lastExperiencedAtSeconds = finiteNonNegative(record.occurredAtSeconds, nowSeconds);
  thread.recentTurns = [...thread.recentTurns, incomingTurn(record, owner)].slice(-durableTurnLimit);
  recordExperience(state, {
    experienceId,
    worldThreadId,
    runtimeTurnId,
    anchorHandle: thread.anchorHandle,
  });
  state.lastAdvancedAtSeconds = Math.max(
    state.lastAdvancedAtSeconds,
    finiteNonNegative(nowSeconds),
    thread.lastExperiencedAtSeconds,
  );
  compactState(state, policy);
  return {
    schemaVersion: CHARACTER_CONVERSATION_CONTINUITY_VERSION,
    ownerCharacterId: owner,
    conversationState: clone(state),
    anchorHandle: thread.anchorHandle,
    changed: true,
    worldChanged: false,
  };
}

/** Project only bounded, resumable handles and lived turn surfaces. */
export function projectOwnedConversationAnchors({
  ownerCharacterId = "",
  conversationState = null,
  nowSeconds = 0,
  maxAnchors = DEFAULT_MAX_PROJECTED_ANCHORS,
  maxRecentTurns = DEFAULT_MAX_PROJECTED_RECENT_TURNS,
} = {}) {
  const owner = requireOwner(ownerCharacterId);
  const state = normalizeState(conversationState, owner);
  const anchorLimit = Math.max(1, Math.floor(Number(maxAnchors || DEFAULT_MAX_PROJECTED_ANCHORS)));
  const turnLimit = Math.max(1, Math.floor(Number(maxRecentTurns || DEFAULT_MAX_PROJECTED_RECENT_TURNS)));
  const anchors = state.threads
    .filter((thread) => clean(thread.ownerCharacterId) === owner)
    .filter((thread) => thread.resumable !== false && (thread.allowedModes || []).length > 0)
    .sort((left, right) => finiteNonNegative(right.lastExperiencedAtSeconds) - finiteNonNegative(left.lastExperiencedAtSeconds))
    .slice(0, anchorLimit)
    .map((thread) => ({
      authority: "character-private-resumable-conversation-anchor",
      anchorHandle: clean(thread.anchorHandle),
      participantHandles: unique(thread.participantHandles),
      allowedModes: unique(thread.allowedModes),
      status: clean(thread.status || "open"),
      lastExperiencedAtSeconds: finiteNonNegative(thread.lastExperiencedAtSeconds),
      replyTargetHandle: clean((thread.recentTurns || []).find(turn => turn.runtimeTurnId === thread.lastExperiencedTurnId)?.direction) === "incoming"
        ? clean((thread.recentTurns || []).find(turn => turn.runtimeTurnId === thread.lastExperiencedTurnId)?.speakerHandle) : "",
      recentTurns: (thread.recentTurns || []).slice(-turnLimit).map((turn) => ({
        direction: clean(turn.direction),
        speakerHandle: clean(turn.speakerHandle),
        addresseeHandles: unique(turn.addresseeHandles),
        utterance: clean(turn.utterance),
        speechAct: clean(turn.speechAct || "inform"),
        occurredAtSeconds: finiteNonNegative(turn.occurredAtSeconds),
      })),
    }));
  return {
    schemaVersion: CHARACTER_CONVERSATION_CONTINUITY_VERSION,
    authority: "character-private-conversation-anchor-projection",
    ownerCharacterId: owner,
    nowSeconds: finiteNonNegative(nowSeconds),
    anchors,
    selection: null,
  };
}

// Older projections may omit the explicit target but still carry their latest
// lived turn. Never treat every participant in a group as its latest speaker.
export function projectedReplyTargets(anchor = {}) {
  if (Object.hasOwn(anchor, "replyTargetHandle")) return anchor.replyTargetHandle ? [anchor.replyTargetHandle] : [];
  const latest = anchor.recentTurns?.at(-1);
  if (latest) return latest.direction === "incoming" && latest.speakerHandle ? [latest.speakerHandle] : [];
  return anchor.participantHandles || [];
}

/**
 * Resolve a Character-selected opaque anchor into one indivisible world
 * lineage binding. Callers cannot choose the thread and parent separately.
 */
export function resolveOwnedConversationAnchor(input = {}) {
  const {
    ownerCharacterId = "",
    conversationState = null,
    anchorHandle = "",
    mode = "",
    targetParticipantHandle = "",
    ...selectionExtensions
  } = input;
  assertNoRawLineageInput(selectionExtensions, "selection");
  const owner = requireOwner(ownerCharacterId);
  const state = normalizeState(conversationState, owner);
  const handle = clean(anchorHandle);
  const selectedMode = clean(mode);
  const target = clean(targetParticipantHandle);
  const thread = state.threads.find((row) => clean(row.anchorHandle) === handle);
  if (!thread) {
    throw fail("CHARACTER_CONVERSATION_ANCHOR_UNKNOWN", "Conversation anchor is not owned by this Character.", {
      anchorHandle: handle,
    });
  }
  if (clean(thread.ownerCharacterId) !== owner) {
    throw fail("CHARACTER_CONVERSATION_ANCHOR_OWNER_MISMATCH", "Conversation anchor belongs to another Character.");
  }
  if (!(thread.allowedModes || []).includes(selectedMode)) {
    throw fail("CHARACTER_CONVERSATION_MODE_NOT_ALLOWED", "Conversation anchor does not allow the selected continuation mode.", {
      mode: selectedMode,
    });
  }
  if (!thread.participantHandles?.includes(target)) {
    throw fail("CHARACTER_CONVERSATION_TARGET_INCOMPATIBLE", "Target is not a participant in the selected conversation anchor.", {
      targetParticipantHandle: target,
    });
  }
  if (selectedMode === "reply") {
    const parentTurn = [...(thread.recentTurns || [])]
      .reverse()
      .find((turn) => clean(turn.runtimeTurnId) === clean(thread.lastExperiencedTurnId));
    if (clean(parentTurn?.direction) !== "incoming" || clean(parentTurn?.speakerHandle) !== target) {
      throw fail(
        "CHARACTER_CONVERSATION_TARGET_INCOMPATIBLE",
        "Reply target must be the speaker of the exact incoming parent turn.",
        { targetParticipantHandle: target },
      );
    }
  }
  const lineageBinding = Object.freeze({
    authority: "server-owned-conversation-lineage-binding",
    sourceThreadId: clean(thread.worldThreadId),
    responseToTurnId: clean(thread.lastExperiencedTurnId),
  });
  return {
    schemaVersion: CHARACTER_CONVERSATION_CONTINUITY_VERSION,
    authority: "server-owned-conversation-anchor-resolution",
    valid: true,
    ownerCharacterId: owner,
    anchorHandle: handle,
    mode: selectedMode,
    targetParticipantHandle: target,
    lineageBinding,
  };
}
