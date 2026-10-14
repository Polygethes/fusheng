import assert from "node:assert/strict";
import { deriveDesireSatisfactionEffects } from "../src/server/simulation/desireSatisfaction.mjs";

const ownerActorId = "agent_ferry_courier";
const desire = {
  id: "desire_complete_paid_crossing",
  ownerCharacterId: ownerActorId,
  satisfactionCondition: {
    type: "material_sequence",
    criteria: {
      requiredEvidenceTags: ["cargo_delivered", "fare_paid"],
      requireOwnerAsBeneficiary: true,
      requiredObjectIds: ["sealed_crate"],
    },
  },
};

function action(overrides = {}) {
  return {
    id: "action_crossing_complete",
    actorId: "agent_ferrymaster",
    committed: true,
    satisfactionEvidence: {
      tags: ["cargo_delivered", "fare_paid"],
      beneficiaryActorIds: [ownerActorId],
      objectIds: ["sealed_crate"],
    },
    ...overrides,
  };
}

const matched = deriveDesireSatisfactionEffects({ desires: [desire], action: action(), ownerActorId });
assert.equal(matched.length, 1, "a scene-independent material predicate must satisfy a desire from verified tags and objects");
assert.equal(matched[0].driveId, desire.id);
assert.equal(matched[0].satisfactionEvidence.kind, "material_evidence");

const missingTag = deriveDesireSatisfactionEffects({
  desires: [desire],
  action: action({ satisfactionEvidence: { tags: ["cargo_delivered"], beneficiaryActorIds: [ownerActorId], objectIds: ["sealed_crate"] } }),
  ownerActorId,
});
assert.equal(missingTag.length, 0, "partial evidence cannot complete a multi-fact desire");

const wrongBeneficiary = deriveDesireSatisfactionEffects({
  desires: [desire],
  action: action({ satisfactionEvidence: { tags: ["cargo_delivered", "fare_paid"], beneficiaryActorIds: ["agent_other"], objectIds: ["sealed_crate"] } }),
  ownerActorId,
});
assert.equal(wrongBeneficiary.length, 0, "another person's outcome cannot satisfy the owner's desire");

const missingObject = deriveDesireSatisfactionEffects({
  desires: [desire],
  action: action({ satisfactionEvidence: { tags: ["cargo_delivered", "fare_paid"], beneficiaryActorIds: [ownerActorId], objectIds: [] } }),
  ownerActorId,
});
assert.equal(missingObject.length, 0, "required physical evidence cannot be replaced by tags alone");

console.log("desireSatisfactionGeneralization:test passed", {
  fixture: "river-ferry",
  matchedKind: matched[0].satisfactionEvidence.kind,
  negativeCases: 3,
});
