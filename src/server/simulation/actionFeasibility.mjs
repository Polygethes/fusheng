/**
 * Recipient-specific action feasibility.
 *
 * The world owns physical state, but this surface is built only from facts the
 * recipient can currently perceive. It does not select an action, guarantee a
 * result, or expose hidden world state. A Character Agent may follow, question,
 * or deliberately act against this estimate; the world always revalidates the
 * submitted attempt against the latest state.
 */

export const ACTION_FEASIBILITY_SURFACE_VERSION = "recipient-action-feasibility-v2";

function clean(value = "") {
  return String(value ?? "").trim();
}

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function physicalRouteTo(reachableZones = [], destinationId = "") {
  const target = clean(destinationId);
  return (reachableZones || []).find((row) => (
    clean(row?.id || row?.zoneId) === target
    && row?.physicalAccess?.physicallyAttemptable !== false
  )) || null;
}

function routeDirectAttempt(route = {}) {
  const physical = route?.physicalAccess || {};
  const attemptable = physical.physicallyAttemptable !== false
    && physical.targetEffectCurrentlyPossible !== false;
  return {
    status: attemptable ? "currently_attemptable" : "blocked_by_physical_condition",
    currentlyAttemptable: attemptable,
    missingConditionIds: attemptable ? [] : ["physical_route_open"],
  };
}

function movementFeasibilitySurfaces({
  actorPlaceId = "",
  actorZoneId = "",
  reachableZones = [],
  worldVersion = 0,
} = {}) {
  return (reachableZones || []).flatMap((route) => {
    const destinationId = clean(route?.id || route?.zoneId);
    if (!destinationId || destinationId === clean(actorZoneId)) return [];
    const directAttempt = routeDirectAttempt(route);
    return [{
      schemaVersion: ACTION_FEASIBILITY_SURFACE_VERSION,
      feasibilityId: `feasibility:place:${destinationId}:move`,
      targetHandle: destinationId,
      bindingKind: "place",
      perceivedPlaceId: clean(actorPlaceId),
      perceivedActorZoneId: clean(actorZoneId),
      perceivedTargetZoneId: destinationId,
      perceivedSpatialRelation: clean(route?.physicalAccess?.relation || "adjacent"),
      directAttempt,
      socialAccess: clone(route?.socialAccess || null),
      knownPrerequisiteOptions: [],
      confidence: 0.99,
      observedAtWorldVersion: Number(worldVersion || 0),
      mayBecomeStale: true,
      selection: null,
      rule: "This is the recipient's current physical and social movement information, not permission enforcement or an action choice.",
    }];
  });
}

function objectSpatialRelation({ characterId = "", actorZoneId = "", object = {} } = {}) {
  const holder = clean(object.holderEntityHandle);
  const objectZoneId = clean(object.zoneId);
  if (holder && holder === clean(characterId)) return "held_by_self";
  if (!objectZoneId) return "location_unknown";
  if (objectZoneId === clean(actorZoneId)) return holder ? "co_located_held_by_other" : "co_located";
  return holder ? "visible_remote_held_by_other" : "visible_remote";
}

function directManipulationFor(relation = "") {
  if (["held_by_self", "co_located"].includes(relation)) {
    return {
      status: "currently_attemptable",
      currentlyAttemptable: true,
      missingConditionIds: [],
    };
  }
  if (relation === "co_located_held_by_other") {
    return {
      status: "contested_or_permission_dependent",
      currentlyAttemptable: null,
      missingConditionIds: ["target_custody_resolved"],
    };
  }
  if (["visible_remote", "visible_remote_held_by_other"].includes(relation)) {
    return {
      status: "requires_prerequisite",
      currentlyAttemptable: false,
      missingConditionIds: [
        "co_located_with_target",
        ...(relation.endsWith("held_by_other") ? ["target_custody_resolved"] : []),
      ],
    };
  }
  return {
    status: "unknown",
    currentlyAttemptable: null,
    missingConditionIds: ["target_location_known"],
  };
}

export function projectPerceivedActionFeasibilities({
  characterId = "",
  actorPlaceId = "",
  actorZoneId = "",
  perceivedObjects = [],
  reachableZones = [],
  worldVersion = 0,
} = {}) {
  const objectSurfaces = (perceivedObjects || []).flatMap((object) => {
    if (clean(object?.kind) === "position") return [];
    const targetHandle = clean(object?.objectHandle || object?.id || object?.handle);
    if (!targetHandle) return [];
    const relation = objectSpatialRelation({ characterId, actorZoneId, object });
    const directManipulation = directManipulationFor(relation);
    const destinationId = clean(object?.zoneId);
    const route = directManipulation.currentlyAttemptable === false
      ? physicalRouteTo(reachableZones, destinationId)
      : null;
    return [{
      schemaVersion: ACTION_FEASIBILITY_SURFACE_VERSION,
      feasibilityId: `feasibility:object:${targetHandle}:direct-manipulation`,
      targetHandle,
      bindingKind: "object",
      perceivedPlaceId: clean(actorPlaceId),
      perceivedActorZoneId: clean(actorZoneId),
      perceivedTargetZoneId: destinationId,
      perceivedSpatialRelation: relation,
      directAttempt: clone(directManipulation),
      directManipulation,
      knownPrerequisiteOptions: route ? [{
        primitive: "move",
        destinationId,
        currentlyAttemptable: true,
        physicalAccess: clone(route.physicalAccess || null),
        socialAccess: clone(route.socialAccess || null),
      }] : [],
      confidence: relation === "location_unknown" ? 0.25 : relation.includes("remote") ? 0.94 : 0.99,
      observedAtWorldVersion: Number(worldVersion || 0),
      mayBecomeStale: true,
      selection: null,
      rule: "This is the recipient's current feasibility information, not an action choice or success guarantee.",
    }];
  });
  return [
    ...objectSurfaces,
    ...movementFeasibilitySurfaces({ actorPlaceId, actorZoneId, reachableZones, worldVersion }),
  ];
}

export function projectPerceivedReferences({
  perceivedCharacters = [],
  perceivedObjects = [],
  reachableZones = [],
} = {}) {
  return [
    ...(perceivedCharacters || []).map((row) => ({
      kind: "character",
      targetHandle: clean(row?.entityHandle || row?.id || row?.handle),
      perceivedZoneId: clean(row?.zoneId),
    })),
    ...(perceivedObjects || []).map((row) => ({
      kind: clean(row?.kind) === "position" ? "position" : "object",
      targetHandle: clean(row?.objectHandle || row?.id || row?.handle),
      perceivedZoneId: clean(row?.zoneId),
    })),
    ...(reachableZones || []).map((row) => ({
      kind: "place",
      targetHandle: clean(row?.id || row?.zoneId),
      perceivedZoneId: clean(row?.id || row?.zoneId),
    })),
  ].filter((row) => row.targetHandle).map(clone);
}
