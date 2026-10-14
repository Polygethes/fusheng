import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import {
  createTavernWorldRuntimeV27,
  projectTavernV27TurnForObserver,
} from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";

const XIE = "char_xyy_xiezenshi";
const LUO = "char_xyy_luozhao";

function clean(value = "") {
  return String(value ?? "").trim();
}

function otherHandle(stageInput = {}) {
  return clean((stageInput.worldProjection?.perceivedCharacters || [])[0]?.id);
}

function basePlan(overrides = {}) {
  return {
    intention: "处理本人眼前实际发生的事",
    primitive: "none",
    targetId: "",
    utterance: "",
    visibleAction: "",
    texture: [],
    privateBasis: "只根据本人收到的事实决定这一拍。",
    ...overrides,
  };
}

function createArrivalPlanner() {
  const turnIndex = new Map([[LUO, 0], [XIE, 0]]);
  return (stageInput = {}) => {
    const characterId = clean(stageInput.characterId);
    const index = Number(turnIndex.get(characterId) || 0);
    turnIndex.set(characterId, index + 1);
    const targetId = otherHandle(stageInput);

    if (characterId === LUO && index === 0) return basePlan({
      intention: "进入酒馆看看堂前情形",
      primitive: "move",
      destinationId: "hall",
      visibleAction: "洛照跨过门槛，走进堂前。",
    });
    if (characterId === XIE && index === 0) return basePlan({
      intention: "先问清刚进门的客人需要什么",
      primitive: "speak",
      targetId,
      utterance: "客官，住店还是吃饭？",
    });
    if (characterId === LUO && index === 1) return basePlan({
      intention: "先点一壶茶，在堂前坐下",
      primitive: "speak",
      targetId,
      utterance: "来壶茶。",
    });
    return basePlan();
  };
}

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
const stageInputs = [];
const fixture = createTavernV27FixtureStageRunner({ planForTurn: createArrivalPlanner() });
const instance = createTavernWorldRuntimeV27(state, {
  characterAgentCallMode: "standard", // Inspect the appraisal seam independently.
  positions: { [XIE]: "hall", [LUO]: "threshold" },
  worldId: "world:xyy:tavern:v27:arrival-hospitality",
  runStage: async (input, options) => {
    stageInputs.push(structuredClone(input));
    return fixture(input, options);
  },
});

assert.equal(instance.runtime.actors.get(XIE).mailbox.length, 0,
  "initial co-presence may not fabricate an arrival wake for the tavern worker");

await instance.runtime.enqueueWake(LUO, {
  wakeId: "wake:arrival-hospitality:luo-at-threshold",
  kind: "opportunity_window",
  evidenceIds: [],
  evidence: [],
});

const arrival = await instance.runtime.runNext({ characterId: LUO });
assert.equal(arrival.outcome.status, "success");
assert.equal(instance.coordinator.worldState.entities[LUO].zoneId, "hall");
const arrivalDelivery = arrival.outcome.deliveries.find((row) => (
  row.recipientCharacterId === XIE && clean(row.eventKind) === "movement"
));
assert.ok(arrivalDelivery, "successful entry must create recipient-safe visual movement evidence for Xie");
assert.ok(instance.runtime.actors.get(XIE).mailbox.some((wake) => (
  wake.kind === "world_evidence"
  && clean(wake.eventId) === clean(arrival.outcome.eventId)
  && wake.evidence.some((row) => clean(row.eventKind) === "movement")
)), "the real arrival delivery, not an empty scheduler turn, must activate Xie");

const reception = await instance.runtime.runNext({ characterId: XIE });
assert.equal(reception.outcome.status, "success");
const receptionObserver = projectTavernV27TurnForObserver(reception, state.characters);
assert.equal(receptionObserver.publicRealization.speech, "客官，住店还是吃饭？");
const receptionDelivery = reception.outcome.deliveries.find((row) => (
  row.recipientCharacterId === LUO && clean(row.eventKind) === "speech"
));
assert.ok(receptionDelivery, "Xie's actual speech must reach Luo through the shared hall");
const questionTurnId = clean(reception.actionAttempt?.attemptId);
const questionThreadId = clean(receptionDelivery.provenance?.sourceThreadId);
assert.equal(receptionDelivery.provenance?.sourceActionId, questionTurnId,
  "the delivered question must cite the objective speech action that emitted it");
assert.ok(questionThreadId,
  "the first directed question must open one stable shared conversation thread");
assert.equal(clean(receptionDelivery.provenance?.responseToTurnId), "",
  "the first question is not fabricated as a reply to an earlier turn");
const luoQuestionWake = instance.runtime.actors.get(LUO).mailbox.find((wake) => (
  (wake.evidence || []).some((row) => clean(row.content) === "客官，住店还是吃饭？")
));
const luoQuestionEvidence = luoQuestionWake?.evidence.find((row) => (
  clean(row.content) === "客官，住店还是吃饭？"
));
assert.equal(luoQuestionEvidence?.provenance?.sourceActionId, questionTurnId,
  "world delivery provenance must survive into Luo's mailbox");
assert.equal(luoQuestionEvidence?.provenance?.sourceThreadId, questionThreadId,
  "Luo's wake must carry the same shared thread opened by Xie's question");
assert.equal(luoQuestionEvidence?.speechAct, "ask",
  "the mailbox may not degrade a settled ask into a generic inform");

const xieAppraisalInput = stageInputs.find((row) => (
  row.characterId === XIE && row.phase === "awaiting_subjective_appraisal"
));
assert.ok(xieAppraisalInput?.worldProjection?.evidence?.some((row) => (
  clean(row.actionKind || row.eventKind) === "movement"
  && row.evidenceId === `evidence:${arrivalDelivery.deliveryId}`
)), "Xie must appraise the committed entry evidence with its recipient-safe identity");
assert.ok(xieAppraisalInput?.worldProjection?.currentResponsibilities?.acceptedRoleIds?.includes("household_worker"),
  "Xie's accepted tavern role must remain available as private responsibility material");
assert.ok((xieAppraisalInput?.worldProjection?.currentResponsibilities?.objectiveOpportunityCues || []).length > 0,
  "the present guest and service affordances must form an objective responsibility cue");
assert.equal(xieAppraisalInput.worldProjection.currentResponsibilities.selection.selectedCandidateId, null,
  "responsibility tools may inform but never choose Xie's response");

const order = await instance.runtime.runNext({ characterId: LUO });
assert.equal(order.outcome.status, "success");
const orderObserver = projectTavernV27TurnForObserver(order, state.characters);
assert.equal(orderObserver.publicRealization.speech, "来壶茶。");
const luoOrderAppraisalInput = stageInputs.findLast((row) => (
  row.characterId === LUO && row.phase === "awaiting_subjective_appraisal"
));
const projectedQuestionEvidence = luoOrderAppraisalInput?.worldProjection?.evidence?.find((row) => (
  clean(row.content) === "客官，住店还是吃饭？"
));
const projectedQuestionTurn = luoOrderAppraisalInput?.worldProjection?.discourseContext?.recentPublicTurns
  ?.find((row) => clean(row.utterance) === "客官，住店还是吃饭？");
const projectedQuestionAnchor = luoOrderAppraisalInput?.worldProjection?.conversationAnchors?.anchors
  ?.find((row) => (
    row.allowedModes?.includes("reply")
    && row.recentTurns?.some((turn) => clean(turn.utterance) === "客官，住店还是吃饭？")
  ));
assert.ok(projectedQuestionAnchor,
  "Luo must receive an opaque reply anchor derived from the actual noticed question delivery");
assert.equal(projectedQuestionEvidence?.speechAct, "ask",
  "Luo's Character Agent must receive the question as an ask");
for (const field of ["sourceActionId", "sourceThreadId", "responseToTurnId", "provenance", "conversationThreadHandle"]) {
  assert.equal(Object.hasOwn(projectedQuestionEvidence || {}, field), false,
    `Character-visible evidence must not expose raw conversation lineage field ${field}`);
  assert.equal(Object.hasOwn(projectedQuestionTurn || {}, field), false,
    `Character-visible literal history must not expose raw conversation lineage field ${field}`);
}
assert.equal(Object.hasOwn(luoOrderAppraisalInput?.worldProjection?.activation || {}, "sourceThreadId"), false,
  "activation may identify the lived evidence but must not expose a raw world thread id");
assert.equal(Object.hasOwn(luoOrderAppraisalInput?.worldProjection?.activation || {}, "responseToTurnId"), false,
  "activation may not expose a raw parent turn id");

const answerProvenance = order.actionAttempt?.payload?.provenance || {};
assert.equal(answerProvenance.sourceActionId, clean(order.actionAttempt?.attemptId),
  "the answer attempt must identify its own objective speech turn");
assert.equal(answerProvenance.sourceThreadId, questionThreadId,
  "the answer attempt must continue the question's shared thread");
assert.equal(answerProvenance.responseToTurnId, questionTurnId,
  "the answer attempt must point precisely to the question it answers");
const orderDelivery = order.outcome.deliveries.find((row) => (
  row.recipientCharacterId === XIE && clean(row.eventKind) === "speech"
));
assert.ok(orderDelivery, "Luo's answer must reach Xie before any later service action");
assert.equal(orderDelivery.speechAct, "answer",
  "server-side post-generation semantics must recognize the lived reply instead of defaulting it to inform");
assert.equal(orderDelivery.provenance?.sourceActionId, clean(order.actionAttempt?.attemptId));
assert.equal(orderDelivery.provenance?.sourceThreadId, questionThreadId);
assert.equal(orderDelivery.provenance?.responseToTurnId, questionTurnId);
const xieAnswerWake = instance.runtime.actors.get(XIE).mailbox.find((wake) => (
  (wake.evidence || []).some((row) => clean(row.content) === "来壶茶。")
));
const xieAnswerEvidence = xieAnswerWake?.evidence.find((row) => clean(row.content) === "来壶茶。");
assert.equal(xieAnswerEvidence?.provenance?.sourceActionId, clean(order.actionAttempt?.attemptId),
  "the answer source turn must survive into Xie's wake");
assert.equal(xieAnswerEvidence?.provenance?.sourceThreadId, questionThreadId,
  "Xie's wake must retain the same shared conversation thread");
assert.equal(xieAnswerEvidence?.provenance?.responseToTurnId, questionTurnId,
  "Xie's wake must retain which exact question Luo answered");
const luoConversationState = instance.runtime.actors.get(LUO).privateState.conversationState;
const persistedQuestionThread = luoConversationState?.threads?.find((row) => (
  clean(row.worldThreadId) === questionThreadId
));
assert.equal(luoConversationState?.ownerCharacterId, LUO,
  "noticed dialogue continuity must remain server-private and owner-scoped");
assert.equal(persistedQuestionThread?.anchorHandle, projectedQuestionAnchor.anchorHandle,
  "the opaque anchor selected during the turn must remain stable in durable private state");
assert.equal(persistedQuestionThread?.lastExperiencedTurnId, clean(order.actionAttempt?.attemptId),
  "the successfully settled answer must advance the same server-private anchor");
assert.equal(persistedQuestionThread?.recentTurns?.at(-1)?.direction, "outgoing",
  "world settlement, not the Character's intention, must append the outgoing conversation turn");
const luoPrivateTurns = instance.runtime.actors.get(LUO).privateState.experiencedConversationTurns || [];
const luoRememberedQuestion = luoPrivateTurns.find((turn) => clean(turn.id) === questionTurnId);
const luoRememberedAnswer = luoPrivateTurns.find((turn) => clean(turn.id) === clean(order.actionAttempt?.attemptId));
assert.equal(luoRememberedQuestion?.sourceThreadId || luoRememberedQuestion?.threadId, questionThreadId,
  "Luo's private incoming history must retain the shared question thread");
assert.equal(luoRememberedAnswer?.sourceThreadId || luoRememberedAnswer?.threadId, questionThreadId,
  "Luo's private outgoing history must retain the same shared thread");
assert.equal(luoRememberedAnswer?.responseToTurnId, questionTurnId,
  "Luo's private outgoing history must retain the precise answered turn");

assert.equal(instance.coordinator.journal.worldVersion, 3);
assert.equal(stageInputs.length, 12, "three Character turns must each use the four-stage atomic protocol");

console.log(JSON.stringify({
  status: "all-passed",
  actorOrder: [arrival.characterId, reception.characterId, order.characterId],
  publicUtterances: [
    receptionObserver.publicRealization.speech,
    orderObserver.publicRealization.speech,
  ],
  worldVersion: instance.coordinator.journal.worldVersion,
  arrivalEventId: arrival.outcome.eventId,
  externalProviderRequests: 0,
  responsibilitySelection: null,
}, null, 2));
