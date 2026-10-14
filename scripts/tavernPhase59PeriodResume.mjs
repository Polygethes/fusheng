import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createInitialEcologyState } from "../src/server/ecology/tavernEcologyState.mjs";
import { playModelPeriodWithRunners } from "../src/server/pipeline/openaiPipeline.mjs";

const IDS = {
  father: "char_xyy_xieheng",
  son: "char_xyy_xiezenshi",
};

const NOON_SLOT_ID = "day-1-noon";
const TOPIC = "谢真石";
const QUESTION = "真石，今日柴劈完还练不练？";
const ANSWER = "爹，柴劈完，我还练剑。";

function buildState() {
  const state = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  state.ui.timeGrain = "day";
  state.ui.engineMode = "openai";
  state.ui.setupCompleted = true;
  // This contract isolates the macro clock from hospitality scheduling. A
  // separate suite covers visitor arrivals; here a real two-person request is
  // the only reason noon may remain open.
  for (const character of state.characters) {
    if (![IDS.father, IDS.son].includes(character.id)) {
      character.lifeProfile.schedule = [];
      character.lifeState.present = false;
      if (character.lifeProfile?.tavernAgency?.visitPolicy) {
        character.lifeProfile.tavernAgency.visitPolicy.availableWindows = [];
      }
      if (character.lifeState.visitIntention) {
        character.lifeState.visitIntention.status = "completed";
        character.lifeState.visitIntention.activeVisitId = "";
      }
    }
  }
  state.tavernState.activeVisits = [];
  const father = state.characters.find((character) => character.id === IDS.father);
  father.ecologyState = createInitialEcologyState(IDS.father, {
    locationId: "loc_xyy_tavern",
    zoneId: "courtyard",
    observableAtStage: true,
  });
  father.ecologyState.desires.desire_xieheng_secure_medicine_fund.strength = 0;
  father.ecologyState.desires.desire_xieheng_secure_medicine_fund.satisfaction = 1;
  father.ecologyState.desires.desire_xieheng_hear_sons_choice.strength = 1;
  father.ecologyState.desires.desire_xieheng_hear_sons_choice.frustration = 1;
  return state;
}

function passDecision(reason = "这一次不形成可公开提交的回答。", candidateId = "") {
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
    targetCharacterId: IDS.son,
    speech: QUESTION,
    vocalMode: "call_out",
    visibleAction: "",
    moveToZoneId: "",
    affordanceId: "",
    informationSourceImpactId: "",
    commitmentAction: "open",
    commitmentTopic: TOPIC,
    privateReason: "他想听见儿子本人决定是否继续练剑，而不是替儿子把答案写好。",
  };
}

function answerDecision(candidateId) {
  return {
    candidateId,
    actionType: "speak",
    speechAct: "answer",
    speechFunctions: ["answer", "inform"],
    targetCharacterId: IDS.father,
    speech: ANSWER,
    vocalMode: "call_out",
    visibleAction: "",
    moveToZoneId: "",
    affordanceId: "",
    informationSourceImpactId: "",
    commitmentAction: "none",
    commitmentTopic: TOPIC,
    communicationPlan: {
      goal: "inform",
      tactic: "direct",
      disclosure: "full",
      epistemicRelation: "believes",
      intendedAudienceCharacterIds: [IDS.father],
      desiredEffect: "明确回答父亲刚才的问题",
      threadDisposition: "settle",
    },
    privateReason: "父亲正在等他的明确回答；他要说清自己的选择，也说出明早怎样继续。",
  };
}

function satisfiedListenerPass(input) {
  const thread = input.openConversationThreads.find((item) => (
    item.myState?.processingStatus === "received_unappraised"
  ));
  if (!thread) return null;
  const sourceTurnId = thread.turns?.at(-1)?.id || thread.myState?.lastReceivedTurnId || "";
  return {
    ...passDecision("他听见儿子的明确选择，决定不再追问。", candidateToward(input, IDS.son)?.candidateId),
    cognitiveAppraisal: {
      noticedEvidenceIds: [],
      interpretations: [],
      beliefOperations: [],
      threadAppraisals: [{
        threadId: thread.id,
        sourceTurnId,
        interpretation: "answered",
        satisfaction: "satisfied",
        responseNeed: "none",
        selfClosure: "closed_for_self",
        summary: "儿子已经明确说会继续练剑，这个问题对我有了答案。",
      }],
    },
    communicationPlan: {
      goal: "none",
      tactic: "silence",
      disclosure: "withhold",
      epistemicRelation: "not_applicable",
      intendedAudienceCharacterIds: [],
      desiredEffect: "",
      threadDisposition: "none",
    },
  };
}

function noonQuestionCue() {
  return {
    id: "phase59:noon-practice-choice-cue",
    sourceCharacterId: "world:phase59-practice-board",
    sourceZoneId: "courtyard",
    type: "physical",
    modality: "visual",
    intensity: 100,
    radius: 0,
    directedTargetId: IDS.father,
    content: "后院练剑木牌上仍留着谢真石今天尚未划掉的一道记号。",
    topic: TOPIC,
    speechAct: "none",
  };
}

function candidateToward(input, targetCharacterId) {
  return input.privateActionCandidates.find((candidate) => (
    candidate.feasible && candidate.targetCharacterId === targetCharacterId
  )) || input.privateActionCandidates.find((candidate) => (
    candidate.feasible && candidate.actionKind === "handle_environment_event"
  )) || input.privateActionCandidates.find((candidate) => candidate.feasible) || null;
}

function applyBundleToClone(state, updateBundle = {}) {
  const next = structuredClone(state);
  if (updateBundle.tavernState) next.tavernState = structuredClone(updateBundle.tavernState);

  const patches = new Map((updateBundle.characters || []).map((patch) => [patch.id, patch]));
  next.characters = (next.characters || []).map((character) => {
    const patch = patches.get(character.id);
    if (!patch) return character;
    return {
      ...character,
      ...(Object.hasOwn(patch, "currentLocationId") ? { currentLocationId: patch.currentLocationId } : {}),
      ...(Object.hasOwn(patch, "currentActivity") ? { currentActivity: structuredClone(patch.currentActivity) } : {}),
      ...(patch.lifeState ? { lifeState: { ...(character.lifeState || {}), ...structuredClone(patch.lifeState) } } : {}),
      ...(Object.hasOwn(patch, "ecologyState") ? { ecologyState: structuredClone(patch.ecologyState) } : {}),
    };
  });

  for (const shift of updateBundle.relationships || []) {
    const relationship = (next.relationships || []).find((entry) => (
      entry.fromCharacterId === shift.fromCharacterId
      && entry.toCharacterId === shift.toCharacterId
    ));
    if (!relationship) continue;
    for (const [metric, delta] of Object.entries(shift.deltas || {})) {
      if (!Number.isFinite(Number(relationship[metric]))) continue;
      relationship[metric] = Math.max(0, Math.min(100, Number(relationship[metric]) + Number(delta || 0)));
    }
  }
  return next;
}

const initial = buildState();
const initialDay = Number(initial.tavernState.day || 0);
const initialTick = Number(initial.tavernState.tick || 0);
let questionCommitted = false;

const blockedDraft = await playModelPeriodWithRunners(initial, {
  pipelineMode: "live",
  characterAgentProtocolVersion: 1,
  minimumActivationScore: 0,
  maxStepsPerSlot: 2,
  seedImpactsBySlot: { [NOON_SLOT_ID]: [noonQuestionCue()] },
  runners: {
    async runTavernCausalAgent(input) {
      if (
        input.scene.slotId === NOON_SLOT_ID
        && input.agent.id === IDS.father
        && !questionCommitted
      ) {
        const candidate = candidateToward(input, IDS.son);
        assert.ok(candidate, "the father must receive at least one selectable way to pursue the noon question");
        questionCommitted = true;
        return { decision: questionDecision(candidate.candidateId) };
      }
      const targetId = input.agent.id === IDS.son ? IDS.father : IDS.son;
      return { decision: passDecision("保留未决请求，用来验证宏观时钟必须停在正午。", candidateToward(input, targetId)?.candidateId) };
    },
  },
});

const blockedLabels = blockedDraft.periodSimulation.ticks.map((tick) => tick.label);
const blockedCursor = blockedDraft.updateBundle.tavernState.periodCursor;
const blockedQuestion = blockedDraft.causalScene.actions.find((action) => action.speech === QUESTION);

assert.equal(questionCommitted, true, "the noon cue must activate Xie Heng so he can open the controlled request");
assert.ok(blockedQuestion, `the controlled noon question must commit, got: ${JSON.stringify(blockedDraft.causalScene.actions, null, 2)}`);
assert.deepEqual(blockedLabels, ["清晨", "正午"], "dawn must complete before the unresolved noon interaction blocks the day");
assert.equal(blockedDraft.causalPeriod.blockedBy?.slotBaseId, "noon");
assert.equal(blockedDraft.causalScene.macroTimeAdvanced, false);
assert.equal(blockedDraft.updateBundle.tavernState.day, initialDay, "the blocked noon must not finish the day");
assert.equal(blockedDraft.updateBundle.tavernState.tick, initialTick + 1, "only the completed dawn may advance the tick");
assert.equal(blockedCursor?.status, "blocked", "the period update must persist an explicit blocked cursor");
assert.equal(blockedCursor?.day, initialDay + 1);
assert.equal(blockedCursor?.slotBaseId, "noon");
assert.equal(blockedCursor?.slotId, NOON_SLOT_ID);
assert.ok(blockedCursor?.blockedRequestIds?.length, "the cursor must retain the exact unresolved request ids");

const firstNoonTick = blockedDraft.periodSimulation.ticks.find((tick) => tick.slotId === NOON_SLOT_ID);
const firstNoonArrivals = [...(firstNoonTick?.arrivalCharacterIds || [])];
const resumeState = applyBundleToClone(initial, blockedDraft.updateBundle);
let answerCommitted = false;

const resumedDraft = await playModelPeriodWithRunners(resumeState, {
  pipelineMode: "live",
  characterAgentProtocolVersion: 1,
  minimumActivationScore: 0,
  maxStepsPerSlot: 2,
  // This must not be injected while resuming the blocked noon slot. If the
  // period restarts or replays the slot, the duplicate id exposes it.
  seedImpactsBySlot: { [NOON_SLOT_ID]: [noonQuestionCue()] },
  runners: {
    async runTavernCausalAgent(input) {
      if (
        input.scene.slotId === NOON_SLOT_ID
        && input.agent.id === IDS.son
        && !answerCommitted
      ) {
        const candidate = candidateToward(input, IDS.father);
        assert.ok(candidate, "the son must receive the persisted request as a selectable response candidate");
        answerCommitted = true;
        return { decision: answerDecision(candidate.candidateId) };
      }
      if (input.agent.id === IDS.father) {
        const appraisal = satisfiedListenerPass(input);
        if (appraisal) return { decision: appraisal };
      }
      const targetId = input.agent.id === IDS.son ? IDS.father : IDS.son;
      return { decision: passDecision("当前没有新的当面请求需要回答。", candidateToward(input, targetId)?.candidateId) };
    },
  },
});

const resumedLabels = resumedDraft.periodSimulation.ticks.map((tick) => tick.label);
const resumedFirstTick = resumedDraft.periodSimulation.ticks[0];
const resumedAnswer = resumedDraft.causalScene.actions.find((action) => action.speech === ANSWER);
const resumedNoonMacroTriggers = resumedDraft.causalScene.impacts.filter((impact) => (
  impact.slotId === NOON_SLOT_ID && impact.sourceCharacterId === "world:macro-noon"
));

assert.equal(answerCommitted, true, "the responder must receive and answer the persisted noon request");
assert.ok(resumedAnswer, `the responder's answer must commit, got: ${JSON.stringify(resumedFirstTick?.causalScene?.actions, null, 2)}`);
assert.equal(
  resumedDraft.causalPeriod.blockedBy,
  null,
  `the committed answer must release the persisted noon request instead of leaving it unresolved: ${JSON.stringify({
    blockedBy: resumedDraft.causalPeriod.blockedBy,
    resumedAnswer,
    persistedRequestLocks: resumedDraft.causalScene.sceneRuntime?.requestLocks,
  }, null, 2)}`,
);
assert.equal(resumedFirstTick?.slotId, NOON_SLOT_ID, "resume must start inside the same noon slot, never at dawn");
assert.deepEqual(resumedLabels, ["正午", "午后", "黄昏", "夜深"], "only the remainder of the blocked day may run");
assert.equal(resumedFirstTick?.arrivalCharacterIds?.length || 0, 0, `resuming noon must not repeat arrivals: ${JSON.stringify(firstNoonArrivals)}`);
assert.equal(resumedNoonMacroTriggers.length, 0, "resuming noon must not replay the noon macro trigger");
assert.equal(resumedDraft.updateBundle.tavernState.day, initialDay + 1, "the day may finish only after the resumed noon and later slots complete");
assert.equal(resumedDraft.updateBundle.tavernState.tick, initialTick + 5, "dawn plus the four resumed slots must advance exactly five ticks total");
assert.equal(resumedDraft.updateBundle.tavernState.periodCursor, null, "the cursor must clear after the blocked period completes");
assert.equal(resumedDraft.causalPeriod.blockedBy, null);
assert.equal(resumedDraft.causalScene.macroTimeAdvanced, true);

console.log("tavernPhase59PeriodResume:test passed", {
  blockedLabels,
  blockedAt: blockedCursor.slotId,
  firstNoonArrivals,
  resumedLabels,
  finalDay: resumedDraft.updateBundle.tavernState.day,
  finalTick: resumedDraft.updateBundle.tavernState.tick,
});
