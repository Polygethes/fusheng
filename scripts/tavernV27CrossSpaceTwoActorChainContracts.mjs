import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import {
  createTavernWorldRuntimeV27,
  projectTavernV27TurnForObserver,
} from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";

const XIE_ZHENSHI = "char_xyy_xiezenshi";
const LUO_ZHAO = "char_xyy_luozhao";
const ACTIVITY_ID = "activity:phase98:controlled-spar";

function seedState() {
  return buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
}

function clean(value = "") {
  return String(value ?? "").trim();
}

function otherHandle(stageInput = {}) {
  return clean((stageInput.worldProjection?.perceivedCharacters || [])
    .find((row) => clean(row?.id) !== clean(stageInput.characterId))?.id);
}

function activityOperation(stageInput = {}, operation = "none", response = "none") {
  const existing = (stageInput.worldProjection?.sharedActivities || [])
    .find((row) => clean(row?.activityId) === ACTIVITY_ID);
  const otherId = otherHandle(stageInput);
  return {
    operation,
    activityId: ACTIVITY_ID,
    kind: "controlled_spar",
    participantIds: existing?.participantIds?.length
      ? structuredClone(existing.participantIds)
      : [stageInput.characterId, otherId].filter(Boolean),
    requestedZoneId: "courtyard",
    response,
    boundaries: {
      intensity: "controlled",
      propertyProtection: true,
      harmLimit: "stop_before_injury",
      note: "",
    },
  };
}

function basePlan(overrides = {}) {
  return {
    intention: "处理眼前实际发生的事",
    primitive: "none",
    targetId: "",
    utterance: "",
    vocalMode: "conversational",
    visibleAction: "",
    texture: [],
    privateBasis: "只根据本人收到的事实做这一拍决定。",
    ...overrides,
  };
}

function createPhase98Planner() {
  const turnIndex = new Map([[LUO_ZHAO, 0], [XIE_ZHENSHI, 0]]);
  return (stageInput = {}) => {
    const characterId = clean(stageInput.characterId);
    const index = Number(turnIndex.get(characterId) || 0);
    turnIndex.set(characterId, index + 1);
    const targetId = otherHandle(stageInput);

    if (characterId === LUO_ZHAO) {
      const plans = [
        basePlan({
          intention: "先用平常音量叫一声，确认后院的人能否听见",
          primitive: "speak",
          utterance: "谢真石？",
          continueAfterSettlement: true,
          nextPrimitive: "speak",
        }),
        basePlan({
          intention: "普通说话没有传到，改为朝后院喊人",
          primitive: "speak",
          utterance: "谢真石？",
          vocalMode: "call_out",
        }),
        basePlan({
          intention: "听清人在后院，先走近一层",
          primitive: "move",
          destinationId: "hall",
          visibleAction: "洛照越过门槛，走进堂前。",
        }),
        basePlan({
          intention: "对方已经招呼她进去，走到后院当面说",
          primitive: "move",
          destinationId: "courtyard",
          visibleAction: "洛照穿过堂前，来到后院。",
          continueAfterSettlement: true,
          nextPrimitive: "speak",
        }),
        basePlan({
          intention: "当面提出一次点到为止的试剑",
          primitive: "speak",
          targetId,
          utterance: "过一招？",
          sharedActivity: activityOperation(stageInput, "propose"),
        }),
        basePlan({
          intention: "对方已经答应，以手势确认开始",
          primitive: "gesture",
          targetId,
          visibleAction: "洛照抬手示意开始。",
          bodyActions: [{ kind: "raise_hand", direction: "forward", amplitude: "small", speed: "normal" }],
          sharedActivity: activityOperation(stageInput, "start"),
        }),
      ];
      return plans[index] || basePlan();
    }

    if (characterId === XIE_ZHENSHI) {
      const plans = [
        basePlan({
          intention: "听见门口有人喊自己，让对方知道自己在哪里",
          primitive: "speak",
          utterance: "后院。",
          vocalMode: "call_out",
        }),
        basePlan({
          intention: "对方已经走到堂前，用平常音量让她进来",
          primitive: "speak",
          targetId,
          utterance: "进来吧。",
        }),
        basePlan({
          intention: "本人愿意接下这次点到为止的试剑",
          primitive: "speak",
          targetId,
          utterance: "来。",
          sharedActivity: activityOperation(stageInput, "respond", "accept"),
        }),
        basePlan({
          intention: "由本人表示结束共同活动",
          primitive: "gesture",
          targetId,
          visibleAction: "谢真石垂手示意结束。",
          bodyActions: [{ kind: "lower_hand", direction: "neutral", amplitude: "small", speed: "normal" }],
          sharedActivity: activityOperation(stageInput, "complete"),
        }),
      ];
      return plans[index] || basePlan();
    }

    return basePlan();
  };
}

const state = seedState();
const stageCalls = [];
const fixture = createTavernV27FixtureStageRunner({ planForTurn: createPhase98Planner() });
const instance = createTavernWorldRuntimeV27(state, {
  positions: { [LUO_ZHAO]: "threshold", [XIE_ZHENSHI]: "courtyard" },
  worldId: "world:xyy:tavern:v27:phase98-cross-space-chain",
  runStage: async (input, options) => {
    stageCalls.push({ stage: options.stage, characterId: input.characterId, agentTurnId: input.agentTurnId });
    return fixture(input, options);
  },
});
const tavernPlaceId = instance.coordinator.worldState.entities[LUO_ZHAO].placeId;

await instance.runtime.enqueueWake(LUO_ZHAO, {
  wakeId: "wake:phase98:luo-arrives",
  kind: "opportunity_window",
  evidenceIds: [],
  evidence: [],
});

const turns = [];
const maintenanceTurns = [];
async function run(characterId, label) {
  for (let skipped = 0; skipped <= 3; skipped += 1) {
    const turn = await instance.runtime.runNext({ characterId });
    assert.ok(turn, `${label}: ${characterId} must have a real queued wake`);
    const submissionMode = clean(turn.privateResult?.submissionMode);
    if (["reflection", "day_planning"].includes(submissionMode)) {
      assert.equal(turn.actionAttempt, null, `${submissionMode} is a private maintenance turn, not an action`);
      assert.equal(turn.outcome, null, `${submissionMode} must not fabricate a world outcome`);
      maintenanceTurns.push({ label, turn, submissionMode });
      continue;
    }
    assert.ok(turn.actionAttempt, `${label}: bounded maintenance skipping must reach one real action`);
    turns.push({ label, turn, observer: projectTavernV27TurnForObserver(turn, state.characters) });
    return turn;
  }
  assert.fail(`${label}: more than three consecutive maintenance turns blocked the expected action`);
}

const quietCall = await run(LUO_ZHAO, "ordinary speech across two edges");
assert.equal(quietCall.outcome.status, "success", "the speaker did speak; an untargeted utterance is not retroactively failed because nobody heard it");
assert.equal(
  quietCall.outcome.deliveries.some((row) => row.recipientCharacterId === XIE_ZHENSHI && row.eventKind === "speech"),
  false,
  "ordinary speech must not cross the two-edge acoustic route",
);
assert.equal(instance.runtime.actors.get(XIE_ZHENSHI).mailbox.length, 0, "unheard speech must not wake the other Character Agent");
assert.equal(instance.coordinator.worldState.sharedActivities.length, 0);

const loudCall = await run(LUO_ZHAO, "call_out across two edges");
assert.equal(loudCall.outcome.status, "success");
assert.ok(loudCall.outcome.deliveries.some((row) => row.recipientCharacterId === XIE_ZHENSHI && row.eventKind === "speech"));

const distantReply = await run(XIE_ZHENSHI, "call_out reply across two edges");
assert.equal(distantReply.outcome.status, "success");
assert.ok(distantReply.outcome.deliveries.some((row) => row.recipientCharacterId === LUO_ZHAO && row.eventKind === "speech"));

const approachHall = await run(LUO_ZHAO, "move one zone closer");
assert.equal(approachHall.outcome.status, "success");
assert.equal(instance.coordinator.worldState.entities[LUO_ZHAO].zoneId, "hall");

const adjacentSpeech = await run(XIE_ZHENSHI, "ordinary adjacent-zone speech");
assert.equal(adjacentSpeech.outcome.status, "success");
assert.ok(adjacentSpeech.outcome.deliveries.some((row) => (
  row.recipientCharacterId === LUO_ZHAO
  && row.eventKind === "speech"
  && row.soundDistance === 1
)));

const enterCourtyard = await run(LUO_ZHAO, "meet in courtyard");
assert.equal(enterCourtyard.outcome.status, "success");
assert.equal(instance.coordinator.worldState.entities[LUO_ZHAO].zoneId, "courtyard");
assert.equal(instance.coordinator.worldState.entities[XIE_ZHENSHI].zoneId, "courtyard");

const proposal = await run(LUO_ZHAO, "propose shared activity face to face");
assert.ok(proposal.outcome.resolvedEffects.some((row) => row.kind === "shared_activity_proposed"));
assert.equal(instance.coordinator.worldState.sharedActivities[0].status, "proposed");

const acceptance = await run(XIE_ZHENSHI, "accept shared activity");
assert.ok(acceptance.outcome.resolvedEffects.some((row) => row.kind === "shared_activity_accepted"));
assert.equal(instance.coordinator.worldState.sharedActivities[0].status, "accepted");
assert.equal(instance.coordinator.worldState.places[tavernPlaceId].accessGrants.length, 1);

const start = await run(LUO_ZHAO, "start shared activity with visible action");
assert.ok(start.outcome.resolvedEffects.some((row) => row.kind === "shared_activity_started"));
assert.equal(instance.coordinator.worldState.sharedActivities[0].status, "active");

const completion = await run(XIE_ZHENSHI, "complete shared activity with visible action");
assert.ok(completion.outcome.resolvedEffects.some((row) => row.kind === "shared_activity_completed"));
assert.equal(instance.coordinator.worldState.sharedActivities[0].status, "completed");
assert.equal(instance.coordinator.worldState.places[tavernPlaceId].accessGrants[0].status, "revoked");

const lifecycleOperations = turns
  .flatMap(({ turn }) => turn.outcome?.attemptSurface || [])
  .filter((row) => row.kind === "shared_activity_operation_attempted")
  .map((row) => row.operation);
assert.deepEqual(lifecycleOperations, ["propose", "respond", "start", "complete"]);

const drained = await instance.runtime.runUntilIdle({ maxTurns: 12 });
assert.ok(drained.length <= 12);
assert.equal(instance.runtime.readyQueue.length, 0, "the deterministic chain must settle without manufactured dialogue");
const executedTurns = [
  ...turns.map((row) => row.turn),
  ...maintenanceTurns.map((row) => row.turn),
  ...drained,
];
const executedMaintenanceTurns = executedTurns.filter((turn) => (
  ["reflection", "day_planning"].includes(clean(turn.privateResult?.submissionMode))
));
const executedAtomicTurns = executedTurns.filter((turn) => clean(turn.privateResult?.submissionMode) === "atomic");
assert.ok(executedMaintenanceTurns.some((turn) => clean(turn.privateResult?.submissionMode) === "reflection"),
  "the legal reflection turn inserted into the chain must be recorded as maintenance");
assert.equal(
  stageCalls.length,
  executedAtomicTurns.length * 3 + executedMaintenanceTurns.length,
  "new atomic turns use three calls while each maintenance turn uses its one dedicated stage",
);

console.log(JSON.stringify({
  status: "all-passed",
  actorTurns: turns.length,
  drainedSilentTurns: drained.length,
  maintenanceTurns: executedMaintenanceTurns.length,
  worldVersion: instance.coordinator.journal.worldVersion,
  externalProviderRequests: 0,
  quietTwoEdgeSpeechDelivered: quietCall.outcome.deliveries.some((row) => (
    row.recipientCharacterId === XIE_ZHENSHI && row.eventKind === "speech"
  )),
  callOutTwoEdgeSpeech: loudCall.outcome.status,
  adjacentConversationDistance: adjacentSpeech.outcome.deliveries
    .find((row) => row.recipientCharacterId === LUO_ZHAO && row.eventKind === "speech")?.soundDistance,
  finalZones: {
    [LUO_ZHAO]: instance.coordinator.worldState.entities[LUO_ZHAO].zoneId,
    [XIE_ZHENSHI]: instance.coordinator.worldState.entities[XIE_ZHENSHI].zoneId,
  },
  sharedActivityLifecycle: lifecycleOperations,
  sharedActivityStatus: instance.coordinator.worldState.sharedActivities[0].status,
  accessGrantStatus: instance.coordinator.worldState.places[tavernPlaceId].accessGrants[0].status,
}, null, 2));
