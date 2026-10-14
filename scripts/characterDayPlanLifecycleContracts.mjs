import assert from "node:assert/strict";

import * as lifeContinuity from "../src/server/simulation/characterLifeContinuity.mjs";

const OWNER = "char:day-plan:a";
const NOW_SECONDS = 7_200;
const OWNED_SOURCE_IDS = [
  "memory:a:opening-duty",
  "belief:a:guest-rhythm",
  "desire:a:keep-order",
];

function fiveBlockSubmission() {
  return {
    ownerAuthority: "character-agent",
    planBlocks: [
      {
        relativeStartSeconds: 0,
        relativeEndSeconds: 3_600,
        activityType: "prepare",
        desiredZoneHandle: "zone:counter",
        privatePurpose: "先把自己的工作台收拾到能接待人的程度。",
        sourceIds: ["memory:a:opening-duty"],
      },
      {
        relativeStartSeconds: 3_600,
        relativeEndSeconds: 7_200,
        activityType: "serve",
        desiredZoneHandle: "zone:hall",
        privatePurpose: "留在堂前照看自己负责的早间生意。",
        sourceIds: ["belief:a:guest-rhythm"],
      },
      {
        relativeStartSeconds: 7_200,
        relativeEndSeconds: 10_800,
        activityType: "eat_and_rest",
        desiredZoneHandle: "zone:kitchen",
        privatePurpose: "趁客流变缓时照顾自己的饥饿和疲劳。",
        sourceIds: ["desire:a:keep-order"],
      },
      {
        relativeStartSeconds: 10_800,
        relativeEndSeconds: 14_400,
        activityType: "maintain",
        desiredZoneHandle: "zone:store-room",
        privatePurpose: "检查自己记得快用完的物资。",
        sourceIds: ["memory:a:opening-duty", "desire:a:keep-order"],
      },
      {
        relativeStartSeconds: 14_400,
        relativeEndSeconds: 18_000,
        activityType: "social_time",
        desiredZoneHandle: "zone:hall",
        privatePurpose: "若有余裕，再决定要不要和熟人聊一会儿。",
        sourceIds: ["belief:a:guest-rhythm"],
      },
    ],
  };
}

function expectCode(code, operation) {
  assert.throws(operation, (error) => {
    assert.equal(error?.code, code);
    return true;
  });
}

assert.equal(
  typeof lifeContinuity.settleCharacterDayPlan,
  "function",
  "the life-continuity seam must settle one Character-authored coarse day plan",
);

const settled = lifeContinuity.settleCharacterDayPlan({
  ownerCharacterId: OWNER,
  currentLifePlanState: null,
  submission: fiveBlockSubmission(),
  ownedSourceIds: OWNED_SOURCE_IDS,
  nowSeconds: NOW_SECONDS,
});

assert.equal(settled.worldChanged, false);
assert.equal(settled.lifePlanState.ownerCharacterId, OWNER);
assert.equal(settled.lifePlanState.revision, 1);
assert.equal(settled.lifePlanState.steps.length, 5);
assert.deepEqual(settled.lifePlanState.steps.map((step) => step.status), [
  "planned",
  "planned",
  "planned",
  "planned",
  "planned",
]);
assert.equal(settled.lifePlanState.steps[0].dueAtSeconds, NOW_SECONDS);
assert.equal(settled.lifePlanState.steps[4].endsAtSeconds, NOW_SECONDS + 18_000);
assert.equal(settled.lifePlanState.steps[0].selection, null);

assert.deepEqual(settled.lifePlanState.steps.map((step) => step.planStepId), [
  "character-day-plan:char:day-plan:a:anchor=7200:step:01",
  "character-day-plan:char:day-plan:a:anchor=7200:step:02",
  "character-day-plan:char:day-plan:a:anchor=7200:step:03",
  "character-day-plan:char:day-plan:a:anchor=7200:step:04",
  "character-day-plan:char:day-plan:a:anchor=7200:step:05",
], "the server, rather than the model, owns stable plan-step identities");
const repeatedInitialSettlement = lifeContinuity.settleCharacterDayPlan({
  ownerCharacterId: OWNER,
  currentLifePlanState: null,
  submission: fiveBlockSubmission(),
  ownedSourceIds: OWNED_SOURCE_IDS,
  nowSeconds: NOW_SECONDS,
});
assert.equal(repeatedInitialSettlement.lifePlanState.planId, settled.lifePlanState.planId);
assert.deepEqual(
  repeatedInitialSettlement.lifePlanState.steps.map((step) => step.planStepId),
  settled.lifePlanState.steps.map((step) => step.planStepId),
);

const revised = lifeContinuity.settleCharacterDayPlan({
  ownerCharacterId: OWNER,
  currentLifePlanState: settled.lifePlanState,
  submission: fiveBlockSubmission(),
  ownedSourceIds: OWNED_SOURCE_IDS,
  nowSeconds: NOW_SECONDS + 30,
});
assert.equal(revised.lifePlanState.planId, settled.lifePlanState.planId);
assert.equal(revised.lifePlanState.revision, 2);
assert.deepEqual(
  revised.lifePlanState.steps.map((step) => step.planStepId),
  settled.lifePlanState.steps.map((step) => step.planStepId),
  "revision changes the schedule identity without letting the model rename its steps",
);
assert.deepEqual(revised.lifePlanState.steps.map((step) => step.revision), [2, 2, 2, 2, 2]);

assert.equal(
  typeof lifeContinuity.checkpointCharacterLifePlanState,
  "function",
  "life-plan state needs an explicit checkpoint-safe clone at the same seam",
);
const checkpoint = lifeContinuity.checkpointCharacterLifePlanState(settled.lifePlanState);
assert.deepEqual(checkpoint, settled.lifePlanState);
checkpoint.steps[0].privatePurpose = "mutated checkpoint copy";
assert.notEqual(checkpoint.steps[0].privatePurpose, settled.lifePlanState.steps[0].privatePurpose);
assert.equal(
  JSON.stringify(lifeContinuity.checkpointCharacterLifePlanState(settled.lifePlanState)),
  JSON.stringify(settled.lifePlanState),
  "checkpoint round trips must preserve stable ids, revisions, and deadlines",
);

expectCode("CHARACTER_DAY_PLAN_BLOCK_COUNT_INVALID", () => lifeContinuity.settleCharacterDayPlan({
  ownerCharacterId: OWNER,
  submission: {
    ...fiveBlockSubmission(),
    planBlocks: fiveBlockSubmission().planBlocks.slice(0, 4),
  },
  ownedSourceIds: OWNED_SOURCE_IDS,
  nowSeconds: NOW_SECONDS,
}));
expectCode("CHARACTER_DAY_PLAN_BLOCK_COUNT_INVALID", () => lifeContinuity.settleCharacterDayPlan({
  ownerCharacterId: OWNER,
  submission: {
    ownerAuthority: "character-agent",
    planBlocks: Array.from({ length: 9 }, (_, index) => ({
      relativeStartSeconds: index * 600,
      relativeEndSeconds: (index + 1) * 600,
      activityType: `coarse_activity_${index + 1}`,
      desiredZoneHandle: "",
      privatePurpose: `私有粗计划块 ${index + 1}`,
      sourceIds: ["memory:a:opening-duty"],
    })),
  },
  ownedSourceIds: OWNED_SOURCE_IDS,
  nowSeconds: NOW_SECONDS,
}));

const overlapping = fiveBlockSubmission();
overlapping.planBlocks[1].relativeStartSeconds = 3_000;
expectCode("CHARACTER_DAY_PLAN_BLOCKS_OVERLAP", () => lifeContinuity.settleCharacterDayPlan({
  ownerCharacterId: OWNER,
  submission: overlapping,
  ownedSourceIds: OWNED_SOURCE_IDS,
  nowSeconds: NOW_SECONDS,
}));

const beyondOneDay = fiveBlockSubmission();
beyondOneDay.planBlocks[4].relativeEndSeconds = 86_401;
expectCode("CHARACTER_DAY_PLAN_TIME_OUT_OF_HORIZON", () => lifeContinuity.settleCharacterDayPlan({
  ownerCharacterId: OWNER,
  submission: beyondOneDay,
  ownedSourceIds: OWNED_SOURCE_IDS,
  nowSeconds: NOW_SECONDS,
}));

const backwardBlock = fiveBlockSubmission();
backwardBlock.planBlocks[2].relativeEndSeconds = backwardBlock.planBlocks[2].relativeStartSeconds;
expectCode("CHARACTER_DAY_PLAN_TIME_INVALID", () => lifeContinuity.settleCharacterDayPlan({
  ownerCharacterId: OWNER,
  submission: backwardBlock,
  ownedSourceIds: OWNED_SOURCE_IDS,
  nowSeconds: NOW_SECONDS,
}));

const stringTime = fiveBlockSubmission();
stringTime.planBlocks[0].relativeStartSeconds = "0";
expectCode("CHARACTER_DAY_PLAN_TIME_INVALID", () => lifeContinuity.settleCharacterDayPlan({
  ownerCharacterId: OWNER,
  submission: stringTime,
  ownedSourceIds: OWNED_SOURCE_IDS,
  nowSeconds: NOW_SECONDS,
}));

expectCode("CHARACTER_DAY_PLAN_HORIZON_INVALID", () => lifeContinuity.settleCharacterDayPlan({
  ownerCharacterId: OWNER,
  submission: fiveBlockSubmission(),
  ownedSourceIds: OWNED_SOURCE_IDS,
  nowSeconds: NOW_SECONDS,
  horizonSeconds: 86_401,
}));

expectCode("CHARACTER_DAY_PLAN_AUTHORITY_INVALID", () => lifeContinuity.settleCharacterDayPlan({
  ownerCharacterId: OWNER,
  submission: { ...fiveBlockSubmission(), ownerAuthority: "world-engine" },
  ownedSourceIds: OWNED_SOURCE_IDS,
  nowSeconds: NOW_SECONDS,
}));

for (const forbiddenSubmission of [
  { ...fiveBlockSubmission(), actionAttempt: { primitive: "move" } },
  { ...fiveBlockSubmission(), utterance: "我已经去过堂前。" },
  { ...fiveBlockSubmission(), literalSpeech: "替角色写出的台词" },
  { ...fiveBlockSubmission(), worldPatch: { entities: {} } },
  { ...fiveBlockSubmission(), worldResult: { zoneId: "zone:hall" } },
  { ...fiveBlockSubmission(), planId: "model-chosen-plan-id", revision: 99 },
]) {
  expectCode("CHARACTER_DAY_PLAN_FIELD_FORBIDDEN", () => lifeContinuity.settleCharacterDayPlan({
    ownerCharacterId: OWNER,
    submission: forbiddenSubmission,
    ownedSourceIds: OWNED_SOURCE_IDS,
    nowSeconds: NOW_SECONDS,
  }));
}

for (const forbiddenBlockField of ["primitive", "actionAttempt", "utterance", "worldOutcome", "ownerCharacterId"]) {
  const forbiddenBlock = fiveBlockSubmission();
  forbiddenBlock.planBlocks[0][forbiddenBlockField] = forbiddenBlockField === "primitive"
    ? "move"
    : { fabricated: true };
  expectCode("CHARACTER_DAY_PLAN_FIELD_FORBIDDEN", () => lifeContinuity.settleCharacterDayPlan({
    ownerCharacterId: OWNER,
    submission: forbiddenBlock,
    ownedSourceIds: OWNED_SOURCE_IDS,
    nowSeconds: NOW_SECONDS,
  }));
}

const foreignSource = fiveBlockSubmission();
foreignSource.planBlocks[0].sourceIds = ["memory:b:private-secret"];
const stateBeforeRejectedSubmission = JSON.stringify(settled.lifePlanState);
expectCode("CHARACTER_DAY_PLAN_SOURCE_NOT_OWNED", () => lifeContinuity.settleCharacterDayPlan({
  ownerCharacterId: OWNER,
  currentLifePlanState: settled.lifePlanState,
  submission: foreignSource,
  ownedSourceIds: OWNED_SOURCE_IDS,
  nowSeconds: NOW_SECONDS,
}));
assert.equal(JSON.stringify(settled.lifePlanState), stateBeforeRejectedSubmission);

const invalidActivity = fiveBlockSubmission();
invalidActivity.planBlocks[0].activityType = { primitive: "move" };
expectCode("CHARACTER_DAY_PLAN_BLOCK_INVALID", () => lifeContinuity.settleCharacterDayPlan({
  ownerCharacterId: OWNER,
  submission: invalidActivity,
  ownedSourceIds: OWNED_SOURCE_IDS,
  nowSeconds: NOW_SECONDS,
}));

const unknownZone = fiveBlockSubmission();
unknownZone.planBlocks[0].desiredZoneHandle = "zone:someone-elses-private-room";
expectCode("CHARACTER_DAY_PLAN_ZONE_NOT_ALLOWED", () => lifeContinuity.settleCharacterDayPlan({
  ownerCharacterId: OWNER,
  submission: unknownZone,
  ownedSourceIds: OWNED_SOURCE_IDS,
  allowedZoneHandles: ["zone:counter", "zone:hall", "zone:kitchen", "zone:store-room"],
  nowSeconds: NOW_SECONDS,
}));

const optionalZones = fiveBlockSubmission();
for (const block of optionalZones.planBlocks) block.desiredZoneHandle = "";
const withoutZoneVocabulary = lifeContinuity.settleCharacterDayPlan({
  ownerCharacterId: OWNER,
  submission: optionalZones,
  ownedSourceIds: OWNED_SOURCE_IDS,
  allowedZoneHandles: [],
  nowSeconds: NOW_SECONDS,
});
assert.deepEqual(withoutZoneVocabulary.lifePlanState.steps.map((step) => step.desiredZoneHandle), ["", "", "", "", ""]);

expectCode("CHARACTER_DAY_PLAN_OWNER_MISMATCH", () => lifeContinuity.settleCharacterDayPlan({
  ownerCharacterId: "char:day-plan:b",
  currentLifePlanState: settled.lifePlanState,
  submission: fiveBlockSubmission(),
  ownedSourceIds: OWNED_SOURCE_IDS,
  nowSeconds: NOW_SECONDS,
}));

const privateStateWithBothPlanKinds = {
  ownerCharacterId: OWNER,
  lifePlanState: settled.lifePlanState,
  ecologyState: {
    characterPsychologyV2State: {
      continuationIntentions: [{
        ownerAuthority: "character-agent",
        intentionId: "continuation:a:check-counter",
        revision: 3,
        triggerType: "elapsed_without_progress",
        intendedPrimitive: "observe",
        targetHandle: "zone:counter",
        linkedSourceIds: ["memory:a:opening-duty"],
        minimumDelaySeconds: 60,
        createdAtCharacterSeconds: NOW_SECONDS,
        privatePurpose: "一分钟后再判断柜台有没有新变化。",
        status: "active",
      }],
    },
  },
};
const mixedTimedSteps = lifeContinuity.characterOwnedTimedPlanSteps(privateStateWithBothPlanKinds);
const dayTimedSteps = mixedTimedSteps.filter((step) => step.planKind === "day-plan");
const continuationTimedStep = mixedTimedSteps.find((step) => step.planStepId === "continuation:a:check-counter");
assert.equal(dayTimedSteps.length, 5, "planned day blocks join the same private timing seam");
assert.ok(continuationTimedStep, "existing timed continuation behavior must remain present");
assert.equal(continuationTimedStep.intendedPrimitive, "observe");
assert.equal(dayTimedSteps[0].dueAtSeconds, NOW_SECONDS);
assert.equal(dayTimedSteps[0].revision, "1");
assert.equal(dayTimedSteps[0].referenceId.includes("revision=1"), true);
assert.equal(Object.hasOwn(dayTimedSteps[0], "intendedPrimitive"), false);

assert.deepEqual(
  lifeContinuity.dueCharacterOwnedPlanSteps(privateStateWithBothPlanKinds, NOW_SECONDS)
    .map((step) => step.planStepId),
  [settled.lifePlanState.steps[0].planStepId],
);
assert.equal(
  lifeContinuity.nextCharacterOwnedPlanDueAtSeconds(
    { ownerCharacterId: OWNER, lifePlanState: settled.lifePlanState },
    NOW_SECONDS,
  ),
  NOW_SECONDS,
);

const ownerProjection = lifeContinuity.projectCharacterLifeContinuityForOwner(
  privateStateWithBothPlanKinds,
  { nowSeconds: NOW_SECONDS, planStepIds: [settled.lifePlanState.steps[0].planStepId] },
);
assert.equal(ownerProjection.activePlanSteps.length, 6);
assert.deepEqual(ownerProjection.duePlanSteps.map((step) => step.planStepId), [
  settled.lifePlanState.steps[0].planStepId,
]);
assert.equal(ownerProjection.duePlanSteps[0].privatePurpose, "先把自己的工作台收拾到能接待人的程度。");
assert.equal(ownerProjection.selection, null);

assert.equal(
  typeof lifeContinuity.considerCharacterDayPlanStep,
  "function",
  "one due block needs a private consume-one consideration interface",
);
const selectedDueStepId = settled.lifePlanState.steps[1].planStepId;
const considered = lifeContinuity.considerCharacterDayPlanStep({
  ownerCharacterId: OWNER,
  lifePlanState: settled.lifePlanState,
  planStepId: selectedDueStepId,
  nowSeconds: NOW_SECONDS + 9_000,
});
assert.equal(considered.worldChanged, false);
assert.equal(considered.consideration.planStepId, selectedDueStepId);
assert.equal(considered.consideration.selection, null);
assert.equal(considered.consideration.activityType, "serve");
assert.deepEqual(considered.lifePlanState.steps.map((step) => step.status), [
  "planned",
  "considered",
  "planned",
  "planned",
  "planned",
], "one thought consumes only the explicitly referenced due block");
assert.deepEqual(settled.lifePlanState.steps.map((step) => step.status), [
  "planned",
  "planned",
  "planned",
  "planned",
  "planned",
], "consideration must not mutate the checkpoint/input state");
const considerationText = JSON.stringify(considered);
for (const forbidden of ["primitive", "actionAttempt", "utterance", "worldOutcome", "selectedAction"]) {
  assert.equal(considerationText.includes(forbidden), false, `consideration must not preselect ${forbidden}`);
}
assert.deepEqual(
  lifeContinuity.characterOwnedTimedPlanSteps({
    ownerCharacterId: OWNER,
    lifePlanState: considered.lifePlanState,
  }).map((step) => step.planStepId),
  [
    settled.lifePlanState.steps[0].planStepId,
    settled.lifePlanState.steps[2].planStepId,
    settled.lifePlanState.steps[3].planStepId,
    settled.lifePlanState.steps[4].planStepId,
  ],
  "a consumed block no longer remains schedulable while untouched planned blocks do",
);

expectCode("CHARACTER_DAY_PLAN_STEP_ALREADY_CONSIDERED", () => lifeContinuity.considerCharacterDayPlanStep({
  ownerCharacterId: OWNER,
  lifePlanState: considered.lifePlanState,
  planStepId: selectedDueStepId,
  nowSeconds: NOW_SECONDS + 9_001,
}));
expectCode("CHARACTER_DAY_PLAN_STEP_NOT_DUE", () => lifeContinuity.considerCharacterDayPlanStep({
  ownerCharacterId: OWNER,
  lifePlanState: settled.lifePlanState,
  planStepId: settled.lifePlanState.steps[4].planStepId,
  nowSeconds: NOW_SECONDS + 9_000,
}));
expectCode("CHARACTER_DAY_PLAN_STEP_UNKNOWN", () => lifeContinuity.considerCharacterDayPlanStep({
  ownerCharacterId: OWNER,
  lifePlanState: settled.lifePlanState,
  planStepId: "character-day-plan:unknown:step:99",
  nowSeconds: NOW_SECONDS + 9_000,
}));

console.log("character day plan lifecycle contracts passed");
