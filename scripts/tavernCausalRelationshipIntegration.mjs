import assert from "node:assert/strict";
import { runTavernCausalScene } from "../src/server/pipeline/tavernCausalScene.mjs";
import { playTavernCausalSceneWithRunners } from "../src/server/pipeline/openaiPipeline.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";


// This project ships no default model. A contract that drives the real-model
// pipeline must name the model it is pretending to call.
process.env.CHARACTER_TOWN_MODEL ||= "contract-test-model";

const ids = {
  son: "char_xyy_xiezenshi",
  zhou: "char_xyy_zhoumin",
};

function relationship(stateOrList, fromCharacterId, toCharacterId) {
  const relationships = Array.isArray(stateOrList) ? stateOrList : stateOrList.relationships;
  return relationships.find((entry) => (
    entry.fromCharacterId === fromCharacterId
    && entry.toCharacterId === toCharacterId
  ));
}

function buildRelationshipSceneState() {
  const state = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  for (const characterId of [ids.son, ids.zhou]) {
    const character = state.characters.find((entry) => entry.id === characterId);
    character.lifeState.present = true;
    character.currentLocationId = "loc_xyy_tavern";
    character.ecologyState.presence.locationId = "loc_xyy_tavern";
    character.ecologyState.presence.zoneId = "hall";
    character.ecologyState.presence.observableAtStage = true;
  }
  state.tavernState.eventThreads = [{
    id: "thread_relationship_direction",
    topic: "举荐答复",
    stake: "周珉要听到谢真石本人的明确回应",
    participantIds: [ids.zhou, ids.son],
    status: "open",
    nextObligationCharacterId: ids.son,
    turns: [{
      turnId: "turn_zhou_asks_son",
      speakerId: ids.zhou,
      addresseeId: ids.son,
      line: "真石，举荐的事，你先告诉我有没有听清。",
      action: "ask",
    }],
  }];
  return state;
}

function noRelationshipAppraisal() {
  return {
    phase: "pending_perception_appraisal",
    targetCharacterId: "",
    sourceImpactIds: [],
    changeMode: "none",
    dimensionChanges: [],
    reason: "",
  };
}

function retainedDependenceAppraisal(input, targetCharacterId) {
  assert.ok(input.activation?.impactId, "the recipient appraisal must cite the impact actually delivered to this Character Agent");
  return {
    phase: "pending_perception_appraisal",
    targetCharacterId,
    sourceImpactIds: [input.activation.impactId],
    changeMode: "retained",
    dimensionChanges: [{ metric: "dependence", direction: "increase", strengthBand: "low" }],
    reason: "我亲耳听见他正面接下这件事，因此只略微更愿意依赖他的答复。",
  };
}

function answerDecision(candidateId = "") {
  return {
    candidateId,
    actionType: "speak",
    speechAct: "answer",
    targetCharacterId: ids.zhou,
    speech: "周珉，我听清了，这件事由我自己给你答复。",
    visibleAction: "谢真石停下手里的事，正面看向周珉",
    moveToZoneId: "",
    affordanceId: "",
    informationSourceImpactId: "",
    commitmentAction: "none",
    commitmentTopic: "举荐答复",
    privateReason: "周珉在等本人回应，先明确表示自己已经听见。",
    relationshipAppraisal: noRelationshipAppraisal(),
  };
}

function silentAcknowledgementDecision(candidateId = "", input = {}) {
  return {
    candidateId,
    actionType: "act",
    speechAct: "none",
    targetCharacterId: ids.son,
    speech: "",
    visibleAction: "周珉听完后把搭在柜台边的手收了回来。",
    moveToZoneId: "",
    affordanceId: "",
    informationSourceImpactId: "",
    commitmentAction: "none",
    commitmentTopic: "",
    privateReason: "已经听见对方，不需要为了轮次立刻补一句话，只把这次回应记在心里。",
    relationshipAppraisal: retainedDependenceAppraisal(input, ids.son),
  };
}

const state = buildRelationshipSceneState();
const listenerToSpeakerBefore = structuredClone(relationship(state, ids.zhou, ids.son));
const speakerToListenerBefore = structuredClone(relationship(state, ids.son, ids.zhou));
assert.ok(listenerToSpeakerBefore, "the fixture requires an explicit Zhou -> Xiezenshi edge");
assert.ok(speakerToListenerBefore, "the fixture requires an explicit Xiezenshi -> Zhou edge");

const agentInputs = [];
const result = await runTavernCausalScene(state, {
  allowOrphanVisitors: true,
  characterIds: [ids.son, ids.zhou],
  positions: { [ids.son]: "hall", [ids.zhou]: "hall" },
  slotContext: { day: 1, slotId: "morning", slotLabel: "清晨" },
  maxSteps: 2,
  minimumActivationScore: 0,
  async runAgent(input) {
    agentInputs.push(structuredClone(input));
    const counterpartId = input.agent.id === ids.son ? ids.zhou : ids.son;
    const candidate = input.privateActionCandidates.find((row) => row.feasible && row.targetCharacterId === counterpartId)
      || input.privateActionCandidates.find((row) => row.feasible && !row.realization?.affordanceId)
      || input.privateActionCandidates.find((row) => row.feasible);
    return { decision: input.agent.id === ids.son ? answerDecision(candidate?.candidateId) : silentAcknowledgementDecision(candidate?.candidateId, input) };
  },
});

assert.deepEqual(
  agentInputs.slice(0, 2).map((input) => input.agent.id),
  [ids.son, ids.zhou],
  "the open question activates the son first and its delivered answer activates Zhou next",
);
assert.equal(result.actions.length, 2, "the answer and Zhou's silent visible response both commit without inventing dialogue");
assert.equal(result.actions[0].speechAct, "answer");
assert.equal(result.actions[0].actorId, ids.son);
assert.equal(result.actions[0].targetCharacterId, ids.zhou);
assert.equal(result.actions[1].actorId, ids.zhou);
assert.equal(result.actions[1].speech, "");
assert.equal(result.actions[1].semanticFrame?.roles?.actor, ids.zhou, "a nonverbal response memory must belong to the person who actually acted");
assert.equal(result.actions[1].semanticFrame?.roles?.target, ids.son);
assert.equal(result.actions[1].semanticFrame?.parentFrameId, result.actions[0].publicSemanticFrame?.id, "a response may cite only the prior turn's publicly expressed frame without inheriting its private motive or speaker roles");

const shift = result.relationshipShifts.find((entry) => (
  entry.fromCharacterId === ids.zhou
  && entry.toCharacterId === ids.son
  && entry.sourceActionId === result.actions[0].id
));
assert.ok(shift, "a heard answer changes the listener's stance toward the speaker");
assert.equal(shift.generatedFrom, "character-agent-owned-appraisal");
assert.equal(shift.relationshipSource, "recipient-character-agent-appraisal");
assert.ok(shift.rules.includes("character-appraisal:explicit_appraisal"));
assert.deepEqual(shift.deltas, { dependence: 1 });
assert.ok(
  !result.relationshipShifts.some((entry) => (
    entry.fromCharacterId === ids.son
    && entry.toCharacterId === ids.zhou
    && entry.sourceActionId === result.actions[0].id
  )),
  "one heard answer must not fabricate the reverse speaker -> listener change",
);

const zhouSecondInput = agentInputs[1];
const updatedContext = zhouSecondInput.agent.relationshipContext.find((entry) => entry.otherCharacterId === ids.son);
assert.ok(updatedContext, "Zhou receives his own directed relationship context on the next activation");
assert.equal(
  updatedContext.publicPressure.closeness,
  Math.round((listenerToSpeakerBefore.dependence + listenerToSpeakerBefore.protection) / 2),
  "hearing speech alone must not pre-write Zhou's relationship before Zhou appraises it",
);
const zhouToSonCandidate = zhouSecondInput.privateActionCandidates.find((candidate) => candidate.targetCharacterId === ids.son);
assert.equal(zhouToSonCandidate.relationshipAppraisal.fromCharacterId, ids.zhou);
assert.equal(zhouToSonCandidate.relationshipAppraisal.toCharacterId, ids.son);
assert.equal(
  zhouToSonCandidate.relationshipAppraisal.dependence,
  listenerToSpeakerBefore.dependence,
  "the mathematical candidate context remains the pre-appraisal relationship while the Character Agent is choosing",
);
assert.equal(result.relationshipAppraisals.length, 1, "only Zhou's explicit non-none appraisal is retained in the observer trace");
assert.equal(result.relationshipAppraisals[0].appraiserCharacterId, ids.zhou);
assert.equal(result.relationshipAppraisals[0].targetCharacterId, ids.son);
assert.deepEqual(result.relationshipAppraisals[0].appliedRelationshipShiftIds, [shift.id]);

assert.deepEqual(
  relationship(state, ids.zhou, ids.son),
  listenerToSpeakerBefore,
  "the causal scene works on its private working state and does not mutate the caller's snapshot",
);
assert.deepEqual(
  relationship(state, ids.son, ids.zhou),
  speakerToListenerBefore,
  "the reverse relationship remains unchanged in the caller's snapshot too",
);

const oneTurnDraft = await playTavernCausalSceneWithRunners(buildRelationshipSceneState(), {
  characterAgentProtocolVersion: 1,
  allowOrphanVisitors: true,
  characterIds: [ids.son, ids.zhou],
  positions: { [ids.son]: "hall", [ids.zhou]: "hall" },
  slotContext: { day: 1, slotId: "morning", slotLabel: "清晨" },
  maxSteps: 1,
  minimumActivationScore: 0,
  runners: {
    async runTavernCausalAgent(input) {
      const candidate = input.privateActionCandidates.find((row) => row.feasible && row.targetCharacterId === ids.zhou);
      return { decision: answerDecision(candidate?.candidateId) };
    },
  },
});
assert.deepEqual(
  oneTurnDraft.updateBundle.relationships,
  [],
  "a delivered answer must not change a listener's relationship before that listener's Character Agent evaluates it",
);

const draft = await playTavernCausalSceneWithRunners(buildRelationshipSceneState(), {
  characterAgentProtocolVersion: 1,
  allowOrphanVisitors: true,
  characterIds: [ids.son, ids.zhou],
  positions: { [ids.son]: "hall", [ids.zhou]: "hall" },
  slotContext: { day: 1, slotId: "morning", slotLabel: "清晨" },
  maxSteps: 2,
  maxLocalFollowupSteps: 0,
  minimumActivationScore: 0,
  runners: {
    async runTavernCausalAgent(input) {
      const counterpartId = input.agent.id === ids.son ? ids.zhou : ids.son;
      const candidate = input.privateActionCandidates.find((row) => row.feasible && row.targetCharacterId === counterpartId)
        || input.privateActionCandidates.find((row) => row.feasible);
      return {
        decision: input.agent.id === ids.son
          ? answerDecision(candidate?.candidateId)
          : silentAcknowledgementDecision(candidate?.candidateId, input),
      };
    },
  },
});

const bundledShift = draft.updateBundle.relationships.find((entry) => (
  entry.fromCharacterId === ids.zhou
  && entry.toCharacterId === ids.son
));
assert.ok(bundledShift, "the recipient Character Agent's directional appraisal must reach the pipeline update bundle");
assert.equal(bundledShift.generatedFrom, "character-agent-owned-appraisal");
assert.ok(bundledShift.rules.includes("character-appraisal:explicit_appraisal"));
assert.ok(
  !draft.updateBundle.relationships.some((entry) => (
    entry.fromCharacterId === ids.son
    && entry.toCharacterId === ids.zhou
  )),
  "the pipeline must not fall back to the legacy speaker -> listener relationship write",
);
assert.ok(
  !draft.updateBundle.relationships.some((entry) => entry.generatedFrom === "agent-dialogue-relationship"),
  "the legacy dialogue-derived relationship fallback must stay unused when causal shifts exist",
);

console.log("tavern causal relationship integration: GREEN");
console.log(JSON.stringify({
  action: `${result.actions[0].actorId}->${result.actions[0].targetCharacterId}:${result.actions[0].speechAct}`,
  committedDirection: `${shift.fromCharacterId}->${shift.toCharacterId}`,
  relationshipBeforeAgentAppraisal: zhouToSonCandidate.relationshipAppraisal.dependence,
  chosenDelta: shift.deltas,
  bundledDirection: `${bundledShift.fromCharacterId}->${bundledShift.toCharacterId}`,
}, null, 2));
