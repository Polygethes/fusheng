/**
 * Character-owned operational continuity and discourse context.
 *
 * A world adapter may provide settled interaction events with objective
 * provenance.  This module turns only a character's own settled acts into
 * first-person memory, and exposes public/shared continuity without deciding
 * what the character believes, says, or does next.
 */

import {
  encodeCharacterPerception,
  normalizeCharacterAgentMemoryState,
  normalizeSemanticFrame,
} from "../../engine/characterAgentMemory.js";

export const CHARACTER_OPERATIONAL_CONTINUITY_VERSION = "character-operational-continuity-v1";
export const CHARACTER_DISCOURSE_CONTEXT_VERSION = "character-discourse-context-v1";

function clone(value) {
  return structuredClone(value);
}

function clean(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function operationIdentity(operation = {}) {
  return clean(operation.actionId || operation.id)
    || [
      clean(operation.actorId),
      clean(operation.kind || operation.actionType),
      clean(operation.visitId),
      clean(operation.summary || operation.visibleAction),
    ].join(":");
}

function normalizedOperation(operation = {}) {
  const actorId = clean(operation.actorId);
  const actionId = clean(operation.actionId);
  const id = clean(operation.id) || `settled-operation:${actionId || operationIdentity(operation)}`;
  const counterpartyIds = unique(operation.counterpartyIds || operation.sharedWithActorIds || []);
  const participantIds = unique([actorId, ...counterpartyIds, ...(operation.participantIds || [])]);
  const summary = clean(operation.summary || operation.visibleAction);
  const actionType = clean(operation.actionType || operation.kind || "interact");
  return {
    schemaVersion: CHARACTER_OPERATIONAL_CONTINUITY_VERSION,
    authority: "objective-settlement-provenance",
    id,
    actionId,
    actorId,
    kind: clean(operation.kind || actionType),
    actionType,
    visitId: clean(operation.visitId),
    status: clean(operation.status || "settled"),
    summary,
    visibleAction: clean(operation.visibleAction || summary),
    speech: clean(operation.speech),
    speechAct: clean(operation.speechAct || "none"),
    speechFunctions: unique(operation.speechFunctions || []),
    zoneId: clean(operation.zoneId),
    objectIds: unique(operation.objectIds || []),
    counterpartyIds,
    participantIds,
    sharedWithActorIds: unique(operation.sharedWithActorIds || counterpartyIds),
    occurredAtSeconds: Number.isFinite(Number(operation.occurredAtSeconds))
      ? Math.max(0, Number(operation.occurredAtSeconds))
      : null,
    semanticFrame: normalizeSemanticFrame(operation.semanticFrame || {
      kind: "self_action",
      predicate: actionType,
      topicId: clean(operation.topic || operation.kind || actionType),
      roles: {
        actor: actorId,
        ...(counterpartyIds[0] ? { receiver: counterpartyIds[0] } : {}),
      },
      object: {
        id: operation.objectIds?.[0] || operation.visitId || id,
        label: clean(operation.objectLabel || operation.topic || summary),
      },
      importance: 0.72,
    }),
  };
}

export function characterOwnedSettledOperations(events = [], characterId = "") {
  const ownerId = clean(characterId);
  const found = new Set();
  return (events || []).map(normalizedOperation).filter((operation) => {
    const key = operationIdentity(operation);
    if (!ownerId || operation.actorId !== ownerId || !key || found.has(key)) return false;
    found.add(key);
    return true;
  });
}

export function mergeCharacterRecentOwnActions({
  characterId = "",
  settledInteractionEvents = [],
  runtimeActions = [],
  limit = 4,
} = {}) {
  const ownerId = clean(characterId);
  const historical = characterOwnedSettledOperations(settledInteractionEvents, ownerId).map((operation) => ({
    actionId: operation.actionId || operation.id,
    actionType: operation.actionType,
    speechAct: operation.speechAct,
    speechFunctions: clone(operation.speechFunctions),
    speech: operation.speech,
    visibleAction: operation.visibleAction,
    zoneId: operation.zoneId,
    settled: true,
    continuitySource: "objective-settlement-provenance",
    interactionEventId: operation.id,
    counterpartyIds: clone(operation.counterpartyIds),
    objectIds: clone(operation.objectIds),
  }));
  const current = (runtimeActions || []).filter((action) => !ownerId || action.actorId === ownerId).map((action) => ({
    actionId: clean(action.id || action.actionId),
    actionType: clean(action.actionType),
    speechAct: clean(action.speechAct || "none"),
    speechFunctions: unique(action.speechFunctions || []),
    speech: clean(action.speech),
    visibleAction: clean(action.visibleAction),
    zoneId: clean(action.moveToZoneId || action.actorZoneId || action.zoneId),
    settled: action.committed !== false,
    continuitySource: "runtime-action-history",
    interactionEventId: "",
    counterpartyIds: unique([action.targetCharacterId]),
    objectIds: unique([action.actionAttempt?.objectId, ...(action.objectIds || [])]),
  }));
  const merged = new Map();
  for (const action of [...historical, ...current]) {
    const key = clean(action.actionId)
      || [action.actionType, action.speech, action.visibleAction, action.zoneId].join(":");
    if (!key) continue;
    merged.set(key, action);
  }
  return [...merged.values()].slice(-Math.max(1, Number(limit || 4)));
}

export function seedCharacterOwnedOperationMemory(memoryState = {}, {
  characterId = "",
  settledInteractionEvents = [],
  nowSeconds = 0,
  worldDay = 0,
  locationId = "",
  zoneId = "",
} = {}) {
  const ownerId = clean(characterId || memoryState.ownerCharacterId);
  let next = normalizeCharacterAgentMemoryState(memoryState, ownerId);
  for (const operation of characterOwnedSettledOperations(settledInteractionEvents, ownerId)) {
    const sourceActionId = clean(operation.actionId || operation.id);
    const alreadyEncoded = (next.episodes || []).some((episode) => (
      episode.source?.kind === "self_action"
      && clean(episode.source?.sourceActionId) === sourceActionId
    ));
    if (alreadyEncoded) continue;
    const impactId = `self-action-impact:${sourceActionId}`;
    const evidenceId = `self-action-evidence:${sourceActionId}`;
    const encodedAtSeconds = operation.occurredAtSeconds ?? Math.max(0, Number(nowSeconds || 0));
    next = encodeCharacterPerception(next, {
      impact: {
        id: impactId,
        objectiveEventId: sourceActionId,
        causedByActionId: sourceActionId,
        sourceCharacterId: ownerId,
        type: "self_action",
        modality: "proprioceptive",
        content: operation.summary,
        topic: operation.kind,
        semanticFrame: operation.semanticFrame,
      },
      delivery: {
        id: evidenceId,
        evidenceId,
        impactId,
        objectiveEventId: sourceActionId,
        recipientId: ownerId,
        sourceCharacterId: ownerId,
        perceivedSourceCharacterId: ownerId,
        sourceEntityHandle: ownerId,
        identityKnown: true,
        directed: true,
        modality: "proprioceptive",
        content: operation.summary,
        topic: operation.kind,
        receivedIntensity: 100,
        personalRelevance: 70,
        semanticFrame: operation.semanticFrame,
        provenance: {
          kind: "self_action",
          sourceActionId,
          sourceCharacterChain: [ownerId],
          confidence: 0.99,
        },
      },
      provenance: {
        kind: "self_action",
        sourceActionId,
        sourceCharacterChain: [ownerId],
        confidence: 0.99,
      },
      encodingContext: {
        attention: 0.96,
        goalRelevance: 0.62,
        surprise: 0.08,
        emotionalArousal: 0.24,
        selfRelevance: 1,
        relationshipRelevance: operation.counterpartyIds.length ? 0.58 : 0.18,
        fatigue: 0,
        cognitiveLoad: 0.08,
      },
      interpretation: operation.summary,
      nowSeconds: encodedAtSeconds,
      worldDay,
      locationId,
      zoneId: operation.zoneId || zoneId,
    });
  }
  return next;
}

export function deriveCharacterDiscourseContext({
  characterId = "",
  settledInteractionEvents = [],
  recentOwnActions = [],
  openConversationThreads = [],
} = {}) {
  const actorId = clean(characterId);
  const sharedEvents = (settledInteractionEvents || []).map(normalizedOperation).filter((event) => (
    event.participantIds.includes(actorId)
  )).map((event) => ({
    id: event.id,
    kind: event.kind,
    status: event.status,
    actorId: event.actorId,
    participantIds: clone(event.participantIds),
    summary: event.summary,
    actionId: event.actionId,
    objectIds: clone(event.objectIds),
    sourceAuthority: event.authority,
  }));
  const publicTurns = (openConversationThreads || []).flatMap((thread) => (
    (thread.turns || []).map((turn) => ({
      id: clean(turn.id),
      threadId: clean(thread.id),
      speakerId: clean(turn.speakerId),
      addresseeId: clean(turn.addresseeId),
      speechAct: clean(turn.speechAct || "none"),
      speechFunctions: unique(turn.speechFunctions || []),
      utterance: clean(turn.utterance),
      truthStatus: "literal-public-content-not-automatically-verified",
    }))
  )).filter((turn) => turn.id && turn.utterance).slice(-8);
  const ownActs = (recentOwnActions || []).map((action, index) => ({
    id: clean(action.actionId || action.interactionEventId) || `own-act:${index}`,
    actionType: clean(action.actionType),
    speech: clean(action.speech),
    visibleAction: clean(action.visibleAction),
    settled: action.settled !== false,
    source: clean(action.continuitySource),
  })).filter((action) => action.actionType || action.speech || action.visibleAction).slice(-6);
  return {
    schemaVersion: CHARACTER_DISCOURSE_CONTEXT_VERSION,
    authority: "objective-settlement-and-literal-public-history",
    settledSharedEvents: sharedEvents,
    recentPublicTurns: publicTurns,
    speakerOwnedActs: ownActs,
    anchorIds: unique([
      ...sharedEvents.map((event) => event.id),
      ...publicTurns.map((turn) => turn.id),
      ...ownActs.map((action) => action.id),
    ]),
    interpretationBoundary: "这些材料说明本人可取得的已结算共同经历、本人行动和实际字面话语；它们不保证他人说的内容为真，也不替人物决定相信、遗忘、误记、撒谎、试探、逗弄或重新发问。",
  };
}
