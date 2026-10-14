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
      dialogueMoves: ["那你要谁替你盖印？", "剑可以停，证据不能走。"],
    },
    publicGoal: "沈珩把灵契扣在铜盘前。",
    privateDesire: "逼阎无咎交代旧案证物。",
    defensiveMask: "按城法扣契。",
    shadowImpulse: "借城法留下人。",
  },
  {
    characterId: "char_yan",
    characterName: "阎无咎",
    targetCharacterId: "char_shen",
    targetCharacterName: "沈珩",
    tone: "伪装",
    agentProfile: {
      leverageObject: "毒誓符",
      dialogueMoves: ["我押的是灵契，不是命。", "旧案开口前，谁也别替我签。"],
    },
    publicGoal: "阎无咎把毒誓符压在铜盘边。",
    privateDesire: "不让沈珩替自己签押。",
    defensiveMask: "我押的是灵契，不是命。",
    shadowImpulse: "把问题推回城规。",
  },
];

const normalized = normalizeSceneInteraction({}, privateSimulations, { perCharacter: [] });
const text = normalized.sceneText || "";

assert.doesNotMatch(
  text,
  /场景未生成|沉默本身成为可见事件|SceneInteractionSimulator/,
  "sceneText fallback should not expose generic simulator placeholder language",
);
assert.match(text, /沈珩|阎无咎/, "sceneText fallback should name the exchange participants");
assert.match(text, /灵契|毒誓符|铜盘|界石|盖印/, "sceneText fallback should keep the concrete object/rule pressure");
assert.match(text, /“[^”]+”/, "sceneText fallback should include the generated dialogue as novel prose");
assert.match(text, /“那你要谁替你盖印？”/, "sceneText fallback should preserve question punctuation in generated dialogue");
assert.match(
  text,
  /没有接走|留给界石|名字没有写进盘边|留在两人中间/,
  "sceneText fallback should include the exchange outcome, not only isolated dialogue",
);

console.log("modelSceneFallbackSceneTextFromExchange:test passed", {
  sceneText: text,
});
