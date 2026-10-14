import assert from "node:assert/strict";

import { lowerTavernV27WorldAttempt } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { createWorldActionRegistry } from "../src/server/simulation/worldActionRegistry.mjs";
import { createWorldCommitCoordinator } from "../src/server/simulation/worldCommitCoordinator.mjs";

const actorId = "char:a";
const otherId = "char:b";
const initialWorldState = {
  worldId: "world:coordinator-probe",
  nowSeconds: 0,
  entities: {
    [actorId]: { id: actorId, kind: "character", present: true, placeId: "place:house", zoneId: "hall" },
    [otherId]: { id: otherId, kind: "character", present: true, placeId: "place:house", zoneId: "hall" },
  },
  objects: {},
  signals: [],
  places: {
    "place:house": {
      placeId: "place:house",
      topology: {
        zones: {
          hall: { id: "hall", label: "hall" },
          courtyard: { id: "courtyard", label: "courtyard" },
          locked_room: { id: "locked_room", label: "locked room" },
        },
        edges: [
          { from: "hall", to: "courtyard", move: 1, sound: 1, visual: 1 },
          { from: "hall", to: "locked_room", move: 1, sound: 1, barrier: "locked-door" },
        ],
      },
      socialBoundaries: [{
        id: "boundary:private-courtyard",
        zoneIds: ["courtyard"],
        permissionRequiredByNorm: true,
        claimantIds: [otherId],
        evidenceIds: ["fact:private-sign"],
        possibleResponseTags: ["question", "warn", "ignore"],
      }],
      accessGrants: [],
    },
  },
};

const typedPositionState = structuredClone(initialWorldState);
typedPositionState.worldId = "world:typed-position-probe";
typedPositionState.objects["position:hall-window"] = {
  id: "position:hall-window",
  kind: "position",
  placeId: "place:house",
  zoneId: "hall",
  capacity: 1,
  occupantCharacterIds: [],
};
const typedPositionCoordinator = createWorldCommitCoordinator({
  worldId: typedPositionState.worldId,
  initialWorldState: typedPositionState,
  actionRegistry: createWorldActionRegistry(),
});
const typedPositionAttempt = lowerTavernV27WorldAttempt({
  rawDecision: {
    actionAttempt: {
      primitive: "move",
      objectId: "",
      targetCharacterId: "",
      destinationId: "",
      positionId: "position:hall-window",
      affordanceId: "",
      actionBinding: {
        kind: "position",
        positionId: "position:hall-window",
      },
    },
    visibleAction: "走到临窗的位置。",
  },
});
assert.equal(typedPositionAttempt.payload.positionId, "position:hall-window");
assert.equal(typedPositionAttempt.payload.destinationId, "", "a named position must not be coerced into a zone id");
const typedPositionOutcome = await typedPositionCoordinator.submitActionAttempt({
  attemptId: "attempt:typed-position",
  actorId,
  expectedWorldVersion: 0,
  ...typedPositionAttempt,
});
assert.equal(typedPositionOutcome.status, "success");
assert.equal(typedPositionCoordinator.worldState.entities[actorId].positionId, "position:hall-window");
assert.deepEqual(
  typedPositionCoordinator.worldState.objects["position:hall-window"].occupantCharacterIds,
  [actorId],
);
assert.ok(!typedPositionOutcome.failedEffects.some((row) => row.code === "MOVEMENT_ZONE_UNKNOWN"));

const focusedObservationState = structuredClone(initialWorldState);
focusedObservationState.worldId = "world:focused-observation-probe";
focusedObservationState.entities[otherId].publicSignalFeatures = [{
  featureId: "feature:robe-dust",
  modality: "visual",
  physicalFeature: "袖口沾着一点灰",
  domainTags: ["appearance", "clothing"],
}, {
  featureId: "feature:balanced-step",
  modality: "visual",
  physicalFeature: "落脚时重心收得很稳",
  domainTags: ["movement"],
}];
focusedObservationState.objects["object:sheathed-sword"] = {
  id: "object:sheathed-sword",
  kind: "object",
  label: "一柄入鞘长剑",
  holderCharacterId: otherId,
  placeId: "place:house",
  zoneId: "hall",
  presentation: { exposure: "visible", publiclyVisible: true },
};
focusedObservationState.processes = [{
  id: "process:footwork",
  kind: "practice",
  ownerActorId: otherId,
  stationZoneId: "hall",
  attentionMode: "continuous_work",
  status: "active",
  metadata: { publicLabel: "调整落脚", unitAction: "缓慢调整落脚" },
}];
const focusedObservationCoordinator = createWorldCommitCoordinator({
  worldId: focusedObservationState.worldId,
  initialWorldState: focusedObservationState,
  actionRegistry: createWorldActionRegistry(),
});
const focusedObservationAttempt = lowerTavernV27WorldAttempt({
  selectedCandidate: {
    intention: "留意对方的佩剑、落脚和动作。",
    domains: ["martial", "observation"],
  },
  rawDecision: {
    actionAttempt: {
      primitive: "observe",
      objectId: "",
      targetCharacterId: otherId,
      destinationId: "",
      positionId: "",
      affordanceId: "",
      actionBinding: {
        kind: "character",
        targetCharacterId: otherId,
      },
    },
  },
});
assert.ok(focusedObservationAttempt.payload.attentionTags.includes("weapon"));
assert.ok(focusedObservationAttempt.payload.attentionTags.includes("movement"));
const focusedObservationOutcome = await focusedObservationCoordinator.submitActionAttempt({
  attemptId: "attempt:focused-observation",
  actorId,
  expectedWorldVersion: 0,
  ...focusedObservationAttempt,
});
const focusedObservationResult = focusedObservationOutcome.deliveries.find((row) => row.eventKind === "observation_result");
assert.match(focusedObservationResult.content, /入鞘长剑/u);
assert.match(focusedObservationResult.content, /重心|落脚/u);
assert.match(focusedObservationResult.content, /正在缓慢调整落脚/u);
assert.doesNotMatch(focusedObservationResult.content, /袖口沾着一点灰/u);
assert.deepEqual(
  focusedObservationResult.semanticFrame.observationResult.attentionTags,
  focusedObservationAttempt.payload.attentionTags,
);

const coordinator = createWorldCommitCoordinator({
  worldId: initialWorldState.worldId,
  initialWorldState,
  actionRegistry: createWorldActionRegistry(),
});

const spatialDescriptionCoordinator = createWorldCommitCoordinator({
  worldId: "world:coordinator-spatial-description-probe",
  initialWorldState: {
    ...structuredClone(initialWorldState),
    worldId: "world:coordinator-spatial-description-probe",
    entities: {
      ...structuredClone(initialWorldState.entities),
      [actorId]: {
        ...structuredClone(initialWorldState.entities[actorId]),
        publicDescription: "char:a在hall",
      },
    },
  },
  actionRegistry: createWorldActionRegistry(),
});
await spatialDescriptionCoordinator.submitActionAttempt({
  attemptId: "attempt:spatial-move",
  actorId,
  primitive: "move",
  expectedWorldVersion: 0,
  payload: { destinationId: "courtyard" },
});
const observedAfterMove = await spatialDescriptionCoordinator.submitActionAttempt({
  attemptId: "attempt:observe-after-move",
  actorId: otherId,
  primitive: "observe",
  expectedWorldVersion: 1,
  payload: { targetKind: "character", targetId: actorId },
});
assert.match(observedAfterMove.deliveries[0].content, /courtyard/u);
assert.doesNotMatch(observedAfterMove.deliveries[0].content, /在hall/u, "observation must derive location from current zoneId, not a cached sentence");

const mixedCoordinator = createWorldCommitCoordinator({
  worldId: "world:coordinator-mixed-action-probe",
  initialWorldState: {
    ...structuredClone(initialWorldState),
    worldId: "world:coordinator-mixed-action-probe",
  },
  actionRegistry: createWorldActionRegistry(),
});
const observedWhileSpeaking = await mixedCoordinator.submitActionAttempt({
  attemptId: "attempt:observe-and-answer",
  actorId,
  primitive: "observe",
  expectedWorldVersion: 0,
  payload: {
    targetId: otherId,
    targetCharacterId: otherId,
    utterance: "明白。",
    visibleAction: "仍看着对方。",
  },
});
assert.equal(observedWhileSpeaking.primitive, "observe", "the chosen physical primitive remains primary");
assert.equal(observedWhileSpeaking.status, "success");
assert.ok(observedWhileSpeaking.committedFacts.some((row) => row.kind === "attention_oriented"));
assert.ok(observedWhileSpeaking.committedFacts.some((row) => row.kind === "utterance_emitted" && row.utterance === "明白。"));
assert.ok(observedWhileSpeaking.deliveries.some((row) => row.eventKind === "observation_result" && row.recipientCharacterId === actorId));
assert.ok(observedWhileSpeaking.deliveries.some((row) => row.eventKind === "speech" && row.recipientCharacterId === otherId));
assert.equal(mixedCoordinator.worldState.signals.at(-1).utterance, "明白。");

const listeningCoordinator = createWorldCommitCoordinator({
  worldId: "world:coordinator-listening-probe",
  initialWorldState: {
    ...structuredClone(initialWorldState),
    worldId: "world:coordinator-listening-probe",
  },
  actionRegistry: createWorldActionRegistry(),
});
const freshSpeech = await listeningCoordinator.submitActionAttempt({
  attemptId: "attempt:fresh-speech",
  actorId: otherId,
  primitive: "speak",
  expectedWorldVersion: 0,
  payload: { targetCharacterId: actorId, utterance: "刚说的话。" },
});
assert.equal(freshSpeech.status, "success");
const heardFreshSpeech = await listeningCoordinator.submitActionAttempt({
  attemptId: "attempt:listen-fresh-character",
  actorId,
  primitive: "listen",
  expectedWorldVersion: 1,
  payload: { targetKind: "character", targetId: otherId },
});
assert.equal(heardFreshSpeech.status, "success");
assert.equal(heardFreshSpeech.deliveries[0].content, "刚说的话。");

const listenedAtDifferentRoom = await listeningCoordinator.submitActionAttempt({
  attemptId: "attempt:listen-at-room",
  actorId,
  primitive: "listen",
  expectedWorldVersion: 2,
  payload: { targetKind: "place", targetId: "locked_room" },
});
assert.equal(listenedAtDifferentRoom.status, "partial");
assert.equal(
  listenedAtDifferentRoom.deliveries.filter((row) => row.eventKind === "listening_result").length,
  0,
  "a place-bound listen must not capture a recent voice from another zone",
);
assert.ok(listenedAtDifferentRoom.failedEffects.some((row) => row.code === "LISTEN_NO_AUDIBLE_SIGNAL"));
assert.equal(listeningCoordinator.worldState.entities[actorId].listeningTargetId, "locked_room");
assert.equal(listeningCoordinator.worldState.entities[actorId].listeningTargetKind, "place");

await listeningCoordinator.submitActionAttempt({
  attemptId: "attempt:let-speech-expire",
  actorId,
  primitive: "rest",
  expectedWorldVersion: 3,
  payload: { durationSeconds: 30, visibleAction: "原地等了一阵。" },
});
const staleSpeechNotReheard = await listeningCoordinator.submitActionAttempt({
  attemptId: "attempt:listen-stale-character",
  actorId,
  primitive: "listen",
  expectedWorldVersion: 4,
  payload: { targetKind: "character", targetId: otherId },
});
assert.equal(staleSpeechNotReheard.status, "partial");
assert.equal(
  staleSpeechNotReheard.deliveries.filter((row) => row.eventKind === "listening_result").length,
  0,
  "expired speech must not be replayed as a present sound",
);

const observed = await coordinator.submitActionAttempt({
  attemptId: "attempt:observe",
  actorId,
  primitive: "observe",
  expectedWorldVersion: 0,
  payload: { targetId: otherId },
});
assert.equal(observed.status, "success");
assert.equal(observed.worldVersion, 1);
assert.equal(coordinator.worldState.entities[actorId].orientationTargetId, otherId);

const [spoken, moved] = await Promise.all([
  coordinator.submitActionAttempt({
    attemptId: "attempt:speak",
    actorId,
    primitive: "speak",
    expectedWorldVersion: 1,
    payload: { targetCharacterId: otherId, utterance: "Are you there?" },
  }),
  coordinator.submitActionAttempt({
    attemptId: "attempt:move",
    actorId,
    primitive: "move",
    expectedWorldVersion: 1,
    payload: { destinationId: "courtyard" },
  }),
]);

assert.equal(spoken.worldVersion, 2);
assert.equal(spoken.deliveries[0].recipientCharacterId, otherId);
assert.equal(moved.worldVersion, 3, "concurrent attempts must serialize into one world version sequence");
assert.equal(moved.revalidatedFromWorldVersion, 1);
assert.equal(coordinator.worldState.entities[actorId].zoneId, "courtyard");
assert.ok(moved.committedFacts.some((row) => row.kind === "social_boundary_crossed_without_permission"));
assert.equal(Object.hasOwn(moved, "selectedResponse"), false);

const duplicate = await coordinator.submitActionAttempt({
  attemptId: "attempt:move",
  actorId,
  primitive: "move",
  expectedWorldVersion: 1,
  payload: { destinationId: "courtyard" },
});
assert.deepEqual(duplicate, moved, "idempotent retry must return the committed outcome");
assert.equal(coordinator.journal.worldVersion, 3);

const failedHandle = await coordinator.submitActionAttempt({
  attemptId: "attempt:missing-object",
  actorId,
  primitive: "handle",
  expectedWorldVersion: 3,
  payload: { objectId: "object:missing", operation: "take" },
});
assert.equal(failedHandle.status, "failed");
assert.equal(failedHandle.worldVersion, 4, "failed target effects are still committed attempts");
assert.ok(failedHandle.failedEffects.some((row) => row.code === "HANDLE_OBJECT_UNKNOWN"));
const failedSelfResult = failedHandle.deliveries.find((row) => (
  row.eventKind === "own_action_result"
  && row.recipientCharacterId === actorId
  && row.modality === "proprioception"
));
assert.ok(failedSelfResult, "every settled attempt returns an objective result to the acting body");
assert.equal(failedSelfResult.semanticFrame.actionResult.status, "failed");
assert.deepEqual(failedSelfResult.semanticFrame.actionResult.failureCodes, ["HANDLE_OBJECT_UNKNOWN"]);
assert.equal(Object.hasOwn(failedSelfResult.semanticFrame.actionResult, "feltEmotion"), false);

await assert.rejects(coordinator.submitActionAttempt({
  attemptId: "attempt:private-leak",
  actorId,
  primitive: "speak",
  expectedWorldVersion: 4,
  payload: { utterance: "hello", privateReason: "must never enter world" },
}), (error) => error.code === "WORLD_ACTION_PRIVATE_PAYLOAD_FORBIDDEN");
assert.equal(coordinator.journal.worldVersion, 4);
assert.equal(JSON.stringify(coordinator.journal).includes("must never enter world"), false);

const checkpoint = coordinator.checkpoint();
const restored = createWorldCommitCoordinator({
  worldId: checkpoint.worldId,
  checkpoint,
  actionRegistry: createWorldActionRegistry(),
});
assert.equal(restored.journal.worldVersion, 4);
assert.equal(restored.worldState.entities[actorId].zoneId, "courtyard");
assert.deepEqual(await restored.submitActionAttempt({
  attemptId: "attempt:move",
  actorId,
  primitive: "move",
  expectedWorldVersion: 1,
  payload: { destinationId: "courtyard" },
}), moved, "idempotency must survive coordinator restart");

console.log(JSON.stringify({
  status: "all-passed",
  checks: {
    monotonicWorldCommit: true,
    concurrentThoughtSerialized: true,
    staleVersionRevalidated: true,
    idempotentRetry: true,
    socialViolationIsFactNotResponse: true,
    failedTargetEffectStillJournaled: true,
    privatePayloadRejected: true,
    checkpointRestored: true,
    accompanyingSpeechCommittedWithPrimaryAction: true,
    typedListeningTargetKeptSeparateFromSpeechAudience: true,
    transientSpeechExpiresBeforeLaterListening: true,
    observedLocationComesFromCurrentWorldZone: true,
    ownActionResultReturnsAsProprioception: true,
    characterChosenObservationFocusShapesObjectiveResult: true,
  },
}, null, 2));
