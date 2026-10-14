// A model request that hangs must not hang the run: each attempt has a time
// limit that fits its stage, a stalled attempt is retried, and every attempt
// is recorded so a slow run can be explained afterwards.
import test from "node:test";
import assert from "node:assert/strict";
import { callModelJson } from "../src/server/model/modelClient.mjs";
import { callGeminiCharacterStage, stageTimeoutMs } from "../src/server/ecology/geminiCharacterStage.mjs";
import { waitingNote } from "../src/stage/waiting.js";

const KEY = "fake-secret-key-stall-24680";
const REQUEST = { systemPrompt: "s", userPrompt: "u json", schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } };
const GATEWAY = { apiKey: KEY, model: "gemini-3.8-flash", apiBaseUrl: "https://gateway.invalid/v1", sleep: async () => {} };

// Never answers; gives up only when the request's signal is aborted.
const hang = (url, options) => new Promise((resolve, reject) => {
  options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
});
const answer = (output, status = 200) => new Response(JSON.stringify(status === 200
  ? { id: "r1", model: "gemini-3.8-flash", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 5, completion_tokens: 3 } }
  : { error: { message: "busy" } }), { status, headers: { "content-type": "application/json" } });

test("a stalled attempt times out and the retry's answer is used", async () => {
  let calls = 0;
  const responses = [];
  const result = await callModelJson(REQUEST, { ...GATEWAY, timeoutMs: 30,
    fetchImpl: async (url, options) => (++calls === 1 ? hang(url, options) : answer({ ok: true })),
    onResponse: (response) => responses.push(response) });
  assert.deepEqual(result.output, { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(responses[0].attempts.map((row) => row.outcome), ["timeout", "ok"]);
  assert.ok(responses[0].attempts.every((row, index) => row.attempt === index + 1 && Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0));
  assert.ok(responses[0].attempts[0].elapsedMs >= 25, "the first attempt waited for its time limit");
  assert.deepEqual(result.stage.attempts, responses[0].attempts, "the attempts are kept with the stage record");
});

test("an answer that is busy and then fine records both attempts", async () => {
  let calls = 0;
  const responses = [];
  await callModelJson(REQUEST, { ...GATEWAY, timeoutMs: 1000,
    fetchImpl: async () => (++calls === 1 ? answer(null, 503) : answer({ ok: true })),
    onResponse: (response) => responses.push(response) });
  assert.deepEqual(responses[0].attempts.map((row) => row.outcome), ["http_503", "ok"]);
});

test("when every attempt stalls, the error says so in seconds and keeps the attempts", async () => {
  let calls = 0;
  await assert.rejects(
    callModelJson(REQUEST, { ...GATEWAY, timeoutMs: 20, fetchImpl: async (url, options) => { calls += 1; return hang(url, options); } }),
    (error) => {
      assert.equal(error.code, "MODEL_REQUEST_TIMEOUT");
      assert.match(error.message, /秒/u);
      assert.ok(!error.message.includes(KEY));
      assert.deepEqual(error.attempts.map((row) => row.outcome), ["timeout", "timeout", "timeout"]);
      return true;
    });
  assert.equal(calls, 3);
});

test("a caller's own abort is not retried", async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = callModelJson(REQUEST, { ...GATEWAY, timeoutMs: 5000, signal: controller.signal,
    fetchImpl: async (url, options) => { calls += 1; return hang(url, options); } });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending);
  assert.equal(calls, 1);
});

test("the time limit fits the stage: quick beats give up sooner than deep thinking", () => {
  assert.equal(stageTimeoutMs("awaiting_performance_beat"), 45_000);
  assert.equal(stageTimeoutMs("awaiting_day_schedule"), 90_000);
  for (const phase of ["awaiting_subjective_appraisal_and_candidates", "awaiting_agent_choice_and_regulation", "awaiting_agent_turn_commit", "awaiting_character_reflection"]) {
    assert.equal(stageTimeoutMs(phase), 180_000, phase);
  }
});

test("a character stage passes its time limit to the request", async () => {
  let calls = 0;
  const responses = [];
  const stageInput = { phase: "awaiting_performance_beat", outputKey: "performance", prompt: { system: "s", user: "u json" }, schema: REQUEST.schema };
  const result = await callGeminiCharacterStage(stageInput, { ...GATEWAY, apiBaseUrl: "https://gateway.invalid/v1", timeoutMs: 30,
    fetchImpl: async (url, options) => (++calls === 1 ? hang(url, options) : answer({ ok: true })),
    onResponse: (response) => responses.push(response) });
  assert.deepEqual(result.performance, { ok: true });
  assert.deepEqual(responses[0].attempts.map((row) => row.outcome), ["timeout", "ok"]);
});

test("the observer says how long it has waited for the model, once the wait is noticeable", () => {
  const since = "2026-10-11T14:02:17.996Z";
  const at = (seconds) => Date.parse(since) + seconds * 1000;
  assert.equal(waitingNote(null, at(100)), "");
  assert.equal(waitingNote(since, at(9)), "", "a normal answer takes a few seconds; say nothing");
  assert.equal(waitingNote(since, at(15)), " · 等模型回应 15 秒");
  assert.equal(waitingNote(since, at(130)), " · 等模型回应 2 分 10 秒");
  assert.equal(waitingNote("not a time", at(130)), "");
});
