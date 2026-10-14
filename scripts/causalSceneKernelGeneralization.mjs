import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CAUSAL_SCENE_KERNEL_VERSION,
  createCausalSceneState,
  evaluateCausalSceneTurn,
  normalizeCausalSceneAdapter,
  runCausalSceneTurn,
} from "../src/server/simulation/causalSceneKernel.mjs";

const observatoryAdapter = normalizeCausalSceneAdapter({
  id: "adapter_high_altitude_instruments",
  scenes: [
    { id: "scene_north_station" },
    { id: "scene_south_station" },
  ],
  zones: [
    { id: "platform", sceneId: "scene_north_station", publicness: 0.6 },
    { id: "instrument_chamber", sceneId: "scene_north_station", publicness: 0.2 },
    { id: "platform", sceneId: "scene_south_station", publicness: 0.6 },
  ],
  edges: [
    {
      id: "north_platform_chamber",
      sceneId: "scene_north_station",
      fromZoneId: "platform",
      toZoneId: "instrument_chamber",
      modes: ["movement", "sound", "visual"],
      distance: 1,
      bidirectional: true,
    },
  ],
  responsibilityRules: [
    {
      id: "instrument_alert_rule",
      tag: "stabilize_instrument",
      eventKinds: ["instrument_alert"],
      modalities: ["sound"],
    },
  ],
});

const ACTOR_KEEPER = "entity_delta_17";
const ACTOR_WITNESS = "entity_echo_42";
const ACTOR_REMOTE = "entity_foxtrot_93";

const observatoryState = createCausalSceneState({
  actors: [
    {
      id: ACTOR_KEEPER,
      present: true,
      sceneId: "scene_north_station",
      zoneId: "platform",
      agency: {
        capabilities: { stabilize_instrument: 0.95 },
        traits: { conscientiousness: 0.8, caution: 0.5 },
        weights: { duty: 1.1, desire: 1 },
        currentState: { fatigue: 0.25, hunger: 0.1 },
        desires: [
          {
            id: "drive_restore_alignment",
            ownerActorId: ACTOR_KEEPER,
            satisfactionCondition: {
              type: "material_sequence",
              criteria: {
                requiredEvidenceTags: ["alignment_restored"],
                requiredObjectIds: ["object_mount_7"],
                requireOwnerAsBeneficiary: true,
              },
            },
          },
          {
            id: "drive_receive_external_report",
            ownerActorId: ACTOR_KEEPER,
            satisfactionCondition: {
              type: "material_sequence",
              criteria: {
                requiredEvidenceTags: ["external_report_received"],
                requireOwnerAsBeneficiary: true,
              },
            },
          },
        ],
      },
    },
    {
      id: ACTOR_WITNESS,
      present: true,
      sceneId: "scene_north_station",
      zoneId: "platform",
      agency: { capabilities: {}, desires: [] },
    },
    {
      id: ACTOR_REMOTE,
      present: true,
      sceneId: "scene_south_station",
      zoneId: "platform",
      agency: { capabilities: {}, desires: [] },
    },
  ],
  relationships: [
    { id: "rel_witness_keeper", fromActorId: ACTOR_WITNESS, toActorId: ACTOR_KEEPER, trust: 0.4 },
    { id: "rel_remote_keeper", fromActorId: ACTOR_REMOTE, toActorId: ACTOR_KEEPER, trust: 0.4 },
  ],
  objectLedger: {
    objects: [
      {
        id: "object_mount_7",
        sceneId: "scene_north_station",
        zoneId: "platform",
        portable: false,
        state: { aligned: false },
      },
    ],
  },
  pendingImpacts: [
    {
      id: "impact_alignment_alarm",
      sourceActorId: "environment_sensor_8",
      eventKind: "instrument_alert",
      modality: "sound",
      priority: 0.92,
      receivedByActorIds: [ACTOR_KEEPER],
      status: "pending",
    },
  ],
  nowSeconds: 480,
});

const observatoryTurn = runCausalSceneTurn({
  adapter: observatoryAdapter,
  state: observatoryState,
  actorId: ACTOR_KEEPER,
  context: { atmosphere: { danger: 0.1, privacy: 0.5, urgency: 0.8 } },
  candidates: [
    {
      id: "candidate_pause",
      actorId: ACTOR_KEEPER,
      actionKind: "pause",
      sourceSceneId: "scene_north_station",
      sourceZoneId: "platform",
      factors: { desire: 0.25, duty: 0.05, opportunity: 0.7, bodyReward: 0.2 },
      bodyDemand: { reward: 0.4, cost: 0 },
    },
    {
      id: "candidate_restore_alignment",
      actorId: ACTOR_KEEPER,
      actionKind: "operate",
      sourceSceneId: "scene_north_station",
      sourceZoneId: "platform",
      respondsToImpactId: "impact_alignment_alarm",
      factors: { desire: 0.82, duty: 0.74, opportunity: 0.8, bodyCost: 0.1 },
      bodyDemand: { reward: 0, cost: 0.1 },
      requiredObjectIds: ["object_mount_7"],
      objectOperations: [
        {
          type: "update_state",
          actorId: ACTOR_KEEPER,
          objectId: "object_mount_7",
          sceneId: "scene_north_station",
          zoneId: "platform",
          patch: { aligned: true },
        },
      ],
      impact: {
        id: "impact_alignment_restored",
        modality: "visual",
        kind: "state_change",
        intensity: 1,
        radius: 0,
        allowBystanders: true,
        content: "alignment indicator becomes steady",
      },
      relationshipEffects: [
        {
          receiverActorId: ACTOR_WITNESS,
          fromActorId: ACTOR_WITNESS,
          toActorId: ACTOR_KEEPER,
          deltas: { trust: 0.2 },
        },
        {
          receiverActorId: ACTOR_REMOTE,
          fromActorId: ACTOR_REMOTE,
          toActorId: ACTOR_KEEPER,
          deltas: { trust: 0.5 },
        },
      ],
      satisfactionEvidence: {
        tags: ["alignment_restored"],
        beneficiaryActorIds: [ACTOR_KEEPER],
        objectIds: ["object_mount_7"],
      },
    },
  ],
});

assert.equal(observatoryTurn.committed, true);
assert.equal(observatoryTurn.evaluation.selectedCandidateId, "candidate_restore_alignment",
  "character-authored candidate pressure may choose the work without adapter responsibility authority");
assert.equal(observatoryTurn.evaluation.selectedCandidate.responsibility.matched, false,
  "adapter responsibility rules are retained only as deprecated input and may not drive the choice");
assert.equal(observatoryTurn.state.objectLedger.objects.object_mount_7.state.aligned, true,
  "validated object operations must commit atomically with the selected action");
assert.deepEqual(observatoryTurn.deliveries.map((delivery) => delivery.targetActorId), [ACTOR_WITNESS],
  "physical propagation must only reach actors in the source scene and spatial radius");

const witnessRelationship = observatoryTurn.state.relationships.find((row) => row.id === "rel_witness_keeper");
const remoteRelationship = observatoryTurn.state.relationships.find((row) => row.id === "rel_remote_keeper");
assert.equal(witnessRelationship.trust, 0.6,
  "a directional relationship effect may commit after its receiver actually observes the impact");
assert.equal(remoteRelationship.trust, 0.4,
  "a relationship effect must remain unchanged when its nominated receiver did not get the impact");
assert.equal(observatoryTurn.action.relationshipEffects.length, 1);
assert.equal(observatoryTurn.action.rejectedRelationshipEffects[0].code, "RELATIONSHIP_EFFECT_NOT_RECEIVED");

const keeperAfter = observatoryTurn.state.actors.find((actor) => actor.id === ACTOR_KEEPER);
const keeperDrive = keeperAfter.agency.desires.find((desire) => desire.id === "drive_restore_alignment");
const unmatchedDrive = keeperAfter.agency.desires.find((desire) => desire.id === "drive_receive_external_report");
assert.equal(keeperDrive.status, "satisfied",
  "a desire must close only after the committed action carries all required evidence tags and objects");
assert.equal(keeperDrive.satisfiedByActionId, observatoryTurn.action.id);
assert.notEqual(unmatchedDrive.status, "satisfied",
  "an unrelated desire must remain open when the committed evidence does not match its condition");

const crossSceneSpeech = evaluateCausalSceneTurn({
  adapter: observatoryAdapter,
  state: observatoryTurn.state,
  actorId: ACTOR_KEEPER,
  candidates: [
    {
      id: "candidate_cross_scene_whisper",
      actorId: ACTOR_KEEPER,
      actionKind: "speech",
      sourceSceneId: "scene_north_station",
      sourceZoneId: "platform",
      targetActorId: ACTOR_REMOTE,
      speech: { mode: "conversational", content: "status report" },
      factors: { desire: 1, opportunity: 1 },
    },
    {
      id: "candidate_record_status",
      actorId: ACTOR_KEEPER,
      actionKind: "record",
      sourceSceneId: "scene_north_station",
      sourceZoneId: "platform",
      factors: { desire: 0.2, duty: 0.2, opportunity: 0.5 },
    },
  ],
});
assert.equal(crossSceneSpeech.selectedCandidateId, "candidate_record_status");
const blockedSpeech = crossSceneSpeech.candidates.find((row) => row.id === "candidate_cross_scene_whisper");
assert.equal(blockedSpeech.feasible, false,
  "identical local zone ids in different scenes must never create remote conversation");
assert.ok(blockedSpeech.hardGates.some((gate) => gate.id === "speech-spatial-reach" && gate.passed === false));

const unseenImpactState = createCausalSceneState({
  ...observatoryTurn.state,
  pendingImpacts: [
    {
      id: "impact_unseen_alert",
      sourceActorId: "environment_sensor_11",
      eventKind: "instrument_alert",
      modality: "sound",
      priority: 1,
      receivedByActorIds: [ACTOR_REMOTE],
      status: "pending",
    },
  ],
});
const unseenResponsibility = evaluateCausalSceneTurn({
  adapter: observatoryAdapter,
  state: unseenImpactState,
  actorId: ACTOR_KEEPER,
  candidates: [
    {
      id: "candidate_react_to_unseen_alert",
      actorId: ACTOR_KEEPER,
      actionKind: "operate",
      sourceSceneId: "scene_north_station",
      sourceZoneId: "platform",
      respondsToImpactId: "impact_unseen_alert",
      responsibilityTags: ["stabilize_instrument"],
      factors: { desire: 0.05, duty: 0.05, opportunity: 0.3 },
    },
    {
      id: "candidate_continue_local_record",
      actorId: ACTOR_KEEPER,
      actionKind: "record",
      sourceSceneId: "scene_north_station",
      sourceZoneId: "platform",
      factors: { desire: 0.5, duty: 0.3, opportunity: 0.6 },
    },
  ],
});
assert.equal(unseenResponsibility.selectedCandidateId, "candidate_continue_local_record");
assert.equal(
  unseenResponsibility.candidates.find((row) => row.id === "candidate_react_to_unseen_alert").responsibility.matched,
  false,
  "adapter responsibility must not activate from an impact the actor never received",
);

const ferryAdapter = normalizeCausalSceneAdapter({
  id: "adapter_mobile_crossing",
  scenes: [{ id: "scene_crossing_5" }],
  zones: [
    { id: "open_deck", sceneId: "scene_crossing_5", publicness: 0.9 },
    { id: "control_cabin", sceneId: "scene_crossing_5", publicness: 0.3 },
  ],
  edges: [
    {
      id: "deck_cabin",
      sceneId: "scene_crossing_5",
      fromZoneId: "open_deck",
      toZoneId: "control_cabin",
      modes: ["movement", "sound"],
      distance: 1,
      bidirectional: true,
    },
  ],
  responsibilityRules: [
    {
      id: "arrival_rule",
      tag: "acknowledge_arrival",
      eventKinds: ["arrival"],
    },
  ],
});

const ACTOR_OPERATOR = "unit_kappa_61";
const ACTOR_TRAVELLER = "unit_lambda_04";
const ferryState = createCausalSceneState({
  actors: [
    {
      id: ACTOR_OPERATOR,
      present: true,
      sceneId: "scene_crossing_5",
      zoneId: "control_cabin",
      agency: {
        capabilities: { acknowledge_arrival: true },
        traits: { conscientiousness: 0.7 },
        desires: [],
      },
    },
    {
      id: ACTOR_TRAVELLER,
      present: true,
      sceneId: "scene_crossing_5",
      zoneId: "open_deck",
      agency: { capabilities: {}, desires: [] },
    },
  ],
  pendingImpacts: [
    {
      id: "impact_new_arrival",
      sourceActorId: ACTOR_TRAVELLER,
      eventKind: "arrival",
      modality: "visual",
      priority: 0.8,
      receivedByActorIds: [ACTOR_OPERATOR],
      status: "pending",
    },
  ],
});

const ferryTurn = runCausalSceneTurn({
  adapter: ferryAdapter,
  state: ferryState,
  actorId: ACTOR_OPERATOR,
  candidates: [
    {
      id: "candidate_check_controls",
      actorId: ACTOR_OPERATOR,
      actionKind: "inspect",
      sourceSceneId: "scene_crossing_5",
      sourceZoneId: "control_cabin",
      factors: { desire: 0.18, duty: 0.1, opportunity: 0.6 },
    },
    {
      id: "candidate_acknowledge_arrival",
      actorId: ACTOR_OPERATOR,
      actionKind: "call_out",
      sourceSceneId: "scene_crossing_5",
      sourceZoneId: "control_cabin",
      targetActorId: ACTOR_TRAVELLER,
      respondsToImpactId: "impact_new_arrival",
      speech: {
        mode: "call_out",
        content: "wait on the open deck",
        radius: 2,
      },
      factors: { desire: 0.78, duty: 0.68, opportunity: 0.8 },
    },
  ],
});

assert.equal(ferryTurn.committed, true);
assert.equal(ferryTurn.evaluation.selectedCandidateId, "candidate_acknowledge_arrival",
  "the same kernel must respect character-authored pressure in a second place");
assert.equal(ferryTurn.action.vocalMode, "call_out");
assert.deepEqual(ferryTurn.deliveries.map((delivery) => delivery.targetActorId), [ACTOR_TRAVELLER],
  "call-out speech may propagate through an adapter-declared sound edge inside one scene");
assert.equal(ferryTurn.state.pendingImpacts[0].status, "handled");
const deliveredSpeechImpact = ferryTurn.state.pendingImpacts.find((impact) => impact.sourceActionId === ferryTurn.action.id);
assert.deepEqual(deliveredSpeechImpact.receivedByActorIds, [ACTOR_TRAVELLER],
  "a delivered action impact must remain available as causal input for the receiver's next turn");

const kernelSource = await readFile(new URL("../src/server/simulation/causalSceneKernel.mjs", import.meta.url), "utf8");
for (const forbidden of ["tavernAgency", "tavernState", "char_xyy", "望梯", "酒馆"]) {
  assert.equal(kernelSource.includes(forbidden), false, `generic kernel must not contain story adapter token: ${forbidden}`);
}

console.log(JSON.stringify({
  status: "all-passed",
  kernelVersion: CAUSAL_SCENE_KERNEL_VERSION,
  adapters: [observatoryAdapter.id, ferryAdapter.id],
  contracts: {
    responsibilitySelection: false,
    characterAuthoredPressureSelection: true,
    spatialImpactPropagation: true,
    receivedRelationshipEffectsOnly: true,
    evidenceBoundDesireClosure: true,
    sameLocalZoneCrossSceneIsolation: true,
    objectTransaction: true,
    callOutWithinScene: true,
  },
}, null, 2));
