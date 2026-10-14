import assert from "node:assert/strict";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const simulationTick = {
  id: "tick_same_object_exchange",
  locationId: "loc_xianxia_contract_gate",
  locationName: "四方法契门",
  visiblePressure: "入城者必须把本命灵契押在界石边。",
  privateSimulations: [
    {
      characterId: "shen",
      characterName: "沈珩",
      privateDesire: "扣住阎无咎的灵契，逼他承认证物从血河楼来。",
      defensiveMask: "按城法扣契，不按宗门私仇。",
      shadowImpulse: "让守门人先盖印。",
    },
    {
      characterId: "yan",
      characterName: "阎无咎",
      privateDesire: "保住同一枚灵契里的旧案证词。",
      defensiveMask: "灵契不换手，价码才算活。",
      shadowImpulse: "把灵契从沈珩手下压回铜盘边。",
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
      visibleAction: "沈珩把灵契推到阎无咎面前，手指按住铜盘边缘。沈珩说：“灵契先留在门下。”",
    },
    {
      outputId: "out_yan",
      characterId: "yan",
      targetCharacterId: "shen",
      visibleAction: "阎无咎没有接沈珩递出的灵契，把它压回铜盘边。阎无咎说：“灵契不换手。”",
      interactionInput: {
        sourceCharacterId: "shen",
        sourceOutputId: "out_shen",
        observedVisibleAction: "沈珩把灵契推到阎无咎面前，手指按住铜盘边缘。沈珩说：“灵契先留在门下。”",
        sharedObject: "灵契",
      },
    },
  ],
});

const exchange = scene.agentExchanges[0];
const outcome = exchange?.eventOutcome || "";

assert.ok(exchange, "same-object action should still form an exchange");
assert.match(outcome, /灵契/, "outcome should keep the contested object");
assert.doesNotMatch(outcome, /把它(?:压回|收回|留在|推回)|递出的它|推来的它/, "same-object outcome should name the concrete object instead of using awkward standalone pronoun");
assert.doesNotMatch(outcome, /把([^，。；\s]{1,16})压到\1旁/, "outcome must not place an object beside itself");
assert.doesNotMatch(outcome, /两件东西/, "outcome must not invent a second object when both agents contest the same object");
assert.match(outcome, /两人之间|两人中间|铜盘|原处|场中/, "outcome should describe where the single contested object ends up");

console.log("eventOutcomeSameObjectNoSelfBeside:test passed", { outcome });
