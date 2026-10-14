// Contract: a question must be answered by the character who heard it.
//
// This used to run through the deterministic engine via `playFromServer`. That
// path no longer stages speech — it had no generator to give a character a
// voice, only fixed string banks (see `local-theater-emits-no-staged-speech:test`).
// The turn-taking rule did not die with it: `openaiPipeline` still realises
// turns through this protocol when the model supplies no wording, so the
// contract now exercises the protocol directly.
//
// The property under test is unchanged: the responder must have the actual
// question in hand before deciding, and must not answer past it with an
// unrelated opening of its own.

import assert from "node:assert/strict";
import { buildAgentDialogueExchange, buildCharacterDialogueDecision } from "../src/engine/dialogueProtocol.js";

const shen = {
  id: "char_shen",
  name: "沈珩",
  publicIdentity: "执律剑修",
  defenseLanguage: ["那你要谁来盖印？"],
  agentProfile: {
    dialogueMoves: ["那你要谁来盖印？"],
    leverageObject: "灵契",
    dramaticObjective: "查清灵契由谁盖印",
  },
};

const yan = {
  id: "char_yan",
  name: "阎无咎",
  publicIdentity: "血河楼使者",
  defenseLanguage: ["我押的是灵契，不是命。"],
  agentProfile: {
    dialogueMoves: ["我押的是灵契，不是命。"],
    leverageObject: "魔印",
    dramaticObjective: "带走能翻案的证物",
  },
};

const shenOutput = {
  characterId: shen.id,
  characterName: shen.name,
  outputId: "out_shen",
  tone: "求证",
  intendedUtterance: "灵契是谁交给你的？",
};

const yanOutput = {
  characterId: yan.id,
  characterName: yan.name,
  outputId: "out_yan",
  tone: "试探",
  conversationObjective: "先不说出交契的人",
};

// 1. The responder receives the question verbatim before deciding.
{
  const opening = buildCharacterDialogueDecision({ character: shen, target: yan, output: shenOutput });
  assert.equal(opening.act, "question", `the opening should be a question, got ${opening.act}`);

  const response = buildCharacterDialogueDecision({
    character: yan,
    target: shen,
    output: yanOutput,
    observedDecision: opening,
  });
  assert.equal(
    response.observedUtterance,
    opening.utterance,
    "the responding character should hear the actual question before deciding",
  );
  assert.equal(response.observedTurnId, opening.turnId, "the reply must point at the turn it answered");
}

// 2. The reply engages the question rather than opening a new subject.
{
  const turns = buildAgentDialogueExchange({
    sourceCharacter: shen,
    sourceOutput: shenOutput,
    responseCharacter: yan,
    responseOutput: yanOutput,
  });
  const reply = turns.find((turn) => turn.turnRole === "response");
  assert.ok(reply, "the exchange must contain a reply");
  assert.ok(
    ["answer", "refuse", "condition", "question"].includes(reply.act),
    `a reply to a question must engage it, got act=${reply.act}`,
  );
  assert.ok(String(reply.line || "").trim(), "the reply must carry a line");
  assert.notEqual(reply.line, turns[0].line, "the reply must not echo the question back verbatim");
}

console.log("localAgentAnswersPreviousQuestion:test passed");
