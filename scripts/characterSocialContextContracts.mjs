import assert from "node:assert/strict";

import { deriveCharacterSocialContext } from "../src/server/simulation/characterSocialContext.mjs";

const actorId = "char:actor";
const targetId = "char:target";

const privatePair = deriveCharacterSocialContext({
  actorId,
  directParticipantIds: [actorId, targetId],
  potentialObservers: [{ characterId: targetId, noticeProbability: 1 }],
  place: { placeId: "place:hall", zoneId: "counter", publicAccess: true },
  socialFacts: [{
    factId: "fact:ownership",
    kind: "ownership_claim",
    claimantId: actorId,
    entityId: "place:hall",
    sourceEvidenceIds: ["evidence:sign"],
  }],
});

assert.deepEqual(privatePair.thirdPartyObserverIds, []);
assert.equal(privatePair.audienceExposure, 0, "the other participant is not a third-party audience");
assert.equal(privatePair.place.publicAccess, true);
assert.equal(privatePair.socialFacts[0].factId, "fact:ownership");
assert.equal(Object.hasOwn(privatePair, "venueNormPressure"), false);
assert.equal(Object.hasOwn(privatePair, "propertyRisk"), false);
assert.equal(Object.hasOwn(privatePair, "dutyConflict"), false);

const observedPair = deriveCharacterSocialContext({
  actorId,
  directParticipantIds: [actorId, targetId],
  potentialObservers: [
    { characterId: targetId, noticeProbability: 1 },
    { characterId: "char:observer", noticeProbability: 0.8, perceivedConcernWeight: 0.75 },
  ],
  place: { placeId: "place:hall", zoneId: "counter", publicAccess: true },
});

assert.deepEqual(observedPair.thirdPartyObserverIds, ["char:observer"]);
assert.ok(observedPair.audienceExposure > privatePair.audienceExposure);
assert.equal(observedPair.directParticipantIds.includes(targetId), true);
assert.equal(Object.hasOwn(observedPair, "selectedAction"), false);

console.log("characterSocialContextContracts:test passed");
