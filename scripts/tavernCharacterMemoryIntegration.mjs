import assert from "node:assert/strict";
import { TAVERN_RECOMMENDATION_REQUEST_FRAME } from "../src/server/ecology/tavernEcologyProfile.mjs";
import { runTavernCausalScene } from "../src/server/pipeline/tavernCausalScene.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const IDS = {
  xie: "char_xyy_xiezenshi",
  zhou: "char_xyy_zhoumin",
  yan: "char_xyy_yanzhizhong",
  chen: "char_xyy_chenyan",
};

function focusedState() {
  const state = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  for (const id of [IDS.xie, IDS.zhou, IDS.chen]) {
    const character = state.characters.find((item) => item.id === id);
    character.lifeState.present = true;
    character.currentLocationId = "loc_xyy_tavern";
    character.ecologyState.presence.locationId = "loc_xyy_tavern";
    character.ecologyState.presence.observableAtStage = true;
  }
  return state;
}

function recommendationImpact() {
  return {
    id: "impact:integration:zhou-recommendation-request",
    objectiveEventId: "action:integration:zhou-recommendation-request",
    sourceCharacterId: IDS.zhou,
    sourceZoneId: "hall",
    type: "speech",
    modality: "sound",
    intensity: 94,
    radius: 1,
    directedTargetId: IDS.xie,
    content: "真石，内门举荐的事，请你亲口给我一句答复。",
    topic: "举荐答复",
    speechAct: "ask",
    commitmentAction: "open",
    semanticFrame: TAVERN_RECOMMENDATION_REQUEST_FRAME,
    provenance: {
      kind: "firsthand",
      sourceActionId: "action:integration:zhou-recommendation-request",
      speakerCharacterId: IDS.zhou,
      sourceCharacterChain: [IDS.zhou],
    },
  };
}

const acceptedInputs = [];
const accepted = await runTavernCausalScene(focusedState(), {
  allowOrphanVisitors: true,
  characterIds: [IDS.xie, IDS.zhou, IDS.chen],
  positions: { [IDS.xie]: "hall", [IDS.zhou]: "hall", [IDS.chen]: "guest_room" },
  slotContext: { day: 1, slotId: "dusk", slotLabel: "黄昏" },
  seedImpacts: [recommendationImpact()],
  maxSteps: 1,
  minimumActivationScore: 0,
  async runAgent(input) {
    acceptedInputs.push(structuredClone(input));
    assert.equal(input.agent.id, IDS.xie, "the directed request must activate Xie Zhenshi");
    const remembered = input.agent.memoryContext.episodes.find((episode) => episode.semanticFrame?.id === TAVERN_RECOMMENDATION_REQUEST_FRAME.id);
    assert.ok(remembered, "the request must be encoded before the same-scene answer decision");
    assert.equal(remembered.kind, "reconstructed_recall", "the Character Agent must receive a present recall, not a perfect server-side replay");
    assert.ok(input.agent.memoryContext.recallInstances.some((recall) => recall.sourceEpisodeIds.includes(remembered.id)));
    assert.equal(Object.hasOwn(input.agent.memoryContext, "experienceTraces"), false, "immutable sensory traces remain server-private");
    assert.deepEqual(remembered.semanticFrame.roles, TAVERN_RECOMMENDATION_REQUEST_FRAME.roles);
    assert.equal(input.agent.memoryContext.commitments[0].ownerRole, "requestedActor");
    const candidate = input.privateActionCandidates.find((item) => item.actionKind === "respond_to_impact" && item.targetCharacterId === IDS.zhou);
    assert.ok(candidate, "the Character Agent must receive a response candidate bound to the perceived requester");
    assert.deepEqual(candidate.semanticFrame.roles, TAVERN_RECOMMENDATION_REQUEST_FRAME.roles);
    assert.ok(candidate.memoryInfluence.total > 0.4, "the just-encoded request must increase this candidate's private pressure");
    assert.ok(candidate.memoryScoreDelta > 8, "retrieved memory must change the candidate's actual mathematical pressure, not only annotate it");
    assert.equal(candidate.activationScore, Math.min(100, Math.round(candidate.preMemoryActivationScore + candidate.memoryScoreDelta)));
    return { decision: {
      candidateId: candidate.candidateId,
      actionType: "speak",
      speechAct: "refuse",
      targetCharacterId: IDS.zhou,
      speech: "周珉，这次内门举荐我不答应。",
      visibleAction: "谢真石停下手里的事，正面看向周珉",
      moveToZoneId: "",
      affordanceId: "",
      informationSourceImpactId: "",
      commitmentAction: "fulfill",
      commitmentTopic: "举荐答复",
      decisionValue: "refuse",
      semanticFrameId: candidate.semanticFrame.id,
      semanticRoleBindings: candidate.semanticFrame.roles,
      privateReason: "周珉的请求已经当面抵达；自己决定拒绝，但拒绝的是替周珉举荐，不是自己的修行道路。",
    } };
  },
});

assert.equal(accepted.actions.length, 1);
assert.equal(accepted.actions[0].semanticFrame.roles.requester, IDS.zhou);
assert.equal(accepted.actions[0].semanticFrame.roles.requestedActor, IDS.xie);
assert.equal(accepted.actions[0].semanticFrame.roles.beneficiary, IDS.zhou);
assert.equal(accepted.actions[0].semanticFrame.roles.ultimateRecipient, IDS.yan);
assert.equal(accepted.actions[0].semanticFrame.decisionValue, "refuse");

const acceptedXie = accepted.characterPatches.find((patch) => patch.id === IDS.xie).agentMemory;
const acceptedZhou = accepted.characterPatches.find((patch) => patch.id === IDS.zhou).agentMemory;
const acceptedChen = accepted.characterPatches.find((patch) => patch.id === IDS.chen).agentMemory;
assert.ok(acceptedXie.episodes.some((episode) => episode.sourceImpactId === recommendationImpact().id));
assert.equal(acceptedXie.commitments.find((commitment) => commitment.semanticFrame.id === TAVERN_RECOMMENDATION_REQUEST_FRAME.id).status, "resolved");
assert.equal(
  acceptedXie.beliefs.find((belief) => belief.semanticFrame?.id === TAVERN_RECOMMENDATION_REQUEST_FRAME.id),
  undefined,
  "perceiving a request and uttering an answer must not manufacture a private belief without Character Agent appraisal",
);
assert.equal(
  acceptedZhou.episodes.some((episode) => episode.semanticFrame?.decisionValue === "refuse"),
  false,
  "physical delivery alone must not manufacture Zhou Min's conscious memory before his Agent processes it",
);
assert.ok(
  accepted.deliveries.some((delivery) => (
    delivery.recipientId === IDS.zhou
    && delivery.semanticFrame?.decisionValue === "refuse"
    && !delivery.noticedProjection
  )),
  "the unprocessed refusal must remain available in the server delivery audit",
);
assert.equal(
  acceptedZhou.beliefs.find((belief) => belief.semanticFrame?.id === TAVERN_RECOMMENDATION_REQUEST_FRAME.id),
  undefined,
  "the requester receives evidence of the refusal but does not believe it until his own cognitive appraisal runs",
);
assert.equal(acceptedChen.episodes.length, 0, "Chen Yan behind a closed guest-room route must not know the request or answer");
assert.equal(JSON.stringify(accepted.sceneRuntime).includes("agentMemory"), false, "private cognitive memory must not leak into public scene runtime");

let zhouInputAfterAttention = null;
const refusalFrame = {
  ...structuredClone(TAVERN_RECOMMENDATION_REQUEST_FRAME),
  decisionValue: "refuse",
};
const noticedRefusal = await runTavernCausalScene(focusedState(), {
  allowOrphanVisitors: true,
  characterIds: [IDS.xie, IDS.zhou],
  positions: { [IDS.xie]: "hall", [IDS.zhou]: "hall" },
  slotContext: { day: 1, slotId: "dusk", slotLabel: "黄昏" },
  seedImpacts: [{
    id: "impact:integration:xie-refuses-recommendation",
    objectiveEventId: "action:integration:xie-refuses-recommendation",
    sourceCharacterId: IDS.xie,
    sourceZoneId: "hall",
    type: "speech",
    modality: "sound",
    intensity: 96,
    radius: 1,
    directedTargetId: IDS.zhou,
    content: "周珉，这次内门举荐我不答应。",
    topic: "举荐答复",
    speechAct: "refuse",
    commitmentAction: "fulfill",
    semanticFrame: refusalFrame,
    provenance: {
      kind: "firsthand",
      sourceActionId: "action:integration:xie-refuses-recommendation",
      speakerCharacterId: IDS.xie,
      sourceCharacterChain: [IDS.xie],
    },
  }],
  maxSteps: 1,
  minimumActivationScore: 0,
  async runAgent(input) {
    zhouInputAfterAttention = structuredClone(input);
    assert.equal(input.agent.id, IDS.zhou);
    assert.ok(input.perceivedImpacts.some((impact) => impact.semanticFrame?.decisionValue === "refuse"));
    assert.ok(input.agent.memoryContext.episodes.some((episode) => episode.semanticFrame?.decisionValue === "refuse"));
    const candidate = input.privateActionCandidates.find((row) => row.feasible);
    return { decision: {
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
      privateReason: "只验证注意后的记忆写入，不预写周珉回应。",
    } };
  },
});
assert.ok(zhouInputAfterAttention);
const noticedZhouMemory = noticedRefusal.characterPatches.find((patch) => patch.id === IDS.zhou).agentMemory;
assert.ok(noticedZhouMemory.episodes.some((episode) => episode.semanticFrame?.decisionValue === "refuse"));

const rejected = await runTavernCausalScene(focusedState(), {
  allowOrphanVisitors: true,
  characterIds: [IDS.xie, IDS.zhou],
  positions: { [IDS.xie]: "hall", [IDS.zhou]: "hall" },
  slotContext: { day: 1, slotId: "dusk", slotLabel: "黄昏" },
  seedImpacts: [recommendationImpact()],
  maxSteps: 1,
  minimumActivationScore: 0,
  async runAgent(input) {
    const candidate = input.privateActionCandidates.find((item) => item.actionKind === "respond_to_impact" && item.targetCharacterId === IDS.zhou);
    return { decision: {
      candidateId: candidate.candidateId,
      actionType: "speak",
      speechAct: "refuse",
      targetCharacterId: IDS.zhou,
      speech: "周珉，路我自己试。就这样回信。",
      visibleAction: "谢真石看向周珉",
      moveToZoneId: "",
      affordanceId: "",
      informationSourceImpactId: "",
      commitmentAction: "fulfill",
      commitmentTopic: "举荐答复",
      decisionValue: "refuse",
      semanticFrameId: candidate.semanticFrame.id,
      semanticRoleBindings: candidate.semanticFrame.roles,
      privateReason: "故意模拟把周珉的举荐请求误写成谢真石自己的求道路。",
    } };
  },
});

assert.equal(rejected.actions.length, 1, "an evasive or confused line is still something the person really said");
assert.equal(rejected.actions[0].speech, "周珉，路我自己试。就这样回信。");
assert.equal(rejected.actions[0].decisionValue, "none", "private refusal intent must not become a public decision when the words never express the requested act");
assert.equal(rejected.actions[0].semanticFrame.decisionValue, "");
assert.ok(rejected.decisions[0].decision.claimAnnotations.some((violation) => violation.code === "SEMANTIC_REQUEST_OBJECT_MISSING"));
const rejectedXie = rejected.characterPatches.find((patch) => patch.id === IDS.xie).agentMemory;
assert.equal(
  rejectedXie.commitments.find((commitment) => commitment.semanticFrame.id === TAVERN_RECOMMENDATION_REQUEST_FRAME.id).status,
  "open",
  "saying an unrelated self-path line must not settle the recommendation obligation",
);

const redirected = await runTavernCausalScene(focusedState(), {
  allowOrphanVisitors: true,
  characterIds: [IDS.xie, IDS.zhou, IDS.chen],
  positions: { [IDS.xie]: "hall", [IDS.zhou]: "hall", [IDS.chen]: "hall" },
  slotContext: { day: 1, slotId: "dusk", slotLabel: "黄昏" },
  seedImpacts: [recommendationImpact()],
  maxSteps: 1,
  minimumActivationScore: 0,
  async runAgent(input) {
    const candidate = input.privateActionCandidates.find((item) => item.actionKind === "respond_to_impact" && item.targetCharacterId === IDS.zhou);
    const thirdPerson = input.perceivedCharacters.find((person) => person.id !== IDS.zhou);
    assert.ok(candidate && thirdPerson, "the redirect probe needs both the requester and a perceived third person");
    return { decision: {
      candidateId: candidate.candidateId,
      actionType: "speak",
      speechAct: "inform",
      targetCharacterId: thirdPerson.id,
      speech: "那边的，劳驾把门带上。",
      visibleAction: "谢真石偏过脸，看向门边的人",
      moveToZoneId: "",
      affordanceId: "",
      informationSourceImpactId: "",
      commitmentAction: "none",
      commitmentTopic: "举荐答复",
      decisionValue: "none",
      semanticFrameId: candidate.semanticFrame.id,
      semanticRoleBindings: candidate.semanticFrame.roles,
      cognitiveAppraisal: { noticedEvidenceIds: [], interpretations: [], beliefOperations: [] },
      communicationPlan: {
        goal: "buy_time",
        tactic: "redirect",
        disclosure: "withhold",
        epistemicRelation: "not_applicable",
        intendedAudienceCharacterIds: [thirdPerson.id],
        desiredEffect: "暂时把当面的回答压力挪开",
        threadDisposition: "redirect",
      },
      privateReason: "不想此刻回答周珉，故意先同旁人说另一件事。",
    } };
  },
});

assert.equal(redirected.actions.length, 1, "addressing a third person must remain a real public utterance");
assert.equal(redirected.actions[0].targetCharacterId, IDS.chen, "the world resolves the perceived third-person handle after the Agent chooses");
assert.equal(redirected.actions[0].speech, "那边的，劳驾把门带上。");
assert.equal(redirected.actions[0].threadDisposition, "redirect");
assert.ok(
  redirected.decisions[0].decision.claimAnnotations.some((violation) => violation.code === "AGENT_CANDIDATE_TARGET_MISMATCH"),
  "the redirect remains auditable without being censored",
);
const redirectedXie = redirected.characterPatches.find((patch) => patch.id === IDS.xie).agentMemory;
assert.equal(
  redirectedXie.commitments.find((commitment) => commitment.semanticFrame.id === TAVERN_RECOMMENDATION_REQUEST_FRAME.id).status,
  "open",
  "speaking to somebody else must not settle the requester's unanswered thread",
);

console.log("tavernCharacterMemoryIntegration:test passed", {
  encodedBeforeDecision: acceptedInputs[0].agent.memoryContext.episodes.length,
  xieEpisodes: acceptedXie.episodes.length,
  zhouEpisodes: acceptedZhou.episodes.length,
  annotatedCodes: rejected.decisions[0].decision.claimAnnotations.map((item) => item.code),
  redirectedTo: redirected.actions[0].targetCharacterId,
});
