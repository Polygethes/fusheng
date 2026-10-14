import assert from "node:assert/strict";
import { normalizeSceneInteraction } from "../src/server/pipeline/sceneInteractionSimulator.mjs";

const privateSimulations = [
  {
    characterId: "char_shen",
    characterName: "沈珩",
    targetCharacterId: "char_yan",
    targetCharacterName: "阎无咎",
    tone: "伪装",
    agentProfile: {
      leverageObject: "灵契",
      dialogueMoves: ["那你要谁替你盖印？", "剑可以停，证据不能走。"],
    },
    defensiveMask: "那你要谁替你盖印？",
    privateDesire: "逼阎无咎承认谁在借城规改写证词。",
  },
  {
    characterId: "char_yan",
    characterName: "阎无咎",
    targetCharacterId: "char_shen",
    targetCharacterName: "沈珩",
    tone: "撤退",
    agentProfile: {
      leverageObject: "毒誓符",
      dialogueMoves: ["我押的是灵契，不是命。", "旧案开口前，谁也别替我签。"],
    },
    defensiveMask: "我押的是灵契，不是命。",
    privateDesire: "不让沈珩把签押改成正道审判。",
  },
];

const normalized = normalizeSceneInteraction({}, privateSimulations, { perCharacter: [] });
const exchange = normalized.agentExchanges[0] || {};
const turns = exchange.dialogueTurns || [];
const response = turns[1]?.line || "";
const responderShift = (exchange.relationshipDeltas || []).find((shift) =>
  shift.fromCharacterId === "char_yan" && shift.toCharacterId === "char_shen"
);

assert.match(turns[0]?.line || "", /谁.*盖印/, "fallback should preserve the initiating question");
assert.equal(turns[1]?.respondsTo, turns[0]?.line, "response turn should point to the exact initiating line");
assert.match(
  response,
  /盖印|谁|名字|签|界石|不写/,
  `response should answer the immediate question instead of only speaking a stance slogan, got: ${response}`,
);
assert.notEqual(
  response,
  "我押的是灵契，不是命。",
  "response should not be only the responder's first stock dialogue move",
);
assert.match(
  turns[2]?.line || "",
  /名字|盖印|界石|毒誓符|灵契/,
  `counter turn should answer the responder's concrete reply, got: ${turns[2]?.line}`,
);
assert.notEqual(
  turns[2]?.line,
  "剑可以停，证据不能走。",
  "counter turn should not be only the initiator's second stock dialogue move",
);
assert.match(
  exchange.eventOutcome || "",
  /界石|盖印|名字/,
  `event outcome should be derived from the concrete turn-taking stakes, got: ${exchange.eventOutcome}`,
);
assert.ok(
  Number(responderShift?.deltas?.power || 0) >= 3,
  `responder should gain relationship power by moving the answer through city rules, got: ${JSON.stringify(responderShift?.deltas)}`,
);
assert.match(
  responderShift?.misreading || "",
  /解释权|城规|界石|盖印/,
  "relationship misreading should remember how the answer seized city-rule authority",
);

console.log("modelSceneFallbackRespondsToQuestion:test passed", {
  question: turns[0]?.line,
  response,
  counter: turns[2]?.line,
  outcome: exchange.eventOutcome,
  responderShift: responderShift?.deltas,
});
