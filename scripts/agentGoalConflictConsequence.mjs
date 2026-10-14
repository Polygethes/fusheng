import assert from "node:assert/strict";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const simulationTick = {
  id: "tick_agent_goal_conflict_consequence",
  locationId: "loc_clinic_archive",
  locationName: "万灵医坊",
  visiblePressure: "药炉旁的病人还在发热，照骨司的封条压着半份证词。",
  privateSimulations: [
    {
      characterId: "char_shen",
      characterName: "沈珩",
      targetCharacterId: "char_lu",
      targetCharacterName: "鹿青萝",
      tone: "惩罚",
      privateDesire: "带走药炉旁的半份证词，扣住鹿青萝替病人隐瞒的口供。",
      defensiveMask: "按城法审讯，证词不能留在医坊。",
      shadowImpulse: "先拿证词，再让病人开口。",
      agentProfile: {
        dramaticObjective: "获得审讯主动权，把证词交给照骨司。",
        leverageObject: "半份证词",
      },
    },
    {
      characterId: "char_lu",
      characterName: "鹿青萝",
      targetCharacterId: "char_shen",
      targetCharacterName: "沈珩",
      tone: "保护",
      privateDesire: "护住药炉旁的病人，不能让沈珩带走证词后逼供。",
      defensiveMask: "先救命，证词暂时不交。",
      shadowImpulse: "把证词压回药炉内侧。",
      agentProfile: {
        dramaticObjective: "守住病人与医坊的临时庇护权。",
        leverageObject: "庇护牌",
      },
    },
  ],
};

const agentOutputs = [
  {
    outputId: "out_shen_take_testimony",
    characterId: "char_shen",
    targetCharacterId: "char_lu",
    characterName: "沈珩",
    visibleAction: "沈珩把半份证词推到鹿青萝面前，手指扣住封条。沈珩说：“证词跟我去照骨司。”",
  },
  {
    outputId: "out_lu_protect_patient",
    characterId: "char_lu",
    targetCharacterId: "char_shen",
    characterName: "鹿青萝",
    visibleAction: "鹿青萝没有接沈珩推来的半份证词，把庇护牌压到证词旁，挡住沈珩看向病人的路。鹿青萝说：“病人先活，证词不能现在交。”",
    interactionInput: {
      sourceCharacterId: "char_shen",
      sourceOutputId: "out_shen_take_testimony",
      observedVisibleAction: "沈珩把半份证词推到鹿青萝面前，手指扣住封条。沈珩说：“证词跟我去照骨司。”",
      sharedObject: "半份证词",
    },
  },
];

const scene = runSceneInteractionSimulation({
  state: { characters: [] },
  simulationTick,
  agentOutputs,
});

const exchange = scene.agentExchanges?.[0] || {};
const outcomeText = `${exchange.eventOutcome || ""} ${exchange.stateDelta || ""}`.trim();
const hasGoalConsequence = /(沈珩|鹿青萝)[^。；]*(没能|不能|欠下|获得|交给|留下证词|临时控制|审讯|带走|护住病人|扣住证词)/.test(outcomeText);
const staticObjectOnly = /(?:留在|停在)(?:两人中间|两人之间|场中|原处)|没有换手|没有换到旁人手里/.test(outcomeText) && !hasGoalConsequence;

assert.ok(exchange, "local agent interaction should produce an exchange");
assert.ok(outcomeText, "exchange should produce an eventOutcome or stateDelta");
assert.ok(
  hasGoalConsequence,
  `conflicting local agent goals must resolve into a named character consequence, not only object placement. Outcome:\n${outcomeText}`,
);
assert.ok(
  !staticObjectOnly,
  `outcome must not stop at the object remaining in the scene without goal consequence. Outcome:\n${outcomeText}`,
);

const traceableRelationshipShift = [
  ...(exchange.relationshipDeltas || []),
  ...(scene.agentRelationshipShifts || []),
].some((shift) =>
  shift.sourceOutputId === "out_shen_take_testimony"
  && shift.responseOutputId === "out_lu_protect_patient"
);

assert.ok(
  traceableRelationshipShift,
  "relationshipDeltas or agentRelationshipShifts should trace the sourceOutputId and responseOutputId",
);

console.log("agentGoalConflictConsequence:test passed", {
  outcome: exchange.eventOutcome,
  stateDelta: exchange.stateDelta,
});
