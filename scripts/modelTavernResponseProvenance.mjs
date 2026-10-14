import assert from "node:assert/strict";
import { runTavernAgentDecisionPeriod } from "../src/server/pipeline/tavernAgentDecision.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});

const byId = new Map(state.characters.map((character) => [character.id, character]));

function output(characterId, slotId) {
  const character = byId.get(characterId);
  return {
    characterId,
    characterName: character.name,
    present: true,
    actionType: "routine",
    chosenAction: character.lifeProfile?.activities?.routine || "继续手里的事",
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

function tick(slotId, characterIds) {
  return {
    id: `tick_${slotId}`,
    day: 1,
    slotId,
    label: slotId,
    participantIds: characterIds,
    lifeEvents: [],
    agentOutputs: characterIds.map((characterId) => output(characterId, slotId)),
  };
}

const xieMu = "char_xyy_xiemu";
const xieHeng = "char_xyy_xieheng";
const xieZhenShi = "char_xyy_xiezenshi";

const staleProbe = {
  locationId: state.locations[0].id,
  updateBundle: { tavernState: state.tavernState },
  periodSimulation: {
    ticks: [
      tick("清晨", [xieMu, xieHeng]),
      tick("黄昏", [xieHeng, xieZhenShi, xieMu]),
    ],
  },
};

const staleResult = await runTavernAgentDecisionPeriod(state, staleProbe, {
  maxAgentsPerTick: 3,
  async runDecision(input) {
    if (input.slot.label === "清晨" && input.agent.id === xieMu) {
      return { decision: {
        chosenActionType: "routine",
        speechAct: "ask",
        addresseeId: xieHeng,
        utterance: "药钱那件事，你究竟打算什么时候说清？",
        privateReason: "把问题问明白。",
        desiredResponse: "给出具体时间",
        threadAction: "none",
        threadTopic: "",
        threadStake: "",
      } };
    }
    if (input.slot.label === "黄昏" && input.agent.id === xieHeng) {
      return { decision: {
        chosenActionType: "routine",
        speechAct: "answer",
        addresseeId: xieMu,
        utterance: "嗯，知道了。",
        privateReason: "先敷衍过去。",
        desiredResponse: "",
        threadAction: "none",
        threadTopic: "",
        threadStake: "",
      } };
    }
    if (input.slot.label === "黄昏" && input.agent.id === xieZhenShi) {
      return { decision: {
        chosenActionType: "routine",
        speechAct: "answer",
        addresseeId: xieHeng,
        utterance: "爹，我知道了。",
        privateReason: "顺口应下。",
        desiredResponse: "",
        threadAction: "none",
        threadTopic: "",
        threadStake: "",
      } };
    }
    return { decision: {
      chosenActionType: "routine",
      speechAct: "none",
      addresseeId: "",
      utterance: "",
      privateReason: "保持安静。",
      desiredResponse: "",
      threadAction: "none",
      threadTopic: "",
      threadStake: "",
    } };
  },
});

const staleTurns = Object.values(staleResult.decisionsByTick).flat().map((decision) => decision.turn).filter(Boolean);
assert.ok(staleTurns.some((turn) => /药钱那件事/.test(turn.line)), "the original initiative remains canonical");
assert.ok(!staleTurns.some((turn) => /^(?:嗯，?知道了|爹，我知道了)/.test(turn.line)), "bare acknowledgements must not become canonical responses");
assert.ok(!staleTurns.some((turn) => turn.slotId === "黄昏" && turn.respondsTo), "an old direct turn must not become an invisible cross-slot response");
assert.ok(staleResult.participationByTick?.["1:黄昏"], "the result must preserve per-slot Agent participation");
assert.deepEqual(
  new Set(staleResult.participationByTick["1:黄昏"].activatedAgentIds),
  new Set([xieHeng, xieZhenShi, xieMu]),
);

const directProbe = {
  locationId: state.locations[0].id,
  updateBundle: { tavernState: state.tavernState },
  periodSimulation: { ticks: [tick("正午", [xieHeng, xieMu])] },
};
directProbe.periodSimulation.ticks[0].agentOutputs[0].socialIntent = { kind: "request", topic: "晚饭库存" };
directProbe.periodSimulation.ticks[0].agentOutputs[0].targetCharacterId = xieMu;
const directResult = await runTavernAgentDecisionPeriod(state, directProbe, {
  maxAgentsPerTick: 2,
  async runDecision(input) {
    if (input.agent.id === xieHeng) return { decision: {
      chosenActionType: "routine",
      speechAct: "ask",
      addresseeId: xieMu,
      utterance: "晚饭还剩几碗？",
      privateReason: "先问清库存。",
      desiredResponse: "报出具体数量",
      threadAction: "none",
      threadTopic: "",
      threadStake: "",
    } };
    return { decision: {
      chosenActionType: "routine",
      speechAct: "answer",
      addresseeId: xieHeng,
      utterance: "锅里还剩四碗，住店客人要留一碗。",
      privateReason: "把灶上的实数说清楚。",
      desiredResponse: "让东家决定是否补米",
      threadAction: "none",
      threadTopic: "",
      threadStake: "",
    } };
  },
});
const directTurns = Object.values(directResult.decisionsByTick).flat().map((decision) => decision.turn).filter(Boolean);
const directAnswer = directTurns.find((turn) => /还剩四碗/.test(turn.line));
const directQuestion = directTurns.find((turn) => /还剩几碗/.test(turn.line));
assert.ok(directAnswer?.respondsTo, "a concrete same-slot answer must retain response provenance");
assert.equal(directAnswer.respondsTo, directQuestion.turnId);
assert.equal(directAnswer.responseSourceLine, directQuestion.line);
assert.equal(directAnswer.responseSourceSlotId, "正午");

console.log("modelTavernResponseProvenance:test passed", {
  staleTurns: staleTurns.length,
  directTurns: directTurns.length,
  participation: staleResult.participationByTick["1:黄昏"],
});
