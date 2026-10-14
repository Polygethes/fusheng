// Importing a script or story into a new world: the window's text helpers
// decode Windows-saved Chinese, tidy the text, say how much the model reads and
// who speaks in it; the window's limits match the server's; an adaptation puts
// the original into every drafting stage and asks for its people by name,
// while loose reference text keeps the prompts exactly as before; and the
// endpoint refuses a use it does not know before any model call.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import {
  decodeTextBytes, normalizeImportedText, appendSource, measureSource, detectSpeakers, suggestedSize, describeImport,
  MODEL_READ_LIMIT, SOURCE_BYTES_LIMIT as WINDOW_BYTES_LIMIT,
} from "../src/play/importWindow.js";
import { SOURCE_TEXT_LIMIT } from "../src/worlds/generation/stages.mjs";
import { generateBlueprint, SOURCE_MODES } from "../src/worlds/generation/generateBlueprint.mjs";
import { createCreateApi, SOURCE_BYTES_LIMIT } from "../src/server/observer/createApi.mjs";
import { TAVERN_RELATIONSHIP_METRICS } from "../src/server/ecology/tavernRelationshipDynamics.mjs";

// ── the window's limits are the server's ──────────────────────────────────
assert.equal(MODEL_READ_LIMIT, SOURCE_TEXT_LIMIT, "the window tells the truth about how much the model reads");
assert.equal(WINDOW_BYTES_LIMIT, SOURCE_BYTES_LIMIT, "the window refuses what the server would refuse");
assert.deepEqual([...SOURCE_MODES], ["reference", "adapt"]);

// ── decoding ──────────────────────────────────────────────────────────────
const hello = "顾小满：带上了。";
assert.deepEqual(decodeTextBytes(new TextEncoder().encode(hello)), { text: hello, encoding: "utf-8" });
assert.equal(decodeTextBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(hello)])).text, hello, "a UTF-8 BOM is dropped");
assert.deepEqual(decodeTextBytes(new Uint8Array([0xc4, 0xe3, 0xba, 0xc3])), { text: "你好", encoding: "gb18030" }, "Windows-saved GBK reads as Chinese, not mojibake");
const utf16 = new Uint8Array([0xff, 0xfe, ...[...hello].flatMap((ch) => [ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8])]);
assert.equal(decodeTextBytes(utf16).text, hello, "UTF-16 with a BOM");

// ── tidying and joining ───────────────────────────────────────────────────
assert.equal(normalizeImportedText("﻿第一场  \r\n\r\n\r\n\r\n顾小满：嗯　\r"), "第一场\n\n顾小满：嗯");
assert.equal(appendSource("", "第一集.txt", "顾小满：嗯\r\n"), "【第一集.txt】\n顾小满：嗯");
assert.equal(appendSource("【第一集.txt】\n顾小满：嗯", "第二集.txt", "阿宝：走"), "【第一集.txt】\n顾小满：嗯\n\n【第二集.txt】\n阿宝：走");
assert.equal(appendSource("已有", "空.txt", "  \n  "), "已有", "an empty file adds nothing");

// ── measuring ─────────────────────────────────────────────────────────────
const short = measureSource("  三个字  ");
assert.deepEqual(short, { chars: 3, bytes: new TextEncoder().encode("  三个字  ").length, modelChars: 3, clipped: false, tooLarge: false });
const long = measureSource("字".repeat(MODEL_READ_LIMIT + 1));
assert.equal(long.clipped, true);
assert.equal(long.modelChars, MODEL_READ_LIMIT);
assert.equal(long.tooLarge, false);
assert.equal(measureSource("字".repeat(Math.ceil(SOURCE_BYTES_LIMIT / 3) + 1)).tooLarge, true);

// ── who speaks ────────────────────────────────────────────────────────────
const script = `# 借星 · 第一集

场景：藏星谷顾家，卯时三刻
时间：清晨
人物：顾小满、顾怀山、陆青禾、阿宝

> **顾小满**：……手上的伤，还疼不疼？
> **顾怀山**：死不了。……短剑带上了？
顾小满（小声）：带上了，就在身上收着。
陆青禾: 何嫂，先别碰她手臂。
阿宝：真带了？
阿宝：那你拿这些到底要去哪啊？
顾怀山：去吧。
陆青禾：我这就给她换药。
他说：“走吧。”
他说：“快走。”
旁白：天亮了。
旁白：雾散了。
第一场：清晨
第一场：又一个清晨
http://example.com
http://example.org
`;
const speakers = detectSpeakers(script);
assert.deepEqual(speakers.map((row) => row.name).sort(), ["阿宝", "陆青禾", "顾小满", "顾怀山"].sort(), "names in bold, with a stage note, and with ASCII colons all count; headings, narration, pronouns and links do not");
assert.equal(speakers.find((row) => row.name === "顾小满").lines, 2);
assert.equal(detectSpeakers("顾小满：嗯").length, 0, "a name seen once is not enough to go by");
const screenplay = "INT. KITCHEN - DAY\n\nMARY\nWhere were you?\n\nJOHN (V.O.)\nOut.\n\nMARY\nOut where?\n\nJOHN\nJust out.\n\nCUT TO:\n";
assert.deepEqual(detectSpeakers(screenplay).map((row) => row.name).sort(), ["JOHN", "MARY"], "screenplay cues in capitals");
assert.equal(suggestedSize([]), null);
assert.equal(suggestedSize(speakers), "small");
assert.equal(suggestedSize(Array.from({ length: 12 }, (_, i) => ({ name: `n${i}` }))), "medium");
assert.equal(suggestedSize(Array.from({ length: 16 }, (_, i) => ({ name: `n${i}` }))), "large");
assert.match(describeImport({ text: script, mode: "adapt" }), /^已导入 [\d,]+ 字 · 按原作改编 · 识别到 4 位说话的人：/u);
assert.match(describeImport({ text: "字".repeat(MODEL_READ_LIMIT + 1), mode: "reference" }), /只作参考 · 模型只读前 30,000 字/u);

// ── adapting vs borrowing in the drafting prompts ─────────────────────────
const fixture = JSON.parse(fs.readFileSync("scripts/fixtures/blueprints/river_town.json", "utf8"));
for (const row of fixture.relationships) {
  row.feelings = Object.fromEntries(Object.entries(row.feelings || {}).filter(([key]) => TAVERN_RELATIONSHIP_METRICS.includes(key)));
  if (!Object.keys(row.feelings).length) row.feelings = { love: 40 };
}
const sizes = Object.fromEntries(fixture.households.map((row) => [row.id, fixture.residents.filter((r) => r.householdId === row.id).length]));
function fixtureModel() {
  const calls = [];
  async function callModel(request) {
    calls.push(request);
    if (request.stage === "world") return { meta: fixture.meta, town: fixture.town, households: fixture.households, householdSizes: sizes };
    if (request.stage === "residents") return { residents: fixture.residents.filter((row) => row.householdId === request.user.match(/householdId: ([a-z0-9_-]+)/u)[1]) };
    if (request.stage === "relationships") return { relationships: fixture.relationships };
    if (request.stage === "opening") return { opening: fixture.opening };
    return { sections: {} };
  }
  return { callModel, calls };
}
const ORIGINAL = "顾怀山：死不了。……短剑带上了？\n顾小满：带上了，就在身上收着。";
const ASK = "从离家那天的清晨开始";
const byStage = (calls, stage) => calls.filter((row) => row.stage === stage);

const adapted = fixtureModel();
const adaptResult = await generateBlueprint({ idea: ASK, sourceText: ORIGINAL, sourceMode: "adapt", sizeHint: 14 }, { callModel: adapted.callModel, maxRequests: 20 });
assert.equal(adaptResult.ok, true);
for (const stage of ["world", "residents", "relationships", "opening"]) {
  for (const call of byStage(adapted.calls, stage)) {
    assert.ok(call.user.includes("【原作（玩家导入的剧本或文本，以它为准）】"), `${stage}: the original is in the prompt as canon`);
    assert.ok(call.user.includes(ORIGINAL), `${stage}: the whole original reaches the model`);
    assert.match(call.system, /改编/u, `${stage}: the model is told it is adapting`);
  }
}
assert.match(byStage(adapted.calls, "world")[0].user, /^【玩家的改编要求】\n从离家那天的清晨开始/u);
assert.match(byStage(adapted.calls, "world")[0].user, /人数先排原作的主要人物/u);
assert.match(byStage(adapted.calls, "residents")[0].user, /优先用原作里的人物：名字、年龄、身份照原作，不要改名/u);
assert.match(byStage(adapted.calls, "opening")[0].user, /玩家的改编要求：从离家那天的清晨开始/u);

const borrowed = fixtureModel();
await generateBlueprint({ idea: ASK, sourceText: ORIGINAL, sourceMode: "reference", sizeHint: 14 }, { callModel: borrowed.callModel, maxRequests: 20 });
const plain = fixtureModel();
await generateBlueprint({ idea: ASK, sourceText: ORIGINAL, sizeHint: 14 }, { callModel: plain.callModel, maxRequests: 20 });
assert.deepEqual(borrowed.calls.map((row) => [row.system, row.user]), plain.calls.map((row) => [row.system, row.user]), "reference is the default and is unchanged");
assert.ok(byStage(borrowed.calls, "world")[0].user.includes("【参考资料（玩家提供，可以取材，不必照抄）】"));
for (const stage of ["relationships", "opening"]) assert.ok(!byStage(borrowed.calls, stage)[0].user.includes(ORIGINAL), `${stage}: reference text stays out, as before`);
assert.ok(!borrowed.calls.some((row) => /改编/u.test(row.system)));

const empty = fixtureModel();
await generateBlueprint({ idea: ASK, sourceText: "   ", sourceMode: "adapt", sizeHint: 14 }, { callModel: empty.callModel, maxRequests: 20 });
assert.ok(!empty.calls.some((row) => row.user.includes("【原作") || /改编/u.test(row.system)), "nothing to adapt means an ordinary draft");

// ── the endpoint ──────────────────────────────────────────────────────────
const KEY = "probe-model-key-0123456789";
const apiCalls = [];
const api = createCreateApi({ env: { GEMINI_API_KEY: KEY }, callModel: async (request) => { apiCalls.push(request); return fixtureModel().callModel(request); } });
const server = http.createServer((req, res) => api.handle(req, res, new URL(req.url, "http://localhost")).then((handled) => { if (!handled) { res.writeHead(404); res.end(); } }));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const post = async (body) => {
  const response = await fetch(`${base}/api/create/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, text };
};
try {
  const request = { idea: ASK, sourceText: ORIGINAL, sizeHint: 14, authorized: true, maxRequests: 20 };
  const bad = await post({ ...request, sourceMode: "rewrite-everything" });
  assert.equal(bad.status, 400);
  assert.equal(JSON.parse(bad.text).code, "SOURCE_MODE_INVALID");
  assert.equal(apiCalls.length, 0, "a bad use is refused before any model call");
  const ok = await post({ ...request, sourceMode: "adapt" });
  assert.equal(ok.status, 200);
  assert.match(ok.text, /event: result/u);
  assert.ok(apiCalls.length > 0 && apiCalls.every((row) => row.user.includes("【原作（玩家导入的剧本或文本，以它为准）】")), "the endpoint passes the use through");
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log("Script import passed: decoding, tidying, honest limits, speakers, adapt vs reference prompts, endpoint check.");
