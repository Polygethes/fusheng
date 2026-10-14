import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  buildTavernCharacterAgentInputV27,
  createTavernWorldRuntimeV27,
  projectTavernSituationV27,
} from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import {
  createTavernCharacterAgentV2Session,
  tavernCharacterAgentV2OutputSchemaForStage,
  tavernCharacterRealizationV2Schema,
  tavernCharacterRegulatedExpressionPlanV2Schema,
  tavernCharacterAgentV2SystemPrompt,
} from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import { buildCharacterAgentStageInput } from "../src/server/simulation/characterAgentTurnProtocol.mjs";
import { createLocalCharacterRuntimePort } from "../src/server/simulation/characterRuntimePort.mjs";
import { createCharacterSessionActor } from "../src/server/simulation/characterSessionActor.mjs";
import { createCharacterWorldRuntime } from "../src/server/simulation/characterWorldRuntime.mjs";
import { createWorldActionRegistry } from "../src/server/simulation/worldActionRegistry.mjs";
import { createWorldCommitCoordinator } from "../src/server/simulation/worldCommitCoordinator.mjs";
import { reduceCharacterPrivateWorldOutcome } from "../src/server/simulation/characterPrivateStateReducer.mjs";
import { advanceCharacterConversationContinuity } from "../src/server/simulation/characterConversationContinuity.mjs";

const XIE = "char_xyy_xiezenshi";
const LUO = "char_xyy_luozhao";

function seedState() {
  return buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
}

// --- World identity and Character recognition are different layers. ---
const state = seedState();
const instance = createTavernWorldRuntimeV27(state, {
  characterIds: [XIE, LUO],
  positions: { [XIE]: "hall", [LUO]: "hall" },
  worldId: "world:test:v27-character-life",
  async runStage() {
    throw new Error("This structural contract must not call a model stage.");
  },
});
const luoActor = instance.runtime.actors.get(LUO);
const projection = projectTavernSituationV27({
  worldState: instance.coordinator.worldState,
  worldVersion: 0,
  characterId: LUO,
  wake: {
    kind: "world_evidence",
    evidence: [{
      evidenceId: "evidence:test:xie-moved",
      eventId: "event:test:xie-moved",
      eventKind: "movement",
      modality: "visual",
      sourceCharacterId: XIE,
      recipientCharacterId: LUO,
      content: "谢真石侧身让开了过道。",
      directed: false,
    }],
  },
});
const perceivedXie = projection.perceivedCharacters[0];
assert.ok(perceivedXie, "a visible person should be available as a perceived entity");
assert.ok(perceivedXie.id.startsWith("perceived_entity:"), "a recipient gets an opaque perceived-entity handle");
assert.equal(perceivedXie.identityKnown, false, "Luo Zhao knows the rumor-name but does not recognize Xie Zhenshi by sight");
assert.equal(perceivedXie.name, "", "an unrecognized person does not receive a canonical name from the world");
assert.notEqual(perceivedXie.id, XIE, "the physical target handle is not the canonical world id");
assert.equal(JSON.stringify(projection.perceivedCharacters).includes(XIE), false);
assert.equal(JSON.stringify(projection.perceivedCharacters).includes("谢真石"), false);

const luoRecord = state.characters.find((row) => row.id === LUO);
const privateContext = structuredClone(luoActor.privateState);
const rawConversationThreadId = "world-thread:test:unfinished-question";
const rawConversationActionId = "action:test:unfinished-question";
const durableConversation = advanceCharacterConversationContinuity({
  ownerCharacterId: LUO,
  conversationState: privateContext.conversationState,
  experience: {
    kind: "noticed_speech_delivery",
    runtimeRecord: {
      authority: "runtime-noticed-speech-delivery",
      deliveryId: "delivery:test:unfinished-question",
      recipientCharacterId: LUO,
      noticed: true,
      eventKind: "speech",
      sourceParticipantHandle: perceivedXie.id,
      directed: true,
      content: "你还要问什么？",
      speechAct: "ask",
      occurredAtSeconds: 1,
      threadStatus: "open",
      resumable: true,
      provenance: {
        sourceActionId: rawConversationActionId,
        sourceThreadId: rawConversationThreadId,
        responseToTurnId: "",
      },
    },
  },
  nowSeconds: 1,
});
privateContext.conversationState = durableConversation.conversationState;
privateContext.sharedActivityUnderstandings = [{
  activityId: "activity:test:possible-spar",
  kind: "controlled_spar",
  status: "proposed_to_me",
  participantEntityHandles: [perceivedXie.id],
}];
const input = buildTavernCharacterAgentInputV27({
  characterId: LUO,
  agentTurnId: "agent-turn:test:v27-character-life:luo",
  expectedWorldVersion: 0,
  wake: { kind: "world_evidence" },
  worldProjection: projection,
  privateContext,
}, luoRecord);
assert.equal(input.activation.sourceEntityHandle, perceivedXie.id);
assert.equal(input.activation.sourceCharacterId, "", "physical perception must not certify a canonical identity");
assert.equal(input.activation.identityKnown, false);
assert.equal(input.activation.directed, false, "an observed movement is not a conversational demand");
assert.equal(input.perceivedImpacts[0].directed, false);
assert.equal(input.perceivedImpacts[0].content, "那人侧身让开了过道。", "an actor-authored third-person action cannot leak an unrecognized canonical name");
assert.equal(input.openConversationThreads[0].id, durableConversation.anchorHandle);
assert.match(input.openConversationThreads[0].id, /^conversation-anchor:/u);
assert.equal(input.conversationAnchors.anchors[0].anchorHandle, durableConversation.anchorHandle);
for (const rawLineage of [rawConversationThreadId, rawConversationActionId]) {
  assert.equal(JSON.stringify(input).includes(rawLineage), false,
    "Character-facing life input must expose only the opaque durable conversation anchor");
}
assert.equal(input.sharedActivities[0].activityId, "activity:test:possible-spar");
assert.equal(input.perceptionFrame.authority, "character-private-perception-tool");
assert.equal(Object.hasOwn(input.perceptionFrame, "serverAudit"), false);
assert.ok(input.perceptionFrame.noticedEvidence.some((row) => row.evidenceId === "evidence:test:xie-moved"));
assert.ok(
  input.perceivedObjects.some((row) => JSON.stringify(row).includes("短剑")),
  "the visible sword remains in stable perceived objects without being re-emitted as fresh evidence",
);
assert.ok(input.agent.perceptionProfile.attention, "the authored private perception profile reaches the Character Agent");
const privatelyKnownXie = input.agent.knownEntityReferences.find((row) => row.knownName === "谢真石");
assert.ok(privatelyKnownXie, "Luo Zhao keeps a private reference for the rumor-name she already knows");
assert.ok(privatelyKnownXie.knownEntityHandle.startsWith("known_entity:"));
assert.equal(privatelyKnownXie.recognizesAppearance, false, "knowing a name must not become visual recognition");
assert.equal(JSON.stringify(input.agent.knownEntityReferences).includes(XIE), false, "private known-person references must not expose the canonical world id");
const characterSession = createTavernCharacterAgentV2Session({ ...input, submissionMode: "atomic" });
const appraisalStageInput = buildCharacterAgentStageInput(characterSession);
assert.ok(
  appraisalStageInput.referenceContract.knownEntityHandles.includes(privatelyKnownXie.knownEntityHandle),
  "the Character Agent receives its private known-person handle as an owned epistemic reference",
);
assert.ok(appraisalStageInput.referenceContract.knownEntityHandles.every((handle) => handle.startsWith("known_entity:")));
assert.ok(
  tavernCharacterAgentV2OutputSchemaForStage(appraisalStageInput)
    .properties.entityModelUpdates.items.properties.identityCandidates.items.properties.knownEntityHandle.enum
    .includes(privatelyKnownXie.knownEntityHandle),
  "identity hypotheses must bind to the private known-person handle before provider execution",
);
assert.equal(instance.runtime.actors.get(XIE).privateState.currentActivities[0].type, "duty");
assert.ok(instance.runtime.actors.get(XIE).privateState.currentActivities[0].description.includes("柴"));
assert.equal(input.ongoingOwnActivities[0].type, "routine");
const xieProjection = projectTavernSituationV27({
  worldState: instance.coordinator.worldState,
  worldVersion: 0,
  characterId: XIE,
  wake: { kind: "world_evidence", evidence: [] },
});
const xieInput = buildTavernCharacterAgentInputV27({
  characterId: XIE,
  agentTurnId: "agent-turn:test:v27-character-life:xie-responsibility",
  expectedWorldVersion: 0,
  wake: { kind: "world_evidence", evidence: [] },
  worldProjection: xieProjection,
  privateContext: structuredClone(instance.runtime.actors.get(XIE).privateState),
}, state.characters.find((row) => row.id === XIE));
assert.ok(
  xieInput.currentResponsibilities.acceptedRoleIds.includes("household_worker"),
  "an author-accepted scene role reaches the Character Agent as responsibility grounding",
);
assert.ok(
  xieInput.currentResponsibilities.activeDutyContracts.some((row) => row.description.includes("柴")),
  "stable role duties coexist with the Character's one current activity",
);
assert.ok(
  xieInput.currentResponsibilities.objectiveOpportunityCues.some((row) => (
    row.kind === "role-relevant-service-opportunity"
    && row.recipientEntityHandle === xieProjection.perceivedCharacters[0].id
    && row.requiredResponse === false
  )),
  "a visible service opportunity becomes non-authoring responsibility pressure rather than a forced greeting",
);
assert.equal(xieInput.currentResponsibilities.selection.selectedCandidateId, null);
assert.equal(Object.hasOwn(xieInput.currentResponsibilities, "requiredAction"), false);
assert.match(
  tavernCharacterAgentV2SystemPrompt({ phase: "awaiting_agent_candidates" }),
  /ongoingOwnActivities 是本人此刻没有自动消失的生活/,
);
assert.match(
  tavernCharacterAgentV2SystemPrompt({ phase: "awaiting_agent_candidates" }),
  /currentResponsibilities 只把本人已接受的身份/,
);

// --- Addressed speech creates a response opportunity; audible public speech does not. ---
const speechCoordinator = createWorldCommitCoordinator({
  worldId: "world:test:directed-speech",
  initialWorldState: instance.coordinator.worldState,
  actionRegistry: createWorldActionRegistry(),
});
const directSpeech = await speechCoordinator.submitActionAttempt({
  attemptId: "attempt:test:direct-question",
  actorId: XIE,
  primitive: "speak",
  expectedWorldVersion: 0,
  payload: {
    targetCharacterId: LUO,
    utterance: "客官，要些什么？",
    speechAct: "ask",
    speechFunctions: ["ask", "offer_service"],
  },
});
assert.equal(directSpeech.deliveries[0].directed, true);
assert.equal(directSpeech.deliveries[0].speechAct, "ask");
assert.deepEqual(directSpeech.deliveries[0].speechFunctions, ["ask", "offer_service"]);
const publicSpeech = await speechCoordinator.submitActionAttempt({
  attemptId: "attempt:test:public-call",
  actorId: XIE,
  primitive: "speak",
  expectedWorldVersion: 1,
  payload: { utterance: "灶上收火了。", speechAct: "inform", speechFunctions: ["inform"] },
});
assert.ok(publicSpeech.deliveries.length > 0);
assert.ok(publicSpeech.deliveries.filter((row) => row.eventKind === "speech").every((row) => row.directed === false));

// --- Expression planning shapes a voice; it does not hand the model a form to recite. ---
assert.equal(Object.hasOwn(tavernCharacterRegulatedExpressionPlanV2Schema.properties, "communicationPlan"), false);
assert.equal(Object.hasOwn(tavernCharacterRegulatedExpressionPlanV2Schema.properties, "speechMoment"), false);
assert.ok(tavernCharacterRegulatedExpressionPlanV2Schema.required.includes("publicStance"));
assert.equal(
  tavernCharacterRealizationV2Schema.properties.surfaceRealization.required.includes("selfCheck"),
  false,
  "the validator must not ask the model to grade its own naturalness with a backend checklist",
);

// --- A zero-delay opportunity is not a clock event and cannot manufacture a turn. ---
const continuationPort = createLocalCharacterRuntimePort({
  async runTurn() {
    throw new Error("No synthetic continuation should wake this actor.");
  },
});
const continuationActor = createCharacterSessionActor({
  characterId: "char:test:continuation",
  privateState: {
    ownerCharacterId: "char:test:continuation",
    ecologyState: {
      characterPsychologyV2State: {
        internalWakePressure: 0.1,
        continuationIntentions: [{
          ownerAuthority: "character-agent",
          intentionId: "continuation:test:wait-for-opportunity",
          triggerType: "opportunity_window",
          minimumDelaySeconds: 0,
          triggerThreshold: 0.5,
          status: "active",
        }],
      },
    },
  },
  runtimePort: continuationPort,
});
const continuationCoordinator = createWorldCommitCoordinator({
  worldId: "world:test:no-synthetic-opportunity",
  initialWorldState: {
    worldId: "world:test:no-synthetic-opportunity",
    nowSeconds: 30,
    entities: {
      "char:test:continuation": {
        id: "char:test:continuation",
        kind: "character",
        present: true,
        placeId: "place:test",
        zoneId: "hall",
      },
    },
    objects: {},
    signals: [],
    places: { "place:test": { topology: { zones: { hall: { id: "hall" } }, edges: [] } } },
  },
  actionRegistry: createWorldActionRegistry(),
});
const continuationRuntime = createCharacterWorldRuntime({
  coordinator: continuationCoordinator,
  actors: [continuationActor],
  situationProjector: () => ({ evidence: [] }),
});
await continuationRuntime.scheduleDueOwnedContinuations();
assert.deepEqual(continuationRuntime.readyQueue, []);
assert.deepEqual(continuationActor.mailbox, []);

// --- Immediate self-observation is retained with the outcome, not promoted to an empty full turn. ---
const observerId = "char:test:observer";
const observedObjectId = "object:test:mark";
const observerPort = createLocalCharacterRuntimePort({
  async runTurn(context) {
    return {
      characterId: observerId,
      agentTurnId: context.agentTurnId,
      privateStatePatch: {},
      privateResult: {},
      actionAttempt: {
        attemptId: `attempt:${context.agentTurnId}`,
        primitive: "observe",
        payload: { targetId: observedObjectId },
      },
    };
  },
  async applyWorldOutcome(outcome) {
    return {
      privateStatePatch: {
        retainedImmediateSelfEvidence: (outcome.deliveries || []).filter((row) => row.recipientCharacterId === observerId),
      },
    };
  },
});
const observerActor = createCharacterSessionActor({
  characterId: observerId,
  privateState: { ownerCharacterId: observerId },
  runtimePort: observerPort,
});
const observerCoordinator = createWorldCommitCoordinator({
  worldId: "world:test:self-observation",
  initialWorldState: {
    worldId: "world:test:self-observation",
    nowSeconds: 0,
    entities: {
      [observerId]: { id: observerId, kind: "character", present: true, placeId: "place:test", zoneId: "hall" },
    },
    objects: {
      [observedObjectId]: {
        id: observedObjectId,
        kind: "object",
        label: "木板上的一道新划痕",
        placeId: "place:test",
        zoneId: "hall",
        presentation: { publiclyVisible: true, exposure: "visible" },
      },
    },
    signals: [],
    places: { "place:test": { topology: { zones: { hall: { id: "hall" } }, edges: [] } } },
  },
  actionRegistry: createWorldActionRegistry(),
});
const observerRuntime = createCharacterWorldRuntime({
  coordinator: observerCoordinator,
  actors: [observerActor],
  situationProjector: ({ characterId, worldVersion, wake }) => ({
    authority: "recipient-specific-world-projection",
    recipientCharacterId: characterId,
    worldVersion,
    evidence: wake.evidence || [],
  }),
});
await observerRuntime.enqueueWake(observerId, {
  wakeId: "wake:test:self-observation:start",
  kind: "explicit_initial_activation",
  evidenceIds: [],
  evidence: [],
});
const observationTurn = await observerRuntime.runNext();
assert.equal(observationTurn.outcome.status, "success");
assert.deepEqual(observerRuntime.readyQueue, [], "an immediate self-result does not spend a second full Agent turn");
assert.equal(observerActor.mailbox.length, 0);
assert.ok(observerActor.privateState.retainedImmediateSelfEvidence[0].content.includes("划痕"));

// --- The production private reducer keeps that result for the next real wake. ---
const productionAttemptId = "action-attempt:test:production-observe";
const productionPreviousState = {
  ...structuredClone(luoActor.privateState),
  pendingAttemptContinuityById: {
    [productionAttemptId]: {
      actionAttemptId: productionAttemptId,
      sourceAgentTurnId: "agent-turn:test:production-observe",
      utterance: { literalSpeech: "" },
      realizedSpeechHabitIds: [],
    },
  },
};
const productionOutcomeTransition = reduceCharacterPrivateWorldOutcome({
  ownerCharacterId: LUO,
  previousPrivateState: productionPreviousState,
  nowSeconds: 12,
  worldOutcome: {
    authority: "world-resolution",
    outcomeId: "world-outcome:test:production-observe",
    eventId: "world-event:test:production-observe",
    actionAttemptId: productionAttemptId,
    agentTurnId: "agent-turn:test:production-observe",
    actorId: LUO,
    primitive: "observe",
    status: "success",
    worldVersion: 1,
    durationSeconds: 1,
    attemptSurface: [{ kind: "attention_oriented", actorId: LUO, targetId: "object:test:mark" }],
    resolvedEffects: [],
    failedEffects: [],
    incidentalEffects: [],
    deliveries: [{
      deliveryId: "delivery:test:production-observe",
      eventKind: "observation_result",
      modality: "visual",
      recipientCharacterId: LUO,
      sourceObjectId: "object:test:mark",
      content: "木板上有一道新划痕。",
    }, {
      deliveryId: "delivery:test:production-observe:own-result",
      eventKind: "own_action_result",
      modality: "proprioception",
      recipientCharacterId: LUO,
      sourceCharacterId: LUO,
      content: "刚才的动作已经落定。",
      semanticFrame: {
        actionResult: {
          status: "success",
          primitive: "observe",
          failureCodes: [],
          resolvedEffectKinds: [],
          incidentalEffectKinds: [],
          attemptSurfaceKinds: ["attention_oriented"],
        },
      },
    }],
  },
});
assert.equal(productionOutcomeTransition.privateStatePatch.retainedImmediateSelfEvidence.length, 2);
assert.equal(
  productionOutcomeTransition.privateStatePatch.retainedImmediateSelfEvidence[0].evidenceId,
  "evidence:delivery:test:production-observe",
);
assert.equal(
  productionOutcomeTransition.privateStatePatch.retainedImmediateSelfEvidence[1].semanticFrame.actionResult.status,
  "success",
);
const nextRealWakeInput = buildTavernCharacterAgentInputV27({
  characterId: LUO,
  agentTurnId: "agent-turn:test:next-real-wake",
  expectedWorldVersion: 1,
  wake: { kind: "world_evidence" },
  worldProjection: { ...projection, evidence: [] },
  privateContext: {
    ...productionPreviousState,
    ...productionOutcomeTransition.privateStatePatch,
  },
}, luoRecord);
assert.ok(nextRealWakeInput.perceivedImpacts.some((row) => row.content.includes("新划痕")));
assert.ok(nextRealWakeInput.perceivedImpacts.some((row) => (
  row.type === "own_action_result"
  && row.semanticFrame?.actionResult?.primitive === "observe"
)));

// --- A receipt scope the host froze for this turn bounds what stays citable. ---
const expiredRetainedRow = {
  ...structuredClone(productionOutcomeTransition.privateStatePatch.retainedImmediateSelfEvidence[1]),
  evidenceId: "evidence:test:expired-self-result",
  deliveryId: "delivery:test:expired-self-result",
  content: "一条回执账本早已过期的自查结果。",
};
const receiptScopedPrivateState = {
  ...productionPreviousState,
  ...productionOutcomeTransition.privateStatePatch,
  retainedImmediateSelfEvidence: [
    productionOutcomeTransition.privateStatePatch.retainedImmediateSelfEvidence[0],
    expiredRetainedRow,
  ],
};
const liveEvidenceId = productionOutcomeTransition.privateStatePatch.retainedImmediateSelfEvidence[0].evidenceId;
const receiptScopedWakeInput = buildTavernCharacterAgentInputV27({
  characterId: LUO,
  agentTurnId: "agent-turn:test:next-real-wake-receipt-scope",
  expectedWorldVersion: 1,
  wake: { kind: "world_evidence" },
  worldProjection: { ...projection, evidence: [] },
  privateContext: receiptScopedPrivateState,
  hostReceiptEvidenceIds: [liveEvidenceId],
}, luoRecord);
assert.ok(
  JSON.stringify(receiptScopedWakeInput).includes(liveEvidenceId),
  "a retained self-result the receipt ledger still holds stays citable",
);
assert.equal(
  JSON.stringify(receiptScopedWakeInput).includes("evidence:test:expired-self-result"), false,
  "an expired retained self-result must not be offered as a citable reference",
);
assert.equal(
  JSON.stringify(receiptScopedWakeInput).includes("一条回执账本早已过期的自查结果"), false,
  "expired evidence may not surface its content either, or the Character is invited to cite an id settlement then rejects",
);
const receiptScopedStageInput = buildCharacterAgentStageInput(
  createTavernCharacterAgentV2Session({ ...receiptScopedWakeInput, submissionMode: "atomic" }),
);
assert.equal(
  receiptScopedStageInput.referenceContract.perceivedEvidenceIds.includes("evidence:test:expired-self-result"), false,
);
const unscoopedWakeInput = buildTavernCharacterAgentInputV27({
  characterId: LUO,
  agentTurnId: "agent-turn:test:next-real-wake-no-receipt-scope",
  expectedWorldVersion: 1,
  wake: { kind: "world_evidence" },
  worldProjection: { ...projection, evidence: [] },
  privateContext: receiptScopedPrivateState,
}, luoRecord);
assert.ok(
  JSON.stringify(unscoopedWakeInput).includes("evidence:test:expired-self-result"),
  "without a frozen receipt scope the retained self-evidence passes through untouched",
);
assert.ok(
  buildCharacterAgentStageInput(
    createTavernCharacterAgentV2Session({ ...unscoopedWakeInput, submissionMode: "atomic" }),
  ).referenceContract.perceivedEvidenceIds.includes("evidence:test:expired-self-result"),
  "the same retained row is citable when no scope was frozen, so the frozen scope is what withdraws it",
);

console.log("tavernV27CharacterLifeContracts:test passed");
