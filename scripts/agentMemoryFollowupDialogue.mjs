import assert from "node:assert/strict";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const simulationTick = {
  id: "tick_memory_followup",
  locationId: "loc_xianxia_contract_gate",
  locationName: "四方法契门",
  visiblePressure: "入门者必须把本命物放在界石边。",
  privateSimulations: [
    {
      characterId: "char_a",
      characterName: "沈珩",
      privateDesire: "让对方承认灵契不能离场。",
      defensiveMask: "按城法扣契，不按宗门私仇。",
      tone: "惩罚",
      memorySource: "agent_dialogue_relationship",
      memorySharedObject: "灵契",
    },
    {
      characterId: "char_b",
      characterName: "阎无咎",
      privateDesire: "保住能翻案的证物。",
      defensiveMask: "我押的是灵契，不是命。",
      tone: "伪装",
      memorySource: "agent_dialogue_relationship",
      memorySharedObject: "灵契",
    },
  ],
};

const agentOutputs = [
  {
    outputId: "out_a",
    characterId: "char_a",
    targetCharacterId: "char_b",
    visibleAction: "沈珩扣住阎无咎面前的灵契，另一只手拦住阎无咎。",
  },
  {
    outputId: "out_b",
    characterId: "char_b",
    targetCharacterId: "char_a",
    visibleAction: "阎无咎没有接沈珩推来的灵契，把魔印压到铜盘边。",
    interactionInput: {
      sourceCharacterId: "char_a",
      sourceOutputId: "out_a",
      observedVisibleAction: "沈珩扣住阎无咎面前的灵契，另一只手拦住阎无咎。",
      sharedObject: "灵契",
    },
  },
];

const scene = runSceneInteractionSimulation({
  state: { characters: [] },
  simulationTick,
  agentOutputs,
});

const exchange = scene.agentExchanges[0];
const turns = exchange?.dialogueTurns || [];

assert.ok(
  turns.length >= 4,
  `relationship memory should continue the conversation past A-B-A, got ${turns.length} turns`,
);
assert.equal(turns[3].speakerId, "char_b", "fourth turn should let the responder push back after the counter");
assert.equal(turns[3].targetId, "char_a", "follow-up should target the initiating agent");
assert.equal(turns[3].respondsTo, turns[2].line, "follow-up should answer the immediate counter line");
assert.match(
  turns[3].line,
  /那|既然|凭|谁|还|别|先|灵契|魔印/,
  "follow-up line should be a concrete pushback, not a neutral narration",
);

console.log("agentMemoryFollowupDialogue:test passed", {
  turns,
});
