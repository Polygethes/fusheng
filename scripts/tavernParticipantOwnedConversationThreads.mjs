import assert from "node:assert/strict";

import { playTavernCausalSceneWithRunners } from "../src/server/pipeline/openaiPipeline.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";


// This project ships no default model. A contract that drives the real-model
// pipeline must name the model it is pretending to call.
process.env.CHARACTER_TOWN_MODEL ||= "contract-test-model";

const XIE = "char_xyy_xiezenshi";
const ZHOU = "char_xyy_zhoumin";
const THREAD = "thread_participant_owned_recommendation";
const ZHOU_REQUEST = "turn_zhou_requests_recommendation";

function buildState() {
  const state = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  state.ui.timeGrain = "scene";
  state.ui.engineMode = "openai";
  state.tavernState.activeVisits = [];
  for (const character of state.characters) {
    const present = [XIE, ZHOU].includes(character.id);
    character.lifeState.present = present;
    if (!present) continue;
    character.currentLocationId = "loc_xyy_tavern";
    character.ecologyState.presence.locationId = "loc_xyy_tavern";
    character.ecologyState.presence.observableAtStage = true;
  }
  state.tavernState.eventThreads = [{
    id: THREAD,
    topic: "举荐答复",
    stake: "周珉想知道谢真石是否愿意举荐自己参加内门考核",
    participantIds: [ZHOU, XIE],
    participantStates: {
      [ZHOU]: {
        schemaVersion: 1,
        threadId: THREAD,
        characterId: ZHOU,
        processingStatus: "appraised",
        perceivedDisposition: "new_request",
        satisfaction: "unsatisfied",
        responseNeed: "high",
        selfClosure: "open",
        lastReceivedTurnId: "",
        lastAppraisedTurnId: ZHOU_REQUEST,
        lastSpokenTurnId: ZHOU_REQUEST,
        outgoingDisposition: "open_new",
        pressure: 0.82,
        summary: "我已经当面问了，正在等真石自己的答复。",
        authority: "character-agent",
      },
      [XIE]: {
        schemaVersion: 1,
        threadId: THREAD,
        characterId: XIE,
        processingStatus: "remembered_unappraised",
        perceivedDisposition: "unclear",
        satisfaction: "uncertain",
        responseNeed: "medium",
        selfClosure: "open",
        lastReceivedTurnId: ZHOU_REQUEST,
        lastAppraisedTurnId: "",
        lastSpokenTurnId: "",
        outgoingDisposition: "none",
        pressure: 0.55,
        summary: "",
        authority: "awaiting-character-agent-appraisal",
      },
    },
    status: "open",
    nextObligationCharacterId: XIE,
    openedDay: 1,
    openedSlot: "dusk",
    turns: [{
      turnId: ZHOU_REQUEST,
      speakerId: ZHOU,
      addresseeId: XIE,
      line: "真石，举荐的事，你肯还是不肯？",
      action: "ask",
      day: 1,
      slotId: "dusk",
      slotLabel: "黄昏",
    }],
  }];
  return state;
}

function feasibleCandidate(input, targetId = "") {
  return input.privateActionCandidates.find((candidate) => candidate.feasible && (!targetId || candidate.targetCharacterId === targetId))
    || input.privateActionCandidates.find((candidate) => candidate.feasible);
}

function threadAppraisal({ sourceTurnId, interpretation, satisfaction, responseNeed, selfClosure, summary }) {
  return {
    noticedEvidenceIds: [],
    interpretations: [],
    beliefOperations: [],
    threadAppraisals: [{
      threadId: THREAD,
      sourceTurnId,
      interpretation,
      satisfaction,
      responseNeed,
      selfClosure,
      summary,
    }],
  };
}

function silentAppraisalDecision(input, appraisal) {
  const candidate = feasibleCandidate(input);
  assert.ok(candidate, "an appraising participant still needs an owned feasible candidate");
  return {
    candidateId: candidate.candidateId,
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
    decisionValue: "none",
    cognitiveAppraisal: appraisal,
    communicationPlan: {
      goal: "none",
      tactic: "silence",
      disclosure: "withhold",
      epistemicRelation: "not_applicable",
      intendedAudienceCharacterIds: [],
      desiredEffect: "",
      threadDisposition: "none",
    },
    privateReason: "先在心里判断这句话是否真的回答了我。",
  };
}

function xieAnswerDecision(input) {
  const candidate = feasibleCandidate(input, ZHOU);
  assert.ok(candidate);
  return {
    candidateId: candidate.candidateId,
    actionType: "speak",
    speechAct: "answer",
    targetCharacterId: ZHOU,
    speech: "好，我替你递这封举荐信。能不能过，还得看长老。",
    visibleAction: "谢真石看了周珉一会儿，终于点头",
    moveToZoneId: "",
    affordanceId: "",
    informationSourceImpactId: "",
    commitmentAction: "none",
    commitmentTopic: "举荐答复",
    decisionValue: "accept",
    cognitiveAppraisal: threadAppraisal({
      sourceTurnId: ZHOU_REQUEST,
      interpretation: "new_request",
      satisfaction: "not_applicable",
      responseNeed: "medium",
      selfClosure: "open",
      summary: "周珉要我本人决定是否举荐他。",
    }),
    communicationPlan: {
      goal: "inform",
      tactic: "direct",
      disclosure: "full",
      epistemicRelation: "believes",
      intendedAudienceCharacterIds: [ZHOU],
      desiredEffect: "把自己的决定直接告诉周珉",
      threadDisposition: "settle",
    },
    privateReason: "这是我的举荐决定，可以答应，但不能替长老保证考核结果。",
  };
}

let xieInput = null;
const first = await playTavernCausalSceneWithRunners(buildState(), {
  characterAgentProtocolVersion: 1,
  allowOrphanVisitors: true,
  characterIds: [XIE, ZHOU],
  positions: { [XIE]: "hall", [ZHOU]: "hall" },
  slotContext: { day: 1, slotId: "dusk", slotLabel: "黄昏" },
  maxSteps: 1,
  minimumActivationScore: 0,
  runners: {
    async runTavernCausalAgent(input) {
      xieInput = structuredClone(input);
      assert.equal(input.agent.id, XIE);
      return { decision: xieAnswerDecision(input) };
    },
  },
});

assert.ok(xieInput.openConversationThreads[0]?.myState, "the Agent should receive only its own thread state");
assert.equal(Object.hasOwn(xieInput.openConversationThreads[0], "participantStates"), false);
const firstThread = first.updateBundle.tavernState.eventThreads.find((thread) => thread.id === THREAD);
assert.equal(firstThread.participantStates[XIE].selfClosure, "closed_for_self", "the speaker may close the thread for himself");
assert.equal(firstThread.participantStates[ZHOU].processingStatus, "awaiting_delivery", "physical propagation alone must not become Zhou's conscious uptake or verdict");
assert.equal(firstThread.participantStates[ZHOU].satisfaction, "unsatisfied", "the speaker cannot overwrite Zhou's satisfaction");
assert.equal(firstThread.status, "open", "a speaker-side settle must not close a shared thread");
assert.equal(firstThread.nextObligationCharacterId, ZHOU);
assert.equal(JSON.stringify(first.causalScene.sceneRuntime).includes("participantThreadStates"), false, "participant-private states must not leak into the public scene runtime");
assert.equal(JSON.stringify(first.causalScene.sceneRuntime).includes("threadAppraisals"), false, "private thread appraisals must not leak into the public scene runtime");

async function runZhouAppraisal({ interpretation, satisfaction, responseNeed, selfClosure, summary }) {
  let zhouInput = null;
  const draft = await playTavernCausalSceneWithRunners(buildState(), {
    characterAgentProtocolVersion: 1,
    allowOrphanVisitors: true,
    characterIds: [XIE, ZHOU],
    positions: { [XIE]: "hall", [ZHOU]: "hall" },
    slotContext: { day: 1, slotId: "dusk-continuation", slotLabel: "黄昏" },
    maxSteps: 2,
    minimumActivationScore: 0,
    runners: {
      async runTavernCausalAgent(input) {
        if (input.agent.id === XIE) return { decision: xieAnswerDecision(input) };
        zhouInput = structuredClone(input);
        assert.equal(input.agent.id, ZHOU);
        const sourceTurnId = input.openConversationThreads[0]?.myState?.lastReceivedTurnId || "";
        assert.ok(sourceTurnId, "Zhou must appraise the turn he actually noticed in this causal scene");
        return { decision: silentAppraisalDecision(input, threadAppraisal({
          sourceTurnId,
          interpretation,
          satisfaction,
          responseNeed,
          selfClosure,
          summary,
        })) };
      },
    },
  });
  assert.ok(zhouInput, "direct addressed speech must give Zhou his own appraisal turn");
  assert.equal(zhouInput.openConversationThreads[0].myState.processingStatus, "received_unappraised");
  return draft.updateBundle.tavernState.eventThreads.find((thread) => thread.id === THREAD);
}

const dissatisfied = await runZhouAppraisal({
  interpretation: "evaded",
  satisfaction: "unsatisfied",
  responseNeed: "high",
  selfClosure: "open",
  summary: "他说愿意递信，却没有解释为何拖到现在；我还想追问。",
});
assert.equal(dissatisfied.status, "open");
assert.equal(dissatisfied.nextObligationCharacterId, ZHOU);
assert.equal(dissatisfied.participantStates[ZHOU].perceivedDisposition, "evaded");

const satisfied = await runZhouAppraisal({
  interpretation: "answered",
  satisfaction: "satisfied",
  responseNeed: "none",
  selfClosure: "closed_for_self",
  summary: "他答应递信，也说清考核仍由长老决定；这件事对我已经有了准话。",
});
assert.equal(satisfied.participantStates[ZHOU].perceivedDisposition, "answered");
assert.equal(satisfied.participantStates[ZHOU].selfClosure, "closed_for_self");
assert.equal(satisfied.status, "resolved", "only compatible participant-owned closures may resolve the shared thread");
assert.equal(satisfied.nextObligationCharacterId, "");

console.log("tavernParticipantOwnedConversationThreads:test passed", {
  afterAnswer: {
    status: firstThread.status,
    xieClosure: firstThread.participantStates[XIE].selfClosure,
    zhouProcessing: firstThread.participantStates[ZHOU].processingStatus,
  },
  divergentAppraisal: {
    status: dissatisfied.status,
    zhouInterpretation: dissatisfied.participantStates[ZHOU].perceivedDisposition,
  },
  compatibleClosure: {
    status: satisfied.status,
    zhouInterpretation: satisfied.participantStates[ZHOU].perceivedDisposition,
  },
});
