import assert from "node:assert/strict";

import {
  createCausalSceneState,
  evaluateCausalSceneTurn,
  normalizeCausalSceneAdapter,
} from "../src/server/simulation/causalSceneKernel.mjs";

const adapter = normalizeCausalSceneAdapter({
  id: "adapter:no-scene-authority",
  scenes: [{ id: "place:workshop" }],
  zones: [{ id: "front", sceneId: "place:workshop" }],
  edges: [],
  responsibilityRules: [{
    id: "legacy-arrival-rule",
    tag: "receiveVisitor",
    eventKinds: ["arrival"],
  }],
});

const actorId = "char:worker";
const state = createCausalSceneState({
  actors: [{
    id: actorId,
    sceneId: "place:workshop",
    zoneId: "front",
    agency: {
      capabilities: { receiveVisitor: true },
      traits: { conscientiousness: 1 },
    },
  }],
  pendingImpacts: [{
    id: "impact:arrival",
    eventKind: "arrival",
    modality: "visual",
    receivedByActorIds: [actorId],
    priority: 1,
    status: "pending",
  }],
});

const result = evaluateCausalSceneTurn({
  adapter,
  state,
  actorId,
  candidates: [
    {
      id: "candidate:continue-own-work",
      actorId,
      actionKind: "work",
      sourceSceneId: "place:workshop",
      sourceZoneId: "front",
      factors: { desire: 0.8, opportunity: 0.8 },
    },
    {
      id: "candidate:receive-visitor",
      actorId,
      actionKind: "gesture",
      sourceSceneId: "place:workshop",
      sourceZoneId: "front",
      respondsToImpactId: "impact:arrival",
      factors: { desire: 0.05, duty: 0.05, opportunity: 0.4 },
    },
  ],
});

const reception = result.candidates.find((row) => row.id === "candidate:receive-visitor");
assert.equal(reception.signals.duty, 0.05,
  "adapter responsibility rules must not rewrite a Character Agent candidate's duty pressure");
assert.notEqual(reception.priorityClass, "responsibility_obligation",
  "a scene adapter must not promote an unaccepted role into an obligation tier");
assert.equal(result.selectedCandidateId, "candidate:continue-own-work",
  "mere presence and adapter role matching must not choose reception for the person");

console.log("causalKernelNoSceneAuthority:test passed");
