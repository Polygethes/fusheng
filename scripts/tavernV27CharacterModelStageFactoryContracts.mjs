import assert from "node:assert/strict";

import {
  createTavernV27CharacterModelSessionStageFactory,
} from "../src/server/pipeline/tavernV27PersistentModelSession.mjs";
import { reserveModelProviderRequest } from "../src/server/pipeline/modelRequestBudget.mjs";

const XIE = "char_xyy_xiezenshi";
const LUO = "char_xyy_luozhao";
let conversationSequence = 0;
const providerCalls = [];

function providerPortFactory({ requestBudget }) {
  const live = new Map();
  return {
    async openConversation(input = {}) {
      const providerConversationId = input.providerConversationId
        || `test-model-conversation:${++conversationSequence}`;
      live.set(providerConversationId, {
        characterId: input.characterId,
        providerConversationId,
        history: structuredClone(input.providerCheckpoint?.history || []),
      });
      return { characterId: input.characterId, providerConversationId };
    },
    async runStage(handle, input = {}, context = {}) {
      reserveModelProviderRequest(requestBudget, {
        characterId: input.characterId,
        agentTurnId: input.agentTurnId,
        phase: input.phase,
      });
      const row = live.get(handle.providerConversationId);
      const historyBefore = structuredClone(row.history);
      row.history.push(`${input.agentTurnId}:${input.phase}`);
      providerCalls.push({
        characterId: input.characterId,
        providerConversationId: handle.providerConversationId,
        historyBefore,
        stageSequence: context.stageSequence,
      });
      return {
        characterId: input.characterId,
        providerConversationId: handle.providerConversationId,
        ok: true,
      };
    },
    async checkpointConversation(handle) {
      const row = live.get(handle.providerConversationId);
      return {
        characterId: row.characterId,
        providerConversationId: row.providerConversationId,
        history: structuredClone(row.history),
      };
    },
    async closeConversation(handle) {
      live.delete(handle.providerConversationId);
    },
  };
}

function stage(characterId, turn, phase) {
  return { characterId, agentTurnId: `turn:${characterId}:${turn}`, phase };
}

const stageFactory = createTavernV27CharacterModelSessionStageFactory({
  model: "test-model",
  providerPortFactory,
});

const first = await stageFactory({
  purpose: "command",
  sessionId: "world-session:test",
  executionContext: {
    operation: "start",
    authorizationAcknowledged: true,
    authorizationId: "authorization:test:1",
  },
});
await first.runStage(stage(XIE, 1, "appraisal"));
await first.runStage(stage(XIE, 1, "candidates"));
await first.runStage(stage(LUO, 1, "appraisal"));
const firstCheckpoint = await first.checkpoint();
assert.equal(firstCheckpoint.sessions.length, 2);
assert.equal(first.publicMetadata().providerRequestBudget.usedProviderRequests, 3);
await first.close();

const second = await stageFactory({
  purpose: "command",
  sessionId: "world-session:test",
  characterModelSessionCheckpoint: firstCheckpoint,
  executionContext: {
    operation: "continue",
    authorizationAcknowledged: true,
    authorizationId: "authorization:test:2",
  },
});
await second.runStage(stage(XIE, 2, "appraisal"));
const xieCalls = providerCalls.filter((row) => row.characterId === XIE);
assert.equal(xieCalls.length, 3);
assert.equal(xieCalls[0].providerConversationId, xieCalls[2].providerConversationId);
assert.deepEqual(xieCalls[2].historyBefore, [
  `turn:${XIE}:1:appraisal`,
  `turn:${XIE}:1:candidates`,
]);
assert.equal(second.publicMetadata().providerRequestBudget.usedProviderRequests, 1);
await second.close();

await assert.rejects(
  stageFactory({
    purpose: "command",
    sessionId: "world-session:test",
    executionContext: { authorizationAcknowledged: false },
  }),
  (error) => error?.code === "TAVERN_V27_EXTERNAL_MODEL_AUTHORIZATION_REQUIRED",
);

console.log(JSON.stringify({
  status: "all-passed",
  checks: {
    sameCharacterStagesShareConversation: true,
    nextCommandRestoresPrivateConversation: true,
    differentCharactersRemainIsolated: true,
    commandBudgetTracksProviderRequests: true,
    authorizationRemainsPerCommand: true,
    noExternalProviderCalled: true,
  },
}, null, 2));
