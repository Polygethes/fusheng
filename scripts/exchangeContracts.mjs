// A swap made face to face: holding out what is in your hand, you offer it for
// something the other person has on them; they say yes and the two things
// change hands at once. What was the giver's own becomes the receiver's. An
// offer stands for an hour, or until either thing has moved. A child carried
// in someone's arms is never something to trade.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { exchangeOutcome, standingOffers, isChild, OFFER_SECONDS } from "../src/server/simulation/exchange.mjs";
import { loadWorldPack } from "../src/worlds/registry.mjs";
import { defineWorldPack } from "../src/worlds/worldPack.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { buildObserverFeed } from "../src/server/observer/observerFeed.mjs";
import { reconcileSettledTurnRecords } from "../src/server/simulation/settledSimulationReport.mjs";

const cid = (rid) => `char_cangxinggu_${rid}`;
const hu = cid("shi_xiaohu"), wen = cid("wen_xiansheng"), shou = cid("shi_shoutian");

test("offering what is in hand for what the other has; saying yes swaps them; what was one's own becomes the other's", () => {
  const person = (id, name) => ({ id, kind: "character", name, placeId: "valley", zoneId: "kitchen", present: true, knownActorIds: ["hu", "wen", "shou"] });
  const entities = { hu: person("hu", "石小虎"), wen: person("wen", "温先生"), shou: person("shou", "石守田") };
  const stone = { id: "stone", label: "阵石碎块", holderCharacterId: "hu", ownerIds: ["hu"], portable: true, custody: { inHand: true, storageMode: "carried" } };
  const bucket = { id: "bucket", label: "木桶", holderCharacterId: "wen", ownerIds: ["shou", "hu"], homeZoneId: "kitchen", portable: true, custody: { inHand: true, storageMode: "carried" } };
  const baby = { id: "baby", label: "襁褓里的婴儿", holderCharacterId: "wen", ownerIds: ["wen"], portable: true, custody: { inHand: true } };
  const state = { nowSeconds: 100, entities, objects: { stone, bucket, baby } };

  const offered = exchangeOutcome({ state, actorId: "hu", targetId: "wen", act: "offer", objectId: "bucket" });
  assert.equal(offered.ok, true);
  assert.deepEqual(offered.entityPatches, [["wen", "offers", [{ fromId: "hu", giveObjectId: "stone", wantObjectId: "bucket", atSeconds: 100 }]]]);
  assert.equal(offered.tell("wen"), "石小虎想拿手里的阵石碎块换你的木桶。");
  assert.equal(offered.tell("shou"), "石小虎想拿阵石碎块换温先生的木桶。");
  assert.equal(exchangeOutcome({ state, actorId: "hu", targetId: "wen", act: "offer", objectId: "stone" }).code, "EXCHANGE_NOT_THEIRS", "only for what they have on them");
  assert.equal(exchangeOutcome({ state, actorId: "shou", targetId: "wen", act: "offer", objectId: "bucket" }).code, "EXCHANGE_NOTHING_IN_HAND");
  assert.equal(exchangeOutcome({ state, actorId: "hu", targetId: "wen", act: "offer", objectId: "baby" }).code, "EXCHANGE_NOT_FOR_TRADE", "a child is not for trade");
  assert.equal(isChild({ label: "刚出生的孩子", parentIds: ["a"] }), true);
  const apart = { ...state, entities: { ...entities, wen: { ...entities.wen, zoneId: "hall" } } };
  assert.equal(exchangeOutcome({ state: apart, actorId: "hu", targetId: "wen", act: "offer", objectId: "bucket" }).code, "EXCHANGE_TARGET_NOT_HERE");

  const pending = { ...state, entities: { ...entities, wen: { ...entities.wen, offers: offered.entityPatches[0][2] } } };
  assert.equal(standingOffers(pending, "wen").length, 1);
  assert.equal(standingOffers({ ...pending, nowSeconds: 100 + OFFER_SECONDS + 1 }, "wen").length, 0, "an offer lapses after an hour");
  assert.equal(standingOffers({ ...pending, objects: { ...pending.objects, stone: { ...stone, holderCharacterId: "shou" } } }, "wen").length, 0, "or once the thing offered has moved");
  assert.equal(exchangeOutcome({ state, actorId: "wen", targetId: "hu", act: "deal" }).code, "EXCHANGE_NO_OFFER");

  const dealt = exchangeOutcome({ state: pending, actorId: "wen", targetId: "hu", act: "deal" });
  assert.equal(dealt.ok, true);
  assert.deepEqual(dealt.entityPatches, [["wen", "offers", []]], "the offer is settled");
  const [[stoneId, stoneAfter], [bucketId, bucketAfter]] = dealt.objectPatches;
  assert.deepEqual([stoneId, stoneAfter.holderCharacterId, stoneAfter.ownerIds, stoneAfter.custody.inHand], ["stone", "wen", ["wen"], true], "the boy's stone is now the teacher's own");
  assert.deepEqual([bucketId, bucketAfter.holderCharacterId, bucketAfter.ownerIds, bucketAfter.homeZoneId], ["bucket", "hu", ["shou", "hu"], "kitchen"],
    "the bucket the teacher only held stays the 石 family's");
  assert.equal(dealt.tell("hu"), "温先生答应了，你用阵石碎块换到了木桶。");
  assert.equal(dealt.tell("shou"), "温先生和石小虎换了东西：木桶换阵石碎块。");
});

test("in play: the boy holds out his stone for the teacher's bucket; the teacher sees the offer and says yes", async () => {
  const pack = await loadWorldPack("cangxinggu");
  const where = { [hu]: "shi_home__kitchen", [wen]: "shi_home__kitchen", [shou]: "shi_home__kitchen" };
  const moved = defineWorldPack({ ...structuredClone(pack),
    cast: structuredClone(pack.cast).map((row) => (where[row.id] ? { ...row, startZoneId: where[row.id] } : row)),
    stage: { ...structuredClone(pack.stage), scenePositions: { ...structuredClone(pack.stage.scenePositions), ...where } } });
  const prompts = { [hu]: [], [wen]: [], [shou]: [] };
  const plans = { [hu]: [], [wen]: [], [shou]: [] };
  const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(moved), { worldPack: moved, pacingMode: "scene", characterIds: [hu, wen, shou],
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
  const objectBy = (label) => Object.values(coordinator.worldState.objects).find((row) => row.label === label && (row.zoneId === "shi_home__kitchen" || row.holderCharacterId));

  await beat(wen, [{ type: "take", thing: "木桶" }]);
  await beat(hu, [{ type: "take_out", thing: "阵石碎块" }, { type: "offer", thing: "木桶", to: "温先生" }]);
  assert.match(prompts[hu].at(-1), /^- offer：/mu, "with something in hand and someone beside him, he can offer a swap");
  const offer = coordinator.journal.events.filter((row) => row.publicPayload?.primitive === "exchange").at(-1).publicPayload;
  assert.equal(offer.status, "success");
  assert.equal(offer.deliveries.find((row) => row.recipientCharacterId === wen).content, "石小虎想拿手里的阵石碎块换你的木桶。");

  await beat(wen, [{ type: "deal", to: "石小虎" }]);
  assert.match(prompts[wen].at(-1), /- P\d+ 石小虎：[^\n]*，想拿阵石碎块换你的木桶/u, "the teacher sees what is on offer");
  assert.match(prompts[wen].at(-1), /^- deal：/mu);
  assert.equal(objectBy("阵石碎块").holderCharacterId, wen);
  assert.deepEqual(objectBy("阵石碎块").ownerIds, [wen], "the stone is his now");
  assert.equal(objectBy("木桶").holderCharacterId, hu);
  assert.deepEqual(objectBy("木桶").ownerIds, [shou, hu], "the bucket was the 石 family's all along");

  const checkpoint = await runtime.checkpoint();
  for (const actor of runtime.actors.values()) await actor.close?.();
  const feed = buildObserverFeed({ checkpoint, settledTurns: reconcileSettledTurnRecords(checkpoint) }, moved);
  assert.deepEqual(feed.frames.filter((row) => row.kind === "exchange" && row.status === "success").map((row) => row.caption),
    ["石小虎想拿阵石碎块换温先生的木桶。", "温先生和石小虎换了东西：木桶换阵石碎块。"]);
  const director = fs.readFileSync(new URL("../src/stage/director.js", import.meta.url), "utf8");
  assert.match(director, /EXCHANGE_NO_OFFER/u);
});
