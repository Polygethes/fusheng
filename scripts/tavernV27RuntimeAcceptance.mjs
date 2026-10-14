import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import {
  createTavernWorldRuntimeV27,
  lowerTavernV27WorldAttempt,
  projectTavernSituationV27,
  projectTavernV27TurnForObserver,
  projectTavernWorldRuntimeV27ForObserver,
} from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";

const XIE_ZHENSHI = "char_xyy_xiezenshi";
const LUO_ZHAO = "char_xyy_luozhao";
const ZHOU_MIN = "char_xyy_zhoumin";
const SIDE_WALL_TABLE = "position:tavern-hall-side-wall-table";

function seedState() {
  return buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
}

function loggedFixture(calls) {
  const fixture = createTavernV27FixtureStageRunner();
  return async (input, options) => {
    calls.push({ input: structuredClone(input), stage: options.stage });
    return fixture(input, options);
  };
}

const loweredObserveAndSpeech = lowerTavernV27WorldAttempt({
  rawDecision: {
    speech: "明白。",
    targetCharacterId: XIE_ZHENSHI,
    visibleAction: "仍看着谢真石。",
    observableAffectiveTexture: [{ channel: "voiceOnset", modality: "sound", feature: "应声很快。" }],
    actionAttempt: {
      primitive: "observe",
      targetCharacterId: XIE_ZHENSHI,
      objectId: "",
      destinationId: "",
      affordanceId: "",
    },
  },
});
assert.equal(loweredObserveAndSpeech.primitive, "observe");
assert.equal(loweredObserveAndSpeech.payload.utterance, "明白。");
assert.equal(loweredObserveAndSpeech.payload.speechTargetCharacterId, XIE_ZHENSHI);

const loweredPlaceListenWithDifferentExpressionAudience = lowerTavernV27WorldAttempt({
  rawDecision: {
    speech: "",
    targetCharacterId: LUO_ZHAO,
    speechTargetCharacterId: "",
    actionAttempt: {
      primitive: "listen",
      targetCharacterId: "",
      objectId: "",
      destinationId: "guest_room",
      affordanceId: "",
      actionBinding: {
        kind: "place",
        targetCharacterId: "",
        objectId: "",
        destinationId: "guest_room",
        positionId: "",
        affordanceId: "",
      },
    },
  },
});
assert.equal(loweredPlaceListenWithDifferentExpressionAudience.primitive, "listen");
assert.equal(loweredPlaceListenWithDifferentExpressionAudience.payload.targetKind, "place");
assert.equal(loweredPlaceListenWithDifferentExpressionAudience.payload.targetId, "guest_room");
assert.equal(loweredPlaceListenWithDifferentExpressionAudience.payload.speechTargetCharacterId, "");

const loweredDoorInteractAndCall = lowerTavernV27WorldAttempt({
  rawDecision: {
    speech: "爹？",
    targetCharacterId: "",
    speechTargetCharacterId: "",
    visibleAction: "抬手用指节清楚叩门两下，随即收手。",
    observableAffectiveTexture: [{
      channel: "knock",
      modality: "sound",
      feature: "门上响起两下克制而清楚的叩声。",
    }],
    actionAttempt: {
      primitive: "interact",
      contactOperation: "knock",
      targetCharacterId: "",
      objectId: "",
      destinationId: "guest_room",
      affordanceId: "",
      actionBinding: {
        kind: "place",
        targetCharacterId: "",
        objectId: "",
        destinationId: "guest_room",
        positionId: "",
        affordanceId: "",
      },
    },
  },
});
assert.equal(loweredDoorInteractAndCall.primitive, "interact");
assert.equal(loweredDoorInteractAndCall.payload.targetKind, "place");
assert.equal(loweredDoorInteractAndCall.payload.targetId, "guest_room");
assert.equal(loweredDoorInteractAndCall.payload.utterance, "爹？");

const state = seedState();
const movedProjectionState = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
const movedWorld = createTavernWorldRuntimeV27(movedProjectionState, {
  positions: { [XIE_ZHENSHI]: "stairs", [LUO_ZHAO]: "hall" },
  runStage: createTavernV27FixtureStageRunner(),
});
const luoMovedProjection = projectTavernSituationV27({
  worldState: movedWorld.coordinator.worldState,
  worldVersion: 0,
  characterId: LUO_ZHAO,
  wake: {},
});
const unknownAtStairs = luoMovedProjection.perceivedCharacters.find((row) => row.zoneId === "stairs");
assert.ok(unknownAtStairs?.id.startsWith("perceived_entity:"));
assert.equal(unknownAtStairs.identityKnown, false);
assert.equal(unknownAtStairs.observableDescription, "楼梯口有一人");
assert.equal(JSON.stringify(unknownAtStairs).includes(XIE_ZHENSHI), false);
assert.equal(JSON.stringify(unknownAtStairs).includes("谢真石"), false);
const doorInteractionOutcome = await movedWorld.coordinator.submitActionAttempt({
  attemptId: "attempt:v27:xie-knocks-on-guest-room-door",
  actorId: XIE_ZHENSHI,
  expectedWorldVersion: 0,
  ...loweredDoorInteractAndCall,
});
assert.equal(doorInteractionOutcome.primitive, "interact");
assert.equal(doorInteractionOutcome.status, "success");
assert.ok(
  doorInteractionOutcome.committedFacts.some((row) => (
    row.kind === "place_interaction_attempted" && row.targetZoneId === "guest_room"
  )),
  "an adjacent closed-room boundary is a real place interaction, not an empty object handle",
);
assert.equal(
  doorInteractionOutcome.failedEffects.some((row) => row.code === "HANDLE_OBJECT_UNKNOWN"),
  false,
);
assert.ok(
  doorInteractionOutcome.deliveries.some((row) => (
    row.recipientCharacterId === LUO_ZHAO
    && row.eventKind === "place_interaction_sound"
    && row.content.includes("叩声")
  )),
  "a structured knock becomes a real transient sound for physically audible characters",
);
assert.ok(
  doorInteractionOutcome.deliveries.some((row) => (
    row.recipientCharacterId === LUO_ZHAO
    && row.eventKind === "speech"
    && row.content === "爹？"
  )),
  "an untargeted call is physically broadcast to audible present characters",
);
assert.equal(
  doorInteractionOutcome.committedFacts.some((row) => (
    row.kind === "utterance_emitted" && row.actorId !== XIE_ZHENSHI
  )),
  false,
  "world settlement never fabricates a reply from an absent or inactive character",
);
const stageCalls = [];
const instance = createTavernWorldRuntimeV27(state, {
  positions: { [XIE_ZHENSHI]: "hall", [LUO_ZHAO]: "hall" },
  runStage: loggedFixture(stageCalls),
});

instance.runtime.actors.get(LUO_ZHAO).privateState.psychologyAnchor.identityModel = {
  ...(instance.runtime.actors.get(LUO_ZHAO).privateState.psychologyAnchor.identityModel || {}),
  privateIsolationProbe: "only-luo-may-read-this",
};

assert.equal(await instance.runtime.enqueueWake(XIE_ZHENSHI, {
  wakeId: "wake:tavern-v27:fixture-start",
  kind: "opportunity_window",
  evidenceIds: [],
  evidence: [],
}), true);

const turns = await instance.runtime.runUntilIdle({ maxTurns: 30 });
const observer = projectTavernWorldRuntimeV27ForObserver(instance, turns);
const reflectionTurns = turns.filter((turn) => turn.privateResult?.turnKind === "reflection");
const actionTurns = turns.filter((turn) => turn.privateResult?.turnKind !== "reflection");

assert.equal(actionTurns.length, 18, "the deterministic fixture reaches a completed service and then becomes quiescent");
assert.equal(reflectionTurns.length, 4, "private reflection opportunities interleave without becoming world actions");
assert.equal(stageCalls.length, (actionTurns.length * 3) + reflectionTurns.length);
const stageInputByteSizes = stageCalls.map((row) => Buffer.byteLength(JSON.stringify(row.input), "utf8"));
assert.ok(
  Math.max(...stageInputByteSizes) < 165_000,
  "combined appraisal/candidate projections include the wait contract and stay below 165KB in this fixture, under the former 184KB regression",
);
assert.ok(
  stageCalls.filter((row) => row.stage === "subjective_appraisal_and_candidates").length === actionTurns.length,
  "each action uses one shared appraisal/candidate call",
);
assert.ok(
  stageCalls.filter((row) => row.stage === "agent_choice_and_regulation")
    .every((row) => row.input.subjectiveAppraisal?.interpretations === undefined),
  "choice stages receive evaluated pressures without another full interpretation-prose copy",
);
assert.ok(actionTurns.every((turn) => turn.privateResult.stages.length === 3));
assert.ok(reflectionTurns.every((turn) => (
  turn.privateResult.stages.length === 1
  && turn.actionAttempt === null
  && turn.outcome === null
)));
assert.equal(actionTurns.filter((turn) => turn.characterId === XIE_ZHENSHI).length, 9);
assert.equal(actionTurns.filter((turn) => turn.characterId === LUO_ZHAO).length, 9);
assert.deepEqual(actionTurns.map((turn) => turn.outcome?.primitive || "none"), [
  "speak",
  "speak",
  "handle",
  "observe",
  "move",
  "none",
  "move",
  "none",
  "use_affordance",
  "none",
  "use_affordance",
  "none",
  "move",
  "none",
  "move",
  "none",
  "use_affordance",
  "none",
]);
assert.equal(observer.worldVersion, 12, "silent Actor turns add no event while one objective process-readiness event does");
assert.deepEqual(observer.readyQueue, []);
assert.equal(actionTurns[0].outcome.deliveries[0].content, "客官，要些什么？");
assert.equal(actionTurns[1].outcome.deliveries[0].content, "来壶好茶。");
assert.equal(actionTurns[2].outcome.deliveries[0].eventKind, "object_handling");
assert.equal(actionTurns[3].outcome.deliveries[0].eventKind, "observation_result");
assert.equal(actionTurns[3].outcome.deliveries[0].content.includes("短剑"), false, "movement/activity focus must not be padded with an unrelated static weapon");
assert.deepEqual(
  actionTurns[3].outcome.deliveries[0].semanticFrame.observationResult.attentionTags,
  ["movement", "activity"],
);
assert.deepEqual(actionTurns[3].outcome.deliveries[0].semanticFrame.observationResult.observableFeatures, []);
assert.equal(actionTurns[3].outcome.deliveries[0].content.includes("谢真石"), false, "the physical result does not certify the weapon owner's identity");
assert.equal(actionTurns[3].outcome.deliveries[0].content.includes("体力却不足"), false);
assert.equal(actionTurns[3].outcome.deliveries[0].content.includes("满城称他"), false);
const committedFacts = turns.flatMap((turn) => turn.outcome?.committedFacts || []);
assert.equal(
  committedFacts.filter((row) => (
    row.kind === "object_handling_attempted"
    && row.objectId === "tavern_vessel_teapot_1"
    && ["take", "take_out"].includes(row.operation)
  )).length,
  1,
  "the teapot changes holder once instead of being repeatedly taken from an unchanged world",
);
assert.equal(committedFacts.filter((row) => row.kind === "service_preparation_started").length, 1);
assert.equal(committedFacts.filter((row) => row.kind === "service_preparation_finished").length, 1);
assert.equal(committedFacts.filter((row) => row.kind === "prepared_service_served").length, 1);
assert.equal(
  instance.coordinator.journal.events.filter((row) => row.type === "world_process_ready").length,
  1,
  "preparation readiness is an objective world event rather than a Character Agent assertion",
);
const servedTeaProcess = instance.coordinator.worldState.processes.find((row) => (
  row.kind === "service_preparation" && row.metadata?.offeringId === "fine_cloud_tea_pot"
));
assert.equal(servedTeaProcess?.status, "completed");
assert.equal(servedTeaProcess?.metadata?.serviceStatus, "served");
assert.equal(instance.coordinator.worldState.objects.tavern_vessel_teapot_1.holderCharacterId, "");
assert.equal(instance.coordinator.worldState.objects.tavern_vessel_teapot_1.zoneId, "hall");
assert.equal(actionTurns.at(-1).outcome, null, "the final recipient may remain silent without fabricating a world fact");

const xieInputs = stageCalls.filter((row) => row.input.characterId === XIE_ZHENSHI);
const luoInputs = stageCalls.filter((row) => row.input.characterId === LUO_ZHAO);
const luoFirstAppraisal = luoInputs.filter((row) => row.stage === "subjective_appraisal_and_candidates")[0]?.input;
assert.equal(
  luoFirstAppraisal.worldProjection.discourseContext.recentPublicTurns.at(-1).utterance,
  "客官，要些什么？",
  "the addressee receives the literal current turn as experienced conversation history",
);
const xieReplyAppraisal = xieInputs.filter((row) => row.stage === "subjective_appraisal_and_candidates")[1]?.input;
assert.deepEqual(
  xieReplyAppraisal.worldProjection.discourseContext.recentPublicTurns.map((row) => row.utterance),
  ["客官，要些什么？", "来壶好茶。"],
  "a speaker keeps both the owned prior line and the newly heard reply without a world-authored interpretation",
);
assert.equal(JSON.stringify(xieInputs).includes("only-luo-may-read-this"), false);
assert.equal(JSON.stringify(luoInputs).includes("only-luo-may-read-this"), true);
assert.equal(JSON.stringify(xieInputs).includes("luozhao_yuheng_visit_letter"), false);
assert.equal(JSON.stringify(stageCalls).includes("venueNormPressure"), false);

const firstWakeId = `wake:${actionTurns[0].outcome.eventId}:${LUO_ZHAO}`;
assert.equal(await instance.runtime.enqueueWake(LUO_ZHAO, {
  wakeId: firstWakeId,
  kind: "world_evidence",
  eventId: actionTurns[0].outcome.eventId,
  evidenceIds: actionTurns[0].outcome.deliveries.map((row) => row.evidenceId).filter(Boolean),
  evidence: actionTurns[0].outcome.deliveries,
}), false, "an already activated delivery may not reactivate the same Actor under a reused wake");

const checkpointCalls = [];
const checkpointSource = createTavernWorldRuntimeV27(seedState(), {
  positions: { [XIE_ZHENSHI]: "hall", [LUO_ZHAO]: "hall" },
  worldId: "world:xyy:tavern:v27:checkpoint-source",
  runStage: loggedFixture(checkpointCalls),
});
await checkpointSource.runtime.enqueueWake(XIE_ZHENSHI, {
  wakeId: "wake:tavern-v27:checkpoint-source",
  kind: "opportunity_window",
  evidenceIds: [],
  evidence: [],
});
const checkpointSourceTurns = await checkpointSource.runtime.runUntilIdle({ maxTurns: 4 });
assert.equal(checkpointSourceTurns.length, 4);
assert.equal(checkpointCalls.length, 12);
const checkpoint = await checkpointSource.runtime.checkpoint();
const restartCalls = [];
const restored = createTavernWorldRuntimeV27(state, {
  positions: { [XIE_ZHENSHI]: "hall", [LUO_ZHAO]: "hall" },
  worldId: "world:xyy:tavern:v27:checkpoint-source",
  checkpoint,
  runStage: loggedFixture(restartCalls),
});
const afterRestart = await restored.runtime.runNext({ characterId: XIE_ZHENSHI });
assert.equal(afterRestart.agentTurnId, `agent-turn:${XIE_ZHENSHI}:3`);
assert.equal(afterRestart.outcome.worldVersion, 5);
assert.equal(afterRestart.outcome.primitive, "move");
assert.equal(restored.coordinator.worldState.entities[XIE_ZHENSHI].zoneId, "counter");
assert.equal(restored.coordinator.worldState.objects.tavern_vessel_teapot_1.holderCharacterId, XIE_ZHENSHI);
assert.equal(restartCalls.length, 3);

const boundaryOutcome = await restored.coordinator.submitActionAttempt({
  attemptId: "attempt:tavern-v27:stale-social-boundary",
  actorId: LUO_ZHAO,
  primitive: "move",
  expectedWorldVersion: 0,
  payload: { destinationId: "courtyard", visibleAction: "洛照穿过堂前，走向后院。" },
});
assert.equal(boundaryOutcome.status, "success");
assert.equal(boundaryOutcome.revalidatedFromWorldVersion, 0);
assert.ok(boundaryOutcome.incidentalEffects.some((row) => row.kind === "social_boundary_crossed_without_permission"));
assert.equal(restored.coordinator.worldState.entities[LUO_ZHAO].zoneId, "courtyard");

const concurrentCalls = [];
const concurrent = createTavernWorldRuntimeV27(seedState(), {
  positions: { [XIE_ZHENSHI]: "hall", [LUO_ZHAO]: "hall" },
  worldId: "world:xyy:tavern:v27:concurrency",
  runStage: loggedFixture(concurrentCalls),
});
await Promise.all([
  concurrent.runtime.enqueueWake(XIE_ZHENSHI, {
    wakeId: "wake:concurrent:xie",
    kind: "opportunity_window",
    evidenceIds: [],
    evidence: [],
  }),
  concurrent.runtime.enqueueWake(LUO_ZHAO, {
    wakeId: "wake:concurrent:luo",
    kind: "opportunity_window",
    evidenceIds: [],
    evidence: [],
  }),
]);
const concurrentTurns = await Promise.all([
  concurrent.runtime.runNext({ characterId: XIE_ZHENSHI }),
  concurrent.runtime.runNext({ characterId: LUO_ZHAO }),
]);
assert.deepEqual(concurrentTurns.map((turn) => turn.outcome.worldVersion).sort((a, b) => a - b), [1, 2]);
assert.equal(concurrentTurns.filter((turn) => turn.outcome.revalidatedFromWorldVersion === 0).length, 1);
assert.equal(concurrent.coordinator.journal.events.length, 2);
assert.equal(concurrentCalls.length, 6);

// --- completion follows submission mode and accepted stages, not invocation count ---
const repairState = seedState();
const repairEvents = [];
let repairSabotaged = false;
const repairFixture = createTavernV27FixtureStageRunner();
const repairRuntime = createTavernWorldRuntimeV27(repairState, {
  characterAgentCallMode: "standard", // This diagnostic injects a fault into the historical standalone candidate stage.
  positions: { [XIE_ZHENSHI]: "hall", [LUO_ZHAO]: "hall" },
  worldId: "world:xyy:tavern:v27:stage-repair",
  maxStageProtocolRepairs: 1,
  onStageRejected: async (event) => { repairEvents.push(event); },
  runStage: async (input, options) => {
    const result = await repairFixture(input, options);
    if (options.stage === "agent_candidates" && !repairSabotaged) {
      repairSabotaged = true;
      const sabotaged = structuredClone(result);
      sabotaged.candidates.candidates[0].originAuthority = "world";
      return sabotaged;
    }
    return result;
  },
});
await repairRuntime.runtime.enqueueWake(XIE_ZHENSHI, {
  wakeId: "wake:tavern-v27:stage-repair",
  kind: "opportunity_window",
  evidenceIds: [],
  evidence: [],
});
const repairTurn = await repairRuntime.runtime.runNext({ characterId: XIE_ZHENSHI });
assert.equal(repairEvents.length, 1, "the sabotaged candidates stage must be rejected exactly once");
assert.equal(repairTurn.privateResult.stages.length, 5, "one protocol repair adds one extra stage invocation");
const repairObserverTurn = projectTavernV27TurnForObserver(repairTurn, repairState.characters);
assert.equal(
  repairObserverTurn.characterAgentCompleted,
  true,
  "an atomic turn with one in-turn protocol repair still finished all four accepted stages",
);
assert.equal(repairObserverTurn.submissionMode, "atomic");
assert.equal(repairObserverTurn.acceptedStageCount, 4);
assert.equal(repairObserverTurn.expectedAcceptedStageCount, 4);
assert.equal(repairObserverTurn.fiveStageAgentCompleted, false, "atomic completion must not masquerade as legacy five-stage completion");
assert.equal(repairObserverTurn.protocolRepairCount, 1, "the observer projection reports how many repairs the turn needed");

const stagedCompatibilityTurn = projectTavernV27TurnForObserver({
  characterId: XIE_ZHENSHI,
  agentTurnId: "agent-turn:legacy-staged:1",
  wake: { kind: "legacy-fixture" },
  privateResult: {
    submissionMode: "staged",
    acceptedStageHistory: [
      { stage: "subjective_appraisal_accepted" },
      { stage: "agent_candidates_accepted" },
      { stage: "agent_choice_accepted" },
      { stage: "agent_expression_plan_accepted" },
      { stage: "agent_realization_accepted" },
    ],
    stages: [
      { name: "fixture:subjective_appraisal" },
      { name: "fixture:agent_candidates" },
      { name: "fixture:agent_choice_and_regulation" },
      { name: "fixture:agent_expression_planning" },
      { name: "fixture:agent_realization" },
    ],
  },
}, repairState.characters);
assert.equal(stagedCompatibilityTurn.submissionMode, "staged");
assert.equal(stagedCompatibilityTurn.characterAgentCompleted, true);
assert.equal(stagedCompatibilityTurn.acceptedStageCount, 5);
assert.equal(stagedCompatibilityTurn.expectedAcceptedStageCount, 5);
assert.equal(stagedCompatibilityTurn.fiveStageAgentCompleted, true, "legacy staged observers retain their compatibility completion field");

// --- an empty-delta placeholder on ordinary speech must stay silent at the world boundary ---
const placeholderState = seedState();
const placeholderFixture = createTavernV27FixtureStageRunner();
const placeholderRuntime = createTavernWorldRuntimeV27(placeholderState, {
  positions: { [XIE_ZHENSHI]: "hall", [LUO_ZHAO]: "hall" },
  worldId: "world:xyy:tavern:v27:placeholder",
  runStage: async (input, options) => {
    const result = await placeholderFixture(input, options);
    if (options.stage === "agent_turn_commit") {
      const sabotaged = structuredClone(result);
      sabotaged.turnCommit.publicExpression.bodyDelta = "无";
      return sabotaged;
    }
    return result;
  },
});
await placeholderRuntime.runtime.enqueueWake(XIE_ZHENSHI, {
  wakeId: "wake:tavern-v27:placeholder",
  kind: "opportunity_window",
  evidenceIds: [],
  evidence: [],
});
const placeholderTurn = await placeholderRuntime.runtime.runNext({ characterId: XIE_ZHENSHI });
const placeholderObserverTurn = projectTavernV27TurnForObserver(placeholderTurn, placeholderState.characters);
assert.equal(
  placeholderObserverTurn.publicRealization.visibleAction,
  "",
  "a placeholder such as 无 means no visible action and must never render as one",
);
assert.equal(
  placeholderTurn.outcome?.primitive,
  "speak",
  "ordinary speech remains speech when its body delta is only a placeholder",
);
assert.equal(placeholderTurn.outcome?.status, "success");
assert.equal(placeholderTurn.outcome.deliveries[0].content, "客官，要些什么？");
assert.equal(
  JSON.stringify(placeholderTurn.outcome.committedFacts).includes("\"无\""),
  false,
  "the placeholder string must not be committed into world facts as a visible action",
);

// --- guest positions are neutral, occupiable world affordances ---
const seatState = seedState();
const seatRuntime = createTavernWorldRuntimeV27(seatState, {
  characterIds: [XIE_ZHENSHI, LUO_ZHAO, ZHOU_MIN],
  positions: { [XIE_ZHENSHI]: "hall", [LUO_ZHAO]: "hall", [ZHOU_MIN]: "hall" },
  worldId: "world:xyy:tavern:v27:positions",
  runStage: createTavernV27FixtureStageRunner(),
});
const seatProjectionBefore = projectTavernSituationV27({
  worldState: seatRuntime.coordinator.worldState,
  worldVersion: 0,
  characterId: LUO_ZHAO,
  wake: {},
});
const sideWallAffordance = seatProjectionBefore.availableAffordances
  .find((row) => row.kind === "occupiable_position" && row.positionId === SIDE_WALL_TABLE);
assert.ok(sideWallAffordance, "the side-wall table is projected as an occupiable world affordance");
assert.equal(sideWallAffordance.capacity, 2);
assert.equal(sideWallAffordance.remainingCapacity, 2);
assert.ok(
  seatProjectionBefore.perceivedObjects.some((row) => row.id === SIDE_WALL_TABLE),
  "an occupiable position is a perceivable world thing, not only an institutional description",
);

const luoSeatOutcome = await seatRuntime.coordinator.submitActionAttempt({
  attemptId: "attempt:v27:luo-occupies-side-wall",
  actorId: LUO_ZHAO,
  primitive: "handle",
  expectedWorldVersion: 0,
  payload: { objectId: SIDE_WALL_TABLE, operation: "use_affordance", visibleAction: "洛照走到侧墙空桌旁坐下。" },
});
assert.equal(luoSeatOutcome.status, "success", "the world can actually settle taking a guest position");
assert.equal(seatRuntime.coordinator.worldState.entities[LUO_ZHAO].positionId, SIDE_WALL_TABLE);
assert.deepEqual(seatRuntime.coordinator.worldState.objects[SIDE_WALL_TABLE].occupantCharacterIds, [LUO_ZHAO]);
assert.ok(
  luoSeatOutcome.deliveries.some((row) => row.recipientCharacterId === XIE_ZHENSHI && row.content.includes("坐下")),
  "taking a seat is visible to characters who can see the hall",
);

const xieSeatOutcome = await seatRuntime.coordinator.submitActionAttempt({
  attemptId: "attempt:v27:xie-occupies-side-wall",
  actorId: XIE_ZHENSHI,
  primitive: "handle",
  expectedWorldVersion: 1,
  payload: { objectId: SIDE_WALL_TABLE, operation: "use_affordance" },
});
assert.equal(xieSeatOutcome.status, "success");
const fullSeatOutcome = await seatRuntime.coordinator.submitActionAttempt({
  attemptId: "attempt:v27:zhou-cannot-fit",
  actorId: ZHOU_MIN,
  primitive: "handle",
  expectedWorldVersion: 2,
  payload: { objectId: SIDE_WALL_TABLE, operation: "use_affordance" },
});
assert.equal(fullSeatOutcome.status, "failed");
assert.ok(fullSeatOutcome.failedEffects.some((row) => row.code === "POSITION_FULLY_OCCUPIED"));

const luoLeavesSeat = await seatRuntime.coordinator.submitActionAttempt({
  attemptId: "attempt:v27:luo-moves-away",
  actorId: LUO_ZHAO,
  primitive: "move",
  expectedWorldVersion: 3,
  payload: { destinationId: "courtyard" },
});
assert.equal(luoLeavesSeat.status, "success");
assert.equal(seatRuntime.coordinator.worldState.entities[LUO_ZHAO].positionId, "", "moving away releases the occupied position");
assert.deepEqual(seatRuntime.coordinator.worldState.objects[SIDE_WALL_TABLE].occupantCharacterIds, [XIE_ZHENSHI]);
const zhouRetrySeat = await seatRuntime.coordinator.submitActionAttempt({
  attemptId: "attempt:v27:zhou-retries",
  actorId: ZHOU_MIN,
  primitive: "handle",
  expectedWorldVersion: 4,
  payload: { objectId: SIDE_WALL_TABLE, operation: "use_affordance" },
});
assert.equal(zhouRetrySeat.status, "success", "a released seat can be taken again");
const seatProjectionAfter = projectTavernSituationV27({
  worldState: seatRuntime.coordinator.worldState,
  worldVersion: 5,
  characterId: LUO_ZHAO,
  wake: {},
});
assert.equal(
  seatProjectionAfter.availableAffordances.find((row) => row.kind === "occupiable_position" && row.positionId === SIDE_WALL_TABLE).remainingCapacity,
  0,
  "occupancy is projected back to characters as world state",
);
const takeSeatAway = await seatRuntime.coordinator.submitActionAttempt({
  attemptId: "attempt:v27:zhou-takes-table",
  actorId: ZHOU_MIN,
  primitive: "handle",
  expectedWorldVersion: 6,
  payload: { objectId: SIDE_WALL_TABLE, operation: "take" },
});
assert.equal(takeSeatAway.status, "failed", "a guest position is a place to occupy, not a portable object");

// --- the character action vocabulary is settled by the world, not rejected as unmigrated ---
const gestureOutcome = await seatRuntime.coordinator.submitActionAttempt({
  attemptId: "attempt:v27:zhou-gestures",
  actorId: ZHOU_MIN,
  primitive: "gesture",
  expectedWorldVersion: 7,
  payload: { visibleAction: "周珉朝柜台方向抬手示意。", bodyActions: [{ kind: "raise_hand", direction: "forward", amplitude: "small", speed: "normal" }] },
});
assert.equal(gestureOutcome.status, "success", "a typed gesture is a real visible act the world can settle");
assert.ok(
  gestureOutcome.deliveries.some((row) => row.recipientCharacterId === XIE_ZHENSHI && row.content.includes("抬手")),
  "a gesture reaches characters who can see it",
);
assert.equal(
  gestureOutcome.failedEffects.some((row) => row.code === "ACTION_PRIMITIVE_NOT_YET_MIGRATED"),
  false,
  "gesture is no longer an unmigrated placeholder",
);
const blankGestureOutcome = await seatRuntime.coordinator.submitActionAttempt({
  attemptId: "attempt:v27:zhou-empty-gesture",
  actorId: ZHOU_MIN,
  primitive: "gesture",
  expectedWorldVersion: 8,
  payload: { visibleAction: "" },
});
assert.equal(blankGestureOutcome.status, "failed", "an undescribed gesture has no observable surface to settle");

// --- observing the scene as a whole is a settleable act, not OBSERVE_TARGET_UNKNOWN ---
const sceneObserveOutcome = await seatRuntime.coordinator.submitActionAttempt({
  attemptId: "attempt:v27:luo-surveys-tavern",
  actorId: LUO_ZHAO,
  primitive: "observe",
  expectedWorldVersion: 9,
  payload: { targetId: "" },
});
assert.equal(sceneObserveOutcome.status, "success", "a character can survey the scene without naming one entity");
const sceneObservation = sceneObserveOutcome.deliveries.find((row) => row.recipientCharacterId === LUO_ZHAO);
assert.ok(sceneObservation, "the scene survey returns an observation to the observer");
assert.equal(sceneObservation.content.includes("谢真石"), false, "a scene survey must not certify an unrecognized person's canonical name");
assert.ok(sceneObservation.content.includes("堂前") || sceneObservation.content.includes("一人"));
const zoneObserveOutcome = await seatRuntime.coordinator.submitActionAttempt({
  attemptId: "attempt:v27:luo-observes-hall",
  actorId: LUO_ZHAO,
  primitive: "observe",
  expectedWorldVersion: 10,
  payload: { targetId: "hall" },
});
assert.equal(zoneObserveOutcome.status, "success", "a reachable zone is an observable target");
assert.equal(
  zoneObserveOutcome.failedEffects.some((row) => row.code === "OBSERVE_TARGET_UNKNOWN"),
  false,
);

// --- rest, practice and leave are also world-settled acts ---
const restOutcome = await seatRuntime.coordinator.submitActionAttempt({
  attemptId: "attempt:v27:zhou-rests",
  actorId: ZHOU_MIN,
  primitive: "rest",
  expectedWorldVersion: 11,
  payload: { visibleAction: "周珉在座位上靠着歇了口气。" },
});
assert.equal(restOutcome.status, "success", "resting is a settleable durative act");
assert.ok(restOutcome.durationSeconds >= 30, "rest takes real world time");
assert.ok(
  restOutcome.deliveries.some((row) => row.recipientCharacterId === XIE_ZHENSHI && row.content.includes("歇")),
  "a visible rest reaches characters who can see it",
);
const practiceOutcome = await seatRuntime.coordinator.submitActionAttempt({
  attemptId: "attempt:v27:xie-practices",
  actorId: XIE_ZHENSHI,
  primitive: "practice",
  expectedWorldVersion: 12,
  payload: { visibleAction: "谢真石在堂前空处走了一遍剑架。" },
});
assert.equal(practiceOutcome.status, "success", "practice is a settleable durative act");
assert.ok(practiceOutcome.durationSeconds >= 60, "practice takes longer than a beat");
const luoReturnsToSeat = await seatRuntime.coordinator.submitActionAttempt({
  attemptId: "attempt:v27:luo-returns-hall",
  actorId: LUO_ZHAO,
  primitive: "move",
  expectedWorldVersion: 13,
  payload: { destinationId: "hall" },
});
assert.equal(luoReturnsToSeat.status, "success");
const leaveOutcome = await seatRuntime.coordinator.submitActionAttempt({
  attemptId: "attempt:v27:luo-leaves",
  actorId: LUO_ZHAO,
  primitive: "leave",
  expectedWorldVersion: 14,
  payload: { visibleAction: "洛照起身，朝门槛外走去。" },
});
assert.equal(leaveOutcome.status, "success", "leaving the place is a settleable act");
assert.equal(seatRuntime.coordinator.worldState.entities[LUO_ZHAO].present, false, "a departed character is no longer present");
assert.ok(
  leaveOutcome.deliveries.some((row) => row.recipientCharacterId === XIE_ZHENSHI && row.content.includes("走去")),
  "a visible departure reaches characters who can see it",
);
const departedProjection = projectTavernSituationV27({
  worldState: seatRuntime.coordinator.worldState,
  worldVersion: 15,
  characterId: XIE_ZHENSHI,
  wake: {},
});
assert.equal(
  departedProjection.perceivedCharacters.some((row) => row.id === LUO_ZHAO),
  false,
  "a departed character disappears from other characters' perception",
);

console.log(JSON.stringify({
  status: "all-passed",
  gate: "tavern-v27-testable-runtime-vertical",
  checks: {
    submissionModeAwareCharacterAgentRunsInsidePersistentActor: true,
    twoCharactersContinueFromCommittedSensoryEffects: true,
    speechHandleAndObservationReachPhysicalRecipients: true,
    silenceDoesNotCreateWorldFact: true,
    deliveryActivatesAtMostOnceWithoutAssumingConsumption: true,
    privateFoundationsRemainRecipientIsolated: true,
    hiddenObjectAndAuthorIdentitySummaryDoNotLeak: true,
    checkpointRestoresActorSequenceAndWorld: true,
    staleWorldVersionIsSerializedAndRevalidated: true,
    socialBoundaryIsAConsequenceNotAnActionGate: true,
    simultaneousCharactersCannotWriteWorldConcurrently: true,
    submissionAwareCompletionSurvivesProtocolRepair: true,
    placeholderGestureDoesNotBecomeWorldAction: true,
    guestPositionsAreOccupiableWorldAffordances: true,
    gestureIsAWorldSettledVisibleAct: true,
    sceneAndZoneObservationAreSettleable: true,
    typedPlaceInteractionIsNotObjectHandling: true,
    untargetedSpeechReachesAudiblePresentCharacters: true,
    worldDoesNotFabricateInteractionResponses: true,
    restPracticeAndLeaveAreSettleable: true,
    serviceRequiresRealVesselMovementAndPreparation: true,
    processReadinessIsWorldOwned: true,
    completedServiceQuiescesWithoutSyntheticTurns: true,
  },
  fixture: {
    actorTurns: turns.length,
    actionTurns: actionTurns.length,
    reflectionTurns: reflectionTurns.length,
    characterAgentStages: stageCalls.length,
    committedWorldEvents: observer.worldVersion,
  },
}, null, 2));
