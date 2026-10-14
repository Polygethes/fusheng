import assert from "node:assert/strict";
import { normalizeSceneInteraction } from "../src/server/pipeline/sceneInteractionSimulator.mjs";

const privateSimulations = [
  {
    characterId: "char_shen",
    characterName: "沈珩",
    targetCharacterId: "char_yan",
    targetCharacterName: "阎无咎",
    agentProfile: {
      leverageObject: "灵契",
      dialogueMoves: ["按城法扣契，不按宗门私仇。", "剑可以停，证据不能走。"],
    },
    defensiveMask: "按城法扣契，不按宗门私仇。",
  },
  {
    characterId: "char_yan",
    characterName: "阎无咎",
    targetCharacterId: "char_shen",
    targetCharacterName: "沈珩",
    agentProfile: {
      leverageObject: "魔印",
      dialogueMoves: ["我押的是灵契，不是命。", "价码到了，旧案自然开口。"],
    },
    defensiveMask: "我押的是灵契，不是命。",
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
        { speakerId: "char_shen", targetId: "char_yan", line: "我审的是灵契，不是你。", turnRole: "turn" },
      ],
      relationshipDeltas: [
        {
          fromCharacterId: "char_shen",
          toCharacterId: "char_yan",
          deltas: { resentment: 2, wantsToBeSeen: 2 },
          misreading: "沈珩把阎无咎的回避听成挑衅。",
          unspoken: "名字还没写出来。",
        },
        {
          fromCharacterId: "char_yan",
          toCharacterId: "char_shen",
          deltas: { fear: 1, deception: 2 },
          misreading: "阎无咎把沈珩的追问听成扣押。",
          unspoken: "名字还没写出来。",
        },
      ],
    },
  ],
};

const normalized = normalizeSceneInteraction(parsed, privateSimulations, { perCharacter: [] });
const text = normalized.sceneText || "";

assert.equal(normalized.agentExchanges[0]?.dialogueTurns?.length, 5, "normalization should preserve all five model dialogue turns");
assert.match(text, /你把名字藏在哪一页/, `sceneText should include the first turn, got: ${text}`);
assert.match(text, /照出来的人，未必归你审/, `sceneText should include the fourth turn, got: ${text}`);
assert.match(text, /我审的是灵契，不是你/, `sceneText should include the fifth turn instead of truncating long dialogue, got: ${text}`);
assert.ok(
  normalized.relationshipShift.some((shift) => shift.dialogueTurnCount === 5 && shift.finalTurn === "我审的是灵契，不是你。"),
  "relationship shifts should still remember the fifth turn as the final turn",
);
assert.ok(
  normalized.relationshipShift.some((shift) => shift.dialogueTurnCount === 5 && shift.followupTurn === "我审的是灵契，不是你。"),
  "relationship shifts should remember the latest continuation turn, not the first continuation turn",
);

console.log("modelSceneTextPreservesLongDialogue:test passed", {
  sceneText: text,
  turns: normalized.agentExchanges[0].dialogueTurns.length,
});
