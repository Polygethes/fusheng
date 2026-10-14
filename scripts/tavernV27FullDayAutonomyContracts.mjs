import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  createTavernWorldRuntimeV27,
  projectTavernWorldRuntimeV27ForObserver,
} from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { createTavernV27DeterministicLifeStageRunner } from "../src/server/pipeline/tavernV27DeterministicLifeStage.mjs";
import { auditCharacterLongHorizonContinuity } from "../src/server/evaluation/characterLongHorizonContinuity.mjs";

const CHARACTER_IDS = [
  "char_xyy_xiezenshi",
  "char_xyy_luozhao",
  "char_xyy_zhoumin",
];
const HORIZON_SECONDS = 86_400;
const CADENCE_SECONDS = 21_600;

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
const stageCalls = [];
const lifeStage = createTavernV27DeterministicLifeStageRunner({
  horizonSeconds: HORIZON_SECONDS,
  cadenceSeconds: CADENCE_SECONDS,
});
const instance = createTavernWorldRuntimeV27(state, {
  characterIds: CHARACTER_IDS,
  positions: Object.fromEntries(CHARACTER_IDS.map((id) => [id, "hall"])),
  worldId: "world:xyy:tavern:v27:full-day-autonomy",
  enableDayPlanning: true,
  runStage: async (input, options) => {
    stageCalls.push({
      characterId: input.characterId,
      agentTurnId: input.agentTurnId,
      phase: input.phase,
      stage: options.stage,
      requestedOutput: input.requestedOutput,
    });
    return lifeStage(input, options);
  },
});
const initialCheckpoint = await instance.runtime.checkpoint();
const initialBodyByCharacterId = Object.fromEntries(initialCheckpoint.actors.map((actor) => [
  actor.characterId,
  structuredClone(actor.privateState.ecologyState.body),
]));

const horizonRun = await instance.runtime.runUntilWorldTime({
  targetSeconds: HORIZON_SECONDS,
  maxTurns: 240,
});
const turns = horizonRun.turns;
const checkpoint = await instance.runtime.checkpoint();
const observer = projectTavernWorldRuntimeV27ForObserver(instance, turns);
const audit = auditCharacterLongHorizonContinuity({
  requiredCharacterIds: CHARACTER_IDS,
  turns,
  checkpoint,
  publicWorld: observer,
  policy: {
    minTurnsPerCharacter: 5,
    requireAutonomousWake: true,
    maxConsecutiveSameAction: 2,
    minimumCoveredWorldSeconds: HORIZON_SECONDS,
    requireQuiescentEnd: false, // A time boundary preserves due wakes for the next run.
    endedByTurnLimit: horizonRun.endedByTurnLimit,
  },
});

assert.ok(turns.length < 240, "the full day must quiesce instead of exhausting the safety cap");
assert.equal(horizonRun.reachedTarget, true, "the horizon runner must report that the requested day boundary was reached");
assert.equal(horizonRun.endedByTurnLimit, false, "a safety cap is not a successful day ending");
assert.ok(observer.nowSeconds >= HORIZON_SECONDS, "private schedules must carry the quiet world through one complete day");
assert.deepEqual(observer.readyQueue, checkpoint.readyQueue, "a time boundary preserves its pending queue");
assert.ok(checkpoint.actors.every(actor => !actor.pendingTurn && !actor.inFlightWake), "the time boundary must not leave a half-executed Character turn");
assert.equal(audit.valid, true, JSON.stringify(audit.issues, null, 2));
const planWakeCountByCharacter = Object.fromEntries(CHARACTER_IDS.map((id) => [id, 0]));
for (const turn of turns) {
  if ((turn.wake?.causeType || turn.wake?.kind) === "plan_due") {
    planWakeCountByCharacter[turn.characterId] += 1;
  }
}
assert.ok(
  Object.values(planWakeCountByCharacter).every((count) => count >= 6)
    && Object.values(planWakeCountByCharacter).reduce((sum, count) => sum + count, 0) >= CHARACTER_IDS.length * 6,
  `each Character must receive repeated owned plan opportunities: ${JSON.stringify(planWakeCountByCharacter)}`,
);
assert.ok(audit.metrics.externalWakeCount > 0, "embodied acts and speech must create real recipient reactions");
assert.ok(audit.metrics.causalResponseCount > 0, "at least one participant-owned question/answer pair must retain its parent thread");
assert.ok(audit.metrics.reflectionWakeCount > 0, "the lived day must include private reflection, not only scheduled acts");

const actionTurns = turns.filter((turn) => turn.actionAttempt);
const primitives = new Set(actionTurns.map((turn) => turn.actionAttempt.primitive));
assert.ok(primitives.has("speak"), "the day must contain participant-owned dialogue");
assert.ok(primitives.has("move"), "the day must contain embodied movement");
assert.ok(primitives.has("rest") || primitives.has("practice"), "the day must contain ordinary non-dialogue activity");
assert.ok(primitives.size >= 3, `the day needs varied behavior, got ${[...primitives].join(", ")}`);

const firstTurns = turns.slice(0, CHARACTER_IDS.length);
assert.ok(firstTurns.every((turn) => (
  turn.wake.causeType === "day_planning_due"
  && turn.privateResult.turnKind === "day_planning"
  && turn.actionAttempt === null
  && turn.outcome === null
)), "the opening privately drafts each Character's coarse day without injecting a scripted first action");
assert.ok(stageCalls.length > turns.length, "all public acts must still pass through the Character Agent stages");
assert.ok(stageCalls.every((row) => row.characterId && row.agentTurnId && row.stage));

for (const actor of checkpoint.actors) {
  const activePlans = actor.privateState.ecologyState?.characterPsychologyV2State?.continuationIntentions || [];
  assert.equal(activePlans.length, 0, `${actor.characterId} must end the horizon without a hidden overdue loop`);
  assert.equal(actor.privateState.lifePlanState.steps.length, 6);
  assert.ok(
    actor.privateState.lifePlanState.steps.every((row) => row.status === "considered" && row.selection === null),
    `${actor.characterId} must consider each own day block once without a preselected action`,
  );
  assert.ok(
    actor.privateState.physiologyState.lastWorldSyncSeconds >= 79_200,
    `${actor.characterId} must carry wall-clock physiology through the lived day`,
  );
  assert.ok(actor.privateState.ecologyState.elapsedSeconds >= 79_200);
  assert.notDeepEqual(
    actor.privateState.ecologyState.body,
    initialBodyByCharacterId[actor.characterId],
    `${actor.characterId}'s body may not remain frozen while the world lives through a day`,
  );
  assert.equal(actor.privateState.ecologyState.body.energy, actor.privateState.ecologyState.body.stamina);
  assert.equal(actor.privateState.ecologyState.body.exertion, actor.privateState.ecologyState.body.fatigue);
}
assert.equal(JSON.stringify(observer).includes("privatePurpose"), false);
assert.equal(JSON.stringify(observer).includes("reflectionState"), false);

console.log(JSON.stringify({
  status: "all-passed",
  gate: "tavern-v27-full-day-autonomy",
  horizonSeconds: observer.nowSeconds,
  turns: turns.length,
  actions: actionTurns.length,
  primitives: [...primitives].sort(),
  planWakes: audit.metrics.planWakeCount,
  reflectionWakes: audit.metrics.reflectionWakeCount,
  causalResponses: audit.metrics.causalResponseCount,
}, null, 2));
