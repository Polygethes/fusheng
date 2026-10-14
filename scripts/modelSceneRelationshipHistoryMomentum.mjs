import assert from "node:assert/strict";
import { normalizeSceneInteraction } from "../src/server/pipeline/sceneInteractionSimulator.mjs";

const dialogueHistory = [
  {
    sharedObject: "铜铃",
    followupTurn: "你记住的是城规，还是我刚才的停顿？",
    locationName: "归墟渡",
    periodSlot: "上午",
  },
  {
    sharedObject: "渡令",
    followupTurn: "你刚才问的是城规，现在渡令先别换手。",
    locationName: "归墟渡",
    periodSlot: "中午",
  },
];

const privateSimulations = [
  {
    characterId: "char_shen",
    characterName: "沈珩",
    targetCharacterId: "char_ao",
    targetCharacterName: "敖霁",
    tone: "惩罚",
    publicGoal: "按城法扣住渡令。",
    privateDesire: "逼敖霁承认水府留路。",
    defensiveMask: "按城法扣契，不按宗门私仇。",
    selfLie: "我只是照规矩办。",
    agentProfile: { leverageObject: "渡令", dialogueMoves: ["按城法扣契，不按宗门私仇。", "证据不能走。"] },
    memorySource: "agent_dialogue_relationship",
    relationshipDialogueHistory: dialogueHistory,
    relationshipHistoryCount: dialogueHistory.length,
  },
  {
    characterId: "char_ao",
    characterName: "敖霁",
    targetCharacterId: "char_shen",
    targetCharacterName: "沈珩",
    tone: "保护",
    publicGoal: "守住归墟渡。",
    privateDesire: "让沈珩承认渡口不是审判台。",
    defensiveMask: "归墟渡不替任何一派开路。",
    selfLie: "我只是守渡。",
    agentProfile: { leverageObject: "渡令", dialogueMoves: ["归墟渡不替任何一派开路。"] },
    relationshipDialogueHistory: dialogueHistory,
    relationshipHistoryCount: dialogueHistory.length,
  },
];

const parsed = {
  agentExchanges: [
    {
      sourceCharacterId: "char_shen",
      responseCharacterId: "char_ao",
      sourceCharacterName: "沈珩",
      responseCharacterName: "敖霁",
      sharedObject: "渡令",
      generatedFrom: "model-agent-dialogue",
      eventOutcome: "敖霁没有接沈珩递出的渡令，把渡令压回岸边。",
      dialogueTurns: [
        { speakerId: "char_shen", targetId: "char_ao", line: "渡令先停，水阵不开。", turnRole: "claim" },
        { speakerId: "char_ao", targetId: "char_shen", line: "人能过，追杀不能过。", turnRole: "response" },
        { speakerId: "char_shen", targetId: "char_ao", line: "先压住渡令。人可以退，渡令不走。", turnRole: "counter" },
      ],
      relationshipDeltas: [
        {
          fromCharacterId: "char_shen",
          toCharacterId: "char_ao",
          deltas: { resentment: 2, wantsToBeSeen: 2 },
          misreading: "沈珩把敖霁的退让听成拖延。",
          unspoken: "渡令还没结清。",
        },
        {
          fromCharacterId: "char_ao",
          toCharacterId: "char_shen",
          deltas: { fear: 1, wantsToEscape: 1 },
          misreading: "敖霁把沈珩的扣令听成逼近。",
          unspoken: "渡令还没结清。",
        },
      ],
    },
  ],
};

const normalized = normalizeSceneInteraction(parsed, privateSimulations, { perCharacter: [] });
const sourceShift = normalized.relationshipShift.find((shift) =>
  shift.generatedFrom === "model-agent-dialogue"
  && shift.fromCharacterId === "char_shen"
  && shift.toCharacterId === "char_ao"
);

assert.ok(sourceShift, "model exchange should produce a relationship shift for the locked pair");
assert.equal(
  sourceShift.relationshipMomentum?.historyCount,
  2,
  "model scene relationship shift should inherit repeated dialogue history momentum",
);
assert.ok(
  Number(sourceShift.deltas?.resentment || 0) >= 4 || Number(sourceShift.deltas?.wantsToBeSeen || 0) >= 4,
  "model scene relationship momentum should increase relationship delta magnitude",
);
assert.match(
  sourceShift.relationshipMomentum?.reason || "",
  /连续|没结清|铜铃|渡令/,
  "model relationship momentum should explain the repeated unresolved history",
);

console.log("modelSceneRelationshipHistoryMomentum:test passed", {
  deltas: sourceShift.deltas,
  momentum: sourceShift.relationshipMomentum,
});
