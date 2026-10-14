import assert from "node:assert/strict";
import { validateEcologyState } from "../src/server/ecology/tavernEcologyState.mjs";
import { TAVERN_RECOMMENDATION_REQUEST_FRAME } from "../src/server/ecology/tavernEcologyProfile.mjs";
import { runTavernCausalScene } from "../src/server/pipeline/tavernCausalScene.mjs";
import { appraiseTavernAgentEcology } from "../src/server/pipeline/tavernEcologyRuntime.mjs";
import { playTavernCausalSceneWithRunners } from "../src/server/pipeline/openaiPipeline.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";


// This project ships no default model. A contract that drives the real-model
// pipeline must name the model it is pretending to call.
process.env.CHARACTER_TOWN_MODEL ||= "contract-test-model";

const ids = {
  son: "char_xyy_xiezenshi",
  father: "char_xyy_xieheng",
  mother: "char_xyy_xiemu",
  zhou: "char_xyy_zhoumin",
  luo: "char_xyy_luozhao",
};
const ZHOU_CORE_DESIRE = "desire_zhoumin_become_inner_court_disciple";
const ZHOU_RETIRED_STAGE_DESIRE = "desire_zhoumin_receive_recommendation_decision";

function buildFocusedState() {
  const state = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  for (const characterId of [ids.son, ids.father, ids.zhou]) {
    const character = state.characters.find((item) => item.id === characterId);
    character.lifeState.present = true;
    character.currentLocationId = "loc_xyy_tavern";
    character.ecologyState.presence.locationId = "loc_xyy_tavern";
    character.ecologyState.presence.observableAtStage = true;
  }
  return state;
}

function recommendationPressure() {
  return {
    sourceCharacterId: ids.zhou,
    sourceZoneId: "hall",
    type: "speech",
    modality: "sound",
    intensity: 90,
    radius: 3,
    directedTargetId: ids.son,
    content: "真石，我今晚想听你一句实在答复。",
    topic: "举荐答复",
    semanticFrame: structuredClone(TAVERN_RECOMMENDATION_REQUEST_FRAME),
  };
}

function chooseCandidate(input, { targetCharacterId = "", actionKind = "", affordanceId = "" } = {}) {
  const feasible = (input.privateActionCandidates || []).filter((candidate) => candidate.feasible);
  return feasible.find((candidate) => (
    (!targetCharacterId || candidate.targetCharacterId === targetCharacterId)
    && (!actionKind || candidate.actionKind === actionKind)
    && (!affordanceId || candidate.realization?.affordanceId === affordanceId)
  )) || feasible[0] || null;
}

const initial = buildFocusedState();
const luo = initial.characters.find((character) => character.id === ids.luo);
assert.notEqual(luo.currentLocationId, "loc_xyy_tavern", "a visitor must exist offstage before an actual arrival");
assert.equal(luo.ecologyState.presence.observableAtStage, false);
assert.ok(luo.ecologyProfileId && !Object.hasOwn(luo, "ecologyProfile"), "immutable profiles belong in the registry, not every snapshot");

const badInputs = [];
const rejected = await runTavernCausalScene(buildFocusedState(), {
  allowOrphanVisitors: true,
  characterIds: [ids.son, ids.zhou, ids.father],
  positions: { [ids.son]: "hall", [ids.zhou]: "hall", [ids.father]: "counter" },
  slotContext: { day: 1, slotId: "dusk", slotLabel: "黄昏" },
  seedImpacts: [recommendationPressure()],
  maxSteps: 1,
  minimumActivationScore: 0,
  async runAgent(input) {
    badInputs.push(structuredClone(input));
    const responseCandidate = input.privateActionCandidates.find((candidate) => (
      candidate.feasible && candidate.targetCharacterId === ids.zhou && candidate.actionKind === "respond_to_impact"
    ));
    assert.ok(responseCandidate);
    return { decision: {
      candidateId: responseCandidate.candidateId,
      actionType: "speak",
      speechAct: "answer",
      targetCharacterId: ids.father,
      speech: "爹，周珉的事我待会儿再说。",
      visibleAction: "谢真石转向谢恒，朝他点了点头",
      moveToZoneId: "",
      affordanceId: "",
      informationSourceImpactId: "",
      commitmentAction: "none",
      commitmentTopic: "",
      privateReason: "故意模拟模型把周珉、谢恒和称呼混在一起。",
    } };
  },
});

assert.equal(badInputs[0].agent.id, ids.son, "the directed impact must activate the actually affected Agent");
const badResponseCandidate = badInputs[0].privateActionCandidates.find((candidate) => candidate.actionKind === "respond_to_impact" && candidate.targetCharacterId === ids.zhou);
assert.equal(badInputs[0].choiceAuthority.owner, "character-agent");
assert.equal(Object.hasOwn(badInputs[0], "decisionMandate"), false);
assert.ok(Number.isFinite(badResponseCandidate.ownDecisionFactors.desirePressure.score));
assert.ok(Number.isFinite(badResponseCandidate.ownDecisionFactors.obstacleResistance.score));
const redirectedHardCodes = new Set(rejected.decisions[0].decision.semanticViolations.map((violation) => violation.code));
const redirectedClaimCodes = new Set(rejected.decisions[0].decision.claimAnnotations.map((violation) => violation.code));
assert.deepEqual([...redirectedHardCodes], [], "a person may redirect, misaddress, tease, or speak inconsistently without the world censoring the utterance");
assert.ok(redirectedClaimCodes.has("AGENT_CANDIDATE_TARGET_MISMATCH"), `the redirect must remain observable as a claim/intent mismatch: ${JSON.stringify([...redirectedClaimCodes])}`);
assert.equal(rejected.actions.length, 1, "the world records what the person actually said and did instead of replacing it with pass");
assert.equal(rejected.actions[0].targetCharacterId, ids.father, "the redirected public target remains the person the Agent actually chose");
const rejectedSonState = rejected.characterPatches.find((patch) => patch.id === ids.son).ecologyState;
assert.equal(validateEcologyState(rejectedSonState, ids.son).valid, true, "a transient impact must never become a new permanent desire id");

const validInputs = [];
const accepted = await runTavernCausalScene(buildFocusedState(), {
  allowOrphanVisitors: true,
  characterIds: [ids.son, ids.zhou, ids.father],
  positions: { [ids.son]: "hall", [ids.zhou]: "hall", [ids.father]: "counter" },
  slotContext: { day: 1, slotId: "dusk", slotLabel: "黄昏" },
  seedImpacts: [recommendationPressure()],
  maxSteps: 1,
  minimumActivationScore: 0,
  async runAgent(input) {
    validInputs.push(structuredClone(input));
    const responseCandidate = input.privateActionCandidates.find((candidate) => (
      candidate.feasible && candidate.targetCharacterId === ids.zhou && candidate.actionKind === "respond_to_impact"
    ));
    assert.ok(responseCandidate);
    return { decision: {
      candidateId: responseCandidate.candidateId,
      actionType: "speak",
      speechAct: "answer",
      targetCharacterId: ids.zhou,
      speech: "周珉，我答应这次举荐。",
      visibleAction: "谢真石停下手里的活，正面看向周珉",
      moveToZoneId: "",
      affordanceId: "",
      informationSourceImpactId: "",
      commitmentAction: "open",
      commitmentTopic: "举荐周珉参加内门考核",
      decisionValue: "accept",
      semanticFrameId: TAVERN_RECOMMENDATION_REQUEST_FRAME.id,
      semanticRoleBindings: structuredClone(TAVERN_RECOMMENDATION_REQUEST_FRAME.roles),
      privateReason: "拖延只会让这件事继续压在两个人身上，现在给出自己的决定。",
    } };
  },
});

assert.ok(validInputs[0].privateActionCandidates.some((candidate) => candidate.targetCharacterId === ids.zhou));
assert.equal(accepted.actions.length, 1);
assert.equal(accepted.actions[0].targetCharacterId, ids.zhou);
assert.equal(accepted.actions[0].speech, "周珉，我答应这次举荐。");
const sonState = accepted.characterPatches.find((patch) => patch.id === ids.son).ecologyState;
const zhouState = accepted.characterPatches.find((patch) => patch.id === ids.zhou).ecologyState;
assert.equal(Object.hasOwn(sonState.desires, "desire_xiezenshi_decide_recommendation"), false, "a social request must not be rewritten as the requested actor's core desire");
assert.ok(Object.values(sonState.desires).every((desire) => desire.satisfaction === 0), "agreeing to Zhou's request must not satisfy Xie Zhenshi's recovery, calm, or sword-observation desires");
assert.ok(zhouState.desires[ZHOU_CORE_DESIRE], "Zhou Min's live state must retain his self-owned inner-court desire");
assert.equal(Object.hasOwn(zhouState.desires, ZHOU_RETIRED_STAGE_DESIRE), false, "a request for one recommendation answer must not return as a second core desire");
assert.equal(zhouState.desires[ZHOU_CORE_DESIRE].satisfaction, 0,
  "receiving one recommendation promise is progress evidence, not confirmation that Zhou Min has already become an inner-court disciple");
assert.equal(accepted.actions[0].decisionTopicId, "recommendation");
assert.deepEqual(accepted.actions[0].semanticFrame.roles, TAVERN_RECOMMENDATION_REQUEST_FRAME.roles);
const recommendationCommitment = accepted.privateSceneRuntime.commitments.find((commitment) => (
  commitment.ownerId === ids.son
  && commitment.targetCharacterId === ids.zhou
  && commitment.topic === "举荐周珉参加内门考核"
));
assert.equal(recommendationCommitment?.status, "open", "an explicit acceptance creates Xie Zhenshi's own directional commitment");
assert.equal(accepted.privateSceneRuntime.requestLocks.some((lock) => (
  lock.requesterId === ids.son && lock.responderId === ids.zhou && lock.status === "awaiting"
)), false, "opening a promise must not create an answer-to-an-answer request");
assert.equal(validateEcologyState(sonState, ids.son).valid, true);
assert.equal(validateEcologyState(zhouState, ids.zhou).valid, true);

const threadedState = buildFocusedState();
threadedState.tavernState.eventThreads = [{
  id: "thread_recommendation_answer",
  topic: "举荐答复",
  stake: "周珉要得到谢真石本人的明确决定",
  participantIds: [ids.zhou, ids.son],
  status: "open",
  nextObligationCharacterId: ids.son,
  turns: [{
    turnId: "turn_zhou_ask",
    speakerId: ids.zhou,
    addresseeId: ids.son,
    line: "真石，举荐的事请你给我一个明确答复。",
  }],
}];
const threadedDraft = await playTavernCausalSceneWithRunners(threadedState, {
  characterAgentProtocolVersion: 1,
  allowOrphanVisitors: true,
  characterIds: [ids.son, ids.zhou, ids.father],
  positions: { [ids.son]: "hall", [ids.zhou]: "hall", [ids.father]: "counter" },
  slotContext: { day: 1, slotId: "dusk", slotLabel: "黄昏" },
  maxSteps: 1,
  minimumActivationScore: 0,
  runners: {
    async runTavernCausalAgent(input) {
      const candidate = chooseCandidate(input, { targetCharacterId: ids.zhou, actionKind: "respond_to_impact" });
      return { decision: {
        candidateId: candidate?.candidateId || "",
        actionType: "speak",
        speechAct: "inform",
        targetCharacterId: ids.zhou,
        speech: "周珉，我答应这次举荐。",
        visibleAction: "谢真石停下手里的活，正面看向周珉",
        moveToZoneId: "",
        affordanceId: "",
        informationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: "举荐答复",
        privateReason: "已经作出决定，现在直接告诉请求人。",
      } };
    },
  },
});
const resolvedThread = threadedDraft.updateBundle.tavernState.eventThreads.find((thread) => thread.id === "thread_recommendation_answer");
assert.equal(resolvedThread.participantStates[ids.son].selfClosure, "closed_for_self", "the speaker may settle his own side of the answer");
assert.equal(resolvedThread.participantStates[ids.zhou].processingStatus, "awaiting_delivery", "the answer must remain pending until Zhou's own attention takes it up");
assert.equal(resolvedThread.status, "open", "a verified delivery still cannot decide Zhou's satisfaction");
assert.equal(resolvedThread.nextObligationCharacterId, "", "a social response obligation begins only after Zhou actually notices and appraises the answer");

const courtesyState = buildFocusedState();
const courtesy = await runTavernCausalScene(courtesyState, {
  allowOrphanVisitors: true,
  characterIds: [ids.son, ids.zhou],
  positions: { [ids.son]: "hall", [ids.zhou]: "hall" },
  seedImpacts: [{
    sourceCharacterId: ids.zhou,
    sourceZoneId: "hall",
    type: "speech",
    modality: "sound",
    intensity: 82,
    radius: 2,
    directedTargetId: ids.son,
    content: "多谢你了。",
    topic: "致谢",
  }],
  maxSteps: 1,
  minimumActivationScore: 0,
  async runAgent(input) {
    const candidate = chooseCandidate(input, { targetCharacterId: ids.zhou, actionKind: "respond_to_impact" });
    return { decision: {
      candidateId: candidate?.candidateId || "",
      actionType: "speak",
      speechAct: "answer",
      targetCharacterId: ids.zhou,
      speech: "不必客气。",
      visibleAction: "",
      moveToZoneId: "",
      affordanceId: "",
      informationSourceImpactId: "",
      commitmentAction: "none",
      commitmentTopic: "致谢",
      privateReason: "故意探测礼貌确认是否会无穷回弹。",
    } };
  },
});
assert.equal(courtesy.actions.length, 1, "an Agent may freely answer gratitude instead of being silenced by a cadence rule");
assert.match(courtesy.actions[0].speech || "", /客气/u, "the Agent-authored courtesy answer must survive");
assert.equal(courtesy.privateSceneRuntime.requestLocks.some((lock) => (
  lock.requesterId === ids.son
  && lock.responderId === ids.zhou
  && lock.status === "awaiting"
)), false, "a courtesy answer must not manufacture a confirmation-of-confirmation obligation");

const zoneState = buildFocusedState();
const zoneCorrected = await runTavernCausalScene(zoneState, {
  allowOrphanVisitors: true,
  characterIds: [ids.father, ids.son],
  positions: { [ids.father]: "hall", [ids.son]: "courtyard" },
  seedImpacts: [{
    sourceCharacterId: "world:zone-probe",
    sourceZoneId: "hall",
    type: "physical",
    modality: "sound",
    intensity: 100,
    radius: 0,
    directedTargetId: ids.father,
    content: "后院有动静，需要有人过去查看。",
  }],
  maxSteps: 1,
  minimumActivationScore: 0,
  async runAgent(input) {
    const candidate = chooseCandidate(input);
    return { decision: {
      candidateId: candidate?.candidateId || "",
      actionType: "move",
      speechAct: "none",
      targetCharacterId: ids.son,
      speech: "",
      visibleAction: "谢恒从柜台起身，朝后院走去",
      moveToZoneId: "courtyard",
      affordanceId: "",
      informationSourceImpactId: "",
      commitmentAction: "none",
      commitmentTopic: "",
      privateReason: "故意探测动作起点与当前 zone 不一致。",
    } };
  },
});
assert.ok(zoneCorrected.decisions[0].decision.semanticViolations.some((violation) => violation.code === "VISIBLE_ACTION_SOURCE_ZONE_MISMATCH"));
assert.match(zoneCorrected.actions[0].visibleAction, /谢恒.*后院.*走去/u, "the resolved movement must retain its reachable destination");
assert.doesNotMatch(zoneCorrected.actions[0].visibleAction, /柜台/u, "the world must not publish the Agent's false source zone as an accomplished movement fact");

const stalledState = buildFocusedState();
const stalledMother = stalledState.characters.find((character) => character.id === ids.mother);
stalledMother.lifeState.present = true;
stalledMother.currentLocationId = "loc_xyy_tavern";
stalledMother.ecologyState.presence.locationId = "loc_xyy_tavern";
stalledMother.ecologyState.presence.observableAtStage = true;
const stalledPairActions = Array.from({ length: 6 }, (_, index) => ({
  id: `stalled_pair_${index + 1}`,
  actorId: index % 2 === 0 ? ids.father : ids.mother,
  targetCharacterId: index % 2 === 0 ? ids.mother : ids.father,
  speech: index % 2 === 0 ? `药钱我另想办法，这是第${index + 1}次说明。` : `我还是要把第${index + 1}次来路记清。`,
  speechAct: index % 2 === 0 ? "answer" : "ask",
  ecologyRuntimeSignature: index % 2 === 0
    ? `respond:${ids.mother}:回应刚刚直接抵达自己的言行`
    : `respond:${ids.father}:回应刚刚直接抵达自己的言行`,
}));
stalledPairActions.at(-2).speechAct = "ask";
stalledPairActions.at(-2).speech = "你还要继续追问这笔药钱吗？";
stalledPairActions.at(-1).causalParentImpactId = "impact_stalled_question";
const stalledAppraisal = appraiseTavernAgentEcology({
  character: stalledMother,
  runtime: {
    actions: stalledPairActions,
    commitments: [],
    elapsedSeconds: 180,
    macroDay: 1,
    macroTick: 1,
    slotContext: { slotId: "scene", slotLabel: "同一场" },
  },
  actor: { characterId: ids.mother, present: true, zoneId: "stove" },
  pendingImpacts: [{
    impactId: "impact_stalled_question",
    sourceCharacterId: ids.father,
    directedTargetId: ids.mother,
    directed: true,
    type: "speech",
    modality: "sound",
    impactScore: 88,
    content: "你还要继续追问这笔药钱吗？",
    topic: "药钱来路",
    provenance: { sourceActionId: stalledPairActions.at(-2).id },
  }],
  visibleCharacterIds: [ids.father],
  recentOwnActions: stalledPairActions.filter((action) => action.actorId === ids.mother),
});
const stalledResponse = stalledAppraisal.appraisal.candidates.find((candidate) => candidate.actionKind === "respond_to_impact");
assert.equal(stalledResponse.feasible, false, "six stagnant pair turns must hard-stop another same-scene reply");
assert.ok(stalledResponse.blockedBy.includes("same-scene-conversation-saturated"));

const duplicateState = buildFocusedState();
const duplicateMother = duplicateState.characters.find((character) => character.id === ids.mother);
duplicateMother.lifeState.present = true;
duplicateMother.currentLocationId = "loc_xyy_tavern";
duplicateMother.ecologyState.presence.locationId = "loc_xyy_tavern";
duplicateMother.ecologyState.presence.observableAtStage = true;
duplicateState.tavernState.eventThreads = [{
  id: "thread_private_ledger_probe",
  topic: "药钱来路",
  stake: "谢母想知道药钱从哪里来",
  participantIds: [ids.mother, ids.father],
  status: "open",
  nextObligationCharacterId: ids.father,
  turns: [{ turnId: "turn_mother_question", speakerId: ids.mother, addresseeId: ids.father, line: "药钱到底从哪里来？" }],
}];
const duplicateInputs = [];
const duplicateDialogue = await runTavernCausalScene(duplicateState, {
  allowOrphanVisitors: true,
  characterIds: [ids.mother, ids.father],
  positions: { [ids.mother]: "hall", [ids.father]: "hall" },
  maxSteps: 4,
  minimumActivationScore: 0,
  async runAgent(input) {
    duplicateInputs.push(structuredClone(input));
    if (input.agent.id === ids.mother) {
      const candidate = chooseCandidate(input);
      const thread = input.openConversationThreads.find((item) => item.id === "thread_private_ledger_probe");
      const sourceTurnId = thread?.turns?.at(-1)?.id || "";
      return { decision: {
        candidateId: candidate?.candidateId || "",
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
        cognitiveAppraisal: {
          noticedEvidenceIds: [],
          interpretations: [],
          beliefOperations: [],
          threadAppraisals: [{
            threadId: "thread_private_ledger_probe",
            sourceTurnId,
            interpretation: "answered",
            satisfaction: "satisfied",
            responseNeed: "none",
            selfClosure: "closed_for_self",
            summary: "他没有说出私钱来路，但明确保证不占酒馆账；我决定先停在这里。",
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
        privateReason: "这不是全部真相，但眼下足够让我先不追问。",
      } };
    }
    const candidate = chooseCandidate(input, { targetCharacterId: ids.mother });
    const thread = input.openConversationThreads.find((item) => item.id === "thread_private_ledger_probe");
    const sourceTurnId = thread?.turns?.at(-1)?.id || "turn_mother_question";
    return { decision: {
      candidateId: candidate?.candidateId || "",
      actionType: "speak",
      speechAct: "answer",
      targetCharacterId: ids.mother,
      speech: "药钱我另想办法，不占酒馆账。",
      visibleAction: "",
      moveToZoneId: "",
      affordanceId: "",
      informationSourceImpactId: "",
      commitmentAction: "none",
      commitmentTopic: "药钱来路",
      cognitiveAppraisal: {
        noticedEvidenceIds: [],
        interpretations: [],
        beliefOperations: [],
        threadAppraisals: [{
          threadId: "thread_private_ledger_probe",
          sourceTurnId,
          interpretation: "new_request",
          satisfaction: "not_applicable",
          responseNeed: "medium",
          selfClosure: "open",
          summary: "她要我说明药钱来路。",
        }],
      },
      communicationPlan: {
        goal: "inform",
        tactic: "direct",
        disclosure: "partial",
        epistemicRelation: "believes",
        intendedAudienceCharacterIds: [ids.mother],
        desiredEffect: "让她先确认酒馆公账不会被动用",
        threadDisposition: "settle",
      },
      privateReason: "不愿透露当票，只重申公账不会受损。",
    } };
  },
});
const fatherDecisions = duplicateDialogue.decisions.filter((decision) => decision.characterId === ids.father);
assert.equal(fatherDecisions.length, 1, "a carried thread must produce one direct answer, not an answer-to-an-answer loop");
assert.equal(duplicateDialogue.actions.filter((action) => action.actorId === ids.father && action.speech).length, 1, "near-identical speech must not be published twice");
const directThreadAnswer = duplicateDialogue.actions.find((action) => action.actorId === ids.father && action.speech);
assert.ok(directThreadAnswer, "the persisted open turn must remain a valid semantic source for a direct answer");
assert.ok(directThreadAnswer.impactFactors.every((impact) => (
  impact.provenance?.sourceThreadId === "thread_private_ledger_probe"
)), "an answer keeps its conversation identity so memory and narration can trace the real preceding turn");
assert.equal(
  duplicateDialogue.privateSceneRuntime.requestLocks.find((lock) => lock.threadId === "thread_private_ledger_probe")?.status,
  "resolved",
  "conversation provenance must not be confused with an open response obligation",
);
assert.notEqual(duplicateDialogue.stopReason, "max-steps", "a carried thread must settle inside the scene budget");
const descendantInput = duplicateInputs.find((input, index) => index > 0 && input.agent.id === ids.mother);
assert.ok(descendantInput, "the original asker must appraise the descendant answer");
assert.equal(
  duplicateDialogue.decisions.find((decision) => decision.characterId === ids.mother)?.decision.actionType,
  "pass",
  "the listener may appraise an answer as sufficient and choose silence even when speaking remains physically possible",
);
assert.equal(
  duplicateDialogue.privateSceneRuntime.participantThreadStates.thread_private_ledger_probe[ids.mother].selfClosure,
  "closed_for_self",
  "the listener's own appraisal, not a cadence gag, closes her side of the exchange",
);

console.log("tavernEcologyCausalIntegration:test passed", {
  redirectedClaimCodes: [...redirectedClaimCodes],
  mandatedActor: badInputs[0].agent.name,
  mandatedTarget: badInputs[0].perceivedCharacters.find((character) => character.id === badResponseCandidate.targetCharacterId)?.name,
  acceptedSpeech: accepted.actions[0].speech,
  desireSatisfaction: {
    xiezenshiCoreDesires: Object.fromEntries(Object.entries(sonState.desires).map(([id, desire]) => [id, desire.satisfaction])),
    zhouminInnerCourt: zhouState.desires[ZHOU_CORE_DESIRE].satisfaction,
  },
  recommendationCommitment: recommendationCommitment.id,
  resolvedThread: resolvedThread.id,
  courtesyEchoAccepted: courtesy.actions.some((action) => /客气/.test(action.speech || "")),
  correctedZoneAction: zoneCorrected.actions[0].visibleAction,
  stalledConversationBlockedBy: stalledResponse.blockedBy,
  duplicateSpeechAccepted: duplicateDialogue.actions.filter((action) => action.actorId === ids.father && action.speech).length,
});
