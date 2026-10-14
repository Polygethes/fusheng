import assert from "node:assert/strict";

import {
  advanceCharacterPhysiologyTo,
  applySettledCharacterActionPhysiology,
} from "../src/server/simulation/characterPhysiologyContinuity.mjs";

const initial = {
  elapsedSeconds: 0,
  body: {
    energy: 0.72,
    stamina: 0.72,
    hunger: 0.2,
    thirst: 0.18,
    fatigue: 0.12,
    exertion: 0.12,
    pain: 0.08,
  },
};

const sixHours = advanceCharacterPhysiologyTo({
  ecologyState: initial,
  lastWorldSyncSeconds: 0,
  targetWorldSeconds: 21_600,
});
assert.equal(sixHours.lastWorldSyncSeconds, 21_600);
assert.equal(sixHours.ecologyState.elapsedSeconds, 21_600);
assert.ok(sixHours.ecologyState.body.hunger > initial.body.hunger);
assert.ok(sixHours.ecologyState.body.thirst > initial.body.thirst);
assert.ok(sixHours.ecologyState.body.fatigue > initial.body.fatigue);
assert.ok(sixHours.ecologyState.body.stamina < initial.body.stamina);
assert.equal(sixHours.ecologyState.body.energy, sixHours.ecologyState.body.stamina);
assert.equal(sixHours.ecologyState.body.exertion, sixHours.ecologyState.body.fatigue);

const duplicate = advanceCharacterPhysiologyTo({
  ecologyState: sixHours.ecologyState,
  lastWorldSyncSeconds: sixHours.lastWorldSyncSeconds,
  targetWorldSeconds: 21_600,
});
assert.deepEqual(duplicate, sixHours, "the same world-time boundary is idempotent");

const backward = advanceCharacterPhysiologyTo({
  ecologyState: sixHours.ecologyState,
  lastWorldSyncSeconds: sixHours.lastWorldSyncSeconds,
  targetWorldSeconds: 100,
});
assert.deepEqual(backward, sixHours, "a stale world time may not reverse private physiology");

const rested = applySettledCharacterActionPhysiology({
  ecologyState: sixHours.ecologyState,
  actionOutcome: { status: "success", primitive: "rest", durationSeconds: 1_800 },
});
assert.ok(rested.body.fatigue < sixHours.ecologyState.body.fatigue);
assert.ok(rested.body.stamina > sixHours.ecologyState.body.stamina);

const practiced = applySettledCharacterActionPhysiology({
  ecologyState: sixHours.ecologyState,
  actionOutcome: { status: "success", primitive: "practice", durationSeconds: 1_800 },
});
assert.ok(practiced.body.fatigue > sixHours.ecologyState.body.fatigue);
assert.ok(practiced.body.stamina < sixHours.ecologyState.body.stamina);
assert.ok(practiced.body.thirst > sixHours.ecologyState.body.thirst);

const failed = applySettledCharacterActionPhysiology({
  ecologyState: sixHours.ecologyState,
  actionOutcome: { status: "failed", primitive: "practice", durationSeconds: 1_800 },
});
assert.deepEqual(failed, sixHours.ecologyState, "a failed action may not receive the physiology of completed practice");

console.log("character physiology continuity contracts passed");
