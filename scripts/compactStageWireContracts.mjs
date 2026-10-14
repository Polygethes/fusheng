// The deep (three-call) mode spends most of its time writing JSON. The compact
// wire lets the model write short keys and skip what it cannot choose (fixed
// values, empty lists); the server restores the exact canonical object before
// any validation, so the protocol and the psychology are unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCompactStageWire, compactWireLegendText, missingRequiredPaths } from "../src/server/pipeline/compactStageWire.mjs";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/deep-stage-wire");
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), "utf8"));

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ownerAuthority", "noticedEvidenceIds", "interpretations", "actionBinding", "mode", "minOneList", "eventId"],
  properties: {
    ownerAuthority: { type: "string", enum: ["character-agent"] },
    noticedEvidenceIds: { type: "array", items: { type: "string" } },
    interpretations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["evidenceIds", "meaning", "acknowledged"],
        properties: {
          evidenceIds: { type: "array", items: { type: "string" } },
          meaning: { type: "string" },
          acknowledged: { type: "boolean", const: true },
        },
      },
    },
    actionBinding: {
      anyOf: [
        { type: "object", additionalProperties: false, required: ["kind", "targetCharacterId"],
          properties: { kind: { type: "string", enum: ["none"] }, targetCharacterId: { type: "string", enum: [""] } } },
        { type: "object", additionalProperties: false, required: ["kind", "targetCharacterId"],
          properties: { kind: { type: "string", enum: ["character"] }, targetCharacterId: { type: "string", enum: ["char_a", "char_b"] } } },
      ],
    },
    mode: { type: "string", enum: ["calm", "tense"] },
    minOneList: { type: "array", minItems: 1, items: { type: "string" } },
    eventId: { type: "string" },
    privateNote: { type: "string" },
  },
};

const aliasOf = (wire, key) => wire.legend.find((row) => row.key === key)?.short ?? key;

test("aliases: short keys stay, long keys become their initials, one-word keys their first three letters, all unique", () => {
  const before = JSON.stringify(SCHEMA);
  const wire = createCompactStageWire(SCHEMA);
  assert.equal(JSON.stringify(SCHEMA), before, "the canonical schema is never modified");
  assert.equal(aliasOf(wire, "mode"), "mode", "keys of five letters or fewer keep their name");
  assert.equal(aliasOf(wire, "kind"), "kind");
  assert.equal(aliasOf(wire, "noticedEvidenceIds"), "nei");
  assert.equal(aliasOf(wire, "targetCharacterId"), "tci");
  assert.equal(aliasOf(wire, "interpretations"), "int");
  assert.equal(aliasOf(wire, "meaning"), "mea");
  assert.deepEqual(new Set([aliasOf(wire, "eventId"), aliasOf(wire, "evidenceIds")]), new Set(["ei", "ei2"]), "a clash gets a number");
  const shorts = wire.legend.map((row) => row.short);
  assert.equal(new Set(shorts).size, shorts.length, "every alias is unique");
  const canonical = new Set(["ownerAuthority", "noticedEvidenceIds", "interpretations", "evidenceIds", "meaning", "acknowledged", "actionBinding", "kind", "targetCharacterId", "mode", "minOneList", "eventId", "privateNote"]);
  assert.ok(shorts.every((short) => !canonical.has(short)), "no alias is also a real key");
  assert.ok(wire.legend.every((row) => row.key !== row.short), "the legend lists only renamed keys");
  assert.deepEqual(createCompactStageWire(SCHEMA).legend, wire.legend, "the same schema always gets the same aliases");
});

test("wire schema: fixed values leave, lists that may be empty become optional, unions keep their shape", () => {
  const { schema } = createCompactStageWire(SCHEMA);
  const top = schema.properties;
  assert.equal(top.oa, undefined, "a required field with one possible value is not asked for");
  assert.ok(top.nei && !schema.required.includes("nei"), "a list that may be empty may be left out");
  assert.ok(schema.required.includes("mode"));
  assert.ok(schema.required.includes("mol") || schema.required.includes(Object.keys(top).find((key) => top[key].minItems === 1)), "a list that must have items stays required");
  assert.ok(schema.required.includes("ei") || schema.required.includes("ei2"), "a required free string stays required");
  assert.ok(top.pn && !schema.required.includes("pn"), "an optional field stays optional");
  const item = top.int.items;
  assert.equal(item.properties.ack, undefined, "a constant inside list items leaves too");
  assert.ok(item.required.includes("mea"));
  const branches = top.ab.anyOf;
  assert.equal(branches.length, 2);
  for (const branch of branches) {
    assert.deepEqual(Object.keys(branch.properties).sort(), ["kind", "tci"], "inside a union only the keys are renamed");
    assert.deepEqual(branch.required.sort(), ["kind", "tci"], "inside a union fixed values still tell the branches apart");
  }
  assert.equal(schema.additionalProperties, false, "other schema words are kept");
});

test("expand restores the canonical object", () => {
  const wire = createCompactStageWire(SCHEMA);
  const ei = aliasOf(wire, "eventId");
  const output = wire.expand({ int: [{ mea: "看见了" }], ab: { kind: "character", tci: "char_a" }, mode: "calm", [aliasOf(wire, "minOneList")]: ["x"], [ei]: "evt-1" });
  assert.deepEqual(output, {
    ownerAuthority: "character-agent",
    noticedEvidenceIds: [],
    interpretations: [{ meaning: "看见了", evidenceIds: [], acknowledged: true }],
    actionBinding: { kind: "character", targetCharacterId: "char_a" },
    mode: "calm",
    minOneList: ["x"],
    eventId: "evt-1",
  });
});

test("expand never invents what the model did not choose", () => {
  const wire = createCompactStageWire(SCHEMA);
  const output = wire.expand({ ab: { tci: "char_a" }, mode: "calm" });
  assert.deepEqual(output.actionBinding, { targetCharacterId: "char_a" }, "a union branch is not guessed; the validator reports the missing kind");
  assert.equal("minOneList" in output, false, "a list that must have items is not filled with nothing");
  assert.equal("eventId" in output, false, "a missing free string stays missing");
  assert.equal("privateNote" in output, false, "an optional field is not added");
});

test("expand keeps what the model wrote, even canonical names and wrong fixed values", () => {
  const wire = createCompactStageWire(SCHEMA);
  const output = wire.expand({ oa: "someone-else", noticedEvidenceIds: ["e1"], mode: "tense" });
  assert.equal(output.ownerAuthority, "someone-else", "the validator, not the wire, rejects a wrong fixed value");
  assert.deepEqual(output.noticedEvidenceIds, ["e1"], "a canonical key passes through unchanged");
});

test("compact is the reverse: it drops fixed values that match and empty lists, and renames the rest", () => {
  const wire = createCompactStageWire(SCHEMA);
  const canonical = {
    ownerAuthority: "character-agent", noticedEvidenceIds: [], interpretations: [{ meaning: "m", evidenceIds: ["e1"], acknowledged: true }],
    actionBinding: { kind: "none", targetCharacterId: "" }, mode: "calm", minOneList: ["x"], eventId: "evt-1",
  };
  const before = JSON.stringify(canonical);
  const compacted = wire.compact(canonical);
  assert.equal(JSON.stringify(canonical), before, "compact does not modify its input");
  assert.deepEqual(compacted, { int: [{ mea: "m", [aliasOf(wire, "evidenceIds")]: ["e1"] }], ab: { kind: "none", tci: "" }, mode: "calm",
    [aliasOf(wire, "minOneList")]: ["x"], [aliasOf(wire, "eventId")]: "evt-1" });
  assert.equal(wire.compact({ ...canonical, ownerAuthority: "someone-else" }).oa, "someone-else", "a wrong fixed value is kept so a repair can see it");
  assert.deepEqual(wire.expand(compacted), canonical);
});

test("the legend tells the model every alias", () => {
  const wire = createCompactStageWire(SCHEMA);
  const text = compactWireLegendText(wire.legend);
  for (const { short, key } of wire.legend) assert.ok(text.includes(`${short} = ${key}`), `${short} = ${key}`);
  assert.match(text, /短键/u);
  assert.equal(compactWireLegendText([]), "", "no legend when nothing was renamed");
});

test("missingRequiredPaths finds required fields that are absent, outside unions", () => {
  assert.deepEqual(missingRequiredPaths(SCHEMA, { ownerAuthority: "character-agent", noticedEvidenceIds: [], interpretations: [{ meaning: "m", evidenceIds: [], acknowledged: true }],
    actionBinding: { kind: "none", targetCharacterId: "" }, mode: "calm", minOneList: ["x"], eventId: "e" }), []);
  assert.deepEqual(missingRequiredPaths(SCHEMA, { ownerAuthority: "character-agent", noticedEvidenceIds: [], interpretations: [{ evidenceIds: [], acknowledged: true }],
    actionBinding: { kind: "none" }, mode: "calm", minOneList: ["x"] }), ["$.interpretations[0].meaning", "$.eventId"]);
});

const SHRINK = { "appraisal-a": 0.3, "appraisal-b": 0.3, choice: 0.25, "commit-none": 0.5, reflection: 0.15 };

for (const [name, atLeast] of Object.entries(SHRINK)) {
  test(`real ${name} output: exact round trip and at least ${Math.round(atLeast * 100)}% shorter`, () => {
    const { schema, output } = fixture(name);
    const before = JSON.stringify(output);
    const wire = createCompactStageWire(schema);
    assert.deepEqual(missingRequiredPaths(schema, output), [], "the recorded output is complete");
    const compacted = wire.compact(output);
    assert.equal(JSON.stringify(output), before);
    assert.deepEqual(wire.expand(compacted), output, "expand(compact(x)) is exactly x");
    assert.deepEqual(missingRequiredPaths(wire.schema, compacted), [], "the compact form satisfies the wire schema's required fields");
    const saved = 1 - JSON.stringify(compacted).length / before.length;
    assert.ok(saved >= atLeast, `${name} shrinks by ${(saved * 100).toFixed(1)}%`);
    const keys = new Set();
    (function collect(node) { if (!node || typeof node !== "object") return; if (node.properties) for (const key of Object.keys(node.properties)) keys.add(key); for (const value of Object.values(node)) collect(value); })(wire.schema);
    (function check(value) {
      if (Array.isArray(value)) { value.forEach(check); return; }
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) { assert.ok(keys.has(key), `${key} is a wire key`); check(child); }
    })(compacted);
  });
}

test("real appraisal: well-known keys get their expected aliases", () => {
  const wire = createCompactStageWire(fixture("appraisal-a").schema);
  assert.equal(aliasOf(wire, "appraisal"), "app");
  assert.equal(aliasOf(wire, "candidates"), "can");
  assert.equal(aliasOf(wire, "noticedEvidenceIds"), "nei");
  assert.equal(aliasOf(wire, "desireGroundings"), "dg");
  assert.equal(aliasOf(wire, "kind"), "kind");
});

// ── the wire inside a real character stage call ─────────────────────────
const { callGeminiCharacterStage } = await import("../src/server/ecology/geminiCharacterStage.mjs");
const { tavernCharacterAgentV2OutputSchemaForStage } = await import("../src/server/pipeline/tavernCharacterAgentV2.mjs");
const GATEWAY = { apiKey: "fake-secret-key-wire-13579", model: "gemini-3.8-flash", apiBaseUrl: "https://gateway.invalid/v1", sleep: async () => {} };
const reply = (output) => new Response(JSON.stringify({ id: "r1", model: "gemini-3.8-flash",
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 5, completion_tokens: 3 } }),
{ status: 200, headers: { "content-type": "application/json" } });

test("a deep stage on the compact wire sends short keys and a legend, and returns the canonical object", async () => {
  const input = fixture("commit-input");
  const { output } = fixture("commit-none");
  const wire = createCompactStageWire(tavernCharacterAgentV2OutputSchemaForStage(input));
  let body = null;
  const result = await callGeminiCharacterStage(input, { ...GATEWAY, wire: "compact",
    fetchImpl: async (url, options) => { body = JSON.parse(options.body); return reply(wire.compact(output)); } });
  assert.deepEqual(result.turnCommit, output, "the runtime receives exactly the canonical commit");
  assert.equal(result.stage.wire, "compact");
  const sent = JSON.stringify(body.response_format.json_schema.schema);
  assert.ok(sent.includes('"pet"') && !sent.includes('"privateExpressionTrace"'), "the schema the model sees uses the short keys");
  assert.ok(!sent.includes('"ownerAuthority"') && !sent.includes('"oa"'), "a fixed value is not asked for");
  assert.match(body.messages[1].content, /pet = privateExpressionTrace/u, "the legend is in the prompt");
});

test("without the compact wire nothing changes", async () => {
  const input = fixture("commit-input");
  const { output } = fixture("commit-none");
  let body = null;
  const result = await callGeminiCharacterStage(input, { ...GATEWAY,
    fetchImpl: async (url, options) => { body = JSON.parse(options.body); return reply(output); } });
  assert.deepEqual(result.turnCommit, output);
  assert.equal(result.stage.wire, undefined);
  assert.ok(JSON.stringify(body.response_format.json_schema.schema).includes('"privateExpressionTrace"'));
  assert.doesNotMatch(body.messages[1].content, /短键/u);
});

test("a repair on the compact wire shows the model its previous answer in short keys", async () => {
  const input = { ...fixture("commit-input"), protocolRepairFeedback: { issues: [{ code: "CHARACTER_STAGE_OUTPUT_INVALID", path: "$.publicExpression", message: "fix" }] } };
  const { output } = fixture("commit-none");
  const wire = createCompactStageWire(tavernCharacterAgentV2OutputSchemaForStage(input));
  let body = null;
  await callGeminiCharacterStage(input, { ...GATEWAY, wire: "compact", previousOutput: output,
    fetchImpl: async (url, options) => { body = JSON.parse(options.body); return reply(wire.compact(output)); } });
  assert.ok(body.messages[1].content.endsWith(JSON.stringify(wire.compact(output))), "the previous answer is quoted in its compact form");
});

test("a prompt stage ignores the wire setting", async () => {
  const stageInput = { phase: "awaiting_performance_beat", outputKey: "performance", prompt: { system: "s", user: "u json" },
    schema: { type: "object", required: ["sayText"], properties: { sayText: { type: "string" } } } };
  let body = null;
  const result = await callGeminiCharacterStage(stageInput, { ...GATEWAY, wire: "compact",
    fetchImpl: async (url, options) => { body = JSON.parse(options.body); return reply({ sayText: "好" }); } });
  assert.deepEqual(result.performance, { sayText: "好" });
  assert.ok(JSON.stringify(body.response_format.json_schema.schema).includes('"sayText"'));
});

// ── the benchmark that will measure the real gain (Claude runs it, with the user's approval) ──
const { spawnSync } = await import("node:child_process");
const os = await import("node:os");
const BENCH = path.join(path.dirname(fileURLToPath(import.meta.url)), "benchmarkCompactWire.mjs");
function fakeRun() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wire-bench-"));
  fs.mkdirSync(path.join(dir, "calls"));
  const input = fixture("commit-input");
  fs.writeFileSync(path.join(dir, "calls", "001.input.json"), JSON.stringify(input));
  fs.writeFileSync(path.join(dir, "calls", "002.input.json"), JSON.stringify(input));
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify({ calls: [
    { index: 1, phase: input.phase, accepted: true }, { index: 2, phase: input.phase, accepted: false },
  ] }));
  return dir;
}
const bench = (args) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|TOKEN|SECRET|BASE_URL/u.test(key)));
  return spawnSync(process.execPath, [BENCH, ...args], { encoding: "utf8", env, timeout: 30_000 });
};

test("the benchmark without --run only plans: no request, no key needed", () => {
  const dir = fakeRun();
  const result = bench(["--from", dir, "--phase", "awaiting_agent_turn_commit", "--samples", "3", "--rounds", "2"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /planned requests: 4/u, "one accepted sample × 2 rounds × 2 wires");
  assert.match(result.stdout, /001/u);
  assert.doesNotMatch(result.stdout, /002/u, "a rejected call is not a sample");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the benchmark refuses to run past its request cap or without a key", () => {
  const dir = fakeRun();
  const capped = bench(["--from", dir, "--phase", "awaiting_agent_turn_commit", "--rounds", "3", "--max-requests", "4", "--run"]);
  assert.notEqual(capped.status, 0);
  assert.match(capped.stderr + capped.stdout, /max-requests/u);
  const keyless = bench(["--from", dir, "--phase", "awaiting_agent_turn_commit", "--run"]);
  assert.notEqual(keyless.status, 0);
  assert.match(keyless.stderr + keyless.stdout, /GEMINI_API_KEY/u);
  fs.rmSync(dir, { recursive: true, force: true });
});
