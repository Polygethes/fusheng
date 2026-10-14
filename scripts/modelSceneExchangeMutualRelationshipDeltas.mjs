import assert from "node:assert/strict";
import { normalizeSceneInteraction } from "../src/server/pipeline/sceneInteractionSimulator.mjs";

const privateSimulations = [
  {
    characterId: "char_shen",
    characterName: "沈珩",
    targetCharacterId: "char_yan",
    targetCharacterName: "阎无咎",
    tone: "惩罚",
    publicGoal: "扣住灵契。",
    privateDesire: "逼阎无咎继续解释。",
    defensiveMask: "按城法扣契，不按宗门私仇。",
    shadowImpulse: "把对方的迟疑压成证据。",
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
    tone: "伪装",
    publicGoal: "把魔印留在灯影里。",
    privateDesire: "把证物带离正道审判。",
    defensiveMask: "我押的是灵契，不是命。",
    shadowImpulse: "让旧案价码变成退路。",
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
    eventOutcome: "沈珩把灵契推到铜盘边，阎无咎没有拿走。",
    dialogueTurns: [
      { speakerId: "char_shen", targetId: "char_yan", line: "按城法扣契，不按宗门私仇。", turnRole: "claim" },
      { speakerId: "char_yan", targetId: "char_shen", line: "我押的是灵契，不是命。", turnRole: "response" },
      { speakerId: "char_shen", targetId: "char_yan", line: "剑可以停，证据不能走。", turnRole: "counter" },
    ],
    relationshipDeltas: [
      {
        fromCharacterId: "char_shen",
        toCharacterId: "char_yan",
        deltas: { resentment: 3, wantsToBeSeen: 2 },
        misreading: "沈珩把阎无咎的回话记成拖延。",
        unspoken: "证据不能走。",
      },
    ],
  }],
}, privateSimulations, { perCharacter: [] });

const forward = normalized.relationshipShift.find((shift) =>
  shift.generatedFrom === "model-agent-dialogue"
  && shift.fromCharacterId === "char_shen"
  && shift.toCharacterId === "char_yan"
);
const reverse = normalized.relationshipShift.find((shift) =>
  shift.generatedFrom === "model-agent-dialogue"
  && shift.fromCharacterId === "char_yan"
  && shift.toCharacterId === "char_shen"
);

assert.ok(forward, "dialogue exchange should keep the model-provided source-to-target relationship shift");
assert.ok(reverse, "dialogue exchange should synthesize the missing responder-to-source relationship shift");
assert.equal(reverse.sharedObject, "灵契", "synthesized reverse shift should preserve the contested object");
assert.equal(reverse.eventOutcome, forward.eventOutcome, "synthesized reverse shift should point to the same event outcome");
assert.equal(reverse.dialogueTurnCount, 3, "synthesized reverse shift should preserve dialogue turn count");
assert.deepEqual(
  reverse.dialogueTurns.map((turn) => turn.line),
  normalized.agentExchanges[0].dialogueTurns.map((turn) => turn.line),
  "synthesized reverse shift should preserve the complete exchange turns",
);
assert.match(
  `${reverse.misreading} ${reverse.unspoken}`,
  /阎无咎|沈珩|灵契|证据|逼近|拖延|回话/,
  "synthesized reverse shift should be grounded in the same dialogue stakes",
);

console.log("modelSceneExchangeMutualRelationshipDeltas:test passed", {
  forward: forward.deltas,
  reverse: reverse.deltas,
});
