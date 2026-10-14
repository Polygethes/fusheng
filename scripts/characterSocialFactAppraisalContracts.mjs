import assert from "node:assert/strict";

import { deriveCharacterSocialContext } from "../src/server/simulation/characterSocialContext.mjs";
import {
  computeCharacterSocialAppraisal,
  normalizeObjectiveSocialFacts,
} from "../src/server/simulation/characterSocialAppraisal.mjs";

const socialFacts = normalizeObjectiveSocialFacts([
  {
    factId: "fact:ownership:workshop",
    kind: "ownership_claim",
    claimantId: "char:owner",
    entityId: "place:workshop",
    sourceEvidenceIds: ["evidence:sign"],
  },
  {
    factId: "fact:visitor:waiting",
    kind: "request",
    actorId: "char:visitor",
    addresseeIds: [],
    topic: "request_entry",
    sourceEvidenceIds: ["evidence:knock"],
  },
  {
    factId: "fact:rule:no-open-flame",
    kind: "posted_rule",
    claimantId: "guild:safety",
    entityId: "place:workshop",
    topic: "no_open_flame",
    sourceEvidenceIds: ["evidence:placard"],
  },
]);

assert.equal(socialFacts.length, 3);
assert.equal(socialFacts.every((row) => row.factId && row.kind), true);
assert.equal(socialFacts.some((row) => Object.hasOwn(row, "normPressure")), false);

const sharedWorld = deriveCharacterSocialContext({
  actorId: "char:owner",
  directParticipantIds: ["char:visitor"],
  potentialObservers: [
    { characterId: "char:witness", noticeProbability: 0.75, modalities: ["visual"] },
  ],
  place: { placeId: "place:workshop", zoneId: "front_room", publicAccess: true },
  socialFacts,
});

assert.deepEqual(sharedWorld.socialFacts.map((row) => row.factId), socialFacts.map((row) => row.factId));
for (const forbidden of ["venueNormPressure", "propertyRisk", "dutyConflict", "accessStatus", "selectedAction"]) {
  assert.equal(Object.hasOwn(sharedWorld, forbidden), false, `world projection must not author ${forbidden}`);
}

const ownerAppraisal = computeCharacterSocialAppraisal({
  characterId: "char:owner",
  socialFacts,
  beliefAppraisals: [
    {
      factId: "fact:visitor:waiting",
      confidence: 0.95,
      responsibilityAcceptance: 0.9,
      identityCommitment: 0.85,
      relationshipCare: 0.35,
    },
    {
      factId: "fact:rule:no-open-flame",
      confidence: 0.95,
      internalization: 0.8,
      expectedSanction: 0.7,
      identityConflict: 0.55,
      expectedRelationshipCost: 0.4,
    },
  ],
  characterParameters: { lossSensitivity: 0.8, conscientiousness: 0.86 },
  candidateSocialImplications: {
    respondsToFactIds: ["fact:visitor:waiting"],
    violatesFactIds: ["fact:rule:no-open-flame"],
    observerExposure: 0.75,
  },
});

const indifferentVisitorAppraisal = computeCharacterSocialAppraisal({
  characterId: "char:visitor",
  socialFacts,
  beliefAppraisals: [
    {
      factId: "fact:visitor:waiting",
      confidence: 0.95,
      responsibilityAcceptance: 0,
      identityCommitment: 0.05,
      relationshipCare: 0,
    },
    {
      factId: "fact:rule:no-open-flame",
      confidence: 0.4,
      internalization: 0.05,
      expectedSanction: 0.08,
      identityConflict: 0,
      expectedRelationshipCost: 0.02,
    },
  ],
  characterParameters: { lossSensitivity: 0.12, conscientiousness: 0.2 },
  candidateSocialImplications: {
    respondsToFactIds: ["fact:visitor:waiting"],
    violatesFactIds: ["fact:rule:no-open-flame"],
    observerExposure: 0.75,
  },
});

assert.ok(ownerAppraisal.normPressure > indifferentVisitorAppraisal.normPressure * 4,
  "the same posted rule must produce different pressure through private belief and character weights");
assert.ok(ownerAppraisal.responsibilityPull > indifferentVisitorAppraisal.responsibilityPull + 0.45,
  "responsibility must come from the person's acceptance and identity, not their physical presence");
assert.equal(ownerAppraisal.selection.selectedCandidateId, null);
assert.equal(indifferentVisitorAppraisal.selection.selectedCandidateId, null);
assert.equal(Object.hasOwn(ownerAppraisal, "chosenAction"), false);
assert.equal(ownerAppraisal.factorLedger.every((row) => row.factId), true);

console.log(JSON.stringify({
  status: "all-passed",
  contracts: 12,
  owner: {
    normPressure: ownerAppraisal.normPressure,
    responsibilityPull: ownerAppraisal.responsibilityPull,
  },
  visitor: {
    normPressure: indifferentVisitorAppraisal.normPressure,
    responsibilityPull: indifferentVisitorAppraisal.responsibilityPull,
  },
}, null, 2));
