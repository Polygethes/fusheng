import assert from "node:assert/strict";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const simulationTick = {
  id: "tick_counter_not_formulaic",
  locationId: "loc_contract_gate",
  locationName: "四方法契门",
  visiblePressure: "界石旁的铜盘只照见还没盖印的灵契。",
  privateSimulations: [
    {
      characterId: "char_shen",
      characterName: "沈珩",
      privateDesire: "让阎无咎承认灵契不能被带离铜盘。",
      defensiveMask: "剑可以停，证据不能走。",
      shadowImpulse: "把审讯权先压到自己手里。",
    },
    {
      characterId: "char_yan",
      characterName: "阎无咎",
      privateDesire: "让灵契留在桌面，但不交给沈珩。",
      defensiveMask: "灵契可以验，不能离开桌面。",
      shadowImpulse: "把旧案拖到盖印之前。",
    },
  ],
};

const scene = runSceneInteractionSimulation({
  state: { characters: [] },
  simulationTick,
  agentOutputs: [
    {
      outputId: "out_shen",
      characterId: "char_shen",
      targetCharacterId: "char_yan",
      characterName: "沈珩",
      visibleAction: "沈珩扣住阎无咎面前的灵契，把灵契推到界石前。沈珩说：“剑可以停，证据不能走。”",
    },
    {
      outputId: "out_yan",
      characterId: "char_yan",
      targetCharacterId: "char_shen",
      characterName: "阎无咎",
      visibleAction: "阎无咎挡住沈珩和灵契之间的空隙，把灵契往铜盘边推回去。阎无咎说：“灵契可以验，不能离开桌面。”",
      interactionInput: {
        sourceCharacterId: "char_shen",
        sourceOutputId: "out_shen",
        observedVisibleAction: "沈珩扣住阎无咎面前的灵契，把灵契推到界石前。沈珩说：“剑可以停，证据不能走。”",
        sharedObject: "灵契",
      },
    },
  ],
});

const turns = scene.agentExchanges?.[0]?.dialogueTurns || [];
const response = turns.find((turn) => turn.turnRole === "response");
const counter = turns.find((turn) => turn.turnRole === "counter");

assert.ok(response, "local exchange should include a responding-agent turn");
assert.doesNotMatch(response.line, /可以验[\s\S]*可以验|不能离开[\s\S]*不能离开/, `response should not duplicate the same procedural clause, got: ${response.line}`);
assert.ok(counter, "local exchange should include an initiating-agent counter turn");
assert.match(counter.line, /灵契/, "counter should still answer through the contested object");
assert.match(counter.line, /桌面|铜盘|界石|盖印|名字|写清楚|离开/, "counter should make a concrete decision about the object or procedure");
assert.doesNotMatch(
  counter.line,
  /^先压住.+。人可以退，.+不走。?$/,
  `counter should not use the stock retention formula, got: ${counter.line}`,
);

const splitObjectScene = runSceneInteractionSimulation({
  state: { characters: [] },
  simulationTick,
  agentOutputs: [
    {
      outputId: "out_split_shen",
      characterId: "char_shen",
      targetCharacterId: "char_yan",
      characterName: "沈珩",
      visibleAction: "沈珩扣住阎无咎面前的灵契，把灵契推到界石前。沈珩说：“按城规，证据不能走。”",
    },
    {
      outputId: "out_split_yan",
      characterId: "char_yan",
      targetCharacterId: "char_shen",
      characterName: "阎无咎",
      visibleAction: "阎无咎把一枚符压到灵契旁，袖口遮住半道黑痕。阎无咎说：“符先压到盘边，我押的是灵契，不是命。”",
      interactionInput: {
        sourceCharacterId: "char_shen",
        sourceOutputId: "out_split_shen",
        observedVisibleAction: "沈珩扣住阎无咎面前的灵契，把灵契推到界石前。沈珩说：“按城规，证据不能走。”",
        sharedObject: "灵契",
      },
    },
  ],
});

const splitCounter = splitObjectScene.agentExchanges?.[0]?.dialogueTurns?.find((turn) => turn.turnRole === "counter");
const allLines = [
  ...turns,
  ...(splitObjectScene.agentExchanges?.[0]?.dialogueTurns || []),
].map((turn) => turn.line || "");
for (const line of allLines) {
  assert.equal(repeatedAdjacentDialogueFragment(line), "", `dialogue should not repeat the same short clause back to back: ${line}`);
}
assert.ok(splitCounter, "split-object exchange should include a counter turn");
assert.match(splitCounter.line, /符/, "split-object counter should answer the responder's introduced object");
assert.match(splitCounter.line, /灵契/, "split-object counter should keep the original contested object in play");
assert.match(splitCounter.line, /盘边|界石|盖印|袖口|桌面|写清楚/, "split-object counter should make a concrete procedural move");
assert.doesNotMatch(
  splitCounter.line,
  /^.+留下，.+也留下；谁先带走谁先改口。?$/,
  `split-object counter should not use the stock dual-retention formula, got: ${splitCounter.line}`,
);

console.log("localCounterDialogueNotFormulaic:test passed", {
  turns,
  splitTurns: splitObjectScene.agentExchanges?.[0]?.dialogueTurns || [],
});

function repeatedAdjacentDialogueFragment(line = "") {
  const fragments = String(line || "")
    .split(/[，,。！？；;]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && part.length <= 18)
    .filter((part) => /先|也|不能|可以|要|得|不|留|压|验|写|走/.test(part));
  for (let index = 1; index < fragments.length; index += 1) {
    if (fragments[index] === fragments[index - 1]) return fragments[index];
  }
  return "";
}
