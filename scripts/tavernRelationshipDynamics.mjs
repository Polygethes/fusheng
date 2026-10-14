import assert from "node:assert/strict";
import {
  applyDirectionalRelationshipDelta,
  deriveRelationshipDeltas,
  getDirectedRelationship,
  noOpTavernCharacterRelationshipAppraisal,
  tavernCharacterRelationshipAppraisalSchema,
  tavernRelationshipDeltasFromCharacterAppraisal,
  validateTavernCharacterRelationshipAppraisal,
} from "../src/server/ecology/tavernRelationshipDynamics.mjs";

const A = "actor";
const B = "recipient";

const forward = { id: "b-to-a", fromCharacterId: B, toCharacterId: A, dependence: 20, resentment: 10, fear: 8, protection: 5, wantsToBeSeen: 30 };
const reverse = { id: "a-to-b", fromCharacterId: A, toCharacterId: B, dependence: 70, resentment: 2, fear: 1, protection: 80, wantsToBeSeen: 60 };
const ledger = [structuredClone(forward), structuredClone(reverse)];

assert.equal(getDirectedRelationship(ledger, B, A)?.id, "b-to-a");
assert.equal(getDirectedRelationship({ relationships: ledger }, A, B)?.id, "a-to-b");
assert.equal(getDirectedRelationship(ledger, "missing", A), null);

assert.deepEqual(
  noOpTavernCharacterRelationshipAppraisal(),
  {
    phase: "pending_perception_appraisal",
    targetCharacterId: "",
    sourceImpactIds: [],
    changeMode: "none",
    dimensionChanges: [],
    reason: "",
  },
);
assert.deepEqual(
  new Set(tavernCharacterRelationshipAppraisalSchema.required),
  new Set(Object.keys(tavernCharacterRelationshipAppraisalSchema.properties)),
  "the strict Character Agent output schema must require every relationship-appraisal field",
);

const livedImpact = {
  impactId: "impact:firsthand-answer",
  sourceCharacterId: A,
  content: "对方亲口给了答复",
  provenance: { kind: "firsthand" },
  semanticFrame: { roles: { actor: A, addressee: B } },
};
const retainedAppraisal = {
  phase: "pending_perception_appraisal",
  targetCharacterId: A,
  sourceImpactIds: [livedImpact.impactId],
  changeMode: "retained",
  dimensionChanges: [
    { metric: "dependence", direction: "increase", strengthBand: "low" },
    { metric: "resentment", direction: "decrease", strengthBand: "medium" },
  ],
  reason: "我亲耳听见他正面回应，因此略微更愿意依赖，也不再那么介怀。",
};
assert.equal(validateTavernCharacterRelationshipAppraisal(retainedAppraisal, {
  perceivedCharacterIds: [A],
  perceivedImpactIds: [livedImpact.impactId],
  perceivedImpacts: [livedImpact],
}).valid, true);
assert.deepEqual(tavernRelationshipDeltasFromCharacterAppraisal(retainedAppraisal), {
  dependence: 1,
  resentment: -3,
});
const invalidRemoteAppraisal = validateTavernCharacterRelationshipAppraisal({
  ...retainedAppraisal,
  targetCharacterId: "unseen-person",
  sourceImpactIds: ["impact:unheard-rumor"],
}, {
  perceivedCharacterIds: [A],
  perceivedImpactIds: [livedImpact.impactId],
  perceivedImpacts: [livedImpact],
});
assert.equal(invalidRemoteAppraisal.valid, false);
assert.ok(invalidRemoteAppraisal.errors.some((error) => error.code === "RELATIONSHIP_APPRAISAL_TARGET_NOT_PERCEIVED"));
assert.ok(invalidRemoteAppraisal.errors.some((error) => error.code === "RELATIONSHIP_APPRAISAL_SOURCE_UNKNOWN"));

for (const speechAct of ["greet", "answer", "inform", "refuse", "warn", "ask"]) {
  const result = deriveRelationshipDeltas({
    action: {
      id: `speech:${speechAct}`,
      actorId: A,
      targetCharacterId: B,
      speechAct,
      speech: "一句确实说出口的话",
      committed: true,
      deliveries: [{ recipientId: B, sourceCharacterId: A, modality: "sound" }],
    },
    outcome: { id: `outcome:${speechAct}`, status: "committed" },
  });
  assert.deepEqual(result.shifts, [], `${speechAct} delivery is only a stimulus; the world cannot choose the listener's appraisal`);
  assert.deepEqual(result.observerTrace.directionsChanged, []);
}

const outcomeKinds = ["protect", "assist", "fulfill", "betray", "coerce", "ignore"];
for (const kind of outcomeKinds) {
  const result = deriveRelationshipDeltas({
    action: { id: `action:${kind}`, actorId: A, targetCharacterId: B, actionKind: kind, committed: true },
    outcome: {
      id: `outcome:${kind}`,
      status: "committed",
      receivedByCharacterIds: [B],
      relationshipEvidence: [{
        id: `evidence:${kind}`,
        verified: true,
        authority: "recipient-character-agent",
        type: kind,
        sourceActionId: `action:${kind}`,
        actorCharacterId: A,
        targetCharacterId: B,
        observerCharacterId: B,
        witnessedByCharacterIds: [B],
        deltas: { dependence: kind === "betray" ? -4 : 2 },
      }],
    },
  });
  assert.equal(result.shifts.length, 1, `${kind} should update only its recipient's direction`);
  assert.equal(result.shifts[0].fromCharacterId, B);
  assert.equal(result.shifts[0].toCharacterId, A);
}

const protection = deriveRelationshipDeltas({
  action: { id: "protect", actorId: A, targetCharacterId: B, actionKind: "protect", committed: true },
  outcome: {
    status: "committed",
    receivedByCharacterIds: [B],
    relationshipEvidence: [{
      id: "verified-protection",
      verified: true,
      authority: "recipient-character-agent",
      type: "nonverbal_protection",
      sourceActionId: "protect",
      actorCharacterId: A,
      targetCharacterId: B,
      observerCharacterId: B,
      witnessedByCharacterIds: [B],
      deltas: { protection: 4, dependence: 2 },
    }],
  },
});
assert.deepEqual(protection.shifts.map((shift) => `${shift.fromCharacterId}->${shift.toCharacterId}`), [`${B}->${A}`]);

const beforeForward = structuredClone(forward);
const beforeReverse = structuredClone(reverse);
const nextForward = applyDirectionalRelationshipDelta(forward, protection.shifts[0]);
assert.notDeepEqual(nextForward, beforeForward);
assert.deepEqual(forward, beforeForward, "the updater must not mutate its input");
assert.deepEqual(reverse, beforeReverse, "one direction must not mutate the reverse relation");

const unverified = deriveRelationshipDeltas({
  action: { id: "rumored-betrayal", actorId: A, targetCharacterId: B, committed: true },
  outcome: { relationshipEvidence: [{ id: "mere-claim", verified: false, authority: "recipient-character-agent", type: "betray", actorCharacterId: A, targetCharacterId: B, deltas: { resentment: 4 } }] },
});
assert.deepEqual(unverified.shifts, [], "an unverified relationship claim must not change the ledger");
assert.equal(unverified.observerTrace.rejectedEvidence[0].reason, "unverified-or-wrong-source");

const worldAuthoredProtection = deriveRelationshipDeltas({
  action: { id: "world-authored-protect", actorId: A, targetCharacterId: B, committed: true },
  outcome: {
    status: "committed",
    receivedByCharacterIds: [B],
    relationshipEvidence: [{
      id: "world-authored-protection-evidence",
      verified: true,
      type: "protect",
      sourceActionId: "world-authored-protect",
      actorCharacterId: A,
      observerCharacterId: B,
      witnessedByCharacterIds: [B],
      deltas: { protection: 4 },
    }],
  },
});
assert.deepEqual(worldAuthoredProtection.shifts, [], "objective delivery cannot impersonate the recipient Character Agent");
assert.equal(worldAuthoredProtection.observerTrace.rejectedEvidence[0].reason, "recipient-character-agent-appraisal-required");

console.log("tavernRelationshipDynamics:test passed", {
  speechStimuliWithoutAutomaticDeltas: 6,
  outcomeRules: outcomeKinds.length,
  directional: true,
  recipientOwnedAppraisal: true,
  observerTrace: true,
});
