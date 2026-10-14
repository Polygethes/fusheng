import assert from "node:assert/strict";
import {
  applyTavernEcologyOutcome,
  TAVERN_ECOLOGY_OUTCOME_VERSION,
  updateTavernEcologyState,
} from "../src/server/pipeline/tavernEcologyOutcome.mjs";
import {
  createInitialEcologyState,
  validateEcologyState,
} from "../src/server/ecology/tavernEcologyState.mjs";

const LUO = "char_xyy_luozhao";
const DUEL = "desire_luozhao_test_own_limit_against_xiezenshi";
const XIEZHENSHI = "char_xyy_xiezenshi";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function stateWithBody(body = {}) {
  return createInitialEcologyState(LUO, {
    body: {
      hunger: 0.82,
      fatigue: 0.5,
      pain: 0.04,
      stamina: 0.3,
      ...body,
    },
  });
}

assert.equal(updateTavernEcologyState, applyTavernEcologyOutcome, "integration alias should point to the pure updater");

const mealState = stateWithBody();
const mealBefore = JSON.stringify(mealState);
const afterMeal = applyTavernEcologyOutcome({
  ecologyState: deepFreeze(mealState),
  selectedCandidate: { id: "eat-hot-meal", actionKind: "eat" },
  action: { committed: true, actionKind: "eat" },
  materialConsequence: {
    id: "outcome-meal-consumed",
    foodConsumed: true,
    bodyDeltas: { hunger: -0.32, stamina: 0.12 },
  },
  elapsedSeconds: 0,
});
assert.equal(JSON.stringify(mealState), mealBefore, "outcome updater must not mutate a frozen input state");
assert.equal(afterMeal.body.hunger, 0.5, "a consumed meal must lower hunger");
assert.equal(afterMeal.body.stamina, 0.42, "a consumed meal may restore stamina from material evidence");
assert.ok(afterMeal.body.fatigue < mealState.body.fatigue, "eating should also produce its small recovery effect");
assert.equal(afterMeal.lastOutcome.status, "applied");
assert.equal(afterMeal.lastOutcome.materialConsequenceId, "outcome-meal-consumed");

const afterTea = applyTavernEcologyOutcome({
  ecologyState: stateWithBody({ thirst: 0.72 }),
  selectedCandidate: {
    id: "drink-served-tea",
    actionKind: "affordance_consume_service",
    bodyDemand: { thirstRelief: 45, exertion: 0 },
  },
  action: { committed: true, actionKind: "affordance_consume_service" },
  materialConsequence: { id: "outcome-tea-consumed", drinkConsumed: true },
  elapsedSeconds: 0,
});
assert.ok(afterTea.body.thirst < 0.55, "actually drinking served tea must lower thirst rather than only producing prose");
assert.equal(afterTea.body.hunger, 0.82, "tea must not masquerade as a meal");

const afterRest = applyTavernEcologyOutcome({
  ecologyState: stateWithBody({ fatigue: 0.78, stamina: 0.16 }),
  selectedCandidate: {
    id: "rest-on-bench",
    actionKind: "rest",
    bodyDemand: { recovery: 80 },
  },
  evaluation: { feasible: true, activationScore: 72 },
  action: { committed: true, actionKind: "rest" },
  materialConsequence: { restCompleted: true },
  elapsedSeconds: 600,
});
assert.ok(afterRest.body.fatigue < 0.6, "ten minutes of completed rest must lower high fatigue");
assert.ok(afterRest.body.stamina > 0.35, "completed rest must restore stamina");

const afterChopping = applyTavernEcologyOutcome({
  ecologyState: stateWithBody({ fatigue: 0.24, pain: 0.08, stamina: 0.74 }),
  selectedCandidate: {
    id: "chop-firewood",
    actionKind: "chop_wood",
    bodyDemand: { exertion: 72, energyDemand: 48, painRisk: 20 },
  },
  action: { status: "executed", actionKind: "chop_wood" },
  materialConsequence: { exertionCompleted: true },
  elapsedSeconds: 300,
});
assert.ok(afterChopping.body.fatigue > 0.42, "committed physical work must raise fatigue");
assert.ok(afterChopping.body.stamina < 0.51, "committed physical work must spend stamina");
assert.ok(afterChopping.body.pain > 0.1, "a non-zero pain risk must affect the completed physical outcome");

const desireState = stateWithBody();
desireState.desires[DUEL] = {
  ...desireState.desires[DUEL],
  frustration: 0.4,
  satisfaction: 0,
  cue: 0.3,
  cueActivation: 0.3,
  urgency: 0.5,
};
desireState.currentIntention = {
  ...desireState.currentIntention,
  intentionId: "intention-duel",
  sourceKind: "desire",
  sourceId: DUEL,
  driveId: DUEL,
  actionId: "ask-for-duel",
  actionKind: "ask_for_duel",
  target: { type: "character", id: XIEZHENSHI },
  targetCharacterId: XIEZHENSHI,
  utility: 0.74,
  committedAtSecond: 0,
  ageSeconds: 10,
};

const forecastIsNotProof = applyTavernEcologyOutcome({
  ecologyState: desireState,
  selectedCandidate: {
    id: "ask-for-duel",
    driveId: DUEL,
    actionKind: "ask_for_duel",
    targetCharacterId: XIEZHENSHI,
    expectedSatisfaction: 100,
  },
  evaluation: { feasible: true, activationScore: 88, expectedSatisfaction: 100 },
  action: { committed: true, actionKind: "ask_for_duel" },
  materialConsequence: {
    desireEffects: [{ driveId: DUEL, satisfactionDelta: 0.7 }],
  },
  elapsedSeconds: 15,
});
assert.equal(forecastIsNotProof.desires[DUEL].satisfaction, 0,
  "candidate forecasts and unverified satisfaction claims must never satisfy a desire");
assert.equal(forecastIsNotProof.lastOutcome.ignoredSatisfactionClaims.length, 1);
assert.equal(forecastIsNotProof.currentIntention.sourceId, DUEL,
  "acting toward the same desire should continue the intention instead of resetting it");
assert.equal(forecastIsNotProof.currentIntention.ageSeconds, 0,
  "a committed step toward the same intention should refresh its continuity clock");

const verifiedPartialProgress = applyTavernEcologyOutcome({
  ecologyState: desireState,
  selectedCandidate: { id: "agree-on-venue", driveId: DUEL, actionKind: "negotiate", targetCharacterId: XIEZHENSHI },
  evaluation: { feasible: true, activationScore: 76 },
  action: { committed: true, actionKind: "negotiate" },
  materialConsequence: {
    desireEffects: [{
      driveId: DUEL,
      satisfactionDelta: 0.25,
      satisfactionEvidence: { verified: true, eventId: "venue-agreed", kind: "partial_progress" },
    }],
  },
  elapsedSeconds: 20,
});
assert.equal(verifiedPartialProgress.desires[DUEL].satisfaction, 0.25);
assert.equal(verifiedPartialProgress.currentIntention.intentionId, "intention-duel",
  "verified partial progress must not close an intention before its satisfaction condition is met");
assert.equal(verifiedPartialProgress.lastOutcome.intentionTransition, "continued");

const verifiedDuel = applyTavernEcologyOutcome({
  ecologyState: desireState,
  selectedCandidate: {
    id: "complete-consensual-duel",
    driveId: DUEL,
    actionKind: "spar",
    targetCharacterId: XIEZHENSHI,
  },
  evaluation: { feasible: true, activationScore: 91 },
  action: { committed: true, actionKind: "spar" },
  materialConsequence: {
    id: "event-duel-completed",
    desireEffects: [{
      driveId: DUEL,
      satisfactionConditionMet: true,
      satisfactionEvidence: {
        verified: true,
        eventId: "event-duel-completed",
        kind: "mutual_duel_completed",
      },
    }],
    bodyDeltas: { fatigue: 0.18, stamina: -0.2 },
  },
  elapsedSeconds: 120,
});
assert.equal(verifiedDuel.desires[DUEL].satisfaction, 1,
  "verified satisfaction-condition evidence should satisfy the linked desire");
assert.equal(verifiedDuel.desires[DUEL].lastSatisfiedAtSecond, 120);
assert.equal(verifiedDuel.lastOutcome.satisfactionEvidence[0].evidenceId, "event-duel-completed");
assert.equal(verifiedDuel.currentIntention.intentionId, null,
  "a verified completed desire should close its current intention");
assert.equal(verifiedDuel.lastOutcome.intentionTransition, "completed");

const deferred = applyTavernEcologyOutcome({
  ecologyState: desireState,
  selectedCandidate: {
    id: "defer-duel-request",
    driveId: DUEL,
    actionKind: "defer",
    targetCharacterId: XIEZHENSHI,
  },
  evaluation: { feasible: true, activationScore: 58 },
  action: { committed: true, actionKind: "defer" },
  materialConsequence: {},
  elapsedSeconds: 45,
});
assert.equal(deferred.desires[DUEL].frustration, 0.48,
  "a real defer must increase frustration while the desire remains unsatisfied");
assert.ok(deferred.desires[DUEL].cue > 0.3, "defer should keep the blocked desire cued");
assert.ok(deferred.desires[DUEL].urgency > 0.5, "defer should increase near-term urgency modestly");
assert.equal(deferred.currentIntention.sourceId, DUEL, "defer must preserve the original intention");
assert.equal(deferred.currentIntention.actionKind, "ask_for_duel",
  "defer is an outcome, not a replacement desire or intention");
assert.equal(deferred.currentIntention.ageSeconds, 55);
assert.equal(deferred.lastOutcome.intentionTransition, "retained_while_deferred");

const passed = applyTavernEcologyOutcome({
  ecologyState: desireState,
  selectedCandidate: { id: "pass-for-now", driveId: DUEL, actionKind: "pass" },
  evaluation: { feasible: true },
  action: { committed: true, actionKind: "pass" },
  elapsedSeconds: 0,
});
assert.equal(passed.desires[DUEL].frustration, 0.44,
  "a committed pass should frustrate an unsatisfied desire less than an explicit defer");

const blockedSource = stateWithBody();
blockedSource.desires[DUEL].frustration = 0.2;
const blockedBefore = clone(blockedSource);
const blocked = applyTavernEcologyOutcome({
  ecologyState: blockedSource,
  selectedCandidate: {
    id: "draw-sword-in-hall",
    driveId: DUEL,
    actionKind: "fight",
    bodyDemand: { exertion: 100, painRisk: 100 },
  },
  evaluation: {
    feasible: false,
    hardGates: [{ id: "weapons-permitted", passed: false }],
  },
  action: { committed: true, actionKind: "fight" },
  materialConsequence: {
    bodyDeltas: { fatigue: 1, pain: 1, stamina: -1 },
    satisfactionConditionMet: true,
    satisfactionEvidence: { verified: true, eventId: "impossible-event" },
  },
  elapsedSeconds: 0,
});
assert.deepEqual(blocked.body, blockedBefore.body, "failed hard gates must not create forecast body costs");
assert.deepEqual(blocked.desires, blockedBefore.desires, "failed hard gates must not create satisfaction or frustration");
assert.deepEqual(blocked.recentActionSignatures, blockedBefore.recentActionSignatures,
  "a gated-out candidate was never an action and must not enter repetition history");
assert.equal(blocked.lastOutcome.status, "blocked");
assert.deepEqual(blocked.lastOutcome.failedGates, ["weapons-permitted"]);

const uncommittedSource = stateWithBody();
const uncommittedBefore = clone(uncommittedSource);
const uncommitted = applyTavernEcologyOutcome({
  ecologyState: uncommittedSource,
  selectedCandidate: { id: "imagined-meal", driveId: DUEL, actionKind: "eat" },
  evaluation: { feasible: true, activationScore: 95 },
  action: { actionKind: "eat", visibleAction: "端起饭碗" },
  materialConsequence: {
    bodyDeltas: { hunger: -0.8, stamina: 0.8 },
    desireEffects: [{
      driveId: DUEL,
      satisfactionConditionMet: true,
      satisfactionEvidence: { verified: true, eventId: "not-committed" },
    }],
  },
  elapsedSeconds: 0,
});
assert.deepEqual(uncommitted.body, uncommittedBefore.body,
  "a generated action description without executor commitment must have no body effect");
assert.deepEqual(uncommitted.desires, uncommittedBefore.desires,
  "a generated action description without executor commitment must have no desire effect");
assert.equal(uncommitted.lastOutcome.status, "uncommitted");
assert.equal(uncommitted.lastOutcome.applied, false);

const historySource = stateWithBody();
historySource.recentActionSignatures = Array.from({ length: 12 }, (_, index) => `old-${index}`);
const withCappedHistory = applyTavernEcologyOutcome({
  ecologyState: historySource,
  selectedCandidate: { id: "observe-sword-form", driveId: DUEL, actionKind: "observe", targetCharacterId: XIEZHENSHI },
  evaluation: { feasible: true, activationScore: 61 },
  action: { committed: true, actionKind: "observe" },
});
assert.equal(withCappedHistory.recentActionSignatures.length, 12);
assert.equal(withCappedHistory.recentActionSignatures.includes("old-0"), false);
assert.equal(withCappedHistory.recentActionSignatures.at(-1), `observe-sword-form|${DUEL}|${XIEZHENSHI}`);
assert.equal(withCappedHistory.lastOutcome.schemaVersion, TAVERN_ECOLOGY_OUTCOME_VERSION);

const stateValidation = validateEcologyState(verifiedDuel);
assert.equal(stateValidation.valid, true, JSON.stringify(stateValidation.errors));

console.log("tavernEcologyOutcome:test passed", {
  bodyActions: 3,
  desireEvidenceCases: 2,
  blockedAndUncommittedCases: 2,
  schemaVersion: TAVERN_ECOLOGY_OUTCOME_VERSION,
});
