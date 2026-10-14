import test from "node:test";
import assert from "node:assert/strict";
import { callModelJson, geminiResponseSchema } from "../src/server/model/modelClient.mjs";

test("callModelJson: native Google Gemini API request format and output parsing", async () => {
  let captured = null;
  const fakeFetch = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      modelVersion: "gemini-3.8-flash",
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [{ text: JSON.stringify({ greeting: "hello world" }) }],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const KEY = "fake-secret-key-native-12345";
  const result = await callModelJson(
    {
      systemPrompt: "You are an assistant.",
      userPrompt: "Say hello.",
      schema: { type: "object", properties: { greeting: { type: "string" } }, required: ["greeting"] },
    },
    {
      apiKey: KEY,
      model: "gemini-3.8-flash",
      apiBaseUrl: "https://generativelanguage.googleapis.com",
      fetchImpl: fakeFetch,
    }
  );

  assert.equal(captured.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
  assert.equal(captured.options.headers["x-goog-api-key"], KEY);
  assert.equal(captured.options.redirect, "error");
  assert.equal(captured.body.systemInstruction.parts[0].text, "You are an assistant.");
  assert.ok(captured.body.generationConfig.responseJsonSchema);
  assert.deepEqual(result.output, { greeting: "hello world" });
  assert.equal(result.stage.provider, "google-gemini-api");
  assert.equal(result.stage.model, "gemini-3.8-flash");
});

test("callModelJson: OpenAI-compatible gateway with json_object mode appends schema", async () => {
  let captured = null;
  const fakeFetch = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      id: "chatcmpl-123",
      model: "gemini-3.8-flash-gateway",
      choices: [
        {
          finish_reason: "stop",
          message: { content: "```json\n{\"answer\": 42}\n```" },
        },
      ],
      usage: { prompt_tokens: 15, completion_tokens: 4 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const KEY = "fake-secret-key-gateway-67890";
  const result = await callModelJson(
    {
      systemPrompt: "System prompt here.",
      userPrompt: "What is the answer?",
      schema: { type: "object", properties: { answer: { type: "number" } }, required: ["answer"] },
    },
    {
      apiKey: KEY,
      model: "gemini-3.8-flash-high",
      apiBaseUrl: "https://gw.example:18081/v1",
      responseFormat: "json_object",
      fetchImpl: fakeFetch,
    }
  );

  assert.equal(captured.url, "https://gw.example:18081/v1/chat/completions");
  assert.equal(captured.options.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(captured.body.response_format.type, "json_object");
  assert.ok(captured.body.messages[1].content.includes("What is the answer?"));
  assert.ok(captured.body.messages[1].content.includes("Return one JSON object matching this complete output schema"));
  assert.deepEqual(result.output, { answer: 42 });
  assert.equal(result.stage.provider, "openai-compatible-gemini-api");
  assert.equal(result.stage.outputEnvelope, "markdown-json");
});

test("callModelJson: retries on 502 and succeeds on 3rd attempt with custom sleep", async () => {
  let attempts = 0;
  const sleepCalls = [];
  const fakeSleep = async (ms) => { sleepCalls.push(ms); };
  const fakeFetch = async () => {
    attempts++;
    if (attempts < 3) {
      return new Response("Bad Gateway", { status: 502 });
    }
    return new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: '{"status":"recovered"}' } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await callModelJson(
    { systemPrompt: "Sys", userPrompt: "User", schema: { type: "object" } },
    {
      apiKey: "sk-key",
      apiBaseUrl: "https://gw.example/v1",
      fetchImpl: fakeFetch,
      sleep: fakeSleep,
    }
  );

  assert.equal(attempts, 3);
  assert.deepEqual(sleepCalls, [2000, 4000]);
  assert.deepEqual(result.output, { status: "recovered" });
});

test("callModelJson: non-JSON text response throws CHARACTER_STAGE_OUTPUT_INVALID with rawOutput", async () => {
  const fakeFetch = async () => {
    return new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: "I cannot fulfill this request as JSON." } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  await assert.rejects(
    async () => {
      await callModelJson(
        { systemPrompt: "Sys", userPrompt: "User", schema: { type: "object" } },
        { apiKey: "sk-key", apiBaseUrl: "https://gw.example/v1", fetchImpl: fakeFetch }
      );
    },
    (err) => {
      assert.equal(err.code, "CHARACTER_STAGE_OUTPUT_INVALID");
      assert.equal(err.rawOutput, "I cannot fulfill this request as JSON.");
      assert.equal(err.issues[0].code, "STAGE_OUTPUT_INVALID_JSON");
      return true;
    }
  );
});

test("callModelJson: does not leak API key in error messages, onRequest or onResponse", async () => {
  const KEY = "super-secret-key-must-not-leak-999999";
  let capturedRequest = null;
  let capturedResponse = null;

  const fakeFetch = async () => {
    return new Response(JSON.stringify({
      error: { message: `Key ${KEY} quota exceeded` },
    }), { status: 400, headers: { "content-type": "application/json" } });
  };

  await assert.rejects(
    async () => {
      await callModelJson(
        { systemPrompt: "Sys", userPrompt: "User", schema: { type: "object" } },
        {
          apiKey: KEY,
          apiBaseUrl: "https://gw.example/v1",
          fetchImpl: fakeFetch,
          onRequest: async (req) => { capturedRequest = JSON.stringify(req); },
          onResponse: async (res) => { capturedResponse = JSON.stringify(res); },
        }
      );
    },
    (err) => {
      assert.ok(!err.message.includes(KEY), `Error message should not contain secret key: ${err.message}`);
      assert.ok(!capturedResponse.includes(KEY), `Captured response should not contain secret key: ${capturedResponse}`);
      return true;
    }
  );
});

test("geminiResponseSchema: an enum that allows an empty string is sent as a plain string", async () => {
  const schema = { type: "object", additionalProperties: false, required: ["say", "kind"], optionalProperties: ["note"],
    properties: {
      say: { type: "object", properties: { to: { type: "string", enum: ["", "P1", "P2"] }, text: { type: "string" } } },
      kind: { type: "string", enum: ["move", "wait"] },
      enum: { type: "string", enum: ["a", "b"] },
    } };
  const sent = geminiResponseSchema(schema);
  assert.deepEqual(sent.properties.say.properties.to, { type: "string" }, "the empty-allowing enum is dropped, the field stays");
  assert.deepEqual(sent.properties.kind.enum, ["move", "wait"], "an enum without an empty string is kept");
  assert.deepEqual(sent.properties.enum.enum, ["a", "b"], "a property that happens to be named enum is not touched");
  assert.equal("optionalProperties" in sent, false);
  assert.deepEqual(schema.properties.say.properties.to.enum, ["", "P1", "P2"], "the stage's own schema is unchanged");
  let body = null;
  await callModelJson({ systemPrompt: "s", userPrompt: "u", schema }, { apiKey: "k", apiBaseUrl: "https://gateway.invalid/v1",
    fetchImpl: async (_url, init) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ choices: [{ message: { content: "{\"say\":{\"to\":\"\",\"text\":\"\"},\"kind\":\"wait\"}" }, finish_reason: "stop" }] }), { status: 200 }); } });
  assert.equal(JSON.stringify(body).includes('"enum":[""'), false, "no empty enum value reaches the gateway");
});

test("callModelJson: DeepSeek uses its own /chat/completions, json_object with the schema and the word json, and a thinking effort", async () => {
  let seen = null;
  const schema = { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } };
  const result = await callModelJson({ systemPrompt: "你在扮演一个人物。", userPrompt: "此刻做什么？", schema },
    { apiKey: "sk-deepseek-0123456789", apiBaseUrl: "https://api.deepseek.com", model: "deepseek-flash", responseFormat: "json_schema", thinkingLevel: "low",
      fetchImpl: async (url, init) => {
        seen = { url, body: JSON.parse(init.body), auth: init.headers.Authorization };
        return new Response(JSON.stringify({ model: "deepseek-flash", choices: [{ finish_reason: "stop", message: { content: "{\"ok\":true}", reasoning_content: "想了想" } }] }), { status: 200 });
      } });
  assert.equal(seen.url, "https://api.deepseek.com/chat/completions", "no /v1 for DeepSeek");
  assert.deepEqual(seen.body.response_format, { type: "json_object" }, "DeepSeek gets json_object even when json_schema was asked");
  assert.match(seen.body.messages[1].content, /"required":\["ok"\]/u, "the schema travels in the prompt");
  assert.match(seen.body.messages.map((row) => row.content).join("\n"), /json/u, "the prompt contains the word json");
  assert.deepEqual(seen.body.thinking, { type: "enabled", reasoning_effort: "low" });
  assert.equal(seen.auth, "Bearer sk-deepseek-0123456789");
  assert.deepEqual(result.output, { ok: true });
});
