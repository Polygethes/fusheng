import assert from "node:assert/strict";
import { createInitialEcologyState, validateEcologyState } from "../src/server/ecology/tavernEcologyState.mjs";
import { getTavernEcologyProfile } from "../src/server/ecology/tavernEcologyProfile.mjs";
import {
  advanceTavernEcologyTime,
  appraiseTavernPerceivedEvent,
  applyTavernEventAppraisal,
} from "../src/server/ecology/tavernEventAppraisal.mjs";

const fatherId = "char_xyy_xieheng";
const contrastId = "char_xyy_xiemu";
const fatherProfile = getTavernEcologyProfile(fatherId);
const contrastProfile = getTavernEcologyProfile(contrastId);

function moneyQuestionEvent(recipientId = fatherId, overrides = {}) {
  const impact = {
    id: overrides.id || "impact_public_money_question",
    sourceCharacterId: "char_xyy_xiemu",
    type: "speech",
    modality: "sound",
    content: "当着众人的面追问药钱到底从哪里来，请现在说清。",
    cueIds: ["public_question_about_money", "public_scrutiny", "forced_answer"],
    committed: true,
    outcomeValence: -0.45,
    threat: 0.55,
    publicness: 0.9,
    controlDelta: -0.4,
    repairOpportunity: 0.4,
    ...overrides,
  };
  return {
    impact,
    delivery: {
      impactId: impact.id,
      recipientId,
      sourceCharacterId: impact.sourceCharacterId,
      receivedIntensity: 82,
      impactScore: 128,
      directed: true,
      content: impact.content,
    },
  };
}

const fatherState = createInitialEcologyState(fatherProfile, { observableAtStage: true });
const originalFatherState = structuredClone(fatherState);
const moneyEvent = moneyQuestionEvent();
const trusted = appraiseTavernPerceivedEvent({
  profile: fatherProfile,
  ecologyState: fatherState,
  ...moneyEvent,
  relationship: { closeness: 0.9, trust: 0.92, tension: 0.08, resentment: 0.04, fear: 0.03 },
  elapsedSeconds: 0,
});
const tense = appraiseTavernPerceivedEvent({
  profile: fatherProfile,
  ecologyState: fatherState,
  ...moneyEvent,
  relationship: { closeness: 0.22, trust: 0.1, tension: 0.88, resentment: 0.82, fear: 0.7 },
  elapsedSeconds: 0,
});

assert.deepEqual(fatherState, originalFatherState, "appraisal must not mutate its input state");
assert.equal(trusted.applied, true);
assert.equal(tense.applied, true);
assert.equal(validateEcologyState(trusted.nextState, fatherProfile).valid, true, "the updated state must remain compatible with the ecology-state schema");
assert.ok(
  tense.nextState.sensitivityActivations.sensitivity_xieheng_public_money_question.activation
    > trusted.nextState.sensitivityActivations.sensitivity_xieheng_public_money_question.activation,
  "the same cue must activate more strongly inside a tense relationship",
);
assert.ok(trusted.copingBias.repair > tense.copingBias.repair, "trust and closeness must increase repair bias");
assert.ok(
  tense.copingBias.assert + tense.copingBias.avoid > trusted.copingBias.assert + trusted.copingBias.avoid,
  "tension and fear must shift coping toward assertion or avoidance",
);

const contrastEvent = moneyQuestionEvent(contrastId, {
  id: "impact_same_pressure_for_contrast_profile",
  cueIds: ["crowded_tavern"],
});
const contrastResult = appraiseTavernPerceivedEvent({
  profile: contrastProfile,
  ecologyState: createInitialEcologyState(contrastProfile, { observableAtStage: true }),
  ...contrastEvent,
  relationship: { closeness: 0.9, trust: 0.92, tension: 0.08 },
  elapsedSeconds: 0,
});
assert.equal(
  contrastResult.observerTrace.sensitivities.find((entry) => entry.sensitivityId === "sensitivity_xiemu_service_overload").matchedCueIds.includes("crowded_tavern"),
  true,
  "the comparison profile must match its own named service-overload sensitivity",
);
assert.equal(
  trusted.observerTrace.sensitivities.find((entry) => entry.sensitivityId === "sensitivity_xieheng_public_money_question").matchedCueIds.includes("public_question_about_money"),
  true,
  "the same words must match the father's different named sensitivity",
);
const crossProfileCopingDistance = ["approach", "avoid", "assert", "inhibit", "repair"]
  .reduce((sum, key) => sum + Math.abs(contrastResult.copingBias[key] - trusted.copingBias[key]), 0);
assert.ok(crossProfileCopingDistance > 0.05, "different personality and sensitivity profiles must produce a materially different coping distribution");

const activated = tense.nextState.sensitivityActivations.sensitivity_xieheng_public_money_question.activation;
const neutralEvent = moneyQuestionEvent(fatherId, {
  id: "impact_neutral_after_half_life",
  content: "柜台旁落下一点无关紧要的灰。",
  cueIds: [],
  outcomeValence: 0,
  threat: 0,
  publicness: 0,
  controlDelta: 0,
  repairOpportunity: 0,
  salience: 0,
});
neutralEvent.delivery.content = neutralEvent.impact.content;
neutralEvent.delivery.receivedIntensity = 0;
neutralEvent.delivery.impactScore = 0;
const decayed = appraiseTavernPerceivedEvent({
  profile: fatherProfile,
  ecologyState: tense.nextState,
  ...neutralEvent,
  relationship: {},
  elapsedSeconds: 1500,
});
assert.ok(
  Math.abs(decayed.nextState.sensitivityActivations.sensitivity_xieheng_public_money_question.activation - activated / 2) < 1e-5,
  "a sensitivity must halve after its configured recovery half-life without a matching cue",
);
assert.equal(validateEcologyState(decayed.nextState, fatherProfile).valid, true);

const unperceived = appraiseTavernPerceivedEvent({
  profile: fatherProfile,
  ecologyState: fatherState,
  delivery: null,
  impact: moneyEvent.impact,
  relationship: {},
  elapsedSeconds: 90,
});
assert.equal(unperceived.applied, false);
assert.equal(unperceived.reason, "unperceived");
assert.deepEqual(unperceived.nextState, fatherState, "an unperceived event must not update affect or decay state");

const uncommittedEvent = moneyQuestionEvent(fatherId, { id: "impact_uncommitted", committed: false });
const uncommitted = appraiseTavernPerceivedEvent({
  profile: fatherProfile,
  ecologyState: fatherState,
  ...uncommittedEvent,
  relationship: {},
  elapsedSeconds: 90,
});
assert.equal(uncommitted.applied, false);
assert.equal(uncommitted.reason, "uncommitted");
assert.deepEqual(uncommitted.nextState, fatherState, "an uncommitted action must not update private state");

const duplicate = appraiseTavernPerceivedEvent({
  profile: fatherProfile,
  ecologyState: trusted.nextState,
  ...moneyEvent,
  relationship: {},
  elapsedSeconds: 90,
});
assert.equal(duplicate.applied, false);
assert.equal(duplicate.reason, "duplicate-impact");
assert.deepEqual(duplicate.nextState, trusted.nextState, "the same perceived impact id must be idempotent");

const manuallyApplied = applyTavernEventAppraisal(fatherState, {
  affect: { arousal: 0.77 },
  copingBiases: { dominant: "assert", assert: 1 },
});
assert.equal(manuallyApplied.affect.arousal, 0.77);
assert.equal(manuallyApplied.affect.valence, fatherState.affect.valence, "patch application must preserve unaffected affect fields");
assert.equal(manuallyApplied.copingBiases.dominant, "assert");
assert.equal("observerTrace" in trusted.nextState, false, "observer-only factors must never be stored in private ecology state");

const timeAdvanced = advanceTavernEcologyTime({
  profile: fatherProfile,
  ecologyState: tense.nextState,
  elapsedSeconds: 1500,
});
assert.equal(
  timeAdvanced.attention.perceivedEventIds.length,
  tense.nextState.attention.perceivedEventIds.length,
  "time decay must not invent a perceived event",
);
assert.ok(
  Math.abs(timeAdvanced.sensitivityActivations.sensitivity_xieheng_public_money_question.activation - activated / 2) < 1e-5,
  "passive time advancement must decay sensitivity at the configured half-life",
);
assert.equal(timeAdvanced.elapsedSeconds, tense.nextState.elapsedSeconds + 1500);
assert.equal(validateEcologyState(timeAdvanced, fatherProfile).valid, true);

console.log("tavernEventAppraisal:test passed", {
  trustedDominant: trusted.copingBias.dominant,
  tenseDominant: tense.copingBias.dominant,
  contrastDominant: contrastResult.copingBias.dominant,
  activated,
  decayed: decayed.nextState.sensitivityActivations.sensitivity_xieheng_public_money_question.activation,
});
