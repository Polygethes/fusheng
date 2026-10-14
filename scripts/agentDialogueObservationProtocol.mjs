// Contract: the dialogue protocol keeps observation causal.
//
// This used to run through the deterministic engine via `playFromServer`. That
// path no longer stages speech — it had no generator to give a character a
// voice, only fixed string banks (see `local-theater-emits-no-staged-speech:test`).
// The protocol itself did not die: `openaiPipeline` still uses it to realise
// turns when the model supplies no wording, so this contract now exercises the
// protocol directly instead of through an engine that no longer calls it.
//
// The property under test is unchanged: a reply must carry which turn it heard
// and what was said, so a response can never be mistaken for an opening.

import assert from "node:assert/strict";
import { buildAgentDialogueExchange, buildCharacterDialogueDecision } from "../src/engine/dialogueProtocol.js";

const inspector = {
  id: "char_inspector",
  name: "林岑",
  publicIdentity: "港务检查员",
  defenseLanguage: ["把通行证给我，我要核对来路。"],
  agentProfile: {
    dialogueMoves: ["把通行证给我，我要核对来路。", "人可以走，通行证留下。"],
    leverageObject: "通行证",
    dramaticObjective: "查清通行证的来路",
    responseBoundary: "通行证必须留在闸口",
  },
};

const physician = {
  id: "char_physician",
  name: "程屿",
  publicIdentity: "随队医师",
  defenseLanguage: ["伤者先过闸。"],
  agentProfile: {
    dialogueMoves: ["伤者先过闸。", "核对可以，但不是现在。"],
    leverageObject: "担架",
    dramaticObjective: "先把伤者送过闸",
  },
};

const inspectorOutput = {
  characterId: inspector.id,
  characterName: inspector.name,
  outputId: "out_inspector",
  tone: "求证",
  conversationObjective: "让程屿说清通行证从哪里来",
};

const physicianOutput = {
  characterId: physician.id,
  characterName: physician.name,
  outputId: "out_physician",
  tone: "试探",
  conversationObjective: "先让伤者过闸",
};

// 1. The initiating agent creates its own decision, attributed to itself.
{
  const opening = buildCharacterDialogueDecision({
    character: inspector,
    target: physician,
    output: inspectorOutput,
  });
  assert.ok(opening.turnId, "initiating character agent should create its own dialogue decision");
  assert.equal(opening.speakerId, inspector.id, "the opening must be attributed to the initiator");
  assert.equal(opening.targetId, physician.id, "the opening must name who it is addressed to");
  assert.ok(String(opening.utterance || "").trim(), "the opening must carry an utterance");
  assert.equal(opening.observedTurnId, "", "an opening has not observed anything yet");
}

// 2. A reply retains the turn it observed and the words it heard.
{
  const turns = buildAgentDialogueExchange({
    sourceCharacter: inspector,
    sourceOutput: inspectorOutput,
    responseCharacter: physician,
    responseOutput: physicianOutput,
  });
  assert.ok(turns.length >= 2, `the exchange should produce an opening and a reply, got ${turns.length}`);
  const [opening, ...replies] = turns;
  assert.equal(opening.turnRole, "claim", "the first turn is the opening claim");
  for (const reply of replies) {
    assert.ok(reply.observedTurnId, `reply from ${reply.speakerName} must identify the turn it observed`);
    assert.ok(reply.observedUtterance, `reply from ${reply.speakerName} must retain the words it heard`);
    assert.equal(
      reply.respondsTo,
      reply.observedUtterance,
      "respondsTo must mirror what was actually heard, not a summary",
    );
  }
}

// 3. Observation is causal, not decorative: an observed turn must actually
//    precede the turn that claims to have heard it.
{
  const turns = buildAgentDialogueExchange({
    sourceCharacter: inspector,
    sourceOutput: inspectorOutput,
    responseCharacter: physician,
    responseOutput: physicianOutput,
  });
  const seen = new Set();
  for (const turn of turns) {
    if (turn.observedTurnId) {
      assert.ok(
        seen.has(turn.observedTurnId),
        `${turn.speakerName} claims to have observed a turn that does not precede it`,
      );
    }
    seen.add(turn.turnId);
  }
}

console.log("agentDialogueObservationProtocol:test passed");
