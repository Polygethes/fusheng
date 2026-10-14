import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import { tavernCharacterAgentV2UserPrompt } from "../src/server/pipeline/tavernCharacterAgentV2.mjs";

const inputs = [];
const fixture = createTavernV27FixtureStageRunner();
const seed = buildPlayableWorldFromSetup({ setupWorldPrompt: "逍遥游，望梯酒馆", setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚" });
const instance = createTavernWorldRuntimeV27(seed, {
  characterIds: ["char_xyy_xiezenshi", "char_xyy_luozhao"],
  characterAgentCallMode: "standard", worldId: "world:test:prompt-packing",
  async runStage(input, options) { inputs.push(structuredClone(input)); return fixture(input, options); },
});
try {
  await instance.runtime.enqueueWake("char_xyy_xiezenshi", { wakeId: "wake:prompt-packing", kind: "opportunity_window", evidence: [], evidenceIds: [] });
  await instance.runtime.runNext();
} finally { for (const actor of instance.runtime.actors.values()) await actor.close(); }
assert.equal(inputs.length, 4);
const expanded = tavernCharacterAgentV2UserPrompt(inputs[0], { format: "expanded" });
const compact = tavernCharacterAgentV2UserPrompt(inputs[0], { format: "compact" });
assert.ok(Buffer.byteLength(compact) < Buffer.byteLength(expanded) * 0.8,
  `model prompt formatting must not repeat the observed whitespace overhead (${Buffer.byteLength(compact)} / ${Buffer.byteLength(expanded)} bytes)`);

const { packCharacterContext, unpackCharacterContext } = await import("../src/server/pipeline/characterModelPromptPacking.mjs");
const normalize = value => JSON.parse(JSON.stringify(value));
for (const input of inputs) {
  const before = structuredClone(input);
  const packed = packCharacterContext(input);
  assert.deepEqual(unpackCharacterContext(packed), normalize(input), "every character fact, source id and array position must round-trip");
  assert.deepEqual(input, before, "packing cannot mutate the input used by schemas and validators");
  assert.deepEqual(packCharacterContext(input), packed, "dictionary labels and order must be deterministic");
  const prompt = tavernCharacterAgentV2UserPrompt(input, { format: "shared" });
  if (Object.keys(packed.shared).length) {
    assert.ok(prompt.includes(JSON.stringify(packed)), "the production prompt must contain the complete reversible payload");
    assert.ok(prompt.includes("不是人物、证据、候选或心理来源 ID"));
  } else assert.ok(prompt.includes(JSON.stringify(normalize(input))));
}
const common = { facts: ["本人看见的内容；空格  与换行\n均保留".repeat(30)], sourceIds: ["source:owned:alpha"] };
const repeated = { a: common, b: structuredClone(common), c: [common, null, false, 0, ""] };
const packed = packCharacterContext(repeated);
assert.ok(Object.keys(packed.shared).length > 0);
assert.ok(Buffer.byteLength(JSON.stringify(packed)) < Buffer.byteLength(JSON.stringify(repeated)) * 0.6);
assert.deepEqual(unpackCharacterContext(packed), repeated);
const changed = unpackCharacterContext(packed);
changed.a.facts.push("one occurrence only");
assert.equal(changed.b.facts.length, 1, "unpacking must restore independent JSON values, not mutable shared aliases");
const literalRef = { a: { $contextRef: "s1" }, b: common, c: common };
const collision = packCharacterContext(literalRef);
assert.deepEqual(collision.shared, {}, "literal reference-shaped data must disable sharing instead of changing meaning");
assert.deepEqual(unpackCharacterContext(collision), literalRef);
assert.throws(() => unpackCharacterContext({ shared: {}, stageInput: { $contextRef: "missing" }, encoding: "shared-json-v1" }), /reference/i);
assert.throws(() => unpackCharacterContext({ shared: { s1: { $contextRef: "s1" } }, stageInput: { $contextRef: "s1" }, encoding: "shared-json-v1" }), /cyclic/i);
assert.throws(() => tavernCharacterAgentV2UserPrompt(inputs[0], { format: "unknown" }), { code: "CHARACTER_PROMPT_FORMAT_UNSUPPORTED" });
console.log("character model prompt packing: production stages, lossless values, ownership and literal-reference isolation passed");
