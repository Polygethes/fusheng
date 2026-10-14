import assert from "node:assert/strict";

import {
  advanceCharacterConversationContinuity,
  projectOwnedConversationAnchors,
  resolveOwnedConversationAnchor,
} from "../src/server/simulation/characterConversationContinuity.mjs";

const ALICE = "char:conversation:alice";
const CAROL = "char:conversation:carol";
const BOB_HANDLE = "known-person:bob";
const DANA_HANDLE = "known-person:dana";

function noticedDelivery({
  deliveryId = "delivery:conversation:question",
  sourceActionId = "action:conversation:question",
  sourceThreadId = "world-thread:tea-order",
  responseToTurnId = "",
  sourceParticipantHandle = BOB_HANDLE,
  directed = true,
  content = "今天还要往北门送茶吗？",
  speechAct = "ask",
  occurredAtSeconds = 120,
  threadStatus = "open",
  resumable = true,
  recipientCharacterId = ALICE,
} = {}) {
  return {
    kind: "noticed_speech_delivery",
    runtimeRecord: {
      authority: "runtime-noticed-speech-delivery",
      deliveryId,
      recipientCharacterId,
      noticed: true,
      eventKind: "speech",
      sourceParticipantHandle,
      directed,
      content,
      speechAct,
      occurredAtSeconds,
      threadStatus,
      resumable,
      provenance: {
        sourceActionId,
        sourceThreadId,
        responseToTurnId,
      },
    },
  };
}

function settledOutgoing({
  settlementId = "settlement:conversation:answer",
  sourceActionId = "action:conversation:answer",
  sourceThreadId = "world-thread:tea-order",
  responseToTurnId = "action:conversation:question",
  targetParticipantHandles = [BOB_HANDLE],
  actualRecipientParticipantHandles = [BOB_HANDLE],
  content = "要送，我把这壶封好便过去。",
  speechAct = "answer",
  occurredAtSeconds = 150,
  threadStatus = "open",
  resumable = true,
} = {}) {
  return {
    kind: "settled_outgoing_speech",
    runtimeRecord: {
      authority: "world-settled-outgoing-speech",
      settlementId,
      actorCharacterId: ALICE,
      outcomeStatus: "settled",
      eventKind: "speech",
      targetParticipantHandles,
      actualRecipientParticipantHandles,
      content,
      speechAct,
      occurredAtSeconds,
      threadStatus,
      resumable,
      provenance: {
        sourceActionId,
        sourceThreadId,
        responseToTurnId,
      },
    },
  };
}

// Tracer: an actually received and noticed utterance becomes a private,
// resumable anchor without exposing raw world lineage to the Character Agent.
const first = advanceCharacterConversationContinuity({
  ownerCharacterId: ALICE,
  experience: noticedDelivery(),
  nowSeconds: 120,
});
assert.equal(first.changed, true);
assert.equal(first.worldChanged, false);
assert.match(first.anchorHandle, /^conversation-anchor:[0-9a-f-]{36}$/u);

const firstProjection = projectOwnedConversationAnchors({
  ownerCharacterId: ALICE,
  conversationState: first.conversationState,
  nowSeconds: 4_200,
});
assert.equal(firstProjection.anchors.length, 1);
assert.equal(firstProjection.anchors[0].anchorHandle, first.anchorHandle);
assert.deepEqual(firstProjection.anchors[0].allowedModes, ["reply", "continue"]);
assert.deepEqual(firstProjection.anchors[0].participantHandles, [BOB_HANDLE]);
assert.equal(firstProjection.anchors[0].recentTurns[0].utterance, "今天还要往北门送茶吗？");
for (const secret of ["world-thread:tea-order", "action:conversation:question"]) {
  assert.equal(JSON.stringify(firstProjection).includes(secret), false, "projection must keep raw lineage server-side");
}

// Re-delivery after mailbox retry is idempotent.
const duplicate = advanceCharacterConversationContinuity({
  ownerCharacterId: ALICE,
  conversationState: first.conversationState,
  experience: noticedDelivery(),
  nowSeconds: 121,
});
assert.equal(duplicate.changed, false);
assert.equal(duplicate.anchorHandle, first.anchorHandle);
assert.equal(duplicate.conversationState.threads.length, 1);
assert.equal(duplicate.conversationState.threads[0].recentTurns.length, 1);
assert.throws(
  () => advanceCharacterConversationContinuity({
    ownerCharacterId: ALICE,
    conversationState: first.conversationState,
    experience: noticedDelivery({
      sourceActionId: "action:conversation:conflicting-replay",
      sourceThreadId: "world-thread:conflicting-replay",
    }),
  }),
  (error) => error?.code === "CHARACTER_CONVERSATION_EXPERIENCE_REPLAY_CONFLICT",
  "the same delivery id may be idempotent only when its runtime lineage is unchanged",
);

const groupLatest = advanceCharacterConversationContinuity({
  ownerCharacterId: ALICE,
  conversationState: first.conversationState,
  experience: noticedDelivery({
    deliveryId: "delivery:conversation:group-latest",
    sourceActionId: "action:conversation:group-latest",
    sourceParticipantHandle: DANA_HANDLE,
    content: "我也想知道北门几点关。",
    occurredAtSeconds: 130,
  }),
});
assert.throws(
  () => resolveOwnedConversationAnchor({
    ownerCharacterId: ALICE,
    conversationState: groupLatest.conversationState,
    anchorHandle: groupLatest.anchorHandle,
    mode: "reply",
    targetParticipantHandle: BOB_HANDLE,
  }),
  (error) => error?.code === "CHARACTER_CONVERSATION_TARGET_INCOMPATIBLE",
  "reply target must match the speaker of the exact parent turn, not merely any thread participant",
);
assert.equal(
  resolveOwnedConversationAnchor({
    ownerCharacterId: ALICE,
    conversationState: groupLatest.conversationState,
    anchorHandle: groupLatest.anchorHandle,
    mode: "reply",
    targetParticipantHandle: DANA_HANDLE,
  }).lineageBinding.responseToTurnId,
  "action:conversation:group-latest",
);

// The Character selects an opaque anchor. The server resolves the thread and
// precise parent together; neither raw lineage field is accepted as input.
const replyResolution = resolveOwnedConversationAnchor({
  ownerCharacterId: ALICE,
  conversationState: duplicate.conversationState,
  anchorHandle: first.anchorHandle,
  mode: "reply",
  targetParticipantHandle: BOB_HANDLE,
});
assert.equal(replyResolution.valid, true);
assert.equal(replyResolution.mode, "reply");
assert.equal(replyResolution.targetParticipantHandle, BOB_HANDLE);
assert.deepEqual(replyResolution.lineageBinding, {
  authority: "server-owned-conversation-lineage-binding",
  sourceThreadId: "world-thread:tea-order",
  responseToTurnId: "action:conversation:question",
});
assert.equal(Object.isFrozen(replyResolution.lineageBinding), true, "the thread/parent pair must be returned atomically");

const answered = advanceCharacterConversationContinuity({
  ownerCharacterId: ALICE,
  conversationState: duplicate.conversationState,
  experience: settledOutgoing({ actualRecipientParticipantHandles: [BOB_HANDLE, DANA_HANDLE] }),
  nowSeconds: 150,
});
assert.equal(answered.changed, true);
assert.equal(answered.anchorHandle, first.anchorHandle, "settled outgoing speech must continue the same durable thread");
assert.equal(answered.conversationState.threads[0].recentTurns.length, 2);
const answeredProjection = projectOwnedConversationAnchors({
  ownerCharacterId: ALICE,
  conversationState: answered.conversationState,
  nowSeconds: 10_000,
});
assert.deepEqual(answeredProjection.anchors[0].allowedModes, ["continue"]);
assert.equal(answeredProjection.anchors[0].recentTurns.at(-1).direction, "outgoing");
assert.equal(answeredProjection.anchors[0].recentTurns.at(-1).utterance, "要送，我把这壶封好便过去。");
assert.deepEqual(
  answeredProjection.anchors[0].participantHandles,
  [BOB_HANDLE],
  "a real acoustic overhearer may be recorded as an actual recipient but must not become a conversation participant",
);
assert.deepEqual(
  answeredProjection.anchors[0].recentTurns.at(-1).addresseeHandles,
  [BOB_HANDLE],
  "an overhearer must not be disguised as the outgoing turn's addressee",
);
const continueResolution = resolveOwnedConversationAnchor({
  ownerCharacterId: ALICE,
  conversationState: answered.conversationState,
  anchorHandle: answered.anchorHandle,
  mode: "continue",
  targetParticipantHandle: BOB_HANDLE,
});
assert.deepEqual(continueResolution.lineageBinding, {
  authority: "server-owned-conversation-lineage-binding",
  sourceThreadId: "world-thread:tea-order",
  responseToTurnId: "action:conversation:answer",
});

assert.throws(
  () => advanceCharacterConversationContinuity({
    ownerCharacterId: ALICE,
    conversationState: answered.conversationState,
    experience: {
      ...noticedDelivery({ deliveryId: "delivery:conversation:forged" }),
      privateAppraisal: {
        meaning: "我觉得这还是同一件事",
        sourceThreadId: "world-thread:forged-by-appraisal",
        responseToTurnId: "action:forged-parent",
      },
    },
  }),
  (error) => error?.code === "CHARACTER_CONVERSATION_RAW_LINEAGE_INPUT_FORBIDDEN",
  "private appraisal must never override runtime conversation provenance",
);
assert.throws(
  () => resolveOwnedConversationAnchor({
    ownerCharacterId: ALICE,
    conversationState: answered.conversationState,
    anchorHandle: answered.anchorHandle,
    mode: "continue",
    targetParticipantHandle: BOB_HANDLE,
    sourceThreadId: "world-thread:forged-by-model",
    responseToTurnId: "action:forged-parent",
  }),
  (error) => error?.code === "CHARACTER_CONVERSATION_RAW_LINEAGE_INPUT_FORBIDDEN",
  "raw lineage may not be supplied beside an opaque anchor selection",
);
assert.throws(
  () => advanceCharacterConversationContinuity({
    ownerCharacterId: ALICE,
    conversationState: answered.conversationState,
    experience: noticedDelivery({ deliveryId: "delivery:conversation:raw-top-level" }),
    sourceThreadId: "world-thread:raw-top-level",
  }),
  (error) => error?.code === "CHARACTER_CONVERSATION_RAW_LINEAGE_INPUT_FORBIDDEN",
  "advance must reject raw lineage outside the trusted runtime record too",
);

// An undirected utterance still creates a reply anchor for every Character
// who actually received and noticed that broadcast.
const broadcast = advanceCharacterConversationContinuity({
  ownerCharacterId: ALICE,
  conversationState: answered.conversationState,
  experience: {
    ...noticedDelivery({
      deliveryId: "delivery:conversation:broadcast",
      sourceActionId: "action:conversation:broadcast",
      sourceThreadId: "world-thread:market-news",
      directed: false,
      content: "北门今日提早落闩。",
      speechAct: "inform",
      occurredAtSeconds: 200,
    }),
    privateAppraisal: {
      meaning: "这消息也许会影响送茶",
      allowedModes: ["continue"],
      threadStatus: "closed",
    },
  },
  nowSeconds: 200,
});
assert.notEqual(broadcast.anchorHandle, answered.anchorHandle, "one speaker's distinct world threads need distinct anchors");
const broadcastProjection = projectOwnedConversationAnchors({
  ownerCharacterId: ALICE,
  conversationState: broadcast.conversationState,
  nowSeconds: 86_400,
});
const broadcastAnchor = broadcastProjection.anchors.find((row) => row.anchorHandle === broadcast.anchorHandle);
assert.deepEqual(broadcastAnchor.allowedModes, ["reply", "continue"], "private appraisal cannot rewrite server-owned modes");
assert.equal(broadcastAnchor.recentTurns[0].utterance, "北门今日提早落闩。");
assert.equal(/world-thread:|action:conversation:/u.test(JSON.stringify(broadcastProjection)), false);
const broadcastReply = resolveOwnedConversationAnchor({
  ownerCharacterId: ALICE,
  conversationState: broadcast.conversationState,
  anchorHandle: broadcast.anchorHandle,
  mode: "reply",
  targetParticipantHandle: BOB_HANDLE,
});
assert.equal(broadcastReply.lineageBinding.sourceThreadId, "world-thread:market-news");
assert.equal(broadcastReply.lineageBinding.responseToTurnId, "action:conversation:broadcast");

// Checkpointing is plain-data durable. Much later, the projection remains
// bounded and the same opaque handle still resolves to the same atomic pair.
const restoredConversationState = structuredClone(broadcast.conversationState);
const boundedAfterRestore = projectOwnedConversationAnchors({
  ownerCharacterId: ALICE,
  conversationState: restoredConversationState,
  nowSeconds: 7 * 86_400,
  maxAnchors: 1,
  maxRecentTurns: 1,
});
assert.equal(boundedAfterRestore.anchors.length, 1);
assert.equal(boundedAfterRestore.anchors[0].anchorHandle, broadcast.anchorHandle);
assert.equal(boundedAfterRestore.anchors[0].recentTurns.length, 1);
assert.deepEqual(
  resolveOwnedConversationAnchor({
    ownerCharacterId: ALICE,
    conversationState: restoredConversationState,
    anchorHandle: answered.anchorHandle,
    mode: "continue",
    targetParticipantHandle: BOB_HANDLE,
  }).lineageBinding,
  {
    authority: "server-owned-conversation-lineage-binding",
    sourceThreadId: "world-thread:tea-order",
    responseToTurnId: "action:conversation:answer",
  },
);

const carolConversation = advanceCharacterConversationContinuity({
  ownerCharacterId: CAROL,
  experience: noticedDelivery({
    recipientCharacterId: CAROL,
    deliveryId: "delivery:conversation:carol",
    sourceActionId: "action:conversation:carol",
    sourceThreadId: "world-thread:carol-private",
  }),
});
assert.throws(
  () => resolveOwnedConversationAnchor({
    ownerCharacterId: ALICE,
    conversationState: broadcast.conversationState,
    anchorHandle: carolConversation.anchorHandle,
    mode: "reply",
    targetParticipantHandle: BOB_HANDLE,
  }),
  (error) => error?.code === "CHARACTER_CONVERSATION_ANCHOR_UNKNOWN",
  "copying another owner's opaque handle must not grant access",
);
assert.throws(
  () => projectOwnedConversationAnchors({
    ownerCharacterId: ALICE,
    conversationState: carolConversation.conversationState,
  }),
  (error) => error?.code === "CHARACTER_CONVERSATION_STATE_OWNER_MISMATCH",
  "another owner's checkpoint cannot be projected as Alice's private continuity",
);
assert.throws(
  () => resolveOwnedConversationAnchor({
    ownerCharacterId: ALICE,
    conversationState: broadcast.conversationState,
    anchorHandle: "conversation-anchor:00000000-0000-0000-0000-000000000000",
    mode: "reply",
    targetParticipantHandle: BOB_HANDLE,
  }),
  (error) => error?.code === "CHARACTER_CONVERSATION_ANCHOR_UNKNOWN",
);
assert.throws(
  () => resolveOwnedConversationAnchor({
    ownerCharacterId: ALICE,
    conversationState: broadcast.conversationState,
    anchorHandle: broadcast.anchorHandle,
    mode: "reply",
    targetParticipantHandle: "known-person:not-in-thread",
  }),
  (error) => error?.code === "CHARACTER_CONVERSATION_TARGET_INCOMPATIBLE",
);

const closed = advanceCharacterConversationContinuity({
  ownerCharacterId: ALICE,
  conversationState: broadcast.conversationState,
  experience: noticedDelivery({
    deliveryId: "delivery:conversation:closed",
    sourceActionId: "action:conversation:closed",
    sourceThreadId: "world-thread:closed",
    content: "这件事到此为止。",
    speechAct: "refuse",
    occurredAtSeconds: 240,
    threadStatus: "closed",
    resumable: false,
  }),
});
assert.equal(
  projectOwnedConversationAnchors({
    ownerCharacterId: ALICE,
    conversationState: closed.conversationState,
  }).anchors.some((row) => row.anchorHandle === closed.anchorHandle),
  false,
  "closed non-resumable threads must not be projected",
);
assert.throws(
  () => resolveOwnedConversationAnchor({
    ownerCharacterId: ALICE,
    conversationState: closed.conversationState,
    anchorHandle: closed.anchorHandle,
    mode: "continue",
    targetParticipantHandle: BOB_HANDLE,
  }),
  (error) => error?.code === "CHARACTER_CONVERSATION_MODE_NOT_ALLOWED",
);

// Closing is owner-private. The same emitted turn may close the sender's
// resumable side while the actual recipient keeps an independently resumable
// incoming thread.
const senderClosed = advanceCharacterConversationContinuity({
  ownerCharacterId: ALICE,
  conversationState: answered.conversationState,
  experience: settledOutgoing({
    settlementId: "settlement:conversation:sender-close",
    sourceActionId: "action:conversation:sender-close",
    content: "我先走了。",
    threadStatus: "closed",
    resumable: false,
    occurredAtSeconds: 260,
  }),
});
assert.equal(
  projectOwnedConversationAnchors({
    ownerCharacterId: ALICE,
    conversationState: senderClosed.conversationState,
  }).anchors.some((row) => row.anchorHandle === senderClosed.anchorHandle),
  false,
  "close-for-self must remove only the sender's resumable anchor",
);
const recipientStillOpen = advanceCharacterConversationContinuity({
  ownerCharacterId: CAROL,
  experience: noticedDelivery({
    recipientCharacterId: CAROL,
    deliveryId: "delivery:conversation:sender-close",
    sourceActionId: "action:conversation:sender-close",
    content: "我先走了。",
    occurredAtSeconds: 260,
  }),
});
assert.deepEqual(
  projectOwnedConversationAnchors({
    ownerCharacterId: CAROL,
    conversationState: recipientStillOpen.conversationState,
  }).anchors[0].allowedModes,
  ["reply", "continue"],
  "one Character's close-for-self must not close the recipient's private side",
);

// Durable continuity is bounded. Closed/non-resumable threads are discarded
// first; if pressure still evicts an open thread, a bounded owner-private
// archive summary records that loss instead of silently forgetting it.
const tinyPolicy = {
  maxDurableThreads: 2,
  maxProcessedExperiences: 3,
  maxArchivedThreadSummaries: 2,
};
let boundedState = null;
for (const row of [
  { suffix: "open-a", occurredAtSeconds: 10, threadStatus: "open", resumable: true },
  { suffix: "closed-b", occurredAtSeconds: 20, threadStatus: "closed", resumable: false },
  { suffix: "open-c", occurredAtSeconds: 30, threadStatus: "open", resumable: true },
]) {
  boundedState = advanceCharacterConversationContinuity({
    ownerCharacterId: ALICE,
    conversationState: boundedState,
    experience: noticedDelivery({
      deliveryId: `delivery:bounded:${row.suffix}`,
      sourceActionId: `action:bounded:${row.suffix}`,
      sourceThreadId: `world-thread:bounded:${row.suffix}`,
      occurredAtSeconds: row.occurredAtSeconds,
      threadStatus: row.threadStatus,
      resumable: row.resumable,
    }),
    policy: tinyPolicy,
  }).conversationState;
}
assert.equal(boundedState.threads.length, 2);
assert.equal(
  boundedState.threads.some((row) => row.worldThreadId === "world-thread:bounded:closed-b"),
  false,
  "closed/non-resumable threads must be evicted before open continuity",
);
assert.deepEqual(boundedState.archivedThreadSummaries, []);
for (const row of [
  { suffix: "open-d", occurredAtSeconds: 40 },
  { suffix: "open-e", occurredAtSeconds: 50 },
  { suffix: "open-f", occurredAtSeconds: 60 },
]) {
  boundedState = advanceCharacterConversationContinuity({
    ownerCharacterId: ALICE,
    conversationState: boundedState,
    experience: noticedDelivery({
      deliveryId: `delivery:bounded:${row.suffix}`,
      sourceActionId: `action:bounded:${row.suffix}`,
      sourceThreadId: `world-thread:bounded:${row.suffix}`,
      occurredAtSeconds: row.occurredAtSeconds,
    }),
    policy: tinyPolicy,
  }).conversationState;
}
assert.equal(boundedState.threads.length, 2);
assert.equal(boundedState.processedExperienceIds.length, 3);
assert.equal(boundedState.processedExperiences.length, 3);
assert.equal(boundedState.archivedThreadSummaries.length, 2);
assert.ok(boundedState.archivedThreadSummaries.every((row) => (
  row.authority === "character-private-conversation-archive-summary"
  && row.ownerCharacterId === ALICE
  && row.archivedReason === "durable_thread_capacity"
  && row.lastExperiencedTurn?.utterance
)));
const restoredBounded = structuredClone(boundedState);
assert.deepEqual(
  projectOwnedConversationAnchors({ ownerCharacterId: ALICE, conversationState: restoredBounded }),
  projectOwnedConversationAnchors({ ownerCharacterId: ALICE, conversationState: boundedState }),
  "checkpoint restore must preserve deterministic bounded ordering",
);

assert.throws(
  () => advanceCharacterConversationContinuity({
    ownerCharacterId: ALICE,
    experience: noticedDelivery({ recipientCharacterId: CAROL }),
  }),
  (error) => error?.code === "CHARACTER_CONVERSATION_INCOMING_NOT_OWNED",
  "delivery to another Character is not Alice's experience",
);
const unnoticed = noticedDelivery({ deliveryId: "delivery:conversation:unnoticed" });
unnoticed.runtimeRecord.noticed = false;
assert.throws(
  () => advanceCharacterConversationContinuity({ ownerCharacterId: ALICE, experience: unnoticed }),
  (error) => error?.code === "CHARACTER_CONVERSATION_INCOMING_NOT_OWNED",
  "delivered but unnoticed speech must not enter durable continuity",
);
const unsettled = settledOutgoing({ settlementId: "settlement:conversation:unsettled" });
unsettled.runtimeRecord.outcomeStatus = "planned";
assert.throws(
  () => advanceCharacterConversationContinuity({ ownerCharacterId: ALICE, experience: unsettled }),
  (error) => error?.code === "CHARACTER_CONVERSATION_OUTGOING_NOT_SETTLED",
  "planned but unsettled speech must not become lived outgoing history",
);

console.log("character conversation continuity contracts: ok");
