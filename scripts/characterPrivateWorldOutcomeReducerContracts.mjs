import assert from "node:assert/strict";

import { createCharacterAgentMemoryState } from "../src/engine/characterAgentMemory.js";
import { createLocalCharacterRuntimePort } from "../src/server/simulation/characterRuntimePort.mjs";
import { createCharacterSessionActor } from "../src/server/simulation/characterSessionActor.mjs";
import { reduceCharacterPrivateWorldOutcome } from "../src/server/simulation/characterPrivateStateReducer.mjs";
import { resolveOwnedConversationAnchor } from "../src/server/simulation/characterConversationContinuity.mjs";

const OWNER = "char:outcome-owner";
const TARGET = "char:outcome-target";
const TURN = `agent-turn:${OWNER}:1`;
const ATTEMPT = `action-attempt:${TURN}`;
const OUTCOME = `world-outcome:${ATTEMPT}`;
const HABIT = "habit:answer-after-looking";

function assertClose(actual, expected, message) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) < 1e-9, `${message}: expected ${expected}, received ${actual}`);
}

function privateStateWithPending({ attemptId = ATTEMPT, postTurnDisposition = "keep_resumable" } = {}) {
  return {
    ownerCharacterId: OWNER,
    memoryContext: createCharacterAgentMemoryState(OWNER),
    relationshipContext: [{
      id: `relationship:${OWNER}:${TARGET}`,
      fromCharacterId: OWNER,
      toCharacterId: TARGET,
      trust: 37,
    }],
    ecologyState: {
      desires: {
        "desire:test": { desireId: "desire:test", strength: 0.8, satisfaction: 0.1, frustration: 0.2 },
      },
      voiceHabitUsage: [],
      characterPsychologyV2State: {
        lastAgentTurnId: TURN,
        cognitiveLoad: 0.31,
        controlDepletion: 0.22,
        pendingActionForecast: {
          authority: "character-agent-owned-prediction-record",
          sourceAgentTurnId: TURN,
          sourceCandidateId: "candidate:speak",
          requiresCharacterAppraisal: true,
        },
        continuationIntentions: [{ intentionId: "continuation:wait", status: "active" }],
      },
    },
    recentOwnActions: [],
    settledInteractionEvents: [],
    pendingAttemptContinuityById: {
      [attemptId]: {
        ownerAuthority: "character-agent",
        actionAttemptId: attemptId,
        sourceAgentTurnId: TURN,
        selectedCandidateId: "candidate:speak",
        actionAttempt: { primitive: "speak", targetCharacterId: TARGET },
        utterance: {
          literalSpeech: "先看清楚再答。",
          speechAct: "inform",
          speechFunctions: ["inform"],
        },
        communicationPlan: { threadDisposition: postTurnDisposition },
        participantHandleByCharacterId: { [TARGET]: "known-person:outcome-target" },
        embodiedIntent: { intendedGesture: "抬眼看向对方" },
        realizedSpeechHabitIds: [HABIT],
      },
    },
    appliedPrivateOutcomeIds: [],
    appliedPrivateOutcomeRecords: [],
    conversationThreadStates: {
      [`thread:${OWNER}:${TARGET}`]: {
        id: `thread:${OWNER}:${TARGET}`,
        status: "open",
        selfClosure: "open",
        responseNeed: "high",
      },
    },
    reflectionState: {
      schemaVersion: "character-reflection-v1",
      authority: "character-private-reflection-ledger",
      ownerCharacterId: OWNER,
      threshold: 1,
      accumulatedImportance: 0.5,
      accountedImportanceByMemoryId: {},
      accumulationSourceMemoryIds: [],
      pendingOpportunity: null,
      completedOpportunityIds: [],
      completedOpportunities: [],
      nextOpportunitySequence: 1,
    },
  };
}

function committedSpeechOutcome({ outcomeId = OUTCOME, attemptId = ATTEMPT } = {}) {
  return {
    authority: "world-resolution",
    outcomeId,
    eventId: `world-event:${attemptId}`,
    actionAttemptId: attemptId,
    agentTurnId: TURN,
    actorId: OWNER,
    primitive: "speak",
    status: "partial",
    worldVersion: 8,
    attemptSurface: [{
      kind: "utterance_emitted",
      actorId: OWNER,
      utterance: "先看清楚再答。",
      targetCharacterId: TARGET,
      visibleAction: "抬眼看向对方",
      provenance: {
        sourceActionId: attemptId,
        sourceThreadId: "world-thread:outcome-conversation",
        responseToTurnId: "action:outcome:prior",
      },
    }],
    resolvedEffects: [{ kind: "speech_emitted", signalId: `signal:${attemptId}:speech` }],
    failedEffects: [{ code: "SPEECH_TARGET_NOT_REACHED", targetCharacterId: TARGET }],
    durationSeconds: 2,
  };
}

const previous = privateStateWithPending();
const before = structuredClone(previous);
const reduced = reduceCharacterPrivateWorldOutcome({
  ownerCharacterId: OWNER,
  previousPrivateState: previous,
  worldOutcome: committedSpeechOutcome(),
  nowSeconds: 42,
});

assert.deepEqual(previous, before, "world-outcome reduction must not mutate the Actor's current private state");
assert.equal(reduced.authority, "character-private-state-reducer");
assert.equal(reduced.idempotent, false);
assert.equal(reduced.privateStatePatch.settledInteractionEvents.length, 1);
const settled = reduced.privateStatePatch.settledInteractionEvents[0];
assert.equal(settled.authority, "objective-settlement-provenance");
assert.equal(settled.actorId, OWNER);
assert.equal(settled.actionId, ATTEMPT);
assert.equal(settled.speech, "先看清楚再答。", "only the utterance that the world actually emitted may become own-action continuity");
assert.deepEqual(settled.counterpartyIds, [TARGET]);
assert.equal(reduced.privateStatePatch.recentOwnActions[0].speech, "先看清楚再答。");
assert.ok(
  reduced.privateStatePatch.memoryContext.episodes.some((row) => (
    row.source?.kind === "self_action"
    && row.source?.sourceActionId === ATTEMPT
    && row.perception?.content === "先看清楚再答。"
  )),
  "a real settled own act should enter first-person memory exactly once",
);
assert.equal(
  reduced.privateStatePatch.reflectionState.pendingOpportunity.status,
  "due",
  "a settled embodied action must also advance the owner's private reflection ledger",
);
assert.deepEqual(reduced.privateStatePatch.ecologyState.voiceHabitUsage, [{
  actionId: ATTEMPT,
  characterId: OWNER,
  committed: true,
  turnIndex: 8,
  realizedHabitIds: [HABIT],
}], "speech-habit use may be recorded only after the matching utterance is emitted by the world");
assert.equal(
  Object.hasOwn(reduced.privateStatePatch.ecologyState.voiceHabitUsage[0], "literalSpeech"),
  false,
  "speech-habit fatigue must not retain literal dialogue",
);
const pendingOutcome = reduced.privateStatePatch.ecologyState.characterPsychologyV2State.pendingObjectiveOutcome;
assert.equal(pendingOutcome.authority, "world-resolution");
assert.equal(pendingOutcome.committed, true);
assert.equal(pendingOutcome.inferredSatisfaction, null);
assert.equal(pendingOutcome.inferredFrustration, null);
assert.equal(pendingOutcome.inferredRelationshipChange, null);
assert.equal(pendingOutcome.inferredIdentityRevision, null);
assert.deepEqual(
  reduced.privateStatePatch.ecologyState.desires,
  previous.ecologyState.desires,
  "objective success or failure must not update desire satisfaction or frustration",
);
assert.deepEqual(reduced.privateStatePatch.relationshipContext, undefined, "world settlement must not write relationship appraisal");
assert.equal(Object.hasOwn(reduced.privateStatePatch.pendingAttemptContinuityById, ATTEMPT), false, "the settled pending attempt must be removed");
assert.ok(reduced.privateStatePatch.appliedPrivateOutcomeIds.includes(OUTCOME));
assert.equal(
  reduced.privateStatePatch.conversationThreadStates[`thread:${OWNER}:${TARGET}`].status,
  "open",
  "keep-resumable leaves the sender's side open even when delivery fails",
);
const partialConversation = reduced.privateStatePatch.conversationState;
assert.ok(partialConversation, "an emitted speech component must advance continuity even when the compound outcome is partial");
assert.equal(partialConversation.threads[0].lastExperiencedTurnId, ATTEMPT);
assert.deepEqual(
  resolveOwnedConversationAnchor({
    ownerCharacterId: OWNER,
    conversationState: partialConversation,
    anchorHandle: partialConversation.threads[0].anchorHandle,
    mode: "continue",
    targetParticipantHandle: TARGET,
  }).lineageBinding,
  {
    authority: "server-owned-conversation-lineage-binding",
    sourceThreadId: "world-thread:outcome-conversation",
    responseToTurnId: ATTEMPT,
  },
  "the next continue must bind to this actually emitted partial turn",
);

const reachedState = privateStateWithPending({
  attemptId: "action-attempt:reached-answer",
  postTurnDisposition: "close_for_self",
});
const reachedOutcome = committedSpeechOutcome({
  outcomeId: "world-outcome:reached-answer",
  attemptId: "action-attempt:reached-answer",
});
reachedOutcome.status = "success";
reachedOutcome.failedEffects = [];
reachedOutcome.resolvedEffects.push({ kind: "speech_delivered", targetCharacterId: TARGET });
reachedOutcome.deliveries = [{
  deliveryId: "delivery:reached-answer",
  eventKind: "speech",
  sourceCharacterId: OWNER,
  recipientCharacterId: TARGET,
  provenance: {
    sourceActionId: "action-attempt:reached-answer",
    sourceThreadId: "world-thread:outcome-conversation",
    responseToTurnId: "action:outcome:prior",
  },
}];
const reachedReduction = reduceCharacterPrivateWorldOutcome({
  ownerCharacterId: OWNER,
  previousPrivateState: reachedState,
  worldOutcome: reachedOutcome,
  nowSeconds: 43,
});
assert.equal(
  reachedReduction.privateStatePatch.conversationThreadStates["world-thread:outcome-conversation"].selfClosure,
  "closed_for_self",
  "a successfully delivered settle/refuse response closes only this Character's side of the thread",
);
assert.equal(
  reachedReduction.privateStatePatch.conversationThreadStates["world-thread:outcome-conversation"].responseNeed,
  "none",
);
assert.equal(reachedReduction.privateStatePatch.conversationState.threads[0].status, "closed");
assert.equal(reachedReduction.privateStatePatch.conversationState.threads[0].resumable, false);

const undeliveredCloseAttempt = "action-attempt:undelivered-close";
const undeliveredCloseReduction = reduceCharacterPrivateWorldOutcome({
  ownerCharacterId: OWNER,
  previousPrivateState: privateStateWithPending({
    attemptId: undeliveredCloseAttempt,
    postTurnDisposition: "close_for_self",
  }),
  worldOutcome: committedSpeechOutcome({
    outcomeId: "world-outcome:undelivered-close",
    attemptId: undeliveredCloseAttempt,
  }),
  nowSeconds: 43.5,
});
assert.equal(undeliveredCloseReduction.privateStatePatch.conversationState.threads[0].status, "closed");
assert.equal(undeliveredCloseReduction.privateStatePatch.conversationState.threads[0].resumable, false);
assert.deepEqual(
  undeliveredCloseReduction.privateStatePatch.conversationState.threads[0].recentTurns[0].actualRecipientHandles,
  [],
  "an emitted-but-undelivered line may close only the sender's side without inventing a recipient",
);

const after = { ...structuredClone(previous), ...structuredClone(reduced.privateStatePatch) };
const duplicate = reduceCharacterPrivateWorldOutcome({
  ownerCharacterId: OWNER,
  previousPrivateState: after,
  worldOutcome: committedSpeechOutcome(),
  nowSeconds: 44,
});
assert.equal(duplicate.idempotent, true);
assert.deepEqual(duplicate.privateStatePatch, {}, "the same outcome id and attempt id must be a no-op");

const workAttemptId = "action-attempt:work-body-load";
const workState = privateStateWithPending({ attemptId: workAttemptId });
workState.ecologyState.body = {
  energy: 0.7,
  stamina: 0.62,
  hunger: 0.2,
  thirst: 0.25,
  pain: 0.05,
  exertion: 0.3,
  fatigue: 0.28,
};
workState.pendingAttemptContinuityById[workAttemptId].actionAttempt = { primitive: "use_affordance" };
workState.pendingAttemptContinuityById[workAttemptId].utterance.literalSpeech = "";
workState.pendingAttemptContinuityById[workAttemptId].realizedSpeechHabitIds = [];
const workOutcome = {
  authority: "world-resolution",
  outcomeId: "world-outcome:work-body-load",
  eventId: "world-event:work-body-load",
  actionAttemptId: workAttemptId,
  agentTurnId: TURN,
  actorId: OWNER,
  primitive: "use_affordance",
  status: "success",
  worldVersion: 10,
  attemptSurface: [{
    kind: "work_unit_completed",
    actorId: OWNER,
    processId: "process:work-body-load",
    visibleAction: "他把做完的一份活收好。",
  }],
  resolvedEffects: [{
    kind: "body_load_applied",
    targetActorId: OWNER,
    exertionDelta: 0.08,
    fatigueDelta: 0.045,
    staminaDelta: -0.035,
    energyDelta: -0.025,
  }],
  failedEffects: [],
  durationSeconds: 3,
};
const bodyReduced = reduceCharacterPrivateWorldOutcome({
  ownerCharacterId: OWNER,
  previousPrivateState: workState,
  worldOutcome: workOutcome,
  nowSeconds: 90,
});
assertClose(
  bodyReduced.privateStatePatch.ecologyState.body.hunger,
  0.20096,
  "a successfully settled use_affordance action adds its action-specific hunger load",
);
assertClose(
  bodyReduced.privateStatePatch.ecologyState.body.thirst,
  0.2512,
  "a successfully settled use_affordance action adds its action-specific thirst load",
);
assertClose(
  bodyReduced.privateStatePatch.ecologyState.body.exertion,
  0.36336,
  "the objective exertion delta is applied after action physiology and remains independently observable",
);
assertClose(bodyReduced.privateStatePatch.ecologyState.body.fatigue, 0.32836, "action and objective fatigue loads compose");
assertClose(bodyReduced.privateStatePatch.ecologyState.body.stamina, 0.58092, "action and objective stamina loads compose");
assertClose(
  bodyReduced.privateStatePatch.ecologyState.body.energy,
  0.59092,
  "the objective energy delta is applied after action physiology and remains independently observable",
);
assert.equal(bodyReduced.diagnostics.objectiveBodyLoadsApplied, 1);
assert.equal(bodyReduced.diagnostics.actionPhysiologyApplied, true);
assert.equal(bodyReduced.diagnostics.physiologyCompositionOrder, "action_specific_then_objective_effects");
assert.equal(
  Object.hasOwn(bodyReduced.privateStatePatch.ecologyState, "elapsedSeconds"),
  false,
  "settled-action physiology must not repeat the runtime-owned basal wall-clock advance",
);

const restAttemptId = "action-attempt:rest-recovery";
const restState = privateStateWithPending({ attemptId: restAttemptId });
restState.ecologyState.body = structuredClone(workState.ecologyState.body);
restState.pendingAttemptContinuityById[restAttemptId].actionAttempt = { primitive: "rest" };
restState.pendingAttemptContinuityById[restAttemptId].utterance.literalSpeech = "";
restState.pendingAttemptContinuityById[restAttemptId].realizedSpeechHabitIds = [];
const restedReduction = reduceCharacterPrivateWorldOutcome({
  ownerCharacterId: OWNER,
  previousPrivateState: restState,
  worldOutcome: {
    authority: "world-resolution",
    outcomeId: "world-outcome:rest-recovery",
    eventId: "world-event:rest-recovery",
    actionAttemptId: restAttemptId,
    agentTurnId: TURN,
    actorId: OWNER,
    primitive: "rest",
    status: "success",
    worldVersion: 11,
    attemptSurface: [{ kind: "actor_rested", actorId: OWNER, visibleAction: "他靠着椅背歇了一阵。" }],
    resolvedEffects: [],
    failedEffects: [],
    durationSeconds: 1_800,
  },
  nowSeconds: 1_890,
});
assert.ok(
  restedReduction.privateStatePatch.ecologyState.body.fatigue < restState.ecologyState.body.fatigue,
  "successfully settled rest must recover fatigue",
);
assert.ok(
  restedReduction.privateStatePatch.ecologyState.body.stamina > restState.ecologyState.body.stamina,
  "successfully settled rest must recover stamina",
);

const noSurfaceState = privateStateWithPending({ attemptId: "action-attempt:no-surface" });
noSurfaceState.pendingAttemptContinuityById["action-attempt:no-surface"].realizedSpeechHabitIds = [HABIT];
noSurfaceState.ecologyState.body = structuredClone(workState.ecologyState.body);
const failedBodyBefore = structuredClone(noSurfaceState.ecologyState.body);
const noSurface = reduceCharacterPrivateWorldOutcome({
  ownerCharacterId: OWNER,
  previousPrivateState: noSurfaceState,
  worldOutcome: {
    authority: "world-resolution",
    outcomeId: "world-outcome:no-surface",
    actionAttemptId: "action-attempt:no-surface",
    agentTurnId: TURN,
    actorId: OWNER,
    primitive: "speak",
    status: "failed",
    worldVersion: 9,
    attemptSurface: [],
    resolvedEffects: [],
    failedEffects: [{ code: "ACTION_ACTOR_NOT_PRESENT" }],
    deliveries: [{
      deliveryId: "delivery:own-result:no-surface",
      eventKind: "own_action_result",
      modality: "proprioception",
      recipientCharacterId: OWNER,
      content: "刚才的动作没有完成。",
      semanticFrame: {
        actionResult: {
          status: "failed",
          primitive: "speak",
          failureCodes: ["ACTION_ACTOR_NOT_PRESENT"],
          resolvedEffectKinds: [],
        },
      },
    }],
  },
  nowSeconds: 45,
});
assert.deepEqual(noSurface.privateStatePatch.settledInteractionEvents, []);
assert.deepEqual(noSurface.privateStatePatch.recentOwnActions, []);
assert.deepEqual(noSurface.privateStatePatch.memoryContext.episodes, []);
assert.deepEqual(noSurface.privateStatePatch.ecologyState.voiceHabitUsage, [], "a selected habit is not usage when no speech actually occurred");
assert.deepEqual(
  noSurface.privateStatePatch.ecologyState.body,
  failedBodyBefore,
  "a failed action without objective body effects must not receive action-specific physiology",
);
assert.equal(noSurface.diagnostics.actionPhysiologyApplied, false);
assert.equal(noSurface.privateStatePatch.ecologyState.characterPsychologyV2State.pendingObjectiveOutcome.committed, false);
assert.equal(noSurface.privateStatePatch.retainedImmediateSelfEvidence.length, 1);
assert.equal(noSurface.privateStatePatch.retainedImmediateSelfEvidence[0].eventKind, "own_action_result");
assert.equal(
  noSurface.privateStatePatch.retainedImmediateSelfEvidence[0].semanticFrame.actionResult.failureCodes[0],
  "ACTION_ACTOR_NOT_PRESENT",
);

for (const [mutate, code] of [
  [(row) => { row.authority = "character-agent"; }, "CHARACTER_PRIVATE_OUTCOME_AUTHORITY_INVALID"],
  [(row) => { row.actorId = TARGET; }, "CHARACTER_PRIVATE_OUTCOME_OWNER_MISMATCH"],
  [(row) => { row.actionAttemptId = "action-attempt:unknown"; }, "CHARACTER_PRIVATE_OUTCOME_ATTEMPT_UNKNOWN"],
]) {
  const outcome = committedSpeechOutcome();
  mutate(outcome);
  assert.throws(() => reduceCharacterPrivateWorldOutcome({
    ownerCharacterId: OWNER,
    previousPrivateState: privateStateWithPending(),
    worldOutcome: outcome,
    nowSeconds: 42,
  }), (error) => error?.code === code);
}

let adapterSawPrivateState = null;
let adapterCalls = 0;
const actor = createCharacterSessionActor({
  characterId: OWNER,
  privateState: privateStateWithPending(),
  runtimePort: createLocalCharacterRuntimePort({
    async runTurn() { return {}; },
    async applyWorldOutcome(outcome, adapterContext) {
      adapterCalls += 1;
      adapterSawPrivateState = structuredClone(adapterContext.privateContext);
      adapterContext.privateContext.ecologyState.desires["desire:test"].satisfaction = 1;
      return reduceCharacterPrivateWorldOutcome({
        ownerCharacterId: adapterContext.characterId,
        previousPrivateState: adapterSawPrivateState,
        worldOutcome: outcome,
        nowSeconds: 42,
      });
    },
  }),
});
actor.pendingAttemptIds.add(ATTEMPT);
await actor.applyWorldOutcome(committedSpeechOutcome());
assert.equal(adapterSawPrivateState.pendingAttemptContinuityById[ATTEMPT].sourceAgentTurnId, TURN, "the outcome adapter must receive the Actor's latest private state");
assert.equal(actor.privateState.ecologyState.desires["desire:test"].satisfaction, 0.1, "the adapter receives a read-only clone, not the Actor's mutable state");
assert.equal(Object.hasOwn(actor.privateState.pendingAttemptContinuityById, ATTEMPT), false, "Actor patch application must really remove the pending attempt");
await actor.applyWorldOutcome(committedSpeechOutcome());
assert.equal(adapterCalls, 2, "a duplicate outcome may reach the idempotent reducer without being rejected as an unknown attempt");
assert.equal(actor.privateState.settledInteractionEvents.length, 1);
assert.equal(actor.privateState.ecologyState.voiceHabitUsage.length, 1);

console.log(JSON.stringify({
  status: "all-passed",
  checks: {
    ownerAttemptAndAuthorityBound: true,
    realAttemptSurfaceCreatesOwnContinuity: true,
    noSurfaceCreatesNoFalseAction: true,
    ownActionMemoryIsIdempotent: true,
    pendingObjectiveOutcomeMakesNoPrivateInference: true,
    successfulActionPhysiologyComposesBeforeObjectiveEffects: true,
    failedActionAddsNoPhysiology: true,
    committedSpeechHabitUseRequiresWorldEmission: true,
    outcomeAdapterReceivesReadonlyCurrentPrivateState: true,
    pendingAttemptIsCleared: true,
  },
}, null, 2));
