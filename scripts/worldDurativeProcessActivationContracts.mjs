import assert from "node:assert/strict";

import { createLocalCharacterRuntimePort } from "../src/server/simulation/characterRuntimePort.mjs";
import { createCharacterSessionActor } from "../src/server/simulation/characterSessionActor.mjs";
import { createCharacterWorldRuntime } from "../src/server/simulation/characterWorldRuntime.mjs";
import { startDurativeWorldProcess } from "../src/server/simulation/durativeWorldProcess.mjs";
import { createWorldActionRegistry } from "../src/server/simulation/worldActionRegistry.mjs";
import { createWorldCommitCoordinator } from "../src/server/simulation/worldCommitCoordinator.mjs";

const OWNER = "character:owner";
const PLACE = "place:test";

function worldState({ processes = [] } = {}) {
  return {
    worldId: "world:durative-activation",
    worldVersion: 0,
    nowSeconds: 0,
    entities: {
      [OWNER]: { id: OWNER, kind: "character", present: true, placeId: PLACE, zoneId: "workbench" },
    },
    objects: {},
    signals: [],
    processes,
    places: {
      [PLACE]: {
        topology: { zones: { workbench: { id: "workbench", label: "工作台" } }, edges: [] },
        socialBoundaries: [],
        accessGrants: [],
      },
    },
  };
}

function projector({ worldState: state, characterId, wake }) {
  return {
    authority: "recipient-specific-world-projection",
    recipientCharacterId: characterId,
    nowSeconds: state.nowSeconds,
    place: { placeId: PLACE, zoneId: state.entities[characterId].zoneId },
    evidence: structuredClone(wake.evidence || []),
    ownedWorldProcesses: (state.processes || []).filter((row) => row.ownerActorId === characterId),
  };
}

const started = startDurativeWorldProcess([], {
  id: "process:tea:test",
  kind: "service_preparation",
  subjectId: "offering:tea",
  ownerActorId: OWNER,
  stationZoneId: "workbench",
  durationSeconds: 8,
  attentionMode: "passive_wait",
  sourceActionId: "action:start:tea",
  metadata: {
    publicLabel: "壶里的茶",
    readyNotice: "壶里的茶已经到了该收火的时候。",
  },
}, 0);
assert.equal(started.ok, true);

const readinessInputs = [];
const readinessActor = createCharacterSessionActor({
  characterId: OWNER,
  privateState: { ownerCharacterId: OWNER },
  runtimePort: createLocalCharacterRuntimePort({
    async runTurn(input) {
      readinessInputs.push(structuredClone(input));
      return { characterId: OWNER, agentTurnId: input.agentTurnId, privateStatePatch: {}, actionAttempt: null };
    },
    async applyWorldOutcome() { return { privateStatePatch: {} }; },
  }),
});
const readinessCoordinator = createWorldCommitCoordinator({
  worldId: "world:durative-activation",
  initialWorldState: worldState({ processes: started.processes }),
  actionRegistry: createWorldActionRegistry(),
});
const readinessRuntime = createCharacterWorldRuntime({
  coordinator: readinessCoordinator,
  actors: [readinessActor],
  situationProjector: projector,
});
const readinessTurn = await readinessRuntime.runNext();
assert.equal(readinessTurn.characterId, OWNER);
assert.equal(readinessCoordinator.worldState.nowSeconds, 8, "an idle world advances only to the next already-scheduled process boundary");
assert.equal(readinessCoordinator.worldState.processes[0].status, "ready");
assert.equal(readinessInputs[0].wake.kind, "world_evidence");
assert.equal(readinessInputs[0].wake.processIds[0], "process:tea:test");
assert.equal(readinessInputs[0].worldProjection.evidence[0].eventKind, "owned_process_ready");
assert.equal(readinessInputs[0].worldProjection.evidence[0].content, "壶里的茶已经到了该收火的时候。");
assert.equal(readinessTurn.actionAttempt, null, "process readiness gives thought authority back to the Character Agent and selects no action");

const continuationInputs = [];
const continuationActor = createCharacterSessionActor({
  characterId: OWNER,
  privateState: {
    ownerCharacterId: OWNER,
    ecologyState: {
      characterPsychologyV2State: {
        continuationIntentions: [{
          ownerAuthority: "character-agent",
          intentionId: "continuation:after-own-step",
          triggerType: "own_action_settled",
          intendedPrimitive: "interact",
          targetHandle: "",
          linkedSourceIds: [],
          minimumDelaySeconds: 0,
          triggerThreshold: 0.5,
          maxDeferrals: 2,
          deferrals: 0,
          privatePurpose: "这一步得到客观结果后，再由本人判断是否继续。",
          createdAtCharacterSeconds: 0,
          status: "active",
        }],
      },
    },
  },
  runtimePort: createLocalCharacterRuntimePort({
    async runTurn(input) {
      continuationInputs.push(structuredClone(input));
      return {
        characterId: OWNER,
        agentTurnId: input.agentTurnId,
        privateStatePatch: {},
        actionAttempt: continuationInputs.length === 1 ? {
          primitive: "rest",
          payload: { visibleAction: "他停手缓了一口气。" },
        } : null,
      };
    },
    async applyWorldOutcome() { return { privateStatePatch: {} }; },
  }),
});
const continuationCoordinator = createWorldCommitCoordinator({
  worldId: "world:own-action-continuation",
  initialWorldState: { ...worldState(), worldId: "world:own-action-continuation" },
  actionRegistry: createWorldActionRegistry(),
});
const continuationRuntime = createCharacterWorldRuntime({
  coordinator: continuationCoordinator,
  actors: [continuationActor],
  situationProjector: projector,
});
await continuationRuntime.enqueueWake(OWNER, {
  wakeId: "wake:initial-step",
  kind: "world_evidence",
  evidenceIds: [],
  evidence: [],
});
await continuationRuntime.runNext();
assert.deepEqual(continuationRuntime.readyQueue, [OWNER]);
await continuationRuntime.runNext();
assert.equal(continuationInputs[1].wake.kind, "continuation_due");
assert.equal(continuationInputs[1].wake.causeType, "own_action_settled");
assert.deepEqual(continuationInputs[1].wake.continuationIntentionIds, ["continuation:after-own-step"]);
assert.equal(continuationInputs[1].wake.settledOwnAction.primitive, "rest");

const continuousInputs = [];
const continuousStarted = startDurativeWorldProcess([], {
  id: "process:work:test",
  kind: "work_unit",
  subjectId: "work:test",
  ownerActorId: OWNER,
  stationZoneId: "workbench",
  durationSeconds: 8,
  attentionMode: "continuous_work",
  sourceActionId: "action:start:work",
  metadata: {
    publicLabel: "手上的活",
    readyNotice: "手上的活已经做到可以收尾。",
  },
}, 0);
assert.equal(continuousStarted.ok, true);
const continuousActor = createCharacterSessionActor({
  characterId: OWNER,
  privateState: {
    ownerCharacterId: OWNER,
    ecologyState: {
      characterPsychologyV2State: {
        continuationIntentions: [{
          ownerAuthority: "character-agent",
          intentionId: "continuation:after-work-motion",
          triggerType: "own_action_settled",
          intendedPrimitive: "gesture",
          targetHandle: "",
          linkedSourceIds: [],
          minimumDelaySeconds: 0,
          triggerThreshold: 0.5,
          maxDeferrals: 2,
          deferrals: 0,
          privatePurpose: "动作落定后再判断。",
          createdAtCharacterSeconds: 0,
          status: "active",
        }],
      },
    },
  },
  runtimePort: createLocalCharacterRuntimePort({
    async runTurn(input) {
      continuousInputs.push(structuredClone(input));
      return {
        characterId: OWNER,
        agentTurnId: input.agentTurnId,
        privateStatePatch: {},
        actionAttempt: continuousInputs.length === 1 ? {
          primitive: "gesture",
          payload: { visibleAction: "他顺手调整了一下握法。" },
        } : null,
      };
    },
    async applyWorldOutcome() { return { privateStatePatch: {} }; },
  }),
});
const continuousCoordinator = createWorldCommitCoordinator({
  worldId: "world:continuous-work-does-not-spin",
  initialWorldState: {
    ...worldState({ processes: continuousStarted.processes }),
    worldId: "world:continuous-work-does-not-spin",
  },
  actionRegistry: createWorldActionRegistry(),
});
const continuousRuntime = createCharacterWorldRuntime({
  coordinator: continuousCoordinator,
  actors: [continuousActor],
  situationProjector: projector,
});
await continuousRuntime.enqueueWake(OWNER, {
  wakeId: "wake:continuous-work-motion",
  kind: "world_evidence",
  evidenceIds: [],
  evidence: [],
});
await continuousRuntime.runNext();
assert.deepEqual(
  continuousRuntime.readyQueue,
  [],
  "an active continuous process must not spin on zero-delay own-action continuations",
);
await continuousRuntime.runNext();
assert.equal(continuousCoordinator.worldState.nowSeconds, 8);
assert.equal(continuousInputs[1].wake.processIds[0], "process:work:test");
assert.equal(continuousInputs[1].wake.kind, "world_evidence");

console.log("worldDurativeProcessActivationContracts:test passed", {
  processReadyAtSeconds: readinessCoordinator.worldState.nowSeconds,
  readinessSelectedAction: false,
  ownActionContinuationSelectedAction: false,
  continuousWorkWaitsForWorldBoundary: true,
});
