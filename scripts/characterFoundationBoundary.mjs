import assert from "node:assert/strict";
import { compileValidatedCharacterAnchorRuntime } from "../src/server/ecology/validatedCharacterAnchorRuntime.mjs";

const SENTINELS = Object.freeze({
  authorEvidence: "AUTHOR_EVIDENCE_MUST_NOT_ENTER_AGENT",
  actionScript: "SITUATION_TO_ACTION_SCRIPT_MUST_NOT_ENTER_AGENT",
  updateScript: "CHARACTER_SPECIFIC_UPDATE_RULE_MUST_NOT_ENTER_AGENT",
  speechExample: "CALIBRATION_SPEECH_EXAMPLE_MUST_NOT_ENTER_AGENT",
  calibrationAnswer: "CALIBRATION_ANSWER_MUST_NOT_ENTER_AGENT",
  holdoutAnswer: "HOLDOUT_ANSWER_MUST_NOT_ENTER_AGENT",
});

const characterId = "char_boundary_probe";
const sceneId = "scene_boundary_probe";
const anchor = {
  schemaVersion: 1,
  characterId,
  status: "validated",
  evidence: {
    confirmed: [{ id: "evidence_probe", claim: SENTINELS.authorEvidence, provenance: "test", confidence: "high" }],
    inferences: [],
    unknowns: [],
    conflicts: [],
    openChoiceAxes: [],
  },
  stablePsychology: {
    corePursuits: [{ id: "pursuit_probe", desiredSelfState: "亲自弄清事实", weightRange: [0.5, 0.8], evidenceIds: ["evidence_probe"] }],
    selfThreats: [],
    dispositions: {
      evidenceStandard: { range: [0.6, 0.9], confidence: "broad", evidenceIds: ["evidence_probe"], scope: "uncertain claims" },
    },
  },
  dynamicPsychology: {
    stateVariables: [{ id: "uncertainty", baselineRange: [0.1, 0.3], decayRange: [0.05, 0.2], bounds: [0, 1] }],
    updateRules: [{ id: "rule_probe", expression: SENTINELS.updateScript, parameters: {}, evidenceIds: ["evidence_probe"] }],
  },
  epistemics: {
    sourceReliability: { rumor: { range: [0.1, 0.3], confidence: "broad", evidenceIds: ["evidence_probe"] } },
    knownEntities: [],
    beliefUpdatePolicy: { contradictionResponse: "seek_more_evidence" },
  },
  sceneBindings: [{
    sceneId,
    reasonForPresence: "自行来到测试场景",
    entryCause: "本人形成来访意图并完成移动",
    currentPurpose: "确认边界",
    responsibilityRoleIds: [],
    knownAffordanceIds: ["observe", "ask", "wait", "leave"],
    prohibitedKnowledge: [],
    exitConditions: ["本人选择离开且路线可达"],
  }],
  desires: [{
    id: "desire_probe_truth",
    ownerCharacterId: characterId,
    desiredState: { subjectCharacterId: characterId, verb: "弄清", object: "一项不确定事实", observableOutcome: "获得直接或可靠证据" },
    target: { type: "information_state", id: "truth_probe", label: "事实" },
    qualitativeStrength: "medium",
    activationCues: ["出现矛盾信息"],
    progressEvidence: ["获得新的可靠证据"],
    satisfactionCondition: { requiredEvidence: "可靠证据确认事实", doesNotCount: ["只听到重复传闻"] },
  }],
  inhibitors: [{
    id: "inhibitor_probe_exposure",
    conditionPattern: "行动会公开暴露本人尚未确认的怀疑",
    costChannel: "exposure_cost",
    weightRange: [0.4, 0.8],
    meaning: "暴露成本参与比较",
    doesNotMean: "不预先决定人物必须沉默",
  }],
  actionPolicy: {
    candidateFamilies: [{ id: "script_probe", function: SENTINELS.actionScript, evidenceRequirements: [], typicalEscalationAfter: "fixed" }],
    invalidShortcuts: [SENTINELS.actionScript],
    domainControl: [{ domain: "probe", controlRange: [0.2, 0.8], evidenceIds: ["evidence_probe"] }],
  },
  speechPolicy: {
    silenceDefault: "没有合适表达时可以保持功能性沉默",
    explanationCostRange: [0.3, 0.7],
    socialMaintenanceRange: [0.2, 0.6],
    pragmaticForms: ["询问"],
    praiseConditions: [],
    pressureMutation: [],
    relationshipRegisters: {},
    forbiddenRegisters: [],
    evidenceAnchors: [{ function: "inquiry", line: SENTINELS.speechExample, evidenceId: "evidence_probe" }],
  },
  relationshipModel: {
    dimensions: ["trust", "care"],
    updateRules: [],
    forbiddenCollapses: ["传闻不直接改变关系"],
  },
  memoryPolicy: { seedRef: "memory-seed.json", encodingBiases: {}, retrievalBiases: {} },
  validation: {
    calibrationScenarios: [{ id: "calibration_probe", changedVariable: "source", answer: SENTINELS.calibrationAnswer, inferredEvidenceIds: ["evidence_probe"] }],
    holdouts: [{ id: "holdout_probe", unseenSituation: "未见测试", prediction: SENTINELS.holdoutAnswer, accepted: true }],
  },
};

const runtime = compileValidatedCharacterAnchorRuntime({
  sceneId,
  characterId,
  anchor,
  memorySeed: { ownerCharacterId: characterId, numericCalibrationStatus: "unassigned", episodes: [], beliefs: [], commitments: [], impressions: [], emptyReason: "boundary probe" },
  source: { path: "boundary-probe", sha256: "boundary-probe", memoryPath: "boundary-probe-memory", memorySha256: "boundary-probe-memory" },
});

assert.ok(runtime, "a validated authoring record should compile");
assert.ok(runtime.characterFoundation, "runtime must expose a sanitized character foundation");
assert.equal(runtime.psychologyAnchor, runtime.characterFoundation, "legacy psychology alias must point to the sanitized foundation only");
assert.equal(Object.hasOwn(runtime.characterFoundation, "evidence"), false, "author evidence belongs to the audit surface");
assert.equal(Object.hasOwn(runtime.characterFoundation, "validation"), false, "calibration and holdouts belong to the validation surface");
assert.equal(Object.hasOwn(runtime.characterFoundation, "actionPolicy"), false, "character-specific situation-to-action policy must not enter runtime");
assert.equal(Object.hasOwn(runtime.characterFoundation.dynamicPsychology || {}, "updateRules"), false, "generic cognitive updates must not come from character-specific scripts");
assert.equal(Object.hasOwn(runtime.characterFoundation.speechPolicy || {}, "evidenceAnchors"), false, "accepted calibration lines stay outside runtime speech policy");
assert.deepEqual(runtime.characterFoundation.dynamicPsychology.stateVariables, anchor.dynamicPsychology.stateVariables, "character-specific state baselines remain available as parameters");
assert.deepEqual(
  runtime.characterFoundation.stablePsychology.dispositions,
  { evidenceStandard: { range: [0.6, 0.9], scope: "uncertain claims" } },
  "stable character parameters must survive while author confidence and evidence references stay outside runtime",
);
assert.equal(runtime.candidatePolicy.authority, "generic-cognitive-core");
assert.equal(runtime.candidatePolicy.candidateSource, "perceived-world-affordances-plus-universal-primitives");
assert.equal(Object.hasOwn(runtime.candidatePolicy, "candidateFamilies"), false);
assert.equal(Object.hasOwn(runtime.candidatePolicy, "dynamicUpdateRules"), false);

const agentFacingRuntime = JSON.stringify({
  characterFoundation: runtime.characterFoundation,
  ecologyProjection: runtime.ecologyProjection,
  voiceProjection: runtime.voiceProjection,
  relationshipProjection: runtime.relationshipProjection,
  memoryProjection: runtime.memoryProjection,
  presenceProjection: runtime.presenceProjection,
  candidatePolicy: runtime.candidatePolicy,
});
for (const sentinel of Object.values(SENTINELS)) {
  assert.equal(agentFacingRuntime.includes(sentinel), false, `agent-facing runtime leaked ${sentinel}`);
}

console.log("characterFoundationBoundary:test passed", {
  characterId,
  sceneId,
  candidateAuthority: runtime.candidatePolicy.authority,
});
