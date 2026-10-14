// Bonds grow out of what happens. The first time someone really deals with
// you, you hold a place for them; what they then do to you leaves a mark
// (a grab breeds resentment and fear, a thing handed over leaves you owing
// them); what you feel about them is kept as a history; and you may come to
// call what is between you something else.
import test from "node:test";
import assert from "node:assert/strict";
import { growBonds, noteBonds, bondNotes, whatTheyDid, MET_LABEL, MARKS } from "../src/server/simulation/bonds.mjs";
import { loadWorldPack } from "../src/worlds/registry.mjs";
import { defineWorldPack } from "../src/worlds/worldPack.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";

const cid = (rid) => `char_cangxinggu_${rid}`;
const hu = cid("shi_xiaohu"), wen = cid("wen_xiansheng"), he = cid("he_sao");

test("meeting someone, being grabbed, being given something, having one's things taken", () => {
  const people = [{ id: "hu", name: "石小虎" }, { id: "wen", name: "温先生" }, { id: "liu", name: "柳春娘" }];
  const start = [{ toCharacterId: "liu", toCharacterName: "柳春娘", label: "邻里姐妹", love: 60 }];
  const spoke = { evidenceId: "e1", type: "speech", directed: true, sourceCharacterId: "hu", content: "何嫂你别追了！", occurredAtSeconds: 10 };
  const heard = { evidenceId: "e2", type: "speech", directed: false, sourceCharacterId: "wen", content: "……", occurredAtSeconds: 11 };
  let grown = growBonds(start, { ownerId: "he", impacts: [spoke, heard], people, nowSeconds: 12 });
  assert.equal(grown.changed, true);
  const met = grown.rows.find((row) => row.toCharacterId === "hu");
  assert.deepEqual([met.label, met.toCharacterName, met.fromCharacterId, met.resentment, met.owes, met.history], [MET_LABEL, "石小虎", "he", 0, 0, []], "spoken to, she holds a place for the boy");
  assert.equal(grown.rows.some((row) => row.toCharacterId === "wen"), false, "overhearing someone is not meeting them");
  assert.equal(grown.rows.find((row) => row.toCharacterId === "liu").label, "邻里姐妹", "an old bond is left as it was");

  const grabbed = { evidenceId: "e3", type: "confrontation", directed: true, sourceCharacterId: "hu", content: "石小虎一把揪住了你的衣襟。", occurredAtSeconds: 20 };
  const gave = { evidenceId: "e4", type: "object_handling", sourceCharacterId: "wen", content: "温先生递交木桶。", occurredAtSeconds: 30,
    semanticFrame: { objectHandling: { operation: "transfer", changesState: true, toCharacterId: "he" } } };
  const tookOthers = { evidenceId: "e5", type: "object_handling", sourceCharacterId: "wen", content: "温先生递交木桶。", occurredAtSeconds: 31,
    semanticFrame: { objectHandling: { operation: "transfer", changesState: true, toCharacterId: "liu" } } };
  const took = { evidenceId: "e6", type: "object_handling", sourceCharacterId: "hu", content: "石小虎拿起木桶。那是你家的木桶。", occurredAtSeconds: 40,
    semanticFrame: { objectHandling: { operation: "take", changesState: true, tookFromRecipient: true } } };
  grown = growBonds(grown.rows, { ownerId: "he", impacts: [spoke, grabbed, gave, tookOthers, took], people, applied: grown.applied, nowSeconds: 41 });
  const boy = grown.rows.find((row) => row.toCharacterId === "hu");
  assert.equal(boy.resentment, MARKS.laid_hands.resentment + MARKS.took_mine.resentment, "grabbed, then her bucket taken");
  assert.equal(boy.fear, MARKS.laid_hands.fear);
  assert.equal(boy.love, 0, "never below nothing");
  assert.deepEqual(boy.history.map((h) => h.text), ["石小虎一把揪住了你的衣襟。", "石小虎拿起木桶。那是你家的木桶。"]);
  const teacher = grown.rows.find((row) => row.toCharacterId === "wen");
  assert.deepEqual([teacher.label, teacher.love, teacher.owes], [MET_LABEL, MARKS.gave_me.love, 1], "a bucket handed over: she owes him");
  assert.equal(grown.rows.filter((row) => row.toCharacterId === "wen").length, 1, "one bond per person");
  assert.equal(whatTheyDid(tookOthers, "he"), null, "a thing handed to someone else is not handed to her");

  const noted = noteBonds(grown.rows, { ownerId: "he", nowSeconds: 50, notes: [
    { kind: "feeling", aboutId: "hu", aboutName: "石小虎", text: "又急又气" },
    { kind: "bond", aboutId: "hu", aboutName: "石小虎", text: "不让人省心的皮猴" },
    { kind: "belief", aboutId: "hu", aboutName: "石小虎", text: "他藏了东西" },
  ] });
  const renamed = noted.rows.find((row) => row.toCharacterId === "hu");
  assert.equal(renamed.label, "不让人省心的皮猴", "she comes to call it something else");
  assert.deepEqual(renamed.history.slice(-2).map((h) => h.text), ["你对对方：又急又气", "你觉得你们俩如今是：不让人省心的皮猴"], "feelings are kept, not overwritten");
  assert.equal(bondNotes(renamed), "你们之间最近：你对对方：又急又气；你觉得你们俩如今是：不让人省心的皮猴。");
  assert.equal(bondNotes(teacher), "你们之间最近：温先生递交木桶。你欠着对方一份人情。");
  assert.equal(bondNotes({ history: [] }), "");
});

async function play(callMode) {
  const pack = await loadWorldPack("cangxinggu");
  const where = { [hu]: "shi_home__kitchen", [wen]: "shi_home__kitchen", [he]: "shi_home__kitchen" };
  const moved = defineWorldPack({ ...structuredClone(pack),
    cast: structuredClone(pack.cast).map((row) => (where[row.id] ? { ...row, startZoneId: where[row.id] } : row)),
    stage: { ...structuredClone(pack.stage), scenePositions: { ...structuredClone(pack.stage.scenePositions), ...where } } });
  const prompts = { [hu]: [], [wen]: [], [he]: [] };
  const plans = { [hu]: [], [wen]: [], [he]: [] };
  const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(moved), { worldPack: moved, pacingMode: "scene", characterIds: [hu, wen, he],
    enableDayPlanning: false, characterAgentCallMode: callMode,
    async runStage(input) {
      const prompt = input.prompt?.user || "";
      prompts[input.characterId].push(prompt);
      const code = (prefix, label) => prompt.split("\n").find((line) => new RegExp(`^- ${prefix}\\d+ `, "u").test(line) && line.includes(label))?.match(new RegExp(`${prefix}\\d+`, "u"))?.[0] || "";
      const act = plans[input.characterId].shift() || { type: "wait", minutes: 30 };
      const inner = (act.inner || []).map((row) => ({ kind: row.kind, text: row.text, about: row.about ? code("P", row.about) : "", ref: "", sure: "" }));
      return { performance: { thought: "", say: { to: act.sayTo ? code("P", act.sayTo) : "", text: act.say || "", loud: false }, gesture: "",
        do: { target: "", person: "", minutes: 0, type: act.type, ...(act.minutes ? { minutes: act.minutes } : {}),
          ...(act.thing ? { target: code("O", act.thing) } : {}), ...(act.to ? { person: code("P", act.to) } : {}) },
        ...(callMode === "hybrid" ? { inner } : {}) } };
    } });
  const { runtime } = instance;
  const beat = async (id, acts) => { plans[id] = acts; const before = prompts[id].length; await runtime.applyWorldEvent({ kind: "urge", toCharacterId: id, text: "动起来" });
    for (let i = 0; i < 16 && (plans[id].length || prompts[id].length === before); i += 1) if (!(await runtime.runNext())) break; };
  const actorOf = (id) => [...runtime.actors.values()].find((actor) => actor.characterId === id);
  return { runtime, prompts, beat, actorOf };
}

test("in play: 何嫂 starts with no bond to the boy; he talks to her and grabs her, the teacher hands her the bucket", async () => {
  const { runtime, prompts, beat, actorOf } = await play("performance");
  const bondTo = (id) => (actorOf(he).privateState.relationshipContext || []).find((row) => row.toCharacterId === id);
  assert.equal(bondTo(hu), undefined, "at the start she holds nothing about him");

  await beat(hu, [{ type: "none", say: "何嫂，你别管我！", sayTo: "何嫂" }]);
  await beat(hu, [{ type: "grab", to: "何嫂" }]);
  await beat(wen, [{ type: "take", thing: "木桶" }, { type: "give", thing: "木桶", to: "何嫂" }]);
  await beat(he, [{ type: "wait", minutes: 1 }]);

  assert.equal(bondTo(hu).label, "打过交道的人");
  assert.ok(bondTo(hu).resentment >= 12, "the grab is held against him");
  assert.equal(bondTo(wen).owes, 1, "she owes the teacher for the bucket");
  const last = prompts[he].at(-1);
  assert.match(last, /^- 石小虎：打过交道的人。[^\n]*你们之间最近：[^\n]*石小虎[^\n]*你/mu, "her prompt names the boy and what he did");
  assert.match(last, /^- 温先生：打过交道的人。[^\n]*你欠着对方一份人情。/mu, "and that she owes the teacher");
  for (const actor of runtime.actors.values()) await actor.close?.();
});

test("in play (hybrid): 何嫂 writes down what the boy is to her now, and it stays", async () => {
  const { runtime, prompts, beat, actorOf } = await play("hybrid");
  await beat(hu, [{ type: "none", say: "何嫂，我走啦！", sayTo: "何嫂" }]);
  await beat(he, [{ type: "wait", minutes: 1, inner: [{ kind: "feeling", about: "石小虎", text: "又急又气" }, { kind: "bond", about: "石小虎", text: "不让人省心的皮猴" }] },
    { type: "wait", minutes: 1 }]);
  assert.match(prompts[he][0], /bond：/u, "she can say what someone is to her now");
  const bond = (actorOf(he).privateState.relationshipContext || []).find((row) => row.toCharacterId === hu);
  assert.equal(bond.label, "不让人省心的皮猴");
  assert.match(prompts[he].at(-1), /^- 石小虎：不让人省心的皮猴。[^\n]*又急又气/mu, "the next beat she sees it, with how she felt");
  for (const actor of runtime.actors.values()) await actor.close?.();
});
