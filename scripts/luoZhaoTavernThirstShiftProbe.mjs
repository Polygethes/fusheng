import assert from "node:assert/strict";
import { auditCharacterFoundationProbeInput } from "../src/server/ecology/characterFoundationBlindProbe.mjs";
import { buildLuoZhaoTavernEntryChoiceProbeInput } from "./fixtures/luoZhaoTavernEntryChoiceProbeFixture.mjs";
import {
  buildLuoZhaoTavernThirstShiftProbeInput,
  LUO_ZHAO_TAVERN_THIRST_SHIFT_PROBE_ID,
} from "./fixtures/luoZhaoTavernThirstShiftProbeFixture.mjs";

const baseline = buildLuoZhaoTavernEntryChoiceProbeInput();
const input = buildLuoZhaoTavernThirstShiftProbeInput();
const audit = auditCharacterFoundationProbeInput(input);

assert.equal(audit.valid, true, JSON.stringify(audit.errors));
assert.equal(input.probeId, LUO_ZHAO_TAVERN_THIRST_SHIFT_PROBE_ID);
assert.equal(baseline.dynamicState.thirst, 0.42);
assert.equal(input.dynamicState.thirst, 0.82);
assert.equal(input.world.serviceChoice.bodyNeeds.thirst, input.dynamicState.thirst);

assert.deepEqual(input.foundation, baseline.foundation);
assert.deepEqual(input.ownedMemory, baseline.ownedMemory);
assert.deepEqual(input.relationshipContext, baseline.relationshipContext);
assert.deepEqual(input.world.objectiveFacts, baseline.world.objectiveFacts);
assert.deepEqual(input.world.perceivedEvents, baseline.world.perceivedEvents);
assert.deepEqual(input.world.spatialChoice, baseline.world.spatialChoice);
assert.deepEqual(input.world.availableAffordances, baseline.world.availableAffordances);
assert.deepEqual(input.world.atmosphere, baseline.world.atmosphere);
assert.deepEqual(input.world.serviceChoice.offers, baseline.world.serviceChoice.offers);
assert.deepEqual(input.world.serviceChoice.ownedTender, baseline.world.serviceChoice.ownedTender);
assert.equal(input.dynamicState.hunger, baseline.dynamicState.hunger);
assert.equal(input.dynamicState.fatigue, baseline.dynamicState.fatigue);

const serialized = JSON.stringify(input);
for (const forbidden of [
  "calibrationEvidence",
  "legacyHoldoutEvidence",
  "holdouts",
  "authorCorrection",
  "authorDecision",
  "expectedAction",
  "expectedOutcome",
  "expectedChoice",
  "preferredOfferId",
  "chosenOfferId",
  "preferredPositionId",
  "candidate:move-side-wall-table",
  "洛照沿堂前空隙走向侧墙空桌",
]) {
  assert.equal(serialized.includes(forbidden), false, `thirst-shift probe leaked ${forbidden}`);
}

console.log(JSON.stringify({
  valid: true,
  probeId: input.probeId,
  characterId: input.character.id,
  remoteModelCalled: false,
  inputAuditPassed: audit.valid,
  changedAxis: "dynamicState.thirst",
  baselineThirst: baseline.dynamicState.thirst,
  shiftedThirst: input.dynamicState.thirst,
  unchangedStableFoundation: true,
  actionChoiceNotAsserted: true,
}, null, 2));
