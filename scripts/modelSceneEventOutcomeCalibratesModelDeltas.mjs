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
  },
];

const normalized = normalizeSceneInteraction({
  agentExchanges: [{
    sourceCharacterId: "char_shen",
    responseCharacterId: "char_yan",
    sourceCharacterName: "沈珩",
    responseCharacterName: "阎无咎",
    sharedObject: "灵契",
    generatedFrom: "model-agent-dialogue",
    eventOutcome: "阎无咎没有接走灵契，把灵契留给界石；盖印的人停在铜盘外。",
    dialogueTurns: [
      { speakerId: "char_shen", targetId: "char_yan", line: "按城法扣契，不按宗门私仇。", turnRole: "claim" },
      { speakerId: "char_yan", targetId: "char_shen", line: "我押的是灵契，不是命。", turnRole: "response" },
      { speakerId: "char_shen", targetId: "char_yan", line: "剑可以停，证据不能走。", turnRole: "counter" },
      { speakerId: "char_yan", targetId: "char_shen", line: "盖印的人先别进来，灵契留给界石。", turnRole: "turn" },
    ],
    relationshipDeltas: [
      {
        fromCharacterId: "char_shen",
        toCharacterId: "char_yan",
        deltas: { resentment: 1 },
        misreading: "沈珩把阎无咎的回应记成拖延。",
        unspoken: "证据不能走。",
      },
      {
        fromCharacterId: "char_yan",
        toCharacterId: "char_shen",
        deltas: { fear: 2, wantsToEscape: 2 },
        misreading: "阎无咎把沈珩的开口听成逼近。",
        unspoken: "先退开。",
      },
    ],
  }],
}, privateSimulations, { perCharacter: [] });

const responderShift = normalized.relationshipShift.find((shift) =>
  shift.fromCharacterId === "char_yan" && shift.toCharacterId === "char_shen"
);

assert.ok(responderShift, "normalized scene should keep responder-to-source relationship shift");
assert.ok(
  Number(responderShift.deltas?.power || 0) >= 2,
  "event-textured normalization should add relationship power when responder moves the dispute to the boundary rule",
);
assert.match(
  responderShift.misreading || "",
  /界石|盖印|铜盘|城规/,
  "event-textured normalization should replace generic misreading with the concrete rule object",
);

console.log("modelSceneEventOutcomeCalibratesModelDeltas:test passed", {
  responderShift,
});
