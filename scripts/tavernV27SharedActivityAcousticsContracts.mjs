import assert from "node:assert/strict";

import {
  lowerTavernV27WorldAttempt,
  projectTavernSituationV27,
} from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { createWorldActionRegistry } from "../src/server/simulation/worldActionRegistry.mjs";
import { createWorldCommitCoordinator } from "../src/server/simulation/worldCommitCoordinator.mjs";

const initiatorId = "char:initiator";
const responderId = "char:responder";
const worldState = {
  worldId: "world:v27-shared-activity-acoustics",
  worldVersion: 0,
  nowSeconds: 0,
  entities: {
    [initiatorId]: {
      id: initiatorId,
      kind: "character",
      name: "甲",
      present: true,
      placeId: "place:tavern",
      zoneId: "hall",
    },
    [responderId]: {
      id: responderId,
      kind: "character",
      name: "乙",
      present: true,
      placeId: "place:tavern",
      zoneId: "courtyard",
    },
  },
  objects: {},
  signals: [],
  processes: [],
  sharedActivities: [],
  socialFacts: [],
  places: {
    "place:tavern": {
      id: "place:tavern",
      name: "测试酒馆",
      topology: {
        zones: {
          threshold: { id: "threshold", label: "门槛" },
          hall: { id: "hall", label: "堂前" },
          courtyard: { id: "courtyard", label: "后院" },
          stairs: { id: "stairs", label: "楼梯口" },
          guest_room: { id: "guest_room", label: "客房" },
        },
        edges: [
          { from: "threshold", to: "hall", move: 1, sound: 1, visual: 1 },
          { from: "hall", to: "courtyard", move: 1, sound: 1, visual: 1 },
          { from: "hall", to: "stairs", move: 1, sound: 1, visual: 1 },
          { from: "stairs", to: "guest_room", move: 1, sound: Infinity, visual: Infinity, barrier: "closed-door" },
        ],
      },
      socialBoundaries: [{
        id: "boundary:work-area",
        zoneIds: ["courtyard"],
        exemptActorIds: [initiatorId],
        claimantIds: [initiatorId],
        permissionRequiredByNorm: true,
        evidenceIds: ["fact:household-ownership"],
      }],
      accessGrants: [],
      institution: {},
      perceptionEnvironment: {},
    },
  },
};

function lowerSpeech({
  actorId,
  targetCharacterId,
  speech,
  vocalMode = "conversational",
  sharedActivity = null,
} = {}) {
  const lowered = lowerTavernV27WorldAttempt({
    rawDecision: {
      actionAttempt: {
        primitive: "speak",
        objectId: "",
        targetCharacterId,
        destinationId: "",
        positionId: "",
        affordanceId: "",
        actionBinding: { kind: "character", targetCharacterId },
      },
      targetCharacterId,
      speechTargetCharacterId: targetCharacterId,
      speech,
      speechAct: "inform",
      speechFunctions: ["inform"],
      utterance: { literalSpeech: speech, vocalMode },
      sharedActivity,
    },
  });
  return { actorId, ...lowered };
}

const proposal = {
  operation: "propose",
  activityId: "activity:test:spar",
  kind: "controlled_spar",
  participantIds: [initiatorId, responderId],
  requestedZoneId: "courtyard",
  response: "none",
  boundaries: {
    intensity: "controlled",
    propertyProtection: true,
    harmLimit: "stop_before_injury",
    note: "",
  },
};

const loweredProposal = lowerSpeech({
  actorId: initiatorId,
  targetCharacterId: responderId,
  speech: "到后院过一招？",
  vocalMode: "conversational",
  sharedActivity: proposal,
});
assert.equal(loweredProposal.payload.vocalMode, "conversational", "the Character-owned vocal mode must reach the world");
assert.equal(loweredProposal.payload.sharedActivity.activityId, proposal.activityId, "the selected shared activity must reach the world");

const accompanyingSpeechState = structuredClone(worldState);
accompanyingSpeechState.worldId = "world:v27-accompanying-speech-lineage";
const accompanyingSpeechCoordinator = createWorldCommitCoordinator({
  worldId: accompanyingSpeechState.worldId,
  initialWorldState: accompanyingSpeechState,
  actionRegistry: createWorldActionRegistry(),
});
const accompanyingSpeech = await accompanyingSpeechCoordinator.submitActionAttempt({
  attemptId: "attempt:gesture-with-answer",
  actorId: initiatorId,
  expectedWorldVersion: 0,
  ...lowerTavernV27WorldAttempt({
    rawDecision: {
      sourceThreadId: "thread:accompanying-speech",
      responseToTurnId: "turn:prior-question",
      actionAttempt: {
        primitive: "gesture",
        targetCharacterId: responderId,
        actionBinding: { kind: "character", targetCharacterId: responderId },
      },
      targetCharacterId: responderId,
      speechTargetCharacterId: responderId,
      speech: "知道了。",
      speechAct: "answer",
      speechFunctions: ["answer"],
      visibleAction: "甲点了点头。",
      utterance: { literalSpeech: "知道了。", vocalMode: "conversational" },
    },
  }),
});
const accompanyingSpeechDelivery = accompanyingSpeech.deliveries.find((row) => (
  String(row.eventKind || "").trim() === "speech"
  && String(row.recipientCharacterId || "").trim() === responderId
));
assert.equal(accompanyingSpeechDelivery?.provenance?.sourceActionId, "attempt:gesture-with-answer",
  "speech accompanying a physical action must retain its own objective turn id");
assert.equal(accompanyingSpeechDelivery?.provenance?.sourceThreadId, "thread:accompanying-speech",
  "speech accompanying a physical action must retain the inherited thread");
assert.equal(accompanyingSpeechDelivery?.provenance?.responseToTurnId, "turn:prior-question",
  "speech accompanying a physical action must retain its precise parent turn");

const coordinator = createWorldCommitCoordinator({
  worldId: worldState.worldId,
  initialWorldState: worldState,
  actionRegistry: createWorldActionRegistry(),
});
const proposed = await coordinator.submitActionAttempt({
  attemptId: "attempt:propose",
  expectedWorldVersion: 0,
  ...loweredProposal,
});
assert.equal(proposed.status, "success");
assert.ok(proposed.resolvedEffects.some((row) => row.kind === "shared_activity_proposed"));
assert.equal(coordinator.worldState.sharedActivities[0].status, "proposed");
assert.deepEqual(
  new Set(coordinator.worldState.sharedActivities[0].communicatedToCharacterIds),
  new Set([initiatorId, responderId]),
  "only people reached by the outward proposal become objective recipients of that proposal",
);

const responderProjection = projectTavernSituationV27({
  worldState: coordinator.worldState,
  worldVersion: 1,
  characterId: responderId,
});
assert.equal(responderProjection.sharedActivities[0].activityId, proposal.activityId);
assert.equal(responderProjection.sharedActivities[0].consentByCharacterId[responderId], "pending");
assert.equal(
  JSON.stringify(responderProjection.sharedActivities).includes(initiatorId),
  false,
  "another participant's canonical world id must not leak through the shared-activity projection",
);
assert.ok(
  responderProjection.sharedActivities[0].participantIds.some((id) => id.startsWith("perceived_entity:")),
  "the recipient continues the agreement through its own stable participant handle",
);

const accepted = await coordinator.submitActionAttempt({
  attemptId: "attempt:accept",
  expectedWorldVersion: 1,
  ...lowerSpeech({
    actorId: responderId,
    targetCharacterId: initiatorId,
    speech: "好。",
    vocalMode: "conversational",
    sharedActivity: {
      ...proposal,
      operation: "respond",
      response: "accept",
    },
  }),
});
assert.equal(accepted.status, "success");
assert.ok(accepted.resolvedEffects.some((row) => row.kind === "shared_activity_accepted"));
assert.equal(coordinator.worldState.sharedActivities[0].status, "accepted");
assert.equal(coordinator.worldState.places["place:tavern"].accessGrants.length, 1);
assert.equal(coordinator.worldState.places["place:tavern"].accessGrants[0].beneficiaryIds.includes(responderId), true);
const acceptedResponderProjection = projectTavernSituationV27({
  worldState: coordinator.worldState,
  worldVersion: 2,
  characterId: responderId,
});
assert.equal(
  acceptedResponderProjection.reachableZones.find((row) => row.id === "courtyard").socialAccess.permissionCurrentlyGranted,
  true,
  "an authorized participant's explicit acceptance may grant social permission without changing physical topology",
);

await coordinator.submitActionAttempt({
  attemptId: "attempt:initiator-enters-courtyard",
  actorId: initiatorId,
  primitive: "move",
  expectedWorldVersion: 2,
  payload: { destinationId: "courtyard" },
});
const started = await coordinator.submitActionAttempt({
  attemptId: "attempt:start-spar",
  expectedWorldVersion: 3,
  ...lowerSpeech({
    actorId: responderId,
    targetCharacterId: initiatorId,
    speech: "来。",
    sharedActivity: { ...proposal, operation: "start" },
  }),
});
assert.equal(started.status, "success");
assert.ok(started.resolvedEffects.some((row) => row.kind === "shared_activity_started"));
assert.equal(coordinator.worldState.sharedActivities[0].status, "active");

const completed = await coordinator.submitActionAttempt({
  attemptId: "attempt:complete-spar",
  expectedWorldVersion: 4,
  ...lowerSpeech({
    actorId: initiatorId,
    targetCharacterId: responderId,
    speech: "到此。",
    sharedActivity: { ...proposal, operation: "complete" },
  }),
});
assert.equal(completed.status, "success");
assert.ok(completed.resolvedEffects.some((row) => row.kind === "shared_activity_completed"));
assert.equal(coordinator.worldState.sharedActivities[0].status, "completed");
assert.equal(coordinator.worldState.places["place:tavern"].accessGrants[0].status, "revoked");

// Two open acoustic edges are too far for ordinary conversation.
const spacedState = structuredClone(worldState);
spacedState.worldId = "world:v27-two-edge-speech";
spacedState.entities[initiatorId].zoneId = "threshold";
spacedState.entities[responderId].zoneId = "courtyard";
const spacedCoordinator = createWorldCommitCoordinator({
  worldId: spacedState.worldId,
  initialWorldState: spacedState,
  actionRegistry: createWorldActionRegistry(),
});
const tooQuiet = await spacedCoordinator.submitActionAttempt({
  attemptId: "attempt:too-quiet",
  expectedWorldVersion: 0,
  ...lowerSpeech({
    actorId: initiatorId,
    targetCharacterId: responderId,
    speech: "过来。",
    vocalMode: "conversational",
  }),
});
assert.equal(tooQuiet.status, "partial");
assert.ok(tooQuiet.failedEffects.some((row) => row.code === "SPEECH_TARGET_NOT_REACHED"));
assert.equal(tooQuiet.deliveries.some((row) => row.recipientCharacterId === responderId && row.eventKind === "speech"), false);

const unheardProposal = await spacedCoordinator.submitActionAttempt({
  attemptId: "attempt:unheard-proposal",
  expectedWorldVersion: 1,
  ...lowerSpeech({
    actorId: initiatorId,
    targetCharacterId: responderId,
    speech: "过一招？",
    vocalMode: "conversational",
    sharedActivity: proposal,
  }),
});
assert.equal(unheardProposal.status, "partial");
assert.ok(unheardProposal.failedEffects.some((row) => row.code === "SHARED_ACTIVITY_PARTICIPANTS_NOT_REACHED"));
assert.equal(spacedCoordinator.worldState.sharedActivities.length, 0, "an unheard proposal must not become a shared agreement object");

const calledOut = await spacedCoordinator.submitActionAttempt({
  attemptId: "attempt:call-out",
  expectedWorldVersion: 2,
  ...lowerSpeech({
    actorId: initiatorId,
    targetCharacterId: responderId,
    speech: "到后院来！",
    vocalMode: "call_out",
  }),
});
assert.equal(calledOut.status, "success");
assert.ok(calledOut.deliveries.some((row) => row.recipientCharacterId === responderId && row.eventKind === "speech"));

// A closed acoustic boundary is not bypassed by naming a target or shouting.
const closedState = structuredClone(worldState);
closedState.worldId = "world:v27-closed-door-speech";
closedState.entities[initiatorId].zoneId = "hall";
closedState.entities[responderId].zoneId = "guest_room";
const closedCoordinator = createWorldCommitCoordinator({
  worldId: closedState.worldId,
  initialWorldState: closedState,
  actionRegistry: createWorldActionRegistry(),
});
const blockedCall = await closedCoordinator.submitActionAttempt({
  attemptId: "attempt:blocked-call",
  expectedWorldVersion: 0,
  ...lowerSpeech({
    actorId: initiatorId,
    targetCharacterId: responderId,
    speech: "听得见吗？",
    vocalMode: "call_out",
  }),
});
assert.equal(blockedCall.status, "partial");
assert.ok(blockedCall.failedEffects.some((row) => row.code === "SPEECH_TARGET_NOT_REACHED"));
assert.equal(blockedCall.deliveries.some((row) => row.recipientCharacterId === responderId && row.eventKind === "speech"), false);

// Directed speech remains audible to every person on the real sound route,
// without turning an overhearer into the named recipient or a participant.
const bystanderId = "char:bystander";
const tooFarId = "char:too-far";
const isolatedId = "char:isolated";
const directedState = structuredClone(worldState);
directedState.worldId = "world:v27-directed-speech-real-audience";
directedState.entities[initiatorId].zoneId = "hall";
directedState.entities[responderId].zoneId = "courtyard";
directedState.entities[bystanderId] = {
  id: bystanderId,
  kind: "character",
  name: "丙",
  present: true,
  placeId: "place:tavern",
  zoneId: "threshold",
};
directedState.places["place:tavern"].topology.zones.far_yard = { id: "far_yard", label: "远院" };
directedState.places["place:tavern"].topology.edges.push({
  from: "courtyard",
  to: "far_yard",
  move: 1,
  sound: 1,
  visual: 1,
});
directedState.entities[tooFarId] = {
  id: tooFarId,
  kind: "character",
  name: "丁",
  present: true,
  placeId: "place:tavern",
  zoneId: "far_yard",
};
directedState.entities[isolatedId] = {
  id: isolatedId,
  kind: "character",
  name: "戊",
  present: true,
  placeId: "place:tavern",
  zoneId: "guest_room",
};
const directedCoordinator = createWorldCommitCoordinator({
  worldId: directedState.worldId,
  initialWorldState: directedState,
  actionRegistry: createWorldActionRegistry(),
});
const directedProposal = await directedCoordinator.submitActionAttempt({
  attemptId: "attempt:directed-with-overhearer",
  expectedWorldVersion: 0,
  ...lowerSpeech({
    actorId: initiatorId,
    targetCharacterId: responderId,
    speech: "到后院过一招？",
    vocalMode: "conversational",
    sharedActivity: proposal,
  }),
});
assert.equal(directedProposal.status, "success");
const targetDelivery = directedProposal.deliveries.find((row) => (
  row.eventKind === "speech" && row.recipientCharacterId === responderId
));
const overheardDelivery = directedProposal.deliveries.find((row) => (
  row.eventKind === "speech" && row.recipientCharacterId === bystanderId
));
assert.equal(targetDelivery?.directed, true, "the named reachable recipient receives a directed delivery");
assert.equal(targetDelivery?.overheard, false, "the named recipient is not mislabeled as an overhearer");
assert.equal(overheardDelivery?.directed, false, "a real overhearer must not be told that they were addressed");
assert.equal(overheardDelivery?.overheard, true, "the world marks a third-party delivery as overheard");
assert.deepEqual(
  overheardDelivery?.provenance,
  targetDelivery?.provenance,
  "target and overhearer deliveries retain the same objective speech provenance",
);
assert.equal(
  directedProposal.deliveries.some((row) => row.eventKind === "speech" && row.recipientCharacterId === tooFarId),
  false,
  "ordinary conversation is not delivered beyond its maximum sound distance",
);
assert.equal(
  directedProposal.deliveries.some((row) => row.eventKind === "speech" && row.recipientCharacterId === isolatedId),
  false,
  "a closed acoustic boundary blocks third-party delivery",
);
assert.deepEqual(
  new Set(directedCoordinator.worldState.sharedActivities[0].participantIds),
  new Set([initiatorId, responderId]),
  "an overhearer does not become a shared-activity participant",
);
assert.deepEqual(
  new Set(directedCoordinator.worldState.sharedActivities[0].communicatedToCharacterIds),
  new Set([initiatorId, responderId]),
  "actual acoustic reach does not disguise an overhearer as the proposal's addressee",
);

console.log(JSON.stringify({
  status: "all-passed",
  proposalStatus: coordinator.worldState.sharedActivities[0].status,
  adjacentConversationDelivered: proposed.status === "success",
  twoEdgeConversationBlocked: tooQuiet.status === "partial",
  twoEdgeCallDelivered: calledOut.status === "success",
  closedDoorCallBlocked: blockedCall.status === "partial",
  directedTargetAndOverhearerSeparated: true,
}, null, 2));
