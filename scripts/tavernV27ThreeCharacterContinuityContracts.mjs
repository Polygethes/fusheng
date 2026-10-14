import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { characterEventEvidenceRecords } from "../src/server/simulation/characterEventReceipts.mjs";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import { createTavernWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";

const XIE = "char_xyy_xiezenshi";
const LUO = "char_xyy_luozhao";
const ZHOU = "char_xyy_zhoumin";
const CHARACTER_IDS = Object.freeze([XIE, LUO, ZHOU]);
const SIDE_WALL_TABLE = "position:tavern-hall-side-wall-table";
const PUBLIC_GESTURE = "谢真石将柜台边的木牌挪开半尺。";

const PRIVATE_SENTINELS = Object.freeze({
  [XIE]: "private-memory:xie-only:wooden-token",
  [LUO]: "private-memory:luo-only:lake-reflection",
  [ZHOU]: "private-memory:zhou-only:medicine-knot",
});
const PSYCHOLOGY_SENTINELS = Object.freeze({
  [XIE]: "private-psychology:xie-only",
  [LUO]: "private-psychology:luo-only",
  [ZHOU]: "private-psychology:zhou-only",
});

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function seedState() {
  return buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
}

function privateEpisode(characterId, sentinel) {
  return {
    id: `episode:phase85:${characterId}`,
    ownerCharacterId: characterId,
    sourceImpactId: "",
    sourceImpactIds: [],
    evidenceIds: [],
    perceivedAt: {
      seconds: 0,
      worldDay: 0,
      locationId: "loc_xyy_tavern",
      zoneId: "hall",
    },
    perception: {
      modality: "memory",
      modalities: ["memory"],
      content: sentinel,
      topic: sentinel,
      sourceCharacterId: characterId,
      identityKnown: true,
    },
    source: {
      kind: "firsthand",
      immediateSourceCharacterId: characterId,
      identityKnown: true,
      characterChain: [characterId],
      confidence: 1,
      directness: 1,
    },
    retrievalCues: [sentinel],
    interpretations: [],
    semanticFrame: {
      id: `frame:phase85:${characterId}`,
      kind: "private_continuity_probe",
      predicate: "remember",
      topicId: `private-topic:${characterId}`,
      roles: { experiencer: characterId },
      object: { id: `private-object:${characterId}`, label: sentinel },
      lexicalAnchors: [sentinel],
      importance: 1,
    },
    retentionStrength: 1,
    accessibility: 1,
    importance: 1,
    retrievalCount: 0,
  };
}

function seedActorPrivateIsolation(instance) {
  for (const characterId of CHARACTER_IDS) {
    const actor = instance.runtime.actors.get(characterId);
    assert.ok(actor, `missing Actor for ${characterId}`);
    actor.privateState.psychologyAnchor = {
      ...(actor.privateState.psychologyAnchor || {}),
      identityModel: {
        ...(actor.privateState.psychologyAnchor?.identityModel || {}),
        privateIsolationProbe: PSYCHOLOGY_SENTINELS[characterId],
      },
    };
    actor.privateState.memoryContext = {
      ...(actor.privateState.memoryContext || {}),
      ownerCharacterId: characterId,
      episodes: [
        ...(actor.privateState.memoryContext?.episodes || []),
        privateEpisode(characterId, PRIVATE_SENTINELS[characterId]),
      ],
    };
  }
}

function evidenceIds(stageInput = {}) {
  return (stageInput.worldProjection?.evidence || [])
    .map((row) => row.evidenceId)
    .filter(Boolean);
}

function setAppraisalAttention(result, stageInput, noticed) {
  const ids = noticed ? evidenceIds(stageInput) : [];
  const appraisal = result.appraisal;
  appraisal.noticedEvidenceIds = clone(ids);
  appraisal.interpretations = ids.length ? [{
    evidenceIds: clone(ids),
    meaning: "本人注意到眼前发生了一个公开动作。",
    confidence: 0.9,
  }] : [];
  appraisal.beliefOperations = [];
  appraisal.relevanceLinks = [];
  appraisal.desireGroundings = [];
  appraisal.entityModelUpdates = [];
  appraisal.locationBeliefUpdates = [];
  appraisal.sourceKnowledgeBeliefUpdates = [];
  appraisal.threadAppraisals = [];
  appraisal.relationshipAppraisal = {
    phase: "pending_perception_appraisal",
    targetCharacterId: "",
    sourceImpactIds: [],
    changeMode: "none",
    dimensionChanges: [],
    reason: "",
  };
  appraisal.priorActionOutcomeAppraisal.noticedOutcomeEvidenceIds = [];
  return result;
}

function setCandidateAction(result, stageInput, {
  primitive,
  noticed,
  intention,
} = {}) {
  const candidate = result.candidates.candidates[0];
  candidate.intention = intention;
  candidate.attemptPrimitive = primitive;
  candidate.targetHandle = "";
  candidate.actionBinding = {
    kind: "none",
    targetCharacterId: "",
    objectId: "",
    destinationId: "",
    positionId: "",
  };
  candidate.perceivedPrerequisites = noticed ? evidenceIds(stageInput) : [];
  candidate.domains = ["general"];
  candidate.expectedEffects = [];
  candidate.desireRelations = [];
  candidate.timingIntent = primitive === "none" ? "hold" : "immediate";
  candidate.disclosureNeed = "none";
  return result;
}

function setChoiceAction(result, stageInput, { primitive, noticed } = {}) {
  const acting = primitive !== "none";
  const impulse = result.choice.automaticCommunicationImpulse;
  result.choice.regulationChoice.strategies = [{
    strategy: acting ? "express" : "tolerate",
    targetEmotionIds: [],
    effort: 0.08,
    contextFit: 0.9,
  }];
  result.choice.regulationChoice.intendedPublicEffect = acting
    ? "只让这个可见动作发生"
    : "不增加新的公开动作";
  result.choice.goalPreservation.transformedDimensions = acting ? ["manner"] : ["timing"];
  result.choice.goalPreservation.acceptedDelay = !acting;
  result.choice.goalPreservation.privateBasis = acting
    ? "此刻只做本人选中的具体动作。"
    : "本人此刻选择保持沉默和不行动。";
  impulse.mode = acting ? "nonverbal" : "none";
  impulse.triggerEvidenceIds = noticed ? evidenceIds(stageInput) : [];
  impulse.discourseAnchorIds = [];
  impulse.motiveSourceIds = [];
  impulse.perceivedTurnDemand = acting ? "眼前允许这个身体动作发生" : "此刻不必公开回应";
  impulse.feltTendency = acting ? "直接做完眼前的小动作" : "";
  impulse.urgency = acting ? 0.32 : 0.08;
  impulse.disclosurePressure = 0.04;
  impulse.inhibitionPressure = acting ? 0.12 : 0.72;
  impulse.conflict = { present: false, opposingSourceIds: [], description: "" };
  result.choice.continuationIntentions = [];
  result.choice.privateDecisionBasis = acting
    ? "本人选择了一个不需要说话的可见动作。"
    : "本人选择不把任何新内容带入公共世界。";
  return result;
}

function setExpressionAction(result, stageInput, { primitive, noticed, visibleAction = "" } = {}) {
  const acting = primitive !== "none";
  const plan = result.expressionPlan;
  plan.impulseTransformation = {
    treatment: acting ? "express" : "withhold",
    privateBasis: acting ? "让动作本身发生。" : "压住表达，不追加公开动作。",
  };
  plan.mode = acting ? "nonverbal" : "silence";
  plan.actionIntent = acting ? visibleAction : "保持原处，不追加公开动作";
  plan.communicationPlan = {
    goal: "none",
    tactic: "silence",
    disclosure: "withhold",
    epistemicRelation: "not_applicable",
    intendedAudienceCharacterIds: [],
    desiredEffect: "",
    threadDisposition: "none",
    epistemicActionCandidateId: "",
    presuppositionStance: "not_applicable",
    epistemicBasisEvidenceIds: noticed ? evidenceIds(stageInput) : [],
    subtext: "",
  };
  plan.speechMoment = {
    currentTurnDemand: acting ? "只做眼前动作" : "此刻无需公开回应",
    regulatedOpeningMove: "不发声",
    minimumPublicDelta: "",
    listenerCanRespondAfterDelta: false,
    expansionFunction: "none",
    expansionPurpose: "",
    deferredOrImplied: [],
    sharedContext: { anchorIds: [], treatment: "not_applicable", reopeningPurpose: "" },
  };
  plan.nonverbalUndertone = acting ? "动作自然连在眼前的杂务中" : "";
  plan.timing = acting ? "during_action" : "silence";
  plan.turnYield = acting ? "hold" : "not_applicable";
  return result;
}

function setRealizedAction(result, { primitive, visibleAction = "" } = {}) {
  const acting = primitive !== "none";
  const realization = result.realization;
  realization.emotionHandling = [{
    channel: "posture",
    handling: acting ? "expressed" : "masked",
    basis: acting ? "只有动作可被看见" : "没有新增公开表达",
  }];
  realization.realizedSpeechHabitIds = [];
  realization.surfaceRealization.timing = acting ? "during_action" : "silence";
  realization.surfaceRealization.affectiveTexture = [];
  realization.embodiedIntent = {
    automaticReaction: acting ? visibleAction : "没有新增动作",
    chosenRegulation: acting ? "只做眼前这一步" : "保持沉默和不行动",
    manner: acting ? "动作连在当前场面里" : "保持原处",
    posture: "仍在当前区域",
    intendedGesture: acting ? visibleAction : "",
  };
  realization.utterance = {
    literalSpeech: "",
    vocalMode: "conversational",
    speechAct: "none",
    speechFunctions: [],
  };
  realization.actionAttempt = {
    primitive,
    objectId: "",
    targetCharacterId: "",
    destinationId: "",
    affordanceId: "",
  };
  return result;
}

function setAtomicCommitAction(result, { primitive, visibleAction = "" } = {}) {
  const acting = primitive !== "none";
  const commit = result.turnCommit;
  commit.conversationAnchorSelection.postTurnDisposition = "no_thread";
  commit.privateExpressionTrace = {
    ...commit.privateExpressionTrace,
    interactionMove: acting ? "none" : "silence",
    disclosure: "withhold",
    epistemicRelation: "not_applicable",
    threadDisposition: "none",
  };
  commit.actionAttempt = {
    primitive,
    objectId: "",
    targetCharacterId: "",
    destinationId: "",
    affordanceId: "",
  };
  commit.publicExpression = {
    mode: acting ? "nonverbal" : "silence",
    audienceCharacterIds: [],
    timing: acting ? "during_action" : "silence",
    utterance: {
      literalSpeech: "",
      vocalMode: "conversational",
    },
    bodyDelta: acting ? visibleAction : "",
    bodyActions: acting ? [{ kind: "raise_hand", direction: "forward", amplitude: "small", speed: "normal" }] : [],
    affectiveDeltas: [],
  };
  return result;
}

function createThreeCharacterStageRunner(calls = []) {
  const fixture = createTavernV27FixtureStageRunner();
  return async (stageInput, options = {}) => {
    calls.push({ stage: options.stage, input: clone(stageInput) });
    const result = await fixture(stageInput, options);
    const firstXieTurn = stageInput.characterId === XIE
      && stageInput.agentTurnId === `agent-turn:${XIE}:1`;
    const firstZhouTurn = stageInput.characterId === ZHOU
      && stageInput.agentTurnId === `agent-turn:${ZHOU}:1`;
    const primitive = firstXieTurn ? "gesture" : "none";
    const noticed = !firstZhouTurn;
    const visibleAction = firstXieTurn ? PUBLIC_GESTURE : "";

    if (options.stage === "subjective_appraisal") {
      return setAppraisalAttention(result, stageInput, noticed);
    }
    if (options.stage === "agent_candidates") {
      return setCandidateAction(result, stageInput, {
        primitive,
        noticed,
        intention: firstXieTurn ? "把碍事的木牌挪开" : "此刻不增加新的公开行动",
      });
    }
    if (options.stage === "agent_choice_and_regulation") {
      return setChoiceAction(result, stageInput, { primitive, noticed });
    }
    if (options.stage === "agent_expression_planning") {
      return setExpressionAction(result, stageInput, { primitive, noticed, visibleAction });
    }
    if (options.stage === "agent_realization") {
      return setRealizedAction(result, { primitive, visibleAction });
    }
    if (options.stage === "agent_turn_commit") {
      return setAtomicCommitAction(result, { primitive, visibleAction });
    }
    return result;
  };
}

function actorCheckpoint(checkpoint, characterId) {
  return checkpoint.actors.find((row) => row.characterId === characterId);
}

function assertOwnerPrivateIsolation(checkpoint) {
  assert.equal(checkpoint.actors.length, 3, "the checkpoint must contain exactly three Character Actors");
  for (const characterId of CHARACTER_IDS) {
    const row = actorCheckpoint(checkpoint, characterId);
    assert.ok(row, `missing checkpoint for ${characterId}`);
    assert.equal(row.privateState.ownerCharacterId, characterId);
    assert.equal(row.privateState.memoryContext.ownerCharacterId, characterId);
    const serialized = JSON.stringify(row.privateState);
    assert.ok(serialized.includes(PRIVATE_SENTINELS[characterId]), `${characterId} lost its own memory sentinel`);
    assert.ok(serialized.includes(PSYCHOLOGY_SENTINELS[characterId]), `${characterId} lost its own psychology sentinel`);
    for (const otherId of CHARACTER_IDS.filter((id) => id !== characterId)) {
      assert.equal(serialized.includes(PRIVATE_SENTINELS[otherId]), false, `${characterId} received ${otherId}'s private memory`);
      assert.equal(serialized.includes(PSYCHOLOGY_SENTINELS[otherId]), false, `${characterId} received ${otherId}'s private psychology`);
    }
  }
}

function subjectiveInput(calls, characterId, turnSequence) {
  return calls.find((row) => (
    row.stage === "subjective_appraisal"
    && row.input.characterId === characterId
    && row.input.agentTurnId === `agent-turn:${characterId}:${turnSequence}`
  ))?.input;
}

function assertNextInputsUseOnlyOwnerMemory(calls) {
  for (const characterId of CHARACTER_IDS) {
    const input = subjectiveInput(calls, characterId, 2);
    assert.ok(input, `missing restored next-turn input for ${characterId}`);
    assert.equal(input.privateContext.memoryContext.ownerCharacterId, characterId);
    const serialized = JSON.stringify(input.privateContext);
    assert.ok(serialized.includes(PRIVATE_SENTINELS[characterId]), `${characterId} did not receive its own memory next turn`);
    assert.ok(serialized.includes(PSYCHOLOGY_SENTINELS[characterId]), `${characterId} did not receive its own psychology next turn`);
    for (const otherId of CHARACTER_IDS.filter((id) => id !== characterId)) {
      assert.equal(serialized.includes(PRIVATE_SENTINELS[otherId]), false, `${characterId}'s next input leaked ${otherId}'s memory`);
      assert.equal(serialized.includes(PSYCHOLOGY_SENTINELS[otherId]), false, `${characterId}'s next input leaked ${otherId}'s psychology`);
    }
  }
}

const state = seedState();
const firstRunCalls = [];
const instance = createTavernWorldRuntimeV27(state, {
  characterAgentCallMode: "standard", // This diagnostic authors standalone appraisal/candidate stages.
  characterIds: CHARACTER_IDS,
  positions: { [XIE]: "hall", [LUO]: "hall", [ZHOU]: "hall" },
  worldId: "world:xyy:tavern:v27:phase85-three-character",
  runStage: createThreeCharacterStageRunner(firstRunCalls),
});
seedActorPrivateIsolation(instance);

await instance.runtime.enqueueWake(XIE, {
  wakeId: "wake:phase85:three-character:start",
  kind: "opportunity_window",
  evidenceIds: [],
  evidence: [],
});

const xieTurn = await instance.runtime.runNext({ characterId: XIE });
assert.equal(xieTurn.outcome.status, "success");
assert.equal(xieTurn.outcome.primitive, "gesture");
assert.equal(xieTurn.outcome.worldVersion, 1);
assert.equal(xieTurn.outcome.deliveries.filter((row) => [LUO, ZHOU].includes(row.recipientCharacterId)).length, 2);

const luoDeliveryBefore = characterEventEvidenceRecords(instance.runtime.receiptLedger, LUO)
  .find((row) => row.eventId === xieTurn.outcome.eventId);
const zhouDeliveryBefore = characterEventEvidenceRecords(instance.runtime.receiptLedger, ZHOU)
  .find((row) => row.eventId === xieTurn.outcome.eventId);
assert.ok(luoDeliveryBefore, "the visible event must create Luo Zhao's own delivery");
assert.ok(zhouDeliveryBefore, "the visible event must create Zhou Min's own delivery");
assert.notEqual(luoDeliveryBefore.deliveryId, zhouDeliveryBefore.deliveryId);
assert.notEqual(luoDeliveryBefore.evidenceId, zhouDeliveryBefore.evidenceId);
assert.equal(luoDeliveryBefore.status, "delivered");
assert.equal(zhouDeliveryBefore.status, "delivered");

const versionAfterGesture = instance.coordinator.journal.worldVersion;
const luoSequenceBefore = instance.runtime.actors.get(LUO).turnSequence;
const luoTurn = await instance.runtime.runNext({ characterId: LUO });
assert.equal(luoTurn.actionAttempt, null, "Luo Zhao's structural fixture turn is explicitly silent");
assert.equal(instance.runtime.actors.get(LUO).turnSequence, luoSequenceBefore + 1);
assert.equal(instance.coordinator.journal.worldVersion, versionAfterGesture, "a silent Actor turn must not change worldVersion");

const zhouSequenceBefore = instance.runtime.actors.get(ZHOU).turnSequence;
const zhouTurn = await instance.runtime.runNext({ characterId: ZHOU });
assert.equal(zhouTurn.actionAttempt, null, "Zhou Min's structural fixture turn is explicitly silent");
assert.equal(instance.runtime.actors.get(ZHOU).turnSequence, zhouSequenceBefore + 1);
assert.equal(instance.coordinator.journal.worldVersion, versionAfterGesture, "another silent Actor turn must not change worldVersion");

const luoReceipt = characterEventEvidenceRecords(instance.runtime.receiptLedger, LUO)
  .find((row) => row.eventId === xieTurn.outcome.eventId);
const zhouReceipt = characterEventEvidenceRecords(instance.runtime.receiptLedger, ZHOU)
  .find((row) => row.eventId === xieTurn.outcome.eventId);
assert.equal(luoReceipt.status, "appraised", "Luo Zhao explicitly noticed and appraised her own delivery");
assert.equal(zhouReceipt.status, "delivered", "Zhou Min did not notice his delivery, so it must remain delivered");

const luoPrivateAfterAttention = instance.runtime.actors.get(LUO).privateState;
const zhouPrivateAfterInattention = instance.runtime.actors.get(ZHOU).privateState;
assert.ok(
  luoPrivateAfterAttention.memoryContext.episodes.some((row) => row.evidenceIds?.includes(luoReceipt.evidenceId)),
  "noticed evidence must become Luo Zhao's private memory",
);
assert.equal(
  zhouPrivateAfterInattention.memoryContext.episodes.some((row) => row.evidenceIds?.includes(zhouReceipt.evidenceId)),
  false,
  "unnoticed evidence must not become Zhou Min's private memory",
);

const seatOutcome = await instance.coordinator.submitActionAttempt({
  attemptId: "attempt:phase85:luo-occupies-side-wall",
  actorId: LUO,
  primitive: "handle",
  expectedWorldVersion: versionAfterGesture,
  payload: {
    objectId: SIDE_WALL_TABLE,
    operation: "use_affordance",
    visibleAction: "洛照在侧墙空桌旁坐下。",
  },
});
assert.equal(seatOutcome.status, "success");
assert.equal(instance.coordinator.worldState.entities[LUO].positionId, SIDE_WALL_TABLE);
assert.deepEqual(instance.coordinator.worldState.objects[SIDE_WALL_TABLE].occupantCharacterIds, [LUO]);

const checkpoint = await instance.runtime.checkpoint();
assertOwnerPrivateIsolation(checkpoint);
assert.equal(actorCheckpoint(checkpoint, XIE).turnSequence, 1);
assert.equal(actorCheckpoint(checkpoint, LUO).turnSequence, 1);
assert.equal(actorCheckpoint(checkpoint, ZHOU).turnSequence, 1);

const restoredCalls = [];
const restored = createTavernWorldRuntimeV27(state, {
  characterAgentCallMode: "standard",
  characterIds: CHARACTER_IDS,
  positions: { [XIE]: "hall", [LUO]: "hall", [ZHOU]: "hall" },
  worldId: "world:xyy:tavern:v27:phase85-three-character",
  checkpoint,
  runStage: createThreeCharacterStageRunner(restoredCalls),
});
assert.equal(restored.coordinator.worldState.entities[LUO].positionId, SIDE_WALL_TABLE);
assert.deepEqual(restored.coordinator.worldState.objects[SIDE_WALL_TABLE].occupantCharacterIds, [LUO]);

const versionBeforeRestoredSilentTurns = restored.coordinator.journal.worldVersion;
for (const characterId of CHARACTER_IDS) {
  await restored.runtime.enqueueWake(characterId, {
    wakeId: `wake:phase85:restored:${characterId}`,
    kind: "continuation_due",
    evidenceIds: [],
    evidence: [],
  });
  const turn = await restored.runtime.runNext({ characterId });
  assert.equal(turn.agentTurnId, `agent-turn:${characterId}:2`);
  assert.equal(turn.actionAttempt, null);
  assert.equal(restored.runtime.actors.get(characterId).turnSequence, 2);
  assert.equal(
    restored.coordinator.journal.worldVersion,
    versionBeforeRestoredSilentTurns,
    "restored silent turns must advance only Actor-private turn sequence",
  );
}
assertNextInputsUseOnlyOwnerMemory(restoredCalls);

const restoredCheckpoint = await restored.runtime.checkpoint();
assertOwnerPrivateIsolation(restoredCheckpoint);
assert.equal(restored.coordinator.worldState.entities[LUO].positionId, SIDE_WALL_TABLE);
assert.deepEqual(restored.coordinator.worldState.objects[SIDE_WALL_TABLE].occupantCharacterIds, [LUO]);

console.log(JSON.stringify({
  status: "all-passed",
  scope: {
    structuralOnly: true,
    characterQualityClaimed: false,
    externalModelCalls: 0,
  },
  checks: {
    threeActorCheckpointsAreOwnerPrivate: true,
    oneVisibleEventCreatesIndependentRecipientReceipts: true,
    noticedAndAppraisedCanDivergeFromUnnoticedDelivered: true,
    silentTurnsAdvanceActorSequenceWithoutWorldVersion: true,
    seatStateSurvivesCheckpointRestore: true,
    nextTurnsReadOnlyOwnerMemory: true,
  },
}, null, 2));
