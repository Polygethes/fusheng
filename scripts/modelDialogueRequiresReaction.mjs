import assert from "node:assert/strict";
import {
  applyAgentDialogueProtocolToScene,
  buildModelAgentDialogueProtocol,
} from "../src/server/pipeline/openaiPipeline.mjs";

const compact = {
  selectedLocation: { id: "loc_square", name: "广场" },
  activeCharacters: [
    { id: "char_a", name: "甲", agentProfile: { leverageObject: "药瓶", dialogueMoves: ["那瓶药送去哪儿？"] } },
    { id: "char_b", name: "乙", agentProfile: { leverageObject: "货单", dialogueMoves: ["我得先把货送到城门。"] } },
    { id: "char_c", name: "丙", agentProfile: { leverageObject: "潮汐表", dialogueMoves: ["码头快封了。"] } },
  ],
  activeCharacterIds: ["char_a", "char_b", "char_c"],
  relationships: [],
  activeCharacterMemories: [],
  activeCharacterPlans: [],
  ui: {},
};

const privateSimulations = [
  {
    characterId: "char_a",
    characterName: "甲",
    targetCharacterId: "char_b",
    targetCharacterName: "乙",
    publicGoal: "清点药瓶",
    privateDesire: "准时交账",
    currentActivity: "清点药瓶",
    reactionIntent: "continue",
    agentProfile: compact.activeCharacters[0].agentProfile,
  },
  {
    characterId: "char_b",
    characterName: "乙",
    targetCharacterId: "char_a",
    targetCharacterName: "甲",
    publicGoal: "把货送到城门",
    privateDesire: "赶在关门前交货",
    currentActivity: "送货",
    reactionIntent: "continue",
    agentProfile: compact.activeCharacters[1].agentProfile,
  },
  {
    characterId: "char_c",
    characterName: "丙",
    targetCharacterId: "char_a",
    targetCharacterName: "甲",
    publicGoal: "赶去码头",
    privateDesire: "赶上最后一班船",
    currentActivity: "离开广场",
    reactionIntent: "leave",
    presenceIntent: "leave",
    agentProfile: compact.activeCharacters[2].agentProfile,
  },
];

const quiet = buildModelAgentDialogueProtocol(compact, privateSimulations);
assert.equal(quiet.agentExchanges.length, 0, "parallel private agents choosing continue must not be rewritten into dialogue");
assert.equal(quiet.privateSimulations[0].currentActivity?.description, "清点药瓶", "the reaction gate should carry the current activity into the next stage");
assert.equal(quiet.privateSimulations[0].cognitiveDecision?.reaction, "continue");

const blockedScene = applyAgentDialogueProtocolToScene({
  sceneText: "三个人各自做事。",
  agentExchanges: [{ sourceCharacterId: "char_a", responseCharacterId: "char_b", dialogueTurns: [{ speakerId: "char_a", line: "模型擅自补了一句。" }] }],
}, quiet.agentExchanges);
assert.deepEqual(blockedScene.agentExchanges, [], "the shared scene cannot invent speech after agents declined to talk");

const talking = privateSimulations.map((item) => ({ ...item }));
Object.assign(talking[0], {
  reactionIntent: "talk",
  reactionTargetCharacterId: "char_b",
  reactionReason: "乙拿走了最后一瓶药。",
  conversationObjective: "问清药瓶去向",
  conversationEndCondition: "乙说明去向或明确拒绝",
});
Object.assign(talking[1], { reactionIntent: "respond", reactionTargetCharacterId: "char_a" });

const spoken = buildModelAgentDialogueProtocol(compact, talking);
assert.equal(spoken.agentExchanges.length, 1, "one explicit initiation should create one conversation");
assert.deepEqual(
  new Set(spoken.agentExchanges[0].dialogueTurns.map((turn) => turn.speakerId)),
  new Set(["char_a", "char_b"]),
  "the unrelated third agent must not be pulled into the exchange",
);
assert.match(spoken.agentExchanges[0].conversationEndCondition, /说明|拒绝/);

console.log("modelDialogueRequiresReaction:test passed", {
  quietExchangeCount: quiet.agentExchanges.length,
  spokenExchangeCount: spoken.agentExchanges.length,
});
