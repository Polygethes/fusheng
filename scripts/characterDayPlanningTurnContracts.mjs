import assert from "node:assert/strict";

import {
  tavernCharacterAgentV2OutputSchemaForStage,
  tavernCharacterAgentV2SystemPrompt,
} from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import { runCharacterDayPlanningTurn } from "../src/server/simulation/characterDayPlanningTurn.mjs";

const OWNER = "char:day-plan:owner";
const OTHER = "char:day-plan:other";
const MEMORY_ID = "episode:day-plan:opened-shop";
const BELIEF_ID = "belief:day-plan:quiet-mornings";
const SELF_CLAIM_ID = "self-claim:day-plan:steady-worker";
const DUTY_ID = "duty:day-plan:serve-breakfast";
const COMMITMENT_ID = "commitment:day-plan:return-book";
const ACTIVITY_ID = "activity:day-plan:sweeping";
const HOME_ZONE = "zone:day-plan:home";
const WORK_ZONE = "zone:day-plan:tavern";
const PRIVATE_SECRET = "这段未投影的私人状态绝不能进入日计划 stage。";
const OTHER_SECRET = "另一个人物的记忆绝不能进入日计划 stage。";
const REJECTED_PRIVATE_PLAN = "被拒绝的私有计划正文绝不能进入修正反馈。";
const ECOLOGY_SECRET = "完整生态状态绝不能进入日计划 stage。";

function privateState({ body = {} } = {}) {
  return {
    ownerCharacterId: OWNER,
    memoryContext: {
      ownerCharacterId: OWNER,
      episodes: [{
        id: MEMORY_ID,
        ownerCharacterId: OWNER,
        perception: { content: "清晨开门时，店里通常安静。" },
        importance: 0.65,
      }],
      beliefs: [{
        id: BELIEF_ID,
        ownerCharacterId: OWNER,
        proposition: "清晨先备好热水，之后会从容些。",
        confidence: 0.78,
      }],
      selfNarrative: {
        currentClaims: [{
          id: SELF_CLAIM_ID,
          ownerCharacterId: OWNER,
          claim: "我是会把答应的日常小事做稳的人。",
          confidence: 0.82,
        }],
        pendingCandidates: [],
        versions: [],
      },
    },
    currentResponsibilities: {
      ownerCharacterId: OWNER,
      acceptedRoleIds: ["household_worker"],
      activeDutyContracts: [{
        id: DUTY_ID,
        ownerCharacterId: OWNER,
        description: "早饭时照看堂前。",
      }],
      selection: null,
    },
    ownCommitments: [{
      id: COMMITMENT_ID,
      ownerCharacterId: OWNER,
      description: "日落前把借来的书放回家中。",
    }],
    currentActivities: [{
      id: ACTIVITY_ID,
      ownerCharacterId: OWNER,
      activityType: "sweeping",
      description: "正在扫门前。",
    }],
    ecologyState: {
      elapsedSeconds: 9_999,
      body: {
        hunger: 0.18,
        thirst: 0.26,
        fatigue: 0.34,
        pain: 0.08,
        stamina: 0.72,
        ...body,
      },
      forbiddenEcologyDetail: ECOLOGY_SECRET,
      anotherCharacterBody: { ownerCharacterId: OTHER, hunger: 0.99 },
    },
    privateSecret: PRIVATE_SECRET,
    otherCharacterPrivateState: {
      ownerCharacterId: OTHER,
      memoryContext: {
        ownerCharacterId: OTHER,
        episodes: [{ id: "episode:day-plan:other", content: OTHER_SECRET }],
      },
    },
  };
}

function lawfulSubmission() {
  return {
    ownerAuthority: "character-agent",
    planBlocks: [
      {
        relativeStartSeconds: 0,
        relativeEndSeconds: 21_600,
        activityType: "sleep",
        desiredZoneHandle: HOME_ZONE,
        privatePurpose: "先休息够，天亮后才有精神。",
        sourceIds: [SELF_CLAIM_ID],
      },
      {
        relativeStartSeconds: 21_600,
        relativeEndSeconds: 28_800,
        activityType: "morning_routine",
        desiredZoneHandle: HOME_ZONE,
        privatePurpose: "收拾好自己，再去照看堂前。",
        sourceIds: [BELIEF_ID],
      },
      {
        relativeStartSeconds: 28_800,
        relativeEndSeconds: 50_400,
        activityType: "work_shift",
        desiredZoneHandle: WORK_ZONE,
        privatePurpose: "把早饭和午间的堂前照料稳妥。",
        sourceIds: [DUTY_ID, MEMORY_ID],
      },
      {
        relativeStartSeconds: 50_400,
        relativeEndSeconds: 64_800,
        activityType: "personal_time",
        desiredZoneHandle: WORK_ZONE,
        privatePurpose: "忙过午间后缓一缓，也把手边清扫收尾。",
        sourceIds: [ACTIVITY_ID],
      },
      {
        relativeStartSeconds: 64_800,
        relativeEndSeconds: 86_400,
        activityType: "evening_home",
        desiredZoneHandle: HOME_ZONE,
        privatePurpose: "日落前归还借书，再安静度过夜里。",
        sourceIds: [COMMITMENT_ID],
      },
    ],
  };
}

// Tracer bullet: one Character privately drafts a 24-hour rough plan without
// performing an action, speaking, or changing the public world.
{
  const before = privateState();
  const original = structuredClone(before);
  const stageCalls = [];
  const result = await runCharacterDayPlanningTurn({
    ownerCharacterId: OWNER,
    agentTurnId: "agent-turn:day-plan:1",
    privateState: before,
    nowSeconds: 1_000,
    availableZoneHandles: [HOME_ZONE, WORK_ZONE],
    async runStage(input, options) {
      stageCalls.push({ input: structuredClone(input), options: structuredClone(options) });
      return { dayPlan: lawfulSubmission() };
    },
  });

  assert.equal(stageCalls.length, 1, "one day-planning turn must call one provider stage");
  assert.equal(stageCalls[0].options.stage, "character_day_planning");
  assert.equal(stageCalls[0].input.phase, "awaiting_character_day_planning");
  assert.equal(stageCalls[0].input.ownerCharacterId, OWNER);
  assert.equal(stageCalls[0].input.horizon.durationSeconds, 86_400);
  assert.equal(stageCalls[0].input.horizon.startAtSeconds, 1_000);
  assert.equal(stageCalls[0].input.horizon.endAtSeconds, 87_400);
  assert.deepEqual(
    Object.keys(stageCalls[0].input.privateContext).sort(),
    ["commitments", "currentActivities", "currentBodyNeeds", "memoryAndBeliefs", "responsibilities", "selfNarrative"],
    "the stage receives only the agreed private planning projections",
  );
  assert.deepEqual(stageCalls[0].input.referenceContract.allowedZoneHandles, [HOME_ZONE, WORK_ZONE]);
  assert.ok(stageCalls[0].input.referenceContract.ownedSourceIds.includes(MEMORY_ID));
  assert.ok(stageCalls[0].input.referenceContract.ownedSourceIds.includes(DUTY_ID));
  assert.ok(stageCalls[0].input.referenceContract.ownedSourceIds.includes(COMMITMENT_ID));
  assert.ok(stageCalls[0].input.referenceContract.ownedSourceIds.includes(ACTIVITY_ID));

  const projected = JSON.stringify(stageCalls[0].input);
  assert.equal(projected.includes(PRIVATE_SECRET), false);
  assert.equal(projected.includes(OTHER_SECRET), false);
  assert.equal(projected.includes(ECOLOGY_SECRET), false);
  assert.equal(projected.includes("forbiddenEcologyDetail"), false);
  assert.equal(projected.includes("anotherCharacterBody"), false);
  assert.equal(projected.includes("worldProjection"), false);
  assert.equal(projected.includes("actionAttempt"), false);
  assert.equal(projected.includes("literalSpeech"), false);

  assert.equal(result.privateStatePatch.lifePlanState.ownerCharacterId, OWNER);
  assert.equal(result.privateStatePatch.lifePlanState.steps.length, 5);
  assert.equal(result.actionAttempt, null);
  assert.equal(result.worldChanged, false);
  assert.deepEqual(before, original, "the turn returns a private patch without mutating current state");
}

// Current physiology is projected as bounded owner-private evidence, not as a
// copied ecology state or a scheduler-owned meal/rest recommendation. Changing
// only body values changes only this projection while its stable handles remain
// available as lawful plan sources.
{
  const inputs = [];
  const bodies = [
    { hunger: 0.1, thirst: 0.2, fatigue: 0.3, pain: 0.05, stamina: 0.9 },
    { hunger: 0.85, thirst: 0.75, fatigue: 0.8, pain: 0.6, stamina: 0.2 },
  ];
  for (const [index, body] of bodies.entries()) {
    await runCharacterDayPlanningTurn({
      ownerCharacterId: OWNER,
      agentTurnId: `agent-turn:day-plan:body:${index + 1}`,
      privateState: privateState({ body }),
      nowSeconds: 1_250,
      availableZoneHandles: [HOME_ZONE, WORK_ZONE],
      async runStage(input) {
        inputs.push(structuredClone(input));
        const dayPlan = lawfulSubmission();
        dayPlan.planBlocks[0].sourceIds = [input.privateContext.currentBodyNeeds.hunger.sourceHandle];
        return { dayPlan };
      },
    });
  }

  const firstNeeds = inputs[0].privateContext.currentBodyNeeds;
  const secondNeeds = inputs[1].privateContext.currentBodyNeeds;
  assert.notDeepEqual(firstNeeds, secondNeeds);
  assert.deepEqual(Object.keys(firstNeeds).sort(), [
    "authority", "fatigue", "hunger", "ownerCharacterId", "pain", "stamina", "thirst",
  ]);
  for (const metric of ["hunger", "thirst", "fatigue", "pain", "stamina"]) {
    assert.deepEqual(Object.keys(firstNeeds[metric]).sort(), ["band", "sourceHandle", "value"]);
    assert.ok(firstNeeds[metric].value >= 0 && firstNeeds[metric].value <= 1);
    assert.equal(firstNeeds[metric].sourceHandle, secondNeeds[metric].sourceHandle,
      "body-need source handles must remain stable when only values change");
    assert.ok(inputs[0].referenceContract.ownedSourceIds.includes(firstNeeds[metric].sourceHandle));
    assert.ok(inputs[0].submissionContract.allowedSourceIds.includes(firstNeeds[metric].sourceHandle));
  }
  const withoutBodyProjection = (input) => {
    const copy = structuredClone(input);
    delete copy.privateContext.currentBodyNeeds;
    copy.agentTurnId = "";
    return copy;
  };
  assert.deepEqual(withoutBodyProjection(inputs[0]), withoutBodyProjection(inputs[1]),
    "changing only private body values must not alter other planning inputs");
  const bodyProjectionText = JSON.stringify(firstNeeds);
  assert.equal(bodyProjectionText.includes(ECOLOGY_SECRET), false);
  assert.equal(bodyProjectionText.includes("elapsedSeconds"), false);
  assert.equal(bodyProjectionText.includes("meal"), false);
  assert.equal(bodyProjectionText.includes("rest"), false);
  assert.equal(bodyProjectionText.includes("schedule"), false);
}

// One semantic protocol rejection may be returned to the same Character and
// same maintenance stage as a metadata-only rewrite request. Both invocations
// remain visible to accounting while only the final one is accepted.
{
  const before = privateState();
  const stageCalls = [];
  const accepted = [];
  const rejected = [];
  const result = await runCharacterDayPlanningTurn({
    ownerCharacterId: OWNER,
    agentTurnId: "agent-turn:day-plan:repair",
    privateState: before,
    nowSeconds: 1_500,
    availableZoneHandles: [HOME_ZONE, WORK_ZONE],
    maxStageProtocolRepairs: 1,
    onStageAccepted(event) {
      accepted.push(structuredClone(event));
    },
    onStageRejected(event) {
      rejected.push(structuredClone(event));
    },
    async runStage(input, options) {
      stageCalls.push({ input: structuredClone(input), options: structuredClone(options) });
      if (stageCalls.length === 1) {
        const dayPlan = lawfulSubmission();
        dayPlan.planBlocks[0].privatePurpose = REJECTED_PRIVATE_PLAN;
        dayPlan.literalSpeech = REJECTED_PRIVATE_PLAN;
        return { dayPlan, stage: { responseId: "response:day-plan:rejected" } };
      }
      return {
        dayPlan: lawfulSubmission(),
        stage: { responseId: "response:day-plan:accepted" },
      };
    },
  });

  assert.equal(stageCalls.length, 2);
  assert.equal(stageCalls[0].input.protocolRepairFeedback, undefined);
  assert.equal(stageCalls[0].options.protocolRepairAttempt, 0);
  assert.equal(stageCalls[1].options.protocolRepairAttempt, 1);
  const feedback = stageCalls[1].input.protocolRepairFeedback;
  assert.equal(feedback.operation, "same-character-same-stage-rewrite");
  assert.equal(feedback.stage, "character_day_planning");
  assert.match(tavernCharacterAgentV2SystemPrompt(stageCalls[1].input), /上一份同阶段输出没有被协议接受/u);
  assert.deepEqual(Object.keys(feedback.violations[0]).sort(), ["code", "message", "path"]);
  assert.equal(JSON.stringify(feedback).includes(REJECTED_PRIVATE_PLAN), false);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].repairAttempt, 1);
  assert.deepEqual(Object.keys(rejected[0].issues[0]).sort(), ["code", "message", "path"]);
  assert.equal(accepted.length, 1);
  assert.equal(result.stages.length, 2);
  assert.equal(result.protocolRepairCount, 1);
  assert.equal(result.privateStatePatch.lifePlanState.steps.length, 5);
}

// The repair budget is a hard per-stage ceiling even if a caller supplies a
// larger number: one initial attempt plus at most two rewrites.
{
  let stageCallCount = 0;
  await assert.rejects(
    runCharacterDayPlanningTurn({
      ownerCharacterId: OWNER,
      agentTurnId: "agent-turn:day-plan:repair-ceiling",
      privateState: privateState(),
      availableZoneHandles: [HOME_ZONE, WORK_ZONE],
      maxStageProtocolRepairs: 99,
      async runStage() {
        stageCallCount += 1;
        const dayPlan = lawfulSubmission();
        dayPlan.worldPatch = { secret: REJECTED_PRIVATE_PLAN };
        return { dayPlan };
      },
    }),
    (error) => (
      error?.code === "CHARACTER_DAY_PLAN_FIELD_FORBIDDEN"
      && error?.protocolRepairAttempts === 2
    ),
  );
  assert.equal(stageCallCount, 3);
}

// A source id the Character does not own is rejected after one stage call and
// cannot partially install a plan.
{
  const before = privateState();
  const original = structuredClone(before);
  let stageCallCount = 0;
  await assert.rejects(
    runCharacterDayPlanningTurn({
      ownerCharacterId: OWNER,
      privateState: before,
      nowSeconds: 2_000,
      availableZoneHandles: [HOME_ZONE, WORK_ZONE],
      async runStage() {
        stageCallCount += 1;
        const submission = lawfulSubmission();
        submission.planBlocks[0].sourceIds = ["episode:day-plan:forged"];
        return { dayPlan: submission };
      },
    }),
    (error) => error?.code === "CHARACTER_DAY_PLAN_SOURCE_NOT_OWNED",
  );
  assert.equal(stageCallCount, 1);
  assert.deepEqual(before, original);
}

// Spatial references are bounded to handles made available to this private
// planning opportunity.
{
  const before = privateState();
  await assert.rejects(
    runCharacterDayPlanningTurn({
      ownerCharacterId: OWNER,
      privateState: before,
      nowSeconds: 3_000,
      availableZoneHandles: [HOME_ZONE, WORK_ZONE],
      async runStage() {
        const submission = lawfulSubmission();
        submission.planBlocks[2].desiredZoneHandle = "zone:day-plan:guessed";
        return { dayPlan: submission };
      },
    }),
    (error) => error?.code === "CHARACTER_DAY_PLAN_ZONE_NOT_ALLOWED",
  );
}

// Neither top-level nor block-level model fields can smuggle action, speech,
// or world authority through the private life-plan patch.
for (const [field, payload, placement] of [
  ["actionAttempt", { primitive: "move" }, "top"],
  ["worldPatch", { weather: "rain" }, "top"],
  ["literalSpeech", "这句话不应被说出口。", "block"],
]) {
  const before = privateState();
  const original = structuredClone(before);
  await assert.rejects(
    runCharacterDayPlanningTurn({
      ownerCharacterId: OWNER,
      privateState: before,
      nowSeconds: 4_000,
      availableZoneHandles: [HOME_ZONE, WORK_ZONE],
      async runStage() {
        const submission = lawfulSubmission();
        if (placement === "top") submission[field] = payload;
        else submission.planBlocks[0][field] = payload;
        return { dayPlan: submission };
      },
    }),
    (error) => error?.code === "CHARACTER_DAY_PLAN_FIELD_FORBIDDEN",
  );
  assert.deepEqual(before, original, `${field} must not mutate private state`);
}

// Another Character's claimed private rows fail before the provider is called.
{
  const before = privateState();
  before.memoryContext.episodes[0].ownerCharacterId = OTHER;
  let stageCallCount = 0;
  await assert.rejects(
    runCharacterDayPlanningTurn({
      ownerCharacterId: OWNER,
      privateState: before,
      availableZoneHandles: [HOME_ZONE, WORK_ZONE],
      async runStage() {
        stageCallCount += 1;
        return { dayPlan: lawfulSubmission() };
      },
    }),
    (error) => error?.code === "CHARACTER_DAY_PLANNING_OWNER_MISMATCH",
  );
  assert.equal(stageCallCount, 0);
}

// The provider contract binds every private source and spatial reference to
// the exact projection available to this Character for this planning turn.
{
  const stageInput = {
    phase: "awaiting_character_day_planning",
    horizon: {
      startAtSeconds: 1_000,
      endAtSeconds: 87_400,
      durationSeconds: 86_400,
    },
    referenceContract: {
      ownedSourceIds: [MEMORY_ID, DUTY_ID],
      allowedZoneHandles: [HOME_ZONE, WORK_ZONE],
    },
  };
  const schema = tavernCharacterAgentV2OutputSchemaForStage(stageInput);
  const planBlocks = schema.properties.planBlocks;
  const block = planBlocks.items;
  assert.equal(schema.additionalProperties, false);
  assert.equal(planBlocks.minItems, 5);
  assert.equal(planBlocks.maxItems, 8);
  assert.equal(block.additionalProperties, false);
  assert.deepEqual(block.properties.sourceIds.items.enum, [MEMORY_ID, DUTY_ID]);
  assert.equal(
    Object.hasOwn(block.properties.sourceIds, "uniqueItems"),
    false,
    "provider-facing structured-output schemas must avoid unsupported uniqueItems; settlement normalizes source ids",
  );
  assert.deepEqual(block.properties.desiredZoneHandle.enum, ["", HOME_ZONE, WORK_ZONE]);
  assert.equal(block.properties.relativeStartSeconds.maximum, 86_400);
  assert.equal(block.properties.relativeEndSeconds.maximum, 86_400);
  const schemaText = JSON.stringify(schema);
  assert.equal(schemaText.includes("actionAttempt"), false);
  assert.equal(schemaText.includes("worldPatch"), false);
  assert.equal(schemaText.includes("literalSpeech"), false);

  const prompt = tavernCharacterAgentV2SystemPrompt(stageInput);
  assert.match(prompt, /五至八个|5[^\n]*8/u);
  assert.match(prompt, /24\s*小时/u);
  assert.match(prompt, /粗|粗粒度/u);
  assert.match(prompt, /不要.*动作|不能.*动作/u);
  assert.match(prompt, /不要.*台词|不能.*台词/u);
  assert.match(prompt, /不要.*世界|不能.*世界/u);
}

// A world without an exposed planning-zone vocabulary still admits a private
// rough plan; the Character leaves zone handles empty instead of inventing one.
{
  const schema = tavernCharacterAgentV2OutputSchemaForStage({
    phase: "awaiting_character_day_planning",
    horizon: { durationSeconds: 86_400 },
    referenceContract: {
      ownedSourceIds: [MEMORY_ID],
      allowedZoneHandles: [],
    },
  });
  assert.deepEqual(
    schema.properties.planBlocks.items.properties.desiredZoneHandle.enum,
    [""],
  );

  const before = privateState();
  const result = await runCharacterDayPlanningTurn({
    ownerCharacterId: OWNER,
    privateState: before,
    availableZoneHandles: [],
    async runStage() {
      const submission = lawfulSubmission();
      submission.planBlocks.forEach((block) => {
        block.desiredZoneHandle = "";
      });
      return { dayPlan: submission };
    },
  });
  assert.equal(result.privateStatePatch.lifePlanState.steps.every((step) => (
    step.desiredZoneHandle === ""
  )), true);
}

console.log("character day planning turn contracts passed");
