import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  getValidatedCharacterAnchorRuntime,
  mergeValidatedCharacterAnchorMemoryState,
} from "../src/server/ecology/validatedCharacterAnchorRuntime.mjs";
import {
  getTavernEcologyProfile,
  validateEcologyProfile,
} from "../src/server/ecology/tavernEcologyProfile.mjs";
import { createCharacterAgentMemoryState } from "../src/engine/characterAgentMemory.js";
import { runTavernCausalScene } from "../src/server/pipeline/tavernCausalScene.mjs";
import { ensureTavernEcology } from "../src/server/pipeline/tavernEcologyRuntime.mjs";

const SCENE_ID = "scene_xyy_wangti_tavern";
const ZHOU = "char_xyy_zhoumin";
const XIE = "char_xyy_xiezenshi";
const DESIRE = "desire_zhoumin_become_inner_court_disciple";
const LEGACY_DESIRE = "desire_zhoumin_receive_recommendation_decision";
const FOUNDATION_PATH = `.codex/anchors/${SCENE_ID}/characters/${ZHOU}/character-foundation.json`;
const MEMORY_PATH = `.codex/anchors/${SCENE_ID}/characters/${ZHOU}/memory-seed.json`;
const LEGACY_SENTINEL = "LEGACY_ZHOUMIN_PRIVATE_SCRIPT_MUST_NOT_REACH_AGENT";

const runtime = getValidatedCharacterAnchorRuntime(SCENE_ID, ZHOU);
assert.ok(runtime, "a runtime-mapped Zhou Min must be present in the validated registry");
assert.equal(runtime.status, "runtime-mapped");
assert.equal(runtime.source.path, FOUNDATION_PATH);
assert.equal(runtime.source.authority, "character-foundation");
assert.equal(runtime.source.memoryPath, MEMORY_PATH);

const foundationText = await readFile(new URL(`../${FOUNDATION_PATH}`, import.meta.url), "utf8");
const memoryText = await readFile(new URL(`../${MEMORY_PATH}`, import.meta.url), "utf8");
assert.equal(runtime.source.sha256, createHash("sha256").update(foundationText).digest("hex"));
assert.equal(runtime.source.memorySha256, createHash("sha256").update(memoryText).digest("hex"));
assert.deepEqual(runtime.characterFoundation.desires.map((row) => row.id), [DESIRE]);
assert.equal(runtime.characterFoundation.identityModel.openChoiceAxes.some((row) => (
  row.id === "axis_zhoumin_pressure_and_moral_compromise" && row.resolution === "story-open"
)), true);
assert.equal(Object.hasOwn(runtime.characterFoundation, "validation"), false);
assert.equal(Object.hasOwn(runtime.characterFoundation, "actionPolicy"), false);
assert.equal(Object.hasOwn(runtime.characterFoundation.dynamicPsychology, "updateRules"), false);
assert.equal(runtime.candidatePolicy.authority, "generic-cognitive-core");

const profile = getTavernEcologyProfile(ZHOU);
assert.deepEqual(validateEcologyProfile(profile), { valid: true, errors: [] });
assert.deepEqual(profile.desires.map((row) => row.id), [DESIRE]);
assert.equal(profile.desires.some((row) => row.id === LEGACY_DESIRE), false);
assert.equal(profile.runtimeAuthority?.psychology, "validated-character-foundation");
assert.equal(profile.runtimeAuthority?.personality, "engine-operational-default-from-foundation-gap");
assert.equal(profile.runtimeAuthority?.duties, "scene-role-contract");
assert.deepEqual(profile.runtimeAuthority?.legacyPsychologyFieldsUsed, []);
assert.equal(profile.personalityRuntimeProjection?.numericAuthority, "engine-operational-default");
assert.deepEqual(profile.personality, runtime.ecologyProjection.personality);
assert.equal(profile.principles.some((row) => row.id === "principle_zhoumin_care_not_debt"), false);
assert.equal(profile.boundaries.some((row) => row.id === "boundary_zhoumin_requires_clear_answer"), false);
assert.equal(profile.sensitivities.some((row) => row.id === "sensitivity_zhoumin_vague_response"), false);
assert.ok(profile.duties.some((row) => row.id === "duty_zhoumin_complete_delivery"));
assert.ok(Object.hasOwn(profile.dynamicPsychologyState || {}, "state_zhoumin_status_failure_pressure"));

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
const zhou = state.characters.find((character) => character.id === ZHOU);
assert.ok(zhou);
assert.ok(zhou.agentMemory.episodes.some((episode) => episode.id === "episode:zhoumin:mother-required-inner-court"));
assert.equal(zhou.agentMemory.ownerCharacterId, ZHOU);
assert.doesNotMatch(JSON.stringify(zhou.agentMemory), /这名额我不要|拿朋友的私事换|听谁说的/u);

const oldSaveMemory = createCharacterAgentMemoryState(ZHOU);
oldSaveMemory.episodes = [{
  id: "episode:zhoumin:lived-before-foundation-mapping",
  ownerCharacterId: ZHOU,
  sourceImpactId: "impact:zhoumin:lived-before-foundation-mapping",
  sourceImpactIds: ["impact:zhoumin:lived-before-foundation-mapping"],
  perception: { modality: "memory", content: "这是一条已经活过的个人记忆。", topic: "旧存档连续性" },
  semanticFrame: { id: "frame:zhoumin:lived-before-foundation-mapping", predicate: "remember", topicId: "old_save_continuity" },
  source: { kind: "firsthand", confidence: 0.9 },
  retentionStrength: 0.8,
  accessibility: 0.7,
  importance: 0.6,
}];
const mergedMemory = mergeValidatedCharacterAnchorMemoryState(oldSaveMemory, ZHOU, { sceneId: SCENE_ID });
const mergedAgain = mergeValidatedCharacterAnchorMemoryState(mergedMemory, ZHOU, { sceneId: SCENE_ID });
assert.ok(mergedMemory.episodes.some((episode) => episode.id === "episode:zhoumin:lived-before-foundation-mapping"));
assert.ok(mergedMemory.episodes.some((episode) => episode.id === "episode:zhoumin:mother-required-inner-court"));
assert.equal(
  mergedAgain.episodes.filter((episode) => episode.id === "episode:zhoumin:mother-required-inner-court").length,
  1,
  "validated memory seeding must remain idempotent across scene entries",
);
assert.doesNotMatch(JSON.stringify(mergedAgain), /这名额我不要|拿朋友的私事换|听谁说的/u);
zhou.agentMemory = oldSaveMemory;

const legacyEcology = ensureTavernEcology(zhou, {
  present: true,
  zoneId: "counter",
  locationId: "loc_xyy_tavern",
}).state;
legacyEcology.body.energy = 0.23;
legacyEcology.affect.arousal = 0.81;
legacyEcology.desires = {
  [LEGACY_DESIRE]: {
    desireId: LEGACY_DESIRE,
    strength: 0.91,
    frustration: 0.62,
    satisfaction: 0.08,
    lastSatisfiedAtSecond: null,
    lastBlockedAtSecond: 120,
  },
};
legacyEcology.dynamicPsychology = { legacy_pressure_script: 0.94 };
legacyEcology.currentIntention = {
  ...legacyEcology.currentIntention,
  intentionId: "intention:legacy-zhoumin-answer",
  sourceKind: "desire",
  sourceId: LEGACY_DESIRE,
  actionId: "action:legacy-zhoumin-answer",
};
legacyEcology.recentActionSignatures = ["lived-action-before-profile-mapping"];
zhou.ecologyState = legacyEcology;
const migratedEcology = ensureTavernEcology(zhou, {
  present: true,
  zoneId: "counter",
  locationId: "loc_xyy_tavern",
}).state;
assert.ok(migratedEcology.desires[DESIRE]);
assert.equal(Object.hasOwn(migratedEcology.desires, LEGACY_DESIRE), false);
assert.equal(migratedEcology.body.energy, 0.23);
assert.equal(migratedEcology.affect.arousal, 0.81);
assert.deepEqual(migratedEcology.recentActionSignatures, ["lived-action-before-profile-mapping"]);
assert.equal(migratedEcology.currentIntention.intentionId, null, "an intention backed only by a retired desire must not be relabelled as the new core desire");
assert.ok(Object.hasOwn(migratedEcology.dynamicPsychology, "state_zhoumin_status_failure_pressure"));
assert.equal(Object.hasOwn(migratedEcology.dynamicPsychology, "legacy_pressure_script"), false);

zhou.actionLines = { visible: LEGACY_SENTINEL };
zhou.desireLag = { script: LEGACY_SENTINEL };
zhou.shameMechanism = { script: LEGACY_SENTINEL };
zhou.innerCourt = { script: LEGACY_SENTINEL };
zhou.relationshipRules = { script: LEGACY_SENTINEL };
zhou.irreversibleBoundaries = [LEGACY_SENTINEL];
zhou.currentState = { script: LEGACY_SENTINEL };
zhou.internalSituation = { script: LEGACY_SENTINEL };
zhou.selfMyth = { script: LEGACY_SENTINEL };
zhou.speechProfile = { script: LEGACY_SENTINEL };
zhou.lifeState.hiddenAgenda = LEGACY_SENTINEL;
zhou.lifeProfile.commitments = [LEGACY_SENTINEL];
state.characterMemories = [{ id: "legacy-memory", characterId: ZHOU, privateVersion: LEGACY_SENTINEL }];

let captured = null;
const sceneResult = await runTavernCausalScene(state, {
  allowOrphanVisitors: true,
  characterIds: [ZHOU, XIE],
  positions: { [ZHOU]: "hall", [XIE]: "hall" },
  seedImpacts: [{
    sourceCharacterId: "world:zhoumin-runtime-mapping-probe",
    sourceZoneId: "hall",
    type: "institution",
    modality: "sound",
    intensity: 100,
    radius: 0,
    directedTargetId: ZHOU,
    content: "只用于激活周珉并检查他本人的正式运行底座。",
  }],
  maxSteps: 1,
  minimumActivationScore: 0,
  async runAgent(input) {
    if (input.agent.id === ZHOU) captured = structuredClone(input);
    const selected = input.privateActionCandidates.find((candidate) => candidate.feasible);
    return {
      decision: {
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
        decisionValue: "none",
        semanticFrameId: "",
        semanticRoleBindings: {},
        privateReason: "只捕获正式映射后的私有输入。",
      },
    };
  },
});

assert.ok(captured, "Zhou Min must receive a real Character Agent turn");
assert.equal(captured.agent.psychologyAnchor.characterId, ZHOU);
assert.equal(captured.agent.psychologyAnchor.runtimeSurface, "character-foundation");
assert.equal(captured.agent.privateState.selfModel.authority, "validated-character-foundation-and-owned-memory-only");
assert.deepEqual(captured.agent.privateState.ecologyProfile.desires.map((row) => row.id), [DESIRE]);
assert.equal(captured.agent.privateState.ecologyProfile.desires.some((row) => row.id === LEGACY_DESIRE), false);
assert.equal(captured.agent.privateState.ecologyState.body.energy, 0.23);
assert.match(captured.agent.privateState.privatePursuit, /内门身份|内门弟子/u);
assert.match(captured.agent.privateState.sceneRole.reasonForPresence, /送药|求剑术指点|举荐路径/u);
assert.ok(captured.privateActionCandidates.some((candidate) => candidate.driveId === DESIRE));
assert.equal(captured.privateActionCandidates.some((candidate) => candidate.driveId === LEGACY_DESIRE), false);
assert.ok(captured.privateActionCandidates
  .filter((candidate) => candidate.driveId === DESIRE)
  .every((candidate) => candidate.ownDecisionFactors?.anchorGuidance?.authority === "generic-cognitive-core"));
assert.equal(captured.agent.privateState.ownMemories.length, 0, "validated Agent must use normalized owned memory, not a parallel legacy memory list");
assert.doesNotMatch(JSON.stringify(captured.agent), new RegExp(LEGACY_SENTINEL));
assert.doesNotMatch(JSON.stringify(captured.agent), /holdout_zhoumin|calibration_zhoumin|这名额我不要|拿朋友的私事换/u);
const zhouPatch = sceneResult.characterPatches.find((patch) => patch.id === ZHOU);
assert.ok(zhouPatch.agentMemory.episodes.some((episode) => episode.id === "episode:zhoumin:lived-before-foundation-mapping"));
assert.ok(zhouPatch.agentMemory.episodes.some((episode) => episode.id === "episode:zhoumin:mother-required-inner-court"));
assert.ok(zhouPatch.ecologyState.desires[DESIRE]);
assert.equal(Object.hasOwn(zhouPatch.ecologyState.desires, LEGACY_DESIRE), false);

console.log("zhouMinRuntimeMapping:test passed", {
  sceneId: SCENE_ID,
  characterId: ZHOU,
  desireIds: profile.desires.map((row) => row.id),
  memoryEpisodes: zhouPatch.agentMemory.episodes.length,
  candidateCount: captured.privateActionCandidates.length,
});
