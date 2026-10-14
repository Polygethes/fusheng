import assert from "node:assert/strict";
import { normalizeSceneInteraction } from "../src/server/pipeline/sceneInteractionSimulator.mjs";

const privateSimulations = [
  {
    characterId: "char_shen",
    characterName: "沈珩",
    targetCharacterId: "char_yan",
    targetCharacterName: "阎无咎",
    agentProfile: { leverageObject: "灵契", dialogueMoves: ["按城法扣契，不按宗门私仇。"] },
  },
  {
    characterId: "char_yan",
    characterName: "阎无咎",
    targetCharacterId: "char_shen",
    targetCharacterName: "沈珩",
    agentProfile: { leverageObject: "魔印", dialogueMoves: ["我押的是灵契，不是命。"] },
  },
];

const parsed = {
  sceneText: "铜盘边安静了一下，界石的光压在门槛上。",
  agentExchanges: [
    {
      sourceCharacterId: "char_shen",
      responseCharacterId: "char_yan",
      sourceCharacterName: "沈珩",
      responseCharacterName: "阎无咎",
      sharedObject: "灵契",
      eventOutcome: "阎无咎没有接走灵契，把灵契压回铜盘边。",
      dialogueTurns: [
        { speakerId: "char_shen", targetId: "char_yan", line: "你把名字藏在哪一页？", turnRole: "claim" },
        { speakerId: "char_yan", targetId: "char_shen", line: "名字不在账册里。", turnRole: "response" },
        { speakerId: "char_shen", targetId: "char_yan", line: "那就让界石照你袖口。", turnRole: "counter" },
      ],
      relationshipDeltas: [
        {
          fromCharacterId: "char_shen",
          toCharacterId: "char_yan",
          deltas: { resentment: 2, wantsToBeSeen: 2 },
          misreading: "沈珩把阎无咎的回避听成挑衅。",
          unspoken: "名字还没写出来。",
        },
      ],
    },
  ],
};

const normalized = normalizeSceneInteraction(parsed, privateSimulations, { perCharacter: [] });
const text = normalized.sceneText || "";

assert.match(text, /铜盘边安静了一下/, `sceneText should preserve model prose, got: ${text}`);
assert.match(text, /沈珩说：“你把名字藏在哪一页？/, `sceneText should include structured exchange dialogue, got: ${text}`);
assert.match(text, /阎无咎说：“名字不在账册里。/, `sceneText should include the response turn, got: ${text}`);
assert.match(text, /那就让界石照你袖口/, `sceneText should include the counter turn, got: ${text}`);
assert.match(text, /阎无咎没有接走灵契/, `sceneText should include the exchange outcome, got: ${text}`);

console.log("modelSceneTextMergesAgentExchangeDialogue:test passed", {
  sceneText: text,
});
