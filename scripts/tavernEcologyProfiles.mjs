import assert from "node:assert/strict";
import {
  TAVERN_ECOLOGY_CHARACTER_IDS,
  TAVERN_ECOLOGY_PROFILES,
  getTavernEcologyProfile,
  validateEcologyDesire,
  validateEcologyProfile,
  validateTavernEcologyProfiles,
} from "../src/server/ecology/tavernEcologyProfile.mjs";
import {
  createInitialEcologyState,
  createInitialTavernEcologyStates,
  validateEcologyState,
} from "../src/server/ecology/tavernEcologyState.mjs";

const EXPECTED_NAMES = ["谢真石", "谢恒", "谢母", "周珉", "洛照", "严执中", "陈砚"];
const CATEGORY_KIND = {
  desires: "desire",
  duties: "duty",
  principles: "principle",
  boundaries: "boundary",
  sensitivities: "sensitivity",
};

function clone(value) {
  return structuredClone(value);
}

function errorCodes(result) {
  return new Set(result.errors.map((entry) => entry.code));
}

assert.equal(TAVERN_ECOLOGY_CHARACTER_IDS.length, 7, "the focused ecology needs exactly seven canonical characters");
assert.deepEqual(TAVERN_ECOLOGY_CHARACTER_IDS.map((id) => TAVERN_ECOLOGY_PROFILES[id].name), EXPECTED_NAMES);
assert.equal(Object.keys(TAVERN_ECOLOGY_PROFILES).length, 7);
assert.equal(getTavernEcologyProfile("missing_character"), null);
assert.deepEqual(validateTavernEcologyProfiles(), { valid: true, errors: [] });

for (const characterId of TAVERN_ECOLOGY_CHARACTER_IDS) {
  const profile = getTavernEcologyProfile(characterId);
  assert.ok(Object.isFrozen(profile), `${profile.name} profile must be immutable configuration`);
  assert.ok(profile.desires.length > 0, `${profile.name} needs at least one concrete desire`);
  if (profile.runtimeAuthority?.psychology === "validated-character-foundation") {
    assert.ok(Array.isArray(profile.duties), `${profile.name} scene duties must remain a separate collection even when currently empty`);
    assert.equal(profile.psychologyAnchor?.runtimeSurface, "character-foundation", `${profile.name} validated psychology must come from foundation`);
    assert.deepEqual(profile.runtimeAuthority.legacyPsychologyFieldsUsed, []);
    assert.deepEqual(profile.principles, [], `${profile.name} must not retain a second static principle authority`);
    assert.deepEqual(profile.boundaries, [], `${profile.name} must not retain a second static boundary authority`);
    assert.deepEqual(profile.sensitivities, [], `${profile.name} must not retain a second static sensitivity authority`);
  } else {
    assert.ok(profile.duties.length > 0, `${profile.name} needs duties kept outside desires`);
    assert.ok(profile.principles.length > 0, `${profile.name} needs principles kept outside desires`);
    assert.ok(profile.boundaries.length > 0, `${profile.name} needs boundaries kept outside desires`);
    assert.ok(profile.sensitivities.length > 0, `${profile.name} needs sensitivities kept outside desires`);
  }
  assert.equal(validateEcologyProfile(profile).valid, true, `${profile.name} profile must pass its semantic contract`);

  for (const [category, expectedKind] of Object.entries(CATEGORY_KIND)) {
    assert.ok(profile[category].every((entry) => entry.kind === expectedKind), `${profile.name}.${category} must contain only ${expectedKind}`);
  }
  for (const desire of profile.desires) {
    assert.equal(desire.polarity, "positive");
    assert.equal(desire.ownerCharacterId, characterId);
    assert.equal(desire.desiredState.subjectCharacterId, characterId);
    assert.ok(desire.target.type && desire.target.id && desire.target.label);
    assert.ok(desire.desiredState.verb && desire.desiredState.object && desire.desiredState.observableOutcome);
    assert.equal(desire.satisfactionCondition.beneficiaryCharacterId, characterId);
    assert.ok(Object.keys(desire.satisfactionCondition.criteria).length > 0);
    assert.equal(validateEcologyDesire(desire, characterId).valid, true);
  }
}

const allStatesA = createInitialTavernEcologyStates();
const allStatesB = createInitialTavernEcologyStates();
assert.deepEqual(Object.keys(allStatesA), TAVERN_ECOLOGY_CHARACTER_IDS);
for (const characterId of TAVERN_ECOLOGY_CHARACTER_IDS) {
  assert.equal(validateEcologyState(allStatesA[characterId]).valid, true, `${characterId} initial state must be valid`);
  assert.notEqual(allStatesA[characterId], allStatesB[characterId]);
  assert.notEqual(allStatesA[characterId].body, allStatesB[characterId].body);
  assert.notEqual(allStatesA[characterId].desires, allStatesB[characterId].desires);
  assert.equal(allStatesA[characterId].body.stamina, allStatesA[characterId].body.energy);
  assert.equal(allStatesA[characterId].body.fatigue, allStatesA[characterId].body.exertion);
}

const xiezenshiState = allStatesA.char_xyy_xiezenshi;
const untouchedEnergy = allStatesB.char_xyy_xiezenshi.body.energy;
const xiezenshiDesireId = TAVERN_ECOLOGY_PROFILES.char_xyy_xiezenshi.desires[0].id;
assert.equal(xiezenshiDesireId, "desire_xiezenshi_obtain_father_help_and_recover");
xiezenshiState.body.energy = 0;
xiezenshiState.desires[xiezenshiDesireId].frustration = 0.8;
assert.equal(allStatesB.char_xyy_xiezenshi.body.energy, untouchedEnergy, "state initializations must not share body references");
assert.equal(allStatesB.char_xyy_xiezenshi.desires[xiezenshiDesireId].frustration, 0, "state initializations must not share desire references");
assert.equal(TAVERN_ECOLOGY_PROFILES.char_xyy_xiezenshi.initialConditions.body.energy, untouchedEnergy, "mutable runtime state must not mutate the profile");

const arrivedLuo = createInitialEcologyState("char_xyy_luozhao", {
  elapsedSeconds: 45,
  locationId: "loc_xyy_tavern",
  zoneId: "堂前",
  observableAtStage: true,
  body: { hunger: 0.42 },
});
assert.deepEqual(arrivedLuo.presence, { locationId: "loc_xyy_tavern", zoneId: "堂前", observableAtStage: true, arrivedAtSecond: 45 });
assert.equal(arrivedLuo.body.hunger, 0.42);
assert.equal(arrivedLuo.currentIntention.intentionId, null);
assert.deepEqual(arrivedLuo.recentActionSignatures, []);
assert.equal(arrivedLuo.lastOutcome, null);

const baseDesire = clone(TAVERN_ECOLOGY_PROFILES.char_xyy_luozhao.desires[0]);

const negativeDesire = clone(baseDesire);
negativeDesire.desiredState.verb = "不接受";
assert.ok(errorCodes(validateEcologyDesire(negativeDesire, "char_xyy_luozhao")).has("DESIRE_WRITTEN_AS_RULE"));

const borrowedDesire = clone(baseDesire);
borrowedDesire.ownerCharacterId = "char_xyy_xiezenshi";
assert.ok(errorCodes(validateEcologyDesire(borrowedDesire, "char_xyy_luozhao")).has("DESIRE_NOT_SELF_OWNED"));

const vagueDesire = clone(baseDesire);
vagueDesire.desiredState.observableOutcome = "有所进展";
assert.ok(errorCodes(validateEcologyDesire(vagueDesire, "char_xyy_luozhao")).has("DESIRED_STATE_VAGUE"));

const targetlessDesire = clone(baseDesire);
delete targetlessDesire.target.id;
assert.ok(errorCodes(validateEcologyDesire(targetlessDesire, "char_xyy_luozhao")).has("DESIRE_TARGET_NOT_CONCRETE"));

const conditionlessDesire = clone(baseDesire);
delete conditionlessDesire.satisfactionCondition;
assert.ok(errorCodes(validateEcologyDesire(conditionlessDesire, "char_xyy_luozhao")).has("SATISFACTION_CONDITION_MISSING"));

const mixedProfile = clone(TAVERN_ECOLOGY_PROFILES.char_xyy_luozhao);
mixedProfile.duties = [clone(baseDesire)];
assert.ok(errorCodes(validateEcologyProfile(mixedProfile)).has("PROFILE_CATEGORY_KIND_MISMATCH"), "a desire cannot masquerade as a duty");

const shapelessBoundaryProfile = clone(TAVERN_ECOLOGY_PROFILES.char_xyy_xiemu);
delete shapelessBoundaryProfile.boundaries[0].protectedInterest;
assert.ok(errorCodes(validateEcologyProfile(shapelessBoundaryProfile)).has("BOUNDARY_SEMANTICS_MISSING"));

const brokenState = createInitialEcologyState("char_xyy_zhoumin");
delete brokenState.desires.desire_zhoumin_become_inner_court_disciple;
assert.ok(errorCodes(validateEcologyState(brokenState)).has("STATE_DESIRE_MISSING"));

console.log("tavernEcologyProfiles:test passed", {
  profiles: TAVERN_ECOLOGY_CHARACTER_IDS.length,
  desires: TAVERN_ECOLOGY_CHARACTER_IDS.reduce((count, characterId) => count + TAVERN_ECOLOGY_PROFILES[characterId].desires.length, 0),
  negativeFixtures: 8,
});
