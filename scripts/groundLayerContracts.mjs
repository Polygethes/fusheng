// The observer sees what the weather left on the ground: floodwater spreading
// from the stream, puddles and mud, snow, cracked earth. Drawn only on open
// ground out of doors, under the people, in whole pixels, the same at the
// same moment; nothing when the ground is as usual.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createGroundLayer, environmentAt } from "../src/stage/groundLayer.js";
import { flattenLayout } from "../src/worlds/layoutAtlas.mjs";
import { loadWorldPack } from "../src/worlds/registry.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { buildObserverFeed } from "../src/server/observer/observerFeed.mjs";
import { reconcileSettledTurnRecords } from "../src/server/simulation/settledSimulationReport.mjs";

const pack = await loadWorldPack("cangxinggu");
const atlas = flattenLayout(pack.layout);
const layout = atlas.layout;
const ground = createGroundLayer(layout, atlas.maps.exterior.rect);
const T = 16;
const usual = { stages: { stream: "normal", ground: "dry", snow: "none", dryness: "normal" }, floodRadius: -1 };
const env = (stages, floodRadius = -1) => ({ stages: { ...usual.stages, ...stages }, floodRadius });
const view = [64 * T, 8 * T, 32 * T, 48 * T]; // the eastern side of the valley, with the stream
function recorder() {
  const rects = [];
  return { rects, ctx: { fillStyle: "", fillRect(x, y, w, h) { rects.push({ x, y, w, h, style: this.fillStyle }); } } };
}
const drawn = (environment, t = 2.5, at = view) => { const r = recorder(); ground.draw(r.ctx, at, environment, t); return r.rects; };
const waterTiles = [];
for (const floor of layout.floors) if (floor.material === "water") { const [x, y, w, h] = floor.rect; for (let i = 0; i < w; i += 1) for (let j = 0; j < h; j += 1) waterTiles.push([x + i, y + j]); }
const reach = (px, py) => Math.min(...waterTiles.map(([x, y]) => Math.max(Math.abs(x - Math.floor(px / T)), Math.abs(y - Math.floor(py / T)))));
const roofed = (px, py) => (layout.roofs || []).some(({ rect: [x, y, w, h] }) => px / T >= x && px / T < x + w && py / T >= y && py / T < y + h);

test("the ground as usual draws nothing", () => {
  assert.equal(drawn(usual).length, 0);
  assert.equal(drawn(null).length, 0);
});

test("floodwater spreads from the stream by the flood's reach, never over roofs or the stream itself", () => {
  const flood = drawn(env({ stream: "flood" }, 2)).filter((row) => row.style === "rgba(62, 98, 128, 0.8)");
  const deluge = drawn(env({ stream: "deluge" }, 5)).filter((row) => row.style === "rgba(62, 98, 128, 0.8)");
  assert.ok(flood.length > 0, "the banks go under");
  assert.ok(deluge.length > flood.length * 1.5, "a deluge spreads further");
  for (const row of flood) assert.ok(reach(row.x, row.y) <= 2 && reach(row.x, row.y) >= 1, `flood tile at ${row.x},${row.y} is within two tiles of the stream`);
  for (const row of deluge) assert.ok(!roofed(row.x, row.y), "no water drawn on a roof");
});

test("puddles and mud on the paths, snow over the open ground, cracks in dry earth", () => {
  const puddles = drawn(env({ ground: "puddles" }));
  const waterlogged = drawn(env({ ground: "waterlogged" }));
  assert.ok(puddles.some((row) => row.style === "rgba(70, 104, 134, 0.75)"));
  assert.ok(waterlogged.length > puddles.length, "more water lies about when the ground is waterlogged");
  assert.ok(drawn(env({ ground: "muddy" })).some((row) => row.style === "rgba(60, 42, 28, 0.35)"));
  const dusting = drawn(env({ snow: "dusting" })), deep = drawn(env({ snow: "deep" }));
  assert.ok(dusting.some((row) => row.style === "rgba(240, 244, 250, 0.22)"));
  assert.ok(deep.some((row) => row.style === "rgba(240, 244, 250, 0.72)"), "deep snow is nearly white");
  assert.ok(!deep.some((row) => row.style === "rgba(70, 104, 134, 0.75)"), "snow covers the puddles");
  assert.ok(drawn(env({ dryness: "parched" })).some((row) => row.style === "rgba(90, 64, 34, 0.5)"), "parched earth cracks");
});

test("in whole pixels, inside the view, the same at the same moment", () => {
  const inside = ({ x, y, w, h }) => x >= view[0] && y >= view[1] && x + w <= view[0] + view[2] && y + h <= view[1] + view[3];
  for (const environment of [env({ stream: "deluge" }, 5), env({ ground: "waterlogged" }), env({ snow: "deep" }), env({ dryness: "parched" })]) {
    const a = drawn(environment), b = drawn(environment);
    assert.deepEqual(a, b);
    assert.ok(a.every(inside));
    assert.ok(a.every(({ x, y, w, h }) => [x, y, w, h].every(Number.isInteger)));
  }
  assert.notDeepEqual(drawn(env({ stream: "flood" }, 2), 2.5), drawn(env({ stream: "flood" }, 2), 4), "the floodwater ripples");
});

test("the stage reads the ground from the feed and draws it under the people, out of doors", async () => {
  const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(pack), { worldPack: pack, pacingMode: "scene", characterIds: pack.stage.sceneCast,
    enableDayPlanning: false, characterAgentCallMode: "performance", runStage: async () => ({}) });
  const { coordinator } = instance.runtime;
  for (let i = 0; i < 30 && coordinator.worldState.nowSeconds < 18000; i += 1) await coordinator.advanceWorldClockTo({ targetSeconds: 18000 });
  const checkpoint = await instance.runtime.checkpoint();
  for (const actor of instance.runtime.actors.values()) await actor.close?.();
  const feed = buildObserverFeed({ checkpoint, settledTurns: reconcileSettledTurnRecords(checkpoint) }, pack);
  assert.deepEqual(environmentAt(feed.frames, -1, feed.initial.environment), feed.initial.environment, "before any frame, the opening ground");
  assert.equal(environmentAt(feed.frames, feed.frames.length - 1, feed.initial.environment).floodRadius, 2, "at midnight the banks are under water");
  const main = fs.readFileSync(new URL("../src/stage/main.js", import.meta.url), "utf8");
  assert.match(main, /import \{ createGroundLayer, environmentAt \} from "\.\/groundLayer\.js";/u);
  assert.match(main, /if \(camera\.mapId === "exterior"\) groundLayer\.draw\(ctx, camView, environmentAt\(director\.frames, director\.cursor, feed\.initial\?\.environment\), t\);/u);
  const props = main.indexOf("drawAnimatedProps(ctx, scene, t");
  const groundAt = main.indexOf("groundLayer.draw(");
  const actors = main.indexOf("director.draw(ctx, t");
  assert.ok(props > 0 && groundAt > props && groundAt < actors, "on the ground, under the people");
});
