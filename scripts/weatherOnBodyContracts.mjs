// Weather reaches the body. Rain and snow soak clothes; wet clothes, wind and
// snow make a person cold, and a blizzard chills even through a house wall;
// staying cold brings on a chill and then a fever. A blazing sun or a drought
// heats and parches; staying hot brings on heatstroke. Children, the old and
// the worn-out fall ill sooner. A fire dries and warms, shade cools; illness
// passes slowly. The person feels it (their prompt says so) and the observer
// sees it as private.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { advanceCharacterPhysiologyTo } from "../src/server/simulation/characterPhysiologyContinuity.mjs";
import { weatherExposure, vulnerabilityOf, bodyLines, BODY_WEATHER } from "../src/server/simulation/weatherOnBody.mjs";
import { WEATHER_IDS } from "../src/worlds/weatherKinds.mjs";

const HOUR = 3600;
const advance = (body, hours, exposure, vulnerability = 1) => advanceCharacterPhysiologyTo({
  ecologyState: { body }, lastWorldSyncSeconds: 0, targetWorldSeconds: Math.round(hours * HOUR), exposure, vulnerability,
}).ecologyState.body;
const dry = { hunger: 0.2, thirst: 0.2, fatigue: 0.2, pain: 0, stamina: 0.8 };
const rainOut = { outdoors: true, weather: "rain", nearFire: false };
const indoors = { outdoors: false, weather: "rain", nearFire: false };
const byFire = { outdoors: false, weather: "rain", nearFire: true };

test("without exposure the body changes exactly as before", () => {
  const before = advanceCharacterPhysiologyTo({ ecologyState: { body: dry }, lastWorldSyncSeconds: 0, targetWorldSeconds: 2 * HOUR }).ecologyState.body;
  assert.equal(before.wetness ?? 0, 0);
  assert.equal(before.chill ?? 0, 0);
  assert.equal(before.illness ?? 0, 0);
  const withNull = advanceCharacterPhysiologyTo({ ecologyState: { body: dry }, lastWorldSyncSeconds: 0, targetWorldSeconds: 2 * HOUR, exposure: null }).ecologyState.body;
  assert.deepEqual(withNull, before);
});

test("twenty minutes out in the rain soaks through", () => {
  const body = advance(dry, 1 / 3, rainOut);
  assert.ok(body.wetness >= 0.95, `wetness ${body.wetness}`);
  assert.ok(body.chill > 0 && body.chill < 0.5, `chill ${body.chill}`);
  assert.equal(body.illness, 0, "not ill yet");
});

test("two hours in the rain: cold through, and a chill sets in", () => {
  const body = advance(dry, 2, rainOut);
  assert.ok(body.wetness >= 0.99);
  assert.ok(body.chill >= 0.9, `chill ${body.chill}`);
  assert.ok(body.illness > 0.1 && body.illness < 0.5, `illness ${body.illness}`);
  assert.ok(body.stamina < advanceCharacterPhysiologyTo({ ecologyState: { body: dry }, lastWorldSyncSeconds: 0, targetWorldSeconds: 2 * HOUR }).ecologyState.body.stamina,
    "a chill takes strength");
});

test("a fire dries and warms within the hour; the illness lingers", () => {
  const soaked = advance(dry, 2, rainOut);
  const warmed = advance(soaked, 1, byFire);
  assert.ok(warmed.wetness <= 0.05, `wetness ${warmed.wetness}`);
  assert.ok(warmed.chill <= 0.1, `chill ${warmed.chill}`);
  assert.ok(warmed.illness > 0.05, "a fire does not cure a chill at once");
  const indoorsOnly = advance(soaked, 1, indoors);
  assert.ok(indoorsOnly.wetness > warmed.wetness + 0.3, "without a fire clothes dry slowly");
  assert.ok(indoorsOnly.chill > warmed.chill + 0.3, "and wet clothes keep you cold indoors");
});

test("clear, fog and wind do not wet; wind outdoors still chills", () => {
  for (const weather of ["clear", "fog", "wind"]) {
    assert.equal(advance(dry, 1, { outdoors: true, weather, nearFire: false }).wetness, 0, weather);
  }
  assert.ok(advance(dry, 1, { outdoors: true, weather: "wind", nearFire: false }).chill > 0.2, "wind chills");
  assert.equal(advance(dry, 1, { outdoors: true, weather: "clear", nearFire: false }).chill, 0, "a clear sky does not");
  assert.equal(advance(dry, 1, { outdoors: false, weather: "wind", nearFire: false }).chill, 0, "indoors the wind does not reach you");
});

const baseline = (hours) => advanceCharacterPhysiologyTo({ ecologyState: { body: dry }, lastWorldSyncSeconds: 0, targetWorldSeconds: Math.round(hours * HOUR) }).ecologyState.body;
const out = (weather) => ({ outdoors: true, weather, nearFire: false });
const inside = (weather) => ({ outdoors: false, weather, nearFire: false });

test("every kind of weather has a row in the body table", () => {
  assert.deepEqual(Object.keys(BODY_WEATHER).sort(), [...WEATHER_IDS].sort());
});

test("a storm soaks in minutes", () => {
  assert.ok(advance(dry, 1 / 6, out("storm")).wetness >= 0.95);
});

test("snow chills; a blizzard chills hard, even indoors without a fire", () => {
  const snow = advance(dry, 1, out("snow"));
  assert.ok(snow.chill >= 0.6, `snow chill ${snow.chill}`);
  assert.ok(snow.wetness > 0.5 && snow.wetness < 1, "melting snow wets clothes, slower than rain");
  const blizzard = advance(dry, 1, out("blizzard"));
  assert.ok(blizzard.chill >= 0.95, `blizzard chill ${blizzard.chill}`);
  assert.ok(blizzard.illness > snow.illness && blizzard.illness > 0.05, "a blizzard brings a chill on sooner");
  const coldHouse = advance(dry, 2, inside("snow"));
  assert.ok(coldHouse.chill > 0.2 && coldHouse.chill < 0.5, `a house without a fire is cold in the snow: ${coldHouse.chill}`);
  assert.equal(advance(dry, 2, { outdoors: false, weather: "snow", nearFire: true }).chill, 0, "a fire keeps the cold out");
});

test("a blazing sun heats and parches, and staying in it brings heatstroke; shade cools", () => {
  const sun = advance(dry, 2, out("heat"));
  assert.ok(sun.heat >= 0.95, `heat ${sun.heat}`);
  assert.ok(sun.heatstroke > 0.1, `heatstroke ${sun.heatstroke}`);
  assert.ok(sun.thirst - baseline(2).thirst >= 0.2, "the sun makes you thirsty");
  assert.equal(sun.chill ?? 0, 0);
  const shade = advance(sun, 1, inside("heat"));
  assert.ok(shade.heat <= 0.3, `shade cools: ${shade.heat}`);
  const soakedInSun = advance({ ...dry, wetness: 1 }, 1, out("heat"));
  assert.ok(soakedInSun.wetness <= 0.05, "the sun dries clothes fast");
});

test("a drought heats and parches outdoors, and parches a little even indoors", () => {
  const field = advance(dry, 3, out("drought"));
  assert.ok(field.heat >= 0.8, `heat ${field.heat}`);
  assert.ok(field.thirst - baseline(3).thirst >= 0.2);
  const home = advance(dry, 3, inside("drought"));
  assert.equal(home.heat ?? 0, 0);
  assert.ok(home.thirst - baseline(3).thirst >= 0.05, "dry air parches indoors too");
});

test("fog does nothing to the body", () => {
  const fog = advance(dry, 1, out("fog"));
  assert.deepEqual([fog.wetness, fog.chill, fog.heat ?? 0], [0, 0, 0]);
});

test("children and the worn-out fall ill sooner", () => {
  assert.equal(vulnerabilityOf({ child: false, age: 30, body: dry }), 1);
  assert.equal(vulnerabilityOf({ child: true, age: 9, body: dry }), 1.5);
  assert.equal(vulnerabilityOf({ child: false, age: 69, body: dry }), 1.5);
  assert.equal(vulnerabilityOf({ child: false, age: 24, body: { ...dry, fatigue: 0.7 } }), 1.5);
  assert.equal(vulnerabilityOf({ child: false, age: 24, body: { ...dry, fatigue: 0.7, stamina: 0.2 } }), 2);
  const adult = advance(dry, 2, rainOut, 1);
  const child = advance(dry, 2, rainOut, 1.5);
  assert.ok(child.illness > adult.illness * 1.3, "the same rain, a worse chill");
});

test("where a person stands decides what reaches them", () => {
  const sites = [{ id: "square", kind: "outdoor" }, { id: "feiwu", kind: "building" }];
  const rain = { weather: "rain" };
  assert.deepEqual(weatherExposure({ zoneId: "square__center", sites, perceptionEnvironment: rain, perceivedObjects: [] }), { outdoors: true, weather: "rain", nearFire: false });
  assert.deepEqual(weatherExposure({ zoneId: "street_3", sites, perceptionEnvironment: rain, perceivedObjects: [] }), { outdoors: true, weather: "rain", nearFire: false });
  assert.deepEqual(weatherExposure({ zoneId: "feiwu__hall", sites, perceptionEnvironment: rain, perceivedObjects: [] }), { outdoors: false, weather: "rain", nearFire: false });
  const stove = { zoneId: "feiwu__kitchen", observableState: { lit: true } };
  assert.equal(weatherExposure({ zoneId: "feiwu__kitchen", sites, perceptionEnvironment: rain, perceivedObjects: [stove] }).nearFire, true);
  assert.equal(weatherExposure({ zoneId: "feiwu__hall", sites, perceptionEnvironment: rain, perceivedObjects: [stove] }).nearFire, false, "a fire in another room does not warm you");
  assert.equal(weatherExposure({ zoneId: "feiwu__kitchen", sites, perceptionEnvironment: rain, perceivedObjects: [{ ...stove, observableState: { lit: false } }] }).nearFire, false);
  assert.deepEqual(weatherExposure({ zoneId: "yard", sites: [], perceptionEnvironment: {}, perceivedObjects: [] }), { outdoors: false, weather: "clear", nearFire: false },
    "a world without a site list has no marked outdoors and no weather");
});

test("the person feels it in plain words; nothing notable says nothing", () => {
  assert.deepEqual(bodyLines(dry), []);
  assert.deepEqual(bodyLines({ ...dry, wetness: 0.9, chill: 0.8 }), ["衣服湿透了，贴在身上", "冷得直打哆嗦"]);
  assert.deepEqual(bodyLines({ ...dry, wetness: 0.4, chill: 0.5 }), ["衣服湿了一片", "身上发冷"]);
  assert.deepEqual(bodyLines({ ...dry, illness: 0.7 }), ["发着烧，头重脚轻"]);
  assert.deepEqual(bodyLines({ ...dry, illness: 0.4 }), ["着凉了，鼻子发堵、喉咙发痒"]);
  assert.deepEqual(bodyLines({ ...dry, illness: 0.15 }), ["有点着凉的意思"]);
  assert.deepEqual(bodyLines({ ...dry, hunger: 0.8, thirst: 0.8, fatigue: 0.8, pain: 0.6 }), ["饿得发慌", "渴得厉害", "累得快撑不住了", "身上疼得厉害"]);
  assert.deepEqual(bodyLines({ ...dry, hunger: 0.6, fatigue: 0.6, pain: 0.3 }), ["有点饿了", "有些乏了", "身上有些疼"]);
  assert.deepEqual(bodyLines({ ...dry, chill: 0.95 }), ["冻得手脚发麻"]);
  assert.deepEqual(bodyLines({ ...dry, heat: 0.8, heatstroke: 0.6 }), ["热得浑身冒汗，头发昏", "中暑了，眼前发黑、直犯恶心"]);
  assert.deepEqual(bodyLines({ ...dry, heat: 0.5, heatstroke: 0.25 }), ["身上燥热", "有点中暑，头晕"]);
  assert.deepEqual(bodyLines({ ...dry, wetness: 0.9, chill: 0.8, illness: 0.4, thirst: 0.6 }), ["衣服湿透了，贴在身上", "冷得直打哆嗦", "着凉了，鼻子发堵、喉咙发痒", "有点渴了"],
    "in order: wet, cold, hot, chill-illness, heatstroke, hunger, thirst, tiredness, pain");
});

test("the beat syncs weather into the body, the prompt says how the body feels, the observer shows it privately", () => {
  const runtime = fs.readFileSync(new URL("../src/server/pipeline/tavernWorldRuntimeV27.mjs", import.meta.url), "utf8");
  assert.match(runtime, /weatherExposure\(/u, "each beat works out what reaches the person");
  assert.match(runtime, /lastExposure/u, "the conditions since the last beat are what count");
  const turn = fs.readFileSync(new URL("../src/server/pipeline/characterPerformanceTurn.mjs", import.meta.url), "utf8");
  assert.match(turn, /section\("你的身子", bodyLines\(/u);
  const report = fs.readFileSync(new URL("../src/server/simulation/settledSimulationReport.mjs", import.meta.url), "utf8");
  assert.match(report, /privateResult\?\.body/u);
  const feed = fs.readFileSync(new URL("../src/server/observer/observerFeed.mjs", import.meta.url), "utf8");
  assert.match(feed, /frame\.body = \{ private: true, lines:/u);
  const html = fs.readFileSync(new URL("../stage.html", import.meta.url), "utf8");
  assert.match(html, /<div class="label">身子 · 私人<\/div><div class="inner" id="cbody">—<\/div>/u);
});
