// Nature can hurt and kill, but only as nature would. A deluge takes people
// off the stream's edge — the weak and the fallen first — and knocks people
// over in the floodwater further up; someone lying unconscious in knee-deep
// water drowns. Being cold is not freezing: only real cold (a blizzard, snow,
// a storm, a fireless house in the snow) freezes someone chilled through,
// over hours, and warmth brings them back; a night in the rain brings a fever,
// not a death. Those who see it are told in their own terms.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { floodHazards, sweepChance, knockChance, HAZARD_CAPTION } from "../src/server/simulation/naturalHazards.mjs";
import { rollFor, personFor } from "../src/server/simulation/confrontation.mjs";
import { applyWeatherToBody, bodyLines } from "../src/server/simulation/weatherOnBody.mjs";
import { bodyCrisis, healthStep } from "../src/server/simulation/characterHealth.mjs";
import { perceivedConditions } from "../src/server/simulation/perceivableConditions.mjs";
import { loadWorldPack } from "../src/worlds/registry.mjs";
import { defineWorldPack } from "../src/worlds/worldPack.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { buildObserverFeed } from "../src/server/observer/observerFeed.mjs";
import { reconcileSettledTurnRecords } from "../src/server/simulation/settledSimulationReport.mjs";

const HOUR = 3600;
const dry = { hunger: 0.2, thirst: 0.2, fatigue: 0.2, pain: 0, stamina: 0.8 };
const exposed = (weather, outdoors = true, nearFire = false) => ({ weather, outdoors, nearFire });
// Hours until the body reaches a crisis that brings a person down (null if not within `limit` hours).
function hoursToCrisis(weather, outdoors = true, vulnerability = 1, limit = 48) {
  let body = { ...dry };
  for (let step = 1; step <= limit * 12; step += 1) {
    body = applyWeatherToBody(body, exposed(weather, outdoors), 300, vulnerability);
    if (bodyCrisis(body).level >= 0.9) return { hours: step / 12, cause: bodyCrisis(body).cause };
  }
  return null;
}

test("only real cold freezes, over hours; a night in the rain brings a fever, not a death; warmth brings a person back", () => {
  const blizzard = hoursToCrisis("blizzard");
  assert.equal(blizzard.cause, "cold");
  assert.ok(blizzard.hours >= 3.5 && blizzard.hours <= 5, `a blizzard out of doors brings a grown man down in about four hours: ${blizzard.hours}`);
  assert.ok(hoursToCrisis("blizzard", true, 1.5).hours < blizzard.hours, "a child or the old sooner");
  assert.ok(hoursToCrisis("snow").hours >= 7, "snow takes most of a night");
  const house = hoursToCrisis("blizzard", false);
  assert.ok(house.hours >= 12 && house.cause === "cold", `a house without a fire in a blizzard, over the best part of a day: ${house?.hours}`);
  let rain = { ...dry };
  for (let i = 0; i < 12 * 12; i += 1) rain = applyWeatherToBody(rain, exposed("rain"), 300, 1);
  assert.equal(rain.hypothermia ?? 0, 0, "rain alone soaks and chills, it does not freeze");
  assert.ok(rain.illness >= 0.6 && rain.illness < 0.9, `twelve hours in the rain: a fever, not yet a crisis (${rain.illness})`);
  assert.ok(bodyLines(rain).includes("发着烧，头重脚轻"));
  const frozen = { ...dry, wetness: 1, chill: 1, hypothermia: 0.7 };
  assert.deepEqual(bodyLines(frozen).slice(0, 3), ["衣服湿透了，贴在身上", "冻得手脚发麻", "冻得浑身僵硬，手脚不听使唤"]);
  const thawed = applyWeatherToBody(frozen, exposed("blizzard", false, true), HOUR, 1);
  assert.ok(thawed.hypothermia < 0.5, `an hour by the fire brings a frozen man back: ${thawed.hypothermia}`);
  assert.equal(healthStep({ health: {}, body: { hypothermia: 0.95 }, nowSeconds: 0 }).health.cause, "cold");
});

test("who the current takes, and the water underfoot", () => {
  assert.ok(Math.abs(sweepChance({ ageGroup: "adult", skills: [] }) - 0.45) < 1e-9, "a grown man stands a little better than even");
  assert.ok(sweepChance({ ageGroup: "adult", skills: ["hunting"] }) < 0.45, "a working body holds on better");
  assert.ok(sweepChance({ ageGroup: "child", skills: [] }) > 0.6);
  assert.equal(sweepChance({ ageGroup: "adult", health: { state: "down", wounds: 0.9 } }), 1, "someone lying on the ground cannot hold on");
  assert.ok(knockChance({ ageGroup: "child" }) > knockChance({ ageGroup: "adult" }));
  const place = { id: "town", sites: [{ id: "creek", kind: "outdoor" }], topology: { zones: { creek__bank: { waterDistance: 1 }, gukou__gate: { waterDistance: 5 } } },
    perceptionEnvironment: { weather: "storm" } };
  const deluge = { ...place, environment: { stages: { stream: "deluge", ground: "waterlogged", snow: "none", dryness: "normal" } } };
  const flood = { ...place, environment: { stages: { stream: "flood", ground: "waterlogged", snow: "none", dryness: "normal" } } };
  assert.equal(perceivedConditions({ place: deluge, zoneId: "gukou__gate" }).find((row) => row.kind === "flood_here").deep, true, "knee-deep in a deluge");
  assert.equal(perceivedConditions({ place: flood, zoneId: "creek__bank" }).find((row) => row.kind === "flood_here").deep, undefined, "ankle-deep in a flood");
  const state = { nowSeconds: 100, entities: { a: { id: "a", kind: "character", placeId: "town", zoneId: "creek__bank", ageGroup: "adult" } } };
  const none = { operations: [], deliveries: [], resolvedEffects: [], hazards: [], goneIds: [] };
  assert.deepEqual(floodHazards({ state, place: deluge, environment: deluge.environment, changes: [{ level: "ground", from: "puddles", to: "waterlogged" }], eventId: "e" }), none,
    "only the moment the deluge comes down");
  assert.deepEqual(floodHazards({ state, place: flood, environment: flood.environment, changes: [{ level: "stream", from: "high", to: "flood" }], eventId: "e" }), none,
    "a flood soaks, it does not sweep");
  const ids = Array.from({ length: 40 }, (_, i) => `e${i}`);
  const swept = ids.find((id) => rollFor(`${id}:a`) < 0.45), held = ids.find((id) => rollFor(`${id}:a`) >= 0.45);
  const taken = floodHazards({ state, place: deluge, environment: deluge.environment, changes: [{ level: "stream", from: "flood", to: "deluge" }], eventId: swept });
  assert.deepEqual(taken.hazards, [{ characterId: "a", outcome: "swept_away" }]);
  assert.deepEqual(taken.goneIds, ["a"]);
  assert.deepEqual(taken.operations.map((row) => row.path.join(".")), ["entities.a.health", "entities.a.present"]);
  assert.deepEqual([taken.operations[0].value.state, taken.operations[0].value.cause, taken.operations[1].value], ["dead", "swept_away", false]);
  assert.ok(taken.resolvedEffects.some((row) => row.kind === "health_changed" && row.actorId === "a" && row.state === "dead"), "the dead act no more");
  const kept = floodHazards({ state, place: deluge, environment: deluge.environment, changes: [{ level: "stream", from: "flood", to: "deluge" }], eventId: held });
  assert.deepEqual(kept.hazards, [{ characterId: "a", outcome: "kept_footing" }]);
  assert.equal(kept.deliveries[0].content, "山洪冲上岸来，你被冲得站不稳，死死抓住身边的东西，才没被卷走。");
  assert.equal(HAZARD_CAPTION.swept_away("石小虎"), "石小虎被山洪卷走了，转眼就没了踪影。");
});

test("in play: the deluge takes the boy lying on the bank, and the man lying at the gate drowns", async () => {
  const pack = await loadWorldPack("cangxinggu");
  const cid = (rid) => `char_cangxinggu_${rid}`;
  const bao = cid("bao_dachuan"), hu = cid("shi_xiaohu"), gu = cid("gu_huaishan");
  const where = { [bao]: "creek__bank", [hu]: "creek__bank", [gu]: "gukou__gate" };
  const moved = defineWorldPack({ ...structuredClone(pack),
    cast: structuredClone(pack.cast).map((row) => (where[row.id] ? { ...row, startZoneId: where[row.id] } : row)),
    stage: { ...structuredClone(pack.stage), scenePositions: { ...structuredClone(pack.stage.scenePositions), ...where },
      perceptionEnvironment: { ...pack.stage.perceptionEnvironment, weather: "storm" }, environment: { levels: { stream: 0.9, ground: 0.9 } } } });
  const calls = { [bao]: 0, [hu]: 0, [gu]: 0 };
  const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(moved), { worldPack: moved, pacingMode: "scene", characterIds: [bao, hu, gu],
    enableDayPlanning: false, characterAgentCallMode: "performance",
    async runStage(input) {
      calls[input.characterId] += 1;
      return { performance: { thought: "", say: { to: "", text: "", loud: false }, gesture: "", do: { type: "wait", target: "", person: "", minutes: 30 } } };
    } });
  const { runtime } = instance;
  const { coordinator } = runtime;
  const actorOf = (id) => [...runtime.actors.values()].find((actor) => actor.characterId === id);
  for (const id of [hu, gu]) actorOf(id).privateState.ecologyState.body = { ...actorOf(id).privateState.ecologyState.body, illness: 0.95 };
  const entity = (id) => coordinator.worldState.entities[id];
  const stream = () => Object.values(coordinator.worldState.places).find((row) => row.environment).environment.stages.stream;
  await runtime.applyWorldEvent({ kind: "urge", toCharacterId: hu, text: "头好沉" });
  await runtime.applyWorldEvent({ kind: "urge", toCharacterId: gu, text: "头好沉" });
  for (let i = 0; i < 6 && [hu, gu].some((id) => entity(id).health?.state !== "down"); i += 1) if (!(await runtime.runNext())) break;
  assert.deepEqual([entity(hu).health?.state, entity(gu).health?.state], ["down", "down"], "both collapse with fever before the water comes");
  assert.equal(stream(), "flood");
  const baoBefore = entity(bao);
  for (let i = 0; i < 40 && (stream() !== "deluge" || entity(gu).health?.state !== "dead"); i += 1) if (!(await runtime.runNext())) break;
  assert.equal(stream(), "deluge");

  const event = coordinator.journal.events.find((row) => row.type === "world_environment_changed"
    && row.publicPayload.environmentChanges.some((change) => change.level === "stream" && change.to === "deluge"));
  const hazards = event.publicPayload.hazards;
  assert.ok(event.occurredAtSeconds < 7200, "the deluge comes before the fever would have killed anyone");
  assert.deepEqual(hazards.find((row) => row.characterId === hu), { characterId: hu, outcome: "swept_away" }, "the boy lying on the bank cannot hold on");
  assert.equal(entity(hu).present, false, "he is gone from the valley");
  assert.deepEqual([entity(hu).health.state, entity(hu).health.cause], ["dead", "swept_away"]);
  const baoOutcome = rollFor(`${event.eventId}:${bao}`) < sweepChance(baoBefore, event.occurredAtSeconds) ? "swept_away" : "kept_footing";
  assert.deepEqual(hazards.find((row) => row.characterId === bao), { characterId: bao, outcome: baoOutcome }, "宝大川 draws once and keeps what he drew");
  if (baoOutcome === "kept_footing") {
    const toBao = event.publicPayload.deliveries.filter((row) => row.recipientCharacterId === bao).map((row) => row.content);
    assert.ok(toBao.includes(`${personFor(coordinator.worldState, bao, hu)}被山洪卷走了，转眼就没了踪影。`), "he sees the boy taken");
    assert.ok(toBao.includes("山洪冲上岸来，你被冲得站不稳，死死抓住身边的东西，才没被卷走。"));
  } else assert.equal(entity(bao).present, false);
  assert.ok(!event.publicPayload.deliveries.some((row) => row.recipientCharacterId === hu), "no news for someone the water has taken");

  assert.deepEqual([entity(gu).health?.state, entity(gu).health?.cause], ["dead", "drowned"], "lying unconscious in knee-deep water, he drowns");
  assert.ok(entity(gu).health.diedAtSeconds >= event.occurredAtSeconds && entity(gu).health.diedAtSeconds < 7200);
  assert.equal(entity(gu).present, true, "his body is still at the gate");
  assert.deepEqual([calls[hu], calls[gu]], [0, 0], "neither decided anything");
  await assert.rejects(runtime.applyWorldEvent({ kind: "urge", toCharacterId: hu, text: "醒醒" }), { code: "WORLD_EVENT_INVALID" }, "天意 cannot reach someone the water took");
  for (let i = 0; i < 5; i += 1) if (!(await runtime.runNext())) break;
  assert.equal(coordinator.journal.events.filter((row) => row.actorId === hu && row.occurredAtSeconds > event.occurredAtSeconds).length, 0, "the taken act no more");

  const checkpoint = await runtime.checkpoint();
  for (const actor of runtime.actors.values()) await actor.close?.();
  const feed = buildObserverFeed({ checkpoint, settledTurns: reconcileSettledTurnRecords(checkpoint) }, moved);
  const frame = feed.frames.find((row) => row.eventId === event.eventId);
  assert.match(frame.caption, /山洪下来了，浑水冲上了路。.*石小虎被山洪卷走了，转眼就没了踪影。/u, "the observer reads who the water took");
  assert.deepEqual(frame.hazards, hazards);
  assert.equal(frame.changes.entities[hu].present, false, "the stage learns he is gone");
  const director = fs.readFileSync(new URL("../src/stage/director.js", import.meta.url), "utf8");
  assert.match(director, /present === false/u, "the stage stops drawing someone the water took");
});
