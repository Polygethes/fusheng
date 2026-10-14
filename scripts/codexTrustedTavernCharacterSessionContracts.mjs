import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

import {
  createCodexTrustedTavernCharacterModelSession,
  parseCodexTrustedConversationId,
} from "../src/server/ecology/codexTrustedTavernCharacterAgentV2Channel.mjs";
import {
  buildCharacterAgentStageInput,
  createCharacterAgentTurnSession,
} from "../src/server/simulation/characterAgentTurnProtocol.mjs";

const CHARACTER = "char:test:persistent-voice";
const OTHER = "char:test:other";
const CONVERSATION_ID = "019f-character-session-contract";

function firstStageInput(characterId = CHARACTER, turn = 1) {
  return buildCharacterAgentStageInput(createCharacterAgentTurnSession({
    agentTurnId: `agent-turn:${characterId}:${turn}`,
    characterId,
    worldProjection: {
      authority: "recipient-specific-world-projection",
      scene: { id: "scene:test:room", step: turn },
      evidence: [],
      perceivedImpacts: [],
      perceivedCharacters: [],
      perceivedObjects: [],
      affordances: [],
      reachableZones: [],
    },
    privateContext: {},
  }));
}

assert.equal(parseCodexTrustedConversationId([
  JSON.stringify({ type: "item.completed", item: { id: "not-a-thread" } }),
  JSON.stringify({ type: "thread.started", thread_id: CONVERSATION_ID }),
].join("\n")), CONVERSATION_ID);
assert.equal(parseCodexTrustedConversationId("not json\n"), "");

const invocations = [];
const session = createCodexTrustedTavernCharacterModelSession({
  characterId: CHARACTER,
  model: "gpt-5.6-sol",
  reasoningEffort: "medium",
  async execute(invocation) {
    invocations.push(structuredClone(invocation));
    await writeFile(invocation.outputPath, "{}\n", { encoding: "utf8", mode: 0o600 });
    return {
      exitCode: 0,
      stdout: invocations.length === 1
        ? `${JSON.stringify({ type: "thread.started", thread_id: CONVERSATION_ID })}\n`
        : `${JSON.stringify({ type: "turn.completed" })}\n`,
      stderr: "",
    };
  },
});

try {
  await session.runStage(firstStageInput(CHARACTER, 1));
  const afterFirst = session.checkpoint();
  assert.equal(afterFirst.characterId, CHARACTER);
  assert.equal(afterFirst.providerConversationId, CONVERSATION_ID);
  assert.equal(afterFirst.acceptedStageCount, 1);

  await session.runStage(firstStageInput(CHARACTER, 2));
  const afterSecond = session.checkpoint();
  assert.equal(afterSecond.providerConversationId, CONVERSATION_ID);
  assert.equal(afterSecond.acceptedStageCount, 2);

  assert.equal(invocations.length, 2);
  assert.equal(invocations[0].sessionOperation, "start");
  assert.equal(invocations[0].args.includes("--ephemeral"), false);
  assert.equal(invocations[0].args.includes("--json"), true);
  assert.equal(invocations[1].sessionOperation, "resume");
  assert.equal(invocations[1].args.includes("resume"), true);
  assert.equal(invocations[1].args.includes(CONVERSATION_ID), true);
  assert.equal(invocations[1].args.includes("--ephemeral"), false);
  for (const invocation of invocations) {
    assert.equal(invocation.args.includes("--ignore-user-config"), true);
    assert.equal(invocation.args.includes("--ignore-rules"), true);
    assert.equal(invocation.args.includes("--skip-git-repo-check"), true);
    for (const feature of ["shell_tool", "unified_exec", "web_search", "apps", "hooks", "memories", "multi_agent", "remote_plugin", "goals"]) {
      assert.equal(
        invocation.args.some((value, index) => value === "--disable" && invocation.args[index + 1] === feature),
        true,
        `persistent character session must keep ${feature} disabled`,
      );
    }
  }

  await assert.rejects(
    session.runStage(firstStageInput(OTHER, 1)),
    (error) => error?.code === "CHARACTER_MODEL_SESSION_CHARACTER_MISMATCH",
  );
  assert.equal(invocations.length, 2, "another character must fail before provider execution");

  const restoredInvocations = [];
  const restored = createCodexTrustedTavernCharacterModelSession({
    characterId: CHARACTER,
    checkpoint: afterSecond,
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
    async execute(invocation) {
      restoredInvocations.push(structuredClone(invocation));
      await writeFile(invocation.outputPath, "{}\n", { encoding: "utf8", mode: 0o600 });
      return { exitCode: 0, stdout: `${JSON.stringify({ type: "turn.completed" })}\n`, stderr: "" };
    },
  });
  try {
    await restored.runStage(firstStageInput(CHARACTER, 3));
    assert.equal(restoredInvocations[0].sessionOperation, "resume");
    assert.equal(restoredInvocations[0].args.includes(CONVERSATION_ID), true);
    assert.equal(restored.checkpoint().acceptedStageCount, 3);
  } finally {
    await restored.close();
  }

  console.log(JSON.stringify({
    status: "passed",
    checks: {
      firstStageStartsPersistentConversation: true,
      laterStagesResumeSameCharacter: true,
      differentCharactersCannotShareSession: true,
      checkpointRestoresConversation: true,
      trustedIsolationRemainsEnabled: true,
      noExternalProviderCalled: true,
    },
  }, null, 2));
} finally {
  await session.close();
}
