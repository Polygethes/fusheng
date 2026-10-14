import assert from "node:assert/strict";
import { normalizeSceneInteraction } from "../src/server/pipeline/sceneInteractionSimulator.mjs";

const dialogueHistory = [
  {
    sharedObject: "铜铃",
    finalTurn: "铃声停了，话还没完。",
    followupTurn: "你记住的是城规，还是我刚才的停顿？",
    locationName: "归墟渡",
    periodSlot: "上午",
  },
  {
    sharedObject: "渡令",
    finalTurn: "人可以退，渡令不走。",
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
    agentProfile: {
      leverageObject: "渡令",
      dialogueMoves: ["按城法扣契，不按宗门私仇。", "证据不能走。"],
    },
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
    agentProfile: {
      leverageObject: "渡令",
      dialogueMoves: ["归墟渡不替任何一派开路。"],
    },
    relationshipDialogueHistory: dialogueHistory,
    relationshipHistoryCount: dialogueHistory.length,
  },
];

const normalized = normalizeSceneInteraction({}, privateSimulations, { perCharacter: [] });
const exchange = normalized.agentExchanges?.[0];
const turns = exchange?.dialogueTurns || [];

assert.ok(turns.length >= 4, `relationship history alone should continue fallback dialogue past three turns, got ${turns.length}`);
assert.equal(turns[3].speakerId, "char_ao", "the fourth turn should return to the responder");
assert.equal(turns[3].turnRole, "turn", "the fourth turn should be an open continuation");
assert.equal(turns[3].respondsTo, turns[2].line, "the fourth turn should answer the counter line");
assert.match(
  turns[3].line,
  /渡令|城规|别换手|刚才/,
  `the fourth turn should carry the latest unresolved relationship-history stakes, got: ${turns[3].line}`,
);
assert.ok(
  normalized.relationshipShift.some((shift) => shift.followupTurn === turns[3].line && shift.dialogueTurnCount >= 4),
  "relationship shifts should preserve the history-driven fourth turn",
);

console.log("modelSceneFallbackHistoryFollowup:test passed", {
  turns,
  followup: turns[3]?.line,
});
