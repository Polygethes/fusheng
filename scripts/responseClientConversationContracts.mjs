import assert from "node:assert/strict";

import { callOpenAIJson } from "../src/server/pipeline/responseClient.mjs";

const originalFetch = globalThis.fetch;
const originalEnvironment = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_STYLE: process.env.OPENAI_API_STYLE,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
};

function restoreEnvironment() {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["ok"],
  properties: { ok: { type: "boolean" } },
};

try {
  process.env.OPENAI_API_KEY = "test-key-never-sent";
  process.env.OPENAI_BASE_URL = "https://local.invalid/v1";
  process.env.OPENAI_MODEL = "test-model";

  const responseBodies = [];
  let responseSequence = 0;
  process.env.OPENAI_API_STYLE = "responses";
  globalThis.fetch = async (_url, options = {}) => {
    responseBodies.push(JSON.parse(options.body));
    responseSequence += 1;
    return new Response(JSON.stringify({
      id: `response_${responseSequence}`,
      output_text: JSON.stringify({ ok: true }),
      status: "completed",
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const firstResponse = await callOpenAIJson({
    system: "same private character",
    user: "stage one",
    schema,
    schemaName: "test_stage",
    conversationContext: {},
  });
  assert.equal(firstResponse.meta.conversationCheckpoint.previousResponseId, "response_1");
  const secondResponse = await callOpenAIJson({
    system: "same private character",
    user: "stage two",
    schema,
    schemaName: "test_stage",
    conversationContext: firstResponse.meta.conversationCheckpoint,
  });
  assert.equal(responseBodies[0].previous_response_id, undefined);
  assert.equal(responseBodies[1].previous_response_id, "response_1");
  assert.equal(responseBodies[1].instructions, "same private character");
  assert.equal(secondResponse.meta.conversationCheckpoint.previousResponseId, "response_2");

  const chatBodies = [];
  let chatSequence = 0;
  process.env.OPENAI_API_STYLE = "chat-completions";
  globalThis.fetch = async (_url, options = {}) => {
    chatBodies.push(JSON.parse(options.body));
    chatSequence += 1;
    return new Response(JSON.stringify({
      id: `chat_${chatSequence}`,
      choices: [{
        finish_reason: "stop",
        message: { content: JSON.stringify({ ok: true }) },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const firstChat = await callOpenAIJson({
    system: "same private character",
    user: "chat stage one",
    schema,
    schemaName: "test_stage",
    conversationContext: {},
  });
  assert.equal(firstChat.meta.conversationCheckpoint.messages.at(-1).role, "assistant");
  await callOpenAIJson({
    system: "same private character",
    user: "chat stage two",
    schema,
    schemaName: "test_stage",
    conversationContext: firstChat.meta.conversationCheckpoint,
  });
  assert.equal(
    chatBodies[1].messages.some((row) => row.role === "assistant" && row.content === JSON.stringify({ ok: true })),
    true,
  );
  assert.equal(chatBodies[1].messages.at(-1).content, "chat stage two");

  console.log(JSON.stringify({
    status: "all-passed",
    checks: {
      responsesUsesPreviousResponseId: true,
      chatReplaysPrivateTranscript: true,
      conversationCheckpointRemainsCallerOwned: true,
      noExternalProviderCalled: true,
    },
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  restoreEnvironment();
}
