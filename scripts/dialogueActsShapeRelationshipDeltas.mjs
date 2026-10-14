import assert from "node:assert/strict";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";
import { normalizeSceneInteraction } from "../src/server/pipeline/sceneInteractionSimulator.mjs";

const state = {
  project: { id: "proj_dialogue_act", activeBranchId: "branch_main" },
  ui: { activeBranchId: "branch_main" },
  characters: [
    { id: "char_shen", name: "沈珩" },
    { id: "char_lu", name: "鹿青萝" },
  ],
  locations: [{ id: "loc_clinic", name: "万灵医坊" }],
  relationships: [],
  characterMemories: [],
  characterPlans: [],
};

const simulationTick = {
  id: "tick_dialogue_act",
  locationId: "loc_clinic",
  locationName: "万灵医坊",
  privateSimulations: [
    {
      characterId: "char_shen",
      characterName: "沈珩",
      targetCharacterId: "char_lu",
      targetCharacterName: "鹿青萝",
      tone: "试探",
      defensiveMask: "按城法，庇护牌要先交给照骨司。",
    },
    {
      characterId: "char_lu",
      characterName: "鹿青萝",
      targetCharacterId: "char_shen",
      targetCharacterName: "沈珩",
      tone: "试探",
      defensiveMask: "药炉前先救命，庇护牌不交给照骨司。",
    },
  ],
};

const agentOutputs = [
  {
    outputId: "out_shen",
    characterId: "char_shen",
    targetCharacterId: "char_lu",
    tone: "试探",
    visibleAction: "沈珩把手停在药炉旁。",
  },
  {
    outputId: "out_lu",
    characterId: "char_lu",
    targetCharacterId: "char_shen",
    tone: "试探",
    visibleAction: "鹿青萝把药炉挪近沈珩。",
    interactionInput: {
      sourceCharacterId: "char_shen",
      sourceOutputId: "out_shen",
      observedVisibleAction: "沈珩把手停在药炉旁。",
      sharedObject: "庇护牌",
    },
  },
];

const localInteraction = runSceneInteractionSimulation({ state, simulationTick, agentOutputs });
const localProtectionShift = (localInteraction.agentRelationshipShifts || []).find((shift) =>
  shift.fromCharacterId === "char_lu" && shift.toCharacterId === "char_shen"
);

assert.ok(localProtectionShift, "local exchange should create the responder relationship shift");
assert.ok(
  Number(localProtectionShift.deltas?.protection || 0) >= 3,
  `protective dialogue should create protection delta locally, got ${JSON.stringify(localProtectionShift.deltas)}`,
);
assert.match(
  localProtectionShift.relationshipDialogueAct?.reason || "",
  /救命|庇护牌|保护|药炉/,
  "local shift should explain that protection came from what the character said",
);

const modelPrivateSimulations = simulationTick.privateSimulations.map((sim) => ({
  ...sim,
  agentProfile: { leverageObject: "庇护牌" },
}));
const normalizedModelInteraction = normalizeSceneInteraction({
  agentExchanges: [
    {
      sourceCharacterId: "char_shen",
      responseCharacterId: "char_lu",
      sourceCharacterName: "沈珩",
      responseCharacterName: "鹿青萝",
      sharedObject: "庇护牌",
      eventOutcome: "鹿青萝把庇护牌压到药炉旁，沈珩没有拿走。",
      dialogueTurns: [
        { speakerId: "char_shen", targetId: "char_lu", line: "按城法，庇护牌要先交给照骨司。", turnRole: "claim" },
        { speakerId: "char_lu", targetId: "char_shen", line: "药炉前先救命，庇护牌不交给照骨司。", turnRole: "response" },
        { speakerId: "char_shen", targetId: "char_lu", line: "那就把名字写在药炉旁。", turnRole: "counter" },
      ],
      relationshipDeltas: [
        {
          fromCharacterId: "char_lu",
          toCharacterId: "char_shen",
          deltas: { fear: 1 },
          misreading: "鹿青萝把沈珩的规矩听成逼近。",
          unspoken: "庇护牌还在药炉旁。",
        },
      ],
    },
  ],
}, modelPrivateSimulations, { perCharacter: [] });

const modelProtectionShift = normalizedModelInteraction.relationshipShift.find((shift) =>
  shift.fromCharacterId === "char_lu" && shift.toCharacterId === "char_shen"
);

assert.ok(modelProtectionShift, "model exchange should preserve the responder relationship shift");
assert.ok(
  Number(modelProtectionShift.deltas?.protection || 0) >= 3,
  `protective dialogue should create protection delta in model normalization, got ${JSON.stringify(modelProtectionShift.deltas)}`,
);
assert.match(
  modelProtectionShift.relationshipDialogueAct?.reason || "",
  /救命|庇护牌|保护|药炉/,
  "model shift should explain that protection came from dialogue, not only object movement",
);

console.log("dialogueActsShapeRelationshipDeltas:test passed", {
  localDeltas: localProtectionShift.deltas,
  modelDeltas: modelProtectionShift.deltas,
});
