import assert from "node:assert/strict";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const conductorSignal = {
  beatId: "period_beat_day_1",
  delivery: "in_world_clue",
  inWorldClue: "入口处的灯先亮起来",
  object: "灵契",
  pressureCue: "灵契被推到众人能看见的位置",
  target: "让四方法契门里先出现一个会改变站位的灵契",
};

const simulationTick = {
  id: "tick_signal_continuation",
  locationId: "loc_xianxia_contract_gate",
  locationName: "四方法契门",
  visiblePressure: "入城者必须把本命灵契押在铜盘里。",
  privateSimulations: [
    {
      characterId: "char_shen",
      characterName: "沈珩",
      privateDesire: "扣住邪派证人，让城法承认正道仍能审案。",
      defensiveMask: "按城法扣契，不按宗门私仇。",
      shadowImpulse: "把对方困在自己能命名的程序里。",
      contradictionScore: 78,
      tone: "惩罚",
    },
    {
      characterId: "char_yan",
      characterName: "阎无咎",
      privateDesire: "带走能翻案的证物，同时不把命交给正道。",
      defensiveMask: "我押的是灵契，不是命。",
      shadowImpulse: "用交易把审讯拖成价码。",
      contradictionScore: 82,
      tone: "伪装",
    },
  ],
};

const agentOutputs = [
  {
    outputId: "out_shen",
    characterId: "char_shen",
    targetCharacterId: "char_yan",
    visibleAction: "入口处的灯先亮起来。 沈珩扣住阎无咎面前的灵契，另一只手拦住阎无咎。沈珩说：“按城法扣契，不按宗门私仇。”",
    tone: "惩罚",
    conductorSignal,
  },
  {
    outputId: "out_yan",
    characterId: "char_yan",
    targetCharacterId: "char_shen",
    visibleAction: "阎无咎挡住沈珩和灵契之间的空隙，把毒誓符压到铜盘边。阎无咎说：“我押的是灵契，不是命。”",
    tone: "伪装",
    interactionInput: {
      sourceCharacterId: "char_shen",
      sourceOutputId: "out_shen",
      observedVisibleAction: "入口处的灯先亮起来。 沈珩扣住阎无咎面前的灵契，另一只手拦住阎无咎。沈珩说：“按城法扣契，不按宗门私仇。”",
      sharedObject: "灵契",
    },
  },
];

const scene = runSceneInteractionSimulation({
  state: { characters: [] },
  simulationTick,
  agentOutputs,
});

const exchange = scene.agentExchanges[0];
const turns = exchange?.dialogueTurns || [];
const turnLines = turns.map((turn) => turn.line).join("\n");

assert.ok(exchange, "signal-shaped agent actions should create an exchange");
assert.ok(turns.length >= 4, "conductor signal should let the exchange continue beyond fixed claim-response-counter turns");
assert.equal(turns.at(-1).speakerId, "char_yan", "the responder should get a real follow-up turn");
assert.equal(turns.at(-1).turnRole, "turn", "the extra turn should be marked as a continuing turn");
assert.equal(turns.at(-1).triggeredBy, conductorSignal.inWorldClue, "the follow-up turn should remember the in-world trigger");
assert.match(turns.at(-1).respondsTo || "", /灵契|毒誓符|名字|铜盘|界石/, "the follow-up should answer the prior counter turn");
assert.match(turns.at(-1).line, /灵契|毒誓符|铜盘|名字|界石|城契|保证|来源/, "the follow-up should stay inside the same scene stakes");
assert.doesNotMatch(turns.at(-1).line, /入口处的灯先亮起来/, "the character should not recite the conductor cue verbatim");
assert.ok(
  !/([\u4e00-\u9fa5A-Za-z0-9]{2,8})留在这里，\1也别走/.test(turns.at(-1).line),
  "the follow-up should not mechanically repeat the same object in one sentence",
);
assert.ok(!/先等一下|现在不是说这个的时候|没有别的办法|已经动了/.test(turnLines), "the continuation should not use generic filler");

const directShift = exchange.relationshipDeltas.find((shift) => shift.fromCharacterId === "char_shen" && shift.toCharacterId === "char_yan");
assert.ok(directShift, "exchange should generate relationship deltas");
assert.equal(directShift.dialogueTurnCount, turns.length, "relationship memory should count the continued dialogue");
assert.equal(directShift.finalTurn, turns.at(-1).line, "relationship memory should store the last free turn as finalTurn");
assert.equal(directShift.followupTurn, turns.at(-1).line, "relationship memory should expose the extra turn as followupTurn");

console.log("conductorDialogueContinuation:test passed", {
  turns,
  outcome: exchange.eventOutcome,
  finalTurn: directShift.finalTurn,
});
