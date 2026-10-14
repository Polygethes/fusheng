import assert from "node:assert/strict";

import { callOpenAIJson } from "../src/server/pipeline/responseClient.mjs";
import { runTavernCharacterAgentV2Stage } from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import {
  createModelRequestBudget,
  modelRequestBudgetSnapshot,
} from "../src/server/pipeline/modelRequestBudget.mjs";

const originalFetch = globalThis.fetch;
const originalEnv = {
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  CHARACTER_TOWN_API_STYLE: process.env.CHARACTER_TOWN_API_STYLE,
  CHARACTER_TOWN_MODEL: process.env.CHARACTER_TOWN_MODEL,
};

try {
  process.env.DEEPSEEK_API_KEY = "unit-test-only";
  delete process.env.OPENAI_API_KEY;
  process.env.OPENAI_BASE_URL = "https://api.deepseek.test";
  process.env.CHARACTER_TOWN_API_STYLE = "chat-completions";
  process.env.CHARACTER_TOWN_MODEL = "deepseek-v4-flash";

  let fetchCount = 0;
  let lastRequestBody = null;
  globalThis.fetch = async (_url, options = {}) => {
    fetchCount += 1;
    lastRequestBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          id: `fake-response-${fetchCount}`,
          choices: [{
            finish_reason: "stop",
            message: { content: fetchCount === 1 ? "not-json" : "{}" },
          }],
          usage: { total_tokens: 1 },
        };
      },
    };
  };

  const budget = createModelRequestBudget({
    maxProviderRequests: 1,
    authorizationId: "authorization:test:one-request",
  });

  await assert.rejects(
    callOpenAIJson({
      system: "test",
      user: "test",
      schema: { type: "object", properties: {} },
      schemaName: "test_payload",
      requestBudget: budget,
      requestContext: {
        characterId: "char_test",
        agentTurnId: "agent-turn:char_test:1",
        phase: "awaiting_subjective_appraisal",
      },
    }),
    (error) => error?.code === "MODEL_PROVIDER_REQUEST_BUDGET_EXHAUSTED",
  );

  assert.equal(fetchCount, 1, "the parse retry must be stopped before a second provider fetch");
  assert.deepEqual(modelRequestBudgetSnapshot(budget), {
    schemaVersion: "model-provider-request-budget-v1",
    authorizationId: "authorization:test:one-request",
    maxProviderRequests: 1,
    usedProviderRequests: 1,
    remainingProviderRequests: 0,
    rejectedProviderRequests: 1,
    attempts: [{
      requestIndex: 1,
      characterId: "char_test",
      agentTurnId: "agent-turn:char_test:1",
      phase: "awaiting_subjective_appraisal",
      retryKind: "initial",
      parseRetryCount: 0,
      networkRetryCount: 0,
    }],
  });

  const stageBudget = createModelRequestBudget({
    maxProviderRequests: 1,
    authorizationId: "authorization:test:stage-threading",
  });
  await runTavernCharacterAgentV2Stage({
    phase: "awaiting_subjective_appraisal",
    characterId: "char_stage_test",
    agentTurnId: "agent-turn:char_stage_test:4",
  }, { requestBudget: stageBudget });
  assert.deepEqual(modelRequestBudgetSnapshot(stageBudget).attempts, [{
    requestIndex: 1,
    characterId: "char_stage_test",
    agentTurnId: "agent-turn:char_stage_test:4",
    phase: "awaiting_subjective_appraisal",
    retryKind: "initial",
    parseRetryCount: 0,
    networkRetryCount: 0,
  }]);
  const stageSystemPrompt = lastRequestBody?.messages?.[0]?.content || "";
  assert.match(stageSystemPrompt, /"terminalContractAcknowledged"/);
  assert.match(stageSystemPrompt, /"promotedCriteria"/);
  assert.match(stageSystemPrompt, /"activationState"/);
  assert.match(stageSystemPrompt, /"activationEvidenceIds"/);
  assert.match(stageSystemPrompt, /"activationPsychologicalSourceIds"/);
  assert.match(stageSystemPrompt, /"inactive","latent","uncertain","triggered","active"/);

  console.log(JSON.stringify({
    status: "all-passed",
    checks: {
      everyProviderFetchConsumesBudget: true,
      jsonRepairCannotBypassAuthorizationLimit: true,
      characterStageThreadsAuthorizationBudgetToProvider: true,
      characterStageTransmitsNestedRequiredSchemaToJsonObjectProviders: true,
      budgetSnapshotContainsNoPromptOrCredential: true,
    },
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
