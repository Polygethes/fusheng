// A person knows how things stand around them by perceiving them: the weather
// they stand in or hear through the walls, water underfoot, mud, snow, dry
// earth, the stream if it is in sight. The world's standing state reaches
// each prompt through one place, by what that person can perceive; standing
// in floodwater soaks them like rain.
import test from "node:test";
import assert from "node:assert/strict";
import { perceivedConditions } from "../src/server/simulation/perceivableConditions.mjs";
import { weatherExposure, applyWeatherToBody } from "../src/server/simulation/weatherOnBody.mjs";
import { loadWorldPack } from "../src/worlds/registry.mjs";
import { defineWorldPack } from "../src/worlds/worldPack.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";

const town = (weather, stages) => ({
  perceptionEnvironment: { weather },
  sites: [{ id: "feiwu", kind: "building" }, { id: "creek", kind: "outdoor" }, { id: "gukou", kind: "outdoor" }],
  topology: { zones: { street_9: { waterDistance: 40 }, creek__bank: { waterDistance: 1 }, gukou__gate: { waterDistance: 5 }, feiwu__hall: { waterDistance: 41 } } },
  ...(stages ? { environment: { stages: { stream: "normal", ground: "dry", snow: "none", dryness: "normal", ...stages } } } : {}),
});
const seen = (place, zoneId) => perceivedConditions({ place, zoneId }).map((row) => row.text);

test("out of doors a person stands in the weather and on the ground; indoors they hear and see it through the walls", () => {
  assert.deepEqual(seen(town("rain", { ground: "puddles" }), "street_9"), ["天色：下着雨。", "脚下：到处是水洼。"]);
  assert.deepEqual(seen(town("rain", { ground: "puddles" }), "feiwu__hall"), ["屋外下着雨。"]);
  assert.deepEqual(seen(town("clear", {}), "street_9"), ["天色：天晴着，没有雨。"]);
  assert.deepEqual(seen(town("snow", { snow: "ankle", ground: "muddy" }), "street_9"), ["天色：下着雪。", "地上积雪：没过脚面。"], "snow covers the mud");
  assert.deepEqual(seen(town("drought", { dryness: "parched", stream: "low" }), "street_9"), ["天色：天旱，好些天没下过雨。", "土地：干裂了口子，草都蔫了。"],
    "the stream is out of sight from the street");
  assert.deepEqual(seen(town("drought", { dryness: "parched", stream: "low" }), "gukou__gate"), ["天色：天旱，好些天没下过雨。", "土地：干裂了口子，草都蔫了。", "溪水：浅得见了底。"]);
  assert.deepEqual(perceivedConditions({ place: { perceptionEnvironment: { light: 0.8 } }, zoneId: "hall" }), [], "a tavern without weather says nothing");
});

test("the stream in flood: water on the bank, a roar heard from indoors in a deluge", () => {
  const flood = town("rain", { stream: "flood", ground: "puddles" });
  assert.deepEqual(seen(flood, "creek__bank"), ["天色：下着雨。", "这里进了水，积水没过了脚踝。", "脚下：到处是水洼。", "溪水：漫过了岸，岸边一片汪洋。"]);
  assert.deepEqual(seen(flood, "gukou__gate"), ["天色：下着雨。", "脚下：到处是水洼。", "溪水：漫过了岸，岸边一片汪洋。"], "five tiles off, the gate is dry in a flood");
  const deluge = town("storm", { stream: "deluge", ground: "waterlogged" });
  assert.deepEqual(seen(deluge, "gukou__gate"), ["天色：下着暴雨，雷声一阵阵。", "这里进了水，积水没过了膝盖。", "脚下：低处积满了水。", "溪水：山洪滚滚，浑水冲上了路。"]);
  assert.deepEqual(seen(deluge, "feiwu__hall"), ["屋外下着暴雨，雷声一阵阵。", "屋外传来山洪的轰响。"]);
  assert.deepEqual(perceivedConditions({ place: deluge, zoneId: "creek__bank" }).map((row) => row.kind), ["weather", "flood_here", "ground", "stream"]);
});

test("standing in floodwater soaks a person, indoors or out", () => {
  const sites = [{ id: "feiwu", kind: "building" }];
  assert.deepEqual(weatherExposure({ zoneId: "feiwu__hall", sites, perceptionEnvironment: { weather: "clear" }, perceivedObjects: [] }),
    { outdoors: false, weather: "clear", nearFire: false }, "no water underfoot: as before");
  assert.deepEqual(weatherExposure({ zoneId: "feiwu__hall", sites, perceptionEnvironment: { weather: "clear" }, perceivedObjects: [], floodedHere: true }),
    { outdoors: false, weather: "clear", nearFire: false, floodedHere: true });
  const dry = { hunger: 0.2, thirst: 0.2, fatigue: 0.2, pain: 0, stamina: 0.8 };
  const wading = applyWeatherToBody(dry, { outdoors: false, weather: "clear", nearFire: false, floodedHere: true }, 1800);
  assert.ok(wading.wetness >= 0.95, `half an hour in floodwater soaks through: ${wading.wetness}`);
  assert.ok(wading.chill > 0, "and wet clothes chill");
});

test("in play the prompt says how things stand, and changes with the world", async () => {
  const pack = await loadWorldPack("cangxinggu");
  const bao = "char_cangxinggu_bao_dachuan", hu = "char_cangxinggu_shi_xiaohu", gu = "char_cangxinggu_gu_huaishan";
  const moved = defineWorldPack({ ...structuredClone(pack),
    cast: structuredClone(pack.cast).map((row) => (row.id === bao ? { ...row, startZoneId: "creek__bank" } : row)),
    stage: { ...structuredClone(pack.stage), scenePositions: { ...structuredClone(pack.stage.scenePositions), [bao]: "creek__bank" } } });
  const prompts = new Map();
  const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(moved), { worldPack: moved, pacingMode: "scene", characterIds: [gu, hu, bao],
    enableDayPlanning: false, characterAgentCallMode: "performance",
    async runStage(input) {
      prompts.set(input.characterId, input.prompt?.user || "");
      return { performance: { thought: "", say: { to: "", text: "", loud: false }, gesture: "", do: { type: "wait", target: "", person: "", minutes: 30 } } };
    } });
  const { runtime } = instance;
  const beat = async (id) => { prompts.delete(id); await runtime.applyWorldEvent({ kind: "urge", toCharacterId: id, text: "看看四周" }); for (let i = 0; i < 8 && !prompts.has(id); i += 1) if (!(await runtime.runNext())) break; return prompts.get(id) || ""; };
  assert.match(await beat(hu), /你在晒谷场·广场中央。天色：下着雨。脚下：地上泥泞。/u);
  assert.match(await beat(gu), /你在山口废屋·堂屋。屋外下着雨。/u);
  assert.doesNotMatch(prompts.get(gu), /脚下|溪水/u, "indoors the ground and the stream are out of sight");
  assert.match(await beat(bao), /你在藏星溪边·岸边。天色：下着雨。脚下：/u, "on the bank, in the rain");
  for (let i = 0; i < 30 && runtime.coordinator.worldState.nowSeconds < 18000; i += 1) await runtime.coordinator.advanceWorldClockTo({ targetSeconds: 18000 });
  const flooded = await beat(bao);
  assert.match(flooded, /这里进了水，积水没过了脚踝。/u, "at midnight 宝大川 stands in the water on the bank");
  assert.match(flooded, /溪水：漫过了岸，岸边一片汪洋。/u);
  for (let i = 0; i < 4; i += 1) if (!(await runtime.runNext())) break;
  const body = [...runtime.actors.values()].find((actor) => actor.characterId === bao).privateState.ecologyState.body;
  assert.ok(body.wetness >= 0.9, "and is soaked");
  for (const actor of runtime.actors.values()) await actor.close?.();
});
