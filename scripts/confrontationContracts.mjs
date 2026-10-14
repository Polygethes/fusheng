// Laying hands on someone is a world act, not a turn of phrase: a shove, a
// blow, a grab, settled by strength and what is in the hand, with a fixed
// draw for each attempt. The target feels it; onlookers see it, each in their
// own terms (a name they know, a stranger's look, "你"). A grabbed person
// cannot walk off until they break free; a blow can wound, fell or kill.
// Narrating a blow in a gesture is not allowed: it would happen in no world.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { confrontationOutcome, rollFor, powerOf, weaponInHand, personFor } from "../src/server/simulation/confrontation.mjs";
import { validatePerformanceOutput } from "../src/server/pipeline/characterPerformanceTurn.mjs";
import { FAILURE_LABELS } from "../src/server/simulation/settledSimulationReport.mjs";
import { loadWorldPack } from "../src/worlds/registry.mjs";
import { defineWorldPack } from "../src/worlds/worldPack.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";

const cid = (rid) => `char_cangxinggu_${rid}`;
const bao = cid("bao_dachuan"), gu = cid("gu_huaishan"), hu = cid("shi_xiaohu");
const clone = (value) => structuredClone(value);

async function square(characterIds, runStage = async () => ({})) {
  const pack = await loadWorldPack("cangxinggu");
  const here = pack.stage.scenePositions[hu];
  const moved = defineWorldPack({ ...clone(pack),
    cast: clone(pack.cast).map((row) => ([bao, gu].includes(row.id) ? { ...row, startZoneId: here } : row)),
    stage: { ...clone(pack.stage), scenePositions: { ...clone(pack.stage.scenePositions), [bao]: here, [gu]: here } } });
  const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(moved), { worldPack: moved, pacingMode: "scene", characterIds,
    enableDayPlanning: false, characterAgentCallMode: "performance", runStage });
  return { pack: moved, instance, runtime: instance.runtime, coordinator: instance.runtime.coordinator };
}

test("a town's people carry who they know and how old they look", async () => {
  const { coordinator, runtime } = await square([bao, gu, hu]);
  const people = coordinator.worldState.entities;
  assert.deepEqual(people[gu].knownActorIds, [cid("lu_qinghe")], "the newcomer knows only his wife");
  assert.ok(people[hu].knownActorIds.includes(bao) && !people[hu].knownActorIds.includes(gu));
  assert.deepEqual([people[hu].ageGroup, people[bao].ageGroup], ["child", "adult"]);
  assert.ok(Math.abs(powerOf({ ageGroup: "old", skills: [] }) - 0.6) < 1e-9, "the old are weaker");
  for (const actor of runtime.actors.values()) await actor.close?.();
});

test("who is stronger, what is in the hand, and how each onlooker names the people", async () => {
  const { coordinator, runtime } = await square([bao, gu, hu]);
  const state = coordinator.worldState;
  assert.equal(rollFor("action-attempt:x"), rollFor("action-attempt:x"), "the same attempt draws the same");
  assert.ok(rollFor("a") >= 0 && rollFor("a") < 1 && rollFor("a") !== rollFor("b"));
  assert.ok(Math.abs(powerOf(state.entities[bao]) - 1.15) < 1e-9, "a hunter's working body");
  assert.ok(Math.abs(powerOf(state.entities[hu]) - 0.4) < 1e-9, "a child");
  assert.equal(weaponInHand(state, gu), null, "the sword at his side is not in his hand");
  assert.equal(personFor(state, hu, bao), "宝大川");
  assert.equal(personFor(state, hu, gu), "浑身湿透的年轻男人", "a stranger by the first part of his look");
  assert.equal(personFor(state, gu, gu), "你");
  const blow = confrontationOutcome({ state, actorId: bao, targetId: gu, act: "strike", roll: 0.01 });
  assert.equal(blow.outcome, "hit");
  assert.ok(Math.abs(blow.health.wounds - 0.115) < 1e-9 && blow.health.state === "well", "a fist leaves a bruise");
  assert.equal(blow.tell(hu), "宝大川一拳打在了浑身湿透的年轻男人身上。");
  assert.equal(blow.tell(gu), "背着弓、一身泥水的壮汉一拳打在了你身上。");
  assert.equal(confrontationOutcome({ state, actorId: bao, targetId: gu, act: "strike", roll: 0.99 }).outcome, "missed");
  const grab = confrontationOutcome({ state, actorId: bao, targetId: gu, act: "grab", roll: 0.01 });
  assert.deepEqual([grab.outcome, grab.heldBy], ["seized", bao]);
  assert.equal(confrontationOutcome({ state, actorId: hu, targetId: bao, act: "shove", roll: 0.5 }).outcome, "stood_firm", "a child cannot shift a grown man");
  const apart = clone(state);
  apart.entities[gu] = { ...apart.entities[gu], zoneId: "street_9" };
  assert.equal(confrontationOutcome({ state: apart, actorId: bao, targetId: gu, act: "strike", roll: 0.01 }).code, "CONFRONT_TARGET_NOT_HERE", "a blow cannot reach someone down the street");
  const armed = clone(state);
  const sword = Object.values(armed.objects).find((row) => row.label === "生锈的短剑");
  armed.objects[sword.id] = { ...sword, holderCharacterId: bao, custody: { ...(sword.custody || {}), inHand: true, storageMode: "carried" }, state: { ...sword.state, sheathed: false } };
  armed.entities[gu] = { ...armed.entities[gu], health: { wounds: 0.9, woundsAtSeconds: armed.nowSeconds, state: "down", downSinceSeconds: armed.nowSeconds } };
  const killing = confrontationOutcome({ state: armed, actorId: bao, targetId: gu, act: "strike", roll: 0.5 });
  assert.deepEqual([killing.outcome, killing.health.state], ["killed", "dead"], "a blade on someone already down kills");
  for (const actor of runtime.actors.values()) await actor.close?.();
});

test("in play: a blow is settled, felt and seen; a grab holds; a gesture cannot land a blow", async () => {
  const plans = { [bao]: [], [gu]: [], [hu]: [] };
  const prompts = { [bao]: [], [gu]: [], [hu]: [] };
  const { runtime, coordinator } = await square([bao, gu, hu], async (input) => {
    const prompt = input.prompt?.user || "";
    prompts[input.characterId].push(prompt);
    const pick = (label) => prompt.split("\n").find((line) => /^- P\d+ /u.test(line) && line.includes(label))?.match(/P\d+/u)?.[0] || "";
    const act = plans[input.characterId].shift() || { type: "wait", minutes: 30 };
    return { performance: { thought: "", say: { to: "", text: "", loud: false }, gesture: "",
      do: { target: "", person: "", minutes: 0, ...act, ...(act.at ? { person: pick(act.at) } : {}) } } };
  });
  const beat = async (id, acts) => { plans[id] = acts; const before = prompts[id].length; await runtime.applyWorldEvent({ kind: "urge", toCharacterId: id, text: "动起来" });
    for (let i = 0; i < 12 && (plans[id].length || prompts[id].length === before); i += 1) if (!(await runtime.runNext())) break; };
  await beat(bao, [{ type: "strike", at: "浑身湿透的年轻男人" }]);
  assert.match(prompts[bao][0], /- strike \/ shove \/ grab：/u, "the beat offers laying hands on someone near");
  const settled = coordinator.journal.events.filter((row) => row.publicPayload?.primitive === "confront").at(-1).publicPayload;
  assert.equal(settled.status, "success");
  const effect = settled.resolvedEffects.find((row) => row.kind === "confrontation_settled");
  assert.ok(["hit", "missed"].includes(effect.outcome));
  const toHu = settled.deliveries.find((row) => row.recipientCharacterId === hu).content;
  const toGu = settled.deliveries.find((row) => row.recipientCharacterId === gu).content;
  assert.match(toHu, /^宝大川(一拳打在了|朝)浑身湿透的年轻男人/u, "石小虎 sees 宝大川 go for the stranger");
  assert.match(toGu, /^背着弓、一身泥水的壮汉(一拳打在了|朝)你/u, "the stranger feels a man he does not know");
  if (effect.outcome === "hit") assert.ok(coordinator.worldState.entities[gu].health.wounds > 0.1);

  const held = clone(coordinator.worldState);
  held.entities[gu].heldBy = bao;
  const { movementHeldBy } = await import("../src/server/simulation/confrontation.mjs");
  assert.equal(movementHeldBy(held, gu), bao, "a grabbed person is held by the one holding them");
  held.entities[bao].zoneId = "street_9";
  assert.equal(movementHeldBy(held, gu), "", "once the holder walks off, the hold is gone");
  assert.equal(FAILURE_LABELS.MOVE_HELD, "被人抓着，挣不脱");

  const table = { keys: { people: ["P1"], objects: [], zones: [], starts: [], finishes: [] } };
  const out = (gesture, act = { type: "none" }) => validatePerformanceOutput({ thought: "", say: { to: "", text: "", loud: false }, gesture, do: { target: "", person: "", minutes: 0, ...act } }, table);
  assert.ok(out("一拳砸在他脸上").some((row) => row.path === "gesture"), "a blow narrated as a gesture is refused");
  assert.ok(out("扇了对方一巴掌").some((row) => row.path === "gesture"));
  assert.deepEqual(out("攥紧了拳头"), [], "clenching a fist is still a gesture");
  assert.deepEqual(out("上下打量着对方"), [], "打量 is looking, not hitting");
  assert.ok(out("", { type: "strike", person: "" }).some((row) => row.path === "do.person"), "a blow needs someone to land on");
  for (const actor of runtime.actors.values()) await actor.close?.();
  const director = fs.readFileSync(new URL("../src/stage/director.js", import.meta.url), "utf8");
  assert.match(director, /frame\.kind === "confront"/u, "the stage shows the blow");
});
