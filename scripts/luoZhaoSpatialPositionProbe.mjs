import assert from "node:assert/strict";
import { auditCharacterFoundationProbeInput } from "../src/server/ecology/characterFoundationBlindProbe.mjs";
import {
  buildLuoZhaoSpatialPositionProbeInput,
  LUO_ZHAO_SPATIAL_POSITION_PROBE_IDS,
} from "./fixtures/luoZhaoSpatialPositionProbeFixture.mjs";

const IDS = LUO_ZHAO_SPATIAL_POSITION_PROBE_IDS;
const input = buildLuoZhaoSpatialPositionProbeInput();
const audit = auditCharacterFoundationProbeInput(input);

assert.equal(audit.valid, true, JSON.stringify(audit.errors));
assert.equal(input.foundation.status, "calibrated");
assert.equal(input.world.zoneId, "threshold");
assert.equal(input.world.spatialChoice.currentPosition.id, IDS.THRESHOLD_POSITION);
assert.ok(input.foundation.competenceModel.perceptualCompetences.length > 0);
assert.ok(input.foundation.competenceModel.proceduralCompetences.length > 0);
assert.equal(input.world.spatialChoice.carriedObjects[0].attachment.active, true);
assert.equal(input.world.spatialChoice.carriedObjects[0].attachment.actorId, IDS.LUO);
assert.equal(input.world.spatialChoice.carriedObjects[0].state.sheathed, true);
assert.ok(input.world.spatialChoice.positionOptions.length >= 3);
assert.equal(
  input.world.availableAffordances.filter((row) => row.type === "move" && row.destinationPositionId).length,
  input.world.spatialChoice.positionOptions.length,
);
assert.equal(input.spatialChoiceTool.choiceAuthority, "character-agent");

const serialized = JSON.stringify(input);
for (const forbidden of [
  "calibrationEvidence",
  "legacyHoldoutEvidence",
  "holdouts",
  "authorCorrection",
  "expectedAction",
  "expectedOutcome",
  "expectedChoice",
  "preferredPositionId",
  "洛照应该坐",
  "剑往里收一收",
  "占了半段过道",
  "靠在自己腿侧",
  "收进桌边",
]) {
  assert.equal(serialized.includes(forbidden), false, `spatial position probe leaked ${forbidden}`);
}

console.log(JSON.stringify({
  valid: true,
  probeId: input.probeId,
  characterId: input.character.id,
  remoteModelCalled: false,
  inputAuditPassed: audit.valid,
  currentPositionId: input.world.spatialChoice.currentPosition.id,
  positionOptionIds: input.world.spatialChoice.positionOptions.map((row) => row.id),
  wornObjectIds: input.world.spatialChoice.carriedObjects
    .filter((row) => row.attachment?.active === true)
    .map((row) => row.id),
}, null, 2));
