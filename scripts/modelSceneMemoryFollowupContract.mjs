import assert from "node:assert/strict";
import { normalizeSceneInteraction } from "../src/server/pipeline/sceneInteractionSimulator.mjs";

const privateSimulations = [
  {
    characterId: "char_shen",
    characterName: "沈珩",
    targetCharacterId: "char_yan",
    targetCharacterName: "阎无咎",
    agentProfile: {
      leverageObject: "灵契",
      dialogueMoves: ["按城法扣契，不按宗门私仇。", "剑可以停，证据不能走。"],
    },
    defensiveMask: "按城法扣契，不按宗门私仇。",
    memorySource: "agent_dialogue_relationship",
    memorySharedObject: "灵契",
  },
  {
    characterId: "char_yan",
    characterName: "阎无咎",
    targetCharacterId: "char_shen",
    targetCharacterName: "沈珩",
    agentProfile: {
      leverageObject: "魔印",
      dialogueMoves: ["我押的是灵契，不是命。", "价码到了，旧案自然开口。"],
    },
    defensiveMask: "我押的是灵契，不是命。",
    memorySource: "agent_dialogue_relationship",
    memorySharedObject: "灵契",
  },
];

const normalized = normalizeSceneInteraction({}, privateSimulations, { perCharacter: [] });
const exchange = normalized.agentExchanges?.[0];
const turns = exchange?.dialogueTurns || [];

assert.ok(turns.length >= 4, `model fallback should continue remembered exchanges past three turns, got ${turns.length}`);
assert.equal(turns[3].speakerId, "char_yan", "fourth model fallback turn should return to the responder");
assert.equal(turns[3].turnRole, "turn", "fourth model fallback turn should be an open continuation turn");
assert.equal(turns[3].respondsTo, turns[2].line, "fourth model fallback turn should answer the counter");
assert.match(turns[3].line, /灵契|魔印|刚才|上次|记得|还/, "fourth model fallback turn should carry concrete remembered stakes");
assert.ok(
  normalized.relationshipShift.some((shift) => shift.dialogueTurnCount >= 4),
  "relationship shifts should record the longer exchange",
);
assert.ok(
  normalized.relationshipShift.some((shift) => shift.followupTurn === turns[3].line),
  "relationship shifts should preserve the fourth follow-up line for memory persistence",
);
assert.ok(
  normalized.relationshipShift.some((shift) => shift.finalTurn === turns[3].line),
  "relationship shifts should expose the final turn of the remembered exchange",
);

console.log("modelSceneMemoryFollowupContract:test passed", {
  turns,
});
