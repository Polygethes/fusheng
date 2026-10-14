import assert from "node:assert/strict";
import { runTavernAgentDecisionPeriod } from "../src/server/pipeline/tavernAgentDecision.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
const byId = new Map(state.characters.map((character) => [character.id, character]));
const xieMu = "char_xyy_xiemu";
const xieHeng = "char_xyy_xieheng";
const zhouMin = "char_xyy_zhoumin";
const yanZhizhong = "char_xyy_yanzhizhong";

function output(characterId, slotId) {
  const character = byId.get(characterId);
  return {
    characterId,
    characterName: character.name,
    present: true,
    actionType: "routine",
    chosenAction: "继续手里的事",
    visibleAction: `${character.name}继续手里的事。`,
    decisionOpportunity: {
      id: `op_${slotId}_${characterId}`,
      day: 1,
      slotId,
      slotLabel: slotId,
      characterId,
      defaultActionType: "routine",
      candidateActions: [{ type: "routine", description: "继续手里的事", reason: "当前没有新的物质义务" }],
    },
  };
}

function tick(slotId, characterIds, day = 1) {
  return {
    id: `tick_${day}_${slotId}`,
    day,
    slotId,
    label: slotId,
    participantIds: characterIds,
    lifeEvents: [],
    agentOutputs: characterIds.map((characterId) => output(characterId, slotId)),
  };
}

function quiet(input) {
  return { decision: {
    chosenActionType: input.opportunity.defaultActionType,
    speechAct: "none",
    addresseeId: "",
    utterance: "",
    privateReason: "继续手里的事。",
    desiredResponse: "",
    threadAction: "none",
    threadTopic: "",
    threadStake: "",
  } };
}

// The answerer runs first and stays quiet. A later Agent asks a question, so the
// answerer must be reactivated immediately instead of waiting until noon.
const cadenceCalls = [];
const cadenceProbe = {
  locationId: state.locations[0].id,
  updateBundle: { tavernState: state.tavernState },
  periodSimulation: { ticks: [tick("清晨", [xieMu, xieHeng])] },
};
const cadenceResult = await runTavernAgentDecisionPeriod(state, cadenceProbe, {
  maxAgentsPerTick: 2,
  maxFollowupsPerTick: 2,
  async runDecision(input) {
    cadenceCalls.push({ agentId: input.agent.id, obligation: input.interactionObligation });
    if (input.agent.id === xieHeng) return { decision: {
      chosenActionType: "routine",
      speechAct: "ask",
      addresseeId: xieMu,
      utterance: "王记酒坊给的工钱，到底有几文？",
      privateReason: "把具体数目问清。",
      desiredResponse: "报出酒坊工钱的具体数目",
      threadAction: "open",
      threadTopic: "王记酒坊的工钱数目",
      threadStake: "药钱缺口是否能补上",
    } };
    if (input.agent.id === xieMu && input.interactionObligation.kind === "addressed-turn") {
      const addressedAttempts = cadenceCalls.filter((call) => call.agentId === xieMu && call.obligation.kind === "addressed-turn").length;
      if (addressedAttempts === 1) return quiet(input);
      return { decision: {
        chosenActionType: "routine",
        speechAct: "answer",
        addresseeId: xieHeng,
        utterance: "三文，王掌柜今早当面给我的，一文也没动。",
        privateReason: "把钱数和来源一起说清。",
        desiredResponse: "",
        threadAction: "close",
        threadTopic: "王记酒坊的工钱数目",
        threadStake: "",
      } };
    }
    return quiet(input);
  },
});
const cadenceTurns = Object.values(cadenceResult.decisionsByTick).flat().map((decision) => decision.turn).filter(Boolean);
assert.equal(cadenceTurns.length, 2, "a concrete question should receive exactly one same-slot answer");
assert.equal(cadenceTurns[0].speakerId, xieHeng);
assert.equal(cadenceTurns[1].speakerId, xieMu);
assert.equal(cadenceTurns[1].respondsTo, cadenceTurns[0].turnId);
assert.equal(cadenceTurns[1].slotId, cadenceTurns[0].slotId);
assert.equal(cadenceCalls.filter((call) => call.agentId === xieMu).length, 3, "an invalid required follow-up gets one bounded retry in the same slot");
assert.equal(cadenceCalls.filter((call) => call.agentId === xieHeng).length, 1, "an answer must not trigger confirmation-of-confirmation");
assert.deepEqual(cadenceResult.participationByTick["1:清晨"].followupAgentIds, [xieMu]);
assert.equal(cadenceResult.eventThreads.find((thread) => thread.topic === "王记酒坊的工钱数目")?.status, "resolved");

// Explicit postponement must cool the topic down for the rest of the day.
const deferredState = structuredClone(state);
deferredState.tavernState.eventThreads = [{
  id: "thread_household_money",
  topic: "弄清谢恒的钱从哪里来",
  stake: "药钱不能挪用店账",
  participantIds: [xieMu, xieHeng],
  status: "open",
  openedDay: 1,
  openedSlot: "清晨",
  lastAdvancedDay: 1,
  lastAdvancedSlot: "清晨",
  nextObligationCharacterId: xieHeng,
  turns: [],
}];
const deferCalls = [];
const deferResult = await runTavernAgentDecisionPeriod(deferredState, {
  locationId: deferredState.locations[0].id,
  updateBundle: { tavernState: deferredState.tavernState },
  periodSimulation: { ticks: [
    tick("清晨", [xieMu, xieHeng]),
    tick("正午", [xieMu, xieHeng]),
    tick("黄昏", [xieMu, xieHeng]),
  ] },
}, {
  maxAgentsPerTick: 2,
  maxFollowupsPerTick: 2,
  async runDecision(input) {
    deferCalls.push({ slot: input.slot.id, agentId: input.agent.id, obligation: input.interactionObligation.kind });
    if (input.slot.id === "清晨" && input.agent.id === xieHeng && input.interactionObligation.kind === "event-thread") {
      return { decision: {
        chosenActionType: "routine",
        speechAct: "answer",
        addresseeId: xieMu,
        utterance: "今晚客人散后，我把王记酒坊的工钱数当面给你看。",
        privateReason: "现在不在孩子和客人面前谈钱。",
        desiredResponse: "",
        threadAction: "defer",
        threadTopic: "弄清谢恒的钱从哪里来",
        threadStake: "药钱不能挪用店账",
      } };
    }
    if (input.slot.id === "正午" && input.agent.id === xieMu) {
      return { decision: {
        chosenActionType: "routine",
        speechAct: "ask",
        addresseeId: xieHeng,
        utterance: "那笔钱到底从哪里来？",
        privateReason: "换句话再追问一次。",
        desiredResponse: "说明钱的来路",
        threadAction: "open",
        threadTopic: "弄清谢恒的钱从哪里来",
        threadStake: "药钱不能挪用店账",
      } };
    }
    return quiet(input);
  },
});
const deferredThread = deferResult.eventThreads.find((thread) => thread.id === "thread_household_money");
assert.equal(deferredThread.status, "deferred");
assert.equal(deferredThread.resumeAfterDay, 2);
assert.ok(deferCalls.filter((call) => call.slot !== "清晨").every((call) => call.obligation !== "event-thread"), "a deferred topic must not reactivate later the same day");
assert.ok(!Object.values(deferResult.decisionsByTick).flat().some((decision) => /那笔钱到底/.test(decision.turn?.line || "")), "an Agent cannot reopen a same-day deferred topic by rephrasing it");

// Reusing the same words cannot add unrelated speakers to a pre-existing thread.
const integrityState = structuredClone(state);
integrityState.tavernState.eventThreads = [{
  id: "thread_recommendation",
  topic: "药包验收与举荐答复",
  stake: "周珉等候举荐答复",
  participantIds: [zhouMin, yanZhizhong],
  status: "open",
  openedDay: 1,
  openedSlot: "清晨",
  lastAdvancedDay: 1,
  lastAdvancedSlot: "清晨",
  nextObligationCharacterId: "",
  turns: [],
}];
const integrityResult = await runTavernAgentDecisionPeriod(integrityState, {
  locationId: integrityState.locations[0].id,
  updateBundle: { tavernState: integrityState.tavernState },
  periodSimulation: { ticks: [tick("午后", [xieHeng, xieMu])] },
}, {
  maxAgentsPerTick: 2,
  async runDecision(input) {
    if (input.agent.id === xieHeng) return { decision: {
      chosenActionType: "routine",
      speechAct: "ask",
      addresseeId: xieMu,
      utterance: "周珉那份举荐，你听说了吗？",
      privateReason: "另问一件相似的话。",
      desiredResponse: "说明是否听说",
      threadAction: "advance",
      threadTopic: "药包验收与举荐答复",
      threadStake: "",
    } };
    return quiet(input);
  },
});
const protectedThread = integrityResult.eventThreads.find((thread) => thread.id === "thread_recommendation");
assert.deepEqual(protectedThread.participantIds, [zhouMin, yanZhizhong]);
assert.equal(protectedThread.turns.length, 0, "an unrelated pair cannot advance a thread by copying its topic");

console.log("modelTavernConversationCadence:test passed", {
  cadenceCalls: cadenceCalls.length,
  cadenceTurns: cadenceTurns.length,
  deferredStatus: deferredThread.status,
  protectedParticipants: protectedThread.participantIds,
});
