// The world's weather is more than rain: a downpour with thunder, fog, wind,
// a blazing sun, drought, snow and a blizzard. One table names them for the
// world (what people outdoors notice, how light and loud it is), for 天意's
// buttons and for the stage, which draws each one.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { WEATHER_KINDS, WEATHER_IDS } from "../src/worlds/weatherKinds.mjs";
import { WEATHER, validateWorldEvent } from "../src/server/simulation/worldEvents.mjs";
import { createWeatherLayer } from "../src/stage/weather.js";
import { compileBlueprint } from "../src/worlds/compiler/index.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";

test("nine kinds, each with a label, what people notice, light and noise", () => {
  assert.deepEqual(WEATHER_IDS, ["clear", "rain", "storm", "fog", "wind", "heat", "drought", "snow", "blizzard"]);
  assert.deepEqual(WEATHER_KINDS.map((row) => row.label), ["放晴", "下雨", "暴雨", "起雾", "刮风", "烈日", "干旱", "下雪", "暴雪"]);
  for (const row of WEATHER_KINDS) {
    assert.ok(row.content && row.content.endsWith("。"), `${row.id} says what people notice`);
    assert.ok(row.light > 0 && row.light <= 1, `${row.id} light`);
    assert.ok(row.ambientNoise >= 0 && row.ambientNoise <= 1, `${row.id} noise`);
  }
  const by = Object.fromEntries(WEATHER_KINDS.map((row) => [row.id, row]));
  assert.ok(by.storm.light < by.rain.light && by.blizzard.light < by.snow.light, "the storms are darker");
  assert.ok(by.storm.ambientNoise > by.rain.ambientNoise && by.blizzard.ambientNoise > by.snow.ambientNoise, "and louder");
  assert.ok(by.heat.light >= Math.max(...WEATHER_KINDS.map((row) => row.light)), "the blazing sun is brightest");
  assert.deepEqual(Object.keys(WEATHER), WEATHER_IDS, "the world's table is the same table");
  assert.deepEqual(WEATHER.rain, { label: "下雨", content: "下起雨来了，雨点打在身上。", light: 0.55, ambientNoise: 0.45 }, "rain is as it was");
});

test("天意 accepts every kind in a town and names them when refusing one it does not know", async () => {
  const blueprint = JSON.parse(fs.readFileSync("scripts/fixtures/blueprints/river_town.json", "utf8"));
  const { pack } = compileBlueprint(blueprint, { seed: 1 });
  const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(pack), { worldPack: pack, pacingMode: "scene", characterIds: pack.stage.sceneCast,
    characterAgentCallMode: "performance", runStage: async () => ({ performance: { thought: "", say: { to: "", text: "", loud: false }, do: { type: "wait", target: "", person: "", minutes: 10 }, gesture: "" } }) });
  const runtime = instance.runtime;
  const state = () => runtime.coordinator.worldState;
  for (const id of WEATHER_IDS) assert.deepEqual(validateWorldEvent(state(), { kind: "weather", weather: id }), [], id);
  const [refusal] = validateWorldEvent(state(), { kind: "weather", weather: "tornado" });
  assert.equal(refusal.field, "weather");
  assert.equal(refusal.message, "天气只能是放晴、下雨、暴雨、起雾、刮风、烈日、干旱、下雪、暴雪。");
  await runtime.applyWorldEvent({ kind: "weather", weather: "blizzard" });
  const place = Object.values(state().places)[0];
  assert.equal(place.perceptionEnvironment.weather, "blizzard");
  assert.equal(place.perceptionEnvironment.light, 0.3);
  const delivered = JSON.stringify([...runtime.actors.values()].map((actor) => actor.mailbox));
  assert.ok(delivered.includes("刮起了暴风雪，雪粒打得人睁不开眼。"), "people outdoors notice the blizzard");
  for (const actor of runtime.actors.values()) await actor.close?.();
});

test("天意's weather buttons come from the same table", () => {
  const panel = fs.readFileSync(new URL("../src/stage/worldEventsPanel.js", import.meta.url), "utf8");
  assert.match(panel, /import \{ WEATHER_KINDS \} from "\.\.\/worlds\/weatherKinds\.mjs";/u);
  assert.doesNotMatch(panel, /\{ value: "fog", label: "起雾" \}/u, "no second, shorter list");
});

function recorder() {
  const rects = [];
  return { rects, ctx: { fillStyle: "", globalAlpha: 1, fillRect(x, y, w, h) { rects.push({ x, y, w, h, style: this.fillStyle }); } } };
}

test("the stage draws every kind inside the view, in whole pixels, the same at the same moment", () => {
  const layer = createWeatherLayer();
  const view = [100, 60, 470, 307];
  const inside = ({ x, y, w, h }) => x >= view[0] && y >= view[1] && x + w <= view[0] + view[2] && y + h <= view[1] + view[3];
  const count = {};
  for (const id of WEATHER_IDS) {
    const a = recorder(), b = recorder();
    layer.draw(a.ctx, view, id, 3.3);
    layer.draw(b.ctx, view, id, 3.3);
    count[id] = a.rects.length;
    assert.deepEqual(a.rects, b.rects, `${id} is the same at the same moment`);
    assert.ok(a.rects.every(inside), `${id} stays inside the view`);
    assert.ok(a.rects.every(({ x, y, w, h }) => [x, y, w, h].every(Number.isInteger)), `${id} whole pixels`);
    if (id === "clear") assert.equal(count[id], 0);
    else assert.ok(count[id] > 0, `${id} draws something`);
  }
  assert.ok(count.storm > count.rain * 1.5, "a downpour is heavier than rain");
  assert.ok(count.blizzard > count.snow * 1.5, "a blizzard is thicker than snow");
  // Lightning: within any ten seconds of a storm, the whole view flashes white at least once.
  let flashed = false;
  for (let t = 0; t < 10 && !flashed; t += 0.02) {
    const frame = recorder();
    layer.draw(frame.ctx, view, "storm", Math.round(t * 100) / 100);
    flashed = frame.rects.some((row) => row.x === view[0] && row.y === view[1] && row.w === view[2] && row.h === view[3] && /255,\s*255,\s*255/u.test(row.style));
  }
  assert.ok(flashed, "lightning flashes in a storm");
});
