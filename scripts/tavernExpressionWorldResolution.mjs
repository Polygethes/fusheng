import assert from "node:assert/strict";

import {
  runTavernCausalScene,
  settleFreeActionAttempt,
  tavernCausalAgentDecisionSchema,
} from "../src/server/pipeline/tavernCausalScene.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const LUO = "char_xyy_luozhao";
const MOTHER = "char_xyy_xiemu";
const LETTER = "object_test_luo_visit_letter";

function buildState() {
  const state = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  state.tavernState.activeVisits = [];
  for (const character of state.characters) {
    const present = [LUO, MOTHER].includes(character.id);
    character.lifeState.present = present;
    if (!present) continue;
    character.currentLocationId = "loc_xyy_tavern";
    character.ecologyState.presence.locationId = "loc_xyy_tavern";
    character.ecologyState.presence.observableAtStage = true;
  }
  state.tavernState.objectLedger = {
    schemaVersion: 2,
    objects: {
      [LETTER]: {
        id: LETTER,
        label: "梯云宗拜帖",
        aliases: ["拜帖"],
        holderActorId: LUO,
        sceneId: "loc_xyy_tavern",
        zoneId: "hall",
        portable: true,
        custody: { storageMode: "packed", containerId: "luo-travel-pack", inHand: false },
        presentation: { exposure: "hidden", displayedToActorIds: [], publiclyVisible: false },
      },
    },
  };
  return state;
}

function seedFor(actorId, id) {
  return [{
    id,
    sourceCharacterId: "world:test-cue",
    sourceZoneId: "hall",
    locationId: "loc_xyy_tavern",
    type: "physical",
    modality: "visual",
    intensity: 100,
    radius: 0,
    directedTargetId: actorId,
    content: "门边有了一点动静。",
    topic: "测试动作分层",
  }];
}

function baseDecision(input, {
  speech = "",
  speechAct = "none",
  targetCharacterId = "",
  intendedGesture = "",
  primitive = "none",
  objectId = "",
} = {}) {
  const candidate = input.privateActionCandidates.find((row) => row.feasible);
  assert.ok(candidate);
  return {
    candidateId: candidate.candidateId,
    actionType: primitive === "none" ? (speech ? "speak" : "pass") : "act",
    speechAct,
    targetCharacterId,
    speech,
    visibleAction: intendedGesture,
    moveToZoneId: "",
    vocalMode: "conversational",
    affordanceId: "",
    informationSourceImpactId: "",
    commitmentAction: "none",
    commitmentTopic: "",
    decisionValue: "none",
    semanticFrameId: "",
    semanticRoleBindings: {},
    cognitiveAppraisal: { noticedEvidenceIds: [], interpretations: [], beliefOperations: [], threadAppraisals: [] },
    communicationPlan: {
      goal: speech ? "inform" : "none",
      tactic: speech ? "direct" : "silence",
      disclosure: speech ? "full" : "withhold",
      epistemicRelation: speech ? "believes" : "not_applicable",
      intendedAudienceCharacterIds: targetCharacterId && speech ? [targetCharacterId] : [],
      desiredEffect: speech ? "让店家听见自己的意思" : "",
      threadDisposition: "none",
    },
    utterance: { literalSpeech: speech, vocalMode: "conversational" },
    embodiedIntent: {
      manner: intendedGesture ? "动作简短，不把佩剑留在身后" : "保持原位",
      posture: "身体朝向堂前，佩剑仍贴身",
      intendedGesture,
    },
    actionAttempt: {
      primitive,
      objectId,
      targetCharacterId: primitive === "transfer" ? targetCharacterId : "",
      destinationId: "",
      affordanceId: "",
    },
    privateReason: "言语、身体意图和物理尝试是三件不同的事。",
  };
}

for (const required of ["utterance", "embodiedIntent", "actionAttempt"]) {
  assert.ok(tavernCausalAgentDecisionSchema.required.includes(required));
}

const observationResolution = settleFreeActionAttempt(
  { tavernState: { objectLedger: { objects: {} } } },
  {
    agents: {
      observer: { characterId: "observer", present: true, zoneId: "hall" },
      target: { characterId: "target", present: true, zoneId: "hall" },
    },
  },
  {
    actorId: "observer",
    actorZoneId: "hall",
    targetCharacterId: "target",
    speech: "",
    visibleAction: "观察者把注意定在对方收手的动作上。",
    observableAffectiveTexture: [{ channel: "gaze", modality: "visual", feature: "视线沿着对方收回的手停了一瞬" }],
    actionAttempt: { primitive: "observe", objectId: "", targetCharacterId: "target", destinationId: "", affordanceId: "" },
    actionAttemptFailures: [],
  },
);
assert.equal(observationResolution.status, "success");
assert.equal(observationResolution.attempt.primitive, "observe");
assert.ok(observationResolution.committedFacts.some((fact) => fact.kind === "attention_orientation" && fact.modality === "visual"));

let failedInput = null;
const failedTransfer = await runTavernCausalScene(buildState(), {
  allowOrphanVisitors: true,
  characterIds: [LUO, MOTHER],
  positions: { [LUO]: "hall", [MOTHER]: "hall" },
  seedImpacts: seedFor(LUO, "impact_failed_transfer"),
  maxSteps: 2,
  minimumActivationScore: 0,
  async runAgent(input) {
    if (input.agent.id !== LUO) return { decision: baseDecision(input) };
    failedInput = structuredClone(input);
    return { decision: baseDecision(input, {
      speech: "帖子不劳转交。",
      speechAct: "inform",
      targetCharacterId: MOTHER,
      intendedGesture: "洛照伸手去取行囊里的拜帖，想把它递到谢母面前",
      primitive: "transfer",
      objectId: LETTER,
    }) };
  },
});

assert.ok(failedInput.perceivedObjects.some((object) => object.id === LETTER && object.ownObject), `the Agent must receive its own concrete object state: ${JSON.stringify({ actor: failedInput.agent.id, objects: failedInput.perceivedObjects })}`);
assert.equal(failedTransfer.actions.length, 1);
const failedAction = failedTransfer.actions[0];
assert.equal(failedAction.utterance.literalSpeech, "帖子不劳转交。");
assert.equal(failedAction.speech, "帖子不劳转交。", "a failed handoff cannot censor simultaneous speech");
assert.equal(failedAction.embodiedIntent.intendedGesture.includes("拜帖"), true, "private intended movement remains auditable");
assert.equal(failedAction.actionAttempt.primitive, "transfer");
assert.equal(failedAction.worldResolution.status, "failed");
assert.ok(failedAction.worldResolution.failureCodes.includes("OBJECT_NOT_IN_HAND"));
assert.equal(failedAction.visibleAction, "", "an unsuccessful transfer is not published as an accomplished handoff");
assert.equal(failedTransfer.tavernState.objectLedger.objects[LETTER].holderActorId, LUO);
assert.equal(failedTransfer.tavernState.objectLedger.objects[LETTER].custody.inHand, false);
assert.ok(failedAction.deliveries.some((delivery) => delivery.recipientId === MOTHER && delivery.type === "speech"));
assert.equal(Object.hasOwn(failedTransfer.sceneRuntime.actions[0], "embodiedIntent"), false, "private body intent must not leak through public scene runtime");

const takeOutState = buildState();
const takeOut = await runTavernCausalScene(takeOutState, {
  allowOrphanVisitors: true,
  characterIds: [LUO, MOTHER],
  positions: { [LUO]: "hall", [MOTHER]: "hall" },
  seedImpacts: seedFor(LUO, "impact_take_out"),
  maxSteps: 2,
  minimumActivationScore: 0,
  async runAgent(input) {
    if (input.agent.id !== LUO) return { decision: baseDecision(input) };
    return { decision: baseDecision(input, {
      intendedGesture: "洛照把拜帖从行囊中取出，捏在自己手里",
      primitive: "take_out",
      objectId: LETTER,
    }) };
  },
});
assert.equal(takeOut.actions[0].worldResolution.status, "success");
assert.equal(takeOut.tavernState.objectLedger.objects[LETTER].holderActorId, LUO);
assert.equal(takeOut.tavernState.objectLedger.objects[LETTER].custody.inHand, true);

const handoffState = buildState();
handoffState.tavernState = structuredClone(takeOut.tavernState);
const handoff = await runTavernCausalScene(handoffState, {
  allowOrphanVisitors: true,
  characterIds: [LUO, MOTHER],
  positions: { [LUO]: "hall", [MOTHER]: "hall" },
  seedImpacts: seedFor(LUO, "impact_transfer_after_take_out"),
  maxSteps: 2,
  minimumActivationScore: 0,
  async runAgent(input) {
    if (input.agent.id !== LUO) return { decision: baseDecision(input) };
    return { decision: baseDecision(input, {
      intendedGesture: "洛照把已经取出的拜帖递向谢母",
      primitive: "transfer",
      objectId: LETTER,
      targetCharacterId: MOTHER,
    }) };
  },
});
assert.equal(handoff.actions[0].worldResolution.status, "success");
assert.equal(handoff.tavernState.objectLedger.objects[LETTER].holderActorId, MOTHER, "only the successful second operation changes custody");

console.log("tavernExpressionWorldResolution:test passed", {
  failedMixedOutput: {
    speech: failedAction.speech,
    attempt: failedAction.actionAttempt.primitive,
    worldStatus: failedAction.worldResolution.status,
    failureCodes: failedAction.worldResolution.failureCodes,
  },
  explicitSequence: [
    takeOut.actions[0].worldResolution.status,
    handoff.actions[0].worldResolution.status,
  ],
  finalHolder: handoff.tavernState.objectLedger.objects[LETTER].holderActorId,
});
