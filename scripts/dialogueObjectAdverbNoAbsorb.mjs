import assert from "node:assert/strict";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const simulationTick = {
  id: "tick_object_adverb",
  locationId: "loc_xianxia_market",
  locationName: "无咎市",
  visiblePressure: "摊主只认压到案台边的物件。",
  privateSimulations: [
    {
      characterId: "shen",
      characterName: "沈珩",
      privateDesire: "把妖丹盒留作证据。",
      defensiveMask: "妖丹盒先留案台。",
      tone: "求证",
    },
    {
      characterId: "yan",
      characterName: "阎无咎",
      privateDesire: "用符换走妖丹盒。",
      defensiveMask: "符先入账，旧案才开口。",
      tone: "伪装",
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
      visibleAction: "沈珩把妖丹盒推到阎无咎面前。沈珩说：“妖丹盒先留案台。”",
    },
    {
      outputId: "out_yan",
      characterId: "yan",
      targetCharacterId: "shen",
      visibleAction: "阎无咎把一枚符慢慢推到案台边。阎无咎说：“符先入账。”",
      interactionInput: {
        sourceCharacterId: "shen",
        sourceOutputId: "out_shen",
        observedVisibleAction: "沈珩把妖丹盒推到阎无咎面前。沈珩说：“妖丹盒先留案台。”",
        sharedObject: "妖丹盒",
      },
    },
  ],
});

const text = (scene.agentExchanges || []).flatMap((exchange) => [
  exchange.eventOutcome || "",
  ...(exchange.dialogueTurns || []).map((turn) => turn.line || ""),
]).join("\n");

assert.doesNotMatch(text, /(?:灵契|妖丹盒|照骨镜|渡令|庇护牌|符)(?:慢慢|轻轻|重重)/, "object names must not absorb action adverbs");
assert.match(text, /符/, "the response object should still be present");

console.log("dialogueObjectAdverbNoAbsorb:test passed", { text });
