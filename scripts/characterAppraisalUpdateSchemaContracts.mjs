import assert from "node:assert/strict";
import { tavernCharacterAgentV2OutputSchemaForStage } from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import { validateCharacterOutputShape } from "../src/server/simulation/characterStageSubmission.mjs";

const target = "perceived_entity:friend";
const prior = { positionId: "intent:friend", domain: "intent", subjectHandle: target, status: "unknown" };
for (const phase of ["awaiting_subjective_appraisal", "awaiting_subjective_appraisal_and_candidates"]) {
  const stageInput = (evidence) => ({ phase,
    referenceContract: { perceivedCharacterHandles: [target], perceivedTargetHandles: [target] },
    worldProjection: { evidence },
    privateContext: { state: { priorRegulationCarryover: { epistemicPositions: [prior] } } },
  });
  const schema = tavernCharacterAgentV2OutputSchemaForStage(stageInput([{ evidenceId: "event:call" }]));
  const appraisal = phase.endsWith("_and_candidates") ? schema.properties.appraisal : schema;
  const relationship = appraisal.properties.relationshipAppraisal;
  const noChange = { phase: "pending_perception_appraisal", targetCharacterId: target,
    sourceImpactIds: [], changeMode: "none", dimensionChanges: [], reason: "还不足以改变关系维度。" };
  const change = { metric: "dependence", direction: "increase", strengthBand: "low" };
  assert.deepEqual(validateCharacterOutputShape(noChange, relationship), []);
  assert.ok(validateCharacterOutputShape({ ...noChange, sourceImpactIds: ["event:call"] }, relationship).length,
    "a no-change relationship appraisal no longer carries unrelated sources");
  assert.ok(validateCharacterOutputShape({ ...noChange, changeMode: "provisional", sourceImpactIds: ["event:call"] }, relationship).length,
    "the actual Luna provisional-with-empty-dimensions failure must be invalid in the generation schema");
  assert.ok(validateCharacterOutputShape({ ...noChange, dimensionChanges: [change] }, relationship).length);
  const withoutEvidence = tavernCharacterAgentV2OutputSchemaForStage(stageInput([]));
  const relationshipWithoutEvidence = (phase.endsWith("_and_candidates") ? withoutEvidence.properties.appraisal : withoutEvidence)
    .properties.relationshipAppraisal;
  assert.equal(relationshipWithoutEvidence.anyOf.length, 1,
    "without received evidence a relationship change is unsatisfiable, so the schema offers only the no-change branch");
  assert.deepEqual(validateCharacterOutputShape(noChange, relationshipWithoutEvidence), []);
  for (const changeMode of ["provisional", "retained"]) {
    const valid = { ...noChange, changeMode, sourceImpactIds: ["event:call"], dimensionChanges: [change] };
    assert.deepEqual(validateCharacterOutputShape(valid, relationship), []);
    assert.ok(validateCharacterOutputShape({ ...valid, targetCharacterId: "" }, relationship).length);
    assert.ok(validateCharacterOutputShape({ ...valid, sourceImpactIds: [] }, relationship).length);
  }
  assert.deepEqual(appraisal.properties.epistemicPositionUpdateMode.enum, ["retain_unmentioned"],
    "ongoing unresolved memory uses an explicit delta operation; a complete-list omission must not recur");
  assert.ok(appraisal.required.includes("epistemicPositionUpdateMode"));
  assert.deepEqual(validateCharacterOutputShape([], appraisal.properties.epistemicPositions), [],
    "the Character may leave existing judgments unchanged without rewriting them");
}
console.log("Appraisal update schemas passed: relationship modes require matching payloads; unresolved memory uses explicit delta updates.");
