import assert from "node:assert/strict";

import { createCharacterAgentMemoryState } from "../src/engine/characterAgentMemory.js";
import {
  createTavernWorldRuntimeV27,
  lowerTavernV27WorldAttempt,
  projectTavernSituationV27,
} from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { reduceCharacterPrivateWorldOutcome } from "../src/server/simulation/characterPrivateStateReducer.mjs";
import { createWorldActionRegistry } from "../src/server/simulation/worldActionRegistry.mjs";
import { createWorldCommitCoordinator } from "../src/server/simulation/worldCommitCoordinator.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const XIE = "char_xyy_xiezenshi";
const LUO = "char_xyy_luozhao";
const TEAPOT = "tavern_vessel_teapot_1";
const MEAL_BOWL = "tavern_vessel_meal_1";

const sourceState = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
const instance = createTavernWorldRuntimeV27(sourceState, {
  characterIds: [XIE, LUO],
  positions: { [XIE]: "hall", [LUO]: "hall" },
  worldId: "world:test:v27-consume-physiology",
});

function projection(characterId, wake = {}) {
  return projectTavernSituationV27({
    worldState: instance.coordinator.worldState,
    worldVersion: instance.coordinator.journal.worldVersion,
    characterId,
    wake,
  });
}

async function submit(actorId, primitive, payload, {
  attemptId = `attempt:test:consume:${instance.coordinator.journal.worldVersion + 1}`,
  agentTurnId = "",
} = {}) {
  return instance.coordinator.submitActionAttempt({
    attemptId,
    agentTurnId,
    actorId,
    primitive,
    expectedWorldVersion: instance.coordinator.journal.worldVersion,
    payload,
  });
}

async function moveWorkerTo(zoneId, vesselId) {
  const worker = instance.coordinator.worldState.entities[XIE];
  if (worker.zoneId === zoneId) return;
  if (worker.zoneId === "hall" && zoneId === "stove") {
    await submit(XIE, "move", { destinationId: "counter" });
    await submit(XIE, "move", { destinationId: "stove" });
  } else if (worker.zoneId === "stove" && zoneId === "hall") {
    await submit(XIE, "move", { destinationId: "counter" });
    await submit(XIE, "move", { destinationId: "hall" });
  } else throw new Error(`unsupported worker route for ${vesselId}: ${worker.zoneId} -> ${zoneId}`);
}

async function prepareAndServe({ offeringId, vesselId }) {
  await submit(XIE, "handle", {
    objectId: vesselId,
    operation: "take",
    visibleAction: `谢真石拿起${vesselId}。`,
  });
  await moveWorkerTo("stove", vesselId);
  const start = projection(XIE).availableAffordances.find((row) => (
    row.operation === "start_service_preparation" && row.offeringId === offeringId
  ));
  assert.ok(start, `the real ${offeringId} offering must expose a preparation affordance`);
  const startBinding = projection(XIE).recipientPrivateBindings.affordanceBindingByHandle[start.id];
  const started = await submit(XIE, "use_affordance", {
    affordanceId: startBinding.canonicalAffordanceId,
    capabilityBinding: startBinding,
    visibleAction: `谢真石开始准备${offeringId}。`,
  });
  assert.equal(started.status, "success");
  const processId = started.resolvedEffects.find((row) => row.kind === "service_preparation_started")?.processId;
  assert.ok(processId);
  const readyEvent = await instance.coordinator.advanceWorldProcesses({ allowTimeAdvance: true });
  const ready = projection(XIE, { processIds: [processId], evidence: readyEvent.deliveries });
  const finish = ready.availableAffordances.find((row) => (
    row.operation === "finish_service_preparation"
    && ready.recipientPrivateBindings.affordanceBindingByHandle[row.id]?.processId === processId
  ));
  assert.ok(finish);
  const finishBinding = ready.recipientPrivateBindings.affordanceBindingByHandle[finish.id];
  assert.equal((await submit(XIE, "use_affordance", {
    affordanceId: finishBinding.canonicalAffordanceId,
    capabilityBinding: finishBinding,
  })).status, "success");
  await moveWorkerTo("hall", vesselId);
  const serving = projection(XIE);
  const serve = serving.availableAffordances.find((row) => (
    row.operation === "serve_prepared_service"
    && serving.recipientPrivateBindings.affordanceBindingByHandle[row.id]?.processId === processId
  ));
  assert.ok(serve);
  const serveBinding = serving.recipientPrivateBindings.affordanceBindingByHandle[serve.id];
  assert.equal((await submit(XIE, "use_affordance", {
    affordanceId: serveBinding.canonicalAffordanceId,
    capabilityBinding: serveBinding,
  })).status, "success");
  return processId;
}

function loweredConsume(objectId) {
  return lowerTavernV27WorldAttempt({
    rawDecision: {
      actionAttempt: {
        primitive: "consume",
        objectId,
        actionBinding: { kind: "object", objectId },
      },
      visibleAction: "客人把送到面前的饮食真正用下。",
    },
  });
}

function privateStateFor(actorId, attemptId, agentTurnId, body) {
  return {
    ownerCharacterId: actorId,
    memoryContext: createCharacterAgentMemoryState(actorId),
    relationshipContext: [],
    ecologyState: {
      body: structuredClone(body),
      voiceHabitUsage: [],
      characterPsychologyV2State: {},
    },
    recentOwnActions: [],
    settledInteractionEvents: [],
    pendingAttemptContinuityById: {
      [attemptId]: {
        ownerAuthority: "character-agent",
        actionAttemptId: attemptId,
        sourceAgentTurnId: agentTurnId,
        selectedCandidateId: `candidate:${attemptId}`,
        selectedCandidate: {},
        actionAttempt: { primitive: "consume" },
        utterance: { literalSpeech: "", speechAct: "none", speechFunctions: [] },
        communicationPlan: {},
        embodiedIntent: {},
        realizedSpeechHabitIds: [],
      },
    },
    appliedPrivateOutcomeIds: [],
    appliedPrivateOutcomeRecords: [],
    conversationThreadStates: {},
  };
}

function mergePrivateState(previous, transition) {
  return { ...structuredClone(previous), ...structuredClone(transition.privateStatePatch) };
}

const teaProcessId = await prepareAndServe({
  offeringId: "fine_cloud_tea_pot",
  vesselId: TEAPOT,
});
assert.equal(
  instance.coordinator.worldState.processes.find((row) => row.id === teaProcessId)?.metadata?.serviceStatus,
  "served",
);

// Physical reach is insufficient: only the objective service recipient may consume it.
const wrongAttemptId = "attempt:test:wrong-recipient-consume";
const wrongTurnId = "agent-turn:test:wrong-recipient-consume";
const wrongBefore = privateStateFor(XIE, wrongAttemptId, wrongTurnId, {
  hunger: 0.72,
  thirst: 0.81,
  fatigue: 0.22,
  exertion: 0.22,
  stamina: 0.68,
  energy: 0.68,
  pain: 0,
});
const wrongOutcome = await submit(XIE, loweredConsume(TEAPOT).primitive, loweredConsume(TEAPOT).payload, {
  attemptId: wrongAttemptId,
  agentTurnId: wrongTurnId,
});
assert.equal(wrongOutcome.status, "failed", "a nearby non-recipient may not consume another person's served tea");
assert.ok(wrongOutcome.failedEffects.some((row) => row.code === "CONSUME_SERVICE_RECIPIENT_MISMATCH"));
assert.equal(instance.coordinator.worldState.objects[TEAPOT].state.contents.kind, "prepared_service");
assert.equal(instance.coordinator.worldState.processes.find((row) => row.id === teaProcessId).metadata.serviceStatus, "served");
const wrongReduction = reduceCharacterPrivateWorldOutcome({
  ownerCharacterId: XIE,
  previousPrivateState: wrongBefore,
  worldOutcome: wrongOutcome,
  nowSeconds: instance.coordinator.worldState.nowSeconds,
});
assert.deepEqual(
  wrongReduction.privateStatePatch.ecologyState.body,
  wrongBefore.ecologyState.body,
  "failed theft must not recover the wrong person's physiology",
);

const teaAttemptId = "attempt:test:recipient-consumes-tea";
const teaTurnId = "agent-turn:test:recipient-consumes-tea";
const teaBefore = privateStateFor(LUO, teaAttemptId, teaTurnId, {
  hunger: 0.66,
  thirst: 0.82,
  fatigue: 0.28,
  exertion: 0.28,
  stamina: 0.61,
  energy: 0.61,
  pain: 0,
});
const loweredTea = loweredConsume(TEAPOT);
assert.equal(loweredTea.primitive, "handle");
assert.equal(loweredTea.payload.operation, "consume");
assert.equal(loweredTea.payload.originalPrimitive, "consume");
const teaOutcome = await submit(LUO, loweredTea.primitive, loweredTea.payload, {
  attemptId: teaAttemptId,
  agentTurnId: teaTurnId,
});
assert.equal(teaOutcome.status, "success");
assert.ok(teaOutcome.resolvedEffects.some((row) => (
  row.kind === "prepared_service_consumed"
  && row.processId === teaProcessId
  && row.offeringId === "fine_cloud_tea_pot"
  && row.recipientCharacterId === LUO
)));
const teaBodyLoad = teaOutcome.resolvedEffects.find((row) => row.kind === "body_load_applied");
assert.equal(teaBodyLoad?.targetActorId, LUO);
assert.ok(Number(teaBodyLoad?.thirstDelta) < 0, "objective tea facts must create thirst relief without guessing from an object id");
assert.equal(Number(teaBodyLoad?.hungerDelta || 0), 0, "tea may not masquerade as a meal");
assert.equal(instance.coordinator.worldState.objects[TEAPOT].state.contents, "empty");
assert.equal(instance.coordinator.worldState.processes.find((row) => row.id === teaProcessId).metadata.serviceStatus, "consumed");
assert.equal(instance.coordinator.worldState.processes.find((row) => row.id === teaProcessId).metadata.consumedByCharacterId, LUO);

const teaReduction = reduceCharacterPrivateWorldOutcome({
  ownerCharacterId: LUO,
  previousPrivateState: teaBefore,
  worldOutcome: teaOutcome,
  nowSeconds: instance.coordinator.worldState.nowSeconds,
});
assert.ok(
  teaReduction.privateStatePatch.ecologyState.body.thirst < teaBefore.ecologyState.body.thirst,
  "the same recipient's private thirst must improve after objective consumption",
);
assert.equal(
  teaReduction.privateStatePatch.ecologyState.body.hunger,
  teaBefore.ecologyState.body.hunger,
  "tea consumption must leave hunger unchanged",
);

// A completed commit remains exactly-once through coordinator and Actor checkpoints.
const checkpoint = instance.coordinator.checkpoint();
const restored = createWorldCommitCoordinator({
  worldId: checkpoint.worldId,
  checkpoint,
  actionRegistry: createWorldActionRegistry(),
});
assert.deepEqual(await restored.submitActionAttempt({
  attemptId: teaAttemptId,
  agentTurnId: teaTurnId,
  actorId: LUO,
  expectedWorldVersion: 0,
  ...loweredTea,
}), teaOutcome, "a checkpointed retry must return the original consumption outcome without consuming twice");
const teaAfter = mergePrivateState(teaBefore, teaReduction);
const duplicatePrivate = reduceCharacterPrivateWorldOutcome({
  ownerCharacterId: LUO,
  previousPrivateState: teaAfter,
  worldOutcome: teaOutcome,
  nowSeconds: instance.coordinator.worldState.nowSeconds,
});
assert.equal(duplicatePrivate.idempotent, true);
assert.deepEqual(duplicatePrivate.privateStatePatch, {});

const repeatedTea = await submit(LUO, loweredTea.primitive, loweredTea.payload, {
  attemptId: "attempt:test:recipient-consumes-empty-teapot",
  agentTurnId: "agent-turn:test:recipient-consumes-empty-teapot",
});
assert.equal(repeatedTea.status, "failed", "a new attempt may not consume the same serving twice");
assert.ok(repeatedTea.failedEffects.some((row) => row.code === "CONSUME_SERVICE_NOT_AVAILABLE"));
assert.equal(repeatedTea.resolvedEffects.some((row) => row.kind === "body_load_applied"), false);

// A second real service proves consumed processes are terminal and meal facts drive hunger.
const mealProcessId = await prepareAndServe({ offeringId: "meal", vesselId: MEAL_BOWL });
const mealAttemptId = "attempt:test:recipient-consumes-meal";
const mealTurnId = "agent-turn:test:recipient-consumes-meal";
const mealBefore = privateStateFor(LUO, mealAttemptId, mealTurnId, {
  hunger: 0.84,
  thirst: 0.52,
  fatigue: 0.31,
  exertion: 0.31,
  stamina: 0.55,
  energy: 0.55,
  pain: 0,
});
const loweredMeal = loweredConsume(MEAL_BOWL);
const mealOutcome = await submit(LUO, loweredMeal.primitive, loweredMeal.payload, {
  attemptId: mealAttemptId,
  agentTurnId: mealTurnId,
});
assert.equal(mealOutcome.status, "success");
const mealBodyLoad = mealOutcome.resolvedEffects.find((row) => row.kind === "body_load_applied");
assert.ok(Number(mealBodyLoad?.hungerDelta) < 0, "objective meal facts must create hunger relief");
assert.equal(Number(mealBodyLoad?.thirstDelta || 0), 0, "this meal's low hydration must not be promoted into a drink effect");
assert.equal(instance.coordinator.worldState.processes.find((row) => row.id === mealProcessId).metadata.serviceStatus, "consumed");
const mealReduction = reduceCharacterPrivateWorldOutcome({
  ownerCharacterId: LUO,
  previousPrivateState: mealBefore,
  worldOutcome: mealOutcome,
  nowSeconds: instance.coordinator.worldState.nowSeconds,
});
assert.ok(mealReduction.privateStatePatch.ecologyState.body.hunger < mealBefore.ecologyState.body.hunger);
assert.ok(mealReduction.privateStatePatch.ecologyState.body.stamina > mealBefore.ecologyState.body.stamina);
assert.equal(mealReduction.privateStatePatch.ecologyState.body.energy, mealReduction.privateStatePatch.ecologyState.body.stamina);

console.log(JSON.stringify({
  status: "all-passed",
  teaProcessId,
  mealProcessId,
  wrongRecipientBlocked: true,
  repeatBlocked: true,
  checkpointIdempotent: true,
  thirstImproved: true,
  hungerImproved: true,
}, null, 2));
