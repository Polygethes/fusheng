import assert from "node:assert/strict";
import {
  ACTION_UTILITY_FORMULA_VERSION,
  scoreActionCandidates,
} from "../src/server/simulation/actionUtility.mjs";

const ACTOR_ID = "phase59_actor";
const TARGET_ID = "phase59_target";

const CANDIDATES = [
  {
    id: "triggered_confrontation",
    targetCharacterId: TARGET_ID,
    actionKind: "confront_target",
    factors: {
      desire: 0.25,
      duty: 0,
      opportunity: 0.6,
      relationshipPull: 0,
      emotionalPull: 0,
      traumaDrive: 1,
      commitmentPressure: 0,
      safetyCost: 0.05,
      bodyCost: 0,
      environmentFriction: 0,
      socialInhibition: 0,
      relationshipHarmCost: 0.08,
    },
  },
  {
    id: "grounded_pause",
    targetCharacterId: TARGET_ID,
    actionKind: "pause_before_reply",
    factors: {
      desire: 0.42,
      duty: 0.25,
      opportunity: 0.25,
      relationshipPull: 0.05,
      emotionalPull: 0,
      traumaDrive: 0,
      commitmentPressure: 0,
      safetyCost: 0,
      bodyCost: 0.03,
      environmentFriction: 0,
      socialInhibition: 0,
      relationshipHarmCost: 0,
    },
  },
];

const BASE_ACTOR = {
  id: ACTOR_ID,
  traits: {
    impulsivity: 0.9,
    attachmentSensitivity: 0.8,
    conscientiousness: 0.5,
    caution: 0.3,
  },
  weights: {
    desire: 1,
    duty: 0.3,
    opportunity: 0.4,
    relationshipPull: 0.6,
    emotionalPull: 0.5,
    traumaDrive: 1.5,
    commitmentPressure: 1,
    safetyCost: 0.5,
    bodyCost: 0.3,
    environmentFriction: 0.4,
    socialInhibition: 0.4,
    relationshipHarmCost: 0.8,
    switchingCost: 0.2,
    repetitionPenalty: 0.2,
  },
};

const ACTIVE_STATE = { arousal: 0.9, traumaActivation: 0.9, fatigue: 0.1 };
const LOWER_AROUSAL_STATE = { arousal: 0.2, traumaActivation: 0.9, fatigue: 0.1 };
const CALM_STATE = { arousal: 0.2, traumaActivation: 0.05, fatigue: 0.1 };

const DISTANT_FORWARD = [{
  fromCharacterId: ACTOR_ID,
  toCharacterId: TARGET_ID,
  closeness: 0.05,
  trust: 0.05,
  care: 0.05,
}];

const CLOSE_FORWARD = [{
  fromCharacterId: ACTOR_ID,
  toCharacterId: TARGET_ID,
  closeness: 0.92,
  trust: 0.88,
  care: 0.9,
}];

const CLOSE_REVERSE_ONLY = [{
  fromCharacterId: TARGET_ID,
  toCharacterId: ACTOR_ID,
  closeness: 0.99,
  trust: 0.99,
  care: 0.99,
}];

const BASE_CONTEXT = {
  sceneId: "phase59_formula_scene",
  atmosphere: { privacy: 0.8, crowding: 0.05, danger: 0 },
  pendingInteractions: [],
};

function appraisal(state, relationships) {
  return scoreActionCandidates({
    actor: { ...BASE_ACTOR, state: { ...state } },
    candidates: structuredClone(CANDIDATES),
    context: { ...BASE_CONTEXT, relationships: structuredClone(relationships) },
  });
}

function row(result, candidateId) {
  const found = (result.evaluations || []).find((candidate) => candidate.candidateId === candidateId);
  assert.ok(found, `missing candidate ${candidateId}`);
  return found;
}

function factor(result, candidateId, factorId) {
  const found = (row(result, candidateId).factorLedger || []).find((entry) => entry.id === factorId);
  assert.ok(found, `missing ${candidateId}.${factorId}`);
  return found;
}

const activeDistant = appraisal(ACTIVE_STATE, DISTANT_FORWARD);
const activeClose = appraisal(ACTIVE_STATE, CLOSE_FORWARD);
const activeNoRelationship = appraisal(ACTIVE_STATE, []);
const activeReverseOnly = appraisal(ACTIVE_STATE, CLOSE_REVERSE_ONLY);
const lowerArousalClose = appraisal(LOWER_AROUSAL_STATE, CLOSE_FORWARD);
const calmClose = appraisal(CALM_STATE, CLOSE_FORWARD);

for (const result of [
  activeDistant,
  activeClose,
  activeNoRelationship,
  activeReverseOnly,
  lowerArousalClose,
  calmClose,
]) {
  assert.equal(result.formulaVersion, ACTION_UTILITY_FORMULA_VERSION);
}

const distantTrauma = factor(activeDistant, "triggered_confrontation", "traumaDrive");
const closeTrauma = factor(activeClose, "triggered_confrontation", "traumaDrive");
const noRelationshipTrauma = factor(activeNoRelationship, "triggered_confrontation", "traumaDrive");
const reverseOnlyTrauma = factor(activeReverseOnly, "triggered_confrontation", "traumaDrive");
const lowerArousalTrauma = factor(lowerArousalClose, "triggered_confrontation", "traumaDrive");
const calmTrauma = factor(calmClose, "triggered_confrontation", "traumaDrive");

// The only changed input here is ACTOR_ID -> TARGET_ID relationship strength.
assert.equal(distantTrauma.rawValue, closeTrauma.rawValue);
assert.equal(distantTrauma.traumaActivation, closeTrauma.traumaActivation);
assert.equal(distantTrauma.arousal, closeTrauma.arousal);
assert.ok(
  closeTrauma.effectiveValue < distantTrauma.effectiveValue,
  `forward closeness/trust must buffer traumaDrive: ${JSON.stringify({ distantTrauma, closeTrauma }, null, 2)}`,
);
assert.ok(
  closeTrauma.effectiveValue > 0 && closeTrauma.contribution > 0,
  `an active trigger must retain non-zero traumaDrive after relationship regulation: ${JSON.stringify(closeTrauma, null, 2)}`,
);
assert.ok(closeTrauma.relationshipBuffer > 0);
assert.ok(closeTrauma.retainedAfterBuffer >= 0.15);

// TARGET_ID -> ACTOR_ID cannot be borrowed as if it were ACTOR_ID -> TARGET_ID.
assert.deepEqual(reverseOnlyTrauma, noRelationshipTrauma);
assert.equal(
  row(activeReverseOnly, "triggered_confrontation").score,
  row(activeNoRelationship, "triggered_confrontation").score,
);

// Relationship is fixed; changing current affect first, then trigger activation,
// must change the trauma factor and eventually reverse the action ordering.
assert.ok(closeTrauma.effectiveValue > lowerArousalTrauma.effectiveValue);
assert.ok(lowerArousalTrauma.effectiveValue > calmTrauma.effectiveValue);
assert.equal(closeTrauma.traumaActivation, lowerArousalTrauma.traumaActivation);
assert.notEqual(closeTrauma.arousal, lowerArousalTrauma.arousal);
assert.equal(lowerArousalTrauma.arousal, calmTrauma.arousal);
assert.notEqual(lowerArousalTrauma.traumaActivation, calmTrauma.traumaActivation);
assert.equal(activeClose.selectedCandidateId, "triggered_confrontation");
assert.equal(calmClose.selectedCandidateId, "grounded_pause");
assert.ok(
  row(activeClose, "triggered_confrontation").score
    > row(calmClose, "triggered_confrontation").score,
);

console.log("tavernPhase59RelationshipTraumaFormula:test passed", {
  formulaVersion: activeClose.formulaVersion,
  forwardBuffer: {
    distant: {
      effectiveValue: distantTrauma.effectiveValue,
      contribution: distantTrauma.contribution,
      relationshipAffinity: distantTrauma.relationshipAffinity,
      relationshipBuffer: distantTrauma.relationshipBuffer,
      retainedAfterBuffer: distantTrauma.retainedAfterBuffer,
    },
    close: {
      effectiveValue: closeTrauma.effectiveValue,
      contribution: closeTrauma.contribution,
      relationshipAffinity: closeTrauma.relationshipAffinity,
      relationshipBuffer: closeTrauma.relationshipBuffer,
      retainedAfterBuffer: closeTrauma.retainedAfterBuffer,
    },
  },
  directionality: {
    noRelationshipScore: row(activeNoRelationship, "triggered_confrontation").score,
    reverseOnlyScore: row(activeReverseOnly, "triggered_confrontation").score,
    reverseOnlyRelationshipAffinity: reverseOnlyTrauma.relationshipAffinity,
  },
  currentState: {
    active: {
      arousal: closeTrauma.arousal,
      traumaActivation: closeTrauma.traumaActivation,
      traumaContribution: closeTrauma.contribution,
      selectedCandidateId: activeClose.selectedCandidateId,
      confrontationScore: row(activeClose, "triggered_confrontation").score,
    },
    lowerArousal: {
      arousal: lowerArousalTrauma.arousal,
      traumaActivation: lowerArousalTrauma.traumaActivation,
      traumaContribution: lowerArousalTrauma.contribution,
      selectedCandidateId: lowerArousalClose.selectedCandidateId,
      confrontationScore: row(lowerArousalClose, "triggered_confrontation").score,
    },
    calm: {
      arousal: calmTrauma.arousal,
      traumaActivation: calmTrauma.traumaActivation,
      traumaContribution: calmTrauma.contribution,
      selectedCandidateId: calmClose.selectedCandidateId,
      confrontationScore: row(calmClose, "triggered_confrontation").score,
    },
  },
});
