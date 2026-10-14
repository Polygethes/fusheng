// What wears a person down is kept and told to them in plain words: what they
// tried and could not do, and how many times; how long since they last drank
// or ate; who laid hands on them; and how a body in want frays the temper.
// Whether to blame anyone, snap or swallow it is theirs to decide.
import test from "node:test";
import assert from "node:assert/strict";
import { updateTemper, temperNow, temperLines, moodLine, bodyFraying, emptyTemper, SETBACK_STING, HURT_STING, FADE_PER_HOUR } from "../src/server/simulation/temper.mjs";
import { loadWorldPack } from "../src/worlds/registry.mjs";
import { defineWorldPack } from "../src/worlds/worldPack.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";

const cid = (rid) => `char_cangxinggu_${rid}`;
const hu = cid("shi_xiaohu"), wen = cid("wen_xiansheng"), shou = cid("shi_shoutian");
const H = 3600;
const failed = (id, at, code, primitive = "handle") => ({ evidenceId: id, type: "own_action_result", occurredAtSeconds: at,
  semanticFrame: { actionResult: { status: "failed", primitive, failureCodes: [code], resolvedEffectKinds: [] } } });
const done = (id, at, primitive, kinds = []) => ({ evidenceId: id, type: "own_action_result", occurredAtSeconds: at,
  semanticFrame: { actionResult: { status: "success", primitive, failureCodes: [], resolvedEffectKinds: kinds } } });

test("setbacks pile up and are counted; getting it done clears them; agitation fades by the hour", () => {
  let temper = updateTemper(null, { impacts: [failed("e1", 10, "OBJECT_NOT_PORTABLE")], nowSeconds: 10 });
  temper = updateTemper(temper, { impacts: [failed("e1", 10, "OBJECT_NOT_PORTABLE"), failed("e2", 40, "OBJECT_NOT_PORTABLE")], nowSeconds: 40 });
  temper = updateTemper(temper, { impacts: [failed("e3", 70, "OBJECT_NOT_PORTABLE")], nowSeconds: 70 });
  assert.deepEqual(temper.setbacks, { "handle:OBJECT_NOT_PORTABLE": { text: "那东西太沉，搬不动", count: 3, lastAtSeconds: 70 } }, "the same evidence is counted once");
  assert.ok(Math.abs(temper.agitation - SETBACK_STING * 6) < 0.01, `each repeat stings more (${temper.agitation})`);
  assert.deepEqual(temperLines(temper, { nowSeconds: 70 }), ["有点心烦", "你连着 3 次没做成：那东西太沉，搬不动。"]);
  const cleared = updateTemper(temper, { impacts: [done("e4", 100, "handle")], nowSeconds: 100 });
  assert.deepEqual(cleared.setbacks, {}, "done at last");
  assert.ok(temperNow(cleared, { nowSeconds: 100 + 2 * H }) < 0.05, "two hours on, it has passed");
  assert.equal(FADE_PER_HOUR, 0.2);
  const old = updateTemper(temper, { impacts: [], nowSeconds: 70 + 3 * H });
  assert.deepEqual(old.setbacks, {}, "a setback hours ago is no longer on their mind");
});

test("a thirsty, hungry, sleepy or hurting body frays the temper; drinking and eating are remembered", () => {
  assert.equal(bodyFraying({ thirst: 0.85 }), 0.2);
  assert.equal(bodyFraying({ thirst: 0.65, hunger: 0.65 }, 0.9), 0.3);
  assert.equal(bodyFraying({ thirst: 0.9, hunger: 0.9, pain: 0.9 }, 0.99), 0.5, "never more than half of it");
  assert.deepEqual([moodLine(0.1), moodLine(0.3), moodLine(0.5), moodLine(0.8)], ["", "有点心烦", "心里烦躁，看什么都不顺眼", "心里憋着一股火，快压不住了"]);
  const parched = { thirst: 0.85, hunger: 0.7 };
  assert.deepEqual(temperLines(emptyTemper(), { body: parched, nowSeconds: 3.5 * H }), ["有点心烦", "你已经三个多钟头没喝上一口水了。", "你已经三个多钟头没吃上一口饭了。"]);
  const drank = updateTemper(null, { impacts: [done("d1", 3 * H, "sustain", ["sustenance_drink"])], nowSeconds: 3 * H });
  assert.equal(drank.lastDrankAtSeconds, 3 * H);
  assert.deepEqual(temperLines(drank, { body: { thirst: 0.55 }, nowSeconds: 3.5 * H }), [], "half an hour after a drink: nothing to say");
  assert.deepEqual(temperLines(drank, { body: parched, nowSeconds: 3.5 * H }).slice(1), ["你已经三个多钟头没吃上一口饭了。"]);
});

test("someone laying hands on you stings and is remembered for a while", () => {
  const grabbed = { evidenceId: "c1", type: "confrontation", directed: true, sourceCharacterId: "shou", content: "石守田一把揪住了你的衣领。", occurredAtSeconds: 50 };
  const seen = { evidenceId: "c2", type: "confrontation", directed: false, sourceCharacterId: "shou", content: "石守田一把揪住了何嫂。", occurredAtSeconds: 50 };
  const temper = updateTemper(null, { impacts: [grabbed, seen], nowSeconds: 60, nameOf: (id) => (id === "shou" ? "石守田" : "") });
  assert.deepEqual(temper.hurts, [{ byCharacterId: "shou", byName: "石守田", text: "石守田一把揪住了你的衣领。", atSeconds: 50 }], "only what was done to you");
  assert.equal(temper.agitation, HURT_STING);
  assert.deepEqual(temperLines(temper, { nowSeconds: 60 }), ["有点心烦", "刚才：石守田一把揪住了你的衣领。"]);
  assert.deepEqual(temperLines(temper, { nowSeconds: 60 + 2 * H }), [], "an hour later it is behind them");
});

async function play() {
  const pack = await loadWorldPack("cangxinggu");
  const where = { [hu]: "shi_home__kitchen", [wen]: "shi_home__kitchen", [shou]: "shi_home__kitchen" };
  const moved = defineWorldPack({ ...structuredClone(pack),
    cast: structuredClone(pack.cast).map((row) => (where[row.id] ? { ...row, startZoneId: where[row.id] } : row)),
    stage: { ...structuredClone(pack.stage), scenePositions: { ...structuredClone(pack.stage.scenePositions), ...where } } });
  const prompts = { [hu]: [], [wen]: [], [shou]: [] };
  const plans = { [hu]: [], [wen]: [], [shou]: [] };
  const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(moved), { worldPack: moved, pacingMode: "scene", characterIds: [hu, wen, shou],
    enableDayPlanning: false, characterAgentCallMode: "performance",
    async runStage(input) {
      const prompt = input.prompt?.user || "";
      prompts[input.characterId].push(prompt);
      const code = (prefix, label) => prompt.split("\n").find((line) => new RegExp(`^- ${prefix}\\d+ `, "u").test(line) && line.includes(label))?.match(new RegExp(`${prefix}\\d+`, "u"))?.[0] || "";
      const act = plans[input.characterId].shift() || { type: "wait", minutes: 30 };
      return { performance: { thought: "", say: { to: "", text: "", loud: false }, gesture: "",
        do: { target: "", person: "", minutes: 0, ...act, ...(act.thing ? { target: code("O", act.thing) } : {}), ...(act.to ? { person: code("P", act.to) } : {}) } } };
    } });
  const { runtime } = instance;
  const beat = async (id, acts) => { plans[id] = acts; const before = prompts[id].length; await runtime.applyWorldEvent({ kind: "urge", toCharacterId: id, text: "动起来" });
    for (let i = 0; i < 16 && (plans[id].length || prompts[id].length === before); i += 1) if (!(await runtime.runNext())) break; };
  const actorOf = (id) => [...runtime.actors.values()].find((actor) => actor.characterId === id);
  return { runtime, prompts, beat, actorOf };
}

test("in play: 温先生, parched, keeps failing to lift the jar and is told so; 石小虎 is grabbed and is told who did it", async () => {
  const { runtime, prompts, beat, actorOf } = await play();
  actorOf(wen).privateState.ecologyState.body = { ...actorOf(wen).privateState.ecologyState.body, thirst: 0.85 };
  await beat(wen, [{ type: "take", thing: "水缸" }, { type: "take", thing: "水缸" }, { type: "take", thing: "水缸" }, { type: "wait", minutes: 1 }]);
  const last = prompts[wen].at(-1);
  assert.match(last, /【你此刻的心情】/u);
  assert.match(last, /^- 你连着 3 次没做成：那东西太沉，搬不动。$/mu, "he knows it keeps failing, and why, in plain words");
  assert.match(last, /^- 心里烦躁，看什么都不顺眼$/mu, "a parched man failing three times is short-tempered");
  assert.doesNotMatch(prompts[wen][0], /【你此刻的心情】/u, "before anything went wrong there was nothing to say");
  assert.ok(actorOf(wen).privateState.temper?.setbacks?.["handle:OBJECT_NOT_PORTABLE"]?.count === 3, "his temper is his own, kept with him");

  await beat(shou, [{ type: "grab", to: "石小虎" }]);
  await beat(hu, [{ type: "wait", minutes: 1 }]);
  assert.match(prompts[hu].at(-1), /^- 刚才：石守田[^\n]*你[^\n]*$/mu, "the boy is told who laid hands on him");
  assert.match(prompts[hu].at(-1), /^- (有点心烦|心里烦躁，看什么都不顺眼)$/mu);
  for (const actor of runtime.actors.values()) await actor.close?.();
});
