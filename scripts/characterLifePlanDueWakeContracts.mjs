import assert from "node:assert/strict";

import { createLocalCharacterRuntimePort } from "../src/server/simulation/characterRuntimePort.mjs";
import {
  createCharacterSessionActor,
  restoreCharacterSessionActor,
} from "../src/server/simulation/characterSessionActor.mjs";
import { createCharacterWorldRuntime } from "../src/server/simulation/characterWorldRuntime.mjs";
import { createWorldActionRegistry } from "../src/server/simulation/worldActionRegistry.mjs";
import { createWorldCommitCoordinator } from "../src/server/simulation/worldCommitCoordinator.mjs";
import { buildCharacterAgentStageInput } from "../src/server/simulation/characterAgentTurnProtocol.mjs";
import { createTavernCharacterAgentV2Session } from "../src/server/pipeline/tavernCharacterAgentV2.mjs";

const A = "char:life-plan:a";
const B = "char:life-plan:b";
const PLAN_STEP_ID = "plan-step:a:check-stalled-work";
const PRIVATE_PURPOSE = "若手边的工作一分钟仍无进展，就重新考虑继续、改期、换办法或放弃。";
const seen = [];

function actor(characterId, privateState, runTurn) {
  return createCharacterSessionActor({
    characterId,
    privateState: { ownerCharacterId: characterId, ...structuredClone(privateState) },
    runtimePort: createLocalCharacterRuntimePort({
      async runTurn(input) {
        return runTurn(input);
      },
      async applyWorldOutcome() {
        throw new Error("a plan-due thought opportunity must not manufacture a world outcome");
      },
    }),
  });
}

const actorA = actor(A, {
  ecologyState: {
    characterPsychologyV2State: {
      continuationIntentions: [{
        ownerAuthority: "character-agent",
        intentionId: PLAN_STEP_ID,
        triggerType: "elapsed_without_progress",
        intendedPrimitive: "observe",
        targetHandle: "owned_work:unfinished",
        linkedSourceIds: ["desire:a:finish-work", "memory:a:work-stalled"],
        minimumDelaySeconds: 60,
        triggerThreshold: 0.5,
        maxDeferrals: 2,
        deferrals: 0,
        privatePurpose: PRIVATE_PURPOSE,
        createdAtCharacterSeconds: 0,
        status: "active",
      }],
    },
  },
}, async (input) => {
  seen.push(structuredClone(input));
  return {
    characterId: A,
    agentTurnId: input.agentTurnId,
    privateStatePatch: { lastPlanWakeId: input.wake.wakeId },
    privateResult: {},
    actionAttempt: null,
  };
});
const actorB = actor(B, {
  privateSecret: "B 的私有计划绝不能投影给 A",
}, async () => {
  throw new Error("B has no due plan and must not run");
});

const coordinator = createWorldCommitCoordinator({
  worldId: "world:life-plan-due",
  initialWorldState: {
    worldId: "world:life-plan-due",
    nowSeconds: 0,
    entities: {
      [A]: { id: A, kind: "character", present: true, placeId: "place:room", zoneId: "hall" },
      [B]: { id: B, kind: "character", present: true, placeId: "place:room", zoneId: "hall" },
    },
    objects: {},
    signals: [],
    processes: [],
    places: {
      "place:room": {
        topology: { zones: { hall: { id: "hall" } }, edges: [] },
        socialBoundaries: [],
        accessGrants: [],
      },
    },
  },
  actionRegistry: createWorldActionRegistry(),
});

const runtime = createCharacterWorldRuntime({
  coordinator,
  actors: [actorA, actorB],
  situationProjector({ worldState, worldVersion, characterId }) {
    return {
      authority: "recipient-specific-world-projection",
      recipientCharacterId: characterId,
      worldVersion,
      nowSeconds: worldState.nowSeconds,
      evidence: [],
      place: {
        placeId: worldState.entities[characterId].placeId,
        zoneId: worldState.entities[characterId].zoneId,
      },
    };
  },
});

const turn = await runtime.runNext();
assert.ok(turn, "an idle world must advance to the nearest Character-owned plan deadline");
assert.equal(turn.characterId, A);
assert.equal(turn.outcome, null, "a plan deadline grants thought, not an automatic action or outcome");
assert.equal(seen.length, 1);
assert.equal(seen[0].wake.kind, "continuation_due", "the durable mailbox shape remains backward-compatible");
assert.equal(seen[0].wake.causeType, "plan_due");
assert.deepEqual(seen[0].wake.planStepIds, [PLAN_STEP_ID]);
assert.deepEqual(seen[0].wake.continuationIntentionIds, [PLAN_STEP_ID]);
assert.equal(seen[0].worldProjection.nowSeconds, 60);
assert.equal(seen[0].privateContext.ecologyState.characterPsychologyV2State.continuationIntentions[0].privatePurpose, PRIVATE_PURPOSE);
assert.equal(JSON.stringify(seen[0]).includes("B 的私有计划"), false, "another Character's private plans must not leak");
for (const forbidden of ["selectedAction", "selectedCandidate", "utterance", "actionAttempt"]) {
  assert.equal(Object.hasOwn(seen[0].wake, forbidden), false, `plan wake must not contain ${forbidden}`);
}

assert.equal(coordinator.worldState.nowSeconds, 60);
const clockEvent = coordinator.journal.events.at(-1);
assert.equal(clockEvent.type, "world_clock_advanced");
assert.equal(clockEvent.occurredAtSeconds, 60);
assert.equal(JSON.stringify(clockEvent).includes(PLAN_STEP_ID), false, "public world time must not reveal a private plan id");
assert.equal(JSON.stringify(clockEvent).includes(PRIVATE_PURPOSE), false, "public world time must not reveal private plan content");

const checkpoint = await runtime.checkpoint();
assert.equal(checkpoint.actors.find((row) => row.characterId === A).privateState.lastPlanWakeId, seen[0].wake.wakeId);
assert.equal(checkpoint.readyQueue.includes(B), false);

const planProjection = {
  schemaVersion: "character-life-continuity-v1",
  authority: "character-private-life-continuity-projection",
  ownerCharacterId: A,
  nowSeconds: 60,
  activePlanSteps: [],
  duePlanSteps: [{
    planStepId: PLAN_STEP_ID,
    dueAtSeconds: 60,
    privatePurpose: PRIVATE_PURPOSE,
    decisionAuthority: "character-agent",
  }],
  selection: null,
};
const session = createTavernCharacterAgentV2Session({
  agentTurnId: "agent-turn:life-plan:projection",
  submissionMode: "staged",
  scene: { id: "scene:life-plan", elapsedSeconds: 60, zoneId: "hall", zoneLabel: "堂前" },
  agent: {
    id: A,
    role: "当事人",
    standing: "resident",
    currentIntention: "继续自己的生活",
    privateState: { ecologyProfile: {}, ecologyState: { body: {}, desires: {} } },
    psychologyAnchor: {},
    relationshipContext: [],
    voiceContract: {},
    memoryContext: {},
  },
  activePlanProjection: planProjection,
  activationCause: { type: "plan_due", planStepIds: [PLAN_STEP_ID] },
});
const firstStageInput = buildCharacterAgentStageInput(session);
assert.deepEqual(
  firstStageInput.privateContext.livedSituation.activePlanProjection,
  planProjection,
  "the Character Agent must receive its own due plan in private lived context",
);
assert.deepEqual(
  firstStageInput.situationalGrounding.activePlanProjection,
  planProjection,
  "the cognitive stages must ground themselves in the Character's own active plan",
);
assert.equal(
  Object.hasOwn(firstStageInput.worldProjection, "activePlanProjection"),
  false,
  "a private plan must not be misclassified as objective world state",
);

// --- Rescheduling one already-queued step invalidates the old wake. ---
const C = "char:life-plan:reschedule";
const RESCHEDULED_STEP_ID = "plan-step:reschedule:same-step";
const RESCHEDULED_PRIVATE_PURPOSE = "这条私有计划的内容不能进入 wake 或世界时间日志。";

function rescheduledIntention({ revision, createdAtCharacterSeconds, minimumDelaySeconds }) {
  return {
    ownerAuthority: "character-agent",
    intentionId: RESCHEDULED_STEP_ID,
    revision,
    triggerType: "elapsed_without_progress",
    intendedPrimitive: "observe",
    targetHandle: "owned_work:rescheduled",
    linkedSourceIds: ["memory:rescheduled:private"],
    minimumDelaySeconds,
    triggerThreshold: 0.5,
    maxDeferrals: 3,
    deferrals: revision - 1,
    privatePurpose: RESCHEDULED_PRIVATE_PURPOSE,
    createdAtCharacterSeconds,
    status: "active",
  };
}

function rescheduleWorldState() {
  return {
    worldId: "world:life-plan-reschedule",
    worldVersion: 0,
    nowSeconds: 10,
    entities: {
      [C]: { id: C, kind: "character", present: true, placeId: "place:room", zoneId: "hall" },
    },
    objects: {},
    signals: [],
    processes: [],
    places: {
      "place:room": {
        topology: { zones: { hall: { id: "hall" } }, edges: [] },
        socialBoundaries: [],
        accessGrants: [],
      },
    },
  };
}

function rescheduleProjection({ worldState, worldVersion, characterId }) {
  return {
    authority: "recipient-specific-world-projection",
    recipientCharacterId: characterId,
    worldVersion,
    nowSeconds: worldState.nowSeconds,
    evidence: [],
    place: {
      placeId: worldState.entities[characterId].placeId,
      zoneId: worldState.entities[characterId].zoneId,
    },
  };
}

const rescheduleSeen = [];
async function runRescheduledTurn(input) {
  rescheduleSeen.push(structuredClone(input));
  return {
    characterId: C,
    agentTurnId: input.agentTurnId,
    privateStatePatch: rescheduleSeen.length === 1 ? {
      ecologyState: {
        characterPsychologyV2State: {
          continuationIntentions: [rescheduledIntention({
            revision: 1,
            createdAtCharacterSeconds: 10,
            minimumDelaySeconds: 20,
          })],
        },
      },
    } : {},
    privateResult: {},
    actionAttempt: null,
  };
}

const rescheduleActor = actor(C, {
  ecologyState: {
    characterPsychologyV2State: {
      continuationIntentions: [rescheduledIntention({
        revision: 1,
        createdAtCharacterSeconds: 0,
        minimumDelaySeconds: 10,
      })],
    },
  },
}, runRescheduledTurn);
const rescheduleCoordinator = createWorldCommitCoordinator({
  worldId: "world:life-plan-reschedule",
  initialWorldState: rescheduleWorldState(),
  actionRegistry: createWorldActionRegistry(),
});
const rescheduleRuntime = createCharacterWorldRuntime({
  coordinator: rescheduleCoordinator,
  actors: [rescheduleActor],
  situationProjector: rescheduleProjection,
});
await rescheduleRuntime.enqueueWake(C, {
  wakeId: "wake:reschedule:reconsider-now",
  kind: "explicit_reconsideration",
  evidenceIds: [],
  evidence: [],
});

const reconsiderationTurn = await rescheduleRuntime.runNext();
assert.equal(reconsiderationTurn.wake.kind, "explicit_reconsideration");
assert.equal(rescheduleCoordinator.worldState.nowSeconds, 10);
const discardedOldSchedule = rescheduleActor.privateJournal.find((row) => (
  row.kind === "wake_discarded" && row.reason === "superseded_plan_schedule"
));
assert.ok(discardedOldSchedule, "changing the same step's deadline or revision must invalidate its queued old wake");

const rescheduledCheckpoint = await rescheduleRuntime.checkpoint();
const savedRescheduleActor = rescheduledCheckpoint.actors.find((row) => row.characterId === C);
assert.equal(
  savedRescheduleActor.mailbox.some((wake) => wake.causeType === "plan_due"),
  false,
  "a stale plan wake must not survive into a checkpoint after the Character reschedules it",
);

const restoredRescheduleActor = restoreCharacterSessionActor(savedRescheduleActor, {
  runtimePort: createLocalCharacterRuntimePort({
    runTurn: runRescheduledTurn,
    async applyWorldOutcome() {
      throw new Error("a rescheduled plan wake must not manufacture a world outcome");
    },
  }),
});
const restoredRescheduleCoordinator = createWorldCommitCoordinator({
  worldId: "world:life-plan-reschedule",
  initialWorldState: rescheduleWorldState(),
  actionRegistry: createWorldActionRegistry(),
  checkpoint: rescheduledCheckpoint.coordinator,
});
const restoredRescheduleRuntime = createCharacterWorldRuntime({
  coordinator: restoredRescheduleCoordinator,
  actors: [restoredRescheduleActor],
  receiptLedger: rescheduledCheckpoint.receiptLedger,
  readyQueue: rescheduledCheckpoint.readyQueue,
  situationProjector: rescheduleProjection,
});

const rescheduledTurn = await restoredRescheduleRuntime.runNext();
assert.equal(restoredRescheduleCoordinator.worldState.nowSeconds, 30);
assert.equal(rescheduledTurn.wake.causeType, "plan_due");
assert.notEqual(
  rescheduledTurn.wake.wakeId,
  discardedOldSchedule.wakeId,
  "the revised schedule needs a new deduplication identity",
);
assert.deepEqual(rescheduledTurn.wake.planStepRefs.map((row) => ({
  planStepId: row.planStepId,
  revision: row.revision,
  dueAtSeconds: row.dueAtSeconds,
})), [{
  planStepId: RESCHEDULED_STEP_ID,
  revision: "1",
  dueAtSeconds: 30,
}]);
const rescheduledWakeText = JSON.stringify(rescheduledTurn.wake);
assert.equal(rescheduledWakeText.includes(RESCHEDULED_PRIVATE_PURPOSE), false);
for (const forbidden of ["selectedAction", "selectedCandidate", "utterance", "actionAttempt", "intendedPrimitive"]) {
  assert.equal(rescheduledWakeText.includes(forbidden), false, `a plan reference wake must not contain ${forbidden}`);
}
const rescheduledJournalText = JSON.stringify(restoredRescheduleCoordinator.journal.events);
assert.equal(rescheduledJournalText.includes(RESCHEDULED_STEP_ID), false);
assert.equal(rescheduledJournalText.includes(RESCHEDULED_PRIVATE_PURPOSE), false);

// The schedule revision is independently part of the identity even when the
// absolute deadline stays unchanged.
const D = "char:life-plan:revision";
const REVISION_STEP_ID = "plan-step:revision:same-deadline";
const REVISION_PRIVATE_PURPOSE = "同一时刻的计划修订也不能复用旧 wake。";
function revisionIntention(revision) {
  return {
    ownerAuthority: "character-agent",
    intentionId: REVISION_STEP_ID,
    revision,
    triggerType: "elapsed_without_progress",
    intendedPrimitive: "rest",
    targetHandle: "",
    linkedSourceIds: ["memory:revision:private"],
    minimumDelaySeconds: 10,
    triggerThreshold: 0.5,
    maxDeferrals: 3,
    deferrals: 0,
    privatePurpose: REVISION_PRIVATE_PURPOSE,
    createdAtCharacterSeconds: 0,
    status: "active",
  };
}
const revisionSeen = [];
const revisionActor = actor(D, {
  ecologyState: {
    characterPsychologyV2State: {
      continuationIntentions: [revisionIntention(1)],
    },
  },
}, async (input) => {
  revisionSeen.push(structuredClone(input));
  return {
    characterId: D,
    agentTurnId: input.agentTurnId,
    privateStatePatch: revisionSeen.length === 1 ? {
      ecologyState: {
        characterPsychologyV2State: {
          continuationIntentions: [revisionIntention(2)],
        },
      },
    } : {},
    privateResult: {},
    actionAttempt: null,
  };
});
const revisionWorld = {
  ...rescheduleWorldState(),
  worldId: "world:life-plan-revision",
  entities: {
    [D]: { id: D, kind: "character", present: true, placeId: "place:room", zoneId: "hall" },
  },
};
const revisionCoordinator = createWorldCommitCoordinator({
  worldId: revisionWorld.worldId,
  initialWorldState: revisionWorld,
  actionRegistry: createWorldActionRegistry(),
});
const revisionRuntime = createCharacterWorldRuntime({
  coordinator: revisionCoordinator,
  actors: [revisionActor],
  situationProjector: rescheduleProjection,
});
await revisionRuntime.enqueueWake(D, {
  wakeId: "wake:revision:reconsider-now",
  kind: "explicit_reconsideration",
  evidenceIds: [],
  evidence: [],
});
await revisionRuntime.runNext();
const discardedOldRevision = revisionActor.privateJournal.find((row) => (
  row.kind === "wake_discarded" && row.reason === "superseded_plan_schedule"
));
assert.ok(discardedOldRevision, "changing only the revision must invalidate the queued old wake");
const revisedPendingWake = revisionActor.mailbox.find((wake) => wake.causeType === "plan_due");
assert.ok(revisedPendingWake, "a still-due revised step must receive a fresh wake opportunity");
assert.notEqual(revisedPendingWake.wakeId, discardedOldRevision.wakeId);
const revisionTurn = await revisionRuntime.runNext();
assert.equal(revisionCoordinator.worldState.nowSeconds, 10, "revision alone must not fabricate elapsed world time");
assert.deepEqual(revisionTurn.wake.planStepRefs.map((row) => ({
  planStepId: row.planStepId,
  revision: row.revision,
  dueAtSeconds: row.dueAtSeconds,
})), [{
  planStepId: REVISION_STEP_ID,
  revision: "2",
  dueAtSeconds: 10,
}]);
assert.equal(JSON.stringify(revisionTurn.wake).includes(REVISION_PRIVATE_PURPOSE), false);
assert.equal(revisionCoordinator.journal.events.length, 0, "a private plan revision must not enter the world journal");

console.log("character life plan due wake contracts passed");
