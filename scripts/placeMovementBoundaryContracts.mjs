import assert from "node:assert/strict";

import {
  projectAdjacentMovementOptions,
  resolvePlaceMovementAttempt,
} from "../src/server/simulation/placeMovementBoundary.mjs";

const ACTOR = "char_probe_visitor";
const OTHER = "char_probe_other";
const topology = {
  locationId: "loc_probe_house",
  zones: {
    hall: { id: "hall", label: "前厅" },
    courtyard: { id: "courtyard", label: "内院" },
    locked_room: { id: "locked_room", label: "锁着的库房" },
    distant_road: { id: "distant_road", label: "远路" },
  },
  edges: [
    { from: "hall", to: "courtyard", move: 1 },
    { from: "hall", to: "locked_room", move: 1, barrier: "locked-door" },
  ],
};
const socialBoundaries = [
  {
    id: "boundary:household-private-area",
    zoneIds: ["courtyard", "locked_room"],
    permissionRequiredByNorm: true,
    evidenceIds: ["fact:owner-sign-private-area"],
    claimantIds: [OTHER],
    possibleResponseTags: ["ignore", "question", "warn", "intervene"],
  },
];

const unpermittedOptions = projectAdjacentMovementOptions({
  topology,
  fromZoneId: "hall",
  actorId: ACTOR,
  socialBoundaries,
  accessGrants: [],
  step: 2,
});
assert.deepEqual(unpermittedOptions.map((row) => row.id), ["hall", "courtyard", "locked_room"]);
assert.equal(unpermittedOptions.selection, undefined, "the world projection must not choose a destination");

const courtyardOption = unpermittedOptions.find((row) => row.id === "courtyard");
assert.equal(courtyardOption.physicalAccess.physicallyAttemptable, true);
assert.equal(courtyardOption.physicalAccess.targetEffectCurrentlyPossible, true);
assert.equal(courtyardOption.socialAccess.permissionCurrentlyGranted, false);
assert.equal(courtyardOption.socialAccess.violationPhysicallyPossible, true);

const lockedOption = unpermittedOptions.find((row) => row.id === "locked_room");
assert.equal(lockedOption.physicalAccess.physicallyAttemptable, true, "a person may still try a locked door");
assert.equal(lockedOption.physicalAccess.targetEffectCurrentlyPossible, false);
assert.equal(lockedOption.physicalAccess.barrier.kind, "locked-door");

const intrusion = resolvePlaceMovementAttempt({
  topology,
  actorId: ACTOR,
  fromZoneId: "hall",
  toZoneId: "courtyard",
  socialBoundaries,
  accessGrants: [],
  step: 2,
});
assert.equal(intrusion.status, "success");
assert.equal(intrusion.movementCommitted, true);
assert.ok(intrusion.committedFacts.some((row) => row.kind === "movement_attempted"));
assert.ok(intrusion.committedFacts.some((row) => row.kind === "actor_movement"));
assert.ok(intrusion.committedFacts.some((row) => row.kind === "social_boundary_crossed_without_permission"));
assert.deepEqual(intrusion.possibleSocialResponseTags, ["ignore", "question", "warn", "intervene"]);
assert.equal(Object.hasOwn(intrusion, "selectedResponse"), false, "the world must not choose another person's response");

const grant = {
  grantId: "grant:probe:courtyard",
  beneficiaryIds: [ACTOR],
  zoneIds: ["courtyard"],
  issuedAtStep: 1,
  expiresAtStep: 4,
  status: "active",
};
const permitted = resolvePlaceMovementAttempt({
  topology,
  actorId: ACTOR,
  fromZoneId: "hall",
  toZoneId: "courtyard",
  socialBoundaries,
  accessGrants: [grant],
  step: 2,
});
assert.equal(permitted.status, "success");
assert.equal(permitted.committedFacts.some((row) => row.kind === "social_boundary_crossed_without_permission"), false);

const lockedDespiteSocialGrant = resolvePlaceMovementAttempt({
  topology,
  actorId: ACTOR,
  fromZoneId: "hall",
  toZoneId: "locked_room",
  socialBoundaries,
  accessGrants: [{ ...grant, zoneIds: ["locked_room"] }],
  step: 2,
});
assert.equal(lockedDespiteSocialGrant.status, "failed");
assert.equal(lockedDespiteSocialGrant.movementCommitted, false);
assert.ok(lockedDespiteSocialGrant.failureCodes.includes("MOVEMENT_BLOCKED_BY_PHYSICAL_BARRIER"));
assert.ok(lockedDespiteSocialGrant.committedFacts.some((row) => row.kind === "movement_attempted"));
assert.ok(lockedDespiteSocialGrant.committedFacts.some((row) => row.kind === "movement_blocked_by_barrier"));
assert.equal(lockedDespiteSocialGrant.committedFacts.some((row) => row.kind === "actor_movement"), false);

const nonAdjacent = resolvePlaceMovementAttempt({
  topology,
  actorId: ACTOR,
  fromZoneId: "hall",
  toZoneId: "distant_road",
  socialBoundaries,
  accessGrants: [],
  step: 2,
});
assert.equal(nonAdjacent.status, "failed");
assert.ok(nonAdjacent.failureCodes.includes("MOVEMENT_DESTINATION_NOT_ADJACENT"));
assert.ok(nonAdjacent.committedFacts.some((row) => row.kind === "movement_attempted"));

console.log(JSON.stringify({
  status: "passed",
  version: "place-movement-boundary-v1",
  checks: {
    socialPermissionDoesNotEraseAttempt: true,
    openUnpermittedRouteCanCommit: true,
    boundaryCrossingCreatesFactNotResponse: true,
    grantRemovesViolationButDoesNotCreateRoute: true,
    physicalBarrierBlocksTargetEffectNotAttemptSurface: true,
    worldDoesNotChooseActionOrReaction: true,
  },
}, null, 2));
