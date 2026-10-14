// The day-schedule beat (spec §9.3): each town resident writes their own day
// in one call at the opening; the plan lands in their private life plan as
// autopilot blocks. Built-in worlds never get this beat.
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildScheduleStage, validateScheduleOutput, lowerScheduleOutput, scheduleHorizonSeconds, SCHEDULE_PHASE } from "../src/server/pipeline/characterScheduleTurn.mjs";
import { compileBlueprint } from "../src/worlds/compiler/index.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { callGeminiCharacterStage } from "../src/server/ecology/geminiCharacterStage.mjs";

// 1. Horizon: until the next 05:00, at least an hour away.
assert.equal(scheduleHorizonSeconds({ startClockSeconds: 7 * 3600, nowSeconds: 0 }), 22 * 3600);
assert.equal(scheduleHorizonSeconds({ startClockSeconds: 7 * 3600, nowSeconds: 21.5 * 3600 }), 86400 + 1800);
assert.equal(scheduleHorizonSeconds({ startClockSeconds: 5 * 3600, nowSeconds: 0 }), 86400);

// 2. The stage for one resident of the 20-person town.
const blueprint = JSON.parse(fs.readFileSync("scripts/fixtures/blueprints/big_town.json", "utf8"));
const { pack } = compileBlueprint(blueprint, { seed: 1 });
const member = pack.cast[0];
const { stageInput, table } = buildScheduleStage({ characterRecord: member,
  canonicalInput: { agentTurnId: "agent-turn:test:1", agent: { id: member.id, name: member.name, relationshipContext: [] } },
  sites: pack.stage.sites, knownSiteIds: member.knownSiteIds, work: pack.work, startClockSeconds: 7 * 3600, nowSeconds: 0 });
assert.equal(stageInput.phase, SCHEDULE_PHASE);
assert.equal(stageInput.outputKey, "schedule");
assert.ok(stageInput.prompt.system.length + stageInput.prompt.user.length <= 3000, "a schedule prompt stays short");
assert.equal(table.places[0].siteId, member.knownSiteIds[0], "S1 is the first place this person knows (home)");
assert.ok(table.jobs.every((job) => table.places.some((place) => place.siteId === job.siteId)), "only jobs at places this person knows");
const skills = new Set(member.skills);
for (const job of table.jobs) {
  const work = pack.work.find((row) => row.templateId === job.templateId);
  assert.ok((work.requiredSkillIds || []).every((id) => skills.has(id)), `${job.label} needs only skills ${member.name} has`);
}
const good = { thought: "先在家收拾，再出门。", blocks: [
  { from: "07:00", to: "08:00", place: "S1", activity: "rest", note: "在家收拾" },
  { from: "08:00", to: "10:00", place: "S2", activity: "wander", note: "出去走走" },
  { from: "20:00", to: "05:00", place: "S1", activity: "sleep", note: "回家睡觉" },
] };
assert.deepEqual(validateScheduleOutput(good, table), []);
const plan = lowerScheduleOutput(good, table, { ownerCharacterId: member.id, agentTurnId: "agent-turn:test:1" });
assert.equal(plan.ownerCharacterId, member.id);
assert.equal(plan.status, "active");
assert.equal(plan.horizonEndsAtSeconds, 22 * 3600);
assert.deepEqual(plan.steps.map((row) => [row.dueAtSeconds, row.endsAtSeconds, row.activityType, row.status, row.autopilot]),
  [[0, 3600, "rest", "planned", true], [3600, 3 * 3600, "wander", "planned", true], [13 * 3600, 22 * 3600, "sleep", "planned", true]]);
assert.equal(plan.steps[0].siteZoneId, pack.stage.sites.find((row) => row.id === member.knownSiteIds[0]).entryZoneId);
assert.ok(plan.steps.every((row) => row.sourceIds[0] === "day-schedule:agent-turn:test:1"), "the schedule beat itself is the source");

const paths = (output) => validateScheduleOutput(output, table).map((row) => row.path);
assert.ok(paths({ thought: "", blocks: good.blocks.slice(0, 2) }).includes("blocks"), "too few blocks");
assert.ok(paths({ thought: "", blocks: [good.blocks[0], { ...good.blocks[1], from: "07:30" }, good.blocks[2]] }).includes("blocks[1]"), "overlap");
assert.ok(paths({ thought: "", blocks: [{ ...good.blocks[0], place: "S99" }, good.blocks[1], good.blocks[2]] }).includes("blocks[0].place"), "unknown place");
assert.ok(paths({ thought: "", blocks: [{ ...good.blocks[0], activity: "dance" }, good.blocks[1], good.blocks[2]] }).includes("blocks[0].activity"), "unknown activity");
assert.ok(paths({ thought: "", blocks: [{ ...good.blocks[0], from: "06:00", to: "06:30" }, good.blocks[1], good.blocks[2]] }).includes("blocks[0]"), "a block before now");

// 2b. A turn often begins a few seconds into the minute. A schedule written
// for "07:00" still starts now, its steps keep their clock times, and a block
// in the minute before is still in the past.
{
  const late = buildScheduleStage({ characterRecord: member,
    canonicalInput: { agentTurnId: "agent-turn:test:2", agent: { id: member.id, name: member.name, relationshipContext: [] } },
    sites: pack.stage.sites, knownSiteIds: member.knownSiteIds, work: pack.work, startClockSeconds: 7 * 3600, nowSeconds: 20 });
  assert.match(late.stageInput.prompt.user, /现在是 07:00/u);
  assert.deepEqual(validateScheduleOutput(good, late.table), [], "a block written for this minute is not in the past");
  const latePlan = lowerScheduleOutput(good, late.table, { ownerCharacterId: member.id, agentTurnId: "agent-turn:test:2" });
  assert.deepEqual(latePlan.steps.map((row) => [row.dueAtSeconds, row.endsAtSeconds]), [[0, 3600], [3600, 3 * 3600], [13 * 3600, 22 * 3600]], "steps keep their clock times");
  assert.equal(latePlan.horizonEndsAtSeconds, 22 * 3600, "the schedule still ends at 05:00");
  const earlier = { thought: "", blocks: [{ ...good.blocks[0], from: "06:59" }, good.blocks[1], good.blocks[2]] };
  assert.ok(validateScheduleOutput(earlier, late.table).some((row) => row.path === "blocks[0]"), "the minute before is still before now");
}
if (table.jobs.length) {
  const job = table.jobs[0];
  const elsewhere = table.places.find((place) => place.siteId !== job.siteId);
  assert.ok(paths({ thought: "", blocks: [{ ...good.blocks[0], place: elsewhere.key, activity: `work:${job.key}` }, good.blocks[1], good.blocks[2]] }).includes("blocks[0].place"), "work only where the job is");
}

// 3. The running town: everyone writes a schedule at the opening, before acting.
const inputs = [];
const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(pack), {
  worldPack: pack, pacingMode: "scene", characterIds: pack.stage.sceneCast, enableDayPlanning: true, characterAgentCallMode: "performance",
  async runStage(input) {
    inputs.push(input);
    if (input.phase === SCHEDULE_PHASE) return { schedule: good };
    return { performance: { thought: "", say: { to: "", text: "", loud: false }, do: { type: "wait", target: "", person: "", minutes: 30 }, gesture: "" } };
  },
});
for (let i = 0; i < 60 && inputs.filter((row) => row.phase === SCHEDULE_PHASE).length < 20; i += 1) {
  if (!(await instance.runtime.runNext())) break;
}
const schedules = inputs.filter((row) => row.phase === SCHEDULE_PHASE);
assert.equal(new Set(schedules.map((row) => row.characterId)).size, 20, "all 20 residents wrote a schedule");
assert.ok(inputs.slice(0, 20).every((row) => row.phase === SCHEDULE_PHASE), "the schedules come before anyone acts");
for (const actor of instance.runtime.actors.values()) {
  const life = actor.privateState?.lifePlanState;
  assert.equal(life?.source, "day_schedule", `${actor.characterId} has a written schedule`);
  assert.ok(life.steps.length === 3 && life.steps.every((row) => row.autopilot === true));
}
for (const actor of instance.runtime.actors.values()) await actor.close?.();

// 4. The model client sends the schedule prompt and returns it under its own key.
let captured = null;
const fakeFetch = async (url, options) => {
  captured = JSON.parse(options.body);
  return new Response(JSON.stringify({ id: "x", model: "m", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(good) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    { status: 200, headers: { "content-type": "application/json" } });
};
const provided = await callGeminiCharacterStage(stageInput, { apiKey: "test-key-not-real", model: "gemini-3.8-flash-high", apiBaseUrl: "https://gw.example/v1", responseFormat: "json_object", fetchImpl: fakeFetch });
assert.deepEqual(provided.schedule, good);
assert.ok(captured.messages.some((row) => String(row.content).includes("你知道的地方")), "the schedule prompt is sent as written");

// 5. Town runs write schedules in every one-call mode (performance or hybrid);
// built-in worlds plan their day only in the three-call mode.
const runner = fs.readFileSync("scripts/runV27GeminiSimulation.mjs", "utf8");
assert.match(runner, /enableDayPlanning:\s*callMode === "three-call" \|\| worldPack\.meta\?\.scale === "town"/u);

console.log("Town schedule passed: one schedule per resident at the opening, validated and lowered into autopilot blocks; the model client carries it.");
