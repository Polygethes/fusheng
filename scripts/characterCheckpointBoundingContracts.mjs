import assert from "node:assert/strict";

import {
  createCharacterModelSession,
  restoreCharacterModelSession,
} from "../src/server/simulation/characterModelSession.mjs";
import { createLocalCharacterRuntimePort } from "../src/server/simulation/characterRuntimePort.mjs";
import {
  createCharacterSessionActor,
  restoreCharacterSessionActor,
} from "../src/server/simulation/characterSessionActor.mjs";

const MODEL_STAGE_JOURNAL_LIMIT = 256;
const MODEL_STAGE_COUNT = MODEL_STAGE_JOURNAL_LIMIT + 4;
const MODEL_CHARACTER_ID = "char:bounded-model-session";

function createModelProviderPort() {
  return {
    async openConversation(input = {}) {
      return {
        characterId: input.characterId,
        providerConversationId: input.providerConversationId || `provider:${input.characterId}`,
      };
    },
    async runStage(handle = {}, input = {}) {
      return {
        characterId: input.characterId,
        providerConversationId: handle.providerConversationId,
      };
    },
    async checkpointConversation(handle = {}) {
      return {
        characterId: handle.characterId,
        providerConversationId: handle.providerConversationId,
      };
    },
    async closeConversation() {},
  };
}

const modelSession = createCharacterModelSession({
  characterId: MODEL_CHARACTER_ID,
  providerPort: createModelProviderPort(),
});
for (let sequence = 1; sequence <= MODEL_STAGE_COUNT; sequence += 1) {
  await modelSession.runStage({
    characterId: MODEL_CHARACTER_ID,
    agentTurnId: `agent-turn:${sequence}`,
    phase: `phase:${sequence}`,
  });
}
const modelCheckpoint = await modelSession.checkpoint();
assert.equal(modelCheckpoint.stageJournal.length, MODEL_STAGE_JOURNAL_LIMIT);
assert.equal(modelCheckpoint.stageJournal[0].stageSequence, 5, "the earliest four diagnostic stages must be dropped");
assert.equal(modelCheckpoint.stageJournal.at(-1).stageSequence, MODEL_STAGE_COUNT, "the latest stage must be retained");
assert.equal(modelCheckpoint.stageSequence, MODEL_STAGE_COUNT, "the authoritative sequence must not be truncated");
assert.equal(modelSession.snapshot().lastStage.stageSequence, MODEL_STAGE_COUNT);

const restoredModelSession = restoreCharacterModelSession(
  JSON.parse(JSON.stringify(modelCheckpoint)),
  { providerPort: createModelProviderPort() },
);
assert.equal(restoredModelSession.snapshot().stageSequence, MODEL_STAGE_COUNT);
assert.equal(restoredModelSession.snapshot().lastStage.stageSequence, MODEL_STAGE_COUNT);
await restoredModelSession.runStage({
  characterId: MODEL_CHARACTER_ID,
  agentTurnId: `agent-turn:${MODEL_STAGE_COUNT + 1}`,
  phase: `phase:${MODEL_STAGE_COUNT + 1}`,
});
const resumedModelCheckpoint = await restoredModelSession.checkpoint();
assert.equal(resumedModelCheckpoint.stageJournal.length, MODEL_STAGE_JOURNAL_LIMIT);
assert.equal(resumedModelCheckpoint.stageJournal[0].stageSequence, 6);
assert.equal(resumedModelCheckpoint.stageJournal.at(-1).stageSequence, MODEL_STAGE_COUNT + 1);
assert.equal(resumedModelCheckpoint.stageSequence, MODEL_STAGE_COUNT + 1);

const RUNTIME_MESSAGE_LIMIT = 256;
const RUNTIME_MESSAGE_COUNT = RUNTIME_MESSAGE_LIMIT + 4;
const RUNTIME_CHARACTER_ID = "char:bounded-runtime-port";

function createRuntimePort() {
  return createLocalCharacterRuntimePort({
    async runTurn(input = {}) {
      return { characterId: input.characterId, agentTurnId: input.agentTurnId };
    },
  });
}

const runtimePort = createRuntimePort();
const runtimeHandle = await runtimePort.openSession({ characterId: RUNTIME_CHARACTER_ID });
for (let sequence = 1; sequence <= RUNTIME_MESSAGE_COUNT; sequence += 1) {
  await runtimePort.enqueueWake(runtimeHandle, {
    wakeId: `wake:${sequence}`,
    recipientCharacterId: RUNTIME_CHARACTER_ID,
  });
}
const runtimeCheckpoint = await runtimePort.checkpoint(runtimeHandle);
assert.equal(runtimeCheckpoint.messages.length, RUNTIME_MESSAGE_LIMIT);
assert.equal(runtimeCheckpoint.messages[0].value.wakeId, "wake:5", "the earliest four runtime diagnostics must be dropped");
assert.equal(runtimeCheckpoint.messages.at(-1).value.wakeId, `wake:${RUNTIME_MESSAGE_COUNT}`);

const restoredRuntimePort = createRuntimePort();
const restoredRuntimeHandle = await restoredRuntimePort.openSession({
  characterId: RUNTIME_CHARACTER_ID,
  runtimeCheckpoint: JSON.parse(JSON.stringify(runtimeCheckpoint)),
});
assert.deepEqual(
  (await restoredRuntimePort.checkpoint(restoredRuntimeHandle)).messages,
  runtimeCheckpoint.messages,
  "restoring a bounded runtime checkpoint must retain the exact diagnostic window",
);
await restoredRuntimePort.runTurn(restoredRuntimeHandle, {
  characterId: RUNTIME_CHARACTER_ID,
  agentTurnId: "agent-turn:runtime:1",
});
const resumedRuntimeCheckpoint = await restoredRuntimePort.checkpoint(restoredRuntimeHandle);
assert.equal(resumedRuntimeCheckpoint.messages.length, RUNTIME_MESSAGE_LIMIT);
assert.equal(resumedRuntimeCheckpoint.messages[0].value.wakeId, "wake:6");
assert.deepEqual(resumedRuntimeCheckpoint.messages.at(-1), {
  kind: "turn_result",
  agentTurnId: "agent-turn:runtime:1",
});

const ACTOR_PRIVATE_JOURNAL_LIMIT = 512;
const ACTOR_TURN_COUNT = 129;
const ACTOR_CHARACTER_ID = "char:bounded-session-actor";

function createActorRuntimePort() {
  return createLocalCharacterRuntimePort({
    async runTurn(input = {}) {
      return {
        characterId: input.characterId,
        agentTurnId: input.agentTurnId,
        actionAttempt: { primitive: "observe", payload: {} },
      };
    },
  });
}

const actor = createCharacterSessionActor({
  characterId: ACTOR_CHARACTER_ID,
  privateState: { ownerCharacterId: ACTOR_CHARACTER_ID, stableMarker: "preserved" },
  runtimePort: createActorRuntimePort(),
});

async function runActorCycle(target, sequence) {
  const wakeId = `wake:actor:${sequence}`;
  assert.equal(await target.enqueueWake({
    wakeId,
    kind: "world_evidence",
    recipientCharacterId: ACTOR_CHARACTER_ID,
    evidenceIds: [],
  }), true);
  const turn = await target.runNextTurn({
    worldVersion: sequence,
    situationProjection: {
      authority: "recipient-specific-world-projection",
      recipientCharacterId: ACTOR_CHARACTER_ID,
      evidence: [],
    },
  });
  await target.applyWorldOutcome({
    authority: "world-resolution",
    outcomeId: `outcome:actor:${sequence}`,
    actionAttemptId: turn.actionAttempt.attemptId,
    actorId: ACTOR_CHARACTER_ID,
    worldVersion: sequence,
    status: "success",
  });
  return turn;
}

for (let sequence = 1; sequence <= ACTOR_TURN_COUNT; sequence += 1) {
  await runActorCycle(actor, sequence);
}

const actorCheckpoint = await actor.checkpoint();
assert.equal(actorCheckpoint.privateJournal.length, ACTOR_PRIVATE_JOURNAL_LIMIT);
assert.deepEqual(actorCheckpoint.privateJournal[0], {
  kind: "wake_enqueued",
  wakeId: "wake:actor:2",
}, "only the oldest four Actor diagnostics must be dropped");
assert.deepEqual(actorCheckpoint.privateJournal.at(-1), {
  kind: "world_outcome_applied",
  outcomeId: `outcome:actor:${ACTOR_TURN_COUNT}`,
  actionAttemptId: `action-attempt:agent-turn:${ACTOR_CHARACTER_ID}:${ACTOR_TURN_COUNT}`,
  worldVersion: ACTOR_TURN_COUNT,
});
assert.equal(actorCheckpoint.turnSequence, ACTOR_TURN_COUNT);
assert.equal(actorCheckpoint.seenWakeIds.length, ACTOR_TURN_COUNT, "the authoritative idempotency ledger must remain complete");
assert.equal(actorCheckpoint.seenWakeIds.includes("wake:actor:1"), true, "a dropped diagnostic wake must remain in seenWakeIds");
assert.deepEqual(actorCheckpoint.mailbox, []);
assert.deepEqual(actorCheckpoint.pendingAttemptIds, []);
assert.deepEqual(actorCheckpoint.unforwardedWakeIds, []);
assert.equal(actorCheckpoint.privateState.stableMarker, "preserved");
assert.equal(actorCheckpoint.runtimeCheckpoint.messages.length, RUNTIME_MESSAGE_LIMIT);
assert.deepEqual(actorCheckpoint.runtimeCheckpoint.messages[0], {
  kind: "world_outcome",
  outcomeId: "outcome:actor:44",
});
assert.deepEqual(actorCheckpoint.runtimeCheckpoint.messages.at(-1), {
  kind: "world_outcome",
  outcomeId: `outcome:actor:${ACTOR_TURN_COUNT}`,
});

const restoredActor = restoreCharacterSessionActor(
  JSON.parse(JSON.stringify(actorCheckpoint)),
  { runtimePort: createActorRuntimePort() },
);
const restoredActorCheckpoint = await restoredActor.checkpoint();
assert.deepEqual(restoredActorCheckpoint, actorCheckpoint, "bounded Actor state must round-trip exactly before further work");
assert.equal(await restoredActor.enqueueWake({
  wakeId: "wake:actor:1",
  kind: "world_evidence",
  recipientCharacterId: ACTOR_CHARACTER_ID,
  evidenceIds: [],
}), false, "restore must not accept an old wake whose diagnostic row was dropped");
assert.deepEqual(await restoredActor.checkpoint(), actorCheckpoint, "idempotent old-wake rejection must not mutate the checkpoint");

const resumedActorTurn = await runActorCycle(restoredActor, ACTOR_TURN_COUNT + 1);
assert.equal(resumedActorTurn.agentTurnId, `agent-turn:${ACTOR_CHARACTER_ID}:${ACTOR_TURN_COUNT + 1}`);
const resumedActorCheckpoint = await restoredActor.checkpoint();
assert.equal(resumedActorCheckpoint.privateJournal.length, ACTOR_PRIVATE_JOURNAL_LIMIT);
assert.deepEqual(resumedActorCheckpoint.privateJournal[0], {
  kind: "wake_enqueued",
  wakeId: "wake:actor:3",
});
assert.equal(resumedActorCheckpoint.privateJournal.at(-1).outcomeId, `outcome:actor:${ACTOR_TURN_COUNT + 1}`);
assert.equal(resumedActorCheckpoint.turnSequence, ACTOR_TURN_COUNT + 1);
assert.equal(resumedActorCheckpoint.seenWakeIds.length, ACTOR_TURN_COUNT + 1);
assert.equal(resumedActorCheckpoint.seenWakeIds.includes("wake:actor:1"), true);
assert.deepEqual(resumedActorCheckpoint.mailbox, []);
assert.deepEqual(resumedActorCheckpoint.pendingAttemptIds, []);
assert.deepEqual(resumedActorCheckpoint.unforwardedWakeIds, []);
assert.equal(resumedActorCheckpoint.runtimeCheckpoint.messages.length, RUNTIME_MESSAGE_LIMIT);
assert.deepEqual(resumedActorCheckpoint.runtimeCheckpoint.messages[0], {
  kind: "world_outcome",
  outcomeId: "outcome:actor:45",
});

console.log("character checkpoint bounding contracts passed");
