/**
 * Generic place movement projection and settlement.
 *
 * A place supplies geometry and material barriers. Social boundaries are
 * objective claims that a Character Agent may know, misread, ignore or
 * violate; they never remove a physically attemptable destination. Access
 * grants satisfy a social claim but cannot open a locked physical route.
 */

export const PLACE_MOVEMENT_BOUNDARY_VERSION = "place-movement-boundary-v1";

function clean(value = "") {
  return String(value ?? "").trim();
}

function unique(values = []) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function zoneMap(topology = {}) {
  if (Array.isArray(topology.zones)) {
    return Object.fromEntries(topology.zones.filter((zone) => clean(zone?.id)).map((zone) => [clean(zone.id), zone]));
  }
  return topology.zones && typeof topology.zones === "object" ? topology.zones : {};
}

function movementEdgesFrom(topology = {}, fromZoneId = "") {
  const origin = clean(fromZoneId);
  return (topology.edges || []).flatMap((edge) => {
    const movementCost = Number(edge?.move);
    if (!Number.isFinite(movementCost)) return [];
    if (clean(edge.from) === origin) return [{ edge, destinationId: clean(edge.to), movementCost }];
    if (clean(edge.to) === origin) return [{ edge, destinationId: clean(edge.from), movementCost }];
    return [];
  });
}

function physicalBarrier(edge = {}, destination = {}) {
  const authored = edge.movementBarrier ?? edge.barrier ?? null;
  if (!authored && edge.movementBlocked !== true && edge.passable !== false) return null;
  if (authored && typeof authored === "object") {
    const kind = clean(authored.kind || authored.type || "physical-barrier");
    const preventsPassage = authored.preventsPassage !== false;
    return {
      kind,
      state: clean(authored.state || (preventsPassage ? "closed" : "open")),
      preventsPassage,
      evidenceIds: unique(authored.evidenceIds || []),
    };
  }
  const kind = clean(authored || (destination.closed === true ? "closed-boundary" : "physical-barrier"));
  return {
    kind,
    state: "closed",
    preventsPassage: true,
    evidenceIds: unique(edge.barrierEvidenceIds || []),
  };
}

function matchingSocialBoundaries(socialBoundaries = [], zoneId = "", actorId = "") {
  const destination = clean(zoneId);
  const actor = clean(actorId);
  return (socialBoundaries || []).filter((boundary) => (
    boundary?.permissionRequiredByNorm !== false
    && unique(boundary?.zoneIds || []).includes(destination)
    && !unique([...(boundary?.exemptActorIds || []), ...(boundary?.authorizedActorIds || [])]).includes(actor)
  ));
}

function grantIsActiveFor(grant = {}, { actorId = "", zoneId = "", step = 0 } = {}) {
  const currentStep = Math.max(0, Number(step) || 0);
  const issuedAtStep = Math.max(0, Number(grant?.issuedAtStep) || 0);
  const rawExpiresAtStep = Number(grant?.expiresAtStep);
  const expiresAtStep = Number.isFinite(rawExpiresAtStep) ? Math.max(issuedAtStep, rawExpiresAtStep) : Infinity;
  return grant?.status !== "inactive"
    && grant?.status !== "revoked"
    && unique(grant?.beneficiaryIds || []).includes(clean(actorId))
    && unique(grant?.zoneIds || []).includes(clean(zoneId))
    && currentStep >= issuedAtStep
    && currentStep <= expiresAtStep;
}

function socialAccessFor({
  actorId = "",
  zoneId = "",
  socialBoundaries = [],
  accessGrants = [],
  step = 0,
  targetEffectCurrentlyPossible = false,
} = {}) {
  const boundaries = matchingSocialBoundaries(socialBoundaries, zoneId, actorId);
  const permissionRequiredByNorm = boundaries.length > 0;
  const matchingGrantIds = (accessGrants || [])
    .filter((grant) => grantIsActiveFor(grant, { actorId, zoneId, step }))
    .map((grant) => clean(grant.grantId || grant.id))
    .filter(Boolean);
  const permissionCurrentlyGranted = !permissionRequiredByNorm || matchingGrantIds.length > 0;
  return {
    permissionRequiredByNorm,
    permissionCurrentlyGranted,
    violationPhysicallyPossible: permissionRequiredByNorm
      && !permissionCurrentlyGranted
      && targetEffectCurrentlyPossible,
    boundaryIds: boundaries.map((boundary) => clean(boundary.id)).filter(Boolean),
    evidenceIds: unique(boundaries.flatMap((boundary) => boundary.evidenceIds || [])),
    claimantIds: unique(boundaries.flatMap((boundary) => boundary.claimantIds || [])),
    possibleResponseTags: unique(boundaries.flatMap((boundary) => boundary.possibleResponseTags || [])),
    matchingGrantIds,
    interpretationAuthority: "character-agent",
  };
}

export function projectAdjacentMovementOptions({
  topology = {},
  fromZoneId = "",
  actorId = "",
  socialBoundaries = [],
  accessGrants = [],
  step = 0,
} = {}) {
  const zones = zoneMap(topology);
  const originId = clean(fromZoneId);
  const origin = zones[originId];
  if (!origin) return [];
  const options = [{
    id: originId,
    label: clean(origin.label || originId),
    closed: Boolean(origin.closed),
    physicalAccess: {
      relation: "current",
      movementCost: 0,
      physicallyAttemptable: false,
      targetEffectCurrentlyPossible: true,
      barrier: null,
    },
    socialAccess: socialAccessFor({
      actorId,
      zoneId: originId,
      socialBoundaries,
      accessGrants,
      step,
      targetEffectCurrentlyPossible: true,
    }),
  }];
  const seen = new Set([originId]);
  for (const { edge, destinationId, movementCost } of movementEdgesFrom(topology, originId)) {
    if (!destinationId || seen.has(destinationId) || !zones[destinationId]) continue;
    seen.add(destinationId);
    const destination = zones[destinationId];
    const barrier = physicalBarrier(edge, destination);
    const targetEffectCurrentlyPossible = !barrier?.preventsPassage;
    options.push({
      id: destinationId,
      label: clean(destination.label || destinationId),
      closed: Boolean(destination.closed),
      physicalAccess: {
        relation: "adjacent",
        movementCost,
        physicallyAttemptable: true,
        targetEffectCurrentlyPossible,
        barrier,
      },
      socialAccess: socialAccessFor({
        actorId,
        zoneId: destinationId,
        socialBoundaries,
        accessGrants,
        step,
        targetEffectCurrentlyPossible,
      }),
    });
  }
  return options;
}

export function resolvePlaceMovementAttempt({
  topology = {},
  actorId = "",
  fromZoneId = "",
  toZoneId = "",
  socialBoundaries = [],
  accessGrants = [],
  step = 0,
} = {}) {
  const originId = clean(fromZoneId);
  const destinationId = clean(toZoneId);
  const result = {
    schemaVersion: PLACE_MOVEMENT_BOUNDARY_VERSION,
    authority: "world-causal-resolution",
    status: "failed",
    actorId: clean(actorId),
    fromZoneId: originId,
    toZoneId: destinationId,
    movementCommitted: false,
    committedFacts: [{
      kind: "movement_attempted",
      actorId: clean(actorId),
      fromZoneId: originId,
      toZoneId: destinationId,
    }],
    failureCodes: [],
    physicalBarrier: null,
    crossedSocialBoundaryIds: [],
    possibleSocialResponseTags: [],
  };
  const zones = zoneMap(topology);
  if (!originId || !zones[originId] || !destinationId || !zones[destinationId]) {
    result.failureCodes.push("MOVEMENT_ZONE_UNKNOWN");
    return result;
  }
  if (originId === destinationId) {
    result.failureCodes.push("MOVEMENT_DESTINATION_IS_CURRENT_ZONE");
    return result;
  }
  const adjacent = movementEdgesFrom(topology, originId).find((row) => row.destinationId === destinationId);
  if (!adjacent) {
    result.failureCodes.push("MOVEMENT_DESTINATION_NOT_ADJACENT");
    return result;
  }
  const barrier = physicalBarrier(adjacent.edge, zones[destinationId]);
  if (barrier?.preventsPassage) {
    result.failureCodes.push("MOVEMENT_BLOCKED_BY_PHYSICAL_BARRIER");
    result.physicalBarrier = clone(barrier);
    result.committedFacts.push({
      kind: "movement_blocked_by_barrier",
      actorId: clean(actorId),
      fromZoneId: originId,
      toZoneId: destinationId,
      barrier: clone(barrier),
    });
    return result;
  }
  result.status = "success";
  result.movementCommitted = true;
  result.committedFacts.push({
    kind: "actor_movement",
    actorId: clean(actorId),
    fromZoneId: originId,
    toZoneId: destinationId,
  });
  const socialAccess = socialAccessFor({
    actorId,
    zoneId: destinationId,
    socialBoundaries,
    accessGrants,
    step,
    targetEffectCurrentlyPossible: true,
  });
  if (socialAccess.permissionRequiredByNorm && !socialAccess.permissionCurrentlyGranted) {
    result.crossedSocialBoundaryIds = [...socialAccess.boundaryIds];
    result.possibleSocialResponseTags = [...socialAccess.possibleResponseTags];
    result.committedFacts.push({
      kind: "social_boundary_crossed_without_permission",
      actorId: clean(actorId),
      fromZoneId: originId,
      toZoneId: destinationId,
      boundaryIds: [...socialAccess.boundaryIds],
      claimantIds: [...socialAccess.claimantIds],
      evidenceIds: [...socialAccess.evidenceIds],
    });
  }
  return result;
}
