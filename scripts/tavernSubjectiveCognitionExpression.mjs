import assert from "node:assert/strict";

import {
  applyCharacterCognitiveAppraisal,
  createCharacterAgentMemoryState,
  encodeCharacterPerception,
} from "../src/engine/characterAgentMemory.js";
import { validateSemanticTurn } from "../src/engine/semanticTurnValidator.js";
import { validateTavernVoiceRealization } from "../src/server/pipeline/tavernCharacterVoice.mjs";
import {
  runTavernCausalScene,
  tavernCausalAgentDecisionSchema,
} from "../src/server/pipeline/tavernCausalScene.mjs";
import {
  applyObjectOperations,
  normalizeObjectLedger,
} from "../src/server/simulation/objectLedger.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const ACTOR = "char_test_operator";
const VISITOR = "char_test_visitor";

const ordinaryServiceLine = validateTavernVoiceRealization({
  speech: "客官，找人还是住店？",
  speechAct: "ask",
  characterId: ACTOR,
  targetCharacterId: VISITOR,
  voiceContract: {
    characterId: ACTOR,
    voiceFormation: { sourceOrder: ["人格", "当下状态", "关系", "表达策略"] },
    personalityVoice: { attentionPriorities: [], appraisalHabits: [] },
    expressionTendencies: { thoughtMovement: [], pressureResponse: {} },
    relationshipRegisters: {},
  },
  conversationRealization: {},
  affordanceType: "receive_guest",
  contextTopics: ["来客入店"],
});
assert.equal(ordinaryServiceLine.accepted, true, "ordinary situational speech must not be censored for lacking line-level distinctiveness");
assert.equal(ordinaryServiceLine.publicSpeech, "客官，找人还是住店？");

const falseOrMisrememberedSpeech = validateSemanticTurn({
  actorId: ACTOR,
  actorZoneId: "hall",
  targetCharacterId: VISITOR,
  speechAct: "answer",
  utterance: "周公子，方才我亲耳听见你说昨夜已经付过钱了。",
}, {
  characters: [
    { id: ACTOR, name: "店家" },
    { id: VISITOR, name: "来客" },
    { id: "char_test_zhou", name: "周珉", aliases: ["周公子"] },
  ],
  observations: [],
  facts: [],
  openConversations: [],
  zones: [{ id: "hall", label: "堂前" }],
});
assert.equal(falseOrMisrememberedSpeech.ok, true, "unsupported or wrongly addressed speech is a claim, not a world-state mutation");
assert.deepEqual(falseOrMisrememberedSpeech.hardViolations, []);
assert.ok(falseOrMisrememberedSpeech.claimAnnotations.some((row) => row.code === "DIALOGUE_TARGET_MISMATCH"));
assert.ok(falseOrMisrememberedSpeech.claimAnnotations.some((row) => row.code === "UNSUPPORTED_PERCEPTION_CLAIM"));
assert.ok(falseOrMisrememberedSpeech.claimAnnotations.some((row) => row.code === "UNSUPPORTED_TEMPORAL_CLAIM"));
assert.ok(falseOrMisrememberedSpeech.claimAnnotations.some((row) => row.code === "MISSING_OPEN_CONVERSATION_SOURCE"));

const impact = {
  id: "impact:test-claim",
  objectiveEventId: "event:test-utterance",
  sourceCharacterId: VISITOR,
  type: "speech",
  modality: "sound",
  content: "我已经付过钱了。",
  semanticFrame: {
    id: "frame:test-payment-claim",
    kind: "communication",
    predicate: "claim_payment_complete",
    topicId: "test-payment",
    roles: { actor: VISITOR, addressee: ACTOR },
    object: { id: "test-payment", label: "饭钱" },
    truthValue: "paid",
  },
  provenance: { kind: "firsthand", speakerCharacterId: VISITOR },
};
const delivery = {
  id: "delivery:test-claim",
  impactId: impact.id,
  objectiveEventId: impact.objectiveEventId,
  recipientId: ACTOR,
  sourceCharacterId: VISITOR,
  modality: "sound",
  content: impact.content,
  directed: true,
  receivedIntensity: 90,
  personalRelevance: 60,
  impactScore: 145,
  semanticFrame: impact.semanticFrame,
  provenance: impact.provenance,
};
const perceivedOnly = encodeCharacterPerception(createCharacterAgentMemoryState(ACTOR), {
  impact,
  delivery,
  beliefMode: "deferred",
  nowSeconds: 3,
  locationId: "loc_test_tavern",
  zoneId: "hall",
});
assert.equal(perceivedOnly.episodes.length, 1, "hearing a claim must preserve an owned experience");
assert.equal(perceivedOnly.beliefs.length, 0, "hearing a claim must not silently adopt its proposition");

const suspended = applyCharacterCognitiveAppraisal(perceivedOnly, {
  noticedEvidenceIds: [delivery.id],
  interpretations: [{ evidenceIds: [delivery.id], meaning: "来客声称已经付钱", confidenceBand: "high" }],
  beliefOperations: [{
    proposition: "来客已经付过这笔饭钱",
    operation: "suspend",
    confidenceBand: "low",
    sourceEvidenceIds: [delivery.id],
    reasoningMode: "direct",
  }],
}, {
  allowedEvidenceIds: [delivery.id],
  nowSeconds: 4,
});
assert.equal(suspended.valid, true);
assert.equal(suspended.memory.beliefs.length, 1);
assert.equal(suspended.memory.beliefs[0].status, "suspended", "the Character Agent may hear a claim and withhold belief");

assert.ok(tavernCausalAgentDecisionSchema.required.includes("cognitiveAppraisal"));
assert.ok(tavernCausalAgentDecisionSchema.required.includes("communicationPlan"));
assert.ok(tavernCausalAgentDecisionSchema.required.includes("speechFunctions"));
assert.ok(tavernCausalAgentDecisionSchema.properties.cognitiveAppraisal.required.includes("threadAppraisals"));
assert.ok(tavernCausalAgentDecisionSchema.required.includes("utterance"));
assert.ok(tavernCausalAgentDecisionSchema.required.includes("embodiedIntent"));
assert.ok(tavernCausalAgentDecisionSchema.required.includes("actionAttempt"));
assert.ok(tavernCausalAgentDecisionSchema.properties.communicationPlan.properties.tactic.enum.includes("evade"));
assert.ok(tavernCausalAgentDecisionSchema.properties.communicationPlan.properties.tactic.enum.includes("lie"));

const ledger = normalizeObjectLedger({
  objects: [{
    id: "visit-letter",
    label: "拜帖",
    holderActorId: VISITOR,
    sceneId: "loc_test_tavern",
    zoneId: "hall",
    custody: { storageMode: "packed", containerId: "visitor-pack", inHand: false },
    presentation: { exposure: "hidden", displayedToActorIds: [] },
  }],
});
const letter = ledger.objects["visit-letter"];
assert.equal(letter.holderActorId, VISITOR, "custody remains distinct from handling");
assert.equal(letter.custody.storageMode, "packed");
assert.equal(letter.custody.inHand, false);
assert.equal(letter.presentation.exposure, "hidden");
assert.deepEqual(letter.presentation.displayedToActorIds, []);

const objectActors = [
  { id: VISITOR, present: true, sceneId: "loc_test_tavern", zoneId: "hall" },
  { id: ACTOR, present: true, sceneId: "loc_test_tavern", zoneId: "hall" },
];
const objectTopology = { zones: [{ id: "hall", sceneId: "loc_test_tavern" }] };
const impossiblePackedTransfer = applyObjectOperations({
  ledger,
  actors: objectActors,
  topology: objectTopology,
  operations: [{ type: "transfer_attempt", objectId: "visit-letter", actorId: VISITOR, toHolderActorId: ACTOR }],
});
assert.equal(impossiblePackedTransfer.ok, false, "claiming or attempting a handoff cannot teleport an object out of a pack");
assert.equal(impossiblePackedTransfer.violations[0].code, "OBJECT_NOT_IN_HAND");
assert.equal(impossiblePackedTransfer.ledger.objects["visit-letter"].holderActorId, VISITOR);
assert.equal(impossiblePackedTransfer.ledger.objects["visit-letter"].custody.storageMode, "packed");

const explicitHandoff = applyObjectOperations({
  ledger,
  actors: objectActors,
  topology: objectTopology,
  operations: [
    { type: "take_out", objectId: "visit-letter", actorId: VISITOR },
    { type: "show", objectId: "visit-letter", actorId: VISITOR, displayedToActorIds: [ACTOR] },
    { type: "transfer_attempt", objectId: "visit-letter", actorId: VISITOR, toHolderActorId: ACTOR },
  ],
});
assert.equal(explicitHandoff.ok, true);
assert.equal(explicitHandoff.ledger.objects["visit-letter"].holderActorId, ACTOR);
assert.equal(explicitHandoff.ledger.objects["visit-letter"].custody.inHand, true);

const tavernState = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
const MOTHER = "char_xyy_xiemu";
const LUO = "char_xyy_luozhao";
for (const character of tavernState.characters) {
  const present = [MOTHER, LUO].includes(character.id);
  character.lifeState.present = present;
  if (!present) continue;
  character.currentLocationId = "loc_xyy_tavern";
  character.ecologyState.presence.locationId = "loc_xyy_tavern";
  character.ecologyState.presence.observableAtStage = true;
}
let anonymousInput = null;
const anonymousExchange = await runTavernCausalScene(tavernState, {
  allowOrphanVisitors: true,
  characterIds: [MOTHER, LUO],
  positions: { [MOTHER]: "hall", [LUO]: "hall" },
  seedImpacts: [{
    id: "impact:test-anonymous-arrival",
    sourceCharacterId: LUO,
    sourceZoneId: "hall",
    locationId: "loc_xyy_tavern",
    type: "speech",
    modality: "sound",
    intensity: 96,
    radius: 1,
    directedTargetId: MOTHER,
    content: "劳驾。",
    topic: "陌生来客入店",
  }],
  maxSteps: 1,
  minimumActivationScore: 0,
  async runAgent(input) {
    anonymousInput = structuredClone(input);
    const stranger = input.perceivedCharacters.find((row) => row.identityKnown === false);
    assert.ok(stranger?.id?.startsWith("perceived_entity:"));
    const candidate = input.privateActionCandidates.find((row) => row.feasible && row.targetCharacterId === stranger.id)
      || input.privateActionCandidates.find((row) => row.feasible);
    return { decision: {
      candidateId: candidate.candidateId,
      actionType: "act",
      speechAct: "none",
      targetCharacterId: stranger.id,
      speech: "",
      visibleAction: "谢母抬起头，看向门边的来客",
      moveToZoneId: "",
      affordanceId: "",
      informationSourceImpactId: "",
      commitmentAction: "none",
      commitmentTopic: "陌生来客入店",
      decisionValue: "none",
      semanticFrameId: candidate.semanticFrame?.id || "",
      semanticRoleBindings: candidate.semanticFrame?.roles || {},
      cognitiveAppraisal: {
        noticedEvidenceIds: [input.activation.evidenceId],
        interpretations: [{
          evidenceIds: [input.activation.evidenceId],
          meaning: "有个陌生来客进了堂前",
          confidenceBand: "high",
        }],
        beliefOperations: [],
      },
      communicationPlan: {
        goal: "none",
        tactic: "silence",
        disclosure: "withhold",
        epistemicRelation: "not_applicable",
        intendedAudienceCharacterIds: [],
        desiredEffect: "先确认来客确实进入堂前",
        threadDisposition: "none",
      },
      privateReason: "来客身份未明，先看清对方停在哪里。",
    } };
  },
});
const anonymousSerialized = JSON.stringify(anonymousInput);
assert.equal(anonymousSerialized.includes(LUO), false, "an unknown person's canonical id must not enter another Character Agent input");
const leakedNameIndex = anonymousSerialized.indexOf("洛照");
assert.equal(
  leakedNameIndex >= 0,
  false,
  `an unknown person's canonical name must not enter another Character Agent input: ${anonymousSerialized.slice(Math.max(0, leakedNameIndex - 160), leakedNameIndex + 220)}`,
);
assert.equal(anonymousExchange.actions.length, 1, JSON.stringify(anonymousExchange.decisions, null, 2));
assert.equal(anonymousExchange.actions[0].targetCharacterId, LUO, "the server resolves the opaque handle only after the Character Agent chooses");
assert.equal(anonymousExchange.actions[0].speech, "");

const selfClaimState = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
for (const character of selfClaimState.characters) {
  const present = [MOTHER, LUO].includes(character.id);
  character.lifeState.present = present;
  if (!present) continue;
  character.currentLocationId = "loc_xyy_tavern";
  character.ecologyState.presence.locationId = "loc_xyy_tavern";
  character.ecologyState.presence.observableAtStage = true;
}
selfClaimState.tavernState.eventThreads = [{
  id: "thread:self-name-claim",
  topic: "陌生来客自报姓名",
  participantIds: [LUO, MOTHER],
  status: "open",
  nextObligationCharacterId: MOTHER,
  turns: [{
    turnId: "turn:luo:self-name-claim",
    speakerId: LUO,
    addresseeId: MOTHER,
    line: "我叫洛照。",
    speechAct: "inform",
    speechFunctions: ["inform"],
  }],
}];
let selfClaimInput = null;
await runTavernCausalScene(selfClaimState, {
  allowOrphanVisitors: true,
  characterIds: [MOTHER, LUO],
  positions: { [MOTHER]: "hall", [LUO]: "hall" },
  seedImpacts: [{
    id: "impact:test-self-name-claim",
    sourceCharacterId: LUO,
    sourceZoneId: "hall",
    locationId: "loc_xyy_tavern",
    type: "speech",
    modality: "sound",
    intensity: 100,
    radius: 1,
    directedTargetId: MOTHER,
    content: "我叫洛照。",
    topic: "陌生来客自报姓名",
  }],
  maxSteps: 1,
  minimumActivationScore: 0,
  async runAgent(input) {
    selfClaimInput = structuredClone(input);
    const candidate = input.privateActionCandidates.find((row) => row.feasible);
    return { decision: {
      candidateId: candidate.candidateId,
      actionType: "pass",
      speechAct: "none",
      speechFunctions: [],
      targetCharacterId: "",
      speech: "",
      visibleAction: "",
      moveToZoneId: "",
      affordanceId: "",
      informationSourceImpactId: "",
      commitmentAction: "none",
      commitmentTopic: "",
      decisionValue: "none",
      semanticFrameId: candidate.semanticFrame?.id || "",
      semanticRoleBindings: candidate.semanticFrame?.roles || {},
      privateReason: "测试只检查听见姓名与确认身份是否仍然分层。",
    } };
  },
});
const selfClaimStranger = selfClaimInput.perceivedCharacters.find((row) => row.identityKnown === false);
assert.ok(selfClaimStranger);
assert.equal(selfClaimStranger.name, "", "a self-claimed name does not automatically verify physical identity");
assert.ok(selfClaimStranger.noticedFeatures.some((feature) => (
  feature.modality === "sound" && feature.feature.includes("我叫洛照")
)), "the literal name carried by noticed speech must survive identity projection");
const selfClaimThread = selfClaimInput.openConversationThreads.find((thread) => thread.id === "thread:self-name-claim");
assert.ok(selfClaimThread);
assert.equal(selfClaimThread.turns[0].utterance, "我叫洛照。");
assert.deepEqual(selfClaimThread.publicContentLedger.mentionedCharacterNames, ["洛照"]);

console.log("tavernSubjectiveCognitionExpression:test passed", {
  voiceDiagnostics: ordinaryServiceLine.diagnosticFindings?.map((row) => row.code) || [],
  claimAnnotations: falseOrMisrememberedSpeech.claimAnnotations.map((row) => row.code),
  beliefStatus: suspended.memory.beliefs[0].status,
  objectState: { custody: letter.custody, presentation: letter.presentation },
  packedTransferFailure: impossiblePackedTransfer.violations[0].code,
  anonymousTargetHandle: anonymousInput.perceivedCharacters.find((row) => row.identityKnown === false)?.id,
});
