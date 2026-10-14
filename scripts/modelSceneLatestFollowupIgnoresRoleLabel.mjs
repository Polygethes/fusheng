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
      eventOutcome: "灵契被压在铜盘边，名字没有写进账册。",
      dialogueTurns: [
        { speakerId: "char_shen", targetId: "char_yan", line: "账册翻到哪一页？", turnRole: "claim" },
        { speakerId: "char_yan", targetId: "char_shen", line: "没有那一页。", turnRole: "response" },
        { speakerId: "char_shen", targetId: "char_yan", line: "那就从灵契开始写。", turnRole: "counter" },
        { speakerId: "char_yan", targetId: "char_shen", line: "写下去，血河楼也会看见。", turnRole: "turn" },
        { speakerId: "char_shen", targetId: "char_yan", line: "我就是要他们看见。", turnRole: "response" },
      ],
      relationshipDeltas: [
        {
          fromCharacterId: "char_shen",
          toCharacterId: "char_yan",
          deltas: { resentment: 2, wantsToBeSeen: 2 },
          misreading: "沈珩把阎无咎的警告听成退缩。",
          unspoken: "账册还没写。",
        },
        {
          fromCharacterId: "char_yan",
          toCharacterId: "char_shen",
          deltas: { fear: 1, deception: 2 },
          misreading: "阎无咎把沈珩的坚持听成扣押。",
          unspoken: "账册还没写。",
        },
      ],
    },
  ],
};

const normalized = normalizeSceneInteraction(parsed, privateSimulations, { perCharacter: [] });
const shift = normalized.relationshipShift.find((item) =>
  item.dialogueTurnCount === 5
  && item.fromCharacterId === "char_shen"
  && item.toCharacterId === "char_yan"
);

assert.ok(shift, "long model dialogue should create a relationship shift");
assert.equal(shift.finalTurn, "我就是要他们看见。", "finalTurn should use the last spoken line");
assert.equal(
  shift.followupTurn,
  "我就是要他们看见。",
  "followupTurn should use the latest spoken line after the counter even when the model role label is not turn",
);
assert.match(
  normalized.sceneText || "",
  /我就是要他们看见/,
  "sceneText should also show the latest line",
);

console.log("modelSceneLatestFollowupIgnoresRoleLabel:test passed", {
  followupTurn: shift.followupTurn,
  finalTurn: shift.finalTurn,
});
