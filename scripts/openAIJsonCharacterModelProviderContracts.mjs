import assert from "node:assert/strict";

import {
  createOpenAIJsonCharacterModelProvider,
  openAIJsonCharacterModelStageDefinition,
} from "../src/server/ecology/openAIJsonCharacterModelProvider.mjs";
import {
  createCharacterModelSessionPool,
  restoreCharacterModelSessionPool,
} from "../src/server/simulation/characterModelSession.mjs";
import {
  buildCharacterAgentStageInput,
  createCharacterAgentTurnSession,
  submitCharacterSubjectiveAppraisal,
} from "../src/server/simulation/characterAgentTurnProtocol.mjs";
import { createTavernV27FixtureStageRunner } from
  "../src/server/pipeline/tavernV27FixtureStage.mjs";

const XIE = "char_xyy_xiezenshi";
const LUO = "char_xyy_luozhao";

function firstStageInput(characterId, turn = 1) {
  return buildCharacterAgentStageInput(createCharacterAgentTurnSession({
    agentTurnId: `agent-turn:${characterId}:${turn}`,
    characterId,
    worldProjection: {
      authority: "recipient-specific-world-projection",
      scene: { id: "scene:json-provider-contract", step: turn },
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

async function firstTwoStageInputs(characterId) {
  const turn = createCharacterAgentTurnSession({
    agentTurnId: `agent-turn:${characterId}:1`,
    characterId,
    worldProjection: {
      authority: "recipient-specific-world-projection",
      scene: { id: "scene:json-provider-contract", step: 1 },
      evidence: [],
      perceivedImpacts: [],
      perceivedCharacters: [],
      perceivedObjects: [],
      affordances: [],
      reachableZones: [],
    },
    privateContext: {},
  });
  const appraisalInput = buildCharacterAgentStageInput(turn);
  const fixture = createTavernV27FixtureStageRunner();
  const fixtureResult = await fixture(appraisalInput, { stage: "subjective_appraisal" });
  return [
    appraisalInput,
    buildCharacterAgentStageInput(submitCharacterSubjectiveAppraisal(turn, fixtureResult.appraisal)),
  ];
}

function atomicCommitInput(characterId, turn = 1) {
  return {
    characterId,
    agentTurnId: `agent-turn:${characterId}:atomic:${turn}`,
    phase: "awaiting_agent_turn_commit",
    requestedOutput: "character_turn_commit_only",
    referenceContract: { ownedPsychologicalSourceIds: [], ownedDesireIds: [] },
    subjectiveAppraisal: {},
    psychologySnapshot: {},
    generatedCandidates: [{ candidateId: "candidate:atomic:one" }],
    candidateEvaluation: { selection: null },
    impulseGroundingSurface: { authority: "character-private-preverbal-grounding-surface" },
    worldSurface: { authority: "recipient-specific-realization-surface", evidence: [] },
    voiceContract: {},
  };
}

function makeResponsesFake({ omitCheckpoint = false, changeKindAt = 0 } = {}) {
  const calls = [];
  return {
    calls,
    async callJson(input = {}) {
      calls.push(structuredClone(input));
      const index = calls.length;
      if (omitCheckpoint) return { parsed: {}, meta: { provider: "responses", model: "test-responses" } };
      if (changeKindAt === index) {
        return {
          parsed: {},
          meta: {
            provider: "chat-completions",
            model: "test-responses",
            conversationCheckpoint: {
              schemaVersion: "model-conversation-context-v1",
              kind: "chat-completions",
              messages: [{ role: "assistant", content: "{}" }],
            },
          },
        };
      }
      return {
        parsed: {},
        meta: {
          provider: "responses",
          model: "test-responses",
          responseId: `response-private-${index}`,
          elapsedMs: 1,
          conversationCheckpoint: {
            schemaVersion: "model-conversation-context-v1",
            kind: "responses",
            previousResponseId: `response-private-${index}`,
          },
        },
      };
    },
  };
}

function makeChatFake() {
  const calls = [];
  return {
    calls,
    async callJson(input = {}) {
      calls.push(structuredClone(input));
      const prior = input.conversationContext?.messages || [];
      const messages = [
        ...prior,
        { role: "system", content: input.system },
        { role: "user", content: input.user },
        { role: "assistant", content: "{}" },
      ];
      return {
        parsed: {},
        meta: {
          provider: "chat-completions",
          model: "test-chat",
          elapsedMs: 1,
          conversationCheckpoint: {
            schemaVersion: "model-conversation-context-v1",
            kind: "chat-completions",
            messages,
          },
        },
      };
    },
  };
}

let opaqueSequence = 0;

for (const phase of [
  "awaiting_character_day_planning",
  "awaiting_character_reflection",
  "awaiting_subjective_appraisal",
  "awaiting_agent_candidates",
  "awaiting_agent_choice_and_regulation",
  "awaiting_agent_expression_planning",
  "awaiting_agent_realization",
]) {
  const definition = openAIJsonCharacterModelStageDefinition({
    characterId: XIE,
    agentTurnId: `agent-turn:${XIE}:definition-contract`,
    phase,
    referenceContract: {},
  });
  assert.ok(definition, `production v2 phase ${phase} must remain mapped`);
  assert.equal(definition.compatibilityMapping, false);
}

// Private reflection is a first-class production JSON stage. One valid call
// maps into the reflection envelope and advances only this Character's private
// provider checkpoint once.
{
  const reflectionFake = makeResponsesFake();
  const reflectionPool = createCharacterModelSessionPool({
    providerPort: createOpenAIJsonCharacterModelProvider({
      model: "test-responses",
      callJson: reflectionFake.callJson,
      opaqueConversationIdFactory: () => "opaque:responses:reflection",
    }),
  });
  const reflectionInput = {
    characterId: XIE,
    ownerCharacterId: XIE,
    agentTurnId: `agent-turn:${XIE}:reflection:1`,
    phase: "awaiting_character_reflection",
    stage: "character_reflection",
    privateContext: {},
    referenceContract: {},
    submissionContract: { allowedSourceMemoryIds: [] },
  };
  const result = await reflectionPool.runStage(reflectionInput);
  assert.equal(reflectionFake.calls.length, 1);
  assert.equal(reflectionFake.calls[0].schemaName, "tavern_character_reflection_v27");
  assert.match(reflectionFake.calls[0].system, /独自整理|反思/u);
  assert.deepEqual(result.reflection, {});
  assert.equal(result.stage.phase, "awaiting_character_reflection");
  assert.equal(result.stage.compatibilityMapping, false);
  assert.equal(JSON.stringify(result).includes("response-private-1"), false);
  const checkpoint = await reflectionPool.checkpoint();
  const session = checkpoint.sessions.find((row) => row.characterId === XIE);
  assert.equal(session.providerCheckpoint.privateState.acceptedStageCount, 1);
  assert.equal(
    session.providerCheckpoint.privateState.conversationContext.previousResponseId,
    "response-private-1",
  );
  await reflectionPool.close();
}

// RED: continuity metadata is mandatory whenever the port is used as a
// CharacterModelSession provider.
const missing = makeResponsesFake({ omitCheckpoint: true });
const missingPool = createCharacterModelSessionPool({
  providerPort: createOpenAIJsonCharacterModelProvider({
    model: "test-responses",
    callJson: missing.callJson,
    opaqueConversationIdFactory: () => "opaque:red:missing-checkpoint",
  }),
});
await assert.rejects(
  missingPool.runStage(firstStageInput(XIE, 90)),
  (error) => error.code === "OPENAI_JSON_CHARACTER_PROVIDER_KIND_INVALID",
);
assert.equal(missing.calls.length, 1);
await missingPool.close();

// RED: an established Responses character may not silently become a Chat
// Completions character on the next stage.
const changing = makeResponsesFake({ changeKindAt: 2 });
const changingPool = createCharacterModelSessionPool({
  providerPort: createOpenAIJsonCharacterModelProvider({
    model: "test-responses",
    callJson: changing.callJson,
    opaqueConversationIdFactory: () => "opaque:red:kind-change",
  }),
});
await changingPool.runStage(firstStageInput(XIE, 91));
await assert.rejects(
  changingPool.runStage(firstStageInput(XIE, 92)),
  (error) => error.code === "OPENAI_JSON_CHARACTER_PROVIDER_KIND_CHANGED",
);
await changingPool.close();

// GREEN: Responses continuity uses only previousResponseId in private state.
const responsesFake = makeResponsesFake();
const responsesProvider = createOpenAIJsonCharacterModelProvider({
  model: "test-responses",
  callJson: responsesFake.callJson,
  opaqueConversationIdFactory: () => `opaque:responses:${++opaqueSequence}`,
});
const responsesPool = createCharacterModelSessionPool({ providerPort: responsesProvider });
const [appraisalInput, candidateInput] = await firstTwoStageInputs(XIE);
const responseOne = await responsesPool.runStage(appraisalInput);
const responseTwo = await responsesPool.runStage(candidateInput);
const responseThree = await responsesPool.runStage(firstStageInput(XIE, 2));
const atomicResult = await responsesPool.runStage(atomicCommitInput(XIE, 2));
const xieOpaqueId = responsesPool.snapshot(XIE).providerConversationId;

assert.deepEqual(responsesFake.calls.map((row) => row.conversationContext.previousResponseId || ""), [
  "", "response-private-1", "response-private-2", "response-private-3",
]);
assert.equal(responsesFake.calls[0].schemaName, "tavern_character_subjective_appraisal_v2");
assert.match(responsesFake.calls[0].system, /awaiting_subjective_appraisal/u);
assert.match(responsesFake.calls[0].user, /isolated|私人输入|characterId/u);
assert.equal(responsesFake.calls[1].schemaName, "tavern_character_candidates_v2");
assert.equal(responsesFake.calls[3].schemaName, "tavern_character_turn_commit_v2");
assert.equal(openAIJsonCharacterModelStageDefinition(atomicCommitInput(XIE)).compatibilityMapping, false);
assert.ok(atomicResult.turnCommit);
assert.equal(atomicResult.stage.compatibilityMapping, false);

for (const result of [responseOne, responseTwo, responseThree, atomicResult]) {
  assert.equal(JSON.stringify(result).includes("response-private-"), false,
    "private Responses ids may not enter public stage results");
}

const responseCheckpoint = await responsesPool.checkpoint();
const xieResponseCheckpoint = responseCheckpoint.sessions.find((row) => row.characterId === XIE);
assert.equal(xieResponseCheckpoint.providerConversationId, xieOpaqueId);
assert.equal(
  xieResponseCheckpoint.providerCheckpoint.privateState.conversationContext.previousResponseId,
  "response-private-4",
);
assert.equal(
  Object.hasOwn(xieResponseCheckpoint.providerCheckpoint.privateState.conversationContext, "messages"),
  false,
);
await responsesPool.close();

const restoredResponsesFake = makeResponsesFake();
const restoredResponsesPool = restoreCharacterModelSessionPool(
  JSON.parse(JSON.stringify(responseCheckpoint)),
  {
    providerPort: createOpenAIJsonCharacterModelProvider({
      model: "test-responses",
      callJson: restoredResponsesFake.callJson,
      opaqueConversationIdFactory: () => "must-not-replace-restored-opaque-id",
    }),
  },
);
await restoredResponsesPool.runStage(firstStageInput(XIE, 3));
assert.equal(restoredResponsesPool.snapshot(XIE).providerConversationId, xieOpaqueId);
assert.equal(
  restoredResponsesFake.calls[0].conversationContext.previousResponseId,
  "response-private-4",
);
await restoredResponsesPool.close();

// GREEN: Chat Completions keeps a bounded, character-private transcript.
const chatFake = makeChatFake();
const chatPool = createCharacterModelSessionPool({
  providerPort: createOpenAIJsonCharacterModelProvider({
    model: "test-chat",
    maxTranscriptMessages: 4,
    callJson: chatFake.callJson,
    opaqueConversationIdFactory: (characterId) => `opaque:chat:${characterId}`,
  }),
});
await chatPool.runStage(firstStageInput(XIE, 1));
await chatPool.runStage(firstStageInput(XIE, 2));
await chatPool.runStage(firstStageInput(XIE, 3));
const luoChatResult = await chatPool.runStage(firstStageInput(LUO, 1));
assert.deepEqual(chatFake.calls.slice(0, 3).map((row) => row.conversationContext.messages?.length || 0), [0, 3, 4]);
assert.equal(chatFake.calls[3].conversationContext.messages?.length || 0, 0,
  "Luo Zhao may not inherit Xie Zhenshi's private Chat transcript");
assert.equal(JSON.stringify(luoChatResult).includes("agent-turn:" + XIE), false);

const chatCheckpoint = await chatPool.checkpoint();
const xieChatCheckpoint = chatCheckpoint.sessions.find((row) => row.characterId === XIE);
const luoChatCheckpoint = chatCheckpoint.sessions.find((row) => row.characterId === LUO);
assert.equal(xieChatCheckpoint.providerCheckpoint.privateState.providerKind, "chat-completions");
assert.equal(xieChatCheckpoint.providerCheckpoint.privateState.conversationContext.messages.length, 4);
assert.equal(
  JSON.stringify(luoChatCheckpoint.providerCheckpoint.privateState.conversationContext)
    .includes(`agent-turn:${XIE}`),
  false,
);
assert.equal(JSON.stringify(chatPool.snapshot(XIE)).includes("messages"), false);
await chatPool.close();

console.log(JSON.stringify({
  status: "all-passed",
  checks: {
    missingConversationCheckpointRejected: true,
    providerKindSwitchRejected: true,
    existingStagesReuseProductionPromptsAndSchemas: true,
    privateReflectionUsesProductionPromptSchemaAndCheckpoint: true,
    atomicTurnCommitUsesProductionSchema: true,
    responsesKeepsPreviousResponseIdPrivate: true,
    responsesCheckpointRestoresContinuity: true,
    chatKeepsBoundedPrivateTranscript: true,
    differentCharactersRemainIsolated: true,
    publicHandlesUseOnlyOpaqueIds: true,
    externalProviderNeverCalled: true,
  },
}, null, 2));
