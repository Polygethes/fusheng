import assert from "node:assert/strict";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const protectMemory = {
  sharedObject: "停剑令",
  finalTurn: "停剑令还在桌面，谁要越过被庇护的人，谁先把手放下。",
  followupTurn: "停剑令还在桌面，谁要越过被庇护的人，谁先把手放下。",
  eventOutcome: "被庇护的人停在众人看得见的位置。",
  dialogueTurnCount: 5,
  relationshipDialogueAct: {
    kind: "protect",
    reason: "闻夏把停剑令重新命名为保护边界。",
  },
};

const history = [protectMemory, { ...protectMemory, finalTurn: "停剑令压在茶盏旁，人先留下。" }];

const source = {
  characterId: "char_wen",
  characterName: "闻夏",
  targetCharacterId: "char_shen",
  targetCharacterName: "沈珩",
  tone: "保护",
  relationshipDialogueMemory: protectMemory,
  relationshipDialogueHistory: history,
  relationshipHistoryCount: 5,
};

const target = {
  characterId: "char_shen",
  characterName: "沈珩",
  targetCharacterId: "char_wen",
  targetCharacterName: "闻夏",
  tone: "惩罚",
  relationshipDialogueMemory: protectMemory,
  relationshipDialogueHistory: history,
  relationshipHistoryCount: 5,
};

const scene = runSceneInteractionSimulation({
  state: { characters: [] },
  simulationTick: {
    id: "tick_tea_progression",
    locationId: "loc_tea",
    locationName: "停剑茶楼",
    visiblePressure: "茶盏边热气没散，停剑令压在桌面。",
    privateSimulations: [source, target],
  },
  agentOutputs: [
    {
      outputId: "out_wen",
      characterId: "char_wen",
      targetCharacterId: "char_shen",
      visibleAction: "闻夏把停剑令压到桌面边，挡住沈珩伸来的手。",
    },
    {
      outputId: "out_shen",
      characterId: "char_shen",
      targetCharacterId: "char_wen",
      visibleAction: "沈珩把符压到桌面边，没有接走停剑令。",
      interactionInput: {
        sourceCharacterId: "char_wen",
        sourceOutputId: "out_wen",
        observedVisibleAction: "闻夏把停剑令压到桌面边，挡住沈珩伸来的手。",
        sharedObject: "停剑令",
      },
    },
  ],
});

const outcome = scene.agentExchanges?.[0]?.eventOutcome || "";

assert.match(
  outcome,
  /茶盏边多出第六道停剑印|桌面边多出第六道记号/,
  `tea house relationship progression should materialize in the tea house surface, got:\n${outcome}`,
);
assert.doesNotMatch(
  outcome,
  /药炉旁多出|庇护记号|伤者被移到内侧帘后/,
  `tea house progression must not borrow clinic-stage consequences, got:\n${outcome}`,
);

console.log("relationshipProgressionLocalizesLocation:test passed", { outcome });
