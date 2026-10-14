import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  createTavernWorldRuntimeV27,
  projectTavernV27TurnForObserver,
} from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";

const CHARACTER_ID = "char_xyy_xiezenshi";
const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});

const ordinaryStage = createTavernV27FixtureStageRunner({
  planForTurn: () => ({
    intention: "先看清此刻，再决定要不要动",
    primitive: "none",
    targetId: "",
    utterance: "",
    visibleAction: "",
    texture: [],
    privateBasis: "计划时段到了，但眼下没有必须立刻做出的公开动作。",
    continuationIntentions: [],
  }),
});
const stageCalls = [];
const runStage = async (input, options = {}) => {
  stageCalls.push({ stage: options.stage, characterId: input.characterId });
  if (options.stage !== "character_day_planning") return ordinaryStage(input, options);
  const sourceId = input.referenceContract.ownedSourceIds[0];
  assert.ok(sourceId, "the runtime must give the Character at least one genuinely owned planning source");
  const desiredZoneHandle = input.referenceContract.allowedZoneHandles[0] || "";
  return {
    dayPlan: {
      ownerAuthority: "character-agent",
      planBlocks: Array.from({ length: 5 }, (_, index) => ({
        relativeStartSeconds: index * 3_600,
        relativeEndSeconds: (index + 1) * 3_600,
        activityType: ["prepare", "serve", "rest", "maintain", "social_time"][index],
        desiredZoneHandle,
        privatePurpose: `由本人根据当前生活依据安排第 ${index + 1} 个粗时段。`,
        sourceIds: [sourceId],
      })),
    },
  };
};

const instance = createTavernWorldRuntimeV27(state, {
  characterIds: [CHARACTER_ID],
  positions: { [CHARACTER_ID]: "hall" },
  worldId: "world:xyy:tavern:v27:day-planning-runtime",
  enableDayPlanning: true,
  runStage,
});

const planningTurn = await instance.runtime.runNext();
assert.ok(planningTurn, "an enabled runtime must schedule a private day-planning opportunity without a scripted action wake");
assert.equal(planningTurn.characterId, CHARACTER_ID);
assert.equal(planningTurn.wake.causeType, "day_planning_due");
assert.equal(planningTurn.privateResult.turnKind, "day_planning");
assert.equal(planningTurn.actionAttempt, null);
assert.equal(planningTurn.outcome, null);

let checkpoint = await instance.runtime.checkpoint();
let privateState = checkpoint.actors[0].privateState;
assert.equal(privateState.lifePlanState.steps.length, 5);
assert.deepEqual(privateState.lifePlanState.steps.map((row) => row.status), [
  "planned",
  "planned",
  "planned",
  "planned",
  "planned",
]);
const publicPlanningTurn = projectTavernV27TurnForObserver(planningTurn, state.characters);
assert.equal(publicPlanningTurn.characterAgentCompleted, true);
assert.equal(publicPlanningTurn.acceptedStageCount, 1);
assert.equal(publicPlanningTurn.expectedAcceptedStageCount, 1);
assert.equal(JSON.stringify(publicPlanningTurn).includes("privatePurpose"), false);
assert.equal(JSON.stringify(publicPlanningTurn).includes("currentBodyNeeds"), false);
assert.equal(JSON.stringify(publicPlanningTurn).includes("character-private-body-need"), false);

const firstBlockTurn = await instance.runtime.runNext();
assert.ok(firstBlockTurn);
assert.equal(firstBlockTurn.wake.causeType, "plan_due");
assert.equal(firstBlockTurn.wake.planStepIds.length, 1);
assert.equal(firstBlockTurn.actionAttempt, null);
checkpoint = await instance.runtime.checkpoint();
privateState = checkpoint.actors[0].privateState;
assert.deepEqual(privateState.lifePlanState.steps.map((row) => row.status), [
  "considered",
  "planned",
  "planned",
  "planned",
  "planned",
], "one accepted thought consumes exactly one due block and preselects no action");
assert.equal(privateState.lifePlanState.steps[0].selection, null);
assert.equal(stageCalls.filter((row) => row.stage === "character_day_planning").length, 1);

const restored = createTavernWorldRuntimeV27(state, {
  characterIds: [CHARACTER_ID],
  positions: { [CHARACTER_ID]: "hall" },
  worldId: "world:xyy:tavern:v27:day-planning-runtime",
  enableDayPlanning: true,
  checkpoint,
  runStage,
});
const restoredCheckpoint = await restored.runtime.checkpoint();
assert.deepEqual(
  restoredCheckpoint.actors[0].privateState.lifePlanState,
  checkpoint.actors[0].privateState.lifePlanState,
  "checkpoint restore must retain the Character-owned day plan without silently regenerating it",
);

console.log("tavern v2.7 day-planning runtime contracts passed");
