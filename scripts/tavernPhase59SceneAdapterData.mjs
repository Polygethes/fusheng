import assert from "node:assert/strict";

import {
  buildTavernSceneRuntime,
  runTavernCausalScene,
} from "../src/server/pipeline/tavernCausalScene.mjs";

const SCENE_ID = "scene_wind_ferry";
const captainId = "agent_a_ferry_captain";
const travellerId = "agent_z_unknown_traveller";

const topology = {
  schemaVersion: 1,
  locationId: SCENE_ID,
  defaultZoneId: "deck",
  standingDefaultZoneIds: { captain: "wheelhouse" },
  responsibilityRules: [{
    id: "boarding-needs-host",
    tag: "receivePassenger",
    eventKinds: ["boarding"],
  }],
  zones: {
    deck: { id: "deck", label: "ferry deck", closed: false },
    wheelhouse: { id: "wheelhouse", label: "wheelhouse", closed: false },
  },
  edges: [{ from: "deck", to: "wheelhouse", move: 1, sound: 1, visual: 1 }],
};

function character(id, name, standing, priority = 0, knownActorIds = []) {
  return {
    id,
    name,
    visible: "checks the river current",
    currentLocationId: SCENE_ID,
    lifeProfile: {
      simulationTier: "core",
      role: standing,
      activities: { duty: "keep the crossing safe", personal: "read the current", routine: "check the rope" },
      privatePursuit: "reach the opposite bank safely",
      commitments: [],
      tavernAgency: {
        standing,
        responsibilities: [],
        authority: { receivePassenger: standing === "captain" },
        servicePolicy: { priority },
        knowledgeBoundary: { knownActorIds, publicFacts: [], privateFacts: [] },
      },
    },
    lifeState: {
      present: true,
      needs: { fatigue: 10, safety: 20 },
      activeGoal: "read the current",
      currentActivity: { type: "routine", description: "check the rope" },
    },
  };
}

function state(knownActorIds = []) {
  return {
    characters: [
      character(captainId, "River Captain", "captain", 100, knownActorIds),
      character(travellerId, "Unknown Traveller", "traveller", 0),
    ],
    relationships: [],
    characterMemories: [],
    tavernState: {
      activeVisits: [],
      eventThreads: [],
      sceneRuntime: { agents: {}, requestLocks: [], commitments: [] },
    },
  };
}

const initialRuntime = buildTavernSceneRuntime(state(), {
  topology,
  characterIds: [captainId, travellerId],
  allowOrphanVisitors: true,
});
assert.equal(initialRuntime.locationId, SCENE_ID);
assert.equal(initialRuntime.agents[captainId].zoneId, "wheelhouse", "Standing placement must come from adapter data.");
assert.equal(initialRuntime.agents[travellerId].zoneId, "deck", "Unknown standings must use the adapter default zone.");
assert.equal(initialRuntime.agents[captainId].ecologyState.presence.locationId, SCENE_ID);

async function firstInput(knownActorIds = []) {
  const captured = [];
  await runTavernCausalScene(state(knownActorIds), {
    topology,
    characterIds: [captainId, travellerId],
    allowOrphanVisitors: true,
    maxSteps: 1,
    minimumActivationScore: 0,
    runAgent: async (input) => {
      captured.push(input);
      return {
        decision: {
          actionType: "pass",
          speechAct: "none",
          targetCharacterId: "",
          speech: "",
          visibleAction: "",
          moveToZoneId: "",
          vocalMode: "conversational",
          affordanceId: "",
          informationSourceImpactId: "",
          commitmentAction: "none",
          commitmentTopic: "",
          decisionValue: "none",
          privateReason: "No new cause requires action.",
        },
        stage: { provider: "test" },
      };
    },
  });
  return captured.find((input) => input.agent.id === captainId) || captured[0];
}

const strangerInput = await firstInput();
const unknown = strangerInput.perceivedCharacters.find((entry) => entry.identityKnown === false);
assert.ok(unknown, "The captain must perceive an anonymous traveller handle.");
assert.equal(unknown.identityKnown, false, "Shared non-visitor standing must not fabricate acquaintance.");
assert.equal(unknown.name, "");
assert.notEqual(unknown.id, travellerId, "An unknown person's canonical id must not leak into Character Agent input.");
assert.equal(JSON.stringify(strangerInput).includes(travellerId), false);

const knownInput = await firstInput([travellerId]);
const known = knownInput.perceivedCharacters.find((entry) => entry.id === travellerId);
assert.equal(known.identityKnown, true, "Explicit personal knowledge must reveal identity.");
assert.equal(known.name, "Unknown Traveller");

console.log("tavernPhase59SceneAdapterData:test passed", {
  locationId: initialRuntime.locationId,
  placements: {
    captain: initialRuntime.agents[captainId].zoneId,
    traveller: initialRuntime.agents[travellerId].zoneId,
  },
  unknownIdentity: unknown.identityKnown,
  knownIdentity: known.identityKnown,
});
