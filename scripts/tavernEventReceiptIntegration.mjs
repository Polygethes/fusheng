import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  runTavernCausalScene,
  selectNextCausalAgent,
} from "../src/server/pipeline/tavernCausalScene.mjs";
import {
  createCharacterEventReceiptLedger,
  markCharacterEvidenceAppraised,
  registerCharacterEventDelivery,
} from "../src/server/simulation/characterEventReceipts.mjs";

const emptyWorldState = {
  characters: [],
  relationships: [],
  tavernState: { activeVisits: [], institution: { guestPositions: [] } },
};

function schedulingRuntime() {
  const delivery = {
    id: "delivery:receipt:visual",
    objectiveEventId: "event:receipt:look",
    impactId: "impact:receipt:look",
    recipientId: "recipient",
    sourceCharacterId: "source",
    evidenceId: "evidence:receipt:visual",
    impactScore: 72,
    directed: true,
    noticedProjection: { evidenceId: "evidence:receipt:visual" },
    processedAtStep: null,
  };
  const eventReceipts = createCharacterEventReceiptLedger();
  registerCharacterEventDelivery(eventReceipts, delivery, { deliveredAtSeconds: 1, step: 1 });
  return {
    elapsedSeconds: 2,
    step: 1,
    lastActorId: "",
    actions: [],
    impacts: [],
    requestLocks: [],
    sharedActivities: [],
    eventReceipts,
    agents: {
      recipient: {
        characterId: "recipient",
        present: true,
        hasActed: true,
        intrinsicPressure: 0,
        cooldownUntilSeconds: 0,
        inbox: [delivery],
        ecologyState: null,
        privateState: {},
      },
      source: {
        characterId: "source",
        present: true,
        hasActed: true,
        intrinsicPressure: 0,
        cooldownUntilSeconds: 0,
        inbox: [],
        ecologyState: null,
        privateState: {},
      },
    },
  };
}

const runtime = schedulingRuntime();
const firstWake = selectNextCausalAgent(runtime, { minimumScore: 0, state: emptyWorldState });
assert.equal(firstWake.characterId, "recipient");
assert.equal(firstWake.wakeBasis.kind, "external-impact");

markCharacterEvidenceAppraised(runtime.eventReceipts, {
  characterId: "recipient",
  evidenceIds: ["evidence:receipt:visual"],
  agentTurnId: "turn:recipient:1",
  step: 1,
});
const duplicateWake = selectNextCausalAgent(runtime, { minimumScore: 0, state: emptyWorldState });
assert.equal(duplicateWake, null, "an already appraised delivery must not wake the same Character again as a new impact");

runtime.impacts = [{
  id: "impact:receipt:look",
  causedByActionId: "action:request:1",
  sourceCharacterId: "source",
  directedTargetId: "recipient",
  modality: "sound",
}];
runtime.requestLocks = [{
  id: "request:receipt:1",
  requesterId: "source",
  responderId: "recipient",
  latestActionId: "action:request:1",
  status: "awaiting",
}];
const requestWake = selectNextCausalAgent(runtime, { minimumScore: 0, state: emptyWorldState });
assert.equal(requestWake.characterId, "recipient");
assert.equal(requestWake.wakeBasis.kind, "direct-request", "an unresolved request remains schedulable independently of sensory freshness");

const LUO = "char_xyy_luozhao";
const XIE = "char_xyy_xiezenshi";
const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
const result = await runTavernCausalScene(state, {
  allowOrphanVisitors: true,
  characterIds: [LUO, XIE],
  positions: { [LUO]: "hall", [XIE]: "hall" },
  seedImpacts: [{
    id: "impact:receipt:look-live",
    objectiveEventId: "event:receipt:xie-surface",
    sourceCharacterId: XIE,
    sourceZoneId: "hall",
    type: "physical",
    modality: "visual",
    intensity: 94,
    radius: 1,
    directedTargetId: LUO,
    content: "谢真石的目光在洛照身上停了一瞬。",
    topic: "对方短暂注视",
  }, {
    id: "impact:receipt:shift-live",
    objectiveEventId: "event:receipt:xie-shift",
    sourceCharacterId: XIE,
    sourceZoneId: "hall",
    type: "physical",
    modality: "visual",
    intensity: 90,
    radius: 1,
    directedTargetId: LUO,
    content: "谢真石随后收回目光，手仍垂在身侧。",
    topic: "对方动作变化",
  }],
  maxSteps: 1,
  minimumActivationScore: 0,
  async runAgent(input) {
    const candidate = input.privateActionCandidates.find((row) => row.feasible);
    const evidenceIds = input.perceivedImpacts.map((row) => row.evidenceId).filter(Boolean);
    assert.equal(evidenceIds.length, 2, "both actually noticed deliveries must be available for one appraisal");
    return { decision: {
      candidateId: candidate?.candidateId || "",
      actionType: "pass",
      speechAct: "none",
      targetCharacterId: "",
      speech: "",
      visibleAction: "",
      moveToZoneId: "",
      vocalMode: "conversational",
      affordanceId: "",
      informationSourceImpactId: "",
      commitmentAction: "none",
      commitmentTopic: "",
      decisionValue: "none",
      privateReason: "看见了两段连续动作，但这一刻不公开回应。",
      cognitiveAppraisal: {
        noticedEvidenceIds: evidenceIds,
        interpretations: evidenceIds.map((evidenceId) => ({
          evidenceIds: [evidenceId],
          meaning: "这是同一人连续动作的一部分。",
          confidenceBand: "high",
        })),
        beliefOperations: [],
        threadAppraisals: [],
        entityModelUpdates: [],
        locationBeliefUpdates: [],
        sourceKnowledgeBeliefUpdates: [],
      },
    } };
  },
});

const liveReceipts = result.privateSceneRuntime.eventReceipts.receipts
  .filter((receipt) => receipt.characterId === LUO && receipt.eventId.startsWith("event:receipt:xie-"));
assert.equal(liveReceipts.length, 2);
assert.ok(
  liveReceipts.every((receipt) => receipt.status === "consumed"),
  `one Agent appraisal must settle every evidence id it actually used: ${JSON.stringify(liveReceipts)}`,
);
assert.ok(result.privateSceneRuntime.agents[LUO].inbox.some((delivery) => delivery.processedAtStep == null), "legacy selected-impact handling may leave another row pending; receipts are the new sensory lifecycle authority");
assert.equal(result.sceneRuntime.eventReceipts, undefined, "private attention/appraisal receipts must not leak into public scene runtime");

console.log(JSON.stringify({
  status: "passed",
  checks: {
    appraisedDeliveryDoesNotRewake: true,
    unresolvedRequestRemainsSchedulable: true,
    allAppraisedEvidenceSettled: true,
    receiptPrivateFromObserverRuntime: true,
  },
}, null, 2));
