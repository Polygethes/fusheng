import assert from "node:assert/strict";
import { normalizeSceneInteraction } from "../src/server/pipeline/sceneInteractionSimulator.mjs";

const privateSimulations = [
  {
    characterId: "char_shen",
    characterName: "沈珩",
    targetCharacterId: "char_yan",
    targetCharacterName: "阎无咎",
    tone: "求证",
    agentProfile: {
      leverageObject: "灵契",
      dialogueMoves: ["按城法扣契，不按宗门私仇。", "剑可以停，证据不能走。"],
    },
    defensiveMask: "按城法扣契，不按宗门私仇。",
    privateDesire: "让阎无咎承认旧案证物不能离开四方法契门。",
  },
  {
    characterId: "char_yan",
    characterName: "阎无咎",
    targetCharacterId: "char_shen",
    targetCharacterName: "沈珩",
    tone: "伪装",
    agentProfile: {
      leverageObject: "魔印",
      dialogueMoves: ["我押的是灵契，不是命。", "价码到了，旧案自然开口。"],
    },
    defensiveMask: "我押的是灵契，不是命。",
    privateDesire: "不让沈珩替停剑城决定名字和盖印。",
    actionCandidate: "阎无咎借界石、盖印人和灵契，把沈珩逼回城规流程里。",
    planNextAction: "阎无咎借界石、盖印人和灵契，把沈珩逼回城规流程里。",
    planInfluence: [
      "当前自主计划压力：阎无咎 -> 沈珩 / 控局计划",
      "当前策略：control；下一动作偏向：伪装；计划动作：夺回解释权",
      "短期：阎无咎下一步要从沈珩手里夺回解释权：关系变化来自未结清对话：名字先不写。",
      "立即目标：借界石、盖印人和灵契，把沈珩逼回城规流程里。",
    ].join("\n"),
  },
];

const normalized = normalizeSceneInteraction({}, privateSimulations, { perCharacter: [] });
const exchange = normalized.agentExchanges[0] || {};
const turns = exchange.dialogueTurns || [];
const response = turns[1]?.line || "";
const responderShift = (exchange.relationshipDeltas || []).find((shift) =>
  shift.fromCharacterId === "char_yan" && shift.toCharacterId === "char_shen"
);

assert.notEqual(
  response,
  "我押的是灵契，不是命。",
  "control-plan responder should not fall back to the first stock dialogue move",
);
assert.match(
  response,
  /界石|盖印|解释权|名字|城规流程/,
  `control-plan responder should speak from the active plan pressure, got: ${response}`,
);
assert.match(
  exchange.eventOutcome || "",
  /界石|盖印|名字|城规/,
  `control-plan response should become a concrete changed event, got: ${exchange.eventOutcome}`,
);
assert.ok(
  Number(responderShift?.deltas?.power || 0) >= 3,
  `control-plan responder should gain relationship power by seizing rule interpretation, got: ${JSON.stringify(responderShift?.deltas)}`,
);
assert.match(
  responderShift?.misreading || "",
  /解释权|城规|界石|盖印/,
  "relationship shift should remember the control move as a fight over rule interpretation",
);

console.log("modelSceneControlPlanDialogue:test passed", {
  response,
  eventOutcome: exchange.eventOutcome,
  responderShift: responderShift?.deltas,
});
