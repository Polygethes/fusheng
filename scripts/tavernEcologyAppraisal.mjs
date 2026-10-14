import assert from "node:assert/strict";
import {
  ECOLOGY_APPRAISAL_VERSION,
  appraiseTavernEcology,
  computeObstacleResistance,
  evaluateEcologyCandidate,
  nearTopSeededSoftmax,
} from "../src/server/pipeline/tavernEcologyAppraisal.mjs";
import { getTavernEcologyProfile } from "../src/server/ecology/tavernEcologyProfile.mjs";
import { ecologyFactorWeightsForProfile } from "../src/server/pipeline/tavernEcologyRuntime.mjs";

const profileIds = [
  "char_xyy_xiezenshi",
  "char_xyy_xieheng",
  "char_xyy_xiemu",
  "char_xyy_zhoumin",
  "char_xyy_luozhao",
  "char_xyy_yanzhizhong",
  "char_xyy_chenyan",
];
const profiles = profileIds.map((characterId) => getTavernEcologyProfile(characterId));
const personalWeights = profiles.map(ecologyFactorWeightsForProfile);
assert.equal(new Set(personalWeights.map((weights) => JSON.stringify(weights))).size, 5,
  "the formula must share one marked neutral vector across validated foundations whose global numeric personality remains unassigned");
assert.deepEqual(personalWeights[0], personalWeights[3],
  "Xie Zhenshi and Zhou Min must remain neutral instead of receiving invented author numbers before calibration");
assert.deepEqual(personalWeights[0], personalWeights[4],
  "Luo Zhao's domain dispositions must reach her Agent without being forged into an authored global eight-axis vector");
for (const index of [0, 3, 4]) {
  assert.equal(profiles[index].personalityRuntimeProjection?.numericAuthority, "engine-operational-default");
  assert.equal(profiles[index].personalityRuntimeProjection?.authorNumericCalibration, "unassigned");
}
assert.ok(personalWeights[1].activation.dutyPressure > personalWeights[4].activation.dutyPressure,
  "Xie Heng's higher conscientiousness must weigh duty more than Luo Zhao's");

const luoZhao = {
  id: "char_xyy_luozhao",
  name: "洛照",
  traits: {
    shameSensitivity: 82,
    privacyNeed: 88,
    conscientiousness: 68,
    persistence: 66,
    assertiveness: 44,
    fatigueSensitivity: 54,
    painSensitivity: 58,
  },
  factorWeights: {
    obstacles: {
      publicScrutiny: 1.08,
    },
  },
};

const duelDesire = {
  id: "drive_luozhao_duel_xiezhenshi",
  want: "想与谢真石真正交手",
  baseline: 78,
  urgency: 44,
  cueActivation: 65,
  frustration: 28,
  needCoupling: 30,
  deadlineUrgency: 18,
  satiation: 0,
};

const askForSpar = {
  id: "ask-xiezhenshi-for-spar",
  label: "走到谢真石面前，约他到后院交手",
  driveId: duelDesire.id,
  actionKind: "ask_to_spar",
  targetCharacterId: "char_xyy_xiezhenshi",
  expectedSatisfaction: 84,
  opportunity: 82,
  emotionalPull: 35,
  bodyDemand: {
    exertion: 6,
    painRisk: 2,
    energyDemand: 2,
  },
  obstacles: [
    {
      id: "publicScrutiny",
      label: "会被堂前众人看见",
      environmentKey: "atmosphere.publicScrutiny",
      sensitivityKey: "shameSensitivity",
      source: "atmosphere",
    },
    {
      id: "crowding",
      label: "身边人多，不便私下开口",
      environmentKey: "atmosphere.crowding",
      sensitivityKey: "privacyNeed",
      source: "environment",
    },
    {
      id: "duelingNormConflict",
      label: "酒馆营业时谈动武会破坏规矩",
      environmentKey: "atmosphere.duelingNormConflict",
      sensitivityKey: "conscientiousness",
      source: "social-norm",
    },
  ],
  hardGates: [
    { id: "target-present", label: "谢真石在可接触范围内", passed: true, reason: "同处酒馆" },
  ],
};

const dayHall = {
  locationId: "loc_xyy_tavern",
  zoneId: "hall",
  timeOfDay: "day",
  atmosphere: {
    publicScrutiny: 94,
    crowding: 88,
    duelingNormConflict: 90,
  },
};

const nightCourtyard = {
  locationId: "loc_xyy_tavern",
  zoneId: "courtyard",
  timeOfDay: "night",
  atmosphere: {
    publicScrutiny: 9,
    crowding: 5,
    duelingNormConflict: 12,
  },
};

const commonLuoInput = {
  character: luoZhao,
  desire: duelDesire,
  bodyState: { fatigue: 34, hunger: 20, pain: 0, safetyNeed: 5 },
  currentState: {},
  intention: {
    driveId: duelDesire.id,
    actionKind: "approach_target",
    targetCharacterId: "char_xyy_xiezhenshi",
    strength: 72,
    ageSeconds: 45,
    halfLifeSeconds: 240,
  },
  candidates: [askForSpar],
  seed: "luozhao-counterfactual",
};

const dayAppraisal = appraiseTavernEcology({ ...commonLuoInput, environment: dayHall });
const nightAppraisal = appraiseTavernEcology({ ...commonLuoInput, environment: nightCourtyard });
const dayAsk = dayAppraisal.candidates[0];
const nightAsk = nightAppraisal.candidates[0];

assert.equal(dayAsk.desirePressure.score, nightAsk.desirePressure.score,
  "changing venue should not rewrite how much Luo Zhao wants the duel");
assert.ok(dayAsk.obstacleResistance.score > nightAsk.obstacleResistance.score + 45,
  "public daytime tavern should create much more resistance than a quiet night courtyard");
assert.ok(nightAsk.activationScore > dayAsk.activationScore + 20,
  "the same desire and personality should yield a more actionable choice in the night courtyard");

const directDrawSword = {
  id: "draw-sword-now",
  label: "当场拔剑逼谢真石交手",
  driveId: duelDesire.id,
  actionKind: "draw_sword",
  targetCharacterId: "char_xyy_xiezhenshi",
  expectedSatisfaction: 100,
  opportunity: 100,
  emotionalPull: 100,
  bodyDemand: { exertion: 20, painRisk: 15 },
};
const gatedDayAction = evaluateEcologyCandidate({
  character: luoZhao,
  desire: duelDesire,
  bodyState: { fatigue: 20 },
  environment: dayHall,
  candidate: {
    ...directDrawSword,
    hardGates: [{
      id: "weapons-permitted",
      label: "场所允许拔剑",
      passed: false,
      reason: "白日营业的堂前禁止拔剑",
    }],
  },
});
const gatedNightAction = evaluateEcologyCandidate({
  character: luoZhao,
  desire: duelDesire,
  bodyState: { fatigue: 20 },
  environment: nightCourtyard,
  candidate: {
    ...directDrawSword,
    hardGates: [{
      id: "weapons-permitted",
      label: "场所允许拔剑",
      passed: true,
      reason: "歇业后的后院允许双方同意后试招",
    }],
  },
});

assert.ok(gatedDayAction.ungatedScore > 0, "high desire should still be visible below the gate");
assert.equal(gatedDayAction.activationScore, 0, "hard gate must defeat even a high desire score");
assert.equal(gatedDayAction.feasible, false);
assert.equal(gatedNightAction.feasible, true);
assert.ok(gatedNightAction.activationScore > 0);

const samePerson = {
  id: "counterfactual-person",
  name: "同一个人",
  traits: {
    persistence: 65,
    assertiveness: 52,
    fatigueSensitivity: 70,
    painSensitivity: 55,
  },
};
const samePersonBefore = JSON.stringify(samePerson);
const practiceDesire = {
  id: "drive-practice",
  want: "想把这一式剑招练熟",
  baseline: 80,
  urgency: 42,
  cueActivation: 55,
  frustration: 20,
  needCoupling: 30,
};
const recoveryDesire = {
  id: "drive-recover",
  want: "想让身体缓过来",
  baseline: 36,
  urgency: 18,
  cueActivation: 20,
  needCoupling: 45,
};
const practiceCandidate = {
  id: "practice-sword-form",
  label: "继续练剑",
  driveId: practiceDesire.id,
  actionKind: "practice",
  expectedSatisfaction: 92,
  opportunity: 82,
  bodyDemand: { exertion: 88, painRisk: 24, energyDemand: 28 },
};
const restCandidate = {
  id: "sit-and-recover",
  label: "坐下歇一阵",
  driveId: recoveryDesire.id,
  actionKind: "rest",
  expectedSatisfaction: 90,
  opportunity: 85,
  bodyDemand: { recovery: 96, safetyGain: 10 },
};
const fatigueBase = {
  character: samePerson,
  desires: [practiceDesire, recoveryDesire],
  environment: { locationId: "loc_xyy_tavern", zoneId: "courtyard", timeOfDay: "afternoon" },
  candidates: [practiceCandidate, restCandidate],
  selectionPolicy: { nearTopWindow: 8, temperature: 3 },
  seed: "same-person-fatigue",
};
const fresh = appraiseTavernEcology({
  ...fatigueBase,
  bodyState: { fatigue: 18, hunger: 15, pain: 4, safetyNeed: 0 },
});
const exhausted = appraiseTavernEcology({
  ...fatigueBase,
  bodyState: { fatigue: 92, hunger: 15, pain: 4, safetyNeed: 0 },
});
const freshPractice = fresh.candidates.find((item) => item.candidateId === practiceCandidate.id);
const tiredPractice = exhausted.candidates.find((item) => item.candidateId === practiceCandidate.id);
const freshRest = fresh.candidates.find((item) => item.candidateId === restCandidate.id);
const tiredRest = exhausted.candidates.find((item) => item.candidateId === restCandidate.id);

assert.equal(freshPractice.desirePressure.score, tiredPractice.desirePressure.score,
  "fatigue should change the feasibility of acting, not silently rewrite the practice desire");
assert.ok(tiredPractice.bodyAppraisal.costScore > freshPractice.bodyAppraisal.costScore + 15,
  "the exact same strenuous action should cost more when exhausted");
assert.ok(tiredPractice.activationScore < freshPractice.activationScore,
  "fatigue should suppress a strenuous action for the same personality");
assert.ok(tiredRest.bodyAppraisal.rewardScore > freshRest.bodyAppraisal.rewardScore + 25,
  "rest should become more rewarding when the same person is exhausted");
assert.ok(tiredRest.activationScore > freshRest.activationScore,
  "the same rest option should gain activation through body reward");
assert.equal(JSON.stringify(samePerson), samePersonBefore, "pure appraisal must not mutate character input");

const shyResistance = computeObstacleResistance({
  character: { traits: { shameSensitivity: 90, persistence: 50, assertiveness: 50 } },
  environment: dayHall,
  candidate: {
    obstacles: [{
      id: "publicScrutiny",
      label: "旁人注视",
      environmentKey: "atmosphere.publicScrutiny",
      sensitivityKey: "shameSensitivity",
    }],
  },
});
const boldResistance = computeObstacleResistance({
  character: { traits: { shameSensitivity: 20, persistence: 50, assertiveness: 50 } },
  environment: dayHall,
  candidate: {
    obstacles: [{
      id: "publicScrutiny",
      label: "旁人注视",
      environmentKey: "atmosphere.publicScrutiny",
      sensitivityKey: "shameSensitivity",
    }],
  },
});
assert.ok(shyResistance.score > boldResistance.score + 45,
  "personal sensitivity must materially change the same environmental factor");

const softmaxCandidates = [
  { candidateId: "near-a", feasible: true, activationScore: 70 },
  { candidateId: "near-b", feasible: true, activationScore: 66 },
  { candidateId: "far-c", feasible: true, activationScore: 42 },
  { candidateId: "gated-d", feasible: false, activationScore: 99 },
];
const selectionA = nearTopSeededSoftmax(softmaxCandidates, {
  seed: "stable-seed",
  nearTopWindow: 6,
  temperature: 4,
});
const selectionB = nearTopSeededSoftmax(softmaxCandidates, {
  seed: "stable-seed",
  nearTopWindow: 6,
  temperature: 4,
});
assert.deepEqual(selectionA, selectionB, "same seed and state must select deterministically");
assert.deepEqual(selectionA.pool.map((item) => item.candidateId), ["near-a", "near-b"],
  "softmax lottery must include only near-top feasible actions");
assert.ok(Math.abs(selectionA.pool.reduce((sum, item) => sum + item.probability, 0) - 1) < 0.00001);

assert.equal(dayAppraisal.formulaVersion, ECOLOGY_APPRAISAL_VERSION);
assert.equal(dayAppraisal.observerFactorTrace.visibility, "observer-only");
assert.equal(dayAppraisal.observerFactorTrace.excludedFromAgentMemory, true);
assert.equal(dayAppraisal.observerFactorTrace.candidates[0].candidateId, askForSpar.id);
assert.ok(dayAppraisal.observerFactorTrace.candidates[0].positiveFactors.length > 0);
assert.ok(dayAppraisal.observerFactorTrace.candidates[0].negativeFactors.length > 0);

console.log("tavernEcologyAppraisal:test passed", {
  formulaVersion: ECOLOGY_APPRAISAL_VERSION,
  luoDayHall: {
    desire: dayAsk.desirePressure.score,
    resistance: dayAsk.obstacleResistance.score,
    activation: dayAsk.activationScore,
  },
  luoNightCourtyard: {
    desire: nightAsk.desirePressure.score,
    resistance: nightAsk.obstacleResistance.score,
    activation: nightAsk.activationScore,
  },
  fatigueCounterfactual: {
    freshPractice: freshPractice.activationScore,
    tiredPractice: tiredPractice.activationScore,
    freshRest: freshRest.activationScore,
    tiredRest: tiredRest.activationScore,
  },
  deterministicSelection: selectionA.selectedCandidateId,
});
