// Small things that made the words people read odd: a speaker who walked out
// of sight became "有人" in the record of what was said; times read as minutes
// since the opening ("[1003:35]"); a failed act said "目标物品的拿起未完成"
// without saying why (the person is now told, in their prompt; the world's
// record is untouched); and what someone longs for read "你想织布何家织屋".
import test from "node:test";
import assert from "node:assert/strict";
import { desireLine, clockStamp, failureReasons } from "../src/server/pipeline/plainWords.mjs";
import { loadWorldPack } from "../src/worlds/registry.mjs";
import { defineWorldPack } from "../src/worlds/worldPack.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";

const cid = (rid) => `char_cangxinggu_${rid}`;
const hu = cid("shi_xiaohu"), wen = cid("wen_xiansheng"), he = cid("he_sao");

test("what someone longs for, and the time of a line, in plain words", () => {
  assert.equal(desireLine({ verb: "打听", object: "谷口山道", observableOutcome: "盼着有人从谷口那道山缝带回丈夫的消息，知道他是死是活" }),
    "你盼着有人从谷口那道山缝带回丈夫的消息，知道他是死是活。");
  assert.equal(desireLine({ verb: "织布", object: "何家织屋", observableOutcome: "在何家织屋伴着雨声织布防备山外祸事" }), "你想在何家织屋伴着雨声织布防备山外祸事。");
  assert.equal(desireLine({ verb: "补亮", object: "北坡阵眼的阵纹", observableOutcome: "" }), "你想补亮北坡阵眼的阵纹。", "no outcome: the verb and what it is about");
  assert.equal(desireLine({ verb: "守住", object: "谷口", observableOutcome: "想守住谷口，不让外人进来。" }), "你想守住谷口，不让外人进来。", "no doubled 想, no doubled 。");
  assert.equal(clockStamp(0, 19 * 60), "19:00");
  assert.equal(clockStamp(1003 * 60 + 35, 19 * 60), "11:43", "a line said the next morning");
  assert.equal(clockStamp(95, null), "01:35", "no town clock: minutes and seconds since the opening, as before");
  assert.deepEqual(failureReasons({ type: "own_action_result", semanticFrame: { actionResult: { failureCodes: ["OBJECT_NOT_PORTABLE", "SPEECH_TARGET_NOT_REACHED"] } } }),
    ["那东西太沉，搬不动", "话没传到对方耳朵里"]);
  assert.deepEqual(failureReasons({ type: "own_action_result", semanticFrame: { actionResult: { failureCodes: ["MOVE_HELD"] } } }), [], "already said in the result itself");
  assert.deepEqual(failureReasons({ type: "speech", semanticFrame: {} }), []);
});

async function play() {
  const pack = await loadWorldPack("cangxinggu");
  const where = { [hu]: "shi_home__kitchen", [wen]: "shi_home__kitchen", [he]: "shi_home__kitchen" };
  const moved = defineWorldPack({ ...structuredClone(pack),
    cast: structuredClone(pack.cast).map((row) => (where[row.id] ? { ...row, startZoneId: where[row.id] } : row)),
    stage: { ...structuredClone(pack.stage), scenePositions: { ...structuredClone(pack.stage.scenePositions), ...where } } });
  const prompts = { [hu]: [], [wen]: [], [he]: [] };
  const plans = { [hu]: [], [wen]: [], [he]: [] };
  const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(moved), { worldPack: moved, pacingMode: "scene", characterIds: [hu, wen, he],
    enableDayPlanning: false, characterAgentCallMode: "performance",
    async runStage(input) {
      const prompt = input.prompt?.user || "";
      prompts[input.characterId].push(prompt);
      const code = (prefix, label) => prompt.split("\n").find((line) => new RegExp(`^- ${prefix}\\d+ `, "u").test(line) && line.includes(label))?.match(new RegExp(`${prefix}\\d+`, "u"))?.[0] || "";
      const act = plans[input.characterId].shift() || { type: "wait", minutes: 30 };
      return { performance: { thought: "", say: { to: act.sayTo ? code("P", act.sayTo) : "", text: act.say || "", loud: false }, gesture: "",
        do: { target: "", person: "", minutes: 0, type: act.type, ...(act.minutes ? { minutes: act.minutes } : {}),
          ...(act.target ? { target: act.target } : {}), ...(act.thing ? { target: code("O", act.thing) } : {}) } } };
    } });
  const { runtime } = instance;
  const beat = async (id, acts) => { plans[id] = acts; const before = prompts[id].length; await runtime.applyWorldEvent({ kind: "urge", toCharacterId: id, text: "动起来" });
    for (let i = 0; i < 16 && (plans[id].length || prompts[id].length === before); i += 1) if (!(await runtime.runNext())) break; };
  return { runtime, prompts, beat };
}

test("in play: the boy speaks to 何嫂 and leaves; she still knows who said it, and when, by the clock", async () => {
  const { runtime, prompts, beat } = await play();
  await beat(hu, [{ type: "none", say: "何嫂，我走啦！", sayTo: "何嫂" }, { type: "move", target: "shi_home__hall" }, { type: "move", target: "street_1" }]);
  await beat(he, [{ type: "wait", minutes: 1 }]);
  const last = prompts[he].at(-1);
  assert.doesNotMatch(last, /- P\d+ 石小虎：[^\n]*（就在你身边）/u, "he is no longer beside her");
  assert.match(last, /^\[19:\d\d\] 石小虎 对你说：「何嫂，我走啦！」$/mu, "a known voice keeps its name, and the line its hour");
  assert.doesNotMatch(last, /有人 对你说：「何嫂，我走啦！」/u);
  assert.match(prompts[he][0], /^- 你盼着有人从谷口那道山缝带回丈夫的消息，知道他是死是活。$/mu, "what she longs for reads as a sentence");
  assert.match(prompts[he][0], /^- 你想在何家织屋伴着雨声织布防备山外祸事。$/mu);
  assert.doesNotMatch(prompts[he][0], /你想织布何家织屋/u);
  for (const actor of runtime.actors.values()) await actor.close?.();
});

test("in play: a failed act says why, in plain words", async () => {
  const { runtime, prompts, beat } = await play();
  await beat(wen, [{ type: "take", thing: "水缸" }, { type: "wait", minutes: 1 }]);
  assert.match(prompts[wen].at(-1), /^- 你刚注意到：刚才的动作[^\n]*（那东西太沉，搬不动）$/mu, "the jar is too heavy, and he is told so");
  const failed = runtime.coordinator.journal.events.filter((row) => row.publicPayload?.primitive === "handle").at(-1).publicPayload;
  assert.doesNotMatch(failed.deliveries.find((row) => row.eventKind === "own_action_result").content, /搬不动/u, "the world's own record is left as it was");
  for (const actor of runtime.actors.values()) await actor.close?.();
});
