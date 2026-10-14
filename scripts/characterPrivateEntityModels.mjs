import assert from "node:assert/strict";

import {
  applyCharacterPrivateEntityModelUpdate,
  createCharacterAgentMemoryState,
  normalizeCharacterAgentMemoryState,
} from "../src/engine/characterAgentMemory.js";

const OWNER = "char_test_observer";
const STRANGER = "perceived:visitor-a";
const RUMORED_TARGET = "known:rumored-swordsman";
const WRONG_TARGET = "known:unrelated-swordsman";

const initial = createCharacterAgentMemoryState(OWNER);
assert.deepEqual(initial.privateEntityModels, []);

const firstEvidence = "noticed:signal:scabbard:1";
const first = applyCharacterPrivateEntityModelUpdate(initial, {
  perceivedEntityHandle: STRANGER,
  noticedEvidenceIds: [firstEvidence],
  hypotheses: [{
    hypothesisId: "hypothesis:trained-sword-user",
    proposition: "眼前人可能长期练剑",
    operation: "adopt",
    confidenceBand: "medium",
    basisEvidenceIds: [firstEvidence],
  }],
  identityCandidates: [{
    knownEntityHandle: WRONG_TARGET,
    operation: "adopt",
    confidenceBand: "low",
    basisEvidenceIds: [firstEvidence],
  }],
  affectiveResponse: { label: "留意", valence: 0.1, arousal: 0.35 },
  attentionPriority: 0.7,
}, {
  allowedEvidenceIds: [firstEvidence],
  nowSeconds: 12,
});
assert.equal(first.valid, true);
assert.equal(first.memory.privateEntityModels.length, 1);
assert.equal(first.memory.privateEntityModels[0].perceivedEntityHandle, STRANGER);
assert.equal(first.memory.privateEntityModels[0].identityCandidates[0].knownEntityHandle, WRONG_TARGET);
assert.equal(first.memory.privateEntityModels[0].identityCandidates[0].status, "supported");
assert.deepEqual(first.memory.impressions, [], "an anonymous first impression must not become a relationship appraisal");
assert.equal(Object.hasOwn(first.memory.privateEntityModels[0], "canonicalCharacterId"), false);

const secondEvidence = "noticed:signal:voice-name:1";
const revised = applyCharacterPrivateEntityModelUpdate(first.memory, {
  perceivedEntityHandle: STRANGER,
  noticedEvidenceIds: [secondEvidence],
  hypotheses: [{
    hypothesisId: "hypothesis:trained-sword-user",
    proposition: "眼前人可能长期练剑",
    operation: "revise",
    confidenceBand: "high",
    basisEvidenceIds: [secondEvidence],
  }],
  identityCandidates: [
    {
      knownEntityHandle: WRONG_TARGET,
      operation: "reject",
      confidenceBand: "high",
      basisEvidenceIds: [secondEvidence],
    },
    {
      knownEntityHandle: RUMORED_TARGET,
      operation: "adopt",
      confidenceBand: "medium",
      basisEvidenceIds: [secondEvidence],
    },
  ],
  affectiveResponse: { label: "重新判断", valence: 0.05, arousal: 0.5 },
  attentionPriority: 0.82,
}, {
  allowedEvidenceIds: [firstEvidence, secondEvidence],
  nowSeconds: 18,
});
assert.equal(revised.valid, true);
const model = revised.memory.privateEntityModels[0];
assert.deepEqual(model.noticedEvidenceIds, [firstEvidence, secondEvidence]);
assert.equal(model.identityCandidates.find((row) => row.knownEntityHandle === WRONG_TARGET).status, "rejected");
assert.equal(model.identityCandidates.find((row) => row.knownEntityHandle === RUMORED_TARGET).status, "supported");
assert.equal(model.hypotheses[0].confidenceBand, "high");
assert.ok(model.revisionHistory.length >= 2, "identity revision must keep provenance instead of overwriting the first guess");
assert.deepEqual(revised.memory.impressions, [], "identity hypotheses still must not create a social relationship");

const unsupported = applyCharacterPrivateEntityModelUpdate(revised.memory, {
  perceivedEntityHandle: STRANGER,
  noticedEvidenceIds: ["noticed:not-owned"],
  hypotheses: [{
    hypothesisId: "hypothesis:omniscient",
    proposition: "眼前人就是世界真实目标",
    operation: "adopt",
    confidenceBand: "high",
    basisEvidenceIds: ["noticed:not-owned"],
  }],
}, {
  allowedEvidenceIds: [firstEvidence, secondEvidence],
  nowSeconds: 20,
});
assert.equal(unsupported.valid, false);
assert.ok(unsupported.violations.some((row) => row.code === "PRIVATE_ENTITY_EVIDENCE_NOT_OWNED"));
assert.equal(unsupported.memory.privateEntityModels[0].hypotheses.some((row) => row.hypothesisId === "hypothesis:omniscient"), false);

const restored = normalizeCharacterAgentMemoryState(JSON.parse(JSON.stringify(revised.memory)), OWNER);
assert.equal(restored.privateEntityModels[0].perceivedEntityHandle, STRANGER);
assert.ok(restored.privateEntityModels[0].revisionHistory.length >= 2);
assert.deepEqual(restored.impressions, []);

console.log("characterPrivateEntityModels:test passed", {
  entityHandle: model.perceivedEntityHandle,
  hypothesisCount: model.hypotheses.length,
  identityCandidates: model.identityCandidates.map((row) => `${row.knownEntityHandle}:${row.status}`),
});
