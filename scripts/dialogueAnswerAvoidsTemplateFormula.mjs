import assert from "node:assert/strict";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const source = {
  characterId: "char_shen",
  characterName: "沈珩",
  targetCharacterId: "char_yan",
  targetCharacterName: "阎无咎",
  tone: "惩罚",
  privateDesire: "逼阎无咎把旧案和价码分开说。",
  defensiveMask: "按城法扣契，不按宗门私仇。",
  agentProfile: {
    publicIdentity: "正道玄衡宗执律剑修",
    dramaticObjective: "守住正道审判扣押邪派证人的资格",
    leverageObject: "灵契",
    dialogueMoves: ["按城法扣契，不按宗门私仇。"],
  },
};

const target = {
  characterId: "char_yan",
  characterName: "阎无咎",
  targetCharacterId: "char_shen",
  targetCharacterName: "沈珩",
  tone: "伪装",
  privateDesire: "把旧案证物带出停剑城。",
  defensiveMask: "我押的是灵契，不是命。",
  agentProfile: {
    publicIdentity: "邪派血河楼使者",
    dramaticObjective: "带走能让血河楼翻案的证物",
    leverageObject: "魔印",
    dialogueMoves: ["我押的是灵契，不是命。"],
  },
};

const scene = runSceneInteractionSimulation({
  state: { characters: [] },
  simulationTick: {
    id: "tick_answer_formula",
    periodSlot: "上午",
    locationId: "loc_gate",
    locationName: "四方法契门",
    visiblePressure: "界石光贴着灵契，铜盘旁还有一枚未盖的印。",
    privateSimulations: [source, target],
  },
  agentOutputs: [
    {
      outputId: "out_shen",
      characterId: "char_shen",
      targetCharacterId: "char_yan",
      characterName: "沈珩",
      visibleAction: "沈珩把灵契推到铜盘中央。沈珩说：“按城法扣契，不按宗门私仇。”",
    },
    {
      outputId: "out_yan",
      characterId: "char_yan",
      targetCharacterId: "char_shen",
      characterName: "阎无咎",
      visibleAction: "阎无咎把魔印压到灵契旁。阎无咎说：“我押的是灵契，不是命。”",
      interactionInput: {
        sourceCharacterId: "char_shen",
        sourceOutputId: "out_shen",
        observedVisibleAction: "沈珩把灵契推到铜盘中央。沈珩说：“按城法扣契，不按宗门私仇。”",
        sharedObject: "灵契",
      },
    },
  ],
});

const lines = (scene.agentExchanges?.[0]?.dialogueTurns || []).map((turn) => turn.line || "").filter(Boolean);
assert.ok(lines.length >= 3, `local scene should produce an exchange, got:\n${JSON.stringify(scene.agentExchanges, null, 2)}`);

assert.doesNotMatch(
  lines.join("\n"),
  /我(?:先|只|不)?答|谁碰过它|谁要(?:拿走|带走)谁先(?:说清|交代)|谁先伸手谁先说名/,
  `agent dialogue should answer from concrete stakes, not expose answer templates:\n${lines.join("\n")}`,
);

console.log("dialogueAnswerAvoidsTemplateFormula:test passed", { lines });
