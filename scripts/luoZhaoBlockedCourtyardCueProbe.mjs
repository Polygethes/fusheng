import assert from "node:assert/strict";
import { auditCharacterFoundationProbeInput } from "../src/server/ecology/characterFoundationBlindProbe.mjs";
import { buildLuoZhaoTavernEntryChoiceProbeInput } from "./fixtures/luoZhaoTavernEntryChoiceProbeFixture.mjs";
import {
  buildLuoZhaoBlockedCourtyardCueProbeInput,
  LUO_ZHAO_BLOCKED_COURTYARD_CUE_IDS,
} from "./fixtures/luoZhaoBlockedCourtyardCueProbeFixture.mjs";

const IDS = LUO_ZHAO_BLOCKED_COURTYARD_CUE_IDS;
const baseline = buildLuoZhaoTavernEntryChoiceProbeInput();
const input = buildLuoZhaoBlockedCourtyardCueProbeInput();
const audit = auditCharacterFoundationProbeInput(input);

assert.equal(audit.valid, true, JSON.stringify(audit.errors));
assert.equal(input.probeId, IDS.PROBE);
assert.deepEqual(input.foundation, baseline.foundation);
assert.deepEqual(input.ownedMemory, baseline.ownedMemory);
assert.deepEqual(input.dynamicState, baseline.dynamicState);
assert.deepEqual(input.world.serviceChoice.bodyNeeds, baseline.world.serviceChoice.bodyNeeds);
assert.deepEqual(input.world.serviceChoice.ownedTender, baseline.world.serviceChoice.ownedTender);
assert.deepEqual(input.world.serviceChoice.offers, baseline.world.serviceChoice.offers);
assert.equal(input.world.zoneId, "hall");
assert.equal(input.world.spatialChoice.currentPosition.id, IDS.HALL_ENTRY_POSITION);

const cueFact = input.world.objectiveFacts.find((row) => row.id === IDS.MARTIAL_CUE_FACT);
const identityFact = input.world.objectiveFacts.find((row) => row.id === IDS.IDENTITY_UNRESOLVED_FACT);
const accessFact = input.world.objectiveFacts.find((row) => row.id === IDS.HOUSEHOLD_ACCESS_FACT);
const cueEvent = input.world.perceivedEvents.find((row) => row.id === IDS.CUE_EVENT);
assert.ok(cueFact && identityFact && accessFact && cueEvent);
assert.equal(cueEvent.truthStatus, "verified");
assert.equal(cueEvent.sourceCharacterId, IDS.UNKNOWN_SWORD_USER);
assert.equal(input.world.perceivedCharacters.find((row) => row.id === IDS.UNKNOWN_SWORD_USER)?.identityKnown, false);
assert.doesNotMatch(JSON.stringify([cueFact, identityFact, cueEvent]), /char_xyy_xiezenshi|谢真石|高手|高妙|值得追|应该|最佳/u);

const approach = input.world.spatialChoice.positionOptions.find(
  (row) => row.id === IDS.COURTYARD_APPROACH_POSITION,
);
const courtyard = input.world.spatialChoice.positionOptions.find(
  (row) => row.id === IDS.COURTYARD_INTERIOR_POSITION,
);
assert.ok(approach && courtyard);
assert.equal(approach.zoneId, "hall");
assert.equal(courtyard.zoneId, "courtyard");
assert.equal(courtyard.available, true);
assert.deepEqual(courtyard.socialAccess, {
  physicallyAttemptable: true,
  permissionRequiredByNorm: true,
  permissionCurrentlyGranted: false,
  violationPhysicallyPossible: true,
  evidenceIds: [IDS.HOUSEHOLD_ACCESS_FACT],
  possibleResponseTags: [
    "ignore",
    "question_intent",
    "grant_permission",
    "set_boundary",
    "warn",
    "intervene",
  ],
});

const approachAffordance = input.world.availableAffordances.find(
  (row) => row.destinationPositionId === IDS.COURTYARD_APPROACH_POSITION,
);
const intrusionAffordance = input.world.availableAffordances.find(
  (row) => row.destinationPositionId === IDS.COURTYARD_INTERIOR_POSITION,
);
assert.ok(approachAffordance && intrusionAffordance);
assert.equal(approachAffordance.toZoneId, "hall");
assert.equal(intrusionAffordance.toZoneId, "courtyard");
assert.equal(intrusionAffordance.socialAccess.permissionCurrentlyGranted, false);
assert.ok(intrusionAffordance.preconditions.some((row) => row.includes("不等于已经得到进入许可")));
assert.ok(intrusionAffordance.effects.some((row) => row.includes("他人是否回应仍由其本人决定")));
assert.ok(input.world.availableAffordances.some((row) => row.type === "request_service"));
assert.ok(input.world.availableAffordances.some((row) => row.type === "leave"));

const unknownAccessEvidence = structuredClone(input);
unknownAccessEvidence.world.spatialChoice.positionOptions.find(
  (row) => row.id === IDS.COURTYARD_INTERIOR_POSITION,
).socialAccess.evidenceIds = ["fact:invented-household-permission-rule"];
const unknownAccessAudit = auditCharacterFoundationProbeInput(unknownAccessEvidence);
assert.equal(unknownAccessAudit.valid, false);
assert.ok(unknownAccessAudit.errors.some(
  (row) => row.code === "PROBE_SPATIAL_SOCIAL_ACCESS_EVIDENCE_UNKNOWN",
));

const socialNorm = input.world.socialNorms.find(
  (row) => row.id === "norm_guest_entry_into_household_work_area",
);
assert.ok(socialNorm);
assert.equal(socialNorm.violationPhysicallyPossible, true);
assert.match(socialNorm.pressureOnset, /真实越过/u);

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
  "preferredPositionId",
  "chosenPositionId",
  "candidate:move-side-wall-table",
  "candidate:request-rough-mountain-tea",
  "洛照沿堂前空隙走向侧墙空桌",
  "粗焙山茶。",
]) {
  assert.equal(serialized.includes(forbidden), false, `blocked-cue probe leaked ${forbidden}`);
}

console.log(JSON.stringify({
  valid: true,
  probeId: input.probeId,
  characterId: input.character.id,
  remoteModelCalled: false,
  inputAuditPassed: audit.valid,
  changedAxis: "direct-partial-martial-cue-plus-socially-bounded-household-access",
  identityStillUnknown: true,
  publicApproachAvailable: true,
  unpermittedEntryPhysicallyAttemptable: true,
  operatorResponseNotPrewritten: true,
  actionChoiceNotAsserted: true,
}, null, 2));
