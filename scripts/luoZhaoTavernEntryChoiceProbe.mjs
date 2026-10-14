import assert from "node:assert/strict";
import {
  auditCharacterFoundationProbeInput,
  CHARACTER_FOUNDATION_PROBE_PRIMITIVES,
} from "../src/server/ecology/characterFoundationBlindProbe.mjs";
import {
  buildLuoZhaoTavernEntryChoiceProbeInput,
  LUO_ZHAO_TAVERN_ENTRY_CHOICE_IDS,
} from "./fixtures/luoZhaoTavernEntryChoiceProbeFixture.mjs";

const IDS = LUO_ZHAO_TAVERN_ENTRY_CHOICE_IDS;
const input = buildLuoZhaoTavernEntryChoiceProbeInput();
const audit = auditCharacterFoundationProbeInput(input);

assert.equal(audit.valid, true, JSON.stringify(audit.errors));
assert.ok(
  ["calibrated", "validated"].includes(input.foundation.status),
  `Holdout fixture requires a calibrated-or-later foundation, received ${input.foundation.status}`,
);
assert.equal(input.world.zoneId, "threshold");
assert.equal(input.world.spatialChoice.carriedObjects[0].attachment.active, true);
assert.equal(input.world.serviceChoice.tableUseNorm.sitWithoutOrderingPhysicallyPossible, true);
assert.equal(input.world.serviceChoice.tableUseNorm.operatorResponseRequiresOwnAction, true);
assert.equal(input.world.serviceChoice.currentTransactionState, "none");
assert.equal(input.serviceChoiceTool.choiceAuthority, "character-agent");
assert.ok(CHARACTER_FOUNDATION_PROBE_PRIMITIVES.some((row) => row.id === "request"));

const requestAffordances = input.world.availableAffordances.filter((row) => row.type === "request_service");
assert.equal(requestAffordances.length, 3);
assert.ok(requestAffordances.some((row) => row.id === IDS.REQUEST_HOT_WATER));
assert.ok(requestAffordances.some((row) => row.id === IDS.REQUEST_TEA));
assert.ok(requestAffordances.some((row) => row.id === IDS.REQUEST_MEAL));
assert.ok(requestAffordances.every((row) => row.effects.some((effect) => /不会自动交付/u.test(effect))));

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
  "chosenOfferId",
  "characterFit",
  "洛照没有出声，带着仍贴身佩着的入鞘长剑",
  "先在那里坐下，把真正有用的动静筛出来",
]) {
  assert.equal(serialized.includes(forbidden), false, `integrated tavern entry probe leaked ${forbidden}`);
}

console.log(JSON.stringify({
  valid: true,
  probeId: input.probeId,
  characterId: input.character.id,
  remoteModelCalled: false,
  inputAuditPassed: audit.valid,
  positionOptionIds: input.world.spatialChoice.positionOptions.map((row) => row.id),
  serviceOfferIds: input.world.serviceChoice.offers.map((row) => row.id),
  requestAffordanceIds: requestAffordances.map((row) => row.id),
  characterOwnsConsumptionChoice: true,
}, null, 2));
