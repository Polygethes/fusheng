// P4 acceptance (spec §9.3, §9.5, §14): a 20-person town lives a whole day with
// no real model. Everyone writes a schedule at the opening and again at 05:00;
// the world walks them through it while nothing new reaches them; whoever hears
// speech gets their next beat back; the model is asked for schedules and for
// the beats that need a person — not for every step of every walk.
import assert from "node:assert/strict";
import fs from "node:fs";
import { ownPlanStepDecision, OWN_PLAN_STEP_TURN_KIND, OWN_PLAN_INTENTION_PREFIX } from "../src/server/pipeline/characterOwnPlanStep.mjs";
import { SCHEDULE_PHASE } from "../src/server/pipeline/characterScheduleTurn.mjs";
import { PERFORMANCE_PHASE } from "../src/server/pipeline/characterPerformanceTurn.mjs";
import { compileBlueprint } from "../src/worlds/compiler/index.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { buildObserverFeed } from "../src/server/observer/observerFeed.mjs";
import { reconcileSettledTurnRecords, summarizeSettledSimulation } from "../src/server/simulation/settledSimulationReport.mjs";
import { assessSimulationIntegrity } from "../src/server/simulation/simulationIntegrity.mjs";
import { TOWN_TIME_POLICY } from "../src/worlds/catalog/index.mjs";

// 0. The town clock uses the keys the runtime reads (spec §9.5).
assert.equal(TOWN_TIME_POLICY.moveSeconds, 20);
assert.equal(TOWN_TIME_POLICY.observationSeconds, 30);
assert.equal(TOWN_TIME_POLICY.listeningSeconds, 30);
assert.equal(TOWN_TIME_POLICY.speechCharactersPerSecond, 4);
assert.equal(TOWN_TIME_POLICY.speechPauseSeconds, 6);
assert.equal(TOWN_TIME_POLICY.defaultRestSeconds, 300);
assert.equal(TOWN_TIME_POLICY.reflectionMinIntervalSeconds, 1800);
assert.equal(TOWN_TIME_POLICY.ambientGesturesWake, false);
assert.equal(TOWN_TIME_POLICY.bystanderMovementWakes, false);
for (const key of ["moveSecondsPerStep", "lookSeconds", "listenSeconds", "restSeconds", "reflectionIntervalSeconds"]) {
  assert.ok(!(key in TOWN_TIME_POLICY), `${key} is not a key the runtime reads`);
}

// 1. The decision on its own: a due block is walked; evidence hands it back.
const edges = [["home__hall", "street_1"], ["street_1", "street_2"], ["street_2", "shop__front"]];
const plan = { steps: [{ planStepId: "p:1", status: "planned", autopilot: true, dueAtSeconds: 0, endsAtSeconds: 3600, siteZoneId: "shop__front", activity: { kind: "wander" } }] };
const due = { kind: "continuation_due", causeType: "plan_due", planStepRefs: [{ planStepId: "p:1" }], evidenceIds: [], evidence: [] };
const walk = ownPlanStepDecision({ wake: due, lifePlanState: plan, hereZoneId: "home__hall", zoneEdges: edges, nowSeconds: 0 });
assert.deepEqual([walk.kind, walk.nextHop], ["walk", "street_1"]);
assert.equal(ownPlanStepDecision({ wake: { ...due, evidenceIds: ["evidence:1"] }, lifePlanState: plan, hereZoneId: "home__hall", zoneEdges: edges, nowSeconds: 0 }), null);

// 2. A whole day in the 20-person town.
const blueprint = JSON.parse(fs.readFileSync("scripts/fixtures/blueprints/big_town.json", "utf8"));
const { pack } = compileBlueprint(blueprint, { seed: 1 });
const ids = pack.stage.sceneCast;
assert.equal(ids.length, 20);
const speaker = ids[0];
const inputs = [];
let spoke = false;
const silent = { to: "", text: "", loud: false };
function schedule(input) {
  const now = input.prompt.user.match(/现在是 (\d\d:\d\d)/u)?.[1] || "07:00";
  const hasPerson = /^- R1 /mu.test(input.prompt.user);
  const blocks = [
    ...(now === "05:00" ? [{ from: "05:00", to: "07:00", place: "S1", activity: "rest", note: "起床收拾" }] : []),
    { from: "07:00", to: "09:00", place: "S2", activity: input.characterId === speaker && hasPerson ? "visit:R1" : "wander", note: "出门" },
    { from: "09:00", to: "12:00", place: "S1", activity: "rest", note: "回家歇着" },
    { from: "12:00", to: "18:00", place: "S3", activity: "wander", note: "下午走走" },
    { from: "18:00", to: "20:00", place: "S1", activity: "rest", note: "吃晚饭" },
    { from: "20:00", to: "05:00", place: "S1", activity: "sleep", note: "睡觉" },
  ];
  return { thought: "照常过一天。", blocks };
}
function beat(input) {
  // The speaker says something out loud the first time anyone is around.
  if (input.characterId === speaker && !spoke) {
    if (/^- P1 /mu.test(input.prompt.user)) {
      spoke = true;
      return { thought: "跟大家打个招呼。", say: { to: "", text: "大家早！今天集上有新鲜鱼。", loud: true }, do: { type: "none", target: "", person: "", minutes: 0 }, gesture: "" };
    }
    return { thought: "等人来。", say: silent, do: { type: "wait", target: "", person: "", minutes: 5 }, gesture: "" };
  }
  return { thought: "先忙自己的。", say: silent, do: { type: "wait", target: "", person: "", minutes: 30 }, gesture: "" };
}
const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(pack), {
  worldPack: pack, pacingMode: "scene", characterIds: ids, enableDayPlanning: true, characterAgentCallMode: "performance",
  async runStage(input) {
    inputs.push({ phase: input.phase, characterId: input.characterId });
    if (input.phase === SCHEDULE_PHASE) return { schedule: schedule(input) };
    assert.equal(input.phase, PERFORMANCE_PHASE);
    return { performance: beat(input) };
  },
});
const day = await instance.runtime.runUntilWorldTime({ targetSeconds: 86400, maxTurns: 6000 });
assert.ok(day.reachedTarget, `the town reached the end of the day (now ${day.nowSeconds}s after ${day.turns.length} turns)`);
const turns = day.turns;
const own = turns.filter((row) => row.privateResult?.turnKind === OWN_PLAN_STEP_TURN_KIND);
const schedules = inputs.filter((row) => row.phase === SCHEDULE_PHASE);
const beats = inputs.filter((row) => row.phase === PERFORMANCE_PHASE);
console.log(JSON.stringify({ turns: turns.length, ownPlanSteps: own.length, schedules: schedules.length, beats: beats.length }));

// Schedules: one per resident at the opening and one at 05:00.
assert.equal(schedules.length, 40, "20 schedules at the opening and 20 at 05:00");
for (const id of ids) assert.equal(schedules.filter((row) => row.characterId === id).length, 2, `${id} wrote two schedules`);

// The model is asked for people, not for steps.
assert.ok(beats.length <= ids.length * 6, `at most six beats a resident in a quiet day (${beats.length})`);
assert.ok(own.length >= 100 && own.length >= beats.length * 2, `most of the day is the world following plans (${own.length} own steps, ${beats.length} beats)`);
for (const id of ids) {
  assert.ok(own.some((row) => row.characterId === id && row.actionAttempt?.primitive === "move"), `${id} walked their own schedule`);
}
assert.ok(own.every((row) => !String(row.actionAttempt?.payload?.utterance || "").trim()), "the world never speaks for anyone");

// Speech hands the next beat back to everyone who heard it.
assert.ok(spoke, "the speaker found someone to greet");
const speechIndex = turns.findIndex((row) => row.characterId === speaker && String(row.actionAttempt?.payload?.utterance || "").includes("新鲜鱼"));
assert.ok(speechIndex >= 0, "the greeting was settled");
const heard = [...new Set((turns[speechIndex].outcome?.deliveries || []).map((row) => row.recipientCharacterId).filter((id) => id && id !== speaker))];
assert.ok(heard.length >= 1, "someone heard the greeting");
for (const id of heard) {
  const next = turns.slice(speechIndex + 1).find((row) => row.characterId === id);
  assert.ok(next, `${id} acts again after hearing the greeting`);
  assert.notEqual(next.privateResult?.turnKind, OWN_PLAN_STEP_TURN_KIND, `${id}'s next beat is their own, not the schedule's`);
}

// Records, report and observer.
const checkpoint = await instance.runtime.checkpoint();
const records = reconcileSettledTurnRecords(checkpoint);
assert.equal(assessSimulationIntegrity({ actors: checkpoint.actors, records }), null, "a day of walking is not a stalled scene");
const summary = summarizeSettledSimulation({ checkpoint, turns: records });
assert.equal(summary.counts.ownPlanSteps, own.length);
assert.equal(summary.counts.characterDecisions, records.length - own.length);
const feed = buildObserverFeed({ checkpoint, settledTurns: records }, pack);
assert.ok(feed.frames.some((frame) => frame.type === "action" && frame.ownPlanStep === true && frame.kind === "move"), "the observer marks moves made by the schedule");
assert.ok(feed.frames.filter((frame) => frame.ownPlanStep).every((frame) => records.find((row) => row.agentTurnId === frame.agentTurnId)?.turnKind === OWN_PLAN_STEP_TURN_KIND));
for (const actor of instance.runtime.actors.values()) await actor.close?.();

console.log("Town day passed: two schedules each, the world follows them between real beats, speech hands the beat back, the observer marks schedule steps.");
