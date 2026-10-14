// Marriage is a fact two people make face to face: one asks, the other says
// yes. Only grown people with no living husband or wife who are not kin can
// marry. Whoever is there sees it; each spouse then holds the other as husband
// or wife in their own memory. The couples a town starts with are read from
// how its people are bound; so is kin ("祖孙"), but not friendship ("邻里姐妹").
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spousesFromRelationships, kinFromRelationships, proposalCheck, marriageOutcome, livingSpouse, rememberMarriage, PROPOSAL_STANDS_SECONDS } from "../src/server/simulation/marriage.mjs";
import { validatePerformanceOutput } from "../src/server/pipeline/characterPerformanceTurn.mjs";
import { FAILURE_LABELS } from "../src/server/simulation/settledSimulationReport.mjs";
import { loadWorldPack } from "../src/worlds/registry.mjs";
import { defineWorldPack } from "../src/worlds/worldPack.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { buildObserverFeed } from "../src/server/observer/observerFeed.mjs";
import { reconcileSettledTurnRecords } from "../src/server/simulation/settledSimulationReport.mjs";

const cid = (rid) => `char_cangxinggu_${rid}`;
const wen = cid("wen_xiansheng"), he = cid("he_sao"), lao = cid("lu_laoshi"), bao = cid("bao_dachuan"), chun = cid("liu_chunniang"), shou = cid("shi_shoutian"), hu = cid("shi_xiaohu");

test("who is married and who is kin, from how a town's people are bound", async () => {
  const pack = await loadWorldPack("cangxinggu");
  const spouses = spousesFromRelationships(pack.relationships);
  assert.equal(spouses[bao], chun);
  assert.equal(spouses[cid("lu_qinghe")], cid("gu_huaishan"));
  assert.equal(spouses[wen], undefined);
  const kin = kinFromRelationships(pack.relationships);
  assert.deepEqual(kin[shou], [hu], "grandfather and grandson");
  assert.equal(kin[he], undefined, "neighbours who are like sisters are not kin");
});

test("who may marry whom, and what each is told", () => {
  const person = (id, name, extra = {}) => ({ id, name, kind: "character", placeId: "town", zoneId: "he_home__hall", present: true, ageGroup: "adult", knownActorIds: [wen, he, lao, bao, shou, hu], ...extra });
  const state = { nowSeconds: 1000, entities: {
    [wen]: person(wen, "温先生"), [he]: person(he, "何嫂"), [lao]: person(lao, "鲁老石"),
    [bao]: person(bao, "宝大川", { spouseId: chun }), [chun]: person(chun, "柳春娘", { spouseId: bao, zoneId: "bao_yard__hall" }),
    [shou]: person(shou, "石守田", { kinIds: [hu] }), [hu]: person(hu, "石小虎", { ageGroup: "child", kinIds: [shou] }),
    stranger: person("stranger", "无名", { knownActorIds: [] }),
  } };
  assert.deepEqual(proposalCheck(state, wen, he), { ok: true });
  assert.equal(proposalCheck(state, bao, he).code, "MARRY_ALREADY_MARRIED");
  assert.equal(proposalCheck(state, wen, hu).code, "MARRY_NOT_GROWN");
  assert.equal(proposalCheck({ ...state, entities: { ...state.entities, [hu]: { ...state.entities[hu], ageGroup: "adult" } } }, shou, hu).code, "MARRY_KIN");
  assert.equal(proposalCheck(state, wen, chun).code, "MARRY_TARGET_NOT_HERE");
  const widowed = { ...state, entities: { ...state.entities, [chun]: { ...state.entities[chun], health: { state: "dead" } } } };
  assert.equal(livingSpouse(widowed, bao), "", "a widower has no living wife");
  assert.deepEqual(proposalCheck(widowed, bao, he), { ok: true }, "and may marry again");
  const asked = marriageOutcome({ state, actorId: wen, targetId: he, act: "propose" });
  assert.deepEqual([asked.ok, asked.wedding, asked.tell(he), asked.tell(lao), asked.tell("stranger")],
    [true, false, "温先生郑重地向你求亲。", "温先生郑重地向何嫂求亲。", "有人郑重地向有人求亲。"]);
  assert.deepEqual(asked.entityPatches, [[wen, "proposal", { toCharacterId: he, atSeconds: 1000 }]]);
  assert.equal(marriageOutcome({ state, actorId: he, targetId: wen, act: "accept" }).code, "MARRY_NO_PROPOSAL", "no one asked her yet");
  const askedState = { ...state, entities: { ...state.entities, [wen]: { ...state.entities[wen], proposal: { toCharacterId: he, atSeconds: 1000 } } } };
  const wed = marriageOutcome({ state: askedState, actorId: he, targetId: wen, act: "accept" });
  assert.deepEqual([wed.ok, wed.wedding, wed.tell(he), wed.tell(wen), wed.tell(lao)],
    [true, true, "你答应了温先生的求亲，从此和对方结为夫妻。", "何嫂答应了你的求亲，从此你们结为夫妻。", "何嫂答应了温先生的求亲，两人当众结为夫妻。"]);
  assert.deepEqual(wed.entityPatches.filter(([, field]) => field === "spouseId"), [[he, "spouseId", wen], [wen, "spouseId", he]]);
  const stale = { ...askedState, nowSeconds: 1000 + PROPOSAL_STANDS_SECONDS + 1 };
  assert.equal(marriageOutcome({ state: stale, actorId: he, targetId: wen, act: "accept" }).code, "MARRY_NO_PROPOSAL", "an offer does not stand forever");
  const memory = rememberMarriage([{ toCharacterId: he, toCharacterName: "何嫂", label: "邻里相识", love: 40 }], wen, { characterId: he, name: "何嫂" }, 2000);
  assert.deepEqual([memory[0].label, memory[0].formerLabel, memory[0].love], ["夫妻", "邻里相识", 40], "what they were is kept");
  assert.equal(rememberMarriage(memory, wen, { characterId: he, name: "何嫂" }, 3000), null, "remembered once");
  assert.deepEqual(rememberMarriage([], he, { characterId: wen, name: "温先生" }, 2000).map((row) => [row.toCharacterName, row.label]), [["温先生", "夫妻"]]);
  for (const code of ["MARRY_TARGET_NOT_HERE", "MARRY_TARGET_DOWN", "MARRY_NOT_GROWN", "MARRY_ALREADY_MARRIED", "MARRY_KIN", "MARRY_NO_PROPOSAL"]) assert.ok(FAILURE_LABELS[code], code);
});

test("in play: 温先生 asks 何嫂 in her weaving room, she says yes in front of 鲁老石, and each now holds the other as spouse", async () => {
  const pack = await loadWorldPack("cangxinggu");
  const where = { [wen]: "he_home__hall", [he]: "he_home__hall", [lao]: "he_home__hall", [bao]: "he_home__hall" };
  const moved = defineWorldPack({ ...structuredClone(pack),
    cast: structuredClone(pack.cast).map((row) => (where[row.id] ? { ...row, startZoneId: where[row.id] } : row)),
    stage: { ...structuredClone(pack.stage), scenePositions: { ...structuredClone(pack.stage.scenePositions), ...where } } });
  const ids = [wen, he, lao, bao];
  const plans = Object.fromEntries(ids.map((id) => [id, []]));
  const prompts = Object.fromEntries(ids.map((id) => [id, []]));
  const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(moved), { worldPack: moved, pacingMode: "scene", characterIds: ids,
    enableDayPlanning: false, characterAgentCallMode: "performance",
    async runStage(input) {
      const prompt = input.prompt?.user || "";
      prompts[input.characterId].push(prompt);
      const pick = (label) => prompt.split("\n").find((line) => /^- P\d+ /u.test(line) && line.includes(label))?.match(/P\d+/u)?.[0] || "";
      const act = plans[input.characterId].shift() || { type: "wait", minutes: 30 };
      return { performance: { thought: "", say: { to: "", text: "", loud: false }, gesture: "", do: { target: "", person: "", minutes: 0, ...act, ...(act.at ? { person: pick(act.at) } : {}) } } };
    } });
  const { runtime } = instance;
  const { coordinator } = runtime;
  const beat = async (id, acts) => { plans[id] = acts; const before = prompts[id].length; await runtime.applyWorldEvent({ kind: "urge", toCharacterId: id, text: "动起来" });
    for (let i = 0; i < 12 && (plans[id].length || prompts[id].length === before); i += 1) if (!(await runtime.runNext())) break; };
  const last = (primitive) => coordinator.journal.events.filter((row) => row.publicPayload?.primitive === primitive).at(-1).publicPayload;
  assert.equal(coordinator.worldState.entities[bao].spouseId, chun, "the town starts with its couples");
  assert.deepEqual(coordinator.worldState.entities[lao].kinIds, [], "a man with no kin in the valley");

  await beat(bao, [{ type: "propose", at: "何嫂" }]);
  assert.doesNotMatch(prompts[bao][0], /- propose：/u, "a married man is not offered to ask");
  assert.deepEqual(last("marriage").failedEffects.map((row) => row.code), ["MARRY_ALREADY_MARRIED"], "and if he asks anyway, the world refuses");

  await beat(wen, [{ type: "propose", at: "何嫂" }]);
  assert.match(prompts[wen][0], /- propose：/u);
  const asked = last("marriage");
  assert.equal(asked.status, "success");
  assert.equal(asked.deliveries.find((row) => row.recipientCharacterId === he).content, "温先生郑重地向你求亲。");
  assert.equal(asked.deliveries.find((row) => row.recipientCharacterId === lao).content, "温先生郑重地向何嫂求亲。");

  await beat(he, [{ type: "accept", at: "温先生" }]);
  assert.match(prompts[he].at(-1), /- P\d+ 温先生[^\n]*向你求过亲/u, "she sees who asked her");
  assert.match(prompts[he].at(-1), /- accept：/u);
  const wed = last("marriage");
  assert.equal(wed.status, "success");
  assert.ok(wed.resolvedEffects.some((row) => row.kind === "married"));
  assert.equal(wed.deliveries.find((row) => row.recipientCharacterId === lao).content, "何嫂答应了温先生的求亲，两人当众结为夫妻。");
  assert.deepEqual([coordinator.worldState.entities[wen].spouseId, coordinator.worldState.entities[he].spouseId], [he, wen]);
  assert.equal(coordinator.worldState.entities[wen].proposal ?? null, null, "the offer is settled");

  await beat(wen, [{ type: "wait", minutes: 5 }, { type: "wait", minutes: 5 }]);
  assert.match(prompts[wen].at(-1), /- 何嫂：夫妻。/u, "he now holds her as his wife");
  assert.doesNotMatch(prompts[wen].at(-1), /- propose：/u, "and is not offered to ask anyone else");
  const out = (act) => validatePerformanceOutput({ thought: "", say: { to: "", text: "", loud: false }, gesture: "", do: { target: "", person: "", minutes: 0, ...act } },
    { keys: { people: ["P1"], nearPeople: ["P1"], suitors: [], objects: [], zones: [], starts: [], finishes: [] } });
  assert.ok(out({ type: "accept", person: "P1" }).some((row) => row.path === "do.person"), "only someone who asked can be accepted");

  const checkpoint = await runtime.checkpoint();
  for (const actor of runtime.actors.values()) await actor.close?.();
  const feed = buildObserverFeed({ checkpoint, settledTurns: reconcileSettledTurnRecords(checkpoint) }, moved);
  const frames = feed.frames.filter((row) => row.kind === "marriage" && row.status === "success");
  assert.deepEqual(frames.map((row) => row.caption), ["温先生向何嫂求亲。", "何嫂和温先生结为夫妻。"]);
  const director = fs.readFileSync(new URL("../src/stage/director.js", import.meta.url), "utf8");
  assert.match(director, /frame\.kind === "marriage"/u);
});
