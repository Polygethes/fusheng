import assert from "node:assert/strict";
import { normalizeSceneInteraction } from "../src/server/pipeline/sceneInteractionSimulator.mjs";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const relationshipDialogueAct = {
  kind: "protect",
  deltas: { protection: 4, dependence: 1 },
  reason: "鹿青萝把庇护牌重新命名为救命和保护的边界。",
};

const healerSim = {
  characterId: "char_lu",
  characterName: "鹿青萝",
  targetCharacterId: "char_shen",
  targetCharacterName: "沈珩",
  tone: "试探",
  agentProfile: {
    leverageObject: "庇护牌",
    dialogueMoves: ["药炉前先救命，庇护牌不交给照骨司。", "你可以等封条，伤者不能等。"],
  },
  defensiveMask: "药炉前先救命，庇护牌不交给照骨司。",
  memorySource: "agent_dialogue_relationship",
  memorySharedObject: "庇护牌",
  relationshipDialogueMemory: {
    sharedObject: "庇护牌",
    finalTurn: "药炉前先救命，庇护牌不交给照骨司。",
    followupTurn: "药炉前先救命，庇护牌不交给照骨司。",
    eventOutcome: "鹿青萝把庇护牌压到药炉旁，沈珩没有拿走。",
    relationshipDialogueAct,
  },
};

const swordSim = {
  characterId: "char_shen",
  characterName: "沈珩",
  targetCharacterId: "char_lu",
  targetCharacterName: "鹿青萝",
  tone: "试探",
  agentProfile: {
    leverageObject: "剑匣",
    dialogueMoves: ["庇护不能把证据吞掉。", "照骨司要验牌。"],
  },
  defensiveMask: "庇护不能把证据吞掉。",
  memorySource: "agent_dialogue_relationship",
  memorySharedObject: "庇护牌",
  relationshipDialogueMemory: {
    sharedObject: "庇护牌",
    finalTurn: "药炉前先救命，庇护牌不交给照骨司。",
    followupTurn: "药炉前先救命，庇护牌不交给照骨司。",
    eventOutcome: "鹿青萝把庇护牌压到药炉旁，沈珩没有拿走。",
    relationshipDialogueAct,
  },
};

const normalized = normalizeSceneInteraction({}, [healerSim, swordSim], { perCharacter: [] });
const modelFallbackExchange = normalized.agentExchanges[0] || {};
const modelFallbackFourthTurn = modelFallbackExchange.dialogueTurns?.[3]?.line || "";

assert.match(
  modelFallbackFourthTurn,
  /救命|药炉|伤者|医坊/,
  `model scene fallback should let a protect relationship act shape the fourth turn, got:\n${modelFallbackFourthTurn}`,
);
assert.match(
  modelFallbackExchange.eventOutcome || "",
  /救命|药炉|伤者|医坊/,
  `model scene fallback event outcome should preserve the protect stakes, got:\n${modelFallbackExchange.eventOutcome}`,
);
assert.ok(
  normalized.relationshipShift.some((shift) => (
    shift.fromCharacterId === "char_shen"
    && shift.toCharacterId === "char_lu"
    && (
      shift.relationshipDialogueAct?.kind === "protect"
      || Number(shift.deltas?.protection || 0) >= 4
    )
  )),
  "model scene fallback responder shift should record protection, not only withdrawal/control",
);

const localScene = runSceneInteractionSimulation({
  state: { characters: [] },
  simulationTick: {
    id: "tick_protect_act_followup",
    locationId: "loc_clinic",
    locationName: "万灵医坊",
    visiblePressure: "药炉旁的庇护牌还压着，照骨司的人在门外等。",
    privateSimulations: [healerSim, swordSim],
  },
  agentOutputs: [
    {
      outputId: "out_lu",
      characterId: "char_lu",
      targetCharacterId: "char_shen",
      visibleAction: "鹿青萝把庇护牌压到药炉旁，挡住沈珩伸向伤者的手。",
    },
    {
      outputId: "out_shen",
      characterId: "char_shen",
      targetCharacterId: "char_lu",
      visibleAction: "沈珩没有拿走庇护牌，只把剑匣扣到药炉外侧。",
      interactionInput: {
        sourceCharacterId: "char_lu",
        sourceOutputId: "out_lu",
        observedVisibleAction: "鹿青萝把庇护牌压到药炉旁，挡住沈珩伸向伤者的手。",
        sharedObject: "庇护牌",
      },
    },
  ],
});

const localExchange = localScene.agentExchanges[0] || {};
const localFourthTurn = localExchange.dialogueTurns?.[3]?.line || "";

assert.match(
  localFourthTurn,
  /救命|药炉|伤者|医坊/,
  `local scene follow-up should let a protect relationship act shape the fourth turn, got:\n${localFourthTurn}`,
);
assert.doesNotMatch(
  localFourthTurn,
  /照骨司留在药炉旁|封条留在药炉旁/,
  `local scene follow-up should keep the protected object distinct from the institution, got:\n${localFourthTurn}`,
);
assert.match(
  localExchange.eventOutcome || "",
  /救命|药炉|伤者|医坊/,
  `local scene outcome should preserve the protect stakes, got:\n${localExchange.eventOutcome}`,
);

console.log("relationshipDialogueActShapesFollowupScene:test passed", {
  modelFallbackFourthTurn,
  modelFallbackOutcome: modelFallbackExchange.eventOutcome,
  localFourthTurn,
  localOutcome: localExchange.eventOutcome,
});
