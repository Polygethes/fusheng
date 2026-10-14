// Children are born of married couples who share a roof. The day a couple
// conceives is drawn once; if they are apart that day the world tries a week
// later. She knows it herself after some weeks; others see it once it shows.
// At term her labour begins and six hours later the child is born, in her
// arms — a newborn, not yet someone who decides anything. A healer at her side
// makes it easier on her. A town can start with someone already expecting;
// whether someone can bear a child is what the town says, else how they look.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { sexOf, bearingCouple, conceptionFor, conceptionAfterWedding, pregnancyAtStart, pregnancyFelt, pregnancyLook, dueLifeEvent, nextLifeBoundary, lifeEventOutcome, DAY, WEEK, LABOR_SECONDS } from "../src/server/simulation/lifeCycle.mjs";
import { validateBlueprint } from "../src/worlds/blueprint/validateBlueprint.mjs";
import { compileBlueprint } from "../src/worlds/compiler/index.mjs";
import { loadWorldPack } from "../src/worlds/registry.mjs";
import { defineWorldPack } from "../src/worlds/worldPack.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { buildObserverFeed } from "../src/server/observer/observerFeed.mjs";
import { reconcileSettledTurnRecords } from "../src/server/simulation/settledSimulationReport.mjs";

const cid = (rid) => `char_cangxinggu_${rid}`;
const chun = cid("liu_chunniang"), bao = cid("bao_dachuan"), du = cid("du_popo"), lu = cid("lu_qinghe"), gu = cid("gu_huaishan"), wen = cid("wen_xiansheng"), he = cid("he_sao");

test("a town may say who is a woman or a man and who is already expecting; only a grown woman can be", () => {
  const blueprint = JSON.parse(fs.readFileSync(new URL("../src/worlds/cangxinggu/blueprint.json", import.meta.url), "utf8"));
  const expecting = structuredClone(blueprint);
  Object.assign(expecting.residents.find((row) => row.id === "he_sao"), { sex: "female", pregnancyWeeks: 30 });
  assert.deepEqual(validateBlueprint(expecting).issues, []);
  const { pack } = compileBlueprint(expecting);
  const row = pack.cast.find((item) => item.id === he);
  assert.deepEqual([row.sex, row.pregnancyWeeks], ["female", 30]);
  assert.equal(pack.cast.find((item) => item.id === wen).sex, undefined, "nothing is added where the town says nothing");
  const wrong = structuredClone(blueprint);
  Object.assign(wrong.residents.find((item) => item.id === "gu_huaishan"), { sex: "male", pregnancyWeeks: 10 });
  Object.assign(wrong.residents.find((item) => item.id === "shi_xiaohu"), { pregnancyWeeks: 10 });
  const codes = validateBlueprint(wrong).issues.map((issue) => [issue.code, issue.path]);
  assert.deepEqual(codes.filter(([code]) => code === "RESIDENT_PREGNANCY_INVALID").length, 2, JSON.stringify(codes));
  const badSex = structuredClone(blueprint);
  badSex.residents[0].sex = "other";
  assert.ok(validateBlueprint(badSex).issues.length > 0);
});

test("who can bear a child, when a couple's child comes, and how it is felt and seen", async () => {
  const pack = await loadWorldPack("cangxinggu");
  const sexes = Object.fromEntries(pack.cast.map((row) => [row.id, sexOf(row)]));
  assert.deepEqual([sexes[gu], sexes[lu], sexes[bao], sexes[chun], sexes[he], sexes[wen], sexes[cid("shi_shoutian")]], ["male", "female", "male", "female", "female", "male", ""],
    "by the head word of how they look, else the name; an old man described only as old cannot be told");
  assert.equal(sexOf({ look: "抱着女儿的男人" }), "male");
  assert.equal(sexOf({ name: "王婶" }), "female");
  assert.equal(sexOf({ name: "陆芸", sex: "female" }), "female");
  const person = (id, sex, age, extra = {}) => ({ id, kind: "character", sex, age, placeId: "town", zoneId: "bao_yard__hall", present: true, ...extra });
  const state = { nowSeconds: 0, entities: { [chun]: person(chun, "female", 27, { spouseId: bao }), [bao]: person(bao, "male", 30, { spouseId: chun }),
    old: person("old", "female", 60), [wen]: person(wen, "male", 52), [he]: person(he, "female", 31) } };
  assert.deepEqual(bearingCouple(state, bao, chun), { motherId: chun, fatherId: bao });
  assert.equal(bearingCouple(state, "old", wen), null, "past bearing age");
  const day = conceptionFor(chun, bao, 0).atSeconds / DAY;
  assert.ok(day >= 20 && day < 140 && Number.isInteger(day));
  assert.equal(conceptionFor(chun, bao, 0).atSeconds, conceptionFor(chun, bao, 0).atSeconds, "drawn once, the same every time");
  assert.deepEqual(conceptionAfterWedding(state, wen, he, 100)?.slice(0, 2), [he, "conception"], "a wedding opens the way to a child");
  assert.deepEqual(pregnancyAtStart(40, bao), { sinceSeconds: -40 * WEEK, dueAtSeconds: 1800, fatherId: bao }, "at term, her labour is close");
  const along = (weeks) => ({ pregnancy: pregnancyAtStart(weeks) });
  assert.deepEqual([pregnancyFelt(along(3)), pregnancyFelt(along(10)), pregnancyFelt(along(37))], ["", "怀着身孕，2个月了", "快要临盆了，身子沉得很"]);
  assert.deepEqual([pregnancyLook(along(10)), pregnancyLook(along(25)), pregnancyLook(along(37))], ["", "大着肚子", "挺着大肚子，快要生了"]);
  const due = { ...state, nowSeconds: 50 * DAY, entities: { ...state.entities, [chun]: { ...state.entities[chun], conception: { atSeconds: 50 * DAY, partnerId: bao } } } };
  assert.deepEqual(dueLifeEvent(due), { kind: "conception", personId: chun });
  const together = lifeEventOutcome({ state: due, kind: "conception", personId: chun, eventId: "e" });
  assert.deepEqual(together.operations.find((row) => row.path.join(".") === `entities.${chun}.pregnancy`).value, { sinceSeconds: 50 * DAY, dueAtSeconds: 50 * DAY + 40 * WEEK, fatherId: bao });
  assert.deepEqual(together.deliveries, [], "no one knows yet, not even her");
  const apart = { ...due, entities: { ...due.entities, [bao]: { ...due.entities[bao], zoneId: "pinewood" } } };
  assert.deepEqual(lifeEventOutcome({ state: apart, kind: "conception", personId: chun, eventId: "e" }).operations,
    [{ op: "set", path: ["entities", chun, "conception"], value: { atSeconds: 50 * DAY + WEEK, partnerId: bao } }], "apart that day: a week later");
  const widowed = { ...due, entities: { ...due.entities, [bao]: { ...due.entities[bao], health: { state: "dead" } } } };
  assert.deepEqual(lifeEventOutcome({ state: widowed, kind: "conception", personId: chun, eventId: "e" }).operations, [{ op: "set", path: ["entities", chun, "conception"], value: null }]);
  assert.equal(nextLifeBoundary(state), null);
});

test("in play: 柳春娘 at term goes into labour at home with 宝大川 and 杜婆婆 beside her, and six hours later holds her child", async () => {
  const pack = await loadWorldPack("cangxinggu");
  const where = { [chun]: "bao_yard__hall", [bao]: "bao_yard__hall", [du]: "bao_yard__hall" };
  const moved = defineWorldPack({ ...structuredClone(pack),
    cast: structuredClone(pack.cast).map((row) => (where[row.id] ? { ...row, startZoneId: where[row.id], ...(row.id === chun ? { pregnancyWeeks: 40 } : {}) } : row)),
    stage: { ...structuredClone(pack.stage), scenePositions: { ...structuredClone(pack.stage.scenePositions), ...where } } });
  const ids = [chun, bao, du, lu, gu, he];
  const prompts = Object.fromEntries(ids.map((id) => [id, []]));
  const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(moved), { worldPack: moved, pacingMode: "scene", characterIds: ids,
    enableDayPlanning: false, characterAgentCallMode: "performance",
    async runStage(input) {
      prompts[input.characterId].push(input.prompt?.user || "");
      return { performance: { thought: "", say: { to: "", text: "", loud: false }, gesture: "", do: { type: "wait", target: "", person: "", minutes: 30 } } };
    } });
  const { runtime } = instance;
  const { coordinator } = runtime;
  const entity = (id) => coordinator.worldState.entities[id];
  assert.deepEqual([entity(chun).sex, entity(chun).age, entity(chun).pregnancy?.dueAtSeconds, entity(chun).pregnancy?.fatherId], ["female", 27, 1800, bao]);
  const luConception = entity(lu).conception;
  assert.equal(luConception.partnerId, gu, "the newcomers, too, may have another child one day");
  assert.ok(luConception.atSeconds >= 20 * DAY && luConception.atSeconds < 140 * DAY);
  assert.equal(entity(he).conception, undefined, "a woman with no husband has no child coming");

  const newborn = () => Object.values(coordinator.worldState.objects).find((row) => row.label === "刚出生的孩子");
  for (let i = 0; i < 400 && !newborn(); i += 1) if (!(await runtime.runNext())) break;
  const life = coordinator.journal.events.filter((row) => row.type === "world_life_event");
  assert.deepEqual(life.map((row) => row.occurredAtSeconds), [1800, 1800 + LABOR_SECONDS], "labour at term, the child six hours later");
  const labor = life[0].publicPayload;
  assert.equal(labor.deliveries.find((row) => row.recipientCharacterId === chun).content, "肚子一阵紧过一阵地疼起来——孩子要生了。");
  assert.equal(labor.deliveries.find((row) => row.recipientCharacterId === bao).content, "柳春娘捂着肚子疼得直不起腰，像是要生了。");
  assert.ok(prompts[chun].some((prompt) => /你的身子[\s\S]*肚子一阵紧过一阵，孩子就要生了/u.test(prompt)), "she feels it");
  assert.ok(prompts[bao].some((prompt) => /- P\d+ 柳春娘[^\n]*捂着肚子，正在生孩子/u.test(prompt)), "he sees it");

  const child = newborn();
  assert.deepEqual([child.holderCharacterId, child.ownerIds, child.parentIds], [chun, [chun, bao], [chun, bao]], "the child is in her arms");
  assert.equal(entity(chun).pregnancy ?? null, null);
  assert.ok(Math.abs(entity(chun).health.wounds - 0.1) < 0.01, "杜婆婆 at her side: an easier birth");
  assert.ok(entity(chun).conception.atSeconds >= 1800 + LABOR_SECONDS + 365 * DAY, "the next child not before a year is out");
  assert.equal(life[1].publicPayload.deliveries.find((row) => row.recipientCharacterId === du).content, "柳春娘生下了一个孩子，孩子哇哇地哭着。");

  const checkpoint = await runtime.checkpoint();
  for (const actor of runtime.actors.values()) await actor.close?.();
  const feed = buildObserverFeed({ checkpoint, settledTurns: reconcileSettledTurnRecords(checkpoint) }, moved);
  assert.deepEqual(feed.frames.filter((row) => row.kind === "life").map((row) => row.caption), ["柳春娘要生了。", "柳春娘生下了一个孩子。"]);
  const director = fs.readFileSync(new URL("../src/stage/director.js", import.meta.url), "utf8");
  assert.match(director, /frame\.kind === "life"/u);
  const registry = fs.readFileSync(new URL("../src/server/simulation/worldActionRegistry.mjs", import.meta.url), "utf8");
  assert.match(registry, /conceptionAfterWedding\(/u, "a wedding opens the way to a child");
});
