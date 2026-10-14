import assert from "node:assert/strict";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const simulationTick = {
  id: "tick_object_part_duplicate",
  locationId: "loc_contract_gate",
  locationName: "四方法契门",
  visiblePressure: "界石只认留在铜盘边的灵契。",
  privateSimulations: [
    {
      characterId: "shen",
      characterName: "沈珩",
      publicGoal: "按城法扣住灵契。",
      privateDesire: "让阎无咎承认证物不能离开铜盘。",
      defensiveMask: "灵契先留铜盘，宗门的人退到门槛外。",
      tone: "求证",
    },
    {
      characterId: "yan",
      characterName: "阎无咎",
      publicGoal: "保住旧案证物。",
      privateDesire: "不让灵契被写成正道审讯的证据。",
      defensiveMask: "灵契不走，人也不能被你一句话带走。",
      tone: "陷害",
    },
  ],
};

const scene = runSceneInteractionSimulation({
  state: { characters: [] },
  simulationTick,
  agentOutputs: [
    {
      outputId: "out_shen",
      characterId: "shen",
      targetCharacterId: "yan",
      visibleAction: "沈珩把灵契推到阎无咎面前，手指按住铜盘边缘。沈珩说：“灵契先留铜盘。”",
    },
    {
      outputId: "out_yan",
      characterId: "yan",
      targetCharacterId: "shen",
      visibleAction: "阎无咎先按住灵契的边角，再把它挪到铜盘边。阎无咎说：“灵契不走。”",
      interactionInput: {
        sourceCharacterId: "shen",
        sourceOutputId: "out_shen",
        observedVisibleAction: "沈珩把灵契推到阎无咎面前，手指按住铜盘边缘。沈珩说：“灵契先留铜盘。”",
        sharedObject: "灵契",
      },
    },
  ],
});

const text = (scene.agentExchanges || []).flatMap((exchange) => [
  exchange.eventOutcome || "",
  ...(exchange.dialogueTurns || []).map((turn) => turn.line || ""),
]).join("\n");

assert.doesNotMatch(text, /([^，。；\s]{1,12})的(?:边角|边缘)和\1/, "dialogue must not pair an object's part with the same object");
assert.doesNotMatch(text, /它和(?:灵契|妖丹盒|照骨镜|渡令|庇护牌)/, "dialogue must not pair a pronoun with the object it points to");
assert.doesNotMatch(text, /又把它留在旁边/, "same-object outcome should not treat the pronoun as another object");
assert.match(text, /灵契/, "the contested object should remain visible");

console.log("dialogueObjectPartNoDuplicate:test passed", { text });
