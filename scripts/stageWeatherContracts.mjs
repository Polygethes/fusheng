// Weather the world settles is weather the player sees: the feed carries the
// opening weather and every change, and the stage draws rain, fog or wind over
// the outdoor map. Indoors stays dry; clear weather draws nothing.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { weatherAt, createWeatherLayer, WEATHER_KINDS } from "../src/stage/weather.js";
import { loadWorldPack } from "../src/worlds/registry.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { buildObserverFeed } from "../src/server/observer/observerFeed.mjs";
import { reconcileSettledTurnRecords } from "../src/server/simulation/settledSimulationReport.mjs";

test("the weather at a frame is the last change at or before it, else the opening weather", () => {
  const frames = [
    { type: "action", kind: "speak" },
    { type: "world", kind: "world_event", worldEventKind: "weather", weather: "fog" },
    { type: "action", kind: "move" },
    { type: "world", kind: "world_event", worldEventKind: "message" },
    { type: "world", kind: "world_event", worldEventKind: "weather", weather: "clear" },
  ];
  assert.equal(weatherAt(frames, -1, "rain"), "rain", "before any frame");
  assert.equal(weatherAt(frames, 0, "rain"), "rain");
  assert.equal(weatherAt(frames, 1, "rain"), "fog");
  assert.equal(weatherAt(frames, 3, "rain"), "fog");
  assert.equal(weatherAt(frames, 4, "rain"), "clear");
  assert.equal(weatherAt(frames, 99, "rain"), "clear", "past the end is the last frame");
  assert.equal(weatherAt([], 0, ""), "clear", "no weather at all is clear");
  assert.equal(weatherAt([], 0, "tornado"), "clear", "an unknown kind is clear");
  assert.deepEqual([...WEATHER_KINDS].sort(), ["blizzard", "clear", "drought", "fog", "heat", "rain", "snow", "storm", "wind"]);
});

// A canvas stand-in that records what is drawn.
function recorder() {
  const rects = [];
  return { rects, ctx: { fillStyle: "", globalAlpha: 1, fillRect(x, y, w, h) { rects.push({ x, y, w, h, style: this.fillStyle }); } } };
}

test("rain, fog and wind draw inside the view, in whole pixels, the same at the same moment", () => {
  const layer = createWeatherLayer();
  const view = [100, 60, 470, 307];
  const inside = ({ x, y, w, h }) => x >= view[0] && y >= view[1] && x + w <= view[0] + view[2] && y + h <= view[1] + view[3];
  const whole = ({ x, y, w, h }) => [x, y, w, h].every(Number.isInteger);
  for (const kind of ["rain", "fog", "wind"]) {
    const a = recorder(), b = recorder();
    layer.draw(a.ctx, view, kind, 12.5);
    layer.draw(b.ctx, view, kind, 12.5);
    assert.ok(a.rects.length > 0, `${kind} draws something`);
    assert.ok(a.rects.every(inside), `${kind} stays inside the view`);
    assert.ok(a.rects.every(whole), `${kind} is drawn in whole pixels`);
    assert.deepEqual(a.rects, b.rects, `${kind} is the same at the same moment`);
  }
  const rain = recorder();
  layer.draw(rain.ctx, view, "rain", 12.5);
  assert.ok(rain.rects.length >= 200, "a downpour, not a drizzle");
  const later = recorder();
  layer.draw(later.ctx, view, "rain", 12.6);
  assert.notDeepEqual(later.rects, rain.rects, "the rain falls");
  const clear = recorder();
  layer.draw(clear.ctx, view, "clear", 12.5);
  assert.equal(clear.rects.length, 0, "clear weather draws nothing");
});

test("the feed carries the opening rain of 雨夜入谷 and each change the player makes", async () => {
  const pack = await loadWorldPack("cangxinggu");
  const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(pack), { worldPack: pack, pacingMode: "scene", characterIds: pack.stage.sceneCast,
    characterAgentCallMode: "performance", runStage: async () => ({ performance: { thought: "", say: { to: "", text: "", loud: false }, do: { type: "wait", target: "", person: "", minutes: 10 }, gesture: "" } }) });
  const runtime = instance.runtime;
  await runtime.applyWorldEvent({ kind: "weather", weather: "fog" });
  await runtime.applyWorldEvent({ kind: "weather", weather: "clear" });
  const checkpoint = await runtime.checkpoint();
  for (const actor of runtime.actors.values()) await actor.close?.();
  const feed = buildObserverFeed({ checkpoint, settledTurns: reconcileSettledTurnRecords(checkpoint) }, pack);
  assert.equal(feed.initial.weather, "rain", "雨夜入谷 opens in the rain");
  const changes = feed.frames.filter((row) => row.worldEventKind === "weather").map((row) => row.weather);
  assert.deepEqual(changes, ["fog", "clear"]);
  assert.equal(weatherAt(feed.frames, feed.frames.length - 1, feed.initial.weather), "clear");
});

test("the stage draws the weather only on the outdoor map, after the lighting", () => {
  const main = fs.readFileSync(new URL("../src/stage/main.js", import.meta.url), "utf8");
  assert.match(main, /import \{ createWeatherLayer, weatherAt \} from "\.\/weather\.js";/u);
  assert.match(main, /if \(camera\.mapId === "exterior"\) weatherLayer\.draw\(ctx, camView, weatherAt\(director\.frames, director\.cursor, feed\.initial\?\.weather\), t\);/u);
  const lighting = main.indexOf("lighting.draw(ctx, t, {");
  const weather = main.indexOf("weatherLayer.draw(");
  assert.ok(lighting > 0 && weather > lighting, "rain falls in front of the lighting, so the night does not hide it");
});
