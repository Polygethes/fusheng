import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createInitialEcologyState } from "../src/server/ecology/tavernEcologyState.mjs";
import { runTavernCausalScene } from "../src/server/pipeline/tavernCausalScene.mjs";

const IDS = {
  mother: "char_xyy_xiemu",
  father: "char_xyy_xieheng",
  son: "char_xyy_xiezenshi",
  guest: "char_xyy_luozhao",
  zhou: "char_xyy_zhoumin",
};

function buildState() {
  const state = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  state.ui.timeGrain = "scene";
  state.ui.engineMode = "openai";
  return state;
}

function character(state, id) {
  return state.characters.find((item) => item.id === id);
}

function patchState(state, result) {
  const next = structuredClone(state);
  next.tavernState = structuredClone(result.tavernState);
  for (const patch of result.characterPatches) {
    const target = character(next, patch.id);
    Object.assign(target, structuredClone(patch), {
      lifeState: { ...target.lifeState, ...structuredClone(patch.lifeState) },
    });
  }
  return next;
}

function ecologySnapshot(state, characterIds) {
  return Object.fromEntries(characterIds.map((id) => {
    const ecology = character(state, id).ecologyState;
    return [id, {
      affect: structuredClone(ecology.affect),
      perceivedEventIds: [...ecology.attention.perceivedEventIds],
    }];
  }));
}

// 1 + 3: a speech and its visible gesture are one perceived event, while an
// occluded non-participant still advances to the scene end without learning it.
const actionState = buildState();
const guestBefore = structuredClone(character(actionState, IDS.guest).ecologyState);
let actionInput = null;
const actionResult = await runTavernCausalScene(actionState, {
  allowOrphanVisitors: true,
  characterIds: [IDS.mother, IDS.father, IDS.guest],
  positions: {
    [IDS.mother]: "hall",
    [IDS.father]: "hall",
    [IDS.guest]: "guest_room",
  },
  seedImpacts: [{
    id: "phase57:father-asks-mother",
    sourceCharacterId: IDS.father,
    sourceZoneId: "hall",
    type: "speech",
    modality: "sound",
    intensity: 96,
    radius: 2.5,
    directedTargetId: IDS.mother,
    content: "他娘，账已经对完了吗？",
    topic: "核对账目",
    speechAct: "ask",
  }],
  maxSteps: 2,
  minimumActivationScore: 0,
  async runAgent(input) {
    if (input.agent.id !== IDS.mother) {
      const quietCandidate = input.privateActionCandidates.find((row) => row.feasible && !row.realization?.affordanceId)
        || input.privateActionCandidates.find((row) => row.feasible);
      return { decision: {
        candidateId: quietCandidate?.candidateId || "",
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
        privateReason: "先感知并评估刚收到的回答，不另起行动。",
      } };
    }
    actionInput = structuredClone(input);
    assert.equal(input.agent.id, IDS.mother, "the directly addressed manager must act first");
    const candidate = input.privateActionCandidates.find((row) => (
      row.feasible && row.targetCharacterId === IDS.father && row.actionKind === "respond_to_impact"
    ));
    assert.ok(candidate);
    return { decision: {
      candidateId: candidate.candidateId,
      actionType: "speak",
      speechAct: "inform",
      targetCharacterId: IDS.father,
      speech: "当家的，账已经对完了。",
      visibleAction: "谢母把账本合上，抬头看向谢恒。",
      moveToZoneId: "",
      affordanceId: "",
      informationSourceImpactId: "",
      commitmentAction: "none",
      commitmentTopic: "核对账目",
      privateReason: "账目已经核清，直接回答当家的并交代下一步。",
    } };
  },
});

assert.ok(actionInput, "the controlled character Agent must run");
assert.equal(actionResult.actions.length, 1);
const groupedAction = actionResult.actions[0];
const speechImpact = groupedAction.impactFactors.find((impact) => impact.type === "speech");
const visibleImpact = groupedAction.impactFactors.find((impact) => impact.type === "physical");
assert.ok(speechImpact && visibleImpact, "one action must emit both speech and visible factors");
const fatherActionDeliveries = groupedAction.deliveries.filter((delivery) => delivery.recipientId === IDS.father);
assert.ok(fatherActionDeliveries.some((delivery) => delivery.impactId === speechImpact.id));
assert.ok(fatherActionDeliveries.some((delivery) => delivery.impactId === visibleImpact.id));

const fatherActionAppraisals = actionResult.privateSceneRuntime.eventAppraisals.filter((entry) => (
  entry.recipientId === IDS.father && entry.impactId === `action_event:${groupedAction.id}`
));
assert.equal(fatherActionAppraisals.length, 1, "speech and visible factors from one action must be appraised once per recipient");
const noticedFatherDeliveries = fatherActionDeliveries.filter((delivery) => delivery.noticeStatus === "noticed");
assert.ok(noticedFatherDeliveries.length > 0, "the recipient must notice at least one sensory factor before appraising the action");
assert.deepEqual(
  new Set(fatherActionAppraisals[0].sourceImpactIds),
  new Set(noticedFatherDeliveries.map((delivery) => delivery.impactId)),
  "the single appraisal must retain every factor the recipient actually noticed, without pretending unattended signals were perceived",
);
assert.equal(
  fatherActionAppraisals.filter((entry) => entry.impactId === `action_event:${groupedAction.id}`).length,
  1,
  "all noticed factors from the same action must be folded into one event appraisal",
);

assert.equal(actionResult.actions.some((action) => action.actorId === IDS.guest), false);
assert.equal(actionResult.deliveries.some((delivery) => delivery.recipientId === IDS.guest), false);
const guestAfter = actionResult.characterPatches.find((patch) => patch.id === IDS.guest).ecologyState;
assert.equal(
  guestAfter.elapsedSeconds,
  guestBefore.elapsedSeconds + actionResult.privateSceneRuntime.elapsedSeconds,
  "an inactive, untouched character still advances to the common scene end",
);
assert.deepEqual(
  guestAfter.attention.perceivedEventIds,
  guestBefore.attention.perceivedEventIds,
  "advancing the clock alone must not invent a perceived event",
);

// 2: unchanged visit and thread seeds must keep stable ids across scene runs;
// persisted perceived-event keys prevent a second affect appraisal.
const repeatState = buildState();
for (const id of [IDS.mother, IDS.father, IDS.zhou]) character(repeatState, id).lifeState.present = true;
repeatState.tavernState.activeVisits = [{
  id: "phase57_visit_waiting_zhou",
  visitorId: IDS.zhou,
  visitorName: "周珉",
  situationalRole: "送药兼等答复的熟客",
  purpose: "交药后等谢家回应举荐一事",
  kind: "delivery_and_request",
  expectedHostIds: [IDS.mother],
  requestedService: "receive_delivery",
  paymentMode: "none",
  completionCondition: "药包交清且举荐请求得到回应",
  stage: "waiting",
  hostId: "",
}];
repeatState.tavernState.eventThreads = [{
  id: "phase57_thread_ledger_reply",
  topic: "账目答复",
  participantIds: [IDS.zhou, IDS.father],
  status: "open",
  nextObligationCharacterId: IDS.father,
  turns: [{
    turnId: "phase57_turn_zhou_asks",
    speakerId: IDS.zhou,
    addresseeId: IDS.father,
    line: "谢叔，药包和清单都在这里，劳烦您核一下。",
  }],
}];

const repeatOptions = {
  characterIds: [IDS.mother, IDS.father, IDS.zhou],
  positions: {
    [IDS.mother]: "counter",
    [IDS.father]: "hall",
    [IDS.zhou]: "hall",
  },
  maxSteps: 6,
  minimumActivationScore: 0,
  async runAgent(input) {
    const quietCandidate = input.privateActionCandidates.find((row) => row.feasible && !row.realization?.affordanceId)
      || input.privateActionCandidates.find((row) => row.feasible);
    return { decision: {
      candidateId: quietCandidate?.candidateId || "",
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
      privateReason: "只完成本人对稳定来访事实的注意与评价，不采取外在行动。",
    } };
  },
};

const repeatFirst = await runTavernCausalScene(repeatState, repeatOptions);
const firstSeedIds = repeatFirst.impacts
  .filter((impact) => impact.id.startsWith("impact_visit:") || impact.id.startsWith("impact_thread:"))
  .map((impact) => impact.id)
  .sort();
assert.equal(firstSeedIds.length, 2, "the unchanged visit and open thread must each seed one event key");
assert.equal(repeatFirst.actions.length, 0, "private perception and appraisal must not manufacture an outward action");
assert.ok(repeatFirst.privateSceneRuntime.eventAppraisals.length > 0, "the first private Agent turns must appraise the stable seed events");

const persistedRepeatState = patchState(repeatState, repeatFirst);
const beforeRepeatSecond = ecologySnapshot(persistedRepeatState, repeatOptions.characterIds);
const repeatSecond = await runTavernCausalScene(persistedRepeatState, repeatOptions);
const secondSeedIds = repeatSecond.impacts
  .filter((impact) => impact.id.startsWith("impact_visit:") || impact.id.startsWith("impact_thread:"))
  .map((impact) => impact.id)
  .sort();
assert.deepEqual(secondSeedIds, firstSeedIds, "unchanged visit and thread facts must produce stable event keys");
assert.equal(
  repeatSecond.privateSceneRuntime.eventAppraisals.length,
  0,
  "the second scene must recognize both event keys as already appraised",
);
const afterRepeatSecond = Object.fromEntries(repeatSecond.characterPatches.map((patch) => [patch.id, {
  affect: structuredClone(patch.ecologyState.affect),
  perceivedEventIds: [...patch.ecologyState.attention.perceivedEventIds],
}]));
for (const id of repeatOptions.characterIds) {
  assert.ok(
    Object.values(afterRepeatSecond[id].affect).every(Number.isFinite),
    `${id} affect may naturally decay as time advances, but it must remain a valid state`,
  );
  assert.deepEqual(
    afterRepeatSecond[id].perceivedEventIds,
    beforeRepeatSecond[id].perceivedEventIds,
    `${id} must not append duplicate perceived-event ids`,
  );
}

// 4: a weak delivered signal may remain below the character's attention
// threshold while an intrinsic desire wins. It must not be promoted into
// perceived input or leak into activation and observer motivation.
const intrinsicState = buildState();
const sonEcology = createInitialEcologyState(IDS.son, {
  locationId: "loc_xyy_tavern",
  zoneId: "后院",
  observableAtStage: true,
  body: { energy: 0.95, stamina: 0.95, fatigue: 0.03, exertion: 0.02 },
});
for (const desire of Object.values(sonEcology.desires)) {
  desire.strength = 0;
  desire.satisfaction = 0;
  desire.frustration = 0;
}
sonEcology.desires.desire_xiezenshi_regain_calm_when_overwhelmed.strength = 1;
sonEcology.desires.desire_xiezenshi_regain_calm_when_overwhelmed.frustration = 1;
character(intrinsicState, IDS.son).ecologyState = sonEcology;
character(intrinsicState, IDS.son).lifeState.present = true;
let intrinsicInput = null;
const intrinsicResult = await runTavernCausalScene(intrinsicState, {
  characterIds: [IDS.son],
  positions: { [IDS.son]: "courtyard" },
  seedImpacts: [{
    id: "phase57:unselected-dust-cue",
    sourceCharacterId: "world:roof-dust",
    sourceZoneId: "courtyard",
    type: "physical",
    modality: "visual",
    intensity: 12,
    radius: 0,
    content: "院角落下一点浮灰。",
    topic: "无关紧要的浮灰",
  }],
  maxSteps: 1,
  minimumActivationScore: 0,
  async runAgent(input) {
    intrinsicInput = structuredClone(input);
    assert.equal(input.agent.id, IDS.son);
    assert.equal(
      input.perceivedImpacts.some((impact) => impact.impactId === "phase57:unselected-dust-cue"),
      false,
      "delivery alone must not pretend that a weak cue crossed this character's attention threshold",
    );
    const candidate = input.privateActionCandidates.find((row) => (
      row.feasible && row.driveId === "desire_xiezenshi_regain_calm_when_overwhelmed"
    ));
    assert.ok(candidate, "the strong personal regulation desire must remain a feasible choice beside the weak dust cue");
    return { decision: {
      candidateId: candidate.candidateId,
      actionType: "act",
      speechAct: "none",
      targetCharacterId: "",
      speech: "",
      visibleAction: "谢真石背过院角的浮灰，放慢呼吸，把手从剑柄上松开。",
      moveToZoneId: "",
      affordanceId: "",
      informationSourceImpactId: "",
      commitmentAction: "none",
      commitmentTopic: "恢复安静与判断",
      privateReason: "眼下需要先让身体和思绪重新落稳，院角那点浮灰并不重要。",
    } };
  },
});

assert.ok(intrinsicInput, "the intrinsic Agent input must be captured");
assert.equal(intrinsicResult.decisions.length, 1);
assert.equal(intrinsicResult.decisions[0].sourceImpactId, "", "the selected intrinsic action must have no causal source impact");
const intrinsicTrigger = intrinsicResult.decisions[0].observerPsychology.trigger;
assert.equal(intrinsicTrigger.impactId, "", "observer motivation must not borrow an unselected impact id");
assert.equal(intrinsicTrigger.sourceCharacterId, "self");
assert.equal(intrinsicTrigger.type, "intrinsic");
assert.equal(intrinsicTrigger.modality, "internal");
assert.equal(intrinsicTrigger.directed, false);

console.log("tavernPhase57CausalBoundaries:test passed", {
  groupedActionEvent: fatherActionAppraisals[0].impactId,
  groupedSourceImpactIds: fatherActionAppraisals[0].sourceImpactIds,
  untouchedCharacterElapsedSeconds: guestAfter.elapsedSeconds,
  stableSeedIds: firstSeedIds,
  intrinsicActionKind: intrinsicInput.privateActionCandidates.find((candidate) => candidate.candidateId === intrinsicResult.decisions[0].candidateId)?.actionKind,
});
