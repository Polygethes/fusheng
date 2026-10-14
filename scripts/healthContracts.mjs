// Life and death are world fact. A person in a crisis of the body — a fever,
// heatstroke, cold, thirst — or badly enough wounded collapses; lying there
// they take no decisions; if the crisis goes on they die, if it eases they
// come round. Onlookers see someone fall and lie still; only a closer look
// tells whether they still breathe. The dead act no more.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { healthStep, wound, woundsNow, bodyCrisis, observableCondition, onlookerNews, healthNews } from "../src/server/simulation/characterHealth.mjs";
import { loadWorldPack } from "../src/worlds/registry.mjs";
import { defineWorldPack } from "../src/worlds/worldPack.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { buildObserverFeed } from "../src/server/observer/observerFeed.mjs";
import { reconcileSettledTurnRecords } from "../src/server/simulation/settledSimulationReport.mjs";

test("a crisis of the body or bad wounds bring a person down; staying down in crisis kills, easing brings them round", () => {
  const fever = { illness: 0.95 };
  let step = healthStep({ health: {}, body: fever, nowSeconds: 0 });
  assert.deepEqual([step.event, step.health.state, step.health.cause], ["collapsed", "down", "fever"]);
  step = healthStep({ health: step.health, body: fever, nowSeconds: 3600 });
  assert.deepEqual([step.event, step.health.state], ["", "down"], "an hour down, still alive");
  step = healthStep({ health: step.health, body: fever, nowSeconds: 7200 });
  assert.deepEqual([step.event, step.health.state, step.health.diedAtSeconds], ["died", "dead", 7200], "two hours down in a fever kills");
  assert.deepEqual(healthStep({ health: step.health, body: {}, nowSeconds: 9000 }), { health: step.health, event: "" }, "the dead stay dead");
  const down = healthStep({ health: {}, body: fever, nowSeconds: 0 }).health;
  const better = healthStep({ health: down, body: { illness: 0.5 }, nowSeconds: 1800 });
  assert.deepEqual([better.event, better.health.state, "downSinceSeconds" in better.health], ["came_round", "hurt", false]);
  const blow = healthStep({ health: wound({}, 0.9, 0, "blow"), body: {}, nowSeconds: 0 });
  assert.deepEqual([blow.event, blow.health.state, blow.health.cause], ["collapsed", "down", "blow"]);
  assert.equal(healthStep({ health: wound(blow.health, 0.2, 60, "blow"), body: {}, nowSeconds: 60 }).event, "died", "another blow on someone down kills");
  assert.equal(healthStep({ health: wound({}, 0.4, 0), body: {}, nowSeconds: 0 }).health.state, "hurt");
  assert.equal(healthStep({ health: wound({}, 0.7, 0), body: {}, nowSeconds: 0 }).health.state, "badly_hurt");
  assert.ok(Math.abs(woundsNow(wound({}, 0.5, 0), 36000) - 0.4) < 1e-9, "wounds mend a little each hour");
  assert.deepEqual(bodyCrisis({ illness: 0.5, hypothermia: 0.95, chill: 1, thirst: 1 }), { level: 0.95, cause: "cold" });
  assert.equal(bodyCrisis({ chill: 1, wetness: 1 }).level, 0, "being cold and wet is not yet freezing to death");
});

test("how a person looks: a glance shows only stillness; a closer look tells breath from none", () => {
  assert.equal(observableCondition({ state: "down" }), "倒在地上，一动不动");
  assert.equal(observableCondition({ state: "dead" }), "倒在地上，一动不动");
  assert.equal(observableCondition({ state: "down" }, { examined: true }), "倒在地上，还有气，昏过去了");
  assert.equal(observableCondition({ state: "dead" }, { examined: true }), "倒在地上，已经没了气息");
  assert.equal(observableCondition({ state: "badly_hurt" }), "伤得很重，站都站不稳");
  assert.equal(observableCondition({ state: "hurt" }), "身上带着伤");
  assert.equal(observableCondition({ state: "hurt", cause: "blade" }), "身上带着伤");
  assert.equal(observableCondition({ state: "hurt", cause: "fever" }), "脸色发红，像在发烧", "someone come round from a fever looks feverish, not wounded");
  assert.equal(observableCondition({ state: "badly_hurt", cause: "cold" }), "冻得脸色发青，站都站不稳");
  assert.equal(observableCondition({}), "");
  assert.equal(onlookerNews("collapsed"), "有人身子一软，倒在了地上。", "onlookers are not told a name");
  assert.equal(onlookerNews("died"), "", "a death is not announced");
  assert.equal(healthNews("collapsed", "杜婆婆"), "杜婆婆身子一软，倒在了地上。");
});

test("杜婆婆 burning with fever collapses; 石小虎 sees her fall, finds her breathing, and later finds her gone", async () => {
  const pack = await loadWorldPack("cangxinggu");
  const du = "char_cangxinggu_du_popo", hu = "char_cangxinggu_shi_xiaohu";
  const room = pack.stage.scenePositions[du];
  const moved = defineWorldPack({ ...structuredClone(pack),
    cast: structuredClone(pack.cast).map((row) => (row.id === hu ? { ...row, startZoneId: room } : row)),
    stage: { ...structuredClone(pack.stage), scenePositions: { ...structuredClone(pack.stage.scenePositions), [hu]: room } } });
  const calls = { [du]: 0, [hu]: 0 };
  const prompts = [];
  let next = [];
  const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(moved), { worldPack: moved, pacingMode: "scene", characterIds: [du, hu],
    enableDayPlanning: false, characterAgentCallMode: "performance",
    async runStage(input) {
      calls[input.characterId] += 1;
      if (input.characterId === hu) prompts.push(input.prompt?.user || "");
      const key = (label) => (input.prompt?.user || "").split("\n").find((line) => /^- P\d+ /u.test(line) && line.includes(label))?.match(/P\d+/u)?.[0] || "";
      const act = next.shift() || { type: "wait", minutes: 30 };
      return { performance: { thought: "", say: { to: "", text: "", loud: false }, gesture: "", do: { target: "", person: "", minutes: 0, ...act, ...(act.look ? { type: "look", target: key(act.look) } : {}) } } };
    } });
  const { runtime } = instance;
  const { coordinator } = runtime;
  const actorOf = (id) => [...runtime.actors.values()].find((actor) => actor.characterId === id);
  actorOf(du).privateState.ecologyState.body = { ...actorOf(du).privateState.ecologyState.body, illness: 0.99 };
  const run = async (n) => { for (let i = 0; i < n; i += 1) if (!(await runtime.runNext())) break; };
  const huBeat = async (acts) => { next = acts; const before = prompts.length; await runtime.applyWorldEvent({ kind: "urge", toCharacterId: hu, text: "看看婆婆" });
    for (let i = 0; i < 10 && (next.length || prompts.length === before); i += 1) if (!(await runtime.runNext())) break; };

  await runtime.applyWorldEvent({ kind: "urge", toCharacterId: du, text: "头好沉" });
  await run(3);
  const health = () => coordinator.worldState.entities[du].health || {};
  assert.equal(health().state, "down", "she collapses");
  assert.equal(health().cause, "fever");
  assert.equal(calls[du], 0, "the body, not a decision: no model is asked");
  const fall = coordinator.journal.events.find((row) => row.publicPayload?.primitive === "body_state");
  assert.ok(fall.publicPayload.deliveries.some((row) => row.recipientCharacterId === hu && row.content === "有人身子一软，倒在了地上。"), "石小虎 sees someone fall");

  await huBeat([{ look: "杜婆婆" }, { type: "wait", minutes: 5 }]);
  assert.match(prompts.at(-2), /杜婆婆[^\n]*倒在地上，一动不动/u, "at a glance she lies still");
  assert.match(prompts.at(-1), /倒在地上，还有气，昏过去了/u, "a closer look: she still breathes");

  for (let i = 0; i < 40 && health().state !== "dead"; i += 1) await run(1);
  assert.equal(health().state, "dead", "two hours down in a fever, she dies");
  assert.ok(health().diedAtSeconds >= 7200 && health().diedAtSeconds <= 7200 + 1900);
  assert.equal(calls[du], 0, "she never decided anything");
  assert.equal(coordinator.worldState.entities[du].present, true, "her body is still there");
  const died = coordinator.journal.events.filter((row) => row.publicPayload?.primitive === "body_state").at(-1).publicPayload;
  assert.ok(!died.deliveries.some((row) => row.recipientCharacterId === hu), "a death is not announced");

  await huBeat([{ look: "杜婆婆" }, { type: "wait", minutes: 5 }]);
  assert.match(prompts.at(-1), /倒在地上，已经没了气息/u, "a closer look: she is gone");
  const beatsAfterDeath = coordinator.journal.events.filter((row) => row.actorId === du && row.occurredAtSeconds > health().diedAtSeconds).length;
  await run(10);
  assert.equal(coordinator.journal.events.filter((row) => row.actorId === du && row.occurredAtSeconds > health().diedAtSeconds).length, beatsAfterDeath, "the dead act no more");

  const checkpoint = await runtime.checkpoint();
  for (const actor of runtime.actors.values()) await actor.close?.();
  const feed = buildObserverFeed({ checkpoint, settledTurns: reconcileSettledTurnRecords(checkpoint) }, moved);
  assert.equal(feed.initial.entities[du].condition, undefined, "well people carry no condition");
  const conditions = feed.frames.map((row) => row.changes?.entities?.[du]?.condition).filter(Boolean);
  assert.deepEqual(conditions, ["down", "dead"], "the stage learns she fell and that she died");
  const director = fs.readFileSync(new URL("../src/stage/director.js", import.meta.url), "utf8");
  assert.match(director, /fallen/u, "the stage lays the fallen on the ground");
});
