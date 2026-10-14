// What the weather leaves in the world: a night of rain swells the stream until
// it bursts its banks at midnight; snow piles up; a drought cracks the earth.
// These are world state, kept with the town and advanced with world time. The
// world stops at each visible change, settles it as a fact, and tells those
// who would notice; the change is saved, replayed and shown to the observer.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createEnvironment, nextEnvironmentChangeAt, environmentChangesAt, settleEnvironmentStages, rebaseEnvironment, environmentAt,
  floodRadius, zoneFlooded, ENVIRONMENT_DRIFT, ENVIRONMENT_STAGES, STAGE_NEWS } from "../src/server/simulation/worldEnvironment.mjs";
import { WEATHER_IDS } from "../src/worlds/weatherKinds.mjs";
import { zoneIsOutdoor } from "../src/server/simulation/worldEvents.mjs";
import { compileBlueprint } from "../src/worlds/compiler/index.mjs";
import { loadWorldPack } from "../src/worlds/registry.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { buildObserverFeed } from "../src/server/observer/observerFeed.mjs";
import { reconcileSettledTurnRecords } from "../src/server/simulation/settledSimulationReport.mjs";

const timeline = (weather, levels, count = 4) => {
  let environment = createEnvironment({ weather, nowSeconds: 0, levels });
  let now = 0;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const at = nextEnvironmentChangeAt(environment, now);
    if (at == null) break;
    out.push([at, environmentChangesAt(environment, at).map((row) => `${row.level}:${row.to}`).join(",")]);
    environment = settleEnvironmentStages(environment, at);
    now = at;
  }
  return out;
};

test("each weather drives the stream, the ground, the snow and the dryness at its own pace", () => {
  assert.deepEqual(Object.keys(ENVIRONMENT_DRIFT).sort(), [...WEATHER_IDS].sort(), "every kind of weather has a row");
  // 雨夜入谷 opens in the rain with the stream already up and the ground muddy (19:00 is second 0).
  assert.deepEqual(timeline("rain", { stream: 0.45, ground: 0.5 }), [
    [3000, "stream:high,ground:puddles"], [10500, "ground:waterlogged"], [18000, "stream:flood"], [30000, "stream:deluge"]], "the stream bursts its banks at midnight");
  assert.deepEqual(timeline("storm", { stream: 0.45, ground: 0.5 }), [
    [1200, "stream:high,ground:puddles"], [4200, "ground:waterlogged"], [6000, "stream:flood"], [10200, "stream:deluge"]], "a downpour floods within two hours");
  assert.deepEqual(timeline("snow", {}, 3), [[1800, "snow:dusting"], [10500, "snow:ankle"], [21000, "snow:deep"]]);
  assert.deepEqual(timeline("drought", {}, 3), [[13200, "stream:low"], [29100, "dryness:dry"], [47100, "dryness:parched"]]);
  assert.deepEqual(timeline("clear", {}), [], "fair weather on an ordinary day changes nothing");
  const flood = settleEnvironmentStages(createEnvironment({ weather: "rain", levels: { stream: 0.8 } }), 0);
  assert.equal(flood.stages.stream, "flood");
  const receding = rebaseEnvironment(flood, 0, "clear");
  const back = nextEnvironmentChangeAt(receding, 0);
  assert.ok(back > 0 && environmentChangesAt(receding, back).some((row) => row.level === "stream" && row.to === "high"), "when the rain stops the water goes down");
});

test("a change of weather carries the levels on from where they stand", () => {
  const environment = createEnvironment({ weather: "rain", levels: { stream: 0.45 } });
  const rebased = rebaseEnvironment(environment, 3700, "storm");
  assert.equal(rebased.weather, "storm");
  assert.equal(rebased.sinceSeconds, 3700);
  assert.deepEqual(rebased.stages, environment.stages, "stages change only when the world settles them");
  assert.ok(Math.abs(rebased.levels.stream - environmentAt(environment, 3700).stream) < 1e-9);
  assert.ok(environmentAt(rebased, 7300).stream > environmentAt(environment, 7300).stream, "a storm raises it faster than rain");
});

test("the flood spreads from the water by stage, and every stage has words", () => {
  assert.equal(floodRadius({ stages: { stream: "high" } }), -1);
  assert.equal(floodRadius({ stages: { stream: "flood" } }), 2);
  assert.equal(floodRadius({ stages: { stream: "deluge" } }), 5);
  assert.equal(zoneFlooded({ stages: { stream: "flood" } }, { waterDistance: 2 }), true);
  assert.equal(zoneFlooded({ stages: { stream: "flood" } }, { waterDistance: 3 }), false);
  assert.equal(zoneFlooded({ stages: { stream: "deluge" } }, {}), false, "a zone with no water near it never floods");
  for (const [level, stages] of Object.entries(ENVIRONMENT_STAGES)) for (const [, stage] of stages) assert.ok(STAGE_NEWS[level][stage], `${level}:${stage} has words`);
});

test("a compiled town knows how far each place is from open water", async () => {
  const valley = await loadWorldPack("cangxinggu");
  const zones = valley.stage.topology.zones;
  assert.equal(zones.creek__bank.waterDistance, 1);
  assert.equal(zones.bridge__deck.waterDistance, 1);
  assert.equal(zones.gukou__gate.waterDistance, 5);
  assert.equal(zones.square__center.waterDistance, 39);
  assert.equal(zones.street_9.waterDistance, 40);
  assert.equal(zones.feiwu__hall.waterDistance, 41, "a house is one step further than the street outside its door");
  assert.equal(zones.feiwu__kitchen.waterDistance, 41);
  const hamlet = compileBlueprint(JSON.parse(fs.readFileSync("scripts/fixtures/blueprints/tiny_hamlet.json", "utf8"))).pack;
  assert.ok(Object.values(hamlet.stage.topology.zones).every((zone) => !("waterDistance" in zone)), "a town without water has none");
  const river = compileBlueprint(JSON.parse(fs.readFileSync("scripts/fixtures/blueprints/river_town.json", "utf8"))).pack;
  const distances = Object.values(river.stage.topology.zones).map((zone) => zone.waterDistance);
  assert.ok(distances.every(Number.isInteger) && Math.min(...distances) === 1, "a river town measures every zone");
});

async function valley() {
  const pack = await loadWorldPack("cangxinggu");
  const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(pack), { worldPack: pack, pacingMode: "scene", characterIds: pack.stage.sceneCast,
    enableDayPlanning: false, characterAgentCallMode: "performance",
    runStage: async () => ({ performance: { thought: "", say: { to: "", text: "", loud: false }, gesture: "", do: { type: "wait", target: "", person: "", minutes: 30 } } }) });
  return { pack, instance, runtime: instance.runtime, coordinator: instance.runtime.coordinator };
}
const townOf = (state) => Object.values(state.places).find((place) => place.environment);

test("雨夜入谷 opens with its rain already in the ground; worlds without a town have no environment", async () => {
  const { runtime, coordinator } = await valley();
  const place = townOf(coordinator.worldState);
  assert.deepEqual(place.environment, { schemaVersion: 1, weather: "rain", sinceSeconds: 0,
    levels: { stream: 0.45, ground: 0.5, snow: 0, dryness: 0.2 }, stages: { stream: "normal", ground: "muddy", snow: "none", dryness: "normal" } });
  for (const actor of runtime.actors.values()) await actor.close?.();
  const jiexing = await loadWorldPack("jiexing");
  const tavern = createWorldRuntimeV27(buildPlayableWorldFromPack(jiexing), { worldPack: jiexing, pacingMode: "scene", characterIds: jiexing.stage.sceneCast,
    runStage: async () => ({}) });
  assert.ok(Object.values(tavern.runtime.coordinator.worldState.places).every((row) => !row.environment));
  for (const actor of tavern.runtime.actors.values()) await actor.close?.();
});

test("the world stops at each change, settles it and tells those who would notice", async () => {
  const { runtime, coordinator, pack } = await valley();
  await coordinator.advanceWorldClockTo({ targetSeconds: 4000 });
  let state = coordinator.worldState;
  assert.equal(state.nowSeconds, 3000, "the clock stops where the change happens");
  assert.deepEqual(townOf(state).environment.stages, { stream: "high", ground: "puddles", snow: "none", dryness: "normal" });
  const event = coordinator.journal.events.at(-1);
  assert.equal(event.type, "world_environment_changed");
  assert.deepEqual(event.publicPayload.environmentChanges, [{ level: "stream", from: "normal", to: "high" }, { level: "ground", from: "muddy", to: "puddles" }]);
  const place = townOf(state);
  const outdoors = Object.values(state.entities).filter((row) => row.kind === "character" && zoneIsOutdoor(place, row.zoneId)).map((row) => row.id).sort();
  const got = (text) => event.publicPayload.deliveries.filter((row) => row.content === text).map((row) => row.recipientCharacterId).sort();
  assert.deepEqual(got("路上积起了一个个水洼。"), outdoors, "everyone out of doors sees the puddles");
  assert.ok(outdoors.length > 0 && !outdoors.includes("char_cangxinggu_gu_huaishan"));
  assert.deepEqual(got("溪水涨起来了，哗哗地响。"), ["char_cangxinggu_bao_dachuan"], "only 宝大川 at the valley gate is near enough to the stream");
  for (let i = 0; i < 20 && coordinator.worldState.nowSeconds < 18000; i += 1) await coordinator.advanceWorldClockTo({ targetSeconds: 18000 });
  state = coordinator.worldState;
  assert.equal(state.nowSeconds, 18000);
  assert.equal(townOf(state).environment.stages.stream, "flood", "at midnight the stream is over its banks");
  const flood = coordinator.journal.events.filter((row) => row.type === "world_environment_changed").at(-1);
  assert.ok(flood.publicPayload.deliveries.some((row) => row.recipientCharacterId === "char_cangxinggu_bao_dachuan" && row.content === "溪水漫过了岸，岸边一片汪洋。"));
  await runtime.applyWorldEvent({ kind: "weather", weather: "clear" });
  const cleared = townOf(coordinator.worldState).environment;
  assert.equal(cleared.weather, "clear");
  assert.equal(cleared.sinceSeconds, 18000, "天意's weather carries the levels on from now");
  assert.equal(cleared.stages.stream, "flood", "the water does not vanish when the rain stops");
  const checkpoint = await runtime.checkpoint();
  for (const actor of runtime.actors.values()) await actor.close?.();
  const feed = buildObserverFeed({ checkpoint, settledTurns: reconcileSettledTurnRecords(checkpoint) }, pack);
  assert.deepEqual(feed.initial.environment, { stages: { stream: "normal", ground: "muddy", snow: "none", dryness: "normal" }, floodRadius: -1 });
  const frames = feed.frames.filter((row) => row.kind === "environment");
  assert.equal(frames[0].type, "world");
  assert.deepEqual(frames[0].environmentChanges, [{ level: "stream", from: "normal", to: "high" }, { level: "ground", from: "muddy", to: "puddles" }]);
  assert.equal(frames[0].caption, "溪水涨起来了，哗哗地响。路上积起了一个个水洼。");
  assert.deepEqual(frames.at(-1).environment, { stages: { stream: "flood", ground: "waterlogged", snow: "none", dryness: "normal" }, floodRadius: 2 });
});

test("a saved world goes on from where its water stood", async () => {
  const { runtime, coordinator, pack } = await valley();
  for (let i = 0; i < 10 && coordinator.worldState.nowSeconds < 10500; i += 1) await coordinator.advanceWorldClockTo({ targetSeconds: 10500 });
  const checkpoint = await runtime.checkpoint();
  for (const actor of runtime.actors.values()) await actor.close?.();
  const resumed = createWorldRuntimeV27(buildPlayableWorldFromPack(pack), { worldPack: pack, checkpoint, runStage: async () => ({}) });
  const environment = townOf(resumed.runtime.coordinator.worldState).environment;
  assert.equal(environment.stages.ground, "waterlogged");
  // The town's own deadline (the array eye before 子时) stops the clock on the way; the flood still comes on time.
  const clock = resumed.runtime.coordinator;
  for (let i = 0; i < 10 && clock.worldState.nowSeconds < 18000; i += 1) await clock.advanceWorldClockTo({ targetSeconds: 20000 });
  assert.equal(clock.worldState.nowSeconds, 18000, "the flood still comes at midnight");
  assert.equal(clock.journal.events.at(-1).type, "world_environment_changed");
  for (const actor of resumed.runtime.actors.values()) await actor.close?.();
});
