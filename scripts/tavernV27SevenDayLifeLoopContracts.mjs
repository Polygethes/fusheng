import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { auditCharacterLongHorizonContinuity } from "../src/server/evaluation/characterLongHorizonContinuity.mjs";
import { createTavernV27DeterministicLifeStageRunner } from "../src/server/pipeline/tavernV27DeterministicLifeStage.mjs";
import {
  createTavernWorldRuntimeV27,
  projectTavernWorldRuntimeV27ForObserver,
} from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { validateWorldEventJournal } from "../src/server/simulation/worldEventJournal.mjs";
import { waitMatchesWake } from "../src/server/simulation/characterExecutionControl.mjs";

const CHARACTER_IDS = [
  "char_xyy_xiezenshi",
  "char_xyy_luozhao",
  "char_xyy_zhoumin",
];
const DAY_SECONDS = 86_400;
const HORIZON_DAYS = 7;
const HORIZON_SECONDS = HORIZON_DAYS * DAY_SECONDS;
const CHECKPOINT_SECONDS = 3 * DAY_SECONDS;
const MAX_TURNS = 2_000;
const EXPECTED_DAY_INDICES = Array.from({ length: HORIZON_DAYS }, (_, index) => index);

const MEMORY_LIMITS = Object.freeze({
  experienceTraces: 128,
  episodes: 96,
  beliefs: 64,
  commitments: 40,
  impressions: 32,
  privateEntityModels: 48,
  locationBeliefs: 40,
  sourceKnowledgeBeliefs: 64,
  recallInstances: 16,
});
const CONVERSATION_LIMITS = Object.freeze({
  threads: 32,
  processedExperiences: 128,
  archivedThreadSummaries: 32,
  maxRecentTurnsPerThread: 24,
});
const DIAGNOSTIC_LIMITS = Object.freeze({
  privateJournal: 512,
  runtimeMessages: 256,
});

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

function createRuntime({ checkpoint = null, runStage = freshLifeStage(), worldId } = {}) {
  return createTavernWorldRuntimeV27(state, {
    characterIds: CHARACTER_IDS,
    positions: Object.fromEntries(CHARACTER_IDS.map((id) => [id, "hall"])),
    worldId,
    checkpoint,
    enableDayPlanning: true,
    runStage,
  });
}

function semanticJournal(journal = {}) {
  return {
    ...structuredClone(journal),
    events: (journal.events || []).map((event) => ({
      ...structuredClone(event),
      committedAt: "<non-semantic-host-clock>",
      integrity: {
        algorithm: event.integrity?.algorithm,
        digest: "<derived-from-host-clock>",
      },
    })),
  };
}

function byCharacterId(rows = []) {
  return [...rows].sort((left, right) => left.characterId.localeCompare(right.characterId));
}

function wakeKind(turn = {}) {
  return String(turn.wake?.causeType || turn.wake?.kind || "").trim();
}

function dayIndicesByCharacter(turns = []) {
  const values = Object.fromEntries(CHARACTER_IDS.map((characterId) => [characterId, []]));
  for (const turn of turns) {
    if (wakeKind(turn) !== "day_planning_due") continue;
    values[turn.characterId].push(Number(turn.wake.dayIndex));
  }
  return Object.fromEntries(Object.entries(values).map(([characterId, indices]) => [
    characterId,
    [...new Set(indices)].sort((left, right) => left - right),
  ]));
}

function size(value) {
  return Array.isArray(value) ? value.length : 0;
}

function actorBounds(actor = {}) {
  const memory = actor.privateState?.memoryContext || {};
  const conversation = actor.privateState?.conversationState || {};
  const threads = conversation.threads || [];
  return {
    characterId: actor.characterId,
    memory: Object.fromEntries(Object.keys(MEMORY_LIMITS).map((key) => [key, size(memory[key])])),
    conversation: {
      threads: size(threads),
      processedExperiences: size(conversation.processedExperiences),
      archivedThreadSummaries: size(conversation.archivedThreadSummaries),
      maxRecentTurnsPerThread: Math.max(0, ...threads.map((thread) => size(thread.recentTurns))),
      openThreads: threads.filter((thread) => thread.status !== "closed" && thread.resumable !== false).length,
      closedThreads: threads.filter((thread) => thread.status === "closed" || thread.resumable === false).length,
    },
    diagnostics: {
      privateJournal: size(actor.privateJournal),
      runtimeMessages: size(actor.runtimeCheckpoint?.messages),
      seenWakeIds: size(actor.seenWakeIds),
    },
  };
}

function assertActorBounds(actor = {}) {
  const observed = actorBounds(actor);
  for (const [key, limit] of Object.entries(MEMORY_LIMITS)) {
    assert.ok(
      observed.memory[key] <= limit,
      `${actor.characterId} ${key} exceeded its durable memory bound: ${observed.memory[key]} > ${limit}`,
    );
  }
  for (const [key, limit] of Object.entries(CONVERSATION_LIMITS)) {
    assert.ok(
      observed.conversation[key] <= limit,
      `${actor.characterId} ${key} exceeded its conversation bound: ${observed.conversation[key]} > ${limit}`,
    );
  }
  assert.ok(observed.diagnostics.privateJournal <= DIAGNOSTIC_LIMITS.privateJournal);
  assert.ok(observed.diagnostics.runtimeMessages <= DIAGNOSTIC_LIMITS.runtimeMessages);
  return observed;
}

function assertPrivateReflectionIsolation(runtimeCheckpoint = {}) {
  const forbiddenNestedPrivateKeys = new Set([
    "otherCharacterPrivateState",
    "otherCharacterPrivateStates",
    "privateState",
    "memoryContext",
    "reflectionState",
  ]);
  function inspect(value, ownerCharacterId, path = "snapshot") {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((child, index) => inspect(child, ownerCharacterId, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      assert.equal(
        forbiddenNestedPrivateKeys.has(key),
        false,
        `${path}.${key} may not carry a nested Character private-state container`,
      );
      if (key === "ownerCharacterId" && String(child || "").trim()) {
        assert.equal(child, ownerCharacterId, `${path}.${key} belongs to another Character`);
      }
      inspect(child, ownerCharacterId, `${path}.${key}`);
    }
  }
  for (const actor of runtimeCheckpoint.actors || []) {
    const snapshots = actor.privateState?.reflectionState?.pendingOpportunity?.sourceMemorySnapshots || [];
    assert.ok(snapshots.length <= 24, `${actor.characterId} reflection source snapshot exceeded its private bound`);
    snapshots.forEach((snapshot, index) => inspect(snapshot, actor.characterId, (
      `${actor.characterId}.pendingOpportunity.sourceMemorySnapshots[${index}]`
    )));
  }
}

async function runUninterrupted() {
  const instance = createRuntime({ worldId: "world:xyy:tavern:v27:seven-day-life-loop" });
  const initialCheckpoint = await instance.runtime.checkpoint();
  const run = await instance.runtime.runUntilWorldTime({
    targetSeconds: HORIZON_SECONDS,
    maxTurns: MAX_TURNS,
  });
  const checkpoint = await instance.runtime.checkpoint();
  return {
    instance,
    initialCheckpoint,
    run,
    checkpoint,
    observer: projectTavernWorldRuntimeV27ForObserver(instance, run.turns),
  };
}

async function runAcrossCheckpoint() {
  const worldId = "world:xyy:tavern:v27:seven-day-life-loop";
  const beforeInstance = createRuntime({ worldId });
  const before = await beforeInstance.runtime.runUntilWorldTime({
    targetSeconds: CHECKPOINT_SECONDS,
    maxTurns: MAX_TURNS,
  });
  assert.equal(before.reachedTarget, true);
  assert.equal(before.endedByTurnLimit, false);
  const midpointCheckpoint = await beforeInstance.runtime.checkpoint();
  assert.ok(midpointCheckpoint.actors.every(actor => !actor.pendingTurn && !actor.inFlightWake), "the checkpoint must be taken between complete Character turns without discarding due wakes");

  const afterInstance = createRuntime({
    worldId,
    checkpoint: structuredClone(midpointCheckpoint),
    // Deliberately replace the in-memory stage closure. Only serialized
    // Character/world state may carry continuity across process lifetimes.
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
const turns = uninterrupted.run.turns;
const checkpoint = uninterrupted.checkpoint;
const observer = uninterrupted.observer;

assert.equal(uninterrupted.run.reachedTarget, true, "the seven-day horizon must be reached");
assert.equal(uninterrupted.run.endedByTurnLimit, false, "a turn cap is not a successful multi-day ending");
assert.equal(uninterrupted.run.stalled, false, "the owned plan clock may not stall before seven days");
assert.ok(turns.length < MAX_TURNS);
assert.equal(observer.nowSeconds >= HORIZON_SECONDS, true);
assert.deepEqual(observer.readyQueue, checkpoint.readyQueue, "the observer retains the exact pending queue at the time boundary");
assert.ok(checkpoint.actors.every(actor => !actor.pendingTurn && !actor.inFlightWake));
assert.equal(validateWorldEventJournal(checkpoint.coordinator.journal).valid, true);
assert.equal(validateWorldEventJournal(replayed.checkpoint.coordinator.journal).valid, true);
assertPrivateReflectionIsolation(checkpoint);
assertPrivateReflectionIsolation(replayed.midpointCheckpoint);
assertPrivateReflectionIsolation(replayed.checkpoint);

const audit = auditCharacterLongHorizonContinuity({
  requiredCharacterIds: CHARACTER_IDS,
  turns,
  checkpoint,
  publicWorld: observer,
  policy: {
    minTurnsPerCharacter: 30,
    requireAutonomousWake: true,
    maxConsecutiveSameAction: 2,
    minimumCoveredWorldSeconds: HORIZON_SECONDS,
    requireQuiescentEnd: false, // Reaching a time limit is not a claim of world quiescence.
    endedByTurnLimit: uninterrupted.run.endedByTurnLimit,
  },
});
assert.equal(audit.valid, true, JSON.stringify(audit.issues, null, 2));
assert.ok(audit.metrics.actionCount >= HORIZON_DAYS * CHARACTER_IDS.length * 4);
assert.ok(audit.metrics.speechActionCount >= HORIZON_DAYS * CHARACTER_IDS.length);
assert.ok(audit.metrics.causalResponseCount >= HORIZON_DAYS * CHARACTER_IDS.length);
assert.ok(audit.metrics.reflectionWakeCount >= HORIZON_DAYS * CHARACTER_IDS.length);
assert.ok(audit.metrics.externalWakeCount > 0);

const actionPrimitives = new Set(turns
  .filter((turn) => turn.actionAttempt)
  .map((turn) => turn.actionAttempt.primitive));
assert.deepEqual(
  [...actionPrimitives].sort(),
  ["move", "practice", "rest", "speak", "wait"],
  "seven lived days must retain ordinary action and dialogue variety",
);

const observedDayIndices = dayIndicesByCharacter(turns);
for (const characterId of CHARACTER_IDS) {
  assert.deepEqual(
    observedDayIndices[characterId],
    EXPECTED_DAY_INDICES,
    `${characterId} must privately rebuild one owned plan for each lived day`,
  );
}

const initialActors = new Map(uninterrupted.initialCheckpoint.actors.map((actor) => [actor.characterId, actor]));
const observedBounds = [];
for (const actor of checkpoint.actors) {
  const privateState = actor.privateState || {};
  const lifePlan = privateState.lifePlanState || {};
  const initialBody = initialActors.get(actor.characterId)?.privateState?.ecologyState?.body;
  assert.equal(lifePlan.ownerCharacterId, actor.characterId);
  assert.equal(lifePlan.revision, HORIZON_DAYS);
  assert.equal(Math.floor(Number(lifePlan.anchorAtSeconds || 0) / DAY_SECONDS), HORIZON_DAYS - 1);
  assert.ok(Number(lifePlan.horizonEndsAtSeconds || 0) >= HORIZON_SECONDS);
  assert.ok((lifePlan.steps || []).every((step) => step.status === "considered" && step.selection === null));
  assert.ok(
    Number(privateState.physiologyState?.lastWorldSyncSeconds || 0) >= HORIZON_SECONDS - 7_200,
    `${actor.characterId} physiology must remain synced into the final daily block`,
  );
  assert.ok(Number(privateState.ecologyState?.elapsedSeconds || 0) >= HORIZON_SECONDS - 7_200);
  assert.notDeepEqual(privateState.ecologyState?.body, initialBody);
  assert.equal(privateState.ecologyState?.body?.energy, privateState.ecologyState?.body?.stamina);
  assert.equal(privateState.ecologyState?.body?.exertion, privateState.ecologyState?.body?.fatigue);
  if (actor.mailbox.length && !checkpoint.readyQueue.includes(actor.characterId)) {
    assert.ok(actor.executionControl.waiting?.deadlineSeconds > observer.nowSeconds,
      "pending private opportunities at the run boundary require a real future wait");
    assert.ok(actor.mailbox.every(wake => !waitMatchesWake(actor.executionControl.waiting, wake)),
      "runnable or urgent messages cannot be left behind at a quiescent boundary");
  }
  assert.deepEqual(actor.pendingAttemptIds, []);
  assert.deepEqual(actor.unforwardedWakeIds, []);
  assert.equal(
    size(privateState.ecologyState?.characterPsychologyV2State?.continuationIntentions),
    0,
    `${actor.characterId} may not end with an overdue continuation loop`,
  );
  observedBounds.push(assertActorBounds(actor));
}

assert.ok(
  observedBounds.some((row) => row.diagnostics.privateJournal === DIAGNOSTIC_LIMITS.privateJournal),
  "the seven-day run must exercise the rolling private-journal bound",
);
assert.ok(
  observedBounds.some((row) => row.diagnostics.runtimeMessages === DIAGNOSTIC_LIMITS.runtimeMessages),
  "the seven-day run must exercise the rolling local-runtime-message bound",
);
assert.equal(JSON.stringify(observer).includes("privatePurpose"), false);
assert.equal(JSON.stringify(observer).includes("reflectionState"), false);
assert.equal(JSON.stringify(observer).includes("sourceMemorySnapshots"), false);
assert.equal(JSON.stringify(observer).includes("conversationState"), false);

assert.equal(replayed.after.reachedTarget, true);
assert.equal(replayed.after.endedByTurnLimit, false);
assert.deepEqual(replayed.checkpoint.readyQueue, checkpoint.readyQueue, "restoration must preserve pending wake order as well as settled history");
assert.deepEqual(
  replayed.checkpoint.coordinator.worldState,
  checkpoint.coordinator.worldState,
  "restoring after three days must preserve the exact final objective world",
);
assert.deepEqual(
  semanticJournal(replayed.checkpoint.coordinator.journal),
  semanticJournal(checkpoint.coordinator.journal),
  "restoring after three days must preserve the semantic objective journal",
);
assert.deepEqual(replayed.checkpoint.coordinator.outcomes, checkpoint.coordinator.outcomes);
assert.deepEqual(replayed.checkpoint.receiptLedger, checkpoint.receiptLedger);
assert.deepEqual(byCharacterId(replayed.checkpoint.actors), byCharacterId(checkpoint.actors));
assert.deepEqual(
  replayed.turns,
  turns,
  "two process lifetimes must compose into the same seven-day participant-owned causal sequence",
);

console.log(JSON.stringify({
  status: "all-passed",
  gate: "tavern-v27-seven-day-life-loop",
  horizonDays: HORIZON_DAYS,
  horizonSeconds: observer.nowSeconds,
  checkpointSeconds: replayed.midpointCheckpoint.coordinator.worldState.nowSeconds,
  turns: turns.length,
  actions: audit.metrics.actionCount,
  speechActions: audit.metrics.speechActionCount,
  causalResponses: audit.metrics.causalResponseCount,
  reflectionWakes: audit.metrics.reflectionWakeCount,
  planWakes: audit.metrics.planWakeCount,
  dayPlanningWakes: Object.fromEntries(CHARACTER_IDS.map((characterId) => [
    characterId,
    observedDayIndices[characterId].length,
  ])),
  worldEvents: checkpoint.coordinator.journal.events.length,
  memoryLimits: MEMORY_LIMITS,
  conversationLimits: CONVERSATION_LIMITS,
  diagnosticLimits: DIAGNOSTIC_LIMITS,
  observedBounds,
}, null, 2));
