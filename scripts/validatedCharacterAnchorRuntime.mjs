import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  getValidatedCharacterAnchorRuntime,
  VALIDATED_CHARACTER_ANCHOR_RUNTIME_VERSION,
} from "../src/server/ecology/validatedCharacterAnchorRuntime.mjs";
import {
  getCharacterPsychologyAnchor,
  validateCharacterPsychologyAnchor,
} from "../src/server/ecology/characterPsychologyAnchor.mjs";
import {
  getTavernEcologyProfile,
  validateEcologyProfile,
} from "../src/server/ecology/tavernEcologyProfile.mjs";
import { createInitialEcologyState } from "../src/server/ecology/tavernEcologyState.mjs";
import { migrateTavernEcologyStateToProfile } from "../src/server/pipeline/tavernEcologyRuntime.mjs";
import { buildTavernVoiceContract } from "../src/server/pipeline/tavernCharacterVoice.mjs";
import { runTavernCausalScene } from "../src/server/pipeline/tavernCausalScene.mjs";

const SCENE_ID = "scene_xyy_wangti_tavern";
const CHARACTER_ID = "char_xyy_xiezenshi";
const SOURCE_PATH = `.codex/anchors/${SCENE_ID}/characters/${CHARACTER_ID}/character-foundation.json`;
const MEMORY_SOURCE_PATH = `.codex/anchors/${SCENE_ID}/characters/${CHARACTER_ID}/memory-seed.json`;
const EXPECTED_DESIRE_IDS = [
  "desire_xiezenshi_obtain_father_help_and_recover",
  "desire_xiezenshi_regain_calm_when_overwhelmed",
  "desire_xiezenshi_continue_observing_verified_high_skill",
];

const runtime = getValidatedCharacterAnchorRuntime(SCENE_ID, CHARACTER_ID);
assert.equal(runtime.schemaVersion, VALIDATED_CHARACTER_ANCHOR_RUNTIME_VERSION);
assert.equal(runtime.status, "runtime-mapped");
assert.equal(runtime.sceneId, SCENE_ID);
assert.equal(runtime.characterId, CHARACTER_ID);
assert.equal(runtime.source.path, SOURCE_PATH);
assert.equal(runtime.source.authority, "character-foundation");
assert.equal(runtime.source.generatedProjection, true);

const sourceText = await readFile(new URL(`../${SOURCE_PATH}`, import.meta.url), "utf8");
const sourceHash = createHash("sha256").update(sourceText).digest("hex");
assert.equal(runtime.source.sha256, sourceHash, "generated runtime registry must fail when the author anchor drifts");
const memorySourceText = await readFile(new URL(`../${MEMORY_SOURCE_PATH}`, import.meta.url), "utf8");
const memorySourceHash = createHash("sha256").update(memorySourceText).digest("hex");
assert.equal(runtime.source.memoryPath, MEMORY_SOURCE_PATH);
assert.equal(runtime.source.memorySha256, memorySourceHash, "generated memory projection must fail when the sourced seed drifts");
assert.equal(runtime.characterFoundation.runtimeSurface, "character-foundation");
assert.equal(runtime.candidatePolicy.authority, "generic-cognitive-core");
assert.equal(runtime.candidatePolicy.candidateSource, "perceived-world-affordances-plus-universal-primitives");
assert.equal(Object.hasOwn(runtime.characterFoundation, "actionPolicy"), false);
assert.equal(Object.hasOwn(runtime.characterFoundation, "validation"), false);
assert.equal(Object.hasOwn(runtime.characterFoundation.dynamicPsychology, "updateRules"), false);

const psychologyAnchor = getCharacterPsychologyAnchor(CHARACTER_ID, { sceneId: SCENE_ID });
assert.equal(psychologyAnchor, runtime.psychologyAnchor, "all runtime consumers must share one frozen psychology object");
assert.equal(Object.isFrozen(psychologyAnchor), true);
assert.deepEqual(validateCharacterPsychologyAnchor(psychologyAnchor), { valid: true, errors: [] });
assert.equal(psychologyAnchor.numericCalibrationStatus, "unassigned");
assert.deepEqual(psychologyAnchor.desires.map((row) => row.id), EXPECTED_DESIRE_IDS);
assert.match(psychologyAnchor.relationshipModel.forbiddenCollapses.join("\n"), /剑术敬佩不等于亲近/u);

const profile = getTavernEcologyProfile(CHARACTER_ID);
assert.deepEqual(validateEcologyProfile(profile), { valid: true, errors: [] });
assert.deepEqual(profile.desires.map((row) => row.id), EXPECTED_DESIRE_IDS);
assert.equal(profile.desires.some((row) => row.id === "desire_xiezenshi_decide_recommendation"), false);
assert.equal(profile.desires.some((row) => row.id === "desire_xiezenshi_prove_new_footwork"), false);
const conditionalSwordObservation = profile.desires.find((row) => row.id === "desire_xiezenshi_continue_observing_verified_high_skill");
assert.equal(conditionalSwordObservation.activationMode, "cue_gated");
assert.equal(conditionalSwordObservation.latentActivationCap, 0.12);
assert.ok(conditionalSwordObservation.activationPolicy.doesNotCount.includes("只听见对方提出过招"));
const initialEcology = createInitialEcologyState(profile);
assert.equal(initialEcology.desires[conditionalSwordObservation.id].activationState, "latent");
assert.equal(initialEcology.desires[conditionalSwordObservation.id].strength, 0.12, "conditional potential must not wake the character before its cue");
const legacyEcology = structuredClone(initialEcology);
delete legacyEcology.desires[conditionalSwordObservation.id].activationState;
legacyEcology.desires[conditionalSwordObservation.id].strength = conditionalSwordObservation.baseStrength;
const migratedEcology = migrateTavernEcologyStateToProfile(legacyEcology, profile);
assert.equal(migratedEcology.desires[conditionalSwordObservation.id].activationState, "latent");
assert.equal(migratedEcology.desires[conditionalSwordObservation.id].strength, 0.12, "old always-on state must migrate back to latent potential");
for (const desire of profile.desires) {
  assert.equal(desire.runtimeProjection?.numericAuthority, "engine-operational-default");
  assert.equal(desire.runtimeProjection?.authorNumericCalibration, "unassigned");
  assert.ok(Number.isFinite(desire.baseStrength) && desire.baseStrength >= 0 && desire.baseStrength <= 1);
  assert.ok(Number.isFinite(desire.growthPerHour) && desire.growthPerHour >= 0);
  assert.equal(desire.satisfactionCondition.type, "validated_anchor_evidence");
  assert.equal(desire.satisfactionCondition.criteria.anchorDesireId, desire.id);
  assert.ok(desire.satisfactionCondition.criteria.requiredEvidence);
  assert.ok(desire.satisfactionCondition.criteria.doesNotCount.includes("时间推进") || desire.id !== EXPECTED_DESIRE_IDS[2]);
}

const voiceContract = buildTavernVoiceContract({ id: CHARACTER_ID, name: "谢真石", psychologyAnchor });
assert.equal(voiceContract.authoritySource, "validated-character-anchor");
assert.equal(Object.hasOwn(voiceContract, "evidenceAnchors"), false);
assert.doesNotMatch(JSON.stringify(voiceContract), /小事。|小时候还不觉得|我答应举荐|左脚落早/u);
assert.equal(Object.hasOwn(voiceContract, "sentenceShape"), false);
assert.match(voiceContract.voiceFormation.surfaceFreedom, /不设目标字数、分句数/u);
assert.match(voiceContract.expressionTendencies.silenceStyle, /承认弱|行动进展/u);
assert.match(JSON.stringify(voiceContract.relationshipRegisters), /私下指导|完整示范|举荐/u);

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
const xie = state.characters.find((character) => character.id === CHARACTER_ID);
assert.ok(xie);
assert.ok(xie.agentMemory.episodes.some((episode) => episode.id === "episode:xiezenshi:childhood-unnamed-lake-discovery"));
assert.ok(xie.agentMemory.episodes.some((episode) => episode.id === "episode:xiezenshi:repeated-water-immersion-habit"));
assert.ok(xie.agentMemory.commitments.some((commitment) => (
  commitment.commitmentKind === "open_request_not_promise"
  && commitment.ownerRole === "requestedActor"
  && commitment.counterpartyCharacterId === "char_xyy_zhoumin"
)));
assert.equal(xie.agentMemory.selfNarrative.status, "no_explicit_identity_claim_authorized");
assert.match(xie.agentMemory.selfNarrative.emptyReason, /has not authorized/i);
assert.ok(xie.agentMemory.episodes.every((episode) => episode.runtimeProjection?.numericAuthority === "engine-operational-default"));
assert.doesNotMatch(JSON.stringify(xie.agentMemory), /周珉慢走|左脚落早|完整示范身体代价/u);
let captured = null;
await runTavernCausalScene(state, {
  allowOrphanVisitors: true,
  characterIds: [CHARACTER_ID, "char_xyy_xieheng", "char_xyy_zhoumin"],
  positions: {
    [CHARACTER_ID]: "hall",
    char_xyy_xieheng: "hall",
    char_xyy_zhoumin: "hall",
  },
  seedImpacts: [{
    sourceCharacterId: "world:anchor-runtime-probe",
    sourceZoneId: "hall",
    type: "institution",
    modality: "sound",
    intensity: 100,
    radius: 0,
    directedTargetId: CHARACTER_ID,
    content: "只用于激活谢真石并检查他本人的运行锚。",
  }],
  maxSteps: 1,
  minimumActivationScore: 0,
  async runAgent(input) {
    captured = structuredClone(input);
    const selected = input.privateActionCandidates.find((candidate) => candidate.feasible);
    return { decision: {
      candidateId: selected?.candidateId || "",
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
      privateReason: "仅捕获由人物锚生成的私有心理输入。",
    } };
  },
});

assert.equal(captured.agent.psychologyAnchor.characterId, CHARACTER_ID);
assert.equal(captured.agent.privateState.selfModel.authority, "validated-character-foundation-and-owned-memory-only");
assert.match(captured.agent.privateState.sceneRole.reasonForPresence, /谢家经营的酒馆|返家探亲/u);
assert.match(captured.agent.privateState.sceneRole.currentPurpose, /隐疾.*真实帮助|真实帮助.*隐疾/u);
assert.ok(captured.agent.privateState.sceneRole.responsibilities.includes("开门前补足当餐所需的柴和水"));
assert.match(captured.agent.privateState.privatePursuit, /练剑隐疾.*恢复/u);
const fatherRelationship = captured.agent.relationshipContext.find((row) => row.otherCharacterId === "char_xyy_xieheng");
const zhouRelationship = captured.agent.relationshipContext.find((row) => row.otherCharacterId === "char_xyy_zhoumin");
assert.match(fatherRelationship.ownedImpression.summary, /依靠父亲|不那么理解/u);
assert.match(zhouRelationship.ownedImpression.summary, /一起长大|及格线上下/u);
assert.equal(Object.hasOwn(fatherRelationship, "otherPrivateState"), false);
assert.equal(captured.agent.privateState.ecologyProfile.psychologyAnchor.characterId, CHARACTER_ID);
assert.deepEqual(captured.agent.privateState.ecologyProfile.desires.map((row) => row.id), EXPECTED_DESIRE_IDS);
assert.ok(captured.privateActionCandidates.some((candidate) => EXPECTED_DESIRE_IDS.includes(candidate.driveId)));
assert.ok(captured.privateActionCandidates
  .filter((candidate) => EXPECTED_DESIRE_IDS.includes(candidate.driveId))
  .every((candidate) => candidate.ownDecisionFactors?.anchorGuidance?.sourceCharacterId === CHARACTER_ID));
assert.ok(captured.privateActionCandidates
  .filter((candidate) => EXPECTED_DESIRE_IDS.includes(candidate.driveId))
  .every((candidate) => candidate.ownDecisionFactors?.anchorGuidance?.authority === "generic-cognitive-core"));
assert.doesNotMatch(JSON.stringify(captured.agent), /guide_zhou_by_repeat_stop_and_local_demo/u, "calibration action scripts must not enter the Character Agent");
assert.doesNotMatch(JSON.stringify(captured.agent.memoryContext), /周珉慢走|左脚落早|完整示范身体代价/u, "accepted holdouts must not become lived memory");

console.log("validatedCharacterAnchorRuntime:test passed", {
  sceneId: SCENE_ID,
  characterId: CHARACTER_ID,
  desires: profile.desires.length,
  candidateCount: captured.privateActionCandidates.length,
});
