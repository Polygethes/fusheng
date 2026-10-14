import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  createCharacterAgentMemoryState,
  encodeCharacterPerception,
  normalizeSemanticFrame,
} from "../src/engine/characterAgentMemory.js";
import { createInitialEcologyState } from "../src/server/ecology/tavernEcologyState.mjs";
import {
  compileValidatedCharacterAnchorRuntime,
  getValidatedCharacterAnchorRuntime,
} from "../src/server/ecology/validatedCharacterAnchorRuntime.mjs";
import { applyTavernEcologyOutcome } from "../src/server/pipeline/tavernEcologyOutcome.mjs";
import { appraiseTavernAgentEcology } from "../src/server/pipeline/tavernEcologyRuntime.mjs";
import { buildTavernVoiceContract } from "../src/server/pipeline/tavernCharacterVoice.mjs";
import {
  buildTavernSceneRuntime,
  createImpactFactor,
  deliverImpactFactor,
  runTavernCausalScene,
} from "../src/server/pipeline/tavernCausalScene.mjs";
import { scoreActionCandidates } from "../src/server/simulation/actionUtility.mjs";

const SCENE_ID = "scene_xyy_wangti_tavern";
const LOCATION_ID = "loc_xyy_tavern";
const XIE = "char_xyy_xiezenshi";
const ZHOU = "char_xyy_zhoumin";
const FATHER = "char_xyy_xieheng";
const MOTHER = "char_xyy_xiemu";
const LUO = "char_xyy_luozhao";
const RECOVERY_DESIRE = "desire_xiezenshi_obtain_father_help_and_recover";

const passed = [];
function accept(category, evidence) {
  passed.push({ category, passed: true, evidence });
}

function tavernWorld() {
  return buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
}

// 1. The formula may rank pressure, but the person can commit a different
// feasible candidate and the world must preserve that exact candidate id.
let capturedChoiceInput = null;
let nonTopChoice = null;
const nonTopRun = await runTavernCausalScene(tavernWorld(), {
  allowOrphanVisitors: true,
  characterIds: [XIE, FATHER, ZHOU],
  positions: { [XIE]: "hall", [FATHER]: "hall", [ZHOU]: "hall" },
  maxSteps: 1,
  minimumActivationScore: 0,
  seedImpacts: [{
    sourceCharacterId: "world:behavior-acceptance-cue",
    sourceZoneId: "hall",
    type: "institution",
    modality: "sound",
    intensity: 100,
    radius: 0,
    directedTargetId: XIE,
    content: "后院水声忽然停了；这只是供谢真石本人判断的现场变化。",
  }],
  async runAgent(input) {
    capturedChoiceInput = structuredClone(input);
    const ranked = (input.privateActionCandidates || [])
      .filter((candidate) => candidate.feasible)
      .sort((left, right) => right.activationScore - left.activationScore);
    assert.ok(ranked.length >= 2, "Xie Zhenshi must receive multiple feasible choices");
    nonTopChoice = ranked.find((candidate, index) => (
      index > 0
      && candidate.driveId.startsWith("desire_xiezenshi_")
      && !candidate.realization?.affordanceId
      && candidate.realization?.requireSpeech !== true
    )) || ranked[1];
    return { decision: {
      candidateId: nonTopChoice.candidateId,
      actionType: "act",
      speechAct: "none",
      targetCharacterId: "",
      speech: "",
      visibleAction: "谢真石没有追着最强的压力行动，只低头按了按旧伤处，重新判断自己现在能做什么。",
      moveToZoneId: "",
      vocalMode: "conversational",
      affordanceId: "",
      informationSourceImpactId: "",
      commitmentAction: "none",
      commitmentTopic: "",
      decisionValue: "none",
      privateReason: "这是我选择的可行手段，不是评分器替我选的最高项。",
    } };
  },
});
const formulaTop = capturedChoiceInput.privateActionCandidates
  .filter((candidate) => candidate.feasible)
  .sort((left, right) => right.activationScore - left.activationScore)[0];
assert.notEqual(nonTopChoice.candidateId, formulaTop.candidateId);
assert.equal(nonTopRun.decisions[0]?.candidateId, nonTopChoice.candidateId);
assert.equal(nonTopRun.decisions[0]?.choiceAuthority, "character-agent");
accept("agent_non_top_choice", {
  formulaTop: formulaTop.candidateId,
  characterChoice: nonTopChoice.candidateId,
});

// 2. Delay is not fulfillment. An unresolved anchored desire keeps its identity,
// remains unsatisfied, and gains pressure through the real outcome updater.
const delayedSource = createInitialEcologyState(XIE, { elapsedSeconds: 20 });
delayedSource.desires[RECOVERY_DESIRE].frustration = 0.2;
delayedSource.desires[RECOVERY_DESIRE].urgency = 0.3;
delayedSource.currentIntention = {
  intentionId: "intention:xiezenshi:seek-help",
  sourceKind: "desire",
  sourceId: RECOVERY_DESIRE,
  driveId: RECOVERY_DESIRE,
  actionId: "consider-private-help",
  actionKind: "seek_private_help",
  target: { type: "character", id: FATHER },
  targetCharacterId: FATHER,
  utility: 0.76,
  committedAtSecond: 20,
  ageSeconds: 30,
};
const delayed = applyTavernEcologyOutcome({
  ecologyState: delayedSource,
  selectedCandidate: {
    id: "defer:xiezenshi:seek-help",
    driveId: RECOVERY_DESIRE,
    actionKind: "defer",
    targetCharacterId: FATHER,
  },
  evaluation: { feasible: true, activationScore: 64 },
  action: { committed: true, actionKind: "defer" },
  materialConsequence: {},
  elapsedSeconds: 60,
});
assert.equal(delayed.desires[RECOVERY_DESIRE].satisfaction, 0);
assert.ok(delayed.desires[RECOVERY_DESIRE].frustration > 0.2);
assert.ok(delayed.desires[RECOVERY_DESIRE].urgency > 0.3);
assert.equal(delayed.currentIntention.sourceId, RECOVERY_DESIRE);
assert.equal(delayed.lastOutcome.intentionTransition, "retained_while_deferred");
accept("unresolved_desire_survives_delay", {
  desireId: RECOVERY_DESIRE,
  beforeFrustration: 0.2,
  afterFrustration: delayed.desires[RECOVERY_DESIRE].frustration,
});

// 3. A report and a firsthand perception may carry the same proposition, but
// they must not produce the same autobiographical or epistemic state.
const recommendationFrame = normalizeSemanticFrame({
  id: "frame:behavior-acceptance:recommendation",
  kind: "social_request",
  predicate: "request_recommendation",
  topicId: "inner_sect_recommendation",
  roles: {
    requester: ZHOU,
    requestedActor: XIE,
    beneficiary: ZHOU,
    ultimateRecipient: "char_xyy_yanzhizhong",
  },
  object: { id: "inner_sect_assessment", label: "内门考核举荐" },
  requestedAct: "向掌籍长老举荐周珉参加内门考核",
  lexicalAnchors: ["举荐", "内门"],
  importance: 0.9,
});
const observerId = "char_behavior_acceptance_observer";
function encodedKnowledge(kind) {
  const gossip = kind === "gossip";
  const impactId = `impact:behavior-acceptance:${kind}`;
  const impact = {
    id: impactId,
    objectiveEventId: "event:zhou-asks-xie",
    sourceCharacterId: gossip ? ZHOU : XIE,
    directedTargetId: observerId,
    type: "speech",
    modality: "sound",
    content: gossip ? "听人说，谢真石已经答应举荐。" : "我答应举荐。",
    topic: "举荐答复",
    semanticFrame: { ...recommendationFrame, truthValue: "accepted" },
    provenance: gossip ? {
      kind: "gossip",
      speakerCharacterId: ZHOU,
      claimedOriginalSourceId: XIE,
      sourceCharacterChain: [XIE, ZHOU],
      sourceImpactIds: ["impact:original-xie-answer"],
    } : {
      kind: "firsthand",
      speakerCharacterId: XIE,
      sourceActionId: "action:xie-answers",
      sourceImpactIds: [],
    },
  };
  return encodeCharacterPerception(createCharacterAgentMemoryState(observerId), {
    impact,
    delivery: {
      id: `delivery:behavior-acceptance:${kind}`,
      impactId,
      objectiveEventId: impact.objectiveEventId,
      recipientId: observerId,
      sourceCharacterId: impact.sourceCharacterId,
      modality: "sound",
      content: impact.content,
      topic: impact.topic,
      directed: true,
      receivedIntensity: 90,
      personalRelevance: 50,
      distance: 0,
      provenance: impact.provenance,
      semanticFrame: impact.semanticFrame,
    },
    nowSeconds: 80,
    worldDay: 1,
    locationId: LOCATION_ID,
    zoneId: "hall",
  });
}
const directKnowledge = encodedKnowledge("firsthand");
const rumorKnowledge = encodedKnowledge("gossip");
assert.equal(directKnowledge.episodes[0].source.kind, "firsthand");
assert.equal(rumorKnowledge.episodes[0].kind, "reported_episode");
assert.equal(rumorKnowledge.episodes[0].source.kind, "gossip");
assert.deepEqual(rumorKnowledge.episodes[0].source.characterChain, [XIE, ZHOU]);
assert.ok(rumorKnowledge.episodes[0].source.confidence < directKnowledge.episodes[0].source.confidence);
assert.equal(rumorKnowledge.beliefs[0].status, "uncertain");
accept("rumor_differs_from_direct_knowledge", {
  directConfidence: directKnowledge.episodes[0].source.confidence,
  rumorConfidence: rumorKnowledge.episodes[0].source.confidence,
  rumorBeliefStatus: rumorKnowledge.beliefs[0].status,
});

// 4. World topology, not narrative convenience, decides propagation.
const propagationWorld = tavernWorld();
const propagationRuntime = buildTavernSceneRuntime(propagationWorld, {
  characterIds: [MOTHER, FATHER, LUO],
  positions: { [MOTHER]: "counter", [FATHER]: "hall", [LUO]: "guest_room" },
});
const publicSpeech = createImpactFactor({
  sourceCharacterId: MOTHER,
  sourceZoneId: "counter",
  type: "speech",
  modality: "sound",
  intensity: 90,
  radius: 3,
  directedTargetId: FATHER,
  content: "恒哥，门口像是有人。",
});
const deliveries = deliverImpactFactor(propagationWorld, propagationRuntime, publicSpeech);
assert.ok(deliveries.some((row) => row.recipientId === FATHER));
assert.ok(!deliveries.some((row) => row.recipientId === LUO));
accept("private_zone_blocks_propagation", {
  sourceZoneId: "counter",
  blockedRecipientZoneId: "guest_room",
  deliveredRecipientIds: deliveries.map((row) => row.recipientId),
});

// 5. Keep the desire inputs identical while changing only Xie -> Zhou's
// directional relationship. The live ecology layer may change coping and voice
// strategy, but must not change the desire's identity or pressure state.
const relationshipWorld = tavernWorld();
const xieCharacter = relationshipWorld.characters.find((row) => row.id === XIE);
const relationshipRuntime = {
  locationId: LOCATION_ID,
  elapsedSeconds: 120,
  macroDay: 1,
  macroTick: 1,
  step: 0,
  slotContext: { slotId: "behavior-relationship", slotBaseId: "afternoon", slotLabel: "午后" },
  requestLocks: [],
  actions: [],
  commitments: [],
};
const relationshipImpact = {
  impactId: "impact:zhou-relationship-expression",
  sourceCharacterId: ZHOU,
  directedTargetId: XIE,
  directed: true,
  type: "speech",
  modality: "sound",
  content: "真石，你愿不愿意听我把话说完？",
  topic: "举荐请求",
  impactScore: 92,
  provenance: {},
};
function relationshipAppraisal(row) {
  return appraiseTavernAgentEcology({
    character: structuredClone(xieCharacter),
    runtime: structuredClone(relationshipRuntime),
    actor: { present: true, zoneId: "hall" },
    pendingImpacts: [structuredClone(relationshipImpact)],
    visibleCharacterIds: [ZHOU],
    availableAffordances: [],
    recentOwnActions: [],
    relationships: [row],
  });
}
const closeAppraisal = relationshipAppraisal({
  id: "rel:xie:zhou:close",
  fromCharacterId: XIE,
  toCharacterId: ZHOU,
  dependence: 92,
  protection: 88,
  love: 84,
  resentment: 0,
  fear: 0,
  shame: 0,
  deception: 0,
});
const tenseAppraisal = relationshipAppraisal({
  id: "rel:xie:zhou:tense",
  fromCharacterId: XIE,
  toCharacterId: ZHOU,
  dependence: 0,
  protection: 0,
  love: 0,
  resentment: 95,
  fear: 88,
  shame: 92,
  deception: 70,
});
assert.deepEqual(closeAppraisal.desires, tenseAppraisal.desires);
const responseCandidateId = `impact:${relationshipImpact.impactId}:respond`;
const closeResponse = closeAppraisal.candidates.find((row) => row.id === responseCandidateId);
const tenseResponse = tenseAppraisal.candidates.find((row) => row.id === responseCandidateId);
assert.ok(closeResponse && tenseResponse);
assert.notDeepEqual(closeResponse.relationshipAppraisal, tenseResponse.relationshipAppraisal);
assert.notDeepEqual(closeResponse.expressionStrategy, tenseResponse.expressionStrategy);
accept("relationship_changes_expression_not_desire", {
  desireIds: closeAppraisal.desires.map((row) => row.id),
  closeExpression: closeResponse.expressionStrategy,
  tenseExpression: tenseResponse.expressionStrategy,
});

// 6. Calibration examples remain outside runtime. The compiled contract must
// preserve personality-driven expression without turning examples into mouth-shape rules.
const xieRuntime = getValidatedCharacterAnchorRuntime(SCENE_ID, XIE);
const voiceContract = buildTavernVoiceContract({
  id: XIE,
  name: "谢真石",
  sceneId: SCENE_ID,
  psychologyAnchor: xieRuntime.psychologyAnchor,
});
assert.equal(Object.hasOwn(voiceContract, "evidenceAnchors"), false);
assert.doesNotMatch(JSON.stringify(voiceContract), /小事。|我答应举荐|左脚落早/u);
assert.ok(voiceContract.psychologicalFunctions.pragmaticForms.length >= 3);
assert.equal(Object.hasOwn(voiceContract, "sentenceShape"), false);
assert.ok(voiceContract.personalityVoice.attentionPriorities.length > 0);
assert.ok(voiceContract.expressionTendencies.pressureResponse.attentionShift.length > 0);
accept("voice_changes_by_function", {
  evidenceLevel: "compiled-contract-support-only",
  pragmaticForms: voiceContract.psychologicalFunctions.pragmaticForms,
  personalityVoice: voiceContract.personalityVoice,
  pressureResponse: voiceContract.expressionTendencies.pressureResponse,
});

// 7. Same character, same options, different body state: mathematical pressure
// changes. This is candidate appraisal evidence, not a final-choice command.
const bodyCandidates = [
  {
    id: "full_sword_demonstration",
    actionKind: "demonstrate_full_form",
    factors: { desire: 0.9, opportunity: 0.9, bodyCost: 0.55 },
  },
  {
    id: "low_load_verbal_guidance",
    actionKind: "give_local_guidance",
    factors: { desire: 0.72, opportunity: 0.55, bodyCost: 0.08 },
  },
];
const restedBody = scoreActionCandidates({
  actor: { id: XIE, state: { fatigue: 0.05, hunger: 0, pain: 0 } },
  candidates: structuredClone(bodyCandidates),
  context: { atmosphere: { opportunity: 0, privacy: 0.8, crowding: 0 } },
});
const strainedBody = scoreActionCandidates({
  actor: { id: XIE, state: { fatigue: 0.95, hunger: 0, pain: 0.7 } },
  candidates: structuredClone(bodyCandidates),
  context: { atmosphere: { opportunity: 0, privacy: 0.8, crowding: 0 } },
});
assert.equal(restedBody.selectedCandidateId, "full_sword_demonstration");
assert.equal(strainedBody.selectedCandidateId, "low_load_verbal_guidance");
const fullRested = restedBody.evaluations.find((row) => row.candidateId === "full_sword_demonstration");
const fullStrained = strainedBody.evaluations.find((row) => row.candidateId === "full_sword_demonstration");
assert.ok(fullStrained.score < fullRested.score);
accept("body_state_changes_behavior", {
  evidenceLevel: "candidate-pressure-only",
  restedTop: restedBody.selectedCandidateId,
  strainedTop: strainedBody.selectedCandidateId,
});

// 8. Compile an unrelated character and scene through the same function. No
// name, id, desire, voice line, or scene fact may fall back to Luo or Xie.
const SYNTHETIC_SCENE = "scene_portability_ferry";
const SYNTHETIC_CHARACTER = "char_portability_ferry_keeper";
const syntheticAnchor = {
  schemaVersion: 1,
  status: "validated",
  characterId: SYNTHETIC_CHARACTER,
  characterName: "渡守",
  numericCalibrationStatus: "unassigned",
  sceneBindings: [{
    sceneId: SYNTHETIC_SCENE,
    reasonForPresence: "守着自己的渡船等涨潮退去。",
    currentPurpose: "在下一班客人到来前修好漏水的船板。",
  }],
  desires: [{
    id: "desire_ferry_keeper_repair_boat",
    ownerCharacterId: SYNTHETIC_CHARACTER,
    qualitativeStrength: "high_current",
    desiredState: {
      verb: "想",
      object: "把漏水的渡船修好",
      observableOutcome: "船板止漏并能安全载客",
    },
    target: "self",
    activationCues: ["船舱进水", "下一班客人将到"],
    progressEvidence: ["换下裂板", "试水不再渗漏"],
    satisfactionCondition: {
      requiredEvidence: "试水后船板不再渗漏",
      doesNotCount: ["只说准备修", "时间经过"],
    },
  }],
  speechPolicy: {
    silenceDefault: "修船时不为填空而说话。",
    pragmaticForms: ["先报水位，再说能不能开船"],
    forbiddenRegisters: ["后台状态语言"],
    pressureMutation: ["水势越急，句子越短"],
    relationshipRegisters: {},
    evidenceAnchors: [{
      function: "ferry_safety_warning",
      line: "水还急，等一刻。",
      evidenceId: "E_PORTABLE_FERRY_001",
    }],
  },
  relationshipModel: { forbiddenCollapses: ["付船钱不等于信任"] },
  memoryPolicy: { rumorPolicy: "转述水情只作待验证线索" },
  actionPolicy: {
    candidateFamilies: [{ id: "repair", label: "修船" }],
    invalidShortcuts: ["未试水便宣称修好"],
    domainControl: [],
  },
  dynamicPsychology: { updateRules: [] },
};
const portableRuntime = compileValidatedCharacterAnchorRuntime({
  sceneId: SYNTHETIC_SCENE,
  characterId: SYNTHETIC_CHARACTER,
  source: { authority: "acceptance-fixture" },
  anchor: syntheticAnchor,
  memorySeed: {
    schemaVersion: 1,
    ownerCharacterId: SYNTHETIC_CHARACTER,
    numericCalibrationStatus: "unassigned",
    episodes: [],
    beliefs: [],
    commitments: [],
    impressions: [],
  },
});
assert.equal(portableRuntime.sceneId, SYNTHETIC_SCENE);
assert.equal(portableRuntime.characterId, SYNTHETIC_CHARACTER);
assert.equal(portableRuntime.ecologyProjection.desires[0].id, "desire_ferry_keeper_repair_boat");
assert.equal(Object.hasOwn(portableRuntime.voiceProjection, "evidenceAnchors"), false);
assert.equal(Object.hasOwn(portableRuntime.voiceProjection, "sentenceShape"), false);
assert.match(portableRuntime.voiceProjection.pressureResponse.attentionShift, /收拢到眼前要点/u);
assert.doesNotMatch(JSON.stringify(portableRuntime), /水还急，等一刻/u);
assert.match(portableRuntime.presenceProjection.reasonForPresence, /渡船/u);
assert.doesNotMatch(JSON.stringify(portableRuntime), /luozhao|xiezenshi|洛照|谢真石/iu);
accept("non_luozhao_portability", {
  sceneId: portableRuntime.sceneId,
  characterId: portableRuntime.characterId,
  desireId: portableRuntime.ecologyProjection.desires[0].id,
});

const requiredCategories = [
  "agent_non_top_choice",
  "unresolved_desire_survives_delay",
  "rumor_differs_from_direct_knowledge",
  "private_zone_blocks_propagation",
  "relationship_changes_expression_not_desire",
  "voice_changes_by_function",
  "body_state_changes_behavior",
  "non_luozhao_portability",
];
assert.deepEqual(passed.map((row) => row.category), requiredCategories);
console.log(JSON.stringify({
  test: "validatedCharacterBehaviorAcceptance:test",
  evidenceLevel: "deterministic-causal-contract",
  characterId: XIE,
  passed,
}, null, 2));
