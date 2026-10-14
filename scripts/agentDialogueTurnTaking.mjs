import assert from "node:assert/strict";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const simulationTick = {
  id: "tick_dialogue_turn_taking",
  locationId: "loc_xianxia_contract_gate",
  locationName: "四方法契门",
  visiblePressure: "入门者必须把本命物放在界石边。",
  privateSimulations: [
    {
      characterId: "char_a",
      characterName: "甲",
      privateDesire: "逼乙承认杯里的水被换过。",
      defensiveMask: "我只看杯口。",
      shadowImpulse: "把乙困在桌边。",
    },
    {
      characterId: "char_b",
      characterName: "乙",
      privateDesire: "保住红绳里的名字。",
      defensiveMask: "绳子在，话才算数。",
      shadowImpulse: "把杯子从证据里挪走。",
    },
  ],
};

const agentOutputs = [
  {
    outputId: "out_a",
    characterId: "char_a",
    targetCharacterId: "char_b",
    visibleAction: "甲把青瓷杯推到乙面前，杯沿还沾着水。甲说：“先看杯口。”",
  },
  {
    outputId: "out_b",
    characterId: "char_b",
    targetCharacterId: "char_a",
    visibleAction: "乙没有接甲推来的青瓷杯，把红绳压到杯沿旁。乙说：“绳子在，话才算数。”",
    interactionInput: {
      sourceCharacterId: "char_a",
      sourceOutputId: "out_a",
      observedVisibleAction: "甲把青瓷杯推到乙面前，杯沿还沾着水。甲说：“先看杯口。”",
      sharedObject: "青瓷杯",
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

assert.ok(turns.length >= 3, "dialogue should have at least A -> B -> A turn-taking");
assert.equal(turns[0].speakerId, "char_a", "first turn should be the initiating agent");
assert.equal(turns[1].speakerId, "char_b", "second turn should be the responding agent");
assert.equal(turns[2].speakerId, "char_a", "third turn should return to the initiating agent");
assert.match(turns[1].line, /杯口|青瓷杯/, "responder should answer what the initiator actually said or showed");
assert.match(turns[2].line, /红绳|绳子/, "initiator should answer the responder's counter-object or claim");
assert.doesNotMatch(turns.map((turn) => turn.line).join(" "), /按城法扣契|价码到了|药炉前不问正邪/, "turn-taking test should not pass through stock stance slogans");

console.log("agentDialogueTurnTaking:test passed", {
  turns,
  outcome: exchange.eventOutcome,
});
