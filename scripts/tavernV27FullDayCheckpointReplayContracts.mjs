import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernV27DeterministicLifeStageRunner } from "../src/server/pipeline/tavernV27DeterministicLifeStage.mjs";
import { createTavernWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { validateWorldEventJournal } from "../src/server/simulation/worldEventJournal.mjs";

const CHARACTER_IDS = [
  "char_xyy_xiezenshi",
  "char_xyy_luozhao",
  "char_xyy_zhoumin",
];
const WORLD_ID = "world:xyy:tavern:v27:full-day-checkpoint-replay";
const MIDPOINT_SECONDS = 43_200;
const HORIZON_SECONDS = 86_400;
const MAX_TURNS = 240;

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});

function freshLifeStage() {
  return createTavernV27DeterministicLifeStageRunner({
    horizonSeconds: HORIZON_SECONDS,
    cadenceSeconds: 21_600,
  });
}

function createRuntime({ checkpoint = null, runStage = freshLifeStage() } = {}) {
  return createTavernWorldRuntimeV27(state, {
    characterIds: CHARACTER_IDS,
    positions: Object.fromEntries(CHARACTER_IDS.map((id) => [id, "hall"])),
    worldId: WORLD_ID,
    checkpoint,
    enableDayPlanning: true,
    runStage,
  });
}

function byCharacterId(rows = []) {
  return [...rows].sort((left, right) => left.characterId.localeCompare(right.characterId));
}

function semanticJournal(journal = {}) {
  return {
    ...structuredClone(journal),
    events: (journal.events || []).map((event) => ({
      ...structuredClone(event),
      // `committedAt` records host wall-clock observability, not simulated
      // causality. Its integrity digest necessarily changes with that field
      // across two independent process lifetimes; each original journal is
      // still validated during coordinator creation/restoration.
      committedAt: "<non-semantic-host-clock>",
      integrity: {
        algorithm: event.integrity?.algorithm,
        digest: "<derived-from-host-clock>",
      },
    })),
  };
}

async function runUninterrupted() {
  const instance = createRuntime();
  const run = await instance.runtime.runUntilWorldTime({
    targetSeconds: HORIZON_SECONDS,
    maxTurns: MAX_TURNS,
  });
  return {
    run,
    checkpoint: await instance.runtime.checkpoint(),
  };
}

async function runAcrossCheckpoint() {
  const beforeInstance = createRuntime();
  const before = await beforeInstance.runtime.runUntilWorldTime({
    targetSeconds: MIDPOINT_SECONDS,
    maxTurns: MAX_TURNS,
  });
  assert.equal(before.reachedTarget, true, "the first process must reach the requested checkpoint boundary");
  assert.equal(before.endedByTurnLimit, false);
  const midpointCheckpoint = await beforeInstance.runtime.checkpoint();

  // Restoration deliberately receives a newly-created provider. Any behavior
  // that depends on an in-memory stage closure rather than the checkpoint must
  // therefore diverge from the uninterrupted control run.
  const afterInstance = createRuntime({
    checkpoint: structuredClone(midpointCheckpoint),
    runStage: freshLifeStage(),
  });
  const after = await afterInstance.runtime.runUntilWorldTime({
    targetSeconds: HORIZON_SECONDS,
    maxTurns: MAX_TURNS - before.turns.length,
  });
  return {
    before,
    after,
    turns: [...before.turns, ...after.turns],
    midpointCheckpoint,
    checkpoint: await afterInstance.runtime.checkpoint(),
  };
}

const uninterrupted = await runUninterrupted();
const replayed = await runAcrossCheckpoint();

assert.equal(uninterrupted.run.reachedTarget, true);
assert.equal(uninterrupted.run.endedByTurnLimit, false);
assert.equal(replayed.after.reachedTarget, true);
assert.equal(replayed.after.endedByTurnLimit, false);
assert.equal(validateWorldEventJournal(uninterrupted.checkpoint.coordinator.journal).valid, true);
assert.equal(validateWorldEventJournal(replayed.checkpoint.coordinator.journal).valid, true);

assert.deepEqual(
  replayed.checkpoint.coordinator.worldState,
  uninterrupted.checkpoint.coordinator.worldState,
  "checkpoint restoration must produce the same final objective world",
);
assert.deepEqual(
  semanticJournal(replayed.checkpoint.coordinator.journal),
  semanticJournal(uninterrupted.checkpoint.coordinator.journal),
  "checkpoint restoration must preserve the exact semantic objective event history",
);
assert.deepEqual(
  replayed.checkpoint.coordinator.outcomes,
  uninterrupted.checkpoint.coordinator.outcomes,
  "checkpoint restoration must preserve idempotent world settlement records",
);

const uninterruptedActors = byCharacterId(uninterrupted.checkpoint.actors);
const replayedActors = byCharacterId(replayed.checkpoint.actors);
assert.deepEqual(
  replayedActors.map((row) => row.privateState),
  uninterruptedActors.map((row) => row.privateState),
  "every Character must restore the same private memory, plans, physiology, dialogue, and reflection state",
);
assert.deepEqual(
  replayedActors.map((row) => ({
    characterId: row.characterId,
    mailbox: row.mailbox,
    privateJournal: row.privateJournal,
    seenWakeIds: row.seenWakeIds,
    pendingAttemptIds: row.pendingAttemptIds,
    unforwardedWakeIds: row.unforwardedWakeIds,
    turnSequence: row.turnSequence,
    runtimeCheckpoint: row.runtimeCheckpoint,
  })),
  uninterruptedActors.map((row) => ({
    characterId: row.characterId,
    mailbox: row.mailbox,
    privateJournal: row.privateJournal,
    seenWakeIds: row.seenWakeIds,
    pendingAttemptIds: row.pendingAttemptIds,
    unforwardedWakeIds: row.unforwardedWakeIds,
    turnSequence: row.turnSequence,
    runtimeCheckpoint: row.runtimeCheckpoint,
  })),
  "Actor mailboxes, causal journals, turn counters, and serializable runtime state must replay exactly",
);
assert.deepEqual(
  replayed.checkpoint.receiptLedger,
  uninterrupted.checkpoint.receiptLedger,
  "delivered/noticed/appraised/consumed evidence receipts must replay exactly",
);
assert.deepEqual(
  replayed.checkpoint.readyQueue,
  uninterrupted.checkpoint.readyQueue,
  "the restored day must finish at the same clean Actor boundary",
);
assert.deepEqual(
  replayed.turns,
  uninterrupted.run.turns,
  "the two process lifetimes must compose into the same participant-owned causal turn sequence",
);

console.log(JSON.stringify({
  status: "all-passed",
  gate: "tavern-v27-full-day-checkpoint-replay",
  midpointSeconds: replayed.midpointCheckpoint.coordinator.worldState.nowSeconds,
  horizonSeconds: replayed.checkpoint.coordinator.worldState.nowSeconds,
  uninterruptedTurns: uninterrupted.run.turns.length,
  replayedTurns: replayed.turns.length,
  worldEvents: replayed.checkpoint.coordinator.journal.events.length,
}, null, 2));
