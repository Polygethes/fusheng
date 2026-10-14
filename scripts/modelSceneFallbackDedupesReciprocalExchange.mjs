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
      dramaticObjective: "扣押邪派证人。",
    },
    publicGoal: "验契并扣住灵契。",
    privateDesire: "逼阎无咎交出旧案证物。",
    defensiveMask: "按城法扣契，不按宗门私仇。",
    shadowImpulse: "借城法留下人。",
  },
  {
    characterId: "char_yan",
    characterName: "阎无咎",
    targetCharacterId: "char_shen",
    targetCharacterName: "沈珩",
    agentProfile: {
      leverageObject: "魔印",
      dialogueMoves: ["我押的是灵契，不是命。", "价码到了，旧案自然开口。"],
      dramaticObjective: "带走翻案证物。",
    },
    publicGoal: "换符并试价。",
    privateDesire: "带走能让血河楼翻案的证物。",
    defensiveMask: "我押的是灵契，不是命。",
    shadowImpulse: "把证据从正道审判里挪走。",
  },
];

const normalized = normalizeSceneInteraction({}, privateSimulations, { perCharacter: [] });
const pairKeys = (normalized.agentExchanges || []).map((exchange) =>
  [exchange.sourceCharacterId, exchange.responseCharacterId].sort().join("<->"),
);
const uniquePairKeys = new Set(pairKeys);
const exchange = normalized.agentExchanges?.[0];

assert.equal(
  normalized.agentExchanges?.length,
  uniquePairKeys.size,
  "fallback should not generate mirrored duplicate exchanges for the same character pair",
);
assert.equal(pairKeys.length, 1, "reciprocal targeting should collapse into one playable exchange");
assert.ok(exchange.dialogueTurns?.some((turn) => turn.speakerId === "char_shen"), "exchange should still include沈珩 speaking");
assert.ok(exchange.dialogueTurns?.some((turn) => turn.speakerId === "char_yan"), "exchange should still include阎无咎 speaking");
assert.ok(
  normalized.relationshipShift?.some((shift) => shift.fromCharacterId === "char_shen" && shift.toCharacterId === "char_yan"),
  "collapsed exchange should preserve沈珩到阎无咎的关系变化",
);
assert.ok(
  normalized.relationshipShift?.some((shift) => shift.fromCharacterId === "char_yan" && shift.toCharacterId === "char_shen"),
  "collapsed exchange should preserve阎无咎到沈珩的关系变化",
);

console.log("modelSceneFallbackDedupesReciprocalExchange:test passed", {
  exchanges: normalized.agentExchanges.length,
  pairKeys,
  shifts: normalized.relationshipShift.length,
});
