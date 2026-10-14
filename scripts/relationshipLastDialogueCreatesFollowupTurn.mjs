// Contract: unresolved relationship dialogue produces a followup that names its
// source.
//
// This used to run through `mockEngine`. That path no longer stages speech — it
// had no generator to give a character a voice, only fixed string banks (see
// `local-theater-emits-no-staged-speech:test`). The followup rule did not die
// with it: `openaiPipeline` still realises turns through this protocol when the
// model supplies no wording, so the contract now exercises the protocol
// directly.
//
// The property under test is unchanged: when a pair carries unresolved dialogue,
// the exchange must extend past the counter, the extra turn must reach back to
// the remembered object rather than becoming a generic prop line, and it must
// record which memory it read instead of inventing continuity.
//
// One assertion did not survive the move: the original also required the
// engine to archive the followup into `relationshipShift`. That is engine
// bookkeeping, not protocol behaviour, and the deterministic engine no longer
// produces spoken followups to archive. Relationship consequence without staged
// speech is covered by `local-theater-emits-no-staged-speech:test`.

import assert from "node:assert/strict";
import { buildAgentDialogueExchange } from "../src/engine/dialogueProtocol.js";

const shen = {
  id: "char_shen",
  name: "沈珩",
  publicIdentity: "执律剑修",
  defenseLanguage: ["按城法扣契，不按宗门私仇。"],
  agentProfile: {
    dialogueMoves: ["按城法扣契，不按宗门私仇。", "让照骨司先验。"],
    leverageObject: "灵契",
    dramaticObjective: "让停剑城承认扣押资格",
    responseBoundary: "灵契不能在未验明之前离场",
  },
};

const yan = {
  id: "char_yan",
  name: "阎无咎",
  publicIdentity: "血河楼使者",
  defenseLanguage: ["买卖在城规里，别把血仇带进来。"],
  agentProfile: {
    dialogueMoves: ["买卖在城规里，别把血仇带进来。", "价码到了，旧案自然开口。"],
    leverageObject: "魔印",
    dramaticObjective: "带走能翻案的证物",
  },
};

const relationshipDialogueMemory = {
  sharedObject: "灵契",
  source: "last-dialogue",
  followupTurn: "turn_prev_unresolved",
};

const shenOutput = {
  characterId: shen.id,
  characterName: shen.name,
  outputId: "out_shen",
  tone: "求证",
  conversationObjective: "让阎无咎说清灵契的来路",
};

const yanOutput = {
  characterId: yan.id,
  characterName: yan.name,
  outputId: "out_yan",
  tone: "试探",
  conversationObjective: "先不交出魔印",
  relationshipDialogueMemory,
};

const turns = buildAgentDialogueExchange({
  sourceCharacter: shen,
  sourceOutput: shenOutput,
  responseCharacter: yan,
  responseOutput: yanOutput,
  conversationPolicy: { maxTurns: 4 },
});

// 1. Unresolved relationship dialogue extends the exchange past the counter.
assert.ok(
  turns.length >= 4,
  `unresolved relationship dialogue should produce a fourth turn, got ${turns.length}`,
);

const followup = turns[3];

// 2. The fourth turn records which memory it read.
assert.ok(
  followup?.relationshipMemoryTurn || followup?.relationshipMemorySource,
  "the fourth character-agent turn should retain which unresolved relationship dialogue it read",
);
assert.equal(
  followup.relationshipMemorySource,
  relationshipDialogueMemory.source,
  "the recorded source must be the memory actually supplied, not a default",
);
assert.equal(
  followup.relationshipMemoryTurn,
  relationshipDialogueMemory.followupTurn,
  "the followup must point back at the unresolved turn it continues",
);

// 3. It answers the remembered thread instead of becoming a generic prop line.
assert.match(
  followup?.line || "",
  /灵契/,
  `the fourth turn should answer the previous unresolved dialogue instead of becoming a generic prop line, got: ${followup?.line}`,
);
assert.ok(followup.observedTurnId, "the followup must still name the turn it heard");

console.log("relationshipLastDialogueCreatesFollowupTurn:test passed", {
  turns: turns.length,
  followup: followup.line,
});
