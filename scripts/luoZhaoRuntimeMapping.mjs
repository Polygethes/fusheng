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
import {
  prepareTavernCausalSlot,
  TAVERN_CAUSAL_DAY_SLOTS,
} from "../src/server/pipeline/tavernCausalEconomy.mjs";
import { runTavernCausalScene } from "../src/server/pipeline/tavernCausalScene.mjs";
import { ensureTavernEcology } from "../src/server/pipeline/tavernEcologyRuntime.mjs";

const SCENE_ID = "scene_xyy_wangti_tavern";
const LUO = "char_xyy_luozhao";
const XIE = "char_xyy_xiezenshi";
const YAN = "char_xyy_yanzhizhong";
const DESIRE = "desire_luozhao_test_own_limit_against_xiezenshi";
const LEGACY_DESIRE = "desire_luozhao_duel_xiezenshi";
const FOUNDATION_PATH = `.codex/anchors/${SCENE_ID}/characters/${LUO}/character-foundation.json`;
const MEMORY_PATH = `.codex/anchors/${SCENE_ID}/characters/${LUO}/memory-seed.json`;
const OWNED_ARRIVAL_EPISODE = "episode:luozhao:accepted-visit-and-arrived-wangti";
const HEARSAY_BELIEF = "belief:luozhao:xiezenshi-name-and-hearsay";
const LEGACY_SENTINEL = "LEGACY_LUOZHAO_PRIVATE_SCRIPT_MUST_NOT_REACH_AGENT";

const runtime = getValidatedCharacterAnchorRuntime(SCENE_ID, LUO);
assert.ok(runtime, "a runtime-mapped Luo Zhao must be present in the validated registry");
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
  row.id === "luo-breakthrough-versus-assigned-path" && row.resolution === "story-open"
)), true);
assert.equal(Object.hasOwn(runtime.characterFoundation, "validation"), false);
assert.equal(Object.hasOwn(runtime.characterFoundation, "actionPolicy"), false);
assert.equal(Object.hasOwn(runtime.characterFoundation.dynamicPsychology, "updateRules"), false);
assert.equal(Object.hasOwn(runtime.characterFoundation.speechPolicy || {}, "evidenceAnchors"), false);
assert.equal(runtime.candidatePolicy.authority, "generic-cognitive-core");
assert.equal(runtime.characterFoundation.physiology.sustenance.mode, "long_fasting_low_mundane_need");
assert.deepEqual(runtime.characterFoundation.physiology.sustenance.ordinaryFoodDependenceRange, [0.08, 0.2]);
assert.deepEqual(runtime.characterFoundation.materialEconomy.currencyAccess.copper_wen.acquisitionEaseRange, [0.92, 0.98]);
assert.equal(runtime.ecologyProjection.sustenanceProfile.mode, "long_fasting_low_mundane_need");
assert.equal(runtime.perceptionProjection.attention.baselineBudget, 5);
assert.ok(runtime.perceptionProjection.attention.orientingBiases.sword > 0.7);
assert.ok(runtime.perceptionProjection.domainDecoders.some((row) => (
  row.domain === "sword" && row.competence > 0.8
)));
assert.ok(runtime.perceptionProjection.informationStyle.verificationThreshold > 0.85);
assert.equal(
  Object.hasOwn(runtime.perceptionProjection, "preferredQuestion"),
  false,
  "the perception profile must shape evidence and costs without prewriting an inquiry",
);

const profile = getTavernEcologyProfile(LUO);
assert.deepEqual(validateEcologyProfile(profile), { valid: true, errors: [] });
assert.deepEqual(profile.desires.map((row) => row.id), [DESIRE]);
assert.equal(profile.desires.some((row) => row.id === LEGACY_DESIRE), false);
assert.equal(profile.runtimeAuthority?.psychology, "validated-character-foundation");
assert.equal(profile.runtimeAuthority?.personality, "engine-operational-default-from-foundation-gap");
assert.equal(profile.runtimeAuthority?.duties, "scene-role-contract");
assert.deepEqual(profile.runtimeAuthority?.legacyPsychologyFieldsUsed, []);
assert.equal(profile.personalityRuntimeProjection?.numericAuthority, "engine-operational-default");
assert.deepEqual(profile.personality, runtime.ecologyProjection.personality);
assert.equal(profile.sustenanceProfile.mode, "long_fasting_low_mundane_need");
assert.equal(profile.principles.some((row) => row.id === "principle_luozhao_firsthand_judgment"), false);
assert.equal(profile.boundaries.some((row) => row.id === "boundary_luozhao_avoid_irrelevant_trouble"), false);
assert.equal(profile.sensitivities.some((row) => row.id === "sensitivity_luozhao_public_exposure"), false);
assert.deepEqual(profile.duties, [], "the validated arrival contract assigns Luo Zhao no tavern duty or pre-completed lodging transaction");
assert.deepEqual(Object.keys(profile.dynamicPsychologyState || {}).sort(), [
  "desireIntensity",
  "domainExcitement",
  "frustration",
]);

const initialState = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
const prepared = prepareTavernCausalSlot(initialState, {
  day: 1,
  slot: TAVERN_CAUSAL_DAY_SLOTS.find((row) => row.id === "dawn"),
});
const state = prepared.state;
const initialLuo = state.characters.find((row) => row.id === LUO);
assert.equal(initialLuo.lifeProfile.physiology.sustenance.mode, "long_fasting_low_mundane_need");
assert.ok(initialLuo.lifeProfile.materialEconomy.currencyAccess.copper_wen.acquisitionEaseRange[0] > 0.9);
assert.ok(prepared.arrivals.includes(LUO), "the owned zero-slot arrival intention must bring Luo Zhao to the threshold without a schedule teleport");
const activeVisit = state.tavernState.activeVisits.find((visit) => visit.visitorId === LUO);
assert.equal(activeVisit?.kind, "self_directed");
assert.equal(activeVisit?.purposeDisclosureRequired, false);
assert.equal(activeVisit?.hostReceptionRequired, false);
assert.equal(activeVisit?.requestedService, "none");
assert.equal(activeVisit?.paymentStatus, "not_required");
const sword = state.tavernState.objectLedger.objects.luozhao_sword;
const visitLetter = state.tavernState.objectLedger.objects.luozhao_yuheng_visit_letter;
assert.equal(sword?.holderActorId, LUO);
assert.equal(sword?.attachment?.active, true);
assert.equal(sword?.attachment?.actorId, LUO);
assert.equal(sword?.zoneId, "threshold");
assert.equal(sword?.presentation?.publiclyVisible, true);
assert.equal(visitLetter?.holderActorId, LUO);
assert.equal(visitLetter?.zoneId, "threshold");
assert.equal(visitLetter?.custody?.storageMode, "packed");
assert.equal(visitLetter?.custody?.inHand, false);
assert.equal(visitLetter?.presentation?.publiclyVisible, false);
assert.equal(visitLetter?.state?.tavernCustody, false);
const luo = state.characters.find((character) => character.id === LUO);
assert.ok(luo);
assert.equal(luo.agentMemory.ownerCharacterId, LUO);
assert.ok(luo.agentMemory.episodes.some((episode) => episode.id === OWNED_ARRIVAL_EPISODE));
assert.ok(luo.agentMemory.beliefs.some((belief) => belief.id === HEARSAY_BELIEF));
assert.doesNotMatch(JSON.stringify(luo.agentMemory), /luo-holdout|你打算一直装作没看见|好剑。|我会再来/u);

const oldSaveMemory = createCharacterAgentMemoryState(LUO);
oldSaveMemory.episodes = [{
  id: "episode:luozhao:lived-before-foundation-mapping",
  ownerCharacterId: LUO,
  sourceImpactId: "impact:luozhao:lived-before-foundation-mapping",
  sourceImpactIds: ["impact:luozhao:lived-before-foundation-mapping"],
  perception: { modality: "memory", content: "这是一条洛照已经亲身经历的旧存档记忆。", topic: "旧存档连续性" },
  semanticFrame: { id: "frame:luozhao:lived-before-foundation-mapping", predicate: "remember", topicId: "old_save_continuity" },
  source: { kind: "firsthand", confidence: 0.9 },
  retentionStrength: 0.8,
  accessibility: 0.7,
  importance: 0.6,
}];
const mergedMemory = mergeValidatedCharacterAnchorMemoryState(oldSaveMemory, LUO, { sceneId: SCENE_ID });
const mergedAgain = mergeValidatedCharacterAnchorMemoryState(mergedMemory, LUO, { sceneId: SCENE_ID });
assert.ok(mergedMemory.episodes.some((episode) => episode.id === "episode:luozhao:lived-before-foundation-mapping"));
assert.ok(mergedMemory.episodes.some((episode) => episode.id === OWNED_ARRIVAL_EPISODE));
assert.ok(mergedMemory.beliefs.some((belief) => belief.id === HEARSAY_BELIEF));
assert.equal(
  mergedAgain.episodes.filter((episode) => episode.id === OWNED_ARRIVAL_EPISODE).length,
  1,
  "validated memory seeding must remain idempotent across scene entries",
);
assert.doesNotMatch(JSON.stringify(mergedAgain), /luo-holdout|你打算一直装作没看见|好剑。|我会再来/u);
luo.agentMemory = oldSaveMemory;

const legacyEcology = ensureTavernEcology(luo, {
  present: true,
  zoneId: "threshold",
  locationId: "loc_xyy_tavern",
}).state;
legacyEcology.body.energy = 0.31;
legacyEcology.affect.arousal = 0.77;
legacyEcology.desires = {
  [LEGACY_DESIRE]: {
    desireId: LEGACY_DESIRE,
    strength: 0.93,
    frustration: 0.57,
    satisfaction: 0.06,
    lastSatisfiedAtSecond: null,
    lastBlockedAtSecond: 90,
  },
};
legacyEcology.dynamicPsychology = { legacy_duel_script: 0.96 };
legacyEcology.currentIntention = {
  ...legacyEcology.currentIntention,
  intentionId: "intention:legacy-luozhao-duel",
  sourceKind: "desire",
  sourceId: LEGACY_DESIRE,
  actionId: "action:legacy-luozhao-duel",
};
legacyEcology.recentActionSignatures = ["lived-action-before-profile-mapping"];
luo.ecologyState = legacyEcology;
const migratedEcology = ensureTavernEcology(luo, {
  present: true,
  zoneId: "threshold",
  locationId: "loc_xyy_tavern",
}).state;
assert.ok(migratedEcology.desires[DESIRE]);
assert.equal(Object.hasOwn(migratedEcology.desires, LEGACY_DESIRE), false);
assert.equal(migratedEcology.body.energy, 0.31);
assert.equal(migratedEcology.affect.arousal, 0.77);
assert.deepEqual(migratedEcology.recentActionSignatures, ["lived-action-before-profile-mapping"]);
assert.equal(migratedEcology.currentIntention.intentionId, null, "an intention backed only by a retired desire must not be relabelled as the new core desire");
assert.deepEqual(Object.keys(migratedEcology.dynamicPsychology).sort(), [
  "desireIntensity",
  "domainExcitement",
  "frustration",
]);
assert.equal(Object.hasOwn(migratedEcology.dynamicPsychology, "legacy_duel_script"), false);

luo.actionLines = { visible: LEGACY_SENTINEL };
luo.desireLag = { script: LEGACY_SENTINEL };
luo.shameMechanism = { script: LEGACY_SENTINEL };
luo.innerCourt = { script: LEGACY_SENTINEL };
luo.relationshipRules = { script: LEGACY_SENTINEL };
luo.irreversibleBoundaries = [LEGACY_SENTINEL];
luo.currentState = { script: LEGACY_SENTINEL };
luo.internalSituation = { script: LEGACY_SENTINEL };
luo.selfMyth = { script: LEGACY_SENTINEL };
luo.speechProfile = { script: LEGACY_SENTINEL };
luo.lifeState.hiddenAgenda = LEGACY_SENTINEL;
luo.lifeProfile.commitments = [LEGACY_SENTINEL];
state.characterMemories = [{ id: "legacy-memory", characterId: LUO, privateVersion: LEGACY_SENTINEL }];

let captured = null;
const sceneResult = await runTavernCausalScene(state, {
  characterIds: [LUO, XIE, YAN],
  positions: { [LUO]: "threshold", [XIE]: "hall", [YAN]: "hall" },
  allowOrphanVisitors: true,
  seedImpacts: [{
    sourceCharacterId: "world:luozhao-runtime-mapping-probe",
    sourceZoneId: "threshold",
    type: "institution",
    modality: "sound",
    intensity: 100,
    radius: 0,
    directedTargetId: LUO,
    content: "只用于激活洛照并检查她本人的正式运行底座。",
  }],
  maxSteps: 1,
  minimumActivationScore: 0,
  async runAgent(input) {
    if (input.agent.id === LUO) captured = structuredClone(input);
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

assert.ok(captured, "Luo Zhao must receive a real Character Agent turn");
assert.equal(captured.agent.psychologyAnchor.characterId, LUO);
assert.equal(captured.agent.psychologyAnchor.runtimeSurface, "character-foundation");
assert.equal(captured.agent.privateState.selfModel.authority, "validated-character-foundation-and-owned-memory-only");
const projectedCoreDesireId = captured.agent.privateState.ecologyProfile.desires[0]?.id || "";
assert.match(projectedCoreDesireId, /^desire_luozhao_test_own_limit_against_known_slug:/u);
assert.equal(captured.agent.privateState.ecologyProfile.desires.some((row) => row.id === LEGACY_DESIRE), false);
assert.equal(captured.agent.privateState.ecologyState.body.energy, 0.31);
assert.match(captured.agent.privateState.privatePursuit, /修行极限/u);
assert.match(captured.agent.privateState.sceneRole.reasonForPresence, /佩剑|拜帖|打探消息/u);
assert.equal(captured.agent.standing, "visitor");
assert.deepEqual(captured.agent.privateState.sceneRole.responsibilities, []);
assert.doesNotMatch(
  JSON.stringify(captured.agent.privateState.sceneRole),
  /付钱住店|等接引|客房和晚饭|已经付|住一晚/u,
  "retired lodging and escort assumptions must not survive in the live Agent role",
);
const unknownPeople = captured.perceivedCharacters.filter((row) => row.identityKnown === false);
assert.equal(unknownPeople.length, 2);
assert.ok(unknownPeople.every((row) => row.id.startsWith("perceived_entity:") && row.name === ""));
const knownXie = captured.agent.psychologyAnchor.epistemics.knownEntities.find((row) => (
  row.knowsName === true && row.recognizesIdentity === false
));
assert.ok(knownXie?.entityId.startsWith("known_entity:"));
assert.ok(unknownPeople.every((row) => row.id !== knownXie.entityId));
assert.equal(captured.agent.psychologyAnchor.desires[0]?.target?.id, knownXie.entityId);
assert.equal(captured.agent.psychologyAnchor.desires[0]?.target?.label, "谢真石");
assert.match(captured.agent.currentIntention, /谢真石/u);
assert.doesNotMatch(captured.agent.currentIntention, /酒馆帮工/u);
const projectedDesireCandidate = captured.privateActionCandidates.find((candidate) => (
  candidate.driveId === projectedCoreDesireId
));
assert.ok(projectedDesireCandidate);
assert.equal(projectedDesireCandidate.realization?.commitmentTopic, "谢真石");
assert.equal(
  projectedDesireCandidate.ownDecisionFactors?.desirePressure?.desireId,
  projectedCoreDesireId,
);
assert.match(projectedDesireCandidate.ownDecisionFactors?.desirePressure?.want || "", /谢真石/u);
assert.doesNotMatch(
  JSON.stringify({
    commitmentTopic: projectedDesireCandidate.realization?.commitmentTopic,
    desirePressure: projectedDesireCandidate.ownDecisionFactors?.desirePressure,
  }),
  /酒馆帮工|perceived_slug:/u,
);
const desireCuePressure = projectedDesireCandidate.ownDecisionFactors?.desirePressure?.positiveFactors
  ?.find((factor) => factor.id === "desire-cue")?.raw;
assert.equal(
  desireCuePressure,
  12,
  "an unrecognized person sharing the target's world identity must not activate the private desire as a confirmed sighting",
);
assert.equal(
  captured.agent.relationshipContext.length > 0,
  false,
  "an unconfirmed legacy relationship seed must not enter a validated Character Agent",
);
assert.ok(captured.privateActionCandidates.some((candidate) => candidate.driveId === projectedCoreDesireId));
assert.equal(captured.privateActionCandidates.some((candidate) => candidate.driveId === LEGACY_DESIRE), false);
assert.ok(captured.privateActionCandidates
  .filter((candidate) => candidate.driveId === projectedCoreDesireId)
  .every((candidate) => candidate.ownDecisionFactors?.anchorGuidance?.authority === "generic-cognitive-core"));
assert.equal(captured.agent.privateState.ownMemories.length, 0, "validated Agent must use normalized owned memory, not a parallel legacy memory list");
assert.doesNotMatch(JSON.stringify(captured.agent), new RegExp(LEGACY_SENTINEL));
assert.doesNotMatch(JSON.stringify(captured.agent), /luo-holdout|calibration_luozhao|你打算一直装作没看见|好剑。|我会再来/u);
const luoPatch = sceneResult.characterPatches.find((patch) => patch.id === LUO);
assert.ok(luoPatch.agentMemory.episodes.some((episode) => episode.id === "episode:luozhao:lived-before-foundation-mapping"));
assert.ok(luoPatch.agentMemory.episodes.some((episode) => episode.id === OWNED_ARRIVAL_EPISODE));
assert.ok(luoPatch.agentMemory.beliefs.some((belief) => belief.id === HEARSAY_BELIEF));
assert.ok(luoPatch.ecologyState.desires[DESIRE]);
assert.equal(Object.hasOwn(luoPatch.ecologyState.desires, LEGACY_DESIRE), false);

console.log("luoZhaoRuntimeMapping:test passed", {
  sceneId: SCENE_ID,
  characterId: LUO,
  desireIds: profile.desires.map((row) => row.id),
  memoryEpisodes: luoPatch.agentMemory.episodes.length,
  candidateCount: captured.privateActionCandidates.length,
});
