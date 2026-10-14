import { nextWorldTemporalBoundary } from "./worldTemporalAgenda.mjs";
import { resolvePlaceMovementAttempt } from "./placeMovementBoundary.mjs";
import { movementHindrance, MOVE_BLOCKED_BY_FLOOD } from "./movementHindrance.mjs";
import { interruptDurativeWorldProcess } from "./durativeWorldProcess.mjs";
import {
  applyCharacterSharedActivityResponse,
  createScopedCharacterAccessGrant,
  createCharacterSharedActivityProposal,
} from "./characterSharedActivity.mjs";
import { normalizeOfferingSustenance } from "./cultivationSustenance.mjs";
import { serviceBodyDemand } from "./materialEconomy.mjs";
import { applyObjectOperations, objectVisibleToObserver } from "./objectLedger.mjs";
import { physicalAttemptForSettlement, renderBodyActions, validBodyActions } from "./physicalExpression.mjs";
import { validWaitCondition } from "./characterExecutionControl.mjs";
import {
  healthOf,
  healthNews,
  onlookerNews,
  observableCondition,
} from "./characterHealth.mjs";
import { confrontationOutcome, rollFor, movementHeldBy, personFor } from "./confrontation.mjs";
import { marriageOutcome } from "./marriage.mjs";
import { conceptionAfterWedding } from "./lifeCycle.mjs";
import { takenFromOthers, ownersAfterGiving, ownershipNote } from "./property.mjs";
import { sustenanceOutcome } from "./sustenance.mjs";
import { fallAsleep } from "./sleep.mjs";
import { exchangeOutcome } from "./exchange.mjs";
import { mergeSpeechAlong, pursuitPlan, PURSUIT_FAILURES } from "./pursuit.mjs";

export const WORLD_ACTION_REGISTRY_VERSION = "world-action-registry-v1";

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").trim();
}

function unique(values = []) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function fail(code, message, evidence = {}) {
  const error = new Error(message);
  error.code = code;
  error.evidence = clone(evidence);
  return error;
}

function entityFor(state = {}, entityId = "") {
  return state.entities?.[clean(entityId)] || null;
}

function objectFor(state = {}, objectId = "") {
  return state.objects?.[clean(objectId)] || null;
}

function placeForActor(state = {}, actor = {}) {
  return state.places?.[clean(actor.placeId)] || null;
}

function setOperation(path, value) {
  return { op: "set", path, value: clone(value) };
}

function appendOperation(path, value) {
  return { op: "append", path, value: clone(value) };
}

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asUnit(value, fallback = 0) {
  const numeric = finite(value, fallback);
  return Math.max(0, Math.min(1, Math.abs(numeric) > 1 ? numeric / 100 : numeric));
}

function rounded(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(finite(value) * factor) / factor;
}

function baseResolution(attempt = {}) {
  return {
    authority: "world-action-registry",
    primitive: clean(attempt.primitive),
    status: "failed",
    attemptSurface: [],
    intendedEffects: [],
    resolvedEffects: [],
    failedEffects: [],
    incidentalEffects: [],
    committedFacts: [],
    deliveries: [],
    durationSeconds: 1,
    statePatch: { operations: [] },
  };
}

function interruptOwnedContinuousProcesses({ state = {}, actorId = "", destinationZoneId = "", actionId = "" } = {}) {
  let processes = clone(state.processes || []);
  const interrupted = [];
  for (const process of processes.filter((row) => (
    clean(row.ownerActorId) === clean(actorId)
    && clean(row.status) === "active"
    && clean(row.attentionMode) === "continuous_work"
    && (!clean(destinationZoneId) || clean(row.stationZoneId) !== clean(destinationZoneId))
  ))) {
    const outcome = interruptDurativeWorldProcess(
      processes,
      clean(process.id),
      Number(state.nowSeconds || 0),
      clean(actionId),
    );
    if (!outcome.ok) continue;
    processes = outcome.processes;
    interrupted.push(outcome.process);
  }
  return { processes, interrupted };
}

function actorGate(state, attempt, result) {
  const actor = entityFor(state, attempt.actorId);
  if (!actor || actor.kind !== "character" || actor.present === false) {
    result.failedEffects.push({ code: "ACTION_ACTOR_NOT_PRESENT", actorId: clean(attempt.actorId) });
    return null;
  }
  return actor;
}

function edgeSupports(edge = {}, modality = "sound") {
  const value = Number(edge[modality]);
  if (!Number.isFinite(value) || value <= 0) return false;
  if (edge.blocked === true || edge.open === false) return false;
  if (edge.barrier && modality !== "sound") return false;
  return true;
}

export function routeDistance(topology = {}, fromZoneId = "", toZoneId = "", modality = "sound") {
  const from = clean(fromZoneId);
  const to = clean(toZoneId);
  if (!from || !to) return null;
  if (from === to) return 0;
  const distances = new Map([[from, 0]]);
  const pending = new Set([from]);
  while (pending.size) {
    let current = "";
    let currentDistance = Infinity;
    for (const zoneId of pending) {
      const distance = Number(distances.get(zoneId));
      if (distance < currentDistance) {
        current = zoneId;
        currentDistance = distance;
      }
    }
    pending.delete(current);
    if (current === to) return currentDistance;
    for (const edge of topology.edges || []) {
      if (!edgeSupports(edge, modality)) continue;
      const next = clean(edge.from) === current ? clean(edge.to)
        : clean(edge.to) === current ? clean(edge.from) : "";
      if (!next) continue;
      const candidate = currentDistance + Number(edge[modality]);
      if (candidate >= Number(distances.get(next) ?? Infinity)) continue;
      distances.set(next, candidate);
      pending.add(next);
    }
  }
  return null;
}

// How far a modality carries in this place; null means no limit (the
// built-in worlds set none, so every route they had still counts).
export function perceptionDistanceLimit(place = {}, modality = "visual") {
  const key = { visual: "maxVisualDistance", sound: "maxSoundDistance" }[modality];
  const value = key ? Number(place?.perceptionEnvironment?.[key]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

// Route distance for this modality, or null when there is no route or the
// route is longer than the place lets this modality carry.
export function perceivableRoute(place = {}, fromZoneId = "", toZoneId = "", modality = "visual") {
  const distance = routeDistance(place?.topology || {}, fromZoneId, toZoneId, modality);
  if (distance == null) return null;
  const limit = perceptionDistanceLimit(place, modality);
  return limit == null || distance <= limit ? distance : null;
}

const VOCAL_MODE_MAX_SOUND_DISTANCE = Object.freeze({
  conversational: 1,
  call_out: 3,
});

function normalizedVocalMode(value = "") {
  return clean(value) === "call_out" ? "call_out" : "conversational";
}

function speechRoute(topology = {}, fromZoneId = "", toZoneId = "", vocalMode = "conversational") {
  const mode = normalizedVocalMode(vocalMode);
  const distance = routeDistance(topology, fromZoneId, toZoneId, "sound");
  return {
    vocalMode: mode,
    soundDistance: distance,
    reached: distance != null && distance <= VOCAL_MODE_MAX_SOUND_DISTANCE[mode],
  };
}

function observableCharacters(state = {}, actor = {}, {
  modality = "visual",
  fromZoneIds = [],
} = {}) {
  const place = placeForActor(state, actor) || {};
  const sourceZones = unique(fromZoneIds.length ? fromZoneIds : [actor.zoneId]);
  return Object.values(state.entities || {}).filter((candidate) => (
    candidate?.kind === "character"
    && candidate.present !== false
    && clean(candidate.id) !== clean(actor.id)
    && clean(candidate.placeId) === clean(actor.placeId)
    && sourceZones.some((sourceZoneId) => (
      perceivableRoute(place, sourceZoneId, candidate.zoneId, modality) != null
    ))
  ));
}

function directlyAdjacentZone(topology = {}, fromZoneId = "", toZoneId = "") {
  const from = clean(fromZoneId);
  const to = clean(toZoneId);
  if (!from || !to) return false;
  if (from === to) return true;
  return (topology.edges || []).some((edge) => (
    edge?.blocked !== true
    && (
      (clean(edge.from) === from && clean(edge.to) === to)
      || (clean(edge.to) === from && clean(edge.from) === to)
    )
  ));
}

function charactersInZones(state = {}, actor = {}, zoneIds = []) {
  const zones = new Set(unique(zoneIds));
  return Object.values(state.entities || {}).filter((candidate) => (
    candidate?.kind === "character"
    && candidate.present !== false
    && clean(candidate.id) !== clean(actor.id)
    && clean(candidate.placeId) === clean(actor.placeId)
    && zones.has(clean(candidate.zoneId))
  ));
}

function publicEntityDescription(state = {}, target = {}, observerId = "") {
  const worn = Object.values(state.objects || {}).filter((object) => (
    clean(object?.holderCharacterId) === clean(target.id)
    && objectVisibleToObserver(object, observerId, { defaultVisible: true })
  ));
  const visibleObjects = worn.map((object) => clean(
    object.perception?.publicLabel
    || object.aliases?.at?.(-1)
    || object.label
    || "一件随身物",
  )).filter(Boolean);
  const place = state.places?.[clean(target.placeId)] || {};
  const zoneLabel = clean(place.topology?.zones?.[clean(target.zoneId)]?.label || target.zoneId);
  const physicalFeatures = (target.publicSignalFeatures || [])
    .map((row) => clean(row?.physicalFeature))
    .filter(Boolean);
  const situatedBody = zoneLabel ? `${zoneLabel}有一人` : "眼前有一人";
  return [
    situatedBody,
    physicalFeatures.length ? `可见特征：${physicalFeatures.join("、")}` : "",
    visibleObjects.length ? `可见随身物：${visibleObjects.join("、")}` : "",
  ].filter(Boolean).join("；");
}

const OBSERVATION_ATTENTION_TAGS = new Set([
  "sword",
  "weapon",
  "movement",
  "body",
  "activity",
  "appearance",
  "position",
  "social",
]);

function observationAttentionTags(attempt = {}) {
  return unique(attempt.payload?.attentionTags || [])
    .filter((tag) => OBSERVATION_ATTENTION_TAGS.has(tag))
    .slice(0, 5);
}

function labelDomainTags(label = "") {
  const source = clean(label);
  const tags = ["carried-object"];
  if (/剑/u.test(source)) tags.push("sword", "weapon");
  if (/刀|枪|剑|斧|兵器|武器/u.test(source)) tags.push("weapon");
  if (/衣|袍|衫|冠|鞋|靴/u.test(source)) tags.push("appearance");
  return unique(tags);
}

function featureMatchesAttention(featureTags = [], attentionTags = []) {
  if (!attentionTags.length) return true;
  const feature = new Set(unique(featureTags));
  return attentionTags.some((tag) => (
    feature.has(tag)
    || (tag === "activity" && ["work", "service", "practice", "movement"].some((row) => feature.has(row)))
    || (tag === "movement" && ["activity", "work", "practice"].some((row) => feature.has(row)))
    || (tag === "weapon" && feature.has("sword"))
  ));
}

function focusedCharacterObservation(state = {}, target = {}, attentionTags = [], observerId = "") {
  const rows = [];
  const place = state.places?.[clean(target.placeId)] || {};
  const zoneLabel = clean(place.topology?.zones?.[clean(target.zoneId)]?.label || target.zoneId);
  if (featureMatchesAttention(["position"], attentionTags) && zoneLabel) {
    rows.push({ kind: "position", text: `${zoneLabel}有一人`, domainTags: ["position"] });
  }
  for (const feature of target.publicSignalFeatures || []) {
    const text = clean(feature?.physicalFeature);
    const domainTags = unique(feature?.domainTags || []);
    if (text && featureMatchesAttention(domainTags, attentionTags)) {
      rows.push({ kind: "body_surface", text, domainTags });
    }
  }
  for (const object of Object.values(state.objects || {}).filter((row) => (
    clean(row?.holderCharacterId) === clean(target.id)
    && objectVisibleToObserver(row, observerId, { defaultVisible: true })
  ))) {
    const label = clean(object.perception?.publicLabel || object.aliases?.at?.(-1) || object.label || "一件随身物");
    const domainTags = labelDomainTags(label);
    if (featureMatchesAttention(domainTags, attentionTags)) {
      rows.push({ kind: "held_object", text: `身上可见${label}`, domainTags, objectId: clean(object.id) });
    }
  }
  for (const process of (state.processes || []).filter((row) => (
    clean(row?.ownerActorId) === clean(target.id)
    && ["active", "ready", "interrupted"].includes(clean(row?.status))
  ))) {
    const label = clean(process.metadata?.unitAction || process.metadata?.publicLabel || process.kind || "手边的事");
    const status = clean(process.status);
    const text = status === "active"
      ? `正在${label}`
      : status === "ready"
        ? `${label}已经做到可以收尾`
        : `${label}停在半途`;
    const domainTags = unique([
      "activity",
      clean(process.kind) === "work_unit" ? "work" : "service",
      ...(clean(process.attentionMode) === "continuous_work" ? ["movement"] : []),
      ...labelDomainTags(label),
    ]);
    if (featureMatchesAttention(domainTags, attentionTags)) {
      rows.push({ kind: "ongoing_process", text, domainTags, processId: clean(process.id), status });
    }
  }
  if (featureMatchesAttention(["social"], attentionTags) && clean(target.orientationTargetId)) {
    rows.push({ kind: "orientation", text: "身体和视线有所朝向", domainTags: ["social", "attention"] });
  }
  const uniqueRows = [];
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.kind}:${row.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueRows.push(row);
  }
  return uniqueRows;
}

/**
 * Observing the scene as a whole — an empty target, the place itself, or one
 * of its zones — is a real observation the world can settle: it reports what
 * is actually visible from the observer's zone.
 */
function settleSceneObservation({ state, attempt, result, actor, targetId }) {
  const place = placeForActor(state, actor) || {};
  const visibleCharacters = observableCharacters(state, actor, { modality: "visual" });
  const visibleObjects = Object.values(state.objects || {}).filter((object) => (
    !clean(object?.holderCharacterId)
    && clean(object?.placeId) === clean(actor.placeId)
    && objectVisibleToObserver(object, actor.id, { defaultVisible: true })
    && perceivableRoute(place, actor.zoneId, object.zoneId, "visual") != null
  ));
  result.status = "success";
  result.resolvedEffects.push({ kind: "visual_attention_established", targetId: targetId || clean(actor.placeId) });
  result.statePatch.operations.push(setOperation(["entities", actor.id, "orientationTargetId"], targetId || clean(actor.placeId)));
  const characterSummaries = visibleCharacters.map((row) => publicEntityDescription(state, row, actor.id));
  const objectSummaries = visibleObjects.map((row) => clean(
    row.perception?.publicLabel
    || row.aliases?.at?.(-1)
    || row.label
    || "一件可见物件",
  )).filter(Boolean);
  result.deliveries.push({
    deliveryId: `delivery:${clean(attempt.attemptId)}:observation:${actor.id}`,
    eventKind: "observation_result",
    modality: "visual",
    sourceCharacterId: "",
    sourceObjectId: "",
    recipientCharacterId: actor.id,
    content: [
      characterSummaries.length ? `看得到的人：${characterSummaries.join("；")}` : "此刻看不到别的人",
      objectSummaries.length ? `看得到的东西：${objectSummaries.join("、")}` : "",
    ].filter(Boolean).join("。"),
  });
  return result;
}

function passiveDuration(state, seconds) {
  if (state.timePolicy?.mode !== "scene") return seconds;
  const current = Number(state.nowSeconds || 0);
  const boundaries = [nextWorldTemporalBoundary(state), ...(state.processes || []).filter(row => row.status === "active").map(row => row.readyAtSeconds)]
    .filter(value => Number.isFinite(value) && value > current);
  return Math.max(0, Math.min(seconds, boundaries.length ? Math.min(...boundaries) - current : seconds));
}

function settleObserve({ state, attempt }) {
  const result = baseResolution(attempt);
  if (state.timePolicy?.mode === "scene") result.durationSeconds = passiveDuration(state, state.timePolicy.observationSeconds || 5);
  const actor = actorGate(state, attempt, result);
  if (!actor) return result;
  const targetId = clean(attempt.payload?.targetId || attempt.payload?.targetCharacterId || attempt.payload?.objectId);
  result.attemptSurface.push({ kind: "attention_oriented", actorId: actor.id, targetId, modality: "visual" });
  result.committedFacts.push(...result.attemptSurface);
  result.intendedEffects.push({ kind: "obtain_visual_evidence", targetId });
  const place = placeForActor(state, actor) || {};
  if (!targetId || targetId === clean(actor.placeId) || place.topology?.zones?.[targetId]) {
    return settleSceneObservation({ state, attempt, result, actor, targetId });
  }
  const target = entityFor(state, targetId) || objectFor(state, targetId);
  if (!target) {
    result.failedEffects.push({ code: "OBSERVE_TARGET_UNKNOWN", targetId });
    return result;
  }
  const targetVisible = clean(target.placeId) === clean(actor.placeId)
    && perceivableRoute(place, actor.zoneId, target.zoneId, "visual") != null
    && target.present !== false
    && objectVisibleToObserver(target, actor.id, { defaultVisible: true });
  if (!targetVisible) {
    result.failedEffects.push({ code: "OBSERVE_TARGET_NOT_VISIBLE", targetId });
    return result;
  }
  const attentionTags = observationAttentionTags(attempt);
  const focusedFeatures = target.kind === "character"
    ? focusedCharacterObservation(state, target, attentionTags, actor.id)
    : [];
  const examined = target.kind === "character" ? observableCondition(target.health, { examined: true }) : "";
  result.status = "success";
  result.resolvedEffects.push({ kind: "visual_attention_established", targetId });
  result.statePatch.operations.push(setOperation(["entities", actor.id, "orientationTargetId"], targetId));
  result.deliveries.push({
    deliveryId: `delivery:${clean(attempt.attemptId)}:observation:${actor.id}`,
    eventKind: "observation_result",
    modality: "visual",
    sourceCharacterId: target.kind === "character" ? target.id : "",
    sourceObjectId: target.kind === "character" ? "" : targetId,
    recipientCharacterId: actor.id,
    content: (target.kind === "character"
      ? (attentionTags.length
        ? (focusedFeatures.length
          ? focusedFeatures.map((row) => row.text).join("；")
          : "眼下没有看见与所留意方面直接相关的可辨细节。")
        : publicEntityDescription(state, target, actor.id))
      : clean(target.perception?.publicLabel || target.aliases?.at?.(-1) || target.label || "一件可见物件"))
      + (examined ? `；${examined}` : ""),
    semanticFrame: {
      observationResult: {
        targetKind: clean(target.kind),
        attentionTags,
        observableFeatures: focusedFeatures,
      },
    },
  });
  return result;
}

/**
 * Only a structured in-place body operation can establish a gesture. Its
 * presentation is derived here, never from the character's outcome prose.
 */
function settleGesture({ state, attempt }) {
  const result = baseResolution(attempt);
  const actor = actorGate(state, attempt, result);
  if (!actor) return result;
  const actions = attempt.payload?.bodyActions || [];
  const visualTexture = (attempt.payload?.observableAffectiveTexture || []).filter(row => row.modality === "visual");
  const visibleAction = renderBodyActions(actions) + visualTexture.map(row => row.feature).join("");
  const targetId = clean(attempt.payload?.targetCharacterId || attempt.payload?.targetId);
  result.intendedEffects.push({ kind: "gesture_seen", targetCharacterId: targetId });
  if (!validBodyActions(actions) || !visibleAction) {
    result.failedEffects.push({ code: validBodyActions(actions) ? "PHYSICAL_EXPRESSION_REQUIRED" : "PHYSICAL_EXPRESSION_INVALID", actorId: actor.id });
    return result;
  }
  result.status = "success";
  result.attemptSurface.push({
    kind: "gesture_performed",
    actorId: actor.id,
    targetCharacterId: targetId,
    visibleAction,
    observableAffectiveTexture: clone(attempt.payload?.observableAffectiveTexture || []),
  });
  result.committedFacts.push(...result.attemptSurface);
  result.resolvedEffects.push({ kind: "gesture_performed", actorId: actor.id });
  for (const observer of observableCharacters(state, actor, { modality: "visual" })) {
    result.deliveries.push({
      deliveryId: `delivery:${clean(attempt.attemptId)}:gesture:${observer.id}`,
      eventKind: "gesture",
      modality: "visual",
      sourceCharacterId: actor.id,
      recipientCharacterId: observer.id,
      content: visibleAction,
      observableAffectiveTexture: clone(attempt.payload?.observableAffectiveTexture || []),
    });
  }
  return result;
}

function settleAccompanyingBodyExpression({ state, attempt, primaryResolution }) {
  const establishedKind = { observe: "visual_attention_established", listen: "auditory_attention_established", speak: "speech_emitted" }[clean(attempt.primitive)];
  const visualTexture = (attempt.payload?.observableAffectiveTexture || []).filter(row => row.modality === "visual");
  const visibleAction = renderBodyActions(attempt.payload?.bodyActions || [])
    || visualTexture.map(row => clean(row.feature)).filter(Boolean).join(" ");
  const established = establishedKind
    ? primaryResolution.resolvedEffects.some(row => row.kind === establishedKind)
    : clean(attempt.primitive) !== "gesture" && primaryResolution.status === "success";
  if (!established || !visibleAction) return primaryResolution;
  // Attention alone is private. Supported body operations are independently
  // visible and have no resource or movement effects.
  const gesture = settleGesture({ state, attempt: { ...attempt, primitive: "gesture",
    payload: { ...attempt.payload, visibleAction, observableAffectiveTexture: visualTexture,
      targetId: "",
      targetCharacterId: clean(attempt.payload?.targetCharacterId
        || (entityFor(state, attempt.payload?.targetId)?.kind === "character" ? attempt.payload.targetId : "")),
    } } });
  return { ...primaryResolution,
    attemptSurface: [...primaryResolution.attemptSurface, ...gesture.attemptSurface],
    intendedEffects: [...primaryResolution.intendedEffects, ...gesture.intendedEffects],
    committedFacts: [...primaryResolution.committedFacts, ...gesture.committedFacts],
    resolvedEffects: [...primaryResolution.resolvedEffects, ...gesture.resolvedEffects],
    deliveries: [...primaryResolution.deliveries, ...gesture.deliveries],
  };
}

function audibleDeliveryTexture(state, actor, recipient, texture = []) {
  const seesSpeaker = perceivableRoute(placeForActor(state, actor) || {}, actor.zoneId, recipient.zoneId, "visual") != null;
  return clone(texture.filter(row => row.modality !== "visual" || seesSpeaker));
}

/**
 * Rest and practice are visible durative activities: they succeed when the
 * actor is present, take real world time, and reach visual observers.
 */
function settleDurativeActivity(kind, defaultDurationSeconds, defaultContent) {
  return function settleActivity({ state, attempt }) {
    const result = baseResolution(attempt);
    const actor = actorGate(state, attempt, result);
    if (!actor) return result;
    const visibleAction = clean(attempt.payload?.visibleAction);
    result.intendedEffects.push({ kind, actorId: attempt.actorId });
    result.status = "success";
    const defaultSeconds = kind === "actor_resting" && state.timePolicy?.mode === "scene" ? (state.timePolicy.defaultRestSeconds || 120) : defaultDurationSeconds;
    result.durationSeconds = passiveDuration(state, Math.max(defaultSeconds, Number(attempt.payload?.durationSeconds || 0)));
    result.attemptSurface.push({ kind, actorId: actor.id, visibleAction });
    result.committedFacts.push(...result.attemptSurface);
    result.resolvedEffects.push({ kind, actorId: actor.id });
    if (actor.lastSettledPrimitive === attempt.primitive) return result;
    for (const observer of observableCharacters(state, actor, { modality: "visual" })) {
      result.deliveries.push({
        deliveryId: `delivery:${clean(attempt.attemptId)}:${kind}:${observer.id}`,
        eventKind: kind,
        modality: "visual",
        sourceCharacterId: actor.id,
        recipientCharacterId: observer.id,
        content: visibleAction || defaultContent(actor),
      });
    }
    return result;
  };
}

const settleRest = settleDurativeActivity(
  "actor_resting",
  30,
  (actor) => `${clean(actor.name || actor.id)}在原处歇了下来`,
);
const settlePractice = settleDurativeActivity(
  "actor_practicing",
  60,
  (actor) => `${clean(actor.name || actor.id)}在原处练起功课`,
);

/**
 * Leaving the place removes the actor's presence: they release any occupied
 * position, disappear from other characters' perception, and the departure
 * itself is visible to whoever could see them go.
 */
function settleLeave({ state, attempt }) {
  const result = baseResolution(attempt);
  const actor = actorGate(state, attempt, result);
  if (!actor) return result;
  const visibleAction = clean(attempt.payload?.visibleAction);
  result.intendedEffects.push({ kind: "actor_left_place", actorId: attempt.actorId });
  result.status = "success";
  result.durationSeconds = Math.max(3, Number(attempt.payload?.durationSeconds || 0));
  result.attemptSurface.push({ kind: "actor_left_place", actorId: actor.id, placeId: clean(actor.placeId), visibleAction });
  result.committedFacts.push(...result.attemptSurface);
  result.resolvedEffects.push({ kind: "actor_left_place", actorId: actor.id });
  const processInterruption = interruptOwnedContinuousProcesses({
    state,
    actorId: actor.id,
    destinationZoneId: "",
    actionId: attempt.attemptId,
  });
  if (processInterruption.interrupted.length) {
    result.statePatch.operations.push(setOperation(["processes"], processInterruption.processes));
    for (const process of processInterruption.interrupted) {
      result.resolvedEffects.push({
        kind: "world_process_interrupted",
        processId: clean(process.id),
        reason: "owner_left_station",
      });
      result.committedFacts.push({
        kind: "world_process_interrupted",
        actorId: actor.id,
        processId: clean(process.id),
        stationZoneId: clean(process.stationZoneId),
        reason: "owner_left_station",
      });
    }
  }
  // Deliveries are computed before presence is patched away.
  for (const observer of observableCharacters(state, actor, { modality: "visual" })) {
    result.deliveries.push({
      deliveryId: `delivery:${clean(attempt.attemptId)}:leave:${observer.id}`,
      eventKind: "departure",
      modality: "visual",
      sourceCharacterId: actor.id,
      recipientCharacterId: observer.id,
      content: visibleAction || `${clean(actor.name || actor.id)}朝门外走去，离开了这里`,
    });
  }
  result.statePatch.operations.push(setOperation(["entities", actor.id, "present"], false));
  if (clean(actor.positionId)) {
    result.statePatch.operations.push(setOperation(["entities", actor.id, "positionId"], ""));
  }
  for (const object of Object.values(state.objects || {})) {
    if (object?.kind !== "position") continue;
    const remaining = unique(object.occupantCharacterIds || []).filter((id) => id !== actor.id);
    if (remaining.length !== unique(object.occupantCharacterIds || []).length) {
      result.statePatch.operations.push(setOperation(["objects", object.id, "occupantCharacterIds"], remaining));
    }
  }
  return result;
}

function settleListen({ state, attempt }) {
  const result = baseResolution(attempt);
  if (state.timePolicy?.mode === "scene") result.durationSeconds = passiveDuration(state, state.timePolicy.listeningSeconds || 10);
  const actor = actorGate(state, attempt, result);
  if (!actor) return result;
  const targetId = clean(attempt.payload?.targetId || attempt.payload?.sourceId);
  const explicitTargetKind = clean(attempt.payload?.targetKind);
  const place = placeForActor(state, actor) || {};
  const targetEntity = entityFor(state, targetId);
  const targetObject = objectFor(state, targetId);
  const targetKind = explicitTargetKind && explicitTargetKind !== "none"
    ? explicitTargetKind
    : targetEntity ? "character"
      : targetObject ? (targetObject.kind === "position" ? "position" : "object")
        : targetId && (targetId === clean(actor.placeId) || place.topology?.zones?.[targetId]) ? "place"
          : targetId ? "unknown" : "scene";
  result.attemptSurface.push({ kind: "listening_oriented", actorId: actor.id, targetId, targetKind });
  result.committedFacts.push(...result.attemptSurface);
  const targetZoneId = targetKind === "character"
    ? clean(targetEntity?.zoneId)
    : ["object", "position"].includes(targetKind)
      ? clean(targetObject?.zoneId)
      : targetKind === "place" && place.topology?.zones?.[targetId]
        ? targetId
        : "";
  const targetKnown = !targetId
    || (targetKind === "character" && Boolean(targetEntity))
    || (["object", "position"].includes(targetKind) && Boolean(targetObject))
    || (targetKind === "place" && (targetId === clean(actor.placeId) || Boolean(place.topology?.zones?.[targetId])))
    || targetKind === "scene";
  if (!targetKnown) {
    result.status = "failed";
    result.failedEffects.push({ code: "LISTEN_TARGET_UNKNOWN", targetId, targetKind });
    return result;
  }
  const nowSeconds = Number(state.nowSeconds || 0);
  const audible = [...(state.signals || [])].reverse().find((signal) => (
    clean(signal?.modality) === "sound"
    && (
      signal.persistent === true
      || signal.kind === "ambient_sound"
      || (Number.isFinite(Number(signal.emittedAtSeconds))
        && Number(signal.emittedAtSeconds) <= nowSeconds
        && Number(signal.audibleUntilSeconds ?? signal.emittedAtSeconds) >= nowSeconds)
    )
    && (targetKind !== "character" || clean(signal.sourceCharacterId) === targetId)
    && (targetKind !== "object" || clean(signal.sourceObjectId) === targetId)
    && (targetKind !== "position" || clean(signal.zoneId) === targetZoneId)
    && (targetKind !== "place" || targetId === clean(actor.placeId) || clean(signal.zoneId) === targetZoneId)
    && clean(signal.placeId) === clean(actor.placeId)
    && (signal.kind === "speech"
      ? speechRoute(place.topology || {}, signal.zoneId, actor.zoneId, signal.vocalMode).reached
      : perceivableRoute(place, signal.zoneId, actor.zoneId, "sound") != null)
  ));
  result.status = audible ? "success" : "partial";
  result.resolvedEffects.push({ kind: "auditory_attention_established", targetId, targetKind });
  result.statePatch.operations.push(setOperation(["entities", actor.id, "listeningTargetId"], targetId));
  result.statePatch.operations.push(setOperation(["entities", actor.id, "listeningTargetKind"], targetKind));
  if (audible) {
    result.deliveries.push({
      deliveryId: `delivery:${clean(attempt.attemptId)}:listening:${actor.id}`,
      eventKind: "listening_result",
      modality: "sound",
      sourceCharacterId: clean(audible.sourceCharacterId),
      recipientCharacterId: actor.id,
      signalId: clean(audible.signalId),
      content: clean(audible.utterance || audible.content),
    });
  } else result.failedEffects.push({ code: "LISTEN_NO_AUDIBLE_SIGNAL", targetId, targetKind });
  return result;
}

function settleSpeak({ state, attempt }) {
  const result = baseResolution(attempt);
  const actor = actorGate(state, attempt, result);
  if (!actor) return result;
  const utterance = clean(attempt.payload?.utterance || attempt.payload?.speech);
  const targetId = clean(attempt.payload?.targetCharacterId || attempt.payload?.targetId);
  const vocalMode = normalizedVocalMode(attempt.payload?.vocalMode);
  const place = placeForActor(state, actor) || {};
  result.intendedEffects.push({ kind: "utterance_heard", targetCharacterId: targetId });
  if (!utterance) {
    result.failedEffects.push({ code: "SPEECH_UTTERANCE_EMPTY" });
    return result;
  }
  if (state.timePolicy?.mode === "scene") {
    const cjk = [...utterance.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)].length;
    const words = utterance.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, " ").match(/[\p{L}\p{N}]+/gu)?.length || 0;
    result.durationSeconds = Math.max(1, Math.ceil(cjk / (state.timePolicy.speechCharactersPerSecond || 4) + words / 2.5 + Number(state.timePolicy.speechPauseSeconds || 0)));
  }
  const signalId = `signal:${clean(attempt.attemptId)}:speech`;
  const requestedProvenance = attempt.payload?.provenance && typeof attempt.payload.provenance === "object"
    ? attempt.payload.provenance
    : {};
  const provenance = {
    sourceActionId: clean(attempt.attemptId),
    sourceThreadId: clean(requestedProvenance.sourceThreadId) || `live_thread:${clean(attempt.attemptId)}`,
    responseToTurnId: clean(requestedProvenance.responseToTurnId),
  };
  const signal = {
    signalId,
    kind: "speech",
    modality: "sound",
    sourceCharacterId: actor.id,
    targetCharacterId: targetId,
    placeId: actor.placeId,
    zoneId: actor.zoneId,
    utterance,
    speechAct: clean(attempt.payload?.speechAct || "inform"),
    speechFunctions: unique(attempt.payload?.speechFunctions || []),
    provenance: clone(provenance),
    vocalMode,
    emittedAtSeconds: Number(state.nowSeconds || 0) + 1,
    audibleUntilSeconds: Number(state.nowSeconds || 0) + 3,
    observableAffectiveTexture: clone(attempt.payload?.observableAffectiveTexture || []),
  };
  result.attemptSurface.push({
    kind: "utterance_emitted",
    actorId: actor.id,
    utterance,
    targetCharacterId: targetId,
    vocalMode,
    visibleAction: clean(attempt.payload?.visibleAction),
    observableAffectiveTexture: clone(attempt.payload?.observableAffectiveTexture || []),
    provenance: clone(provenance),
  });
  result.committedFacts.push(...result.attemptSurface);
  result.statePatch.operations.push(appendOperation(["signals"], signal));
  if (!targetId) {
    result.status = "success";
    result.resolvedEffects.push({ kind: "speech_emitted", signalId });
    const recipients = new Map(observableCharacters(state, actor, { modality: "sound" })
      .filter((recipient) => (
        speechRoute(place.topology || {}, actor.zoneId, recipient.zoneId, vocalMode).reached
      ))
      .map((row) => [clean(row.id), row]));
    for (const recipient of recipients.values()) {
      const acoustic = speechRoute(place.topology || {}, actor.zoneId, recipient.zoneId, vocalMode);
      result.resolvedEffects.push({
        kind: "speech_delivered",
        signalId,
        targetCharacterId: recipient.id,
        vocalMode,
        soundDistance: acoustic.soundDistance,
      });
      result.deliveries.push({
        deliveryId: `delivery:${signalId}:${recipient.id}`,
        eventKind: "speech",
        modality: "sound",
        sourceCharacterId: actor.id,
        recipientCharacterId: recipient.id,
        signalId,
        content: utterance,
        directed: false,
        overheard: false,
        speechAct: signal.speechAct,
        speechFunctions: clone(signal.speechFunctions),
        provenance: clone(provenance),
        observableAffectiveTexture: audibleDeliveryTexture(state, actor, recipient, attempt.payload?.observableAffectiveTexture || []),
        vocalMode,
        soundDistance: acoustic.soundDistance,
      });
    }
    return result;
  }
  const target = entityFor(state, targetId);
  const samePlace = target?.present !== false && clean(target?.placeId) === clean(actor.placeId);
  const acoustic = samePlace
    ? speechRoute(place.topology || {}, actor.zoneId, target.zoneId, vocalMode)
    : { vocalMode, soundDistance: null, reached: false };
  const route = samePlace && acoustic.reached;
  result.status = route ? "success" : "partial";
  result.resolvedEffects.push({ kind: "speech_emitted", signalId, vocalMode });
  if (!route) {
    result.failedEffects.push({ code: "SPEECH_TARGET_NOT_REACHED", targetCharacterId: targetId });
  }
  const recipients = observableCharacters(state, actor, { modality: "sound" })
    .filter((recipient) => (
      speechRoute(place.topology || {}, actor.zoneId, recipient.zoneId, vocalMode).reached
    ));
  for (const recipient of recipients) {
    const recipientAcoustic = speechRoute(place.topology || {}, actor.zoneId, recipient.zoneId, vocalMode);
    const directed = clean(recipient.id) === targetId;
    result.resolvedEffects.push({
      kind: "speech_delivered",
      signalId,
      ...(directed ? { targetCharacterId: targetId } : { recipientCharacterId: clean(recipient.id) }),
      directed,
      overheard: !directed,
      vocalMode,
      soundDistance: recipientAcoustic.soundDistance,
    });
    result.deliveries.push({
      deliveryId: `delivery:${signalId}:${clean(recipient.id)}`,
      eventKind: "speech",
      modality: "sound",
      sourceCharacterId: actor.id,
      recipientCharacterId: clean(recipient.id),
      signalId,
      content: utterance,
      directed,
      overheard: !directed,
      speechAct: signal.speechAct,
      speechFunctions: clone(signal.speechFunctions),
      provenance: clone(provenance),
      observableAffectiveTexture: audibleDeliveryTexture(state, actor, recipient, attempt.payload?.observableAffectiveTexture || []),
      vocalMode,
      soundDistance: recipientAcoustic.soundDistance,
    });
  }
  return result;
}

/**
 * Speech can accompany another primary action. A person may answer while
 * watching, walking, handling an object, resting, or making a gesture; the
 * chosen physical primitive remains primary, while the utterance is still a
 * real sound signal with its own delivery and committed fact.
 */
function settleAccompanyingSpeech({ state, attempt, primaryResolution }) {
  const utterance = clean(attempt.payload?.utterance || attempt.payload?.speech);
  if (clean(attempt.primitive) === "speak" || !utterance) return primaryResolution;
  const speechAttempt = {
    ...clone(attempt),
    primitive: "speak",
    payload: {
      utterance,
      targetCharacterId: clean(
        attempt.payload?.speechTargetCharacterId
        || attempt.payload?.targetCharacterId
        || (clean(attempt.payload?.targetKind) === "character"
          ? attempt.payload?.targetId
          : ""),
      ),
      visibleAction: clean(attempt.payload?.visibleAction),
      observableAffectiveTexture: clone(attempt.payload?.observableAffectiveTexture || []),
      speechAct: clean(attempt.payload?.speechAct || "inform"),
      speechFunctions: unique(attempt.payload?.speechFunctions || []),
      provenance: clone(attempt.payload?.provenance || {}),
      vocalMode: normalizedVocalMode(attempt.payload?.vocalMode),
      audibleBoundaryZoneIds: clean(attempt.payload?.targetKind) === "place"
        ? [clean(attempt.payload?.targetId)]
        : [],
    },
  };
  // A line said while walking is heard where the walk ends as well as where it began.
  const walked = ["move", "pursue"].includes(clean(attempt.primitive)) && clean(primaryResolution.status) === "success" && (primaryResolution.statePatch?.operations || []).length;
  const speechResolution = walked
    ? mergeSpeechAlong(settleSpeak({ state, attempt: speechAttempt }), settleSpeak({ state: applyWorldStatePatch(state, primaryResolution.statePatch), attempt: speechAttempt }))
    : settleSpeak({ state, attempt: speechAttempt });
  const statuses = [clean(primaryResolution.status), clean(speechResolution.status)];
  const status = statuses.every((value) => value === "success")
    ? "success"
    : statuses.every((value) => value === "failed") ? "failed" : "partial";
  return {
    ...clone(primaryResolution),
    status,
    attemptSurface: [
      ...(primaryResolution.attemptSurface || []),
      ...(speechResolution.attemptSurface || []),
    ],
    intendedEffects: [
      ...(primaryResolution.intendedEffects || []),
      ...(speechResolution.intendedEffects || []),
    ],
    resolvedEffects: [
      ...(primaryResolution.resolvedEffects || []),
      ...(speechResolution.resolvedEffects || []),
    ],
    failedEffects: [
      ...(primaryResolution.failedEffects || []),
      ...(speechResolution.failedEffects || []),
    ],
    incidentalEffects: [
      ...(primaryResolution.incidentalEffects || []),
      ...(speechResolution.incidentalEffects || []),
    ],
    committedFacts: [
      ...(primaryResolution.committedFacts || []),
      ...(speechResolution.committedFacts || []),
    ],
    deliveries: [
      ...(speechResolution.deliveries || []),
      ...(primaryResolution.deliveries || []),
    ],
    durationSeconds: Math.max(
      Number(primaryResolution.durationSeconds || 0),
      Number(speechResolution.durationSeconds || 0),
    ),
    statePatch: {
      operations: [
        ...(primaryResolution.statePatch?.operations || []),
        ...(speechResolution.statePatch?.operations || []),
      ],
    },
  };
}

function settlementStatus(left = "failed", right = "failed") {
  const statuses = [clean(left), clean(right)];
  if (statuses.every((value) => value === "success")) return "success";
  if (statuses.every((value) => value === "failed")) return "failed";
  return "partial";
}

function activityParticipantsReached(resolution = {}, actorId = "", participantIds = []) {
  const expected = unique(participantIds).filter((characterId) => characterId !== clean(actorId));
  const reached = new Set((resolution.deliveries || []).filter((delivery) => (
    clean(delivery?.sourceCharacterId) === clean(actorId)
  )).map((delivery) => clean(delivery?.recipientCharacterId)));
  return {
    expected,
    reached: expected.filter((characterId) => reached.has(characterId)),
    missing: expected.filter((characterId) => !reached.has(characterId)),
  };
}

function failedSharedActivityResolution(primaryResolution = {}, code = "SHARED_ACTIVITY_OPERATION_FAILED", details = {}) {
  return {
    ...clone(primaryResolution),
    status: settlementStatus(primaryResolution.status, "failed"),
    failedEffects: [
      ...(primaryResolution.failedEffects || []),
      { code, ...clone(details) },
    ],
  };
}

function settleSharedActivityAccess({ state = {}, actor = {}, activity = {}, operationKind = "" } = {}) {
  const place = placeForActor(state, actor) || {};
  const existingGrants = clone(place.accessGrants || []);
  const closed = ["completed", "abandoned", "refused"].includes(clean(activity.status));
  if (closed) {
    return {
      activity,
      accessGrants: existingGrants.map((grant) => (
        clean(grant.activityId) === clean(activity.activityId)
          ? { ...grant, status: "revoked", revokedByAction: operationKind }
          : grant
      )),
      changed: existingGrants.some((grant) => clean(grant.activityId) === clean(activity.activityId) && clean(grant.status) === "active"),
    };
  }
  if (!["accepted", "coordinating", "active"].includes(clean(activity.status))) {
    return { activity, accessGrants: existingGrants, changed: false };
  }
  const zoneId = clean(activity.requestedZoneId);
  if (!zoneId) return { activity, accessGrants: existingGrants, changed: false };
  const boundary = (place.socialBoundaries || []).find((row) => (
    (row.zoneIds || []).includes(zoneId)
  ));
  if (!boundary) return { activity, accessGrants: existingGrants, changed: false };
  const authorizedIds = unique([
    ...(boundary.claimantIds || []),
    ...(boundary.exemptActorIds || []),
  ]);
  const acceptedIds = (activity.participantIds || []).filter((characterId) => (
    clean(activity.consentByCharacterId?.[characterId]) === "accepted"
  ));
  const grantorId = acceptedIds.find((characterId) => authorizedIds.includes(characterId));
  if (!grantorId) return { activity, accessGrants: existingGrants, changed: false };
  const beneficiaryIds = (activity.participantIds || []).filter((characterId) => (
    characterId !== grantorId && !authorizedIds.includes(characterId)
  ));
  if (!beneficiaryIds.length) return { activity, accessGrants: existingGrants, changed: false };
  const existing = existingGrants.find((grant) => (
    clean(grant.activityId) === clean(activity.activityId)
    && (grant.zoneIds || []).includes(zoneId)
    && clean(grant.status) === "active"
  ));
  if (existing) return { activity, accessGrants: existingGrants, changed: false };
  const grant = createScopedCharacterAccessGrant({
    grantId: `access:${clean(activity.activityId)}:${zoneId}`,
    grantorId,
    authorizedGrantorIds: authorizedIds,
    beneficiaryIds,
    zoneIds: [zoneId],
    activity,
    issuedAtStep: Math.max(0, Number(state.worldVersion || 0)) + 1,
    expiresAtStep: Math.max(0, Number(state.worldVersion || 0)) + 64,
  });
  return {
    activity: {
      ...activity,
      accessGrantIds: unique([...(activity.accessGrantIds || []), grant.grantId]),
    },
    accessGrants: [...existingGrants, grant],
    changed: true,
  };
}

/**
 * Settle only the outwardly communicated shared-activity operation attached to
 * this atomic action. The Character owns proposal/response/coordination; the
 * world validates that the other participants actually received the signal
 * before changing the shared ledger. Ordinary speech never creates an entry.
 */
function settleAccompanyingSharedActivity({ state, attempt, primaryResolution }) {
  const operation = clone(attempt.payload?.sharedActivity || null);
  const operationKind = clean(operation?.operation || "none");
  if (!operation || operationKind === "none") return primaryResolution;
  const actorId = clean(attempt.actorId);
  const activityId = clean(operation.activityId);
  const participantIds = unique([actorId, ...(operation.participantIds || [])]);
  const activityKind = clean(operation.kind);
  if (!activityId) return failedSharedActivityResolution(primaryResolution, "SHARED_ACTIVITY_ID_REQUIRED");
  if (!activityKind) return failedSharedActivityResolution(primaryResolution, "SHARED_ACTIVITY_KIND_REQUIRED", { activityId });
  if (participantIds.length < 2) {
    return failedSharedActivityResolution(primaryResolution, "SHARED_ACTIVITY_PARTICIPANTS_REQUIRED", { activityId });
  }
  const absentIds = participantIds.filter((characterId) => {
    const participant = entityFor(state, characterId);
    return participant?.kind !== "character" || participant.present === false;
  });
  if (absentIds.length) {
    return failedSharedActivityResolution(primaryResolution, "SHARED_ACTIVITY_PARTICIPANT_NOT_PRESENT", {
      activityId,
      participantIds: absentIds,
    });
  }
  const communication = activityParticipantsReached(primaryResolution, actorId, participantIds);
  if (communication.missing.length) {
    return failedSharedActivityResolution(primaryResolution, "SHARED_ACTIVITY_PARTICIPANTS_NOT_REACHED", {
      activityId,
      participantIds: communication.missing,
    });
  }

  const activities = clone(state.sharedActivities || []);
  const index = activities.findIndex((row) => clean(row?.activityId) === activityId);
  let activity = index >= 0 ? activities[index] : null;
  try {
    if (operationKind === "propose") {
      if (activity && !["completed", "abandoned", "refused"].includes(clean(activity.status))) {
        return failedSharedActivityResolution(primaryResolution, "SHARED_ACTIVITY_ID_COLLISION", { activityId });
      }
      activity = createCharacterSharedActivityProposal({
        activityId,
        kind: activityKind,
        initiatorId: actorId,
        participantIds,
        requestedZoneId: clean(operation.requestedZoneId),
        boundaries: clone(operation.boundaries || {}),
        sourceActionId: clean(attempt.attemptId),
      });
      activity.communicatedToCharacterIds = participantIds;
      if (index >= 0) activities[index] = activity;
      else activities.push(activity);
    } else {
      if (!activity) return failedSharedActivityResolution(primaryResolution, "SHARED_ACTIVITY_NOT_FOUND", { activityId });
      if (operationKind === "respond") {
        activity = applyCharacterSharedActivityResponse(activity, {
          responderId: actorId,
          response: clean(operation.response),
          sourceActionId: clean(attempt.attemptId),
          counter: {
            kind: activityKind,
            requestedZoneId: clean(operation.requestedZoneId),
            boundaries: clone(operation.boundaries || {}),
          },
        });
      } else if (operationKind === "coordinate") {
        if (!activity.participantIds?.includes(actorId) || !["accepted", "coordinating"].includes(clean(activity.status))) {
          return failedSharedActivityResolution(primaryResolution, "SHARED_ACTIVITY_COORDINATION_NOT_READY", { activityId });
        }
        activity = {
          ...activity,
          status: "coordinating",
          requestedZoneId: clean(operation.requestedZoneId || activity.requestedZoneId),
          boundaries: { ...(activity.boundaries || {}), ...clone(operation.boundaries || {}) },
          sourceActionIds: unique([...(activity.sourceActionIds || []), attempt.attemptId]),
        };
      } else if (operationKind === "start") {
        if (!activity.participantIds?.includes(actorId) || !["accepted", "coordinating"].includes(clean(activity.status))) {
          return failedSharedActivityResolution(primaryResolution, "SHARED_ACTIVITY_START_NOT_READY", { activityId });
        }
        const requestedZoneId = clean(operation.requestedZoneId || activity.requestedZoneId);
        const misplacedIds = (activity.participantIds || []).filter((characterId) => (
          requestedZoneId && clean(entityFor(state, characterId)?.zoneId) !== requestedZoneId
        ));
        if (misplacedIds.length) {
          return failedSharedActivityResolution(primaryResolution, "SHARED_ACTIVITY_PARTICIPANTS_NOT_AT_ACTIVITY_ZONE", {
            activityId,
            requestedZoneId,
            participantIds: misplacedIds,
          });
        }
        activity = {
          ...activity,
          status: "active",
          startedByCharacterId: actorId,
          startedByActionId: clean(attempt.attemptId),
          sourceActionIds: unique([...(activity.sourceActionIds || []), attempt.attemptId]),
        };
      } else if (operationKind === "complete") {
        if (!activity.participantIds?.includes(actorId) || clean(activity.status) !== "active") {
          return failedSharedActivityResolution(primaryResolution, "SHARED_ACTIVITY_COMPLETION_NOT_READY", { activityId });
        }
        activity = {
          ...activity,
          status: "completed",
          completedByCharacterId: actorId,
          completedByActionId: clean(attempt.attemptId),
          sourceActionIds: unique([...(activity.sourceActionIds || []), attempt.attemptId]),
        };
      } else if (operationKind === "withdraw") {
        if (!activity.participantIds?.includes(actorId)) {
          return failedSharedActivityResolution(primaryResolution, "SHARED_ACTIVITY_WITHDRAWAL_NOT_OWNED", { activityId });
        }
        activity = {
          ...activity,
          status: "abandoned",
          withdrawnByCharacterId: actorId,
          sourceActionIds: unique([...(activity.sourceActionIds || []), attempt.attemptId]),
        };
      } else {
        return failedSharedActivityResolution(primaryResolution, "SHARED_ACTIVITY_OPERATION_INVALID", {
          activityId,
          operation: operationKind,
        });
      }
      activity.communicatedToCharacterIds = unique([
        ...(activity.communicatedToCharacterIds || []),
        ...participantIds,
      ]);
      activities[index] = activity;
    }
  } catch (error) {
    return failedSharedActivityResolution(primaryResolution, error.code || "SHARED_ACTIVITY_OPERATION_FAILED", {
      activityId,
      message: clean(error.message),
    });
  }

  const actor = entityFor(state, actorId) || {};
  const accessSettlement = settleSharedActivityAccess({
    state,
    actor,
    activity,
    operationKind,
  });
  activity = accessSettlement.activity;
  const settledIndex = activities.findIndex((row) => clean(row?.activityId) === activityId);
  if (settledIndex >= 0) activities[settledIndex] = activity;

  const lifecycleEffectByOperation = {
    propose: "shared_activity_proposed",
    coordinate: "shared_activity_coordinated",
    start: "shared_activity_started",
    complete: "shared_activity_completed",
    withdraw: "shared_activity_abandoned",
  };
  const effectKind = operationKind === "respond"
    ? `shared_activity_${clean(operation.response) === "accept" ? "accepted" : clean(operation.response) || "responded"}`
    : lifecycleEffectByOperation[operationKind] || "shared_activity_changed";
  return {
    ...clone(primaryResolution),
    status: settlementStatus(primaryResolution.status, "success"),
    attemptSurface: [
      ...(primaryResolution.attemptSurface || []),
      { kind: "shared_activity_operation_attempted", actorId, activityId, operation: operationKind },
    ],
    resolvedEffects: [
      ...(primaryResolution.resolvedEffects || []),
      { kind: effectKind, activityId, status: clean(activity.status) },
    ],
    committedFacts: [
      ...(primaryResolution.committedFacts || []),
      { kind: "shared_activity_state_changed", actorId, activityId, operation: operationKind, status: clean(activity.status) },
    ],
    statePatch: {
      operations: [
        ...(primaryResolution.statePatch?.operations || []),
        setOperation(["sharedActivities"], activities),
        ...(accessSettlement.changed
          ? [setOperation(["places", clean(actor.placeId), "accessGrants"], accessSettlement.accessGrants)]
          : []),
      ],
    },
  };
}

function settleMove({ state, attempt }) {
  const result = baseResolution(attempt);
  const actor = actorGate(state, attempt, result);
  if (!actor) return result;
  const positionId = clean(attempt.payload?.positionId);
  if (positionId) {
    const position = objectFor(state, positionId);
    result.durationSeconds = Math.max(1, Number(attempt.payload?.durationSeconds || 3));
    result.attemptSurface.push({
      kind: "movement_attempted",
      actorId: actor.id,
      fromZoneId: actor.zoneId,
      toZoneId: clean(position?.zoneId),
      positionId,
    });
    result.committedFacts.push(...result.attemptSurface);
    if (position?.kind !== "position") {
      result.failedEffects.push({ code: "MOVEMENT_POSITION_UNKNOWN", positionId });
      return result;
    }
    return settleOccupyPosition({ state, attempt, result, actor, position, operation: "move" });
  }
  const destinationId = clean(attempt.payload?.destinationId || attempt.payload?.toZoneId);
  const place = placeForActor(state, actor) || {};
  const holder = movementHeldBy(state, actor.id);
  if (holder) {
    result.status = "failed";
    result.durationSeconds = 3;
    result.attemptSurface.push({ kind: "movement_attempted", actorId: actor.id, fromZoneId: actor.zoneId, toZoneId: destinationId, visibleAction: clean(attempt.payload?.visibleAction) });
    result.committedFacts.push(...result.attemptSurface);
    result.failedEffects.push({ code: "MOVE_HELD", holderCharacterId: holder });
    return result;
  }
  // Water in the way: in a deluge no one gets through to the stream's edge.
  const hindrance = movementHindrance(place, destinationId);
  if (hindrance.blocked) {
    result.status = "failed";
    result.durationSeconds = Math.max(1, Number(state.timePolicy?.moveSeconds || 3));
    result.attemptSurface.push({ kind: "movement_attempted", actorId: actor.id, fromZoneId: actor.zoneId, toZoneId: destinationId });
    result.committedFacts.push(...result.attemptSurface);
    result.intendedEffects.push({ kind: "actor_movement", actorId: actor.id, toZoneId: destinationId });
    result.failedEffects.push({ code: MOVE_BLOCKED_BY_FLOOD, toZoneId: destinationId });
    return result;
  }
  const movement = resolvePlaceMovementAttempt({
    topology: place.topology || {},
    actorId: actor.id,
    fromZoneId: actor.zoneId,
    toZoneId: destinationId,
    socialBoundaries: place.socialBoundaries || [],
    accessGrants: place.accessGrants || [],
    step: Number(state.step ?? state.nowSeconds ?? 0),
  });
  result.status = movement.status;
  const edge = (place.topology?.edges || []).find((row) => [row.from, row.to].includes(actor.zoneId) && [row.from, row.to].includes(destinationId));
  const moveCost = Number.isFinite(Number(edge?.move)) && Number(edge?.move) > 0 ? Number(edge.move) : 1;
  result.durationSeconds = Math.max(1, Number(attempt.payload?.durationSeconds || (state.timePolicy?.moveSeconds ? state.timePolicy.moveSeconds * moveCost : 3)));
  result.attemptSurface = movement.committedFacts.filter((row) => row.kind === "movement_attempted");
  result.committedFacts = clone(movement.committedFacts || []);
  result.intendedEffects.push({ kind: "actor_movement", actorId: actor.id, toZoneId: destinationId });
  if (movement.movementCommitted) {
    if (hindrance.slowdown > 1) {
      result.durationSeconds = Math.round(result.durationSeconds * hindrance.slowdown);
      result.resolvedEffects.push({ kind: "movement_hindered", actorId: actor.id, toZoneId: destinationId, reason: hindrance.reason, slowdown: hindrance.slowdown });
    }
    result.resolvedEffects.push({ kind: "actor_movement", actorId: actor.id, fromZoneId: actor.zoneId, toZoneId: destinationId });
    result.statePatch.operations.push(setOperation(["entities", actor.id, "zoneId"], destinationId));
    const processInterruption = interruptOwnedContinuousProcesses({
      state,
      actorId: actor.id,
      destinationZoneId: destinationId,
      actionId: attempt.attemptId,
    });
    if (processInterruption.interrupted.length) {
      result.statePatch.operations.push(setOperation(["processes"], processInterruption.processes));
      for (const process of processInterruption.interrupted) {
        result.resolvedEffects.push({
          kind: "world_process_interrupted",
          processId: clean(process.id),
          reason: "owner_left_station",
        });
        result.committedFacts.push({
          kind: "world_process_interrupted",
          actorId: actor.id,
          processId: clean(process.id),
          stationZoneId: clean(process.stationZoneId),
          reason: "owner_left_station",
        });
      }
    }
    // A carried object remains with its holder. Its objective zone must move
    // with the body rather than leaving a stale duplicate at the old place.
    for (const object of Object.values(state.objects || {})) {
      if (clean(object?.holderCharacterId) !== clean(actor.id)) continue;
      result.statePatch.operations.push(
        setOperation(["objects", object.id, "placeId"], actor.placeId),
        setOperation(["objects", object.id, "zoneId"], destinationId),
      );
    }
    // Walking away releases any occupied position.
    if (clean(actor.positionId)) {
      result.statePatch.operations.push(setOperation(["entities", actor.id, "positionId"], ""));
    }
    for (const object of Object.values(state.objects || {})) {
      if (object?.kind !== "position") continue;
      const remaining = unique(object.occupantCharacterIds || []).filter((id) => id !== actor.id);
      if (remaining.length !== unique(object.occupantCharacterIds || []).length) {
        result.statePatch.operations.push(setOperation(["objects", object.id, "occupantCharacterIds"], remaining));
      }
    }
    for (const [id, entity] of Object.entries(state.entities || {})) {
      if (clean(entity?.heldBy) === clean(actor.id)) {
        result.statePatch.operations.push(setOperation(["entities", id, "heldBy"], ""));
      }
    }
    result.statePatch.operations.push(setOperation(["entities", actor.id, "heldBy"], ""));
    for (const observer of observableCharacters(state, actor, {
      modality: "visual",
      fromZoneIds: [actor.zoneId, destinationId],
    })) {
      result.deliveries.push({
        deliveryId: `delivery:${clean(attempt.attemptId)}:movement:${observer.id}`,
        eventKind: "movement",
        modality: "visual",
        sourceCharacterId: actor.id,
        recipientCharacterId: observer.id,
        content: clean(attempt.payload?.visibleAction)
          || `${clean(actor.name || actor.id)}从${clean(place.topology?.zones?.[actor.zoneId]?.label || actor.zoneId)}走向${clean(place.topology?.zones?.[destinationId]?.label || destinationId)}。`,
      });
    }
  }
  result.failedEffects.push(...(movement.failureCodes || []).map((code) => ({ code })));
  result.incidentalEffects.push(...(movement.committedFacts || []).filter((row) => row.kind === "social_boundary_crossed_without_permission"));
  return result;
}

/**
 * Occupiable positions (seats, benches) are world things a character can take
 * or release; they are never portable and occupancy is capacity-bounded.
 */
function settleOccupyPosition({ state, attempt, result, actor, position, operation }) {
  result.intendedEffects.push({ kind: "position_occupied", positionId: position.id });
  if (!["use_affordance", "interact", "move"].includes(operation)) {
    result.failedEffects.push({ code: "POSITION_NOT_PORTABLE", positionId: position.id, operation });
    return result;
  }
  if (clean(position.placeId) !== clean(actor.placeId) || clean(position.zoneId) !== clean(actor.zoneId)) {
    result.failedEffects.push({ code: "POSITION_NOT_REACHABLE", positionId: position.id });
    return result;
  }
  const occupants = unique(position.occupantCharacterIds || []).filter((id) => id !== actor.id);
  if (occupants.length >= Math.max(1, Number(position.capacity || 1))) {
    result.failedEffects.push({ code: "POSITION_FULLY_OCCUPIED", positionId: position.id });
    return result;
  }
  result.status = "success";
  result.resolvedEffects.push({ kind: "position_occupied", positionId: position.id, actorId: actor.id });
  result.statePatch.operations.push(
    setOperation(["objects", position.id, "occupantCharacterIds"], [...occupants, actor.id]),
    setOperation(["entities", actor.id, "positionId"], position.id),
  );
  // Taking this seat implicitly releases any other seat the actor held.
  for (const other of Object.values(state.objects || {})) {
    if (other?.kind !== "position" || other.id === position.id) continue;
    const remaining = unique(other.occupantCharacterIds || []).filter((id) => id !== actor.id);
    if (remaining.length !== unique(other.occupantCharacterIds || []).length) {
      result.statePatch.operations.push(setOperation(["objects", other.id, "occupantCharacterIds"], remaining));
    }
  }
  for (const observer of observableCharacters(state, actor, { modality: "visual" })) {
    result.deliveries.push({
      deliveryId: `delivery:${clean(attempt.attemptId)}:position:${observer.id}`,
      eventKind: "position_occupied",
      modality: "visual",
      sourceCharacterId: actor.id,
      sourceObjectId: position.id,
      recipientCharacterId: observer.id,
      content: clean(attempt.payload?.visibleAction)
        || `${clean(actor.name || actor.id)}在${clean(position.label || position.id)}坐下`,
    });
  }
  return result;
}

function serviceConsumptionBodyLoad(offering = {}, offeringId = "") {
  const sustenance = normalizeOfferingSustenance(offering, offeringId);
  const demand = serviceBodyDemand(offering, offeringId);
  const foodFactor = sustenance.class === "spiritual_food"
    ? asUnit(sustenance.spiritualNutrition)
    : sustenance.class === "mundane_food" ? asUnit(sustenance.mundaneNutrition) : 0;
  const drinkFactor = sustenance.class === "mundane_drink" ? asUnit(sustenance.hydration) : 0;
  const hungerRelief = demand.hungerRelief === undefined ? 0.28 : asUnit(demand.hungerRelief) * 0.5;
  const thirstRelief = demand.thirstRelief === undefined ? 0.28 : asUnit(demand.thirstRelief) * 0.5;
  const recovery = demand.recovery === undefined ? 0.03 : asUnit(demand.recovery) * 0.08;
  const staminaRecovery = demand.recovery === undefined ? 0.07 : asUnit(demand.recovery) * 0.14;
  return {
    sustenance,
    hungerDelta: rounded(-hungerRelief * foodFactor),
    thirstDelta: rounded(-thirstRelief * drinkFactor),
    fatigueDelta: rounded(-recovery * foodFactor),
    exertionDelta: rounded(-recovery * foodFactor),
    staminaDelta: rounded(staminaRecovery * foodFactor),
    energyDelta: rounded(staminaRecovery * foodFactor),
  };
}

function settlePreparedServiceConsumption({ state, attempt, result, actor, object }) {
  const objectId = clean(object.id);
  const contents = object.state?.contents && typeof object.state.contents === "object"
    ? object.state.contents
    : null;
  const processId = clean(contents?.processId);
  const process = (state.processes || []).find((row) => clean(row?.id) === processId);
  const processOfferingId = clean(process?.metadata?.offeringId || process?.subjectId);
  const offeringId = clean(contents?.offeringId);
  const validPreparedServing = clean(contents?.kind) === "prepared_service"
    && Boolean(process)
    && clean(process?.kind) === "service_preparation"
    && clean(process?.status) === "completed"
    && clean(process?.metadata?.serviceStatus) === "served"
    && (process.objectIds || []).map(clean).includes(objectId)
    && Boolean(offeringId)
    && offeringId === processOfferingId;
  result.intendedEffects.push({
    kind: "prepared_service_consumed",
    processId,
    offeringId,
    objectId,
    recipientCharacterId: actor.id,
  });
  if (!validPreparedServing) {
    result.failedEffects.push({
      code: "CONSUME_SERVICE_NOT_AVAILABLE",
      objectId,
      processId,
    });
    return result;
  }
  const expectedRecipientId = clean(process.metadata?.recipientCharacterId);
  if (!expectedRecipientId || expectedRecipientId !== clean(actor.id)) {
    result.failedEffects.push({
      code: "CONSUME_SERVICE_RECIPIENT_MISMATCH",
      objectId,
      processId,
      expectedRecipientCharacterId: expectedRecipientId,
      actorId: clean(actor.id),
    });
    return result;
  }
  const place = placeForActor(state, actor) || {};
  const offering = place.institution?.offerings?.[offeringId];
  if (!offering) {
    result.failedEffects.push({
      code: "CONSUME_SERVICE_OFFERING_UNKNOWN",
      objectId,
      processId,
      offeringId,
    });
    return result;
  }
  const bodyLoad = serviceConsumptionBodyLoad(offering, offeringId);
  const consumedAtSeconds = Math.max(0, Number(state.nowSeconds || 0)) + 4;
  const consumedProcesses = (state.processes || []).map((row) => clean(row?.id) === processId ? {
    ...clone(row),
    metadata: {
      ...clone(row.metadata || {}),
      serviceStatus: "consumed",
      consumedAtSeconds,
      consumedByCharacterId: clean(actor.id),
    },
    revision: Math.max(0, Number(row.revision || 0)) + 1,
  } : clone(row));
  const visibleAction = clean(attempt.payload?.visibleAction)
    || `${clean(actor.name || actor.id)}把送到面前的${clean(offering.label || offeringId)}用下。`;
  const consumedFact = {
    kind: "prepared_service_consumed",
    actorId: clean(actor.id),
    recipientCharacterId: clean(actor.id),
    processId,
    offeringId,
    objectId,
    sustenanceClass: clean(bodyLoad.sustenance.class),
    visibleAction,
  };
  result.status = "success";
  result.durationSeconds = 4;
  result.attemptSurface.push(consumedFact);
  result.committedFacts.push(consumedFact);
  result.resolvedEffects.push(
    consumedFact,
    {
      kind: "body_load_applied",
      targetActorId: clean(actor.id),
      sourceProcessId: processId,
      sourceObjectId: objectId,
      sourceOfferingId: offeringId,
      sustenanceClass: clean(bodyLoad.sustenance.class),
      hungerDelta: bodyLoad.hungerDelta,
      thirstDelta: bodyLoad.thirstDelta,
      fatigueDelta: bodyLoad.fatigueDelta,
      exertionDelta: bodyLoad.exertionDelta,
      staminaDelta: bodyLoad.staminaDelta,
      energyDelta: bodyLoad.energyDelta,
    },
  );
  result.statePatch.operations.push(
    setOperation(["processes"], consumedProcesses),
    setOperation(["objects", objectId, "state", "contents"], "empty"),
    setOperation(["objects", objectId, "holderCharacterId"], ""),
    setOperation(["objects", objectId, "placeId"], clean(actor.placeId)),
    setOperation(["objects", objectId, "zoneId"], clean(actor.zoneId)),
  );
  for (const observer of observableCharacters(state, actor, { modality: "visual" })) {
    result.deliveries.push({
      deliveryId: `delivery:${clean(attempt.attemptId)}:service-consumed:${clean(observer.id)}`,
      eventKind: "prepared_service_consumed",
      modality: "visual",
      sourceCharacterId: clean(actor.id),
      sourceObjectId: objectId,
      recipientCharacterId: clean(observer.id),
      content: visibleAction,
    });
  }
  return result;
}

function settleHandle({ state, attempt }) {
  const result = baseResolution(attempt);
  const actor = actorGate(state, attempt, result);
  if (!actor) return result;
  const objectId = clean(attempt.payload?.objectId);
  const operation = clean(attempt.payload?.operation || "touch");
  result.attemptSurface.push({ kind: "object_handling_attempted", actorId: actor.id, objectId, operation });
  result.committedFacts.push(...result.attemptSurface);
  const object = objectFor(state, objectId);
  if (object?.kind === "position") {
    return settleOccupyPosition({ state, attempt, result, actor, position: object, operation });
  }
  result.intendedEffects.push({ kind: "object_handled", objectId, operation });
  if (!object) {
    result.failedEffects.push({ code: "HANDLE_OBJECT_UNKNOWN", objectId });
    return result;
  }
  const reachable = clean(object.holderCharacterId) === actor.id
    || (clean(object.placeId) === clean(actor.placeId) && clean(object.zoneId) === clean(actor.zoneId));
  if (!reachable) {
    result.failedEffects.push({ code: "HANDLE_OBJECT_NOT_REACHABLE", objectId });
    return result;
  }
  if (operation === "consume") {
    return settlePreparedServiceConsumption({ state, attempt, result, actor, object });
  }
  let taken = null;
  let receiverId = "";
  if (!["touch", "interact"].includes(operation)) {
    if (!["take", "pickup", "take_out", "show", "hide", "store", "draw", "sheathe", "transfer", "place"].includes(operation)) {
      result.failedEffects.push({ code: "HANDLE_OPERATION_UNSUPPORTED", objectId, operation });
      return result;
    }
    if (["draw", "sheathe"].includes(operation) && !Object.hasOwn(object.state || {}, "sheathed")) {
      result.failedEffects.push({ code: "OBJECT_NOT_SHEATHABLE", objectId });
      return result;
    }
    const ledgerObject = { ...clone(object), holderActorId: clean(object.holderCharacterId), sceneId: clean(object.placeId) };
    // The current holder is authoritative. Seed/legacy aliases must not put a
    // placed or transferred object back into its initial owner's inventory.
    for (const alias of ["initialHolderActorId", "heldByActorId", "ownerActorId"]) delete ledgerObject[alias];
    const type = operation === "take"
      ? ledgerObject.holderActorId === actor.id ? "take_out" : "pickup"
      : operation === "take_out" && !ledgerObject.holderActorId ? "pickup"
      : operation === "transfer" ? "transfer_attempt" : operation;
    // Taking what belongs to someone else is a fact; whether it is borrowing or stealing is for people to judge.
    taken = type === "pickup" ? takenFromOthers(object, actor.id) : null;
    const settled = applyObjectOperations({
      ledger: { objects: [ledgerObject] },
      actors: Object.values(state.entities || {}).map(entity => ({ ...entity, sceneId: entity.placeId })),
      topology: placeForActor(state, actor)?.topology || {},
      operations: [{
        type, objectId, actorId: actor.id, sceneId: actor.placeId,
        zoneId: clean(attempt.payload?.destinationId) || actor.zoneId,
        toHolderActorId: clean(attempt.payload?.targetCharacterId),
        targetActorId: clean(attempt.payload?.targetCharacterId),
        storageMode: clean(attempt.payload?.storageMode),
        containerId: clean(attempt.payload?.containerId),
        // This registry is settling an explicit physical primitive; there is
        // no scene-menu affordance authority in the v2.7 runtime.
        explicitPrimitive: operation,
      }],
    });
    if (!settled.ok) {
      result.failedEffects.push(...settled.violations.map(row => ({ code: row.code, objectId, ...clone(row.evidence) })));
      return result;
    }
    const next = settled.ledger.objects[objectId];
    const moved = {
      ...clone(object),
      holderCharacterId: clean(next.holderActorId),
      placeId: clean(next.sceneId),
      zoneId: clean(next.holderActorId ? state.entities[next.holderActorId]?.zoneId : next.zoneId),
      state: clone(next.state),
      custody: clone(next.custody),
      presentation: clone(next.presentation),
      ...(next.attachment ? { attachment: clone(next.attachment) } : {}),
    };
    receiverId = clean(next.holderActorId);
    // Giving one's own to someone outside the owners makes it theirs; it no longer belongs in the old home.
    const givenTo = ownersAfterGiving(object, actor.id, receiverId);
    if (givenTo && receiverId !== actor.id) { moved.ownerIds = givenTo; delete moved.homeZoneId; }
    result.statePatch.operations.push(setOperation(["objects", objectId], moved));
  }
  result.status = "success";
  if (taken) result.resolvedEffects.push(taken);
  result.resolvedEffects.push({ kind: "object_handled", objectId, operation });
  for (const observer of observableCharacters(state, actor, { modality: "visual" })) {
    const note = taken ? ownershipNote(state, observer.id, object) : "";
    result.deliveries.push({
      deliveryId: `delivery:${clean(attempt.attemptId)}:handling:${observer.id}`,
      eventKind: "object_handling",
      semanticFrame: { objectHandling: { operation, changesState: result.statePatch.operations.length > 0,
        // Who it was handed to, and whether what was taken is the onlooker's own.
        ...(operation === "transfer" && receiverId ? { toCharacterId: receiverId } : {}),
        ...(taken && taken.ownerIds.includes(observer.id) ? { tookFromRecipient: true } : {}) } },
      modality: "visual",
      // Something handed to you is done to you, not just seen.
      ...(operation === "transfer" && receiverId && observer.id === receiverId ? { directed: true } : {}),
      sourceCharacterId: actor.id,
      sourceObjectId: objectId,
      recipientCharacterId: observer.id,
      content: (clean(attempt.payload?.visibleAction)
        || `${clean(actor.name || actor.id)}${({ take: "拿起", pickup: "拿起", take_out: "取出", show: "展示", hide: "收起", store: "收存", draw: "拔出", sheathe: "收鞘", transfer: "递交", place: "放下" })[operation] || "碰了碰"}${clean(object.label || object.id)}。`) + (note ? `那是${note}${clean(object.label || object.id)}。` : ""),
    });
  }
  return result;
}

function settleWait({ state, attempt }) {
  const result = baseResolution(attempt);
  result.durationSeconds = 0;
  const actor = actorGate(state, attempt, result);
  if (!actor) return result;
  const condition = attempt.payload?.waitCondition;
  const targetCharacterId = clean(attempt.payload?.targetCharacterId);
  const processes = (state.processes || []).filter(row => row.ownerActorId === actor.id && ["active", "ready"].includes(row.status));
  if (!validWaitCondition(condition)
    || (condition.condition === "target_speech" && (!targetCharacterId || targetCharacterId === actor.id || !entityFor(state, targetCharacterId)))
    || (condition.condition === "own_process_ready" && !processes.length)) {
    result.failedEffects.push({ code: "WAIT_CONDITION_INVALID" });
    return result;
  }
  result.status = "success";
  result.resolvedEffects.push({ kind: "actor_wait_registered", ...clone(condition), targetCharacterId,
    processIds: processes.map(row => row.id), registeredByAttemptId: attempt.attemptId,
    deadlineSeconds: Number(state.nowSeconds || 0) + condition.maximumSeconds });
  return result;
}

/**
 * Interact is a typed physical attempt, not a synonym for handling an object.
 * A Character Agent may address a nearby person, touch a real object, or act
 * on the boundary of an adjacent place (for example, knock on a closed door).
 * The resolver checks physical reach and emits consequences, but never invents
 * the other person's response.
 */
function settleInteract({ state, attempt }) {
  const result = baseResolution(attempt);
  const actor = actorGate(state, attempt, result);
  if (!actor) return result;
  const place = placeForActor(state, actor) || {};
  const targetId = clean(
    attempt.payload?.targetId
    || attempt.payload?.targetCharacterId
    || attempt.payload?.objectId
    || attempt.payload?.destinationId,
  );
  const targetEntity = entityFor(state, targetId);
  const targetObject = objectFor(state, targetId);
  const explicitKind = clean(attempt.payload?.targetKind);
  const targetKind = explicitKind && explicitKind !== "none"
    ? explicitKind
    : targetEntity ? "character"
      : targetObject ? (targetObject.kind === "position" ? "position" : "object")
        : targetId === clean(actor.placeId) || place.topology?.zones?.[targetId] ? "place"
          : "unknown";

  if (["object", "position"].includes(targetKind)) {
    return settleHandle({
      state,
      attempt: {
        ...clone(attempt),
        payload: {
          ...clone(attempt.payload || {}),
          objectId: targetId,
          operation: "interact",
        },
      },
    });
  }

  const visibleAction = clean(attempt.payload?.visibleAction);
  const affectiveTexture = clone(attempt.payload?.observableAffectiveTexture || []);
  if (targetKind === "character") {
    result.attemptSurface.push({
      kind: "character_interaction_attempted",
      actorId: actor.id,
      targetCharacterId: targetId,
      visibleAction,
      observableAffectiveTexture: affectiveTexture,
    });
    result.committedFacts.push(...result.attemptSurface);
    result.intendedEffects.push({ kind: "character_interacted", targetCharacterId: targetId });
    const reachable = targetEntity?.present !== false
      && clean(targetEntity?.placeId) === clean(actor.placeId)
      && clean(targetEntity?.zoneId) === clean(actor.zoneId);
    if (!reachable) {
      result.failedEffects.push({ code: "INTERACT_CHARACTER_NOT_REACHABLE", targetCharacterId: targetId });
      return result;
    }
    result.status = "success";
    result.resolvedEffects.push({ kind: "character_interacted", targetCharacterId: targetId });
    for (const observer of observableCharacters(state, actor, { modality: "visual" })) {
      result.deliveries.push({
        deliveryId: `delivery:${clean(attempt.attemptId)}:interaction:${observer.id}`,
        eventKind: "character_interaction",
        modality: "visual",
        sourceCharacterId: actor.id,
        recipientCharacterId: observer.id,
        content: visibleAction || `${clean(actor.name || actor.id)}向${clean(targetEntity.name || targetEntity.id)}作出接触`,
        observableAffectiveTexture: affectiveTexture,
      });
    }
    return result;
  }

  if (targetKind !== "place") {
    result.failedEffects.push({ code: "INTERACT_TARGET_UNKNOWN", targetId, targetKind });
    return result;
  }

  const targetIsWholePlace = targetId === clean(actor.placeId);
  const targetZoneKnown = Boolean(place.topology?.zones?.[targetId]);
  result.attemptSurface.push({
    kind: "place_interaction_attempted",
    actorId: actor.id,
    targetPlaceId: targetIsWholePlace ? targetId : clean(actor.placeId),
    targetZoneId: targetIsWholePlace ? clean(actor.zoneId) : targetId,
    visibleAction,
    observableAffectiveTexture: affectiveTexture,
  });
  result.committedFacts.push(...result.attemptSurface);
  result.intendedEffects.push({ kind: "place_interacted", targetId });
  const reachable = targetIsWholePlace || (
    targetZoneKnown
    && directlyAdjacentZone(place.topology || {}, actor.zoneId, targetId)
  );
  if (!reachable) {
    result.failedEffects.push({ code: "INTERACT_PLACE_NOT_REACHABLE", targetId });
    return result;
  }

  result.status = "success";
  result.resolvedEffects.push({ kind: "place_interacted", targetId });
  for (const observer of observableCharacters(state, actor, { modality: "visual" })) {
    result.deliveries.push({
      deliveryId: `delivery:${clean(attempt.attemptId)}:place-interaction:${observer.id}`,
      eventKind: "place_interaction",
      modality: "visual",
      sourceCharacterId: actor.id,
      recipientCharacterId: observer.id,
      content: visibleAction || `${clean(actor.name || actor.id)}对近旁空间作出接触`,
      observableAffectiveTexture: affectiveTexture,
    });
  }

  const soundTexture = affectiveTexture.filter((row) => clean(row?.modality) === "sound");
  const soundContent = clean(attempt.payload?.contactOperation) === "knock"
    ? "近旁的界面上传来叩声。" : soundTexture.map((row) => clean(row?.feature)).filter(Boolean).join("；");
  if (soundContent) {
    const signalId = `signal:${clean(attempt.attemptId)}:interaction-sound`;
    result.statePatch.operations.push(appendOperation(["signals"], {
      signalId,
      kind: "interaction_sound",
      modality: "sound",
      sourceCharacterId: actor.id,
      targetPlaceId: clean(actor.placeId),
      targetZoneId: targetIsWholePlace ? clean(actor.zoneId) : targetId,
      placeId: actor.placeId,
      zoneId: actor.zoneId,
      content: soundContent,
      emittedAtSeconds: Number(state.nowSeconds || 0) + 1,
      audibleUntilSeconds: Number(state.nowSeconds || 0) + 3,
      observableAffectiveTexture: soundTexture,
    }));
    result.resolvedEffects.push({ kind: "interaction_sound_emitted", signalId, targetId });
    const recipients = new Map([
      ...observableCharacters(state, actor, { modality: "sound" }),
      ...charactersInZones(state, actor, targetIsWholePlace ? [] : [targetId]),
    ].map((row) => [clean(row.id), row]));
    for (const recipient of recipients.values()) {
      result.deliveries.push({
        deliveryId: `delivery:${signalId}:${recipient.id}`,
        eventKind: "place_interaction_sound",
        modality: "sound",
        sourceCharacterId: actor.id,
        recipientCharacterId: recipient.id,
        signalId,
        content: soundContent,
        observableAffectiveTexture: soundTexture,
      });
    }
  }
  return result;
}

// A change in a person's health settled as world fact: they collapse, come
// round or die. Onlookers see someone fall or stir; a death shows only as stillness.
function settleBodyState({ state, attempt }) {
  const result = baseResolution(attempt);
  const actor = actorGate(state, attempt, result);
  if (!actor) return result;
  const event = clean(attempt.payload?.event);
  const health = healthOf({ health: attempt.payload?.health });
  if (!["collapsed", "came_round", "died"].includes(event) || healthOf(actor).state === "dead") {
    result.failedEffects.push({ code: "BODY_STATE_INVALID", event });
    return result;
  }
  result.status = "success";
  result.durationSeconds = 1;
  result.attemptSurface.push({ kind: "health_changed", actorId: actor.id, event, state: health.state, visibleAction: healthNews(event, clean(actor.name)) });
  result.committedFacts.push(...result.attemptSurface);
  result.resolvedEffects.push({ kind: "health_changed", actorId: actor.id, event, state: health.state, cause: clean(health.cause) });
  result.statePatch.operations.push(setOperation(["entities", actor.id, "health"], health));
  const news = onlookerNews(event);
  if (news) for (const observer of observableCharacters(state, actor, { modality: "visual" })) {
    result.deliveries.push({ deliveryId: `delivery:${clean(attempt.attemptId)}:health:${observer.id}`, eventKind: "health_changed", modality: "visual",
      sourceCharacterId: actor.id, recipientCharacterId: observer.id, content: news, urgent: event === "collapsed" });
  }
  return result;
}

// Laying hands on someone, settled by strength and a fixed draw for this attempt.
function settleConfront({ state, attempt }) {
  const result = baseResolution(attempt);
  const actor = actorGate(state, attempt, result);
  if (!actor) return result;
  const targetId = clean(attempt.payload?.targetCharacterId);
  const act = clean(attempt.payload?.act);
  const settled = confrontationOutcome({ state, actorId: actor.id, targetId, act, roll: rollFor(attempt.attemptId) });
  result.durationSeconds = 5;
  if (!settled.ok) { result.failedEffects.push({ code: settled.code, targetCharacterId: targetId }); return result; }
  result.status = "success";
  result.attemptSurface.push({ kind: "confrontation", actorId: actor.id, targetCharacterId: targetId, act, outcome: settled.outcome, visibleAction: settled.surfaceText });
  result.committedFacts.push(...result.attemptSurface);
  result.resolvedEffects.push({ kind: "confrontation_settled", actorId: actor.id, targetCharacterId: targetId, act, outcome: settled.outcome, ...(settled.health ? { targetState: settled.health.state } : {}) });
  if (settled.health) {
    result.statePatch.operations.push(setOperation(["entities", targetId, "health"], settled.health));
    if (settled.health.state === "dead") result.resolvedEffects.push({ kind: "health_changed", actorId: targetId, event: "died", state: "dead", cause: clean(settled.health.cause) });
  }
  if ("heldBy" in settled) result.statePatch.operations.push(setOperation(["entities", targetId, "heldBy"], settled.heldBy));
  if (settled.freedActor) result.statePatch.operations.push(setOperation(["entities", actor.id, "heldBy"], ""));
  const seers = new Set([targetId, ...observableCharacters(state, actor, { modality: "visual" }).map((row) => row.id)]);
  for (const id of seers) {
    if (id === actor.id || healthOf(state.entities?.[id]).state === "dead") continue;
    result.deliveries.push({ deliveryId: `delivery:${clean(attempt.attemptId)}:confront:${id}`, eventKind: "confrontation", modality: "visual",
      sourceCharacterId: actor.id, recipientCharacterId: id, directed: id === targetId, urgent: true, content: settled.tell(id) });
  }
  return result;
}

// Going after someone: a stretch of the way, two when clearly faster; reaching them, a grab.
function settlePursue({ state, attempt }) {
  const result = baseResolution(attempt);
  const actor = actorGate(state, attempt, result);
  if (!actor) return result;
  const targetId = clean(attempt.payload?.targetCharacterId);
  const plan = pursuitPlan({ state, actorId: actor.id, targetId });
  result.attemptSurface.push({ kind: "pursuit_attempted", actorId: actor.id, targetCharacterId: targetId });
  result.committedFacts.push(...result.attemptSurface);
  if (!plan.ok) { result.durationSeconds = 10; result.failedEffects.push({ code: plan.code, targetCharacterId: targetId }); return result; }
  // Each stretch is settled as an ordinary walk; reaching them, an ordinary grab.
  const parts = [];
  let current = state;
  for (const [index, zoneId] of plan.path.entries()) {
    const step = settleMove({ state: current, attempt: { ...clone(attempt), attemptId: `${clean(attempt.attemptId)}:hop${index + 1}`, primitive: "move",
      payload: { ...clone(attempt.payload || {}), destinationId: zoneId, positionId: "", utterance: "", speech: "" } } });
    parts.push(step);
    if (clean(step.status) !== "success") break;
    current = applyWorldStatePatch(current, step.statePatch || { operations: [] });
  }
  const reached = clean(current.entities?.[actor.id]?.zoneId) === clean(current.entities?.[targetId]?.zoneId);
  if (reached) parts.push(settleConfront({ state: current, attempt: { ...clone(attempt), attemptId: `${clean(attempt.attemptId)}:grab`, primitive: "confront",
    payload: { ...clone(attempt.payload || {}), act: "grab", targetCharacterId: targetId, utterance: "", speech: "" } } }));
  for (const part of parts) {
    result.statePatch.operations.push(...(part.statePatch?.operations || []));
    result.attemptSurface.push(...(part.attemptSurface || []));
    result.committedFacts.push(...(part.committedFacts || []));
    result.resolvedEffects.push(...(part.resolvedEffects || []));
    result.failedEffects.push(...(part.failedEffects || []));
    result.deliveries.push(...(part.deliveries || []));
    result.durationSeconds = Number(result.durationSeconds || 0) + Number(part.durationSeconds || 0);
  }
  result.status = parts.some((part) => clean(part.status) === "success") ? "success" : "failed";
  result.resolvedEffects.push({ kind: "pursued", actorId: actor.id, targetCharacterId: targetId, reached });
  return result;
}

// Asking someone to marry, or saying yes: settled face to face, seen by whoever is there.
function settleMarriage({ state, attempt }) {
  const result = baseResolution(attempt);
  const actor = actorGate(state, attempt, result);
  if (!actor) return result;
  const targetId = clean(attempt.payload?.targetCharacterId);
  const act = clean(attempt.payload?.act);
  const settled = marriageOutcome({ state, actorId: actor.id, targetId, act });
  result.durationSeconds = 30;
  if (!settled.ok) { result.failedEffects.push({ code: settled.code, targetCharacterId: targetId }); return result; }
  result.status = "success";
  result.attemptSurface.push({ kind: settled.wedding ? "marriage_wed" : "marriage_proposed", actorId: actor.id, targetCharacterId: targetId, act, visibleAction: settled.surfaceText });
  result.committedFacts.push(...result.attemptSurface);
  result.resolvedEffects.push({ kind: settled.wedding ? "married" : "proposal_made", actorId: actor.id, targetCharacterId: targetId });
  for (const [id, field, value] of settled.entityPatches) result.statePatch.operations.push(setOperation(["entities", id, field], value));
  // A wedding opens the way to a child, for a couple who could have one.
  const opens = settled.wedding ? conceptionAfterWedding(state, actor.id, targetId, Number(state.nowSeconds || 0)) : null;
  if (opens) result.statePatch.operations.push(setOperation(["entities", opens[0], opens[1]], opens[2]));
  const seers = new Set([targetId, ...observableCharacters(state, actor, { modality: "visual" }).map((row) => row.id)]);
  for (const id of seers) {
    if (id === actor.id || ["down", "dead"].includes(healthOf(state.entities?.[id]).state)) continue;
    result.deliveries.push({ deliveryId: `delivery:${clean(attempt.attemptId)}:marriage:${id}`, eventKind: "marriage", modality: "visual",
      sourceCharacterId: actor.id, recipientCharacterId: id, directed: id === targetId, urgent: id === targetId, content: settled.tell(id) });
  }
  return result;
}

// Eating, drinking, drawing and pouring water: settled where the person stands, seen by whoever is there.
function settleSustain({ state, attempt }) {
  const result = baseResolution(attempt);
  const actor = actorGate(state, attempt, result);
  if (!actor) return result;
  const act = clean(attempt.payload?.act);
  const objectId = clean(attempt.payload?.objectId);
  result.attemptSurface.push({ kind: "sustenance_attempted", actorId: actor.id, act, objectId });
  result.committedFacts.push(...result.attemptSurface);
  const settled = sustenanceOutcome({ state, actorId: actor.id, act, objectId });
  if (!settled.ok) { result.durationSeconds = 10; result.failedEffects.push({ code: settled.code, objectId }); return result; }
  result.status = "success";
  result.durationSeconds = settled.durationSeconds;
  // One state write per object, each field the rule changed.
  const touched = new Map();
  for (const [id, field, value] of settled.objectPatches) touched.set(id, { ...(touched.get(id) || clone(state.objects[id].state || {})), [field]: value });
  for (const [id, next] of touched) result.statePatch.operations.push(setOperation(["objects", id, "state"], next));
  result.resolvedEffects.push({ kind: `sustenance_${act}`, actorId: actor.id, objectId, act });
  if (settled.bodyLoad) result.resolvedEffects.push({ kind: "body_load_applied", targetActorId: actor.id, ...settled.bodyLoad });
  const done = { kind: "sustenance_done", actorId: actor.id, act, objectId, visibleAction: settled.surfaceText };
  result.attemptSurface.push(done);
  result.committedFacts.push(done);
  for (const observer of observableCharacters(state, actor, { modality: "visual" })) {
    if (observer.id === actor.id || ["down", "dead"].includes(healthOf(state.entities?.[observer.id]).state)) continue;
    result.deliveries.push({ deliveryId: `delivery:${clean(attempt.attemptId)}:sustain:${observer.id}`, eventKind: "sustenance", modality: "visual",
      sourceCharacterId: actor.id, recipientCharacterId: observer.id, directed: false, urgent: false,
      content: `${personFor(state, observer.id, actor.id)}${settled.surfaceText}` });
  }
  return result;
}

// Lying down to sleep where one is: in a bed if the room has one, else on the floor or the ground.
function settleSleep({ state, attempt }) {
  const result = baseResolution(attempt);
  const actor = actorGate(state, attempt, result);
  if (!actor) return result;
  const sleep = fallAsleep(state, actor, Number(state.nowSeconds || 0));
  result.status = "success";
  result.durationSeconds = 0;
  const surface = { kind: "fell_asleep", actorId: actor.id, where: sleep.where, visibleAction: "躺下睡了。" };
  result.attemptSurface.push(surface);
  result.committedFacts.push(surface);
  result.resolvedEffects.push({ kind: "fell_asleep", actorId: actor.id, where: sleep.where });
  result.statePatch.operations.push(setOperation(["entities", actor.id, "sleep"], sleep));
  for (const observer of observableCharacters(state, actor, { modality: "visual" })) {
    if (observer.id === actor.id || ["down", "dead"].includes(healthOf(state.entities?.[observer.id]).state)) continue;
    result.deliveries.push({ deliveryId: `delivery:${clean(attempt.attemptId)}:sleep:${observer.id}`, eventKind: "sleep", modality: "visual",
      sourceCharacterId: actor.id, recipientCharacterId: observer.id, directed: false, urgent: false, content: `${personFor(state, observer.id, actor.id)}躺下睡了。` });
  }
  return result;
}

// Offering a swap, or saying yes to one: settled face to face, seen by whoever is there.
function settleExchange({ state, attempt }) {
  const result = baseResolution(attempt);
  const actor = actorGate(state, attempt, result);
  if (!actor) return result;
  const targetId = clean(attempt.payload?.targetCharacterId);
  const act = clean(attempt.payload?.act);
  const objectId = clean(attempt.payload?.objectId);
  const settled = exchangeOutcome({ state, actorId: actor.id, targetId, act, objectId });
  result.durationSeconds = 30;
  if (!settled.ok) { result.failedEffects.push({ code: settled.code, targetCharacterId: targetId, objectId }); return result; }
  result.status = "success";
  const kind = act === "deal" ? "exchanged" : "exchange_offered";
  result.attemptSurface.push({ kind, actorId: actor.id, targetCharacterId: targetId, act, giveObjectId: settled.giveObjectId, wantObjectId: settled.wantObjectId, visibleAction: settled.surfaceText });
  result.committedFacts.push(...result.attemptSurface);
  result.resolvedEffects.push({ kind, actorId: actor.id, targetCharacterId: targetId, giveObjectId: settled.giveObjectId, wantObjectId: settled.wantObjectId });
  for (const [id, field, value] of settled.entityPatches) result.statePatch.operations.push(setOperation(["entities", id, field], value));
  for (const [id, object] of settled.objectPatches) result.statePatch.operations.push(setOperation(["objects", id], object));
  const seers = new Set([targetId, ...observableCharacters(state, actor, { modality: "visual" }).map((row) => row.id)]);
  for (const id of seers) {
    if (id === actor.id || ["down", "dead"].includes(healthOf(state.entities?.[id]).state)) continue;
    result.deliveries.push({ deliveryId: `delivery:${clean(attempt.attemptId)}:exchange:${id}`, eventKind: "exchange", modality: "visual",
      sourceCharacterId: actor.id, recipientCharacterId: id, directed: id === targetId, urgent: id === targetId, content: settled.tell(id) });
  }
  return result;
}

export function createWorldActionRegistry({ includeBuiltins = true } = {}) {
  const resolvers = new Map();
  const registry = {
    schemaVersion: WORLD_ACTION_REGISTRY_VERSION,
    register(primitive, resolver) {
      const id = clean(primitive);
      if (!id || typeof resolver !== "function") throw fail("WORLD_ACTION_REGISTRATION_INVALID", "Action primitive requires an id and resolver.");
      if (resolvers.has(id)) throw fail("WORLD_ACTION_PRIMITIVE_DUPLICATE", "Action primitive is already registered.", { primitive: id });
      resolvers.set(id, resolver);
      return registry;
    },
    has(primitive) { return resolvers.has(clean(primitive)); },
    list() { return [...resolvers.keys()].sort(); },
    async settle(context = {}) {
      context = { ...context, attempt: physicalAttemptForSettlement(context.attempt) };
      const primitive = clean(context.attempt?.primitive);
      const resolver = resolvers.get(primitive);
      if (!resolver) throw fail("WORLD_ACTION_PRIMITIVE_UNKNOWN", "World action primitive is not registered.", { primitive });
      const primaryResolution = await resolver({ state: clone(context.state), attempt: clone(context.attempt), registry });
      const bodyResolution = settleAccompanyingBodyExpression({
        state: context.state, attempt: context.attempt, primaryResolution,
      });
      const expressionResolution = settleAccompanyingSpeech({
        state: clone(context.state),
        attempt: clone(context.attempt),
        primaryResolution: bodyResolution,
      });
      const resolution = settleAccompanyingSharedActivity({
        state: clone(context.state),
        attempt: clone(context.attempt),
        primaryResolution: expressionResolution,
      });
      if (!resolution || resolution.authority !== "world-action-registry") {
        throw fail("WORLD_ACTION_RESOLUTION_INVALID", "Action resolver returned an invalid result.", { primitive });
      }
      if (Object.hasOwn(resolution, "selectedAction") || Object.hasOwn(resolution, "selectedResponse")) {
        throw fail("WORLD_ACTION_SELECTION_FORBIDDEN", "World action resolver may not choose a character action or response.");
      }
      return clone(resolution);
    },
  };
  if (includeBuiltins) {
    registry.register("observe", settleObserve);
    registry.register("listen", settleListen);
    registry.register("speak", settleSpeak);
    registry.register("gesture", settleGesture);
    registry.register("move", settleMove);
    registry.register("pursue", settlePursue);
    registry.register("interact", settleInteract);
    registry.register("handle", settleHandle);
    registry.register("rest", settleRest);
    registry.register("wait", settleWait);
    registry.register("practice", settlePractice);
    registry.register("leave", settleLeave);
    registry.register("body_state", settleBodyState);
    registry.register("confront", settleConfront);
    registry.register("marriage", settleMarriage);
    registry.register("exchange", settleExchange);
    registry.register("sustain", settleSustain);
    registry.register("sleep", settleSleep);
  }
  return registry;
}

export function applyWorldStatePatch(state = {}, patch = {}) {
  const next = clone(state || {});
  for (const operation of patch.operations || []) {
    const path = Array.isArray(operation.path) ? operation.path.map(clean).filter(Boolean) : [];
    if (!path.length) throw fail("WORLD_STATE_PATCH_PATH_REQUIRED", "World state patch operation requires a path.");
    let cursor = next;
    for (const segment of path.slice(0, -1)) {
      if (!cursor[segment] || typeof cursor[segment] !== "object") cursor[segment] = {};
      cursor = cursor[segment];
    }
    const key = path.at(-1);
    if (operation.op === "set") cursor[key] = clone(operation.value);
    else if (operation.op === "append") {
      if (!Array.isArray(cursor[key])) cursor[key] = [];
      cursor[key].push(clone(operation.value));
    } else throw fail("WORLD_STATE_PATCH_OPERATION_UNKNOWN", "Unknown world state patch operation.", { operation: operation.op });
  }
  return next;
}
