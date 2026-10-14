import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  CHARACTER_PSYCHOLOGY_AUTHORING_RECORDS,
  CHARACTER_PSYCHOLOGY_ANCHORS,
  RETIRED_STATIC_CHARACTER_FOUNDATION_IDS,
  getCharacterPsychologyAnchor,
  getCharacterPsychologyAuthoringRecord,
  validateCharacterPsychologyAnchor,
} from "../src/server/ecology/characterPsychologyAnchor.mjs";
import { getTavernEcologyProfile } from "../src/server/ecology/tavernEcologyProfile.mjs";
import {
  buildTavernVoiceContract,
} from "../src/server/pipeline/tavernCharacterVoice.mjs";
import { runTavernCausalScene } from "../src/server/pipeline/tavernCausalScene.mjs";

const LUO_ID = "char_xyy_luozhao";
const anchor = getCharacterPsychologyAnchor(LUO_ID);
const authoringRecord = getCharacterPsychologyAuthoringRecord(LUO_ID);

assert.equal(Object.isFrozen(CHARACTER_PSYCHOLOGY_ANCHORS), true);
assert.equal(Object.isFrozen(CHARACTER_PSYCHOLOGY_AUTHORING_RECORDS), true);
assert.equal(Object.isFrozen(anchor), true);
assert.equal(Object.isFrozen(authoringRecord), true);
assert.equal(anchor.status, "validated");
assert.equal(anchor.runtimeSurface, "character-foundation");
assert.ok(RETIRED_STATIC_CHARACTER_FOUNDATION_IDS.includes(LUO_ID));
assert.deepEqual(validateCharacterPsychologyAnchor(anchor), { valid: true, errors: [] });
assert.deepEqual(validateCharacterPsychologyAnchor(authoringRecord), { valid: true, errors: [] });
assert.equal(Object.hasOwn(anchor, "evidence"), false);
assert.equal(Object.hasOwn(anchor, "validation"), false);
assert.equal(Object.hasOwn(anchor, "actionPolicy"), false);

assert.equal(authoringRecord.evidence.conflicts[0].hierarchy.primary, "cannot-tolerate-own-weakness");
assert.equal(authoringRecord.evidence.conflicts[0].hierarchy.secondary, "sect-arranged-path-may-not-be-her-own");
assert.equal(authoringRecord.evidence.openChoiceAxes[0].resolution, "story-open");
assert.equal(anchor.identityModel.openChoiceAxes[0].resolution, "story-open");

const xieKnowledge = anchor.epistemics.knownEntities.find((row) => row.entityId === "char_xyy_xiezenshi");
assert.deepEqual(
  { knowsName: xieKnowledge.knowsName, recognizesIdentity: xieKnowledge.recognizesIdentity, basis: xieKnowledge.basis },
  { knowsName: true, recognizesIdentity: false, basis: "hearsay" },
);
assert.ok(anchor.epistemics.sourceReliability.direct[0] > anchor.epistemics.sourceReliability.hearsay[1]);

const duelDesire = anchor.desires[0];
assert.equal(duelDesire.ownerCharacterId, LUO_ID);
assert.equal(duelDesire.desiredState.subjectCharacterId, LUO_ID);
assert.match(duelDesire.desiredState.object, /自己.*完整状态.*新的极限/u);
assert.doesNotMatch(duelDesire.desiredState.verb, /^(?:不|别|勿|拒绝|避免)/u);
assert.ok(duelDesire.unresolvedDynamics.retentionRange[0] >= 0.85);

const publicTrouble = anchor.inhibitors.find((row) => row.id === "inhibitor_luozhao_irrelevant_public_trouble");
assert.match(publicTrouble.meaning, /无关麻烦|干扰/u);
assert.match(publicTrouble.doesNotMean, /羞耻|评价/u);

assert.deepEqual(
  authoringRecord.actionPolicy.candidateFamilies.map((row) => row.id),
  [
    "observe-before-identifying",
    "reveal-sword-intent",
    "question-deliberate-avoidance",
    "controlled-probe",
    "wait-for-valid-opponent-state",
    "return-after-unresolved-frustration",
  ],
);

assert.deepEqual(
  authoringRecord.speechPolicy.evidenceAnchors.map((row) => row.line),
  ["你打算一直装作没看见？", "好剑。", "我会再来。"],
);
assert.equal(Object.hasOwn(anchor.speechPolicy, "evidenceAnchors"), false);

const excellentSwordUpdate = anchor.relationshipModel.updateRules.find((row) => row.id === "luo-observes-excellent-sword");
assert.ok(excellentSwordUpdate.deltas.competenceRespect[0] > 0);
assert.ok(excellentSwordUpdate.deltas.rivalry[0] > 0);
assert.deepEqual(excellentSwordUpdate.deltas.trust, [0, 0]);
assert.deepEqual(excellentSwordUpdate.deltas.care, [0, 0]);
assert.deepEqual(excellentSwordUpdate.deltas.affection, [0, 0]);
assert.equal(authoringRecord.validation.holdouts.length, 3);
assert.ok(authoringRecord.validation.holdouts.every((row) => row.accepted === true));

const invalidOwner = structuredClone(authoringRecord);
invalidOwner.desires[0].ownerCharacterId = "char_xyy_xiezenshi";
assert.equal(validateCharacterPsychologyAnchor(invalidOwner).valid, false);

const relationshipLoss = structuredClone(authoringRecord);
relationshipLoss.relationshipModel.updateRules[0].deltas.trust = [-0.2, -0.08];
assert.equal(validateCharacterPsychologyAnchor(relationshipLoss).valid, true, "generic relationship deltas must support losses as well as gains");

const invalidRelationshipDelta = structuredClone(authoringRecord);
invalidRelationshipDelta.relationshipModel.updateRules[0].deltas.trust = [-1.2, -0.8];
assert.equal(validateCharacterPsychologyAnchor(invalidRelationshipDelta).valid, false);

const ecologyProfile = getTavernEcologyProfile(LUO_ID);
assert.equal(ecologyProfile.psychologyAnchor, anchor);
assert.equal(ecologyProfile.desires[0].id, duelDesire.id);
assert.match(ecologyProfile.desires[0].desiredState.object, /自己.*完整状态.*新的极限/u);
assert.equal(Object.hasOwn(ecologyProfile.desires[0].satisfactionCondition.criteria, "explicitConsentRequired"), false);
assert.equal(ecologyProfile.desires[0].satisfactionCondition.type, "validated_anchor_evidence");
assert.equal(ecologyProfile.desires[0].satisfactionCondition.criteria.anchorDesireId, duelDesire.id);
assert.deepEqual(ecologyProfile.boundaries, []);
assert.deepEqual(ecologyProfile.sensitivities, []);
assert.deepEqual(ecologyProfile.runtimeAuthority.legacyPsychologyFieldsUsed, []);

const voiceContract = buildTavernVoiceContract({ id: LUO_ID, name: "洛照" });
assert.equal(Object.hasOwn(voiceContract, "evidenceAnchors"), false);
assert.doesNotMatch(JSON.stringify(voiceContract), /你打算一直装作没看见|好剑|我会再来/u);
assert.equal(Object.hasOwn(voiceContract, "sentenceShape"), false);
assert.match(voiceContract.voiceFormation.surfaceFreedom, /不设目标字数、分句数/u);
assert.match(JSON.stringify(voiceContract.expressionTendencies.pressureResponse), /回避|问题/u);
assert.match(voiceContract.expressionTendencies.silenceStyle, /观察/u);

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
const luo = state.characters.find((character) => character.id === LUO_ID);
assert.ok(luo);
assert.equal(luo.psychologyAnchor.status, "validated");
assert.match(luo.internalSituation.fearOfBeingSeen, /自己.*弱小/u);
assert.match(luo.lifeProfile.privatePursuit, /自己.*极限/u);
assert.deepEqual(luo.lifeProfile.tavernAgency.knowledgeBoundary.hearsayActorIds, ["char_xyy_xiezenshi"]);
assert.deepEqual(luo.lifeProfile.tavernAgency.knowledgeBoundary.identityUnknownActorIds, ["char_xyy_xiezenshi"]);

let captured = null;
await runTavernCausalScene(state, {
  allowOrphanVisitors: true,
  characterIds: [LUO_ID],
  positions: { [LUO_ID]: "hall" },
  seedImpacts: [{
    id: "impact:anchor-contract:door-chime",
    sourceZoneId: "hall",
    type: "ambient_event",
    modality: "sound",
    intensity: 92,
    radius: 3,
    content: "门边铜铃轻响了一声。",
    topic: "门边动静",
  }],
  maxSteps: 1,
  minimumActivationScore: 0,
  async runAgent(input) {
    captured = structuredClone(input);
    const withheldCandidate = input.privateActionCandidates.find((candidate) => candidate.feasible);
    return { decision: {
      candidateId: withheldCandidate?.candidateId || "",
      actionType: "pass",
      speechAct: "none",
      targetCharacterId: "",
      speech: "",
      visibleAction: "",
      moveToZoneId: "",
      affordanceId: "",
      informationSourceImpactId: "",
      commitmentAction: "none",
      commitmentTopic: "",
      privateReason: "只捕获人物锚定材料。",
    } };
  },
});

assert.equal(captured.agent.psychologyAnchor.status, "validated");
assert.equal(captured.agent.psychologyAnchor.characterId, LUO_ID);
assert.equal(captured.agent.psychologyAnchor.runtimeSurface, "character-foundation");
assert.equal(Object.hasOwn(captured.agent.psychologyAnchor, "actionPolicy"), false);
assert.equal(Object.hasOwn(captured.agent.psychologyAnchor, "validation"), false);
assert.equal(captured.agent.privateState.ecologyProfile.psychologyAnchor.characterId, LUO_ID);

console.log("characterPsychologyAnchor:test passed", {
  characterId: LUO_ID,
  speechAnchors: authoringRecord.speechPolicy.evidenceAnchors.length,
  holdouts: authoringRecord.validation.holdouts.length,
});
