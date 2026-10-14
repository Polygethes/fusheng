// Things belong to people. A household owns what is in its home; a person
// owns what they carried in. Taking what belongs to someone else is a fact:
// onlookers who can tell whose it is know it was someone else's (the owner
// knows it was theirs); the person taking it can see whose it is before they
// do. An owner sees their own thing in another's hand, and sees when
// something is gone from where it belongs. Giving one's own away makes it the
// other's. Whether it was borrowing or stealing is for people to judge.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ownershipNote, takenFromOthers, ownersAfterGiving, missingHere } from "../src/server/simulation/property.mjs";
import { loadWorldPack } from "../src/worlds/registry.mjs";
import { defineWorldPack } from "../src/worlds/worldPack.mjs";
import { validateWorldPack } from "../src/worlds/validateWorldPack.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { buildObserverFeed } from "../src/server/observer/observerFeed.mjs";
import { reconcileSettledTurnRecords } from "../src/server/simulation/settledSimulationReport.mjs";

const cid = (rid) => `char_cangxinggu_${rid}`;
const bao = cid("bao_dachuan"), hu = cid("shi_xiaohu"), shou = cid("shi_shoutian"), gu = cid("gu_huaishan"), lu = cid("lu_qinghe");

test("a town knows what belongs to whom from the day it is built", async () => {
  const pack = await loadWorldPack("cangxinggu");
  assert.equal(validateWorldPack(pack).ok, true);
  const find = (label, zoneId) => pack.objects.find((row) => row.label === label && (!zoneId || row.zoneId === zoneId));
  assert.deepEqual(find("木桶", "shi_home__kitchen").ownerIds, [shou, hu], "the 石 household's bucket");
  assert.equal(find("木桶", "shi_home__kitchen").homeZoneId, "shi_home__kitchen", "and where it belongs");
  assert.deepEqual(find("铁锄").ownerIds, [bao, cid("liu_chunniang")]);
  assert.deepEqual(find("生锈的短剑").ownerIds, [gu], "what a man carries in is his");
  assert.equal(find("生锈的短剑").homeZoneId, undefined);
  assert.equal(find("灶台", "shi_home__kitchen").ownerIds, undefined, "a stove is not carried off; no one claims it");
  assert.equal(find("香炉").ownerIds, undefined, "the shrine's things are no one's");
});

test("whose it is, in each person's terms; taking, giving, and what an owner sees is gone", () => {
  const entities = {
    [shou]: { id: shou, name: "石守田", knownActorIds: [hu, bao] }, [hu]: { id: hu, name: "石小虎", knownActorIds: [shou, bao] },
    [bao]: { id: bao, name: "宝大川", knownActorIds: [shou, hu], zoneId: "shi_home__hall", present: true },
    [gu]: { id: gu, name: "顾怀山", knownActorIds: [lu] }, [lu]: { id: lu, name: "陆青禾", knownActorIds: [gu] },
  };
  const bucket = { id: "bucket", label: "木桶", ownerIds: [shou, hu], homeZoneId: "shi_home__kitchen", zoneId: "shi_home__kitchen", holderCharacterId: "" };
  const sword = { id: "sword", label: "生锈的短剑", ownerIds: [gu], zoneId: "feiwu__hall", holderCharacterId: gu };
  const state = { entities, objects: { bucket, sword } };
  assert.equal(ownershipNote(state, hu, bucket), "你家的");
  assert.equal(ownershipNote(state, bao, bucket), "石守田家的", "a neighbour knows whose house it stands in");
  assert.equal(ownershipNote(state, gu, bucket), "", "a stranger cannot tell");
  const carried = { ...bucket, holderCharacterId: bao, zoneId: "shi_home__hall" };
  assert.equal(ownershipNote(state, shou, carried), "你家的", "an owner knows his own bucket in another man's hand");
  assert.equal(ownershipNote(state, cid("he_sao"), carried), "", "in a hand it is just a bucket");
  assert.equal(ownershipNote(state, gu, sword), "你的");
  assert.equal(ownershipNote(state, lu, sword), "", "not even his wife reads a sword in his hand as a fact about it");
  assert.equal(ownershipNote(state, gu, { id: "censer", label: "香炉" }), "");
  assert.deepEqual(takenFromOthers(bucket, bao), { kind: "took_others_property", actorId: bao, objectId: "bucket", ownerIds: [shou, hu] });
  assert.equal(takenFromOthers(bucket, hu), null, "one's own household's bucket");
  assert.equal(takenFromOthers({ id: "censer" }, bao), null);
  assert.deepEqual(ownersAfterGiving(sword, gu, bao), [bao], "a gift makes it his");
  assert.equal(ownersAfterGiving(bucket, bao, gu), null, "you cannot give away what is not yours");
  assert.equal(ownersAfterGiving(bucket, shou, hu), null, "handing it to one of the household changes nothing");
  const home = { ...state, entities: { ...entities, [shou]: { ...entities[shou], zoneId: "shi_home__kitchen", present: true } } };
  assert.deepEqual(missingHere({ ...home, objects: { bucket: carried } }, shou), [{ objectId: "bucket", label: "木桶" }]);
  assert.deepEqual(missingHere({ ...home, objects: { bucket } }, shou), [], "it is where it belongs");
  assert.deepEqual(missingHere({ ...home, objects: { bucket: { ...carried, holderCharacterId: hu } }, entities: { ...home.entities, [hu]: { ...entities[hu], zoneId: "shi_home__kitchen" } } }, shou), [],
    "in his son's hand right here, it is not gone");
  assert.deepEqual(missingHere({ ...home, objects: { bucket: carried } }, bao), [], "only an owner misses it");
});

test("in play: 宝大川 takes the 石 family's bucket in front of the boy; 石守田 sees it in his hand, then finds it gone", async () => {
  const pack = await loadWorldPack("cangxinggu");
  const where = { [bao]: "shi_home__kitchen", [hu]: "shi_home__kitchen", [shou]: "shi_home__hall" };
  const moved = defineWorldPack({ ...structuredClone(pack),
    cast: structuredClone(pack.cast).map((row) => (where[row.id] ? { ...row, startZoneId: where[row.id] } : row)),
    stage: { ...structuredClone(pack.stage), scenePositions: { ...structuredClone(pack.stage.scenePositions), ...where } } });
  const plans = { [bao]: [], [hu]: [], [shou]: [] };
  const prompts = { [bao]: [], [hu]: [], [shou]: [] };
  const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(moved), { worldPack: moved, pacingMode: "scene", characterIds: [bao, hu, shou],
    enableDayPlanning: false, characterAgentCallMode: "performance",
    async runStage(input) {
      const prompt = input.prompt?.user || "";
      prompts[input.characterId].push(prompt);
      const code = (prefix, label) => prompt.split("\n").find((line) => new RegExp(`^- ${prefix}\\d+ `, "u").test(line) && line.includes(label))?.match(new RegExp(`${prefix}\\d+`, "u"))?.[0] || "";
      const act = plans[input.characterId].shift() || { type: "wait", minutes: 30 };
      return { performance: { thought: "", say: { to: "", text: "", loud: false }, gesture: "",
        do: { target: "", person: "", minutes: 0, ...act, ...(act.thing ? { target: code("O", act.thing) } : {}), ...(act.to ? { person: code("P", act.to) } : {}) } } };
    } });
  const { runtime } = instance;
  const { coordinator } = runtime;
  const beat = async (id, acts) => { plans[id] = acts; const before = prompts[id].length; await runtime.applyWorldEvent({ kind: "urge", toCharacterId: id, text: "动起来" });
    for (let i = 0; i < 12 && (plans[id].length || prompts[id].length === before); i += 1) if (!(await runtime.runNext())) break; };
  const objectBy = (label, test = () => true) => Object.values(coordinator.worldState.objects).find((row) => row.label === label && test(row));

  await beat(hu, [{ type: "take_out", thing: "阵石碎块" }, { type: "give", thing: "阵石碎块", to: "宝大川" }]);
  assert.equal(objectBy("阵石碎块").holderCharacterId, bao);
  assert.deepEqual(objectBy("阵石碎块").ownerIds, [bao], "the boy gives his stone away; now it is 宝大川's");

  await beat(bao, [{ type: "take", thing: "木桶" }]);
  assert.match(prompts[bao][0], /木桶：就在你这儿[^\n]*；是石守田家的/u, "he can see whose bucket it is before he takes it");
  const took = coordinator.journal.events.filter((row) => row.publicPayload?.primitive === "handle").at(-1).publicPayload;
  assert.equal(took.status, "success");
  const fact = took.resolvedEffects.find((row) => row.kind === "took_others_property");
  assert.deepEqual([fact.actorId, fact.ownerIds], [bao, [shou, hu]], "taking someone else's thing is a fact");
  assert.match(took.deliveries.find((row) => row.recipientCharacterId === hu).content, /那是你家的木桶。$/u, "the boy sees it is his family's");
  assert.equal(objectBy("木桶", (row) => (row.ownerIds || []).includes(shou)).holderCharacterId, bao);

  await beat(bao, [{ type: "move", target: "shi_home__hall" }]);
  await beat(shou, [{ type: "wait", minutes: 1 }]);
  assert.match(prompts[shou].at(-1), /木桶：在[^\n]*手上\/身上[^\n]*；是你家的/u, "石守田 knows his bucket in another man's hand");
  await beat(shou, [{ type: "move", target: "shi_home__kitchen" }, { type: "wait", minutes: 1 }]);
  assert.match(prompts[shou].at(-1), /- 本该在这儿的木桶不见了。/u, "in the kitchen he sees it is gone");

  const checkpoint = await runtime.checkpoint();
  for (const actor of runtime.actors.values()) await actor.close?.();
  const feed = buildObserverFeed({ checkpoint, settledTurns: reconcileSettledTurnRecords(checkpoint) }, moved);
  const frame = feed.frames.filter((row) => row.kind === "pickup" && row.actorId === bao).at(-1);
  assert.deepEqual(frame.ownerNames, ["石守田", "石小虎"], "the observer is told whose it was");
  const director = fs.readFileSync(new URL("../src/stage/director.js", import.meta.url), "utf8");
  assert.match(director, /ownerNames/u, "the stage says so");
});
