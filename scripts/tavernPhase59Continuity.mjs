import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { runTavernCausalScene } from "../src/server/pipeline/tavernCausalScene.mjs";

const IDS = {
  mother: "char_xyy_xiemu",
  visitor: "char_xyy_chenyan",
};

const VISIT_ID = "phase59_visit_work_meal";

const SLOT = {
  day: 2,
  slotId: "day-2-dawn",
  slotLabel: "清晨",
  slotBaseId: "dawn",
};

const TOPIC = "陈砚以工换饭";
const QUESTION = "谢婶，我做杂务换碗饭，行吗？";
const ANSWER = "陈砚，换饭可以。你先进来，活我当面说。";

function buildState() {
  const state = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  state.ui.timeGrain = "scene";
  state.ui.engineMode = "openai";
  state.ui.setupCompleted = true;
  state.tavernState.activeVisits = [{
    id: VISIT_ID,
    visitorId: IDS.visitor,
    visitorName: "陈砚",
    situationalRole: "以工换饭的熟客",
    purpose: "做一段杂务换一碗热饭",
    kind: "work_exchange",
    expectedHostIds: [IDS.mother],
    requestedService: "work_meal",
    paymentMode: "work_exchange",
    completionCondition: "杂务验过并拿到热饭",
    purposeStatus: "undisclosed",
    purposeDisclosureStatus: "undisclosed",
    purposeAction: "做完酒馆当面分派的杂务",
    purposeZoneIds: ["hall", "courtyard"],
    allowedZoneIds: ["threshold", "hall", "courtyard"],
    carriedObjectLabel: "随身物件",
    arrivalCue: "带着随身物件站在门槛内",
    stage: "waiting",
    hostId: "",
    workStatus: "unassigned",
    serviceStatus: "pending",
    paymentStatus: "unsettled",
    deliveryStatus: "not_required",
    lodgingStatus: "not_required",
    businessStatus: "not_required",
    arrivedDay: SLOT.day,
    arrivedSlot: SLOT.slotLabel,
  }];
  state.tavernState.eventThreads = [];
  for (const character of state.characters) {
    const present = [IDS.mother, IDS.visitor].includes(character.id);
    character.lifeState.present = present;
    if (present) {
      character.currentLocationId = "loc_xyy_tavern";
      character.ecologyState.presence.locationId = "loc_xyy_tavern";
      character.ecologyState.presence.zoneId = character.id === IDS.visitor ? "门槛" : "堂前";
      character.ecologyState.presence.observableAtStage = true;
      if (character.id === IDS.visitor) character.lifeState.activeVisitId = VISIT_ID;
    }
  }
  return state;
}

function passDecision(reason = "这一刻没有形成可公开提交的回答。", candidateId = "") {
  return {
    candidateId,
    actionType: "pass",
    speechAct: "none",
    targetCharacterId: "",
    speech: "",
    visibleAction: "",
    moveToZoneId: "",
    affordanceId: "",
    informationSourceImpactId: "",
    commitmentAction: "none",
    commitmentTopic: "",
    privateReason: reason,
  };
}

function questionDecision(candidateId) {
  return {
    candidateId,
    actionType: "speak",
    speechAct: "ask",
    targetCharacterId: IDS.mother,
    speech: QUESTION,
    visibleAction: "陈砚站在门槛内，朝谢母开口。",
    moveToZoneId: "hall",
    affordanceId: `declare_visit_purpose:${VISIT_ID}`,
    informationSourceImpactId: "",
    commitmentAction: "open",
    commitmentTopic: TOPIC,
    privateReason: "他想先把以工换饭的条件问清，再决定做哪一项杂务。",
  };
}

function answerDecision(candidateId) {
  return {
    candidateId,
    actionType: "speak",
    speechAct: "answer",
    targetCharacterId: IDS.visitor,
    speech: ANSWER,
    visibleAction: "谢母停下手里的活，走到陈砚面前。",
    moveToZoneId: "",
    affordanceId: `receive_guest:${VISIT_ID}`,
    informationSourceImpactId: "",
    commitmentAction: "none",
    commitmentTopic: TOPIC,
    privateReason: "陈砚当面问能不能以工换饭，她先明确接下这次来意。",
  };
}

function openingImpact() {
  return {
    id: "phase59:visitor-needs-meal",
    sourceCharacterId: "world:phase59-visitor-need",
    sourceZoneId: "threshold",
    type: "institution",
    modality: "memory",
    intensity: 100,
    radius: 0,
    directedTargetId: IDS.visitor,
    content: "陈砚已经走到酒馆门槛，想亲口问清今天能否做杂务换一碗饭。",
    topic: TOPIC,
    speechAct: "none",
  };
}

function sceneOptions(overrides = {}) {
  return {
    allowOrphanVisitors: true,
    characterIds: [IDS.visitor, IDS.mother],
    positions: { [IDS.visitor]: "threshold", [IDS.mother]: "hall" },
    seedImpacts: [openingImpact()],
    slotContext: SLOT,
    minimumActivationScore: 0,
    maxSceneSeconds: 12 * 60,
    ...overrides,
  };
}

function candidateForAffordance(input, affordanceId) {
  return input.privateActionCandidates.find((candidate) => (
    candidate.feasible && candidate.realization?.affordanceId === affordanceId
  )) || null;
}

function responseCandidate(input, targetCharacterId) {
  return input.privateActionCandidates.find((candidate) => (
    candidate.feasible
    && candidate.targetCharacterId === targetCharacterId
    && !candidate.realization?.affordanceId
  )) || input.privateActionCandidates.find((candidate) => candidate.feasible) || null;
}

function replyEvidence(result) {
  const question = (result.actions || []).find((action) => action.actorId === IDS.visitor && action.speech === QUESTION) || null;
  const answer = (result.actions || []).find((action) => action.actorId === IDS.mother && action.speech === ANSWER) || null;
  const parentImpact = answer
    ? (result.impacts || []).find((impact) => impact.id === answer.causalParentImpactId) || null
    : null;
  return { question, answer, parentImpact };
}

function unresolvedRequests(result) {
  if (Array.isArray(result.unresolvedRequests)) return result.unresolvedRequests;
  return (result.sceneRuntime?.requestLocks || []).filter((lock) => ["awaiting", "unresolved"].includes(lock.status));
}

function compactAction(action) {
  if (!action) return null;
  return {
    id: action.id || "",
    step: action.step,
    actorId: action.actorId || "",
    targetCharacterId: action.targetCharacterId || "",
    speechAct: action.speechAct || "none",
    speech: action.speech || "",
    slotId: action.slotId || "",
    causalParentImpactId: action.causalParentImpactId || "",
  };
}

const failures = [];

function expectContract(condition, label, evidence = {}) {
  if (!condition) failures.push({ label, evidence });
}

// A. maxSteps is a normal-action budget, not permission to cut an adjacent
// question from its answer. A question opened on the last ordinary step gets a
// bounded same-slot response step.
const lastStepCalls = [];
const lastStepResult = await runTavernCausalScene(buildState(), sceneOptions({
  maxSteps: 1,
  async runAgent(input) {
    lastStepCalls.push({
      actorId: input.agent.id,
      slotId: input.scene.slotId,
      sourceActionId: input.activation?.sourceActionId || "",
    });
    if (input.agent.id === IDS.visitor) {
      const candidate = candidateForAffordance(input, `declare_visit_purpose:${VISIT_ID}`);
      assert.ok(candidate);
      return { decision: questionDecision(candidate.candidateId) };
    }
    if (input.agent.id === IDS.mother && input.activation?.sourceActionId) {
      const candidate = candidateForAffordance(input, `receive_guest:${VISIT_ID}`);
      assert.ok(candidate);
      return { decision: answerDecision(candidate.candidateId) };
    }
    return { decision: passDecision("这一刻没有形成可公开提交的回答。", responseCandidate(input, IDS.visitor)?.candidateId) };
  },
}));
const lastStep = replyEvidence(lastStepResult);

expectContract(
  Boolean(lastStep.question && lastStep.answer),
  "A1 maxSteps=1 时，最后一个普通 step 提问后仍必须获得一个 bounded 同时段回答 step",
  {
    stopReason: lastStepResult.stopReason,
    actions: (lastStepResult.actions || []).map((action) => ({ step: action.step, actorId: action.actorId, speechAct: action.speechAct, speech: action.speech })),
    calls: lastStepCalls,
  },
);
expectContract(
  Boolean(
    lastStep.question
    && lastStep.answer
    && lastStep.question.slotId === SLOT.slotId
    && lastStep.answer.slotId === SLOT.slotId
    && lastStep.parentImpact?.causedByActionId === lastStep.question.id
  ),
  "A2 同场回答必须保留对最后一步问题的直接因果来源，不能到下一时段再接话",
  {
    question: compactAction(lastStep.question),
    answer: compactAction(lastStep.answer),
    parentImpact: lastStep.parentImpact ? { id: lastStep.parentImpact.id, causedByActionId: lastStep.parentImpact.causedByActionId } : null,
  },
);

// B. An invisible pass is not an answer and must not consume the directed
// question impact. Give the responder one bounded retry in the same slot.
let responderAttempts = 0;
const retryCalls = [];
const retryResult = await runTavernCausalScene(buildState(), sceneOptions({
  maxSteps: 2,
  async runAgent(input) {
    retryCalls.push({
      actorId: input.agent.id,
      slotId: input.scene.slotId,
      sourceActionId: input.activation?.sourceActionId || "",
    });
    if (input.agent.id === IDS.visitor) {
      const candidate = candidateForAffordance(input, `declare_visit_purpose:${VISIT_ID}`);
      assert.ok(candidate);
      return { decision: questionDecision(candidate.candidateId) };
    }
    if (input.agent.id === IDS.mother && input.activation?.sourceActionId) {
      responderAttempts += 1;
      const answerCandidate = candidateForAffordance(input, `receive_guest:${VISIT_ID}`);
      const withheld = responseCandidate(input, IDS.visitor);
      assert.ok(answerCandidate && withheld);
      return { decision: responderAttempts === 1
        ? passDecision("第一次没有形成合格的公开回答。", withheld.candidateId)
        : answerDecision(answerCandidate.candidateId) };
    }
    return { decision: passDecision("这一刻没有形成可公开提交的回答。", responseCandidate(input, IDS.visitor)?.candidateId) };
  },
}));
const retried = replyEvidence(retryResult);

expectContract(
  responderAttempts === 2 && Boolean(retried.answer),
  "B1 被问者第一次 pass 不能吞掉问题；必须在同一时段获得一次 bounded retry 并提交回答",
  {
    responderAttempts,
    stopReason: retryResult.stopReason,
    calls: retryCalls,
    actions: (retryResult.actions || []).map((action) => ({ step: action.step, actorId: action.actorId, speechAct: action.speechAct, speech: action.speech })),
  },
);
expectContract(
  Boolean(retried.question && retried.answer && retried.parentImpact?.causedByActionId === retried.question.id),
  "B2 bounded retry 后的回答仍必须承接原问题，而不是生成无来源的新话轮",
  {
    question: compactAction(retried.question),
    answer: compactAction(retried.answer),
    parentImpact: retried.parentImpact ? { id: retried.parentImpact.id, causedByActionId: retried.parentImpact.causedByActionId } : null,
  },
);

// C. If the bounded window is exhausted without a public answer/refusal/defer,
// the scene must expose the unresolved local request as assertable state. It may
// be a dedicated result field or an awaiting/unresolved request lock.
const unresolvedResult = await runTavernCausalScene(buildState(), sceneOptions({
  maxSteps: 2,
  async runAgent(input) {
    if (input.agent.id === IDS.visitor) {
      const candidate = candidateForAffordance(input, `declare_visit_purpose:${VISIT_ID}`);
      assert.ok(candidate);
      return { decision: questionDecision(candidate.candidateId) };
    }
    return { decision: passDecision("不生成回答，用来验证未决请求必须显式返回。", responseCandidate(input, IDS.visitor)?.candidateId) };
  },
}));
const unresolved = unresolvedRequests(unresolvedResult);
const unresolvedQuestion = (unresolvedResult.actions || []).find((action) => action.speech === QUESTION) || null;
const matchingUnresolved = unresolved.find((request) => (
  request.requesterId === IDS.visitor
  && request.responderId === IDS.mother
  && (!unresolvedQuestion || request.latestActionId === unresolvedQuestion.id)
));

expectContract(
  Boolean(matchingUnresolved),
  "C scene 必须返回可断言的 unresolved local request，不能让 period 在不知道仍有人被问的情况下推进",
  {
    unresolvedRequests: unresolved,
    requestLocks: unresolvedResult.sceneRuntime?.requestLocks || [],
    actions: (unresolvedResult.actions || []).map(compactAction),
    stopReason: unresolvedResult.stopReason,
  },
);

assert.equal(
  failures.length,
  0,
  `Phase 59 continuity RED failed:\n${failures.map((failure, index) => `${index + 1}. ${failure.label}\n${JSON.stringify(failure.evidence, null, 2)}`).join("\n")}`,
);

console.log("tavernPhase59Continuity:test passed", {
  lastStepActions: lastStepResult.actions.length,
  boundedRetryAttempts: responderAttempts,
  unresolvedRequests: unresolved.length,
});
