// Eating and drinking are things people do in the world. Someone thirsty can
// drink from the bucket in their hand, from the jar beside them, from a well
// or straight from the stream; fill the bucket they hold from a jar, a well or
// the stream; pour it into a jar; eat a meal someone has cooked. Each is a
// fact the world settles: water moves between the things that hold it, the
// body eases, and whoever is there sees it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { sustenanceOutcome, waterHere, streamHere, SIP, DRINK_RELIEF, MEAL_RELIEF } from "../src/server/simulation/sustenance.mjs";
import { loadWorldPack } from "../src/worlds/registry.mjs";
import { defineWorldPack } from "../src/worlds/worldPack.mjs";
import { validateWorldPack } from "../src/worlds/validateWorldPack.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { buildObserverFeed } from "../src/server/observer/observerFeed.mjs";
import { reconcileSettledTurnRecords } from "../src/server/simulation/settledSimulationReport.mjs";

const cid = (rid) => `char_cangxinggu_${rid}`;
const hu = cid("shi_xiaohu"), wen = cid("wen_xiansheng"), bao = cid("bao_dachuan");

test("what can be drunk, eaten, filled and poured, and from where", () => {
  const places = { valley: { sites: [{ id: "shi_home", kind: "building" }, { id: "creek", kind: "outdoor" }, { id: "well", kind: "outdoor" }],
    topology: { zones: { shi_home__kitchen: { waterDistance: 1 }, creek__bank: { waterDistance: 1 }, well__rim: { waterDistance: 40 }, square__center: { waterDistance: 9 } } } } };
  const person = (id, zoneId) => ({ id, kind: "character", name: id, placeId: "valley", zoneId, present: true });
  const entities = { hu: person("hu", "shi_home__kitchen"), wen: person("wen", "shi_home__kitchen"), bao: person("bao", "creek__bank"), du: person("du", "square__center") };
  const jar = { id: "jar", label: "水缸", zoneId: "shi_home__kitchen", portable: false, state: { water: 2, capacity: 4 } };
  const bucket = { id: "bucket", label: "木桶", zoneId: "shi_home__kitchen", holderCharacterId: "wen", portable: true, state: { water: 0, capacity: 1 } };
  const stove = { id: "stove", label: "灶台", zoneId: "shi_home__kitchen", portable: false, state: { lit: true, meals: 2 } };
  const rope = { id: "rope", label: "井绳吊桶", zoneId: "well__rim", portable: false, state: { intact: true, source: "well" } };
  const state = { places, entities, objects: { jar, bucket, stove, rope } };

  // Filling the bucket in one's hand from the jar beside one.
  const filled = sustenanceOutcome({ state, actorId: "wen", act: "fill", objectId: "bucket" });
  assert.equal(filled.ok, true);
  assert.deepEqual(filled.objectPatches, [["bucket", "water", 1], ["jar", "water", 1]], "a bucketful moves out of the jar");
  assert.equal(filled.surfaceText, "从水缸里舀水装进木桶。");
  assert.equal(sustenanceOutcome({ state, actorId: "wen", act: "fill" }).ok, true, "the bucket in hand is the one meant");
  assert.equal(sustenanceOutcome({ state, actorId: "hu", act: "fill", objectId: "bucket" }).code, "FILL_NOT_HELD", "someone else's hands");
  assert.equal(sustenanceOutcome({ state, actorId: "wen", act: "fill", objectId: "jar" }).code, "FILL_NOT_HELD", "a jar is not filled by hand");
  const full = { ...state, objects: { ...state.objects, bucket: { ...bucket, state: { water: 1, capacity: 1 } } } };
  assert.equal(sustenanceOutcome({ state: full, actorId: "wen", act: "fill" }).code, "FILL_ALREADY_FULL");
  const dry = { ...state, objects: { ...state.objects, jar: { ...jar, state: { water: 0, capacity: 4 } } } };
  assert.equal(sustenanceOutcome({ state: dry, actorId: "wen", act: "fill" }).code, "FILL_NO_WATER_HERE", "an empty jar gives nothing");

  // Drinking: from what is held, else the jar beside them; a quarter of a 份 at a time.
  const drank = sustenanceOutcome({ state: full, actorId: "wen", act: "drink" });
  assert.deepEqual([drank.ok, drank.objectPatches, drank.bodyLoad], [true, [["bucket", "water", 1 - SIP]], { thirstDelta: -DRINK_RELIEF }], "from the bucket in hand first");
  assert.equal(drank.surfaceText, "从木桶里舀水喝了几口。");
  assert.deepEqual(sustenanceOutcome({ state, actorId: "hu", act: "drink" }).objectPatches, [["jar", "water", 2 - SIP]], "nothing in hand: the jar beside him");
  assert.deepEqual(sustenanceOutcome({ state: full, actorId: "hu", act: "drink", objectId: "bucket" }).objectPatches, [["bucket", "water", 0.75]],
    "a drink from the bucket in the teacher's hands, right beside him");
  assert.equal(sustenanceOutcome({ state, actorId: "wen", act: "drink", objectId: "bucket" }).code, "DRINK_NOTHING_TO_DRINK", "an empty bucket");
  assert.equal(sustenanceOutcome({ state: dry, actorId: "hu", act: "drink" }).code, "DRINK_NO_WATER_HERE");
  assert.equal(sustenanceOutcome({ state, actorId: "du", act: "drink" }).code, "DRINK_NO_WATER_HERE", "nothing to drink in the middle of the square");
  assert.equal(sustenanceOutcome({ state, actorId: "du", act: "drink", objectId: "jar" }).code, "DRINK_TARGET_NOT_HERE");

  // The stream at the bank, a well at its rim: drinking and filling never run them dry.
  assert.equal(streamHere(state, "bao"), true);
  assert.equal(streamHere(state, "hu"), false, "a kitchen by the water is still a kitchen");
  assert.equal(waterHere(state, "bao"), "溪水就在跟前");
  assert.equal(waterHere(state, "hu"), "");
  const fromStream = sustenanceOutcome({ state, actorId: "bao", act: "drink" });
  assert.deepEqual([fromStream.ok, fromStream.objectPatches, fromStream.surfaceText], [true, [], "蹲在溪边捧水喝了几口。"]);
  const atWell = { ...state, entities: { ...entities, bao: { ...entities.bao, zoneId: "well__rim" } }, objects: { ...state.objects, bucket: { ...bucket, holderCharacterId: "bao" } } };
  assert.equal(waterHere(atWell, "bao"), "井就在这儿");
  assert.equal(sustenanceOutcome({ state: atWell, actorId: "bao", act: "drink" }).surfaceText, "从井里打上水来，喝了几口。");
  const drawn = sustenanceOutcome({ state: atWell, actorId: "bao", act: "fill" });
  assert.deepEqual([drawn.objectPatches, drawn.surfaceText], [[["bucket", "water", 1]], "从井里打上一桶水。"]);

  // Pouring what one holds into a jar.
  const poured = sustenanceOutcome({ state: full, actorId: "wen", act: "pour", objectId: "jar" });
  assert.deepEqual([poured.ok, poured.objectPatches, poured.surfaceText], [true, [["bucket", "water", 0], ["jar", "water", 3]], "把木桶里的水倒进水缸。"]);
  assert.equal(sustenanceOutcome({ state, actorId: "wen", act: "pour", objectId: "jar" }).code, "POUR_NOTHING_IN_HAND");
  assert.equal(sustenanceOutcome({ state: full, actorId: "wen", act: "pour", objectId: "stove" }).code, "POUR_TARGET_NOT_A_VESSEL");
  assert.equal(sustenanceOutcome({ state: full, actorId: "wen", act: "pour" }).code, "POUR_TARGET_UNKNOWN");

  // A cooked meal is eaten a bowl at a time.
  const ate = sustenanceOutcome({ state, actorId: "hu", act: "eat", objectId: "stove" });
  assert.deepEqual([ate.ok, ate.objectPatches, ate.bodyLoad, ate.surfaceText], [true, [["stove", "meals", 1]], { hungerDelta: -MEAL_RELIEF }, "盛了一碗灶台上的饭吃了。"]);
  assert.equal(sustenanceOutcome({ state, actorId: "hu", act: "eat" }).ok, true, "the pot on the stove is the meal meant");
  const eaten = { ...state, objects: { ...state.objects, stove: { ...stove, state: { lit: true, meals: 0 } } } };
  assert.equal(sustenanceOutcome({ state: eaten, actorId: "hu", act: "eat" }).code, "EAT_NOTHING_TO_EAT", "nothing cooked, nothing to eat");
  assert.equal(sustenanceOutcome({ state, actorId: "hu", act: "dance" }).code, "SUSTAIN_ACT_UNKNOWN");
});

test("a town's well gives water and a cooked meal fills the pot", async () => {
  const pack = await loadWorldPack("cangxinggu");
  assert.equal(validateWorldPack(pack).ok, true);
  const rope = pack.objects.find((row) => row.label === "井绳吊桶");
  assert.equal(rope.portable, false, "a well rope stays with the well");
  assert.equal(rope.state.source, "well");
  const cook = pack.work.find((row) => row.zoneId === "shi_home__kitchen" && row.unitAction === "做好一顿饭");
  assert.deepEqual(cook.completionEffects.objectNumericDeltas, [{ objectId: "cangxinggu_shi_home_stove", path: ["meals"], delta: 4 }], "a meal is four bowls in the pot");
});

async function playKitchen(script, { thirst = 0.8, hunger = 0.7, meals = 0 } = {}) {
  const pack = await loadWorldPack("cangxinggu");
  const where = { [hu]: "shi_home__kitchen", [wen]: "shi_home__kitchen", [bao]: "creek__bank" };
  // The pot on the 石 stove starts with what the test needs (the coordinator's worldState is a read-only copy).
  const moved = defineWorldPack({ ...structuredClone(pack),
    cast: structuredClone(pack.cast).map((row) => (where[row.id] ? { ...row, startZoneId: where[row.id] } : row)),
    objects: structuredClone(pack.objects).map((row) => (row.id === "cangxinggu_shi_home_stove" ? { ...row, state: { ...row.state, meals } } : row)),
    stage: { ...structuredClone(pack.stage), scenePositions: { ...structuredClone(pack.stage.scenePositions), ...where } } });
  const prompts = { [hu]: [], [wen]: [], [bao]: [] };
  const plans = structuredClone(script);
  const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(moved), { worldPack: moved, pacingMode: "scene", characterIds: [hu, wen, bao],
    enableDayPlanning: false, characterAgentCallMode: "performance",
    async runStage(input) {
      const prompt = input.prompt?.user || "";
      prompts[input.characterId].push(prompt);
      const code = (prefix, label) => prompt.split("\n").find((line) => new RegExp(`^- ${prefix}\\d+ `, "u").test(line) && line.includes(label))?.match(new RegExp(`${prefix}\\d+`, "u"))?.[0] || "";
      const act = (plans[input.characterId] || []).shift() || { type: "wait", minutes: 30 };
      return { performance: { thought: "", say: { to: "", text: "", loud: false }, gesture: "",
        do: { target: "", person: "", minutes: 0, ...act, ...(act.thing ? { target: code("O", act.thing) } : {}), ...(act.to ? { person: code("P", act.to) } : {}) } } };
    } });
  const { runtime } = instance;
  const actorOf = (id) => [...runtime.actors.values()].find((actor) => actor.characterId === id);
  for (const id of [hu, wen, bao]) actorOf(id).privateState.ecologyState.body = { ...actorOf(id).privateState.ecologyState.body, thirst, hunger };
  return { runtime, prompts, plans, pack: moved, actorOf };
}

test("in play: 温先生 fills the bucket from the jar and hands it to the boy; the boy drinks, pours the rest back, and eats", async () => {
  const { runtime, prompts, plans, pack, actorOf } = await playKitchen({}, { meals: 2 });
  const { coordinator } = runtime;
  const beat = async (id, acts) => { plans[id] = acts; const before = prompts[id].length; await runtime.applyWorldEvent({ kind: "urge", toCharacterId: id, text: "动起来" });
    for (let i = 0; i < 12 && (plans[id].length || prompts[id].length === before); i += 1) if (!(await runtime.runNext())) break; };
  const objects = () => coordinator.worldState.objects;
  const last = (primitive) => coordinator.journal.events.filter((row) => row.publicPayload?.primitive === primitive).at(-1).publicPayload;

  await beat(wen, [{ type: "take", thing: "木桶" }, { type: "fill", thing: "木桶" }]);
  assert.match(prompts[wen][0], /^- drink：/mu, "drinking is something one can do");
  assert.match(prompts[wen][0], /^- fill：/mu);
  assert.equal(objects().cangxinggu_shi_home_bucket.state.water, 1, "the bucket is full");
  assert.equal(objects().cangxinggu_shi_home_water_jar.state.water, 1, "and the jar has given it");
  assert.match(last("sustain").deliveries.find((row) => row.recipientCharacterId === hu).content, /^温先生从水缸里舀水装进木桶。$/u, "the boy sees it done");

  await beat(wen, [{ type: "give", thing: "木桶", to: "石小虎" }]);
  assert.equal(objects().cangxinggu_shi_home_bucket.holderCharacterId, hu);
  await beat(hu, [{ type: "drink", thing: "木桶" }]);
  assert.equal(last("sustain").status, "success");
  assert.equal(objects().cangxinggu_shi_home_bucket.state.water, 0.75, "a drink is a quarter of a bucket");
  assert.ok(actorOf(hu).privateState.ecologyState.body.thirst < 0.35, `his thirst eases (${actorOf(hu).privateState.ecologyState.body.thirst})`);
  await beat(hu, [{ type: "pour", thing: "水缸" }]);
  assert.deepEqual([objects().cangxinggu_shi_home_bucket.state.water, objects().cangxinggu_shi_home_water_jar.state.water], [0, 1.75], "the rest goes back into the jar");
  await beat(hu, [{ type: "drink", thing: "木桶" }]);
  assert.deepEqual(last("sustain").failedEffects.map((row) => row.code), ["DRINK_NOTHING_TO_DRINK"], "an empty bucket gives nothing");

  await beat(hu, [{ type: "wait", minutes: 1 }]);
  assert.match(prompts[hu].at(-1), /灶台：就在你这儿；火：[^\n]*；做好的饭：2 份/u, "he can see there is food in the pot");
  await beat(hu, [{ type: "eat", thing: "灶台" }]);
  assert.equal(objects().cangxinggu_shi_home_stove.state.meals, 1);
  assert.ok(actorOf(hu).privateState.ecologyState.body.hunger < 0.2, `his hunger eases (${actorOf(hu).privateState.ecologyState.body.hunger})`);

  const checkpoint = await runtime.checkpoint();
  for (const actor of runtime.actors.values()) await actor.close?.();
  const feed = buildObserverFeed({ checkpoint, settledTurns: reconcileSettledTurnRecords(checkpoint) }, pack);
  const frames = feed.frames.filter((row) => row.kind === "sustain" && row.status === "success").map((row) => row.caption);
  assert.deepEqual(frames, ["温先生从水缸里舀水装进木桶。", "石小虎从木桶里舀水喝了几口。", "石小虎把木桶里的水倒进水缸。", "石小虎盛了一碗灶台上的饭吃了。"], "the observer sees each one");
  const failed = feed.frames.find((row) => row.kind === "sustain" && row.status === "failed");
  assert.deepEqual(failed.failureLabels, ["里面没有能喝的"]);
  const director = fs.readFileSync(new URL("../src/stage/director.js", import.meta.url), "utf8");
  assert.match(director, /DRINK_NOTHING_TO_DRINK/u, "the stage can say why");
});

test("in play: at the stream 宝大川 is told the water is right there, and drinks from it", async () => {
  const { runtime, prompts, plans, actorOf } = await playKitchen({});
  const beat = async (id, acts) => { plans[id] = acts; const before = prompts[id].length; await runtime.applyWorldEvent({ kind: "urge", toCharacterId: id, text: "动起来" });
    for (let i = 0; i < 12 && (plans[id].length || prompts[id].length === before); i += 1) if (!(await runtime.runNext())) break; };
  await beat(bao, [{ type: "drink" }]);
  assert.match(prompts[bao][0], /^- 溪水就在跟前，能喝，也能打水。$/mu, "he knows the water is there");
  assert.doesNotMatch(prompts[hu].join("\n") || "", /溪水就在跟前/u, "not in the kitchen");
  const drank = runtime.coordinator.journal.events.filter((row) => row.publicPayload?.primitive === "sustain").at(-1).publicPayload;
  assert.equal(drank.status, "success");
  assert.ok(actorOf(bao).privateState.ecologyState.body.thirst < 0.35);
  for (const actor of runtime.actors.values()) await actor.close?.();
});
