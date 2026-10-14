/**
 * Scene-independent causal action kernel.
 *
 * A place adapter owns topology only. Actors own a generic `agency` record.
 * Candidates own their concrete causes and consequences. Social facts may be
 * perceived and appraised by a Character Agent, but an adapter never rewrites
 * duty or promotes an unaccepted role into an obligation tier.
 */

import { scoreActionCandidates } from "./actionUtility.mjs";
import { conversationalSpeechAllowed } from "./spatialPerception.mjs";
import {
  applyObjectOperations,
  normalizeObjectLedger,
  relocateHeldObjects,
  validateObjectAccess,
  validateObjectOperations,
} from "./objectLedger.mjs";
import { propagateImpact } from "./eventPropagation.mjs";
import { deriveDesireSatisfactionEffects } from "./desireSatisfaction.mjs";

export const CAUSAL_SCENE_KERNEL_VERSION = "generic-causal-scene-v1";

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").trim();
}

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalize01(value, fallback = 0) {
  const numeric = finite(value, fallback);
  return Math.max(0, Math.min(1, Math.abs(numeric) > 1 ? numeric / 100 : numeric));
}

function unique(values = []) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function actorIdOf(actor = {}) {
  return clean(actor.actorId || actor.id || actor.characterId);
}

function targetActorIdOf(candidate = {}) {
  return clean(
    candidate.targetActorId
      || candidate.targetCharacterId
      || candidate.speech?.targetActorId
      || candidate.speech?.targetCharacterId,
  );
}

function sceneRows(source = []) {
  return Array.isArray(source)
    ? source
    : Object.entries(source || {}).map(([id, scene]) => ({ id, ...(scene || {}) }));
}

function zoneRows(source = []) {
  return Array.isArray(source)
    ? source
    : Object.entries(source || {}).flatMap(([key, value]) => {
      if (Array.isArray(value)) return value.map((zone) => ({ id: key, ...(zone || {}) }));
      return [{ id: key, ...(value || {}) }];
    });
}

function edgeRows(source = []) {
  return Array.isArray(source) ? source : Object.values(source || {});
}

function zoneKey(sceneId = "", zoneId = "") {
  return `${encodeURIComponent(clean(sceneId))}::${encodeURIComponent(clean(zoneId))}`;
}

function zonePairId(sceneId = "", zoneId = "") {
  return `${clean(sceneId)}\u0000${clean(zoneId)}`;
}

function normalizeModes(edge = {}) {
  const modes = edge.modes || edge.modalities || [];
  return unique(Array.isArray(modes) ? modes : [modes]).map((mode) => mode.toLowerCase());
}

function resolveEdgeEndpoint({ edge, endpoint, zones, zonesByLocalId }) {
  const localZoneId = clean(
    endpoint === "from"
      ? edge.fromZoneId || edge.from || edge.sourceZoneId
      : edge.toZoneId || edge.to || edge.targetZoneId,
  );
  const explicitSceneId = clean(
    endpoint === "from"
      ? edge.fromSceneId || edge.sourceSceneId || edge.sceneId
      : edge.toSceneId || edge.targetSceneId || edge.sceneId,
  );
  if (!localZoneId) throw new Error(`SCENE_ADAPTER_EDGE_${endpoint.toUpperCase()}_ZONE_MISSING`);
  if (explicitSceneId) {
    const zone = zones.get(zonePairId(explicitSceneId, localZoneId));
    if (!zone) throw new Error(`SCENE_ADAPTER_EDGE_ZONE_UNKNOWN:${explicitSceneId}:${localZoneId}`);
    return zone;
  }
  const matches = zonesByLocalId.get(localZoneId) || [];
  if (matches.length !== 1) {
    throw new Error(`SCENE_ADAPTER_EDGE_SCENE_AMBIGUOUS:${localZoneId}`);
  }
  return matches[0];
}

/**
 * Compile adapter data into collision-safe internal topology. Local zone ids
 * may repeat in different scenes; their internal ids never do.
 */
export function normalizeCausalSceneAdapter(input = {}) {
  if (input?.kernelVersion === CAUSAL_SCENE_KERNEL_VERSION && input?.spatialTopology) return input;

  const scenes = sceneRows(input.scenes).map((raw) => ({
    ...clone(raw),
    id: clean(raw.id || raw.sceneId),
  }));
  if (!scenes.length || scenes.some((scene) => !scene.id)) {
    throw new Error("SCENE_ADAPTER_SCENES_REQUIRED");
  }
  const sceneIds = new Set(scenes.map((scene) => scene.id));
  if (sceneIds.size !== scenes.length) throw new Error("SCENE_ADAPTER_SCENE_ID_DUPLICATE");

  const zones = new Map();
  const zonesByLocalId = new Map();
  const normalizedZones = zoneRows(input.zones).map((raw) => {
    const id = clean(raw.id || raw.zoneId);
    const sceneId = clean(raw.sceneId || raw.locationId);
    if (!id || !sceneId || !sceneIds.has(sceneId)) {
      throw new Error(`SCENE_ADAPTER_ZONE_INVALID:${sceneId}:${id}`);
    }
    const pair = zonePairId(sceneId, id);
    if (zones.has(pair)) throw new Error(`SCENE_ADAPTER_ZONE_DUPLICATE:${sceneId}:${id}`);
    const zone = {
      ...clone(raw),
      id,
      zoneId: id,
      sceneId,
      internalZoneId: zoneKey(sceneId, id),
    };
    zones.set(pair, zone);
    zonesByLocalId.set(id, [...(zonesByLocalId.get(id) || []), zone]);
    return zone;
  });
  if (!normalizedZones.length) throw new Error("SCENE_ADAPTER_ZONES_REQUIRED");

  const normalizedEdges = edgeRows(input.edges).map((raw, index) => {
    const from = resolveEdgeEndpoint({ edge: raw, endpoint: "from", zones, zonesByLocalId });
    const to = resolveEdgeEndpoint({ edge: raw, endpoint: "to", zones, zonesByLocalId });
    return {
      ...clone(raw),
      id: clean(raw.id) || `edge-${index + 1}`,
      fromZoneId: from.internalZoneId,
      toZoneId: to.internalZoneId,
      fromSceneId: from.sceneId,
      toSceneId: to.sceneId,
      fromLocalZoneId: from.id,
      toLocalZoneId: to.id,
      modes: normalizeModes(raw),
      distance: Math.max(0, finite(raw.distance ?? raw.weight, 1)),
      bidirectional: raw.bidirectional !== false,
    };
  });

  const spatialZones = normalizedZones.map((zone) => ({
    ...clone(zone),
    id: zone.internalZoneId,
    zoneId: zone.internalZoneId,
    localZoneId: zone.id,
  }));

  return {
    ...clone(input),
    kernelVersion: CAUSAL_SCENE_KERNEL_VERSION,
    scenes,
    zones: normalizedZones,
    edges: normalizedEdges,
    deprecatedResponsibilityRules: clone(input.responsibilityRules || []),
    spatialTopology: {
      scenes: clone(scenes),
      zones: spatialZones,
      edges: normalizedEdges,
      barriers: clone(input.barriers || []),
    },
    zoneIndex: Object.fromEntries(normalizedZones.map((zone) => [
      zonePairId(zone.sceneId, zone.id),
      zone.internalZoneId,
    ])),
    zoneReverseIndex: Object.fromEntries(normalizedZones.map((zone) => [
      zone.internalZoneId,
      { sceneId: zone.sceneId, zoneId: zone.id },
    ])),
  };
}

function normalizedAdapter(adapter = {}) {
  return normalizeCausalSceneAdapter(adapter);
}

function internalZoneId(adapter, sceneId, localZoneId) {
  return clean(adapter.zoneIndex?.[zonePairId(sceneId, localZoneId)]);
}

function externalZone(adapter, value = "") {
  return adapter.zoneReverseIndex?.[clean(value)] || null;
}

function normalizeActor(actor = {}) {
  const id = actorIdOf(actor);
  return {
    ...clone(actor),
    id,
    actorId: id,
    present: actor.present !== false,
    sceneId: clean(actor.sceneId || actor.location?.sceneId),
    zoneId: clean(actor.zoneId || actor.location?.zoneId),
    agency: clone(actor.agency || {}),
  };
}

function normalizeRelationships(source = []) {
  const rows = Array.isArray(source) ? source : Object.values(source || {}).flat();
  return rows.map((relationship, index) => ({
    ...clone(relationship),
    id: clean(relationship.id) || `relationship-${index + 1}`,
    fromActorId: clean(
      relationship.fromActorId || relationship.sourceActorId || relationship.fromCharacterId,
    ),
    toActorId: clean(
      relationship.toActorId || relationship.targetActorId || relationship.toCharacterId,
    ),
  }));
}

export function createCausalSceneState({
  actors = [],
  relationships = [],
  objectLedger = {},
  observations = [],
  pendingImpacts = [],
  impacts = [],
  actions = [],
  nowSeconds = 0,
  nextActionSequence = 1,
} = {}) {
  return {
    schemaVersion: 1,
    kernelVersion: CAUSAL_SCENE_KERNEL_VERSION,
    actors: (actors || []).map(normalizeActor),
    relationships: normalizeRelationships(relationships),
    objectLedger: normalizeObjectLedger(objectLedger),
    observations: clone(observations || []),
    pendingImpacts: clone(pendingImpacts || []),
    impacts: clone(impacts || []),
    actions: clone(actions || []),
    nowSeconds: Math.max(0, finite(nowSeconds)),
    nextActionSequence: Math.max(1, Math.floor(finite(nextActionSequence, 1))),
  };
}

function scoringActor(actor = {}) {
  const agency = actor.agency || {};
  return {
    ...clone(actor),
    traits: clone(agency.traits || agency.personality || actor.traits || actor.personality || {}),
    state: clone(agency.currentState || agency.state || actor.state || actor.currentState || {}),
    weights: clone(agency.weights || agency.actionWeights || actor.weights || actor.actionWeights || {}),
  };
}

function toSpatialActor(adapter, actor = {}) {
  return {
    ...clone(actor),
    zoneId: internalZoneId(adapter, actor.sceneId, actor.zoneId),
  };
}

function toSpatialActors(adapter, actors = []) {
  return (actors || []).map((actor) => toSpatialActor(adapter, actor));
}

function toSpatialLedger(adapter, ledger = {}, actors = []) {
  const normalized = normalizeObjectLedger(ledger);
  const byActor = new Map((actors || []).map((actor) => [actorIdOf(actor), actor]));
  for (const object of Object.values(normalized.objects || {})) {
    const holder = byActor.get(clean(object.holderActorId));
    const sceneId = clean(object.sceneId || holder?.sceneId);
    const localZoneId = clean(object.zoneId || holder?.zoneId);
    object.sceneId = sceneId;
    object.zoneId = internalZoneId(adapter, sceneId, localZoneId);
  }
  return normalizeObjectLedger(normalized);
}

function fromSpatialLedger(adapter, ledger = {}) {
  const normalized = normalizeObjectLedger(ledger);
  for (const object of Object.values(normalized.objects || {})) {
    const pair = externalZone(adapter, object.zoneId);
    if (!pair) continue;
    object.sceneId = pair.sceneId;
    object.zoneId = pair.zoneId;
  }
  return normalizeObjectLedger(normalized);
}

function toSpatialOperations(adapter, operations = [], actors = []) {
  const byActor = new Map((actors || []).map((actor) => [actorIdOf(actor), actor]));
  return (operations || []).map((raw) => {
    const operation = clone(raw || {});
    const actor = byActor.get(clean(operation.actorId || operation.characterId));
    const sceneId = clean(operation.sceneId || actor?.sceneId);
    if (operation.zoneId) operation.zoneId = internalZoneId(adapter, sceneId, operation.zoneId);
    if (operation.toZoneId) operation.toZoneId = internalZoneId(adapter, sceneId, operation.toZoneId);
    return operation;
  });
}

function edgeAllows(edge = {}, mode = "") {
  if (edge.blocked === true || edge.open === false || edge.passable === false) return false;
  const blockedModes = unique(edge.blockedModes).map((value) => value.toLowerCase());
  if (blockedModes.includes(mode)) return false;
  const modes = normalizeModes(edge);
  if (!modes.length) return true;
  return modes.includes(mode);
}

function routeFor(adapter, fromInternalZoneId, toInternalZoneId, mode = "movement") {
  const source = clean(fromInternalZoneId);
  const target = clean(toInternalZoneId);
  if (!source || !target) return null;
  if (source === target) return { distance: 0, zones: [source] };
  const frontier = [{ zoneId: source, distance: 0, zones: [source] }];
  const best = new Map([[source, 0]]);
  while (frontier.length) {
    frontier.sort((left, right) => left.distance - right.distance || left.zoneId.localeCompare(right.zoneId));
    const current = frontier.shift();
    if (current.zoneId === target) return current;
    for (const edge of adapter.edges || []) {
      if (!edgeAllows(edge, mode)) continue;
      const forward = edge.fromZoneId === current.zoneId;
      const reverse = edge.bidirectional !== false && edge.toZoneId === current.zoneId;
      if (!forward && !reverse) continue;
      const nextZoneId = forward ? edge.toZoneId : edge.fromZoneId;
      const distance = current.distance + Math.max(0, finite(edge.distance, 1));
      if (distance >= (best.get(nextZoneId) ?? Infinity)) continue;
      best.set(nextZoneId, distance);
      frontier.push({ zoneId: nextZoneId, distance, zones: [...current.zones, nextZoneId] });
    }
  }
  return null;
}

function observationImpactIds(observation = {}) {
  return unique([
    observation.impactId,
    observation.sourceImpactId,
    observation.rootImpactId,
    observation.provenance?.sourceImpactId,
    observation.provenance?.rootImpactId,
  ]);
}

function actorObservedImpact(state, actorId, impact = {}) {
  const directRecipients = unique([
    ...(impact.receivedByActorIds || []),
    ...(impact.deliveredToActorIds || []),
    ...(impact.recipientActorIds || []),
    impact.directedTargetId,
    impact.targetActorId,
  ]);
  if (directRecipients.includes(actorId)) return true;
  if ((impact.deliveries || []).some((delivery) => clean(
    delivery.targetActorId || delivery.receiverActorId || delivery.recipientId,
  ) === actorId)) return true;
  return (state.observations || []).some((observation) => (
    clean(observation.targetActorId || observation.receiverActorId || observation.observerActorId || observation.recipientId) === actorId
    && observationImpactIds(observation).includes(clean(impact.id))
  ));
}

function responsibilityForCandidate({ adapter, state, actor, candidate }) {
  const impactId = clean(candidate.respondsToImpactId || candidate.sourceImpactId);
  const pendingImpact = (state.pendingImpacts || []).find((impact) => (
    clean(impact.id) === impactId
    && !["handled", "resolved", "expired"].includes(clean(impact.status).toLowerCase())
  ));
  const observed = Boolean(pendingImpact && actorObservedImpact(state, actor.id, pendingImpact));
  return {
    impactId,
    observed,
    tags: [],
    pendingImpact: pendingImpact ? clone(pendingImpact) : null,
    matched: false,
    matchedTags: [],
    score: 0,
    authority: "causal-reference-only-no-scene-responsibility",
  };
}

function bodyDemandSignals(candidate = {}) {
  const bodyDemand = candidate.bodyDemand || {};
  if (!bodyDemand || typeof bodyDemand !== "object") return {};
  const signals = {};
  if (["bodyReward", "reward", "relief"].some((key) => Object.hasOwn(bodyDemand, key))) {
    signals.bodyReward = normalize01(
      bodyDemand.bodyReward ?? bodyDemand.reward ?? bodyDemand.relief,
    );
  }
  if (["bodyCost", "cost", "exertion"].some((key) => Object.hasOwn(bodyDemand, key))) {
    signals.bodyCost = normalize01(
      bodyDemand.bodyCost ?? bodyDemand.cost ?? bodyDemand.exertion,
    );
  }
  return signals;
}

function impactDeclarations(candidate = {}) {
  if (Array.isArray(candidate.impacts)) return candidate.impacts;
  if (candidate.impact && typeof candidate.impact === "object") return [candidate.impact];
  return [];
}

function speechDeclaration(candidate = {}) {
  const speech = candidate.speech && typeof candidate.speech === "object"
    ? candidate.speech
    : null;
  const actionKind = clean(candidate.actionKind || candidate.kind).toLowerCase();
  const isSpeech = Boolean(speech) || ["speech", "call_out"].includes(actionKind);
  if (!isSpeech) return null;
  const mode = clean(speech?.mode || speech?.vocalMode || candidate.vocalMode || actionKind).toLowerCase();
  return {
    ...(clone(speech) || {}),
    mode: mode === "call_out" ? "call_out" : "conversational",
    targetActorId: clean(speech?.targetActorId || speech?.targetCharacterId || targetActorIdOf(candidate)),
    content: clean(speech?.content || speech?.text || candidate.speechText),
    radius: Math.max(0, finite(speech?.radius ?? candidate.callOutRange, mode === "call_out" ? 3 : 0)),
  };
}

function gate(id, passed, evidence = {}) {
  return { id, passed: Boolean(passed), evidence };
}

function prepareCandidate({ adapter, state, actor, candidate, context = {} }) {
  const row = clone(candidate || {});
  const candidateId = clean(row.id || row.candidateId || row.actionId);
  const sceneId = clean(row.sourceSceneId || row.sceneId);
  const zoneId = clean(row.sourceZoneId || row.zoneId);
  const gates = [...(row.hardGates || [])];
  gates.push(gate("candidate-id", Boolean(candidateId)));
  gates.push(gate("actor-present", actor.present !== false));
  gates.push(gate("actor-match", !row.actorId || clean(row.actorId) === actor.id, {
    declaredActorId: clean(row.actorId),
    actorId: actor.id,
  }));
  gates.push(gate("source-location-declared", Boolean(sceneId && zoneId), { sceneId, zoneId }));
  gates.push(gate("source-location-current", sceneId === actor.sceneId && zoneId === actor.zoneId, {
    actorSceneId: actor.sceneId,
    actorZoneId: actor.zoneId,
    sceneId,
    zoneId,
  }));
  const sourceInternalZoneId = internalZoneId(adapter, sceneId, zoneId);
  gates.push(gate("source-zone-exists", Boolean(sourceInternalZoneId), { sceneId, zoneId }));

  const responsibility = responsibilityForCandidate({ adapter, state, actor, candidate: row });
  const signals = {
    ...(row.factors || {}),
    ...(row.signals || {}),
    ...bodyDemandSignals(row),
  };
  const targetActorId = targetActorIdOf(row);
  const targetActor = state.actors.find((candidateActor) => candidateActor.id === targetActorId) || null;
  if (targetActorId) gates.push(gate("target-present", Boolean(targetActor && targetActor.present !== false), { targetActorId }));

  const speech = speechDeclaration(row);
  if (speech) {
    gates.push(gate("speech-content", Boolean(speech.content)));
    gates.push(gate("speech-target", Boolean(targetActor)));
    if (targetActor) {
      const targetInternalZoneId = internalZoneId(adapter, targetActor.sceneId, targetActor.zoneId);
      const allowed = conversationalSpeechAllowed({
        sourceSceneId: sceneId,
        targetSceneId: targetActor.sceneId,
        sourceZoneId: sourceInternalZoneId,
        targetZoneId: targetInternalZoneId,
        vocalMode: speech.mode,
        callOutRange: speech.radius,
        routeFor: (from, to, mode) => routeFor(adapter, from, to, mode),
      });
      gates.push(gate("speech-spatial-reach", allowed, {
        sourceSceneId: sceneId,
        sourceZoneId: zoneId,
        targetSceneId: targetActor.sceneId,
        targetZoneId: targetActor.zoneId,
        vocalMode: speech.mode,
      }));
    }
  }

  const movement = clean(row.actionKind || row.kind).toLowerCase() === "move"
    || clean(row.actionKind || row.kind).toLowerCase() === "movement"
    || Boolean(row.toZoneId || row.moveToZoneId);
  const toSceneId = clean(row.toSceneId || row.moveToSceneId || sceneId);
  const toZoneId = clean(row.toZoneId || row.moveToZoneId);
  if (movement) {
    const targetInternalZoneId = internalZoneId(adapter, toSceneId, toZoneId);
    const movementRoute = routeFor(adapter, sourceInternalZoneId, targetInternalZoneId, "movement");
    gates.push(gate("movement-target-exists", Boolean(targetInternalZoneId), { toSceneId, toZoneId }));
    gates.push(gate("movement-route", Boolean(
      movementRoute && (row.allowMultiHop === true || movementRoute.zones.length <= 2)
    ), { toSceneId, toZoneId, route: movementRoute?.zones || [] }));
    if (speech) gates.push(gate("single-spatial-phase", false, { reason: "movement_and_speech_require_separate_actions" }));
  }

  const spatialActors = toSpatialActors(adapter, state.actors);
  const spatialLedger = toSpatialLedger(adapter, state.objectLedger, state.actors);
  const requiredObjectIds = unique(row.requiredObjectIds || row.objectIds);
  if (requiredObjectIds.length) {
    const access = validateObjectAccess({
      ledger: spatialLedger,
      actor: toSpatialActor(adapter, actor),
      objectIds: requiredObjectIds,
      sceneId,
      zoneId: sourceInternalZoneId,
      topology: adapter.spatialTopology,
    });
    gates.push(gate("object-access", access.ok, { violations: access.violations }));
  }
  const objectOperations = toSpatialOperations(adapter, row.objectOperations || [], state.actors);
  if (objectOperations.length) {
    const validation = validateObjectOperations({
      ledger: spatialLedger,
      operations: objectOperations,
      actors: spatialActors,
      topology: adapter.spatialTopology,
    });
    gates.push(gate("object-operations", validation.ok, { violations: validation.violations }));
  }

  for (const impact of impactDeclarations(row)) {
    const impactActorId = clean(impact.sourceActorId || impact.actorId || actor.id);
    const impactSceneId = clean(impact.sourceSceneId || impact.sceneId || sceneId);
    const impactZoneId = clean(impact.sourceZoneId || impact.zoneId || zoneId);
    gates.push(gate("impact-source-actor", impactActorId === actor.id, { impactActorId, actorId: actor.id }));
    gates.push(gate("impact-source-location", impactSceneId === sceneId && impactZoneId === zoneId, {
      impactSceneId,
      impactZoneId,
      sceneId,
      zoneId,
    }));
  }

  row.id = candidateId;
  row.actorId = actor.id;
  row.sourceSceneId = sceneId;
  row.sourceZoneId = zoneId;
  row.targetActorId = targetActorId;
  row.signals = signals;
  row.factors = signals;
  row.hardGates = gates;
  row.feasible = gates.every((item) => typeof item === "boolean" ? item : item.passed !== false);
  row.responsibility = responsibility;
  row.speech = speech;
  row.toSceneId = toSceneId;
  row.toZoneId = toZoneId;
  row.movement = movement;
  row.context = clone(context);
  return row;
}

export function evaluateCausalSceneTurn({
  adapter: adapterInput = {},
  state = {},
  actorId = "",
  candidates = [],
  context = {},
} = {}) {
  const adapter = normalizedAdapter(adapterInput);
  const actor = (state.actors || []).find((row) => actorIdOf(row) === clean(actorId));
  if (!actor) {
    return {
      kernelVersion: CAUSAL_SCENE_KERNEL_VERSION,
      actorId: clean(actorId),
      selectedCandidateId: null,
      selectedCandidate: null,
      candidates: [],
      ranking: null,
      rejected: [{ code: "ACTOR_UNKNOWN", actorId: clean(actorId) }],
    };
  }
  const prepared = (candidates || []).map((candidate) => prepareCandidate({
    adapter,
    state,
    actor,
    candidate,
    context,
  }));
  const ranking = scoreActionCandidates({
    actor: scoringActor(actor),
    candidates: prepared,
    context: {
      ...clone(context),
      relationships: clone(state.relationships || []),
      recentActions: clone(context.recentActions || state.actions || []),
    },
  });
  const selectedCandidateId = clean(ranking.selectedCandidateId);
  const selectedCandidate = prepared.find((candidate) => candidate.id === selectedCandidateId) || null;
  const accepted = selectedCandidate?.feasible ? selectedCandidate : null;
  return {
    kernelVersion: CAUSAL_SCENE_KERNEL_VERSION,
    actorId: actor.id,
    selectedCandidateId: accepted?.id || null,
    selectedCandidate: accepted ? clone(accepted) : null,
    candidates: clone(prepared),
    ranking,
    rejected: prepared
      .filter((candidate) => !candidate.feasible)
      .map((candidate) => ({
        candidateId: candidate.id,
        failedGates: candidate.hardGates.filter((item) => item?.passed === false),
      })),
  };
}

function externalizeDelivery(adapter, delivery = {}) {
  const result = clone(delivery);
  for (const key of ["sourceZoneId", "targetZoneId", "recipientZoneId"]) {
    const pair = externalZone(adapter, result[key]);
    if (pair) result[key] = pair.zoneId;
  }
  result.route = (result.route || []).map((internalId) => (
    externalZone(adapter, internalId)?.zoneId || internalId
  ));
  result.recipientId = clean(result.recipientId || result.targetActorId || result.receiverActorId);
  return result;
}

function compileActionImpacts({ candidate, actionId, actor, nowSeconds = 0 }) {
  const declarations = impactDeclarations(candidate);
  if (declarations.length) {
    return declarations.map((impact, index) => ({
      ...clone(impact),
      id: clean(impact.id) || `${actionId}:impact:${index + 1}`,
      sourceActorId: clean(impact.sourceActorId || actor.id),
      sourceSceneId: clean(impact.sourceSceneId || impact.sceneId || candidate.sourceSceneId),
      sourceZoneId: clean(impact.sourceZoneId || impact.zoneId || candidate.sourceZoneId),
      createdAtSeconds: finite(impact.createdAtSeconds, nowSeconds),
    }));
  }
  if (!candidate.speech) return [];
  return [{
    id: `${actionId}:impact:speech`,
    sourceActorId: actor.id,
    sourceSceneId: candidate.sourceSceneId,
    sourceZoneId: candidate.sourceZoneId,
    directedTargetId: candidate.speech.targetActorId,
    modality: "sound",
    kind: "speech",
    content: candidate.speech.content,
    radius: candidate.speech.mode === "call_out" ? candidate.speech.radius : 0,
    allowBystanders: candidate.speech.allowBystanders === true,
    audience: candidate.speech.audience,
    intensity: Math.max(0.01, finite(candidate.speech.intensity, 1)),
    createdAtSeconds: nowSeconds,
  }];
}

function toSpatialImpact(adapter, impact = {}) {
  return {
    ...clone(impact),
    sourceZoneId: internalZoneId(adapter, impact.sourceSceneId, impact.sourceZoneId),
  };
}

function relationshipScale(current, delta, effect = {}) {
  if (Number.isFinite(Number(effect.minimum)) || Number.isFinite(Number(effect.maximum))) {
    return {
      minimum: finite(effect.minimum, -Infinity),
      maximum: finite(effect.maximum, Infinity),
    };
  }
  return Math.max(Math.abs(finite(current)), Math.abs(finite(delta))) > 1
    ? { minimum: -100, maximum: 100 }
    : { minimum: -1, maximum: 1 };
}

function applyRelationshipEffects(relationships, effects, deliveries) {
  const next = normalizeRelationships(relationships);
  const applied = [];
  const rejected = [];
  for (const raw of effects || []) {
    const effect = clone(raw || {});
    const receiverActorId = clean(
      effect.receiverActorId
        || effect.recipientActorId
        || effect.observerActorId
        || effect.requiredDeliveryTargetActorId,
    );
    const matchingDeliveries = (deliveries || []).filter((delivery) => (
      clean(delivery.targetActorId || delivery.receiverActorId || delivery.recipientId) === receiverActorId
      && (!effect.impactId || clean(delivery.impactId) === clean(effect.impactId))
    ));
    if (!receiverActorId || !matchingDeliveries.length) {
      rejected.push({
        ...effect,
        code: receiverActorId ? "RELATIONSHIP_EFFECT_NOT_RECEIVED" : "RELATIONSHIP_EFFECT_RECEIVER_REQUIRED",
      });
      continue;
    }
    const fromActorId = clean(effect.fromActorId || effect.sourceActorId);
    const toActorId = clean(effect.toActorId || effect.targetActorId);
    if (!fromActorId || !toActorId) {
      rejected.push({ ...effect, code: "RELATIONSHIP_EFFECT_DIRECTION_REQUIRED" });
      continue;
    }
    let relationship = next.find((row) => row.fromActorId === fromActorId && row.toActorId === toActorId);
    if (!relationship) {
      relationship = {
        id: clean(effect.relationshipId) || `relationship:${fromActorId}:${toActorId}`,
        fromActorId,
        toActorId,
      };
      next.push(relationship);
    }
    const changes = {};
    for (const [field, value] of Object.entries(effect.deltas || {})) {
      if (!Number.isFinite(Number(value))) continue;
      const before = finite(relationship[field]);
      const scale = relationshipScale(before, value, effect);
      const unclamped = before + Number(value);
      const after = Math.round(
        Math.max(scale.minimum, Math.min(scale.maximum, unclamped)) * 1_000_000,
      ) / 1_000_000;
      relationship[field] = after;
      changes[field] = { before, delta: Number(value), after };
    }
    applied.push({
      relationshipId: relationship.id,
      fromActorId,
      toActorId,
      receiverActorId,
      deliveryIds: matchingDeliveries.map((delivery) => delivery.id),
      changes,
    });
  }
  return { relationships: next, applied, rejected };
}

function desireRows(actor = {}) {
  return Array.isArray(actor.agency?.desires) ? actor.agency.desires : [];
}

function applyDesireEffects(actors, action) {
  const next = (actors || []).map(normalizeActor);
  const effects = [];
  for (const actor of next) {
    const desires = desireRows(actor).map((desire) => ({
      ...clone(desire),
      ownerCharacterId: clean(desire.ownerActorId || desire.ownerCharacterId || actor.id),
    }));
    const actorEffects = deriveDesireSatisfactionEffects({
      desires,
      action,
      ownerActorId: actor.id,
    });
    if (!actorEffects.length) continue;
    const byDrive = new Map(actorEffects.map((effect) => [clean(effect.driveId), effect]));
    actor.agency.desires = desireRows(actor).map((desire) => {
      const effect = byDrive.get(clean(desire.id));
      return effect
        ? {
          ...clone(desire),
          status: "satisfied",
          satisfied: true,
          satisfaction: clone(effect.satisfactionEvidence),
          satisfiedByActionId: action.id,
        }
        : clone(desire);
    });
    effects.push(...actorEffects.map((effect) => ({ ...effect, ownerActorId: actor.id })));
  }
  return { actors: next, effects };
}

function markPendingImpactHandled(pendingImpacts, impactId, actionId, actorId) {
  if (!impactId) return clone(pendingImpacts || []);
  return (pendingImpacts || []).map((impact) => clean(impact.id) === impactId
    ? {
      ...clone(impact),
      status: "handled",
      handledByActionIds: unique([...(impact.handledByActionIds || []), actionId]),
      handledByActorIds: unique([...(impact.handledByActorIds || []), actorId]),
    }
    : clone(impact));
}

export function commitCausalSceneAction({
  adapter: adapterInput = {},
  state = {},
  evaluation = {},
} = {}) {
  const adapter = normalizedAdapter(adapterInput);
  const candidate = evaluation.selectedCandidate;
  if (!candidate || !candidate.feasible) {
    return {
      committed: false,
      state: clone(state),
      action: null,
      rejected: [{ code: "NO_FEASIBLE_SELECTED_ACTION" }],
    };
  }
  const next = createCausalSceneState(state);
  const actor = next.actors.find((row) => row.id === evaluation.actorId);
  if (!actor) {
    return {
      committed: false,
      state: clone(state),
      action: null,
      rejected: [{ code: "ACTOR_UNKNOWN", actorId: evaluation.actorId }],
    };
  }
  const actionId = clean(candidate.actionId)
    || `${candidate.id}:action:${next.nextActionSequence}`;

  if ((candidate.objectOperations || []).length) {
    const spatialLedger = toSpatialLedger(adapter, next.objectLedger, next.actors);
    const operations = toSpatialOperations(adapter, candidate.objectOperations, next.actors);
    const result = applyObjectOperations({
      ledger: spatialLedger,
      operations,
      actors: toSpatialActors(adapter, next.actors),
      topology: adapter.spatialTopology,
    });
    if (!result.ok) {
      return {
        committed: false,
        state: clone(state),
        action: null,
        rejected: result.violations,
      };
    }
    next.objectLedger = fromSpatialLedger(adapter, result.ledger);
  }

  if (candidate.movement) {
    actor.sceneId = candidate.toSceneId;
    actor.zoneId = candidate.toZoneId;
    next.objectLedger = relocateHeldObjects({
      ledger: next.objectLedger,
      actorId: actor.id,
      sceneId: actor.sceneId,
      zoneId: actor.zoneId,
    });
  }

  const impactDeclarationsForAction = compileActionImpacts({
    candidate,
    actionId,
    actor,
    nowSeconds: next.nowSeconds,
  });
  const deliveries = [];
  const observations = [];
  const propagationRejected = [];
  for (const impact of impactDeclarationsForAction) {
    const propagation = propagateImpact({
      impact: toSpatialImpact(adapter, impact),
      actors: toSpatialActors(adapter, next.actors),
      topology: adapter.spatialTopology,
      relationships: next.relationships,
      observations: (next.observations || []).map((observation) => ({
        ...clone(observation),
        sourceZoneId: internalZoneId(adapter, observation.sourceSceneId || observation.sceneId, observation.sourceZoneId),
        targetZoneId: internalZoneId(adapter, observation.sceneId, observation.targetZoneId),
      })),
    });
    deliveries.push(...(propagation.deliveries || []).map((delivery) => externalizeDelivery(adapter, delivery)));
    observations.push(...(propagation.observations || []).map((delivery) => externalizeDelivery(adapter, delivery)));
    propagationRejected.push(...(propagation.rejected || []));
  }

  const relationshipResult = applyRelationshipEffects(
    next.relationships,
    candidate.relationshipEffects || [],
    deliveries,
  );
  next.relationships = relationshipResult.relationships;

  const action = {
    id: actionId,
    candidateId: candidate.id,
    actorId: actor.id,
    targetActorId: candidate.targetActorId,
    targetCharacterId: candidate.targetActorId,
    sourceSceneId: candidate.sourceSceneId,
    sourceZoneId: candidate.sourceZoneId,
    resultingSceneId: actor.sceneId,
    resultingZoneId: actor.zoneId,
    actionKind: clean(candidate.actionKind || candidate.kind),
    speech: candidate.speech?.content || "",
    vocalMode: candidate.speech?.mode || "",
    committed: true,
    createdAtSeconds: next.nowSeconds,
    impacts: clone(impactDeclarationsForAction),
    deliveries: clone(deliveries),
    relationshipEffects: clone(relationshipResult.applied),
    rejectedRelationshipEffects: clone(relationshipResult.rejected),
    satisfactionEvidence: clone(candidate.satisfactionEvidence || {}),
    decisionValue: candidate.decisionValue,
    decisionTopicId: candidate.decisionTopicId,
    responsibility: clone(candidate.responsibility),
    propagationRejected: clone(propagationRejected),
  };
  const desireResult = applyDesireEffects(next.actors, action);
  next.actors = desireResult.actors;
  action.desireSatisfactionEffects = clone(desireResult.effects);

  next.pendingImpacts = markPendingImpactHandled(
    next.pendingImpacts,
    candidate.responsibility?.observed ? candidate.responsibility.impactId : "",
    actionId,
    actor.id,
  );
  for (const impact of impactDeclarationsForAction) {
    const impactDeliveries = deliveries.filter((delivery) => clean(delivery.impactId) === clean(impact.id));
    if (!impactDeliveries.length) continue;
    next.pendingImpacts.push({
      ...clone(impact),
      status: "pending",
      receivedByActorIds: unique(impactDeliveries.map((delivery) => delivery.targetActorId)),
      deliveries: clone(impactDeliveries),
      sourceActionId: actionId,
    });
  }
  next.impacts.push(...impactDeclarationsForAction);
  next.observations.push(...observations);
  next.actions.push(action);
  next.nextActionSequence += 1;
  return {
    committed: true,
    state: next,
    action,
    deliveries,
    observations,
    relationshipEffects: relationshipResult,
    desireSatisfactionEffects: desireResult.effects,
    rejected: propagationRejected,
  };
}

export function runCausalSceneTurn(input = {}) {
  const evaluation = evaluateCausalSceneTurn(input);
  const commitment = commitCausalSceneAction({
    adapter: input.adapter,
    state: input.state,
    evaluation,
  });
  return {
    ...commitment,
    evaluation,
  };
}
