import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";

const CHARACTER_ID = "char_xyy_xiezenshi";
const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
const observedBodies = [];
const fixture = createTavernV27FixtureStageRunner({
  planForTurn: (input) => {
    observedBodies.push(structuredClone(input.privateContext.state.body));
    return {
      intention: "先感受身体和眼前处境，再决定是否行动",
      primitive: "none",
      targetId: "",
      utterance: "",
      visibleAction: "",
      texture: [],
      privateBasis: "身体状态属于本人当前判断的一部分。",
      continuationIntentions: [],
    };
  },
});
const instance = createTavernWorldRuntimeV27(state, {
  characterIds: [CHARACTER_ID],
  positions: { [CHARACTER_ID]: "hall" },
  worldId: "world:xyy:tavern:v27:physiology-runtime",
  runStage: fixture,
});
const initialCheckpoint = await instance.runtime.checkpoint();
const initialBody = initialCheckpoint.actors[0].privateState.ecologyState.body;

const quietAdvance = await instance.runtime.runUntilWorldTime({
  targetSeconds: 21_600,
  maxTurns: 10,
});
assert.equal(quietAdvance.reachedTarget, true);
assert.equal(quietAdvance.turns.length, 0);
await instance.runtime.enqueueWake(CHARACTER_ID, {
  wakeId: "wake:physiology:six-hours",
  kind: "internal_pressure",
  causeType: "internal_pressure",
  evidenceIds: [],
  evidence: [],
});
const firstTurn = await instance.runtime.runNext();
assert.ok(firstTurn);
assert.ok(observedBodies.length > 0);
const bodySeenByCharacter = observedBodies[0];
assert.ok(bodySeenByCharacter.hunger > initialBody.hunger);
assert.ok(bodySeenByCharacter.thirst > initialBody.thirst);
assert.ok(bodySeenByCharacter.fatigue > initialBody.fatigue);
assert.ok(bodySeenByCharacter.stamina < initialBody.stamina);
assert.equal(bodySeenByCharacter.energy, bodySeenByCharacter.stamina);
assert.equal(bodySeenByCharacter.exertion, bodySeenByCharacter.fatigue);

let checkpoint = await instance.runtime.checkpoint();
assert.equal(checkpoint.actors[0].privateState.physiologyState.lastWorldSyncSeconds, 21_600);
assert.equal(checkpoint.actors[0].privateState.ecologyState.elapsedSeconds, 21_600);
const bodyAfterFirstSync = structuredClone(checkpoint.actors[0].privateState.ecologyState.body);

await instance.runtime.enqueueWake(CHARACTER_ID, {
  wakeId: "wake:physiology:same-boundary",
  kind: "internal_pressure",
  causeType: "internal_pressure",
  evidenceIds: [],
  evidence: [],
});
await instance.runtime.runNext();
checkpoint = await instance.runtime.checkpoint();
assert.deepEqual(
  checkpoint.actors[0].privateState.ecologyState.body,
  bodyAfterFirstSync,
  "two thoughts at one objective time may not double-age the same body",
);
assert.equal(checkpoint.actors[0].privateState.ecologyState.elapsedSeconds, 21_600);

const legacyCheckpoint = structuredClone(checkpoint);
delete legacyCheckpoint.actors[0].privateState.physiologyState;
const legacyRestored = createTavernWorldRuntimeV27(state, {
  characterIds: [CHARACTER_ID],
  positions: { [CHARACTER_ID]: "hall" },
  worldId: "world:xyy:tavern:v27:physiology-runtime",
  checkpoint: legacyCheckpoint,
  runStage: fixture,
});
await legacyRestored.runtime.enqueueWake(CHARACTER_ID, {
  wakeId: "wake:physiology:legacy-checkpoint-boundary",
  kind: "internal_pressure",
  causeType: "internal_pressure",
  evidenceIds: [],
  evidence: [],
});
await legacyRestored.runtime.runNext();
const migratedLegacyCheckpoint = await legacyRestored.runtime.checkpoint();
assert.deepEqual(
  migratedLegacyCheckpoint.actors[0].privateState.ecologyState.body,
  bodyAfterFirstSync,
  "a pre-physiology-clock checkpoint must adopt its existing elapsed boundary instead of aging twice",
);
assert.equal(
  migratedLegacyCheckpoint.actors[0].privateState.physiologyState.lastWorldSyncSeconds,
  21_600,
);

console.log("tavern v2.7 physiology runtime contracts passed");
