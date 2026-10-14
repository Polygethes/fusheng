const FORMULA_VERSION = "generic-event-propagation-v1";

function clean(value = "") {
  return String(value ?? "").trim();
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, finiteNumber(value, minimum)));
}

function actorId(actor = {}) {
  return clean(actor.actorId || actor.id || actor.characterId);
}

function observationTargetId(observation = {}) {
  return clean(
    observation.targetActorId
      || observation.receiverActorId
      || observation.observerActorId
      || observation.recipientId
      || observation.actorId,
  );
}

function sourceActorId(impact = {}) {
  return clean(impact.sourceActorId || impact.sourceCharacterId || impact.actorId);
}

function directedTargetId(impact = {}) {
  return clean(
    impact.directedTargetId
      || impact.targetActorId
      || impact.recipientActorId
      || impact.receiverActorId,
  );
}

function canonicalModality(value = "") {
  const modality = clean(value).toLowerCase();
  if (["speech", "voice", "hearing", "auditory", "audio"].includes(modality)) return "sound";
  if (["sight", "visible", "vision"].includes(modality)) return "visual";
  if (["contact", "physical_contact"].includes(modality)) return "touch";
  if (["odor", "scent"].includes(modality)) return "smell";
  return modality || "visual";
}

function normalizedZones(topology = {}) {
  const source = topology.zones || [];
  const rows = Array.isArray(source)
    ? source
    : Object.entries(source).map(([id, zone]) => ({ id, ...(zone || {}) }));
  return new Map(rows
    .map((zone) => [clean(zone.id || zone.zoneId), zone])
    .filter(([id]) => id));
}

function zoneSceneId(zones, zoneId = "") {
  const zone = zones.get(clean(zoneId));
  return clean(zone?.sceneId || zone?.locationId || zone?.scene?.id);
}

function resolvedActorSceneId(actor = {}, zones = new Map()) {
  return clean(actor.sceneId || actor.locationId) || zoneSceneId(zones, actor.zoneId);
}

function normalizedEdges(topology = {}) {
  const source = topology.edges || [];
  return Array.isArray(source) ? source : Object.values(source);
}

function edgeEndpoints(edge = {}) {
  return {
    fromZoneId: clean(edge.fromZoneId || edge.from || edge.sourceZoneId),
    toZoneId: clean(edge.toZoneId || edge.to || edge.targetZoneId),
  };
}

function edgeModes(edge = {}) {
  const modes = Array.isArray(edge.modes)
    ? edge.modes
    : Array.isArray(edge.modalities)
      ? edge.modalities
      : [];
  return new Set(modes.map(canonicalModality));
}

function barrierRows(edge = {}, topology = {}) {
  const inline = Array.isArray(edge.barriers)
    ? edge.barriers
    : edge.barrier && typeof edge.barrier === "object"
      ? [edge.barrier]
      : [];
  const { fromZoneId, toZoneId } = edgeEndpoints(edge);
  const globalRows = Array.isArray(topology.barriers)
    ? topology.barriers
    : Object.values(topology.barriers || {});
  return [
    ...inline,
    ...globalRows.filter((barrier) => {
      const barrierFrom = clean(barrier.fromZoneId || barrier.from);
      const barrierTo = clean(barrier.toZoneId || barrier.to);
      return (barrierFrom === fromZoneId && barrierTo === toZoneId)
        || (barrier.bidirectional !== false && barrierFrom === toZoneId && barrierTo === fromZoneId);
    }),
  ];
}

function barrierBlocks(barrier = {}, modality = "") {
  if (barrier.open === true || barrier.active === false) return false;
  const modes = new Set([
    ...(barrier.blockedModes || []),
    ...(barrier.blocks || []),
    ...(barrier.modalities || []),
  ].map(canonicalModality));
  if (modes.size) return modes.has(modality);
  return barrier.blocked === true || barrier.open === false || barrier.passable === false;
}

function edgeWeight(edge = {}, modality = "", topology = {}) {
  if (edge.blocked === true || edge.open === false || edge.passable === false) return Infinity;
  if ((edge.blockedModes || []).map(canonicalModality).includes(modality)) return Infinity;
  if (barrierRows(edge, topology).some((barrier) => barrierBlocks(barrier, modality))) return Infinity;

  const modes = edgeModes(edge);
  if (modes.size && !modes.has(modality)) return Infinity;
  const modalityWeight = Number(edge[modality]);
  if (Object.hasOwn(edge, modality)) {
    if (!Number.isFinite(modalityWeight)) return Infinity;
    return Math.max(0, modalityWeight);
  }
  if (!modes.size && ["touch", "object", "internal", "memory"].includes(modality)) return Infinity;
  const distance = Number(edge.distance ?? edge.weight ?? 1);
  return Number.isFinite(distance) ? Math.max(0, distance) : Infinity;
}

function adjacentEdges(topology, zones, zoneId, modality, sceneId) {
  const rows = [];
  for (const edge of normalizedEdges(topology)) {
    const { fromZoneId, toZoneId } = edgeEndpoints(edge);
    if (!fromZoneId || !toZoneId) continue;
    const weight = edgeWeight(edge, modality, topology);
    if (!Number.isFinite(weight)) continue;
    const forward = fromZoneId === zoneId;
    const reverse = toZoneId === zoneId && edge.bidirectional !== false;
    if (!forward && !reverse) continue;
    const nextZoneId = forward ? toZoneId : fromZoneId;
    const nextSceneId = zoneSceneId(zones, nextZoneId);
    if (sceneId && nextSceneId && nextSceneId !== sceneId) continue;
    rows.push({
      zoneId: nextZoneId,
      weight,
      barrierIds: barrierRows(edge, topology)
        .map((barrier) => clean(barrier.id || barrier.label || barrier.name))
        .filter(Boolean),
    });
  }
  return rows.sort((left, right) => (
    left.weight - right.weight || left.zoneId.localeCompare(right.zoneId)
  ));
}

function spatialRoute(topology, zones, fromZoneId, toZoneId, modality, sceneId) {
  if (!fromZoneId || !toZoneId || !zones.has(fromZoneId) || !zones.has(toZoneId)) return null;
  if (zoneSceneId(zones, fromZoneId) && sceneId && zoneSceneId(zones, fromZoneId) !== sceneId) return null;
  if (zoneSceneId(zones, toZoneId) && sceneId && zoneSceneId(zones, toZoneId) !== sceneId) return null;
  if (fromZoneId === toZoneId) return { distance: 0, zones: [fromZoneId], barriers: [] };
  if (["touch", "object", "internal", "memory"].includes(modality)) return null;

  const frontier = [{ zoneId: fromZoneId, distance: 0, zones: [fromZoneId], barriers: [] }];
  const best = new Map([[fromZoneId, 0]]);
  while (frontier.length) {
    frontier.sort((left, right) => (
      left.distance - right.distance || left.zoneId.localeCompare(right.zoneId)
    ));
    const current = frontier.shift();
    if (current.zoneId === toZoneId) return current;
    if (current.distance > (best.get(current.zoneId) ?? Infinity)) continue;
    for (const next of adjacentEdges(topology, zones, current.zoneId, modality, sceneId)) {
      const distance = current.distance + next.weight;
      if (distance >= (best.get(next.zoneId) ?? Infinity)) continue;
      best.set(next.zoneId, distance);
      frontier.push({
        zoneId: next.zoneId,
        distance,
        zones: [...current.zones, next.zoneId],
        barriers: [...current.barriers, ...next.barrierIds],
      });
    }
  }
  return null;
}

function normalizeReliability(value, fallback = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return clamp(fallback);
  return number > 1 ? clamp(number / 100) : clamp(number);
}

function impactReferenceIds(observation = {}) {
  return new Set([
    observation.impactId,
    observation.sourceImpactId,
    observation.rootImpactId,
    observation.provenance?.sourceImpactId,
    observation.provenance?.rootImpactId,
    observation.provenance?.relayImpactId,
  ].map(clean).filter(Boolean));
}

function normalizeChain(values = []) {
  const result = [];
  for (const value of values || []) {
    const id = clean(value);
    if (id && result[result.length - 1] !== id) result.push(id);
  }
  return result;
}

function establishProvenance(impact, observations, sourceId) {
  const provided = impact.provenance || {};
  const isRumor = clean(impact.kind).toLowerCase() === "rumor"
    || clean(provided.kind).toLowerCase() === "rumor";
  if (!isRumor) {
    const rootImpactId = clean(provided.rootImpactId || impact.rootImpactId || impact.id);
    return {
      ok: true,
      isRumor: false,
      sourceImpactId: clean(provided.sourceImpactId || impact.id),
      rootImpactId,
      chain: normalizeChain(provided.chain || [sourceId]),
      reliability: normalizeReliability(provided.reliability ?? impact.reliability, 1),
      provenance: {
        ...provided,
        kind: clean(provided.kind) || "direct_observation",
        sourceImpactId: clean(provided.sourceImpactId || impact.id),
        rootImpactId,
        chain: normalizeChain(provided.chain || [sourceId]),
        reliability: normalizeReliability(provided.reliability ?? impact.reliability, 1),
      },
    };
  }

  const referencedImpactId = clean(provided.sourceImpactId || impact.sourceImpactId);
  const requestedRootId = clean(provided.rootImpactId || impact.rootImpactId || referencedImpactId);
  if (!clean(impact.id) || clean(impact.id) === referencedImpactId) {
    return { ok: false, code: "RUMOR_MUST_BE_NEW_IMPACT", referencedImpactId };
  }
  const priorObservation = (observations || []).find((observation) => {
    if (observationTargetId(observation) !== sourceId) return false;
    const references = impactReferenceIds(observation);
    return references.has(referencedImpactId) || (requestedRootId && references.has(requestedRootId));
  });
  if (!priorObservation) {
    return {
      ok: false,
      code: "RUMOR_SOURCE_HAS_NO_PRIOR_OBSERVATION",
      referencedImpactId,
      sourceActorId: sourceId,
    };
  }
  const priorProvenance = priorObservation.provenance || {};
  const rootImpactId = clean(
    provided.rootImpactId
      || priorObservation.rootImpactId
      || priorProvenance.rootImpactId
      || referencedImpactId,
  );
  const priorChain = priorObservation.provenanceChain || priorProvenance.chain || [];
  const chain = normalizeChain([
    ...priorChain,
    ...(provided.chain || []),
    sourceId,
  ]);
  const priorReliability = normalizeReliability(
    priorObservation.reliability ?? priorProvenance.reliability,
    1,
  );
  const reliability = normalizeReliability(
    provided.reliability ?? impact.reliability,
    priorReliability * 0.85,
  );
  return {
    ok: true,
    isRumor: true,
    sourceImpactId: referencedImpactId,
    rootImpactId,
    chain,
    reliability,
    provenance: {
      ...provided,
      kind: "rumor",
      relayImpactId: clean(impact.id),
      sourceImpactId: referencedImpactId,
      rootImpactId,
      chain,
      reliability,
    },
  };
}

function relationshipBetween(relationships = [], observerId = "", sourceId = "") {
  const rows = Array.isArray(relationships) ? relationships : Object.values(relationships || {});
  return rows.find((relationship) => {
    const from = clean(relationship.fromActorId || relationship.fromCharacterId || relationship.sourceActorId);
    const to = clean(relationship.toActorId || relationship.toCharacterId || relationship.targetActorId);
    return from === observerId && to === sourceId;
  }) || null;
}

function relationshipRelevance(relationship = {}) {
  if (!relationship) return 0;
  const normalizedRelationshipValue = (value) => {
    const numeric = Math.abs(finiteNumber(value));
    return clamp(numeric > 1 && numeric <= 100 ? numeric / 100 : numeric);
  };
  const salience = Math.max(
    normalizedRelationshipValue(relationship.closeness),
    normalizedRelationshipValue(relationship.trust),
    normalizedRelationshipValue(relationship.care),
    normalizedRelationshipValue(relationship.conflict),
    normalizedRelationshipValue(relationship.dependence),
    normalizedRelationshipValue(relationship.resentment),
  );
  return salience * 0.2;
}

function attenuationFor(modality, distance, radius, impact = {}) {
  const defaultDecay = {
    sound: 0.75,
    visual: 0.68,
    smell: 0.6,
    touch: 1,
    object: 1,
  }[modality] ?? 0.7;
  const decayPerUnit = clamp(impact.decayPerUnit ?? defaultDecay, 0, 1);
  const distanceDecay = Math.pow(decayPerUnit, Math.max(0, distance));
  const radiusBoundary = Number.isFinite(radius) && radius > 0
    ? clamp(1 - Math.max(0, distance - 0.000001) / (radius + 1))
    : 1;
  return clamp(distanceDecay * radiusBoundary);
}

/**
 * Pure, deterministic propagation of one already-created impact.
 *
 * Physical reach never crosses scene boundaries. A fact can appear in another
 * scene only when an actor who owns a prior observation creates a new rumor
 * impact there; this function validates that provenance before routing it.
 */
export function propagateImpact({
  impact = {},
  actors = [],
  topology = {},
  relationships = [],
  observations = [],
} = {}) {
  const zones = normalizedZones(topology);
  const sourceId = sourceActorId(impact);
  const impactId = clean(impact.id);
  const sourceZoneId = clean(impact.sourceZoneId || impact.zoneId);
  const sourceActor = (actors || []).find((candidate) => actorId(candidate) === sourceId) || null;
  const sourceSceneId = clean(impact.sourceSceneId || impact.sceneId || impact.locationId)
    || resolvedActorSceneId(sourceActor || {}, zones)
    || zoneSceneId(zones, sourceZoneId);
  const modality = canonicalModality(impact.modality);
  const targetId = directedTargetId(impact);
  const radiusNumber = Number(impact.radius);
  const radius = Number.isFinite(radiusNumber) ? Math.max(0, radiusNumber) : Infinity;
  const provenance = establishProvenance(impact, observations, sourceId);

  if (!impactId || !sourceId || !sourceZoneId || !sourceSceneId) {
    return {
      formulaVersion: FORMULA_VERSION,
      deliveries: [],
      observations: [],
      rejected: [{
        code: "IMPACT_SOURCE_INCOMPLETE",
        impactId,
        sourceActorId: sourceId,
        sourceSceneId,
        sourceZoneId,
      }],
    };
  }
  if (!provenance.ok) {
    return {
      formulaVersion: FORMULA_VERSION,
      deliveries: [],
      observations: [],
      rejected: [provenance],
    };
  }
  if (sourceActor && sourceActor.present === false) {
    return {
      formulaVersion: FORMULA_VERSION,
      deliveries: [],
      observations: [],
      rejected: [{ code: "IMPACT_SOURCE_NOT_PRESENT", sourceActorId: sourceId }],
    };
  }
  const sourceZoneSceneId = zoneSceneId(zones, sourceZoneId);
  if (sourceZoneSceneId && sourceZoneSceneId !== sourceSceneId) {
    return {
      formulaVersion: FORMULA_VERSION,
      deliveries: [],
      observations: [],
      rejected: [{
        code: "IMPACT_SOURCE_SCENE_ZONE_MISMATCH",
        sourceSceneId,
        sourceZoneId,
        zoneSceneId: sourceZoneSceneId,
      }],
    };
  }

  const intensity = Math.max(0, finiteNumber(impact.intensity, 0));
  const minimumIntensity = Number.isFinite(Number(impact.minimumIntensity))
    ? Math.max(0, Number(impact.minimumIntensity))
    : intensity <= 1
      ? 0.01
      : 1;
  const targetOnly = Boolean(targetId) && !(
    impact.allowBystanders === true
    || impact.allowOverhear === true
    || impact.audience === "public"
  );

  const deliveries = [];
  for (const recipient of [...(actors || [])].sort((left, right) => actorId(left).localeCompare(actorId(right)))) {
    const recipientId = actorId(recipient);
    if (!recipientId || recipientId === sourceId || recipient.present === false) continue;
    if (targetOnly && recipientId !== targetId) continue;
    const recipientSceneId = resolvedActorSceneId(recipient, zones);
    if (!recipientSceneId || recipientSceneId !== sourceSceneId) continue;
    const recipientZoneId = clean(recipient.zoneId);
    const route = spatialRoute(
      topology,
      zones,
      sourceZoneId,
      recipientZoneId,
      modality,
      sourceSceneId,
    );
    if (!route || route.distance > radius) continue;
    const attenuation = attenuationFor(modality, route.distance, radius, impact);
    const receivedIntensity = intensity * attenuation;
    if (receivedIntensity < minimumIntensity) continue;
    const relationship = relationshipBetween(relationships, recipientId, sourceId);
    const relationshipSalience = relationshipRelevance(relationship);
    const directed = Boolean(targetId && recipientId === targetId);
    const deliveryReliability = clamp(
      provenance.reliability * (0.9 + attenuation * 0.1),
    );
    const delivery = {
      id: `${impactId}:delivery:${recipientId}`,
      impactId,
      sourceImpactId: provenance.sourceImpactId,
      rootImpactId: provenance.rootImpactId,
      relayImpactId: provenance.isRumor ? impactId : "",
      sourceActorId: sourceId,
      sourceCharacterId: sourceId,
      targetActorId: recipientId,
      receiverActorId: recipientId,
      observerActorId: recipientId,
      sourceSceneId,
      sceneId: sourceSceneId,
      sourceZoneId,
      targetZoneId: recipientZoneId,
      recipientZoneId,
      kind: provenance.isRumor ? "rumor" : clean(impact.kind || "direct_event"),
      impactKind: provenance.isRumor ? "rumor" : clean(impact.kind || "direct_event"),
      modality,
      originalModality: clean(impact.modality),
      content: impact.content,
      topic: impact.topic,
      directed,
      distance: route.distance,
      route: [...route.zones],
      barriers: [...route.barriers],
      attenuation,
      sourceIntensity: intensity,
      receivedIntensity,
      relationshipSalience,
      impactScore: receivedIntensity * (1 + relationshipSalience) + (directed ? intensity * 0.08 : 0),
      reliability: deliveryReliability,
      createdAtSeconds: finiteNumber(impact.createdAtSeconds, 0),
      provenance: { ...provenance.provenance },
      provenanceChain: [...provenance.chain],
      deliveryMode: provenance.isRumor ? "rumor_relay" : "direct_spatial",
    };
    deliveries.push(delivery);
  }

  deliveries.sort((left, right) => (
    right.impactScore - left.impactScore
      || left.distance - right.distance
      || left.targetActorId.localeCompare(right.targetActorId)
  ));
  return {
    formulaVersion: FORMULA_VERSION,
    impactId,
    sourceSceneId,
    modality,
    provenance: { ...provenance.provenance },
    deliveries,
    observations: deliveries,
    rejected: [],
  };
}
