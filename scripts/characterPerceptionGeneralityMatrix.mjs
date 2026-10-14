import assert from "node:assert/strict";

import {
  buildCharacterPerceptionFrame,
  decodeNoticedEvidence,
  normalizeCharacterPerceptionProfile,
  receiveSignalCandidates,
} from "../src/server/simulation/characterPerception.mjs";
import { scoreEpistemicActionCandidates } from "../src/server/simulation/epistemicActionUtility.mjs";

const SUBJECT = "perceived_entity:synthetic-traveler";
const signals = [
  {
    signalId: "matrix:robe",
    sourceEntityHandle: SUBJECT,
    modality: "visual",
    featureId: "dark-robe",
    physicalFeature: "外袍颜色很深，袖口沾着灰。",
    domainTags: ["clothing"],
    intensity: 0.7,
  },
  {
    signalId: "matrix:sword",
    sourceEntityHandle: SUBJECT,
    modality: "visual",
    featureId: "scabbard-wear",
    physicalFeature: "剑鞘口一侧有重复摩擦留下的浅痕。",
    domainTags: ["weapon", "sword"],
    intensity: 0.68,
  },
  {
    signalId: "matrix:coins",
    sourceEntityHandle: SUBJECT,
    modality: "sound",
    featureId: "coin-sound",
    physicalFeature: "落座时钱袋里响起几枚铜钱相碰的声音。",
    domainTags: ["commerce", "payment"],
    intensity: 0.62,
  },
  {
    signalId: "matrix:steps",
    sourceEntityHandle: SUBJECT,
    modality: "sound",
    featureId: "uneven-step-rhythm",
    physicalFeature: "脚步在第三步时略微拖慢。",
    domainTags: ["gait", "rhythm", "movement"],
    intensity: 0.58,
  },
  {
    signalId: "matrix:meal-smell",
    sourceEntityHandle: "perceived_object:kitchen",
    modality: "smell",
    featureId: "hot-meal-smell",
    physicalFeature: "灶边传来热饭和姜的气味。",
    domainTags: ["food", "service"],
    intensity: 0.64,
  },
];
const environment = {
  light: 0.78,
  ambientNoise: 0.22,
  modalityTransmission: { visual: 0.95, sound: 0.9, smell: 0.8 },
};

const ordinary = normalizeCharacterPerceptionProfile({
  sensoryChannels: {
    visual: { availability: 1, acuity: 0.68 },
    sound: { availability: 1, acuity: 0.68 },
  },
  attention: { baselineBudget: 4, sensitivityThreshold: 0.2 },
});
const blindWithoutSpecialTraining = normalizeCharacterPerceptionProfile({
  sensoryChannels: {
    visual: { availability: 0, acuity: 0 },
    sound: { availability: 1, acuity: 0.68 },
  },
  attention: { baselineBudget: 4, sensitivityThreshold: 0.2 },
});
const ordinaryReceived = receiveSignalCandidates({ signals, profile: ordinary, environment });
const blindReceived = receiveSignalCandidates({ signals, profile: blindWithoutSpecialTraining, environment });
assert.equal(blindReceived.some((row) => row.modality === "visual"), false);
const ordinaryStep = ordinaryReceived.find((row) => row.featureId === "uneven-step-rhythm");
const blindStep = blindReceived.find((row) => row.featureId === "uneven-step-rhythm");
assert.ok(ordinaryStep && blindStep);
assert.ok(
  Math.abs(ordinaryStep.receivedStrength - blindStep.receivedStrength) < 1e-12,
  "blindness alone must not grant enhanced hearing",
);

const swordNarrow = normalizeCharacterPerceptionProfile({
  sensoryChannels: ordinary.sensoryChannels,
  attention: {
    baselineBudget: 2,
    sensitivityThreshold: 0.18,
    orientingBiases: { sword: 0.82, weapon: 0.7, commerce: -0.3, food: -0.2 },
  },
  domainDecoders: [{ domain: "sword", competenceRange: [0.82, 0.94] }],
});
const serviceOperator = normalizeCharacterPerceptionProfile({
  sensoryChannels: ordinary.sensoryChannels,
  attention: {
    baselineBudget: 2,
    sensitivityThreshold: 0.18,
    orientingBiases: { commerce: 0.75, payment: 0.7, food: 0.5, service: 0.45, sword: -0.25 },
  },
  domainDecoders: [{ domain: "commerce", competenceRange: [0.72, 0.88] }],
});
const swordFrame = buildCharacterPerceptionFrame({
  signals,
  profile: swordNarrow,
  environment,
  attentionContext: { desireDomains: ["sword"] },
  seed: "matrix:sword-narrow",
});
const operatorFrame = buildCharacterPerceptionFrame({
  signals,
  profile: serviceOperator,
  environment,
  attentionContext: { dutyDomains: ["payment", "service"] },
  seed: "matrix:operator",
});
assert.ok(swordFrame.noticedEvidence.some((row) => row.featureId === "scabbard-wear"));
assert.ok(operatorFrame.noticedEvidence.some((row) => ["coin-sound", "hot-meal-smell"].includes(row.featureId)));
assert.notDeepEqual(
  swordFrame.noticedEvidence.map((row) => row.featureId),
  operatorFrame.noticedEvidence.map((row) => row.featureId),
);

const neutralNarrow = normalizeCharacterPerceptionProfile({
  sensoryChannels: ordinary.sensoryChannels,
  attention: { baselineBudget: 1, sensitivityThreshold: 0.18 },
});
const deliberateSwordFrame = buildCharacterPerceptionFrame({
  signals,
  profile: neutralNarrow,
  environment,
  attentionContext: { deliberateFocusDomains: ["sword", "weapon"] },
  seed: "matrix:deliberate-sword",
});
const deliberateClothingFrame = buildCharacterPerceptionFrame({
  signals,
  profile: neutralNarrow,
  environment,
  attentionContext: { deliberateFocusDomains: ["clothing"] },
  seed: "matrix:deliberate-clothing",
});
assert.equal(deliberateSwordFrame.noticedEvidence[0].featureId, "scabbard-wear");
assert.equal(deliberateClothingFrame.noticedEvidence[0].featureId, "dark-robe");
assert.ok(deliberateSwordFrame.noticedEvidence[0].attentionReasonTags.includes("character-chosen-focus:sword"));

const blindSwordFocus = buildCharacterPerceptionFrame({
  signals,
  profile: blindWithoutSpecialTraining,
  environment,
  attentionContext: { deliberateFocusDomains: ["sword", "weapon"] },
  seed: "matrix:blind-deliberate-sword",
});
assert.equal(
  blindSwordFocus.noticedEvidence.some((row) => row.featureId === "scabbard-wear"),
  false,
  "deliberate focus cannot create a sensory channel the character does not have",
);

const catalog = [{
  hypothesisId: "matrix:hypothesis-practiced-draw",
  domain: "sword",
  proposition: "此人可能经常练习贴近鞘口的出剑动作。",
  supportingFeatureIds: ["scabbard-wear"],
  baseDiagnosticity: 0.7,
}];
const expert = decodeNoticedEvidence({
  noticedEvidence: swordFrame.noticedEvidence,
  profile: swordNarrow,
  hypothesisCatalog: catalog,
});
const novice = decodeNoticedEvidence({
  noticedEvidence: swordFrame.noticedEvidence,
  profile: ordinary,
  hypothesisCatalog: catalog,
});
assert.ok(expert[0].confidence > novice[0].confidence);
assert.equal(expert[0].status, "hypothesis");

const sensitiveProfile = normalizeCharacterPerceptionProfile({
  sensoryChannels: {
    visual: { availability: 1, acuity: 0.9 },
    sound: { availability: 1, acuity: 0.9 },
    smell: { availability: 1, acuity: 0.8 },
  },
  attention: {
    baselineBudget: 6,
    sensitivityThreshold: 0.1,
    overloadSensitivity: 0.9,
    distractibility: 0.55,
  },
});
const sensitiveClear = buildCharacterPerceptionFrame({
  signals,
  profile: sensitiveProfile,
  environment,
  bodyState: { fatigue: 0.05, cognitiveLoad: 0.05 },
  seed: "matrix:sensitive-clear",
});
const sensitiveOverloaded = buildCharacterPerceptionFrame({
  signals,
  profile: sensitiveProfile,
  environment,
  bodyState: { fatigue: 0.7, pain: 0.3, cognitiveLoad: 0.95 },
  seed: "matrix:sensitive-overloaded",
});
assert.ok(sensitiveClear.attentionTrace.effectiveBudget > sensitiveOverloaded.attentionTrace.effectiveBudget);
assert.ok(sensitiveClear.noticedEvidence.length >= sensitiveOverloaded.noticedEvidence.length);
assert.ok(sensitiveOverloaded.attentionTrace.uncertaintyPenalty > sensitiveClear.attentionTrace.uncertaintyPenalty);

const directQuestion = {
  candidateId: "matrix:ask",
  primitive: "ask_current_presence",
  disclosurePayload: 0.8,
  expectedInformationGain: 0.62,
  reactionDiagnosticity: 0.45,
  goalProgress: 0.68,
  controlValue: 0.58,
  socialCost: 0.08,
  timeCost: 0.08,
  uncertaintyRisk: 0.2,
  feasible: true,
};
const quietObservation = {
  candidateId: "matrix:observe",
  primitive: "observe",
  disclosurePayload: 0.02,
  expectedInformationGain: 0.34,
  reactionDiagnosticity: 0.2,
  goalProgress: 0.32,
  controlValue: 0.5,
  socialCost: 0.02,
  timeCost: 0.3,
  uncertaintyRisk: 0.3,
  feasible: true,
};
const secretive = scoreEpistemicActionCandidates({
  actorProfile: { informationStyle: { concealmentNeed: 0.94, directInquiry: 0.2, patience: 0.85, socialRiskSensitivity: 0.75 } },
  candidates: [directQuestion, quietObservation],
  context: { urgency: 0.1 },
});
const urgent = scoreEpistemicActionCandidates({
  actorProfile: { informationStyle: { concealmentNeed: 0.08, directInquiry: 0.95, patience: 0.08, socialRiskSensitivity: 0.1 } },
  candidates: [directQuestion, quietObservation],
  context: { urgency: 0.95 },
});
assert.equal(secretive.selection.pool[0].candidateId, "matrix:observe");
assert.equal(urgent.selection.pool[0].candidateId, "matrix:ask");
assert.equal(secretive.selection.selectedCandidateId, null);
assert.equal(urgent.selection.selectedCandidateId, null);
assert.equal(Object.hasOwn(swordFrame, "selectedPublicAction"), false);
assert.equal(JSON.stringify(swordFrame).includes("char_"), false, "private evidence must not acquire a canonical identity");

console.log("characterPerceptionGeneralityMatrix:test passed", {
  blindModalities: [...new Set(blindReceived.map((row) => row.modality))],
  swordFocus: swordFrame.noticedEvidence.map((row) => row.featureId),
  operatorFocus: operatorFrame.noticedEvidence.map((row) => row.featureId),
  deliberateFocusChangesNotice: true,
  deliberateFocusCannotOverrideBlindness: true,
  clearBudget: sensitiveClear.attentionTrace.effectiveBudget,
  overloadBudget: sensitiveOverloaded.attentionTrace.effectiveBudget,
  secretiveTop: secretive.selection.pool[0].candidateId,
  urgentTop: urgent.selection.pool[0].candidateId,
});
