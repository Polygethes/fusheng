// Day and night, and sleep. Each person is told the hour and whether it is
// light; staying up makes them sleepy, faster at night; lying down they sleep
// until rested by day, or until morning once rested enough, or until someone
// speaks to them. Others can see who is asleep.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { timeOfDayText, hourWords, shichenWords, lightAt, openingSleep, sleepinessAt, sleepinessLine, sleepPlace, wakeAtSeconds,
  fallAsleep, rousedBy, nextWakeBoundary, dueWaking, wakingOutcome, isAsleep } from "../src/server/simulation/sleep.mjs";
import { loadWorldPack } from "../src/worlds/registry.mjs";
import { defineWorldPack } from "../src/worlds/worldPack.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { buildObserverFeed } from "../src/server/observer/observerFeed.mjs";
import { reconcileSettledTurnRecords } from "../src/server/simulation/settledSimulationReport.mjs";

const cid = (rid) => `char_cangxinggu_${rid}`;
const hu = cid("shi_xiaohu"), wen = cid("wen_xiansheng");
const H = 3600;

test("the hour and the light, in a town's own words", () => {
  const town = (startClock, clockLabel = "戌时初", nowSeconds = 0) => ({ nowSeconds, worldPackMeta: { startClock, clockLabel } });
  assert.equal(timeOfDayText(town("19:00")), "现在是戌时初（晚上七点），天黑着。");
  assert.equal(timeOfDayText(town("19:00", "戌时初", 5.5 * H)), "现在是子时正（半夜十二点半），天黑着。");
  assert.equal(timeOfDayText(town("19:00", "戌时初", 11 * H)), "现在是卯时正（早上六点），天蒙蒙亮。");
  assert.equal(timeOfDayText(town("08:00", "早上八点", 7 * H)), "现在是下午三点，天亮着。", "a town that keeps hours, not 时辰");
  assert.equal(timeOfDayText({ nowSeconds: 0, worldPackMeta: {} }), "", "a world with no clock says nothing");
  assert.deepEqual([shichenWords(23 * 60), shichenWords(0), shichenWords(13 * 60 + 30)], ["子时初", "子时正", "未时初"]);
  assert.deepEqual([hourWords(3 * 60), hourWords(12 * 60), hourWords(23 * 60 + 40)], ["凌晨三点", "中午十二点", "半夜十一点半"]);
  assert.deepEqual([lightAt(5 * 60 + 30), lightAt(18 * 60)], ["天蒙蒙亮", "天快黑了"]);
});

test("staying up makes one sleepy, faster at night; sleep eases it; a sleeper wakes rested, at morning, or when spoken to", () => {
  const places = { valley: { sites: [{ id: "shi_home", kind: "building" }, { id: "square", kind: "outdoor" }],
    topology: { zones: { shi_home__bedroom_1: { label: "石家老屋·卧房" }, shi_home__hall: { label: "石家老屋·堂屋" }, square__center: { label: "晒谷场" } } } } };
  const base = { worldPackMeta: { startClock: "19:00", clockLabel: "戌时初" }, places };
  assert.deepEqual(openingSleep(base), { sleepiness: 0.52, atSeconds: 0, asleep: false }, "up since six in the morning");
  const boy = { id: "hu", kind: "character", name: "石小虎", placeId: "valley", zoneId: "shi_home__bedroom_1", present: true, sleep: openingSleep(base) };
  const at = (seconds, entity = boy) => sleepinessAt({ ...base, nowSeconds: seconds }, entity, seconds);
  assert.equal(at(3 * H), 0.64, "three evening hours: up 0.04 an hour");
  assert.equal(at(7 * H), 0.92, "four hours past ten at night: up 0.07 an hour");
  assert.deepEqual([sleepinessLine(0.5), sleepinessLine(0.64), sleepinessLine(0.85), sleepinessLine(0.97)], ["", "有些困了", "困得直打哈欠", "困得眼皮直打架，随时会睡着"]);
  assert.deepEqual([sleepPlace(base, boy), sleepPlace(base, { ...boy, zoneId: "shi_home__hall" }), sleepPlace(base, { ...boy, zoneId: "square__center" })],
    ["bed", "indoors", "outdoors"]);

  // He goes to bed at ten: asleep through the night, up at six.
  const night = { ...base, nowSeconds: 3 * H };
  const asleep = { ...boy, sleep: fallAsleep(night, boy, 3 * H) };
  assert.deepEqual(asleep.sleep, { sleepiness: 0.64, atSeconds: 3 * H, asleep: true, sinceSeconds: 3 * H, where: "bed" });
  assert.equal(isAsleep(asleep), true);
  assert.equal(wakeAtSeconds(night, asleep), 11 * H, "rested by morning, he wakes at six");
  assert.equal(sleepinessAt({ ...base, nowSeconds: 11 * H }, asleep, 11 * H), 0, "and is no longer sleepy");
  const state = { ...night, entities: { hu: asleep } };
  assert.equal(nextWakeBoundary(state), 11 * H);
  assert.equal(dueWaking(state), null);
  assert.deepEqual(dueWaking({ ...state, nowSeconds: 11 * H }), { personId: "hu" });
  const woke = wakingOutcome({ state: { ...state, nowSeconds: 11 * H }, personId: "hu", eventId: "e1" });
  assert.deepEqual(woke.operations, [{ op: "set", path: ["entities", "hu", "sleep"], value: { sleepiness: 0, atSeconds: 11 * H, asleep: false } }]);
  assert.equal(woke.deliveries[0].content, "你醒了，睡了8个钟头。现在是卯时正（早上六点），天蒙蒙亮。");
  assert.equal(woke.caption, "石小虎醒了。");

  // Up all night, he lies down at four on the hall floor: not rested by six, he sleeps on into the morning.
  const late = { ...base, nowSeconds: 9 * H };
  const floor = { ...boy, zoneId: "shi_home__hall" };
  const dawn = { ...floor, sleep: fallAsleep(late, floor, 9 * H) };
  assert.equal(dawn.sleep.where, "indoors");
  const wakes = wakeAtSeconds(late, dawn);
  assert.ok(wakes > 13 * H && wakes < 21 * H, `slept on past eight (${(wakes / H).toFixed(2)}h)`);

  // A short nap by day ends when rested.
  const noon = { worldPackMeta: { startClock: "12:00", clockLabel: "午时正" }, places, nowSeconds: 0 };
  const napper = { ...boy, sleep: { sleepiness: 0.3, atSeconds: 0, asleep: true, sinceSeconds: 0, where: "bed" } };
  assert.ok(Math.abs(wakeAtSeconds(noon, napper) - 2.1 * H) <= 600, `a two-hour nap (${(wakeAtSeconds(noon, napper) / H).toFixed(2)}h)`);

  // Spoken to directly, a sleeper wakes; talk around him does not.
  const said = (directed) => ({ recipientCharacterId: "hu", sourceCharacterId: "wen", directed, urgent: false });
  assert.deepEqual(rousedBy(state, [said(false)], 4 * H), { operations: [], resolvedEffects: [] });
  const roused = rousedBy(state, [said(true)], 4 * H);
  assert.equal(roused.operations[0].value.asleep, false);
  assert.deepEqual(roused.resolvedEffects, [{ kind: "woke", actorId: "hu", cause: "roused", byCharacterId: "wen" }]);
  assert.equal(rousedBy(state, [{ ...said(false), urgent: true }], 4 * H).resolvedEffects.length, 1, "something urgent wakes him too");
});

async function playNight() {
  const pack = await loadWorldPack("cangxinggu");
  const where = { [hu]: "shi_home__hall", [wen]: "shi_home__hall" };
  // The night opens at one in the morning: up since six, everyone is already sleepy (the coordinator's worldState is a read-only copy).
  const moved = defineWorldPack({ ...structuredClone(pack), clock: { ...structuredClone(pack.clock), startClock: "01:00" },
    cast: structuredClone(pack.cast).map((row) => (where[row.id] ? { ...row, startZoneId: where[row.id] } : row)),
    stage: { ...structuredClone(pack.stage), scenePositions: { ...structuredClone(pack.stage.scenePositions), ...where } } });
  const prompts = { [hu]: [], [wen]: [] };
  const plans = { [hu]: [], [wen]: [] };
  const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(moved), { worldPack: moved, pacingMode: "scene", characterIds: [hu, wen],
    enableDayPlanning: false, characterAgentCallMode: "performance",
    async runStage(input) {
      const prompt = input.prompt?.user || "";
      prompts[input.characterId].push(prompt);
      const code = (prefix, label) => prompt.split("\n").find((line) => new RegExp(`^- ${prefix}\\d+ `, "u").test(line) && line.includes(label))?.match(new RegExp(`${prefix}\\d+`, "u"))?.[0] || "";
      const act = plans[input.characterId].shift() || { type: "wait", minutes: 30 };
      return { performance: { thought: "", say: { to: act.sayTo ? code("P", act.sayTo) : "", text: act.say || "", loud: false }, gesture: "",
        do: { target: "", person: "", minutes: 0, ...act, ...(act.to ? { person: code("P", act.to) } : {}) } } };
    } });
  return { ...instance, prompts, plans, pack: moved };
}

test("in play: told the hour at one in the morning, the boy goes to bed; the teacher sees him asleep and wakes him; asleep again, he wakes at six", async () => {
  const { runtime, prompts, plans, pack } = await playNight();
  const { coordinator } = runtime;
  const beat = async (id, acts) => { plans[id] = acts; const before = prompts[id].length; await runtime.applyWorldEvent({ kind: "urge", toCharacterId: id, text: "动起来" });
    for (let i = 0; i < 12 && (plans[id].length || prompts[id].length === before); i += 1) if (!(await runtime.runNext())) break; };
  const boy = () => coordinator.worldState.entities[hu];

  assert.equal(coordinator.worldState.worldPackMeta.startClock, "01:00", "a town keeps its clock");
  assert.deepEqual(boy().sleep, { sleepiness: 0.85, atSeconds: 0, asleep: false }, "up since six the morning before");

  await beat(hu, [{ type: "move", target: "shi_home__bedroom_1" }, { type: "sleep" }]);
  assert.match(prompts[hu][0], /^现在是丑时初（凌晨一点），天黑着。你在石家老屋·堂屋/mu, "he is told the hour, not minutes since the opening");
  assert.doesNotMatch(prompts[hu][0], /起，过了 \d+ 分钟/u);
  assert.match(prompts[hu][0], /^- 困得直打哈欠$/mu, "and that he is sleepy");
  assert.match(prompts[hu][0], /^- sleep：/mu, "sleeping is something one can do");
  assert.equal(boy().zoneId, "shi_home__bedroom_1");
  assert.equal(boy().sleep.asleep, true, "he is asleep");
  assert.equal(boy().sleep.where, "bed");
  const lay = coordinator.journal.events.filter((row) => row.publicPayload?.primitive === "sleep").at(-1).publicPayload;
  assert.equal(lay.status, "success");

  await beat(wen, [{ type: "move", target: "shi_home__bedroom_1" }, { type: "wait", minutes: 1 }]);
  assert.match(prompts[wen].at(-1), /- P\d+ 石小虎：[^\n]*（就在你身边）[^\n]*，睡着了/u, "the teacher sees the boy asleep");
  const urged = prompts[hu].length;
  await beat(wen, [{ type: "none", say: "小虎，醒醒，别睡了。", sayTo: "石小虎" }]);
  assert.equal(boy().sleep.asleep, false, "spoken to, he wakes");
  const spoken = coordinator.journal.events.filter((row) => row.publicPayload?.primitive === "speak").at(-1).publicPayload;
  assert.deepEqual(spoken.resolvedEffects.filter((row) => row.kind === "woke").map((row) => [row.actorId, row.cause]), [[hu, "roused"]]);
  for (let i = 0; i < 6 && prompts[hu].length === urged; i += 1) if (!(await runtime.runNext())) break;
  assert.ok(prompts[hu].length > urged, "and has a beat of his own");

  await beat(hu, [{ type: "sleep" }]);
  assert.equal(boy().sleep.asleep, true);
  plans[wen] = Array.from({ length: 40 }, () => ({ type: "wait", minutes: 30 }));
  for (let i = 0; i < 400 && coordinator.worldState.nowSeconds < 5 * H; i += 1) if (!(await runtime.runNext())) await coordinator.advanceWorldClockTo({ targetSeconds: 6 * H });
  const woke = coordinator.journal.events.filter((row) => row.type === "world_sleep_event").at(-1);
  assert.ok(woke, "the world wakes him");
  assert.equal(woke.occurredAtSeconds, 5 * H, "at six in the morning");
  assert.equal(boy().sleep.asleep, false);
  for (let i = 0; i < 6 && !/你醒了/u.test(prompts[hu].at(-1)); i += 1) if (!(await runtime.runNext())) break;
  assert.match(prompts[hu].at(-1), /你醒了，睡了\d+个钟头。现在是卯时正（早上六点），天蒙蒙亮。/u, "he knows he slept the night");
  assert.match(prompts[hu].at(-1), /^现在是卯时[正初]（早上六点[^）]*），天蒙蒙亮。你在石家老屋·卧房/mu);
  assert.doesNotMatch(prompts[hu].at(-1), /困得/u, "and is not sleepy");

  const checkpoint = await runtime.checkpoint();
  for (const actor of runtime.actors.values()) await actor.close?.();
  const feed = buildObserverFeed({ checkpoint, settledTurns: reconcileSettledTurnRecords(checkpoint) }, pack);
  assert.deepEqual(feed.frames.filter((row) => row.kind === "sleep" && row.actorId === hu && row.status === "success").map((row) => row.caption), ["石小虎躺下睡了。", "石小虎躺下睡了。"]);
  assert.equal(feed.frames.find((row) => row.type === "world" && row.kind === "woke")?.caption, "石小虎醒了。");
  const director = fs.readFileSync(new URL("../src/stage/director.js", import.meta.url), "utf8");
  assert.match(director, /\["rest", "wait", "sleep"\]/u, "the stage lays a sleeper in bed");
});
