import assert from "node:assert/strict";
import test from "node:test";
import { callGeminiCharacterStage } from "../src/server/ecology/geminiCharacterStage.mjs";

const input = { phase: "awaiting_agent_turn_commit", characterId: "a", agentTurnId: "t:1", requestedOutput: "character_turn_commit_only", expressionMoment: {} };
test("Gemini API stage records model metadata and preserves authored JSON without exposing headers", async () => {
  let requestRecord, responseRecord, body;
  const authored = { actionAttempt: { primitive: "rest" }, privateNote: "原样保留" };
  const result = await callGeminiCharacterStage(input, { apiKey: "test-secret", onRequest: value => { requestRecord = value; }, onResponse: value => { responseRecord = value; },
    async fetchImpl(url, options) {
      assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
      assert.equal(options.headers["x-goog-api-key"], "test-secret");
      assert.equal(options.redirect, "error");
      body = JSON.parse(options.body);
      return new Response(JSON.stringify({ modelVersion: "gemini-3.8-flash", responseId: "r1", usageMetadata: { totalTokenCount: 100 },
        candidates: [{ finishReason: "STOP", content: { parts: [{ thought: true, text: "not output" }, { text: JSON.stringify(authored) }] } }] }));
    } });
  assert.deepEqual(result.turnCommit, authored);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.ok(body.generationConfig.responseJsonSchema);
  assert.equal(result.stage.model, "gemini-3.8-flash");
  assert.equal(result.stage.responseId, "r1");
  assert.ok(!JSON.stringify([requestRecord, responseRecord]).includes("test-secret"));
});
test("Gemini authentication failures are redacted and never substituted with fixture output", async () => {
  let recorded;
  await assert.rejects(callGeminiCharacterStage(input, { apiKey: "test-secret", onResponse: value => { recorded = value; },
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "Invalid test-secret" } }), { status: 400 }) }),
  error => error.code === "GEMINI_API_ERROR" && error.httpStatus === 400 && !error.message.includes("test-secret"));
  assert.ok(!JSON.stringify(recorded).includes("test-secret"));
});
test("a user-specified gateway uses its OpenAI-compatible endpoint and reports the returned model", async () => {
  const result = await callGeminiCharacterStage(input, { apiKey: "gateway-test", apiBaseUrl: "https://example.test:18081/v1/",
    model: "gemini-3.8-flash-medium", async fetchImpl(url, options) {
      assert.equal(url, "https://example.test:18081/v1/chat/completions");
      assert.equal(options.headers.Authorization, "Bearer gateway-test");
      const body = JSON.parse(options.body);
      assert.equal(body.model, "gemini-3.8-flash-medium");
      assert.equal(body.response_format.type, "json_schema");
      return new Response(JSON.stringify({ id: "gateway-r1", model: "gemini-3.8-flash-medium", usage: { total_tokens: 10 },
        choices: [{ finish_reason: "stop", message: { content: '```json\n{"literal":"由模型生成"}\n```' } }] }));
    } });
  assert.equal(result.turnCommit.literal, "由模型生成");
  assert.equal(result.stage.model, "gemini-3.8-flash-medium");
  assert.equal(result.stage.provider, "openai-compatible-gemini-api");
  assert.equal(result.stage.outputEnvelope, "markdown-json");
});
test("gateway JSON mode carries the complete schema in the prompt and still rejects truncated replies", async () => {
  await assert.rejects(callGeminiCharacterStage(input, { apiKey: "gateway-test", apiBaseUrl: "https://example.test",
    responseFormat: "json_object", async fetchImpl(url, options) {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.response_format, { type: "json_object" });
      assert.ok(body.messages[1].content.includes('"actionAttempt"'));
      assert.ok(body.messages[1].content.includes("complete output schema"));
      return new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: '{"unfinished":' } }] }));
    } }), { code: "GEMINI_RESPONSE_INCOMPLETE" });
});
test("a repair receives its own previous authored output, while a fresh stage does not", async () => {
  for (const repairing of [false, true]) {
    const stageInput = { ...input, ...(repairing ? { protocolRepairFeedback: { violations: [{ code: "STAGE_OUTPUT_REQUIRED", path: "output.actionAttempt" }] } } : {}) };
    await callGeminiCharacterStage(stageInput, { apiKey: "test", apiBaseUrl: "https://example.test", previousOutput: { uniquePriorMarker: "same-character-only" },
      async fetchImpl(url, options) {
        const body = JSON.parse(options.body);
        assert.equal(body.messages[1].content.includes("same-character-only"), repairing);
        return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{}" } }] }));
      } });
  }
});
test("invalid JSON is reported as repairable with the exact model text, never rewritten", async () => {
  const authored = '{"field":1}unexpected prose';
  await assert.rejects(callGeminiCharacterStage(input, { apiKey: "test", apiBaseUrl: "https://example.test",
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: authored } }] })) }),
  error => error.code === "CHARACTER_STAGE_OUTPUT_INVALID" && error.rawOutput === authored && error.issues[0].code === "STAGE_OUTPUT_INVALID_JSON");
});
test("a performance beat sends its own prose prompt, returns under `performance`, and repairs with feedback only", async () => {
  const beat = { phase: "awaiting_performance_beat", characterId: "a", agentTurnId: "t:2", outputKey: "performance",
    prompt: { system: "你在扮演「小满」。", user: "【此刻】你在堂屋。" }, schema: { type: "object", properties: { thought: { type: "string" } } } };
  const authored = { thought: "爹在磨刀", say: { to: "", text: "爹，你又一宿没睡？", loud: false }, do: { type: "none", target: "", person: "", minutes: 0 }, gesture: "" };
  for (const repairing of [false, true]) {
    const result = await callGeminiCharacterStage({ ...beat, ...(repairing ? { protocolRepairFeedback: { issues: [{ path: "do.target", message: "move 的 target 只能是 main_room。" }] } } : {}) },
      { apiKey: "test", apiBaseUrl: "https://example.test", previousOutput: { uniquePriorMarker: "never-for-performance" },
        async fetchImpl(url, options) {
          const body = JSON.parse(options.body);
          assert.equal(body.messages[0].content, beat.prompt.system);
          assert.ok(body.messages[1].content.startsWith(beat.prompt.user));
          assert.equal(body.messages[1].content.includes("do.target"), repairing, "repair feedback reaches the character");
          assert.ok(!body.messages[1].content.includes("never-for-performance"));
          return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(authored) } }] }));
        } });
    assert.deepEqual(result.performance, authored, "the character's words come back exactly as authored");
    assert.ok(Number.isFinite(result.stage.elapsedMs));
  }
});
