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
        { speakerId: "char_yan", targetId: "char_shen", line: "照出来的人，未必归你审。", turnRole: "turn" },
        { speakerId: "char_yan", targetId: "char_shen", line: "你想听供词，先把剑放低。", turnRole: "turn" },
      ],
      relationshipDeltas: [
        {
          fromCharacterId: "char_shen",
          toCharacterId: "char_yan",
          deltas: { resentment: 2, wantsToBeSeen: 2 },
          misreading: "沈珩把阎无咎的连说听成挑衅。",
          unspoken: "名字还没写出来。",
        },
      ],
    },
  ],
};

const normalized = normalizeSceneInteraction(parsed, privateSimulations, { perCharacter: [] });
const turns = normalized.agentExchanges[0]?.dialogueTurns || [];
const text = normalized.sceneText || "";

assert.equal(turns.length, 5, "normalization should preserve all model turns");
assert.equal(turns[3].speakerId, "char_yan", "fourth turn should stay with the responding character");
assert.equal(turns[4].speakerId, "char_yan", "fifth turn should also stay with the responding character instead of being forced back to source");
assert.equal(turns[4].targetId, "char_shen", "fifth turn should keep its intended target inside the locked pair");
assert.match(text, /阎无咎说：“你想听供词，先把剑放低。/, `sceneText should attribute the fifth line to阎无咎, got: ${text}`);
assert.doesNotMatch(text, /沈珩说：“你想听供词，先把剑放低。/, "sceneText should not misattribute the fifth line to沈珩");

console.log("modelSceneContinuationPreservesSpeaker:test passed", {
  turns,
  sceneText: text,
});
