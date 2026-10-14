import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import {
  createTavernWorldRuntimeV27,
  resolveTavernV27ConversationSelectionForWorld,
} from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";

const XIE = "char_xyy_xiezenshi";
const LUO = "char_xyy_luozhao";
const FIRST_CALL = "堂前的人都听着，今晚早些打烊。";
const FIRST_REPLY = "听见了，我会留意时辰。";
const SECOND_CALL = "还有谁要添热水？";
const FIRST_CONTINUATION = "方才那件事，我记下了。";

function clean(value = "") {
  return String(value ?? "").trim();
}

function basePlan(overrides = {}) {
  return {
    intention: "处理本人眼前实际发生的事",
    primitive: "none",
    targetId: "",
    utterance: "",
    visibleAction: "",
    texture: [],
    privateBasis: "只根据本人实际收到的现场事实决定这一拍。",
    ...overrides,
  };
}

function otherHandle(stageInput = {}) {
  return clean((stageInput.worldProjection?.perceivedCharacters || [])[0]?.id);
}

function loggedFixture(planForTurn, calls) {
  const fixture = createTavernV27FixtureStageRunner({ planForTurn });
  return async (input, options = {}) => {
    const output = await fixture(input, options);
    calls.push({
      stage: clean(options.stage),
      input: structuredClone(input),
      output: structuredClone(output),
    });
    return output;
  };
}

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});

const initialCalls = [];
const initialFixture = loggedFixture((stageInput = {}) => {
  if (clean(stageInput.characterId) === XIE) return basePlan({
    intention: "让堂前所有听得到的人知道今晚的安排",
    primitive: "speak",
    utterance: FIRST_CALL,
    vocalMode: "call_out",
    conversationMode: "none",
  });
  return basePlan({
    intention: "先把听到的话留在心里，隔一阵再回应",
  });
}, initialCalls);

const initial = createTavernWorldRuntimeV27(state, {
  positions: { [XIE]: "hall", [LUO]: "hall" },
  worldId: "world:xyy:tavern:v27:conversation-continuity-integration",
  runStage: initialFixture,
});
await initial.runtime.enqueueWake(XIE, {
  wakeId: "wake:conversation-continuity:first-call",
  kind: "opportunity_window",
  evidenceIds: [],
  evidence: [],
});

const firstCall = await initial.runtime.runNext({ characterId: XIE });
assert.equal(firstCall.outcome.status, "success");
const firstCallId = clean(firstCall.actionAttempt?.attemptId);
const firstCallDelivery = firstCall.outcome.deliveries.find((row) => (
  clean(row.recipientCharacterId) === LUO
  && clean(row.eventKind) === "speech"
));
assert.ok(firstCallDelivery, "an actual broadcast recipient must receive the settled speech");
assert.equal(firstCallDelivery.directed, false, "the test must exercise an actual undirected broadcast");
const firstThreadId = clean(firstCallDelivery.provenance?.sourceThreadId);
assert.ok(firstThreadId);
assert.equal(firstCallDelivery.provenance?.sourceActionId, firstCallId);
const xieSettledBroadcastThread = initial.runtime.actors.get(XIE).privateState.conversationState.threads
  .find((row) => clean(row.worldThreadId) === firstThreadId);
assert.equal(xieSettledBroadcastThread.participantHandles.length, 0,
  "an untargeted broadcast listener becomes an actual recipient, not an implied conversation participant");

const deferred = await initial.runtime.runNext({ characterId: LUO });
assert.equal(deferred.actionAttempt, null, "Luo may defer a noticed broadcast without losing its thread");
const preCheckpointLuoState = initial.runtime.actors.get(LUO).privateState.conversationState;
const preCheckpointFirstThread = preCheckpointLuoState.threads.find((row) => (
  clean(row.worldThreadId) === firstThreadId
));
assert.ok(preCheckpointFirstThread, "the actually noticed broadcast must become durable before checkpoint");
assert.deepEqual(preCheckpointFirstThread.allowedModes, ["reply", "continue"]);
const firstLuoAnchor = clean(preCheckpointFirstThread.anchorHandle);
const firstXieHandle = clean(preCheckpointFirstThread.participantHandles[0]);
const checkpoint = await initial.runtime.checkpoint();

const resumedCalls = [];
const resumedTurnIndex = new Map([[XIE, 0], [LUO, 0]]);
const resumedFixture = loggedFixture((stageInput = {}) => {
  const characterId = clean(stageInput.characterId);
  const index = Number(resumedTurnIndex.get(characterId) || 0);
  resumedTurnIndex.set(characterId, index + 1);
  const targetId = otherHandle(stageInput);
  if (characterId === XIE) return basePlan({
    intention: "另起一件事，向堂前的人问热水",
    primitive: "speak",
    utterance: SECOND_CALL,
    vocalMode: "call_out",
    conversationMode: "none",
  });
  if (index === 0) return basePlan({
    intention: "隔了一阵，回应方才听到的安排",
    primitive: "speak",
    targetId,
    utterance: FIRST_REPLY,
  });
  if (index === 1) return basePlan({
    intention: "先不回答新问话，保留两件各自独立的谈话",
  });
  const firstAnchor = (stageInput.worldProjection?.conversationAnchors?.anchors || []).find((anchor) => (
    (anchor.recentTurns || []).some((turn) => clean(turn.utterance) === FIRST_CALL)
  ));
  return basePlan({
    intention: "明确续接较早的打烊安排，而不是最新的热水问话",
    primitive: "speak",
    targetId,
    utterance: FIRST_CONTINUATION,
    conversationAnchorHandle: clean(firstAnchor?.anchorHandle),
    conversationMode: "continue",
  });
}, resumedCalls);

const resumed = createTavernWorldRuntimeV27(state, {
  positions: { [XIE]: "hall", [LUO]: "hall" },
  worldId: "world:xyy:tavern:v27:conversation-continuity-integration",
  checkpoint,
  runStage: resumedFixture,
});
await resumed.runtime.enqueueWake(LUO, {
  wakeId: "wake:conversation-continuity:delayed-reply",
  kind: "continuation_due",
  evidenceIds: [],
  evidence: [],
});
const delayedReply = await resumed.runtime.runNext({ characterId: LUO });
assert.equal(delayedReply.outcome.status, "success");
const delayedReplyId = clean(delayedReply.actionAttempt?.attemptId);
assert.equal(delayedReply.actionAttempt.payload.provenance.sourceThreadId, firstThreadId,
  "a checkpointed opaque anchor must resolve back to the actual broadcast thread");
assert.equal(delayedReply.actionAttempt.payload.provenance.responseToTurnId, firstCallId,
  "the delayed reply must bind to the exact actual broadcast turn");
const delayedCommitInput = resumedCalls.find((row) => (
  row.stage === "agent_turn_commit" && clean(row.input.characterId) === LUO
));
assert.ok(delayedCommitInput.input.expressionMoment.conversationAnchors.anchors.some((row) => (
  clean(row.anchorHandle) === firstLuoAnchor && row.allowedModes.includes("reply")
)), "the restored Character must receive the same opaque reply anchor");
assert.equal(JSON.stringify(delayedCommitInput.input).includes(firstThreadId), false,
  "the delayed Character-facing projection must not expose the actual world thread id");
assert.equal(JSON.stringify(delayedCommitInput.input).includes(firstCallId), false,
  "the delayed Character-facing projection must not expose the actual parent turn id");

const secondCall = await resumed.runtime.runNext({ characterId: XIE });
assert.equal(secondCall.outcome.status, "success");
const secondCallDelivery = secondCall.outcome.deliveries.find((row) => (
  clean(row.recipientCharacterId) === LUO
  && clean(row.eventKind) === "speech"
));
assert.ok(secondCallDelivery);
const secondThreadId = clean(secondCallDelivery.provenance?.sourceThreadId);
assert.notEqual(secondThreadId, firstThreadId,
  "an explicit none selection must open a second actual thread even with the same speaker");

const secondDeferred = await resumed.runtime.runNext({ characterId: LUO });
assert.equal(secondDeferred.actionAttempt, null);
const twoThreadState = resumed.runtime.actors.get(LUO).privateState.conversationState;
assert.equal(twoThreadState.threads.length, 2,
  "two actual broadcasts by the same speaker must remain independently addressable");
assert.ok(twoThreadState.threads.some((row) => clean(row.worldThreadId) === firstThreadId));
assert.ok(twoThreadState.threads.some((row) => clean(row.worldThreadId) === secondThreadId));

await resumed.runtime.enqueueWake(LUO, {
  wakeId: "wake:conversation-continuity:choose-older-thread",
  kind: "continuation_due",
  evidenceIds: [],
  evidence: [],
});
const olderThreadContinuation = await resumed.runtime.runNext({ characterId: LUO });
assert.equal(olderThreadContinuation.outcome.status, "success");
assert.equal(olderThreadContinuation.actionAttempt.payload.provenance.sourceThreadId, firstThreadId,
  "the Character's opaque selection must choose the older of two live threads");
assert.equal(olderThreadContinuation.actionAttempt.payload.provenance.responseToTurnId, delayedReplyId,
  "continue must bind atomically to the last experienced turn of the selected thread");
const finalCommit = resumedCalls.filter((row) => (
  row.stage === "agent_turn_commit" && clean(row.input.characterId) === LUO
)).at(-1);
assert.equal(finalCommit.output.turnCommit.conversationAnchorSelection.anchorHandle, firstLuoAnchor);
assert.equal(finalCommit.output.turnCommit.conversationAnchorSelection.mode, "continue");
assert.equal(finalCommit.input.expressionMoment.conversationAnchors.anchors.length, 2);
const finalTurnCharacterInputs = resumedCalls
  .filter((row) => clean(row.input.agentTurnId) === clean(finalCommit.input.agentTurnId))
  .map((row) => row.input);
assert.equal(JSON.stringify(finalTurnCharacterInputs).includes(firstThreadId), false,
  "even after an outgoing settlement, only opaque anchors may expose conversation continuity to the Character");
for (const forbiddenField of ["sourceThreadId", "responseToTurnId", "conversationThreadHandle", "worldThreadId"]) {
  assert.equal(JSON.stringify(finalTurnCharacterInputs).includes(`\"${forbiddenField}\"`), false,
    `settled-own-action surfaces may not re-expose raw conversation field ${forbiddenField}`);
}

const finalLuoState = resumed.runtime.actors.get(LUO).privateState.conversationState;
const xiePrivateState = resumed.runtime.actors.get(XIE).privateState.conversationState;
const actualXieOwnedAnchor = clean(xiePrivateState.threads.find((row) => (
  clean(row.worldThreadId) === firstThreadId
))?.anchorHandle);
assert.ok(actualXieOwnedAnchor);
assert.throws(
  () => resolveTavernV27ConversationSelectionForWorld({
    ownerCharacterId: LUO,
    conversationState: finalLuoState,
    bridge: {
      rawDecision: {
        speech: "复制他人的锚点。",
        speechTargetCharacterId: firstXieHandle,
        sourceActionId: "",
        sourceThreadId: "",
        responseToTurnId: "",
        conversationAnchorSelection: {
          anchorHandle: actualXieOwnedAnchor,
          mode: "continue",
          targetParticipantHandle: firstXieHandle,
        },
      },
    },
  }),
  (error) => error?.code === "CHARACTER_CONVERSATION_ANCHOR_UNKNOWN",
  "an opaque anchor copied from another owner must fail before world submission",
);
assert.throws(
  () => resolveTavernV27ConversationSelectionForWorld({
    ownerCharacterId: LUO,
    conversationState: finalLuoState,
    bridge: {
      rawDecision: {
        speech: "尝试拆配真实谱系。",
        speechTargetCharacterId: firstXieHandle,
        sourceActionId: "",
        sourceThreadId: firstThreadId,
        responseToTurnId: delayedReplyId,
        conversationAnchorSelection: {
          anchorHandle: firstLuoAnchor,
          mode: "continue",
          targetParticipantHandle: firstXieHandle,
        },
      },
    },
  }),
  (error) => error?.code === "TAVERN_V27_RAW_CONVERSATION_LINEAGE_FORBIDDEN",
  "even real thread and turn ids may not be submitted through the Character path",
);
assert.throws(
  () => resolveTavernV27ConversationSelectionForWorld({
    ownerCharacterId: LUO,
    conversationState: finalLuoState,
    bridge: {
      rawDecision: {
        speech: "错误目标。",
        speechTargetCharacterId: LUO,
        sourceActionId: "",
        sourceThreadId: "",
        responseToTurnId: "",
        conversationAnchorSelection: {
          anchorHandle: firstLuoAnchor,
          mode: "continue",
          targetParticipantHandle: LUO,
        },
      },
    },
  }),
  (error) => error?.code === "CHARACTER_CONVERSATION_TARGET_INCOMPATIBLE",
  "an actual but nonparticipant target must be rejected by the owner-scoped anchor",
);

console.log(JSON.stringify({
  status: "all-passed",
  checks: {
    actualBroadcastCreatesRecipientReplyAnchor: true,
    checkpointedAnchorSupportsDelayedReply: true,
    sameSpeakerThreadsRemainIndependent: true,
    olderThreadCanBeSelectedByOpaqueHandle: true,
    copiedAnchorRawLineageAndIncompatibleTargetRejected: true,
  },
  actualWorldThreads: 2,
}, null, 2));
