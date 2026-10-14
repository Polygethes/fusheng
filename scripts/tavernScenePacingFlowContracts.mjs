import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
const seed = buildPlayableWorldFromSetup({ setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。", setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。" });
function create(checkpoint = null, trace = []) {
  const fixture = createTavernV27FixtureStageRunner({ planForTurn: input => {
    const time = input.worldProjection.temporalContext;
    assert.ok(time?.deadlines?.length, "the model must receive its actual temporal context, not only the observer report");
    return { intention: "等到自己指定的时刻再看", primitive: "wait", utterance: "", visibleAction: "", texture: [],
      waitCondition: { condition: "deadline", maximumSeconds: 3600, interruptOnDirectSpeech: true },
      privateBasis: "本测试固定选择长等待，以验证客观期限仍可中断。" };
  } });
  return createTavernWorldRuntimeV27(seed, { pacingMode: "scene", checkpoint, enableDayPlanning: true,
    runStage(input, options) {
      if (input.phase === "awaiting_subjective_appraisal_and_candidates") trace.push({ actor: input.characterId, at: input.worldProjection.scene.elapsedSeconds,
        deadline: input.worldProjection.temporalContext.deadlines[0], wait: input.worldProjection.ownTimeExperience });
      return fixture(input, options);
    } });
}
const trace = [], full = create(null, trace);
const result = await full.runtime.runUntilWorldTime({ targetSeconds: 900, maxTurns: 40 });
assert.equal(result.reachedTarget, true);
assert.ok(result.turns.length < 30, "15 minutes should not require 100 idle Character decisions");
assert.deepEqual([...new Set(trace.map(row => row.at))], [0, 600], "the five waiting characters receive no polling calls during the ten quiet minutes");
assert.equal(trace.filter(row => row.at === 600).length, 5, "the real warning interrupts every affected waiting character once");
assert.ok(trace.filter(row => row.at === 600).every(row => row.deadline.remainingSeconds === 300));
const expected = await full.runtime.checkpoint();
const split = create();
assert.equal((await split.runtime.runUntilWorldTime({ targetSeconds: 600, maxTurns: 40 })).reachedTarget, true);
const restored = create(await split.runtime.checkpoint());
assert.equal((await restored.runtime.runUntilWorldTime({ targetSeconds: 900, maxTurns: 40 })).reachedTarget, true);
const actual = await restored.runtime.checkpoint();
function semantic(value) {
  if (Array.isArray(value)) return value.map(semantic);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !["committedAt", "integrity"].includes(key)).map(([key, row]) => [key, semantic(row)]));
}
// Each independently valid journal has its own wall-clock timestamp and hash;
// all simulation state, causal events, private states and queues must agree.
assert.deepEqual(semantic(actual), semantic(expected), "midpoint restore preserves the complete semantic checkpoint");
for (const instance of [full, split, restored]) for (const actor of instance.runtime.actors.values()) await actor.close();
console.log(JSON.stringify({ status: "pass", simulatedSeconds: result.nowSeconds, characterTurns: result.turns.length,
  waitDecisionTimes: trace.map(row => row.at), checkpointReplay: "exact", realModelCalls: 0 }));
