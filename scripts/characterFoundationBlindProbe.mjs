import assert from "node:assert/strict";
import {
  auditCharacterFoundationProbeInput,
  characterFoundationProbeDecisionSchema,
  characterFoundationProbeSystemPrompt,
  validateCharacterFoundationProbeDecision,
} from "../src/server/ecology/characterFoundationBlindProbe.mjs";
import {
  buildZhouMinSecondhandClaimProbeInput,
  ZHOU_MIN_PROBE_IDS,
} from "./fixtures/zhouMinSecondhandClaimProbeFixture.mjs";

const { ZHOU, XIE } = ZHOU_MIN_PROBE_IDS;
const CORE_DESIRE = "desire_zhoumin_become_inner_court_disciple";
const probeInput = buildZhouMinSecondhandClaimProbeInput();

const audit = auditCharacterFoundationProbeInput(probeInput);
assert.equal(audit.valid, true, JSON.stringify(audit.errors));

const serialized = JSON.stringify(probeInput);
for (const forbidden of [
  "calibrationEvidence",
  "holdouts",
  "authorCorrection",
  "expectedAction",
  "偷偷确认",
  "不向谢真石摊牌",
  "外表不立刻表态",
]) {
  assert.equal(serialized.includes(forbidden), false, `probe input leaked ${forbidden}`);
}

const poisoned = structuredClone(probeInput);
poisoned.authorCorrection = "AUTHOR_EXPECTED_ANSWER_MUST_NOT_ENTER_AGENT";
const poisonedAudit = auditCharacterFoundationProbeInput(poisoned);
assert.equal(poisonedAudit.valid, false);
assert.ok(poisonedAudit.errors.some((entry) => entry.code === "PROBE_AUTHORING_SURFACE_LEAK"));

const invalidDecision = {
  epistemicUpdate: {
    sourceEventId: "impact:zhoumin:unverified-report",
    classification: "objective_fact",
    claimAcceptedAsFact: true,
    confidenceBand: "high",
    evidenceBasisIds: ["impact:zhoumin:unverified-report"],
  },
  relationshipUpdate: {
    targetCharacterId: XIE,
    change: "trust_down",
    durable: true,
    evidenceBasisIds: ["impact:zhoumin:unverified-report"],
  },
  action: {
    primitiveId: "ask",
    targetCharacterId: XIE,
    affordanceId: "",
    speechAct: "ask",
    speech: "",
    visibleAction: "",
  },
  futureIntention: {
    mode: "none",
    targetCharacterId: "",
    triggerCondition: "",
    knowledgeLimit: "not_applicable",
  },
  memoryWrite: {
    kind: "firsthand_episode",
    sourceEventId: "impact:zhoumin:unverified-report",
    proposition: "谢真石从没打算举荐周珉",
    confidenceBand: "high",
  },
  factorLedger: { chosen: [], rejectedAlternative: null },
  privateReason: "直接把转述当真。",
};
const invalidResult = validateCharacterFoundationProbeDecision(probeInput, invalidDecision);
assert.equal(invalidResult.valid, false);
assert.ok(invalidResult.errors.some((entry) => entry.code === "UNVERIFIED_REPORT_PROMOTED"));
assert.ok(invalidResult.errors.some((entry) => entry.code === "RELATIONSHIP_DELTA_WITHOUT_EVIDENCE"));
assert.ok(invalidResult.errors.some((entry) => entry.code === "REPORTED_EVENT_WRITTEN_AS_FIRSTHAND"));

const boundarySafeDecision = {
  perceivedFacts: [
    { id: "impact:zhoumin:unverified-report", status: "sourced_report", summary: "转述者声称谢真石从没打算举荐周珉，但没有可核实来源。", basisIds: ["impact:zhoumin:unverified-report"] },
    { id: "episode:zhoumin:firsthand-guidance-from-xie", status: "firsthand_memory", summary: "周珉记得谢真石曾给过有效的具体指导。", basisIds: ["episode:zhoumin:firsthand-guidance-from-xie"] },
    { id: "fact:no-corroboration", status: "objective", summary: "当前没有独立证据支持或反驳这项说法。", basisIds: ["fact:no-corroboration"] },
  ],
  candidateComparison: [
    { candidateId: "candidate:continue", primitiveId: "continue", targetCharacterId: "", affordanceId: "", feasible: true, attemptable: true, reason: "可以继续手头事务并保留未完成判断。" },
    { candidateId: "candidate:ask-reporter", primitiveId: "ask", targetCharacterId: "char_probe_reporter", affordanceId: "", feasible: true, attemptable: true, reason: "转述者在场，可以询问来源，但未必能得到可靠证据。" },
    { candidateId: "candidate:move-counter", primitiveId: "move", targetCharacterId: "", affordanceId: "affordance:hall-to-counter", feasible: true, attemptable: true, reason: "世界提供了走向柜台的相邻路线。" },
  ],
  chosenCandidateId: "candidate:continue",
  epistemicUpdate: {
    sourceEventId: "impact:zhoumin:unverified-report",
    classification: "sourced_report",
    claimAcceptedAsFact: false,
    confidenceBand: "low",
    evidenceBasisIds: ["impact:zhoumin:unverified-report"],
  },
  relationshipUpdate: {
    targetCharacterId: XIE,
    change: "provisional_doubt",
    durable: false,
    evidenceBasisIds: ["impact:zhoumin:unverified-report"],
  },
  action: {
    primitiveId: "continue",
    targetCharacterId: "",
    affordanceId: "",
    speechAct: "none",
    speech: "",
    visibleAction: "周珉把目光移回手边，没有立刻走向任何人。",
  },
  futureIntention: {
    mode: "seek_evidence",
    targetCharacterId: XIE,
    triggerCondition: "出现本人可以实际观察或核实的新线索",
    knowledgeLimit: "depends_on_future_evidence",
  },
  memoryWrite: {
    kind: "sourced_report",
    sourceEventId: "impact:zhoumin:unverified-report",
    proposition: "转述者声称谢真石从没打算举荐周珉",
    confidenceBand: "low",
  },
  postChoiceContinuity: {
    phase: "pending_world_resolution",
    choiceSignificance: "ordinary",
    actionMemory: {
      mode: "none",
      content: "",
      basisIds: [],
    },
    desireContinuity: [{
      desireId: CORE_DESIRE,
      status: "unaffected",
      pressureDirection: "stable",
      strengthBand: "low",
      settlementCondition: "action_committed",
      reason: "继续手头事务并没有让进入内门这一目标前进或完成。",
      basisIds: [CORE_DESIRE, "candidate:continue"],
    }],
    dynamicStateContinuity: [{
      stateId: "state_zhoumin_concealed_relationship_doubt",
      direction: "increase",
      strengthBand: "low",
      settlementCondition: "action_committed",
      linkedDesireId: "",
      reason: "低可信转述留下暂时疑问，但还不足以改变关系判断。",
      basisIds: ["state_zhoumin_concealed_relationship_doubt", "impact:zhoumin:unverified-report"],
    }],
    selfNarrative: {
      mode: "none",
      proposedClaim: "",
      replacesClaimIds: [],
      significanceBand: "low",
      permanenceBand: "low",
      basisIds: [],
      consolidationStatus: "not_applicable",
    },
  },
  memoryRetrieval: {
    episodeIds: ["episode:zhoumin:firsthand-guidance-from-xie"],
    influence: "既往第一手帮助与当前低来源传闻冲突，使立即把传闻当真缺少依据。",
  },
  expectedWorldConsequences: [
    { kind: "visible_action", certainty: "direct", description: "旁人只会看见周珉继续手头事务。", basisIds: ["candidate:continue"] },
    { kind: "report_stored", certainty: "direct", description: "这项说法只以带来源报告保留。", basisIds: ["impact:zhoumin:unverified-report"] },
    { kind: "future_opportunity", certainty: "conditional", description: "之后能否核实取决于世界是否出现真实线索。", basisIds: ["fact:no-corroboration"] },
  ],
  factorLedger: {
    chosen: [{ factorId: "uncertaintyRisk", direction: "supports", strengthBand: "high", basisIds: ["impact:zhoumin:unverified-report"] }],
    rejectedAlternative: { primitiveId: "ask", factors: [] },
  },
  privateReason: "这里只确认有人这样说过；事实和关系都还缺证据。",
};
const validResult = validateCharacterFoundationProbeDecision(probeInput, boundarySafeDecision);
assert.equal(validResult.valid, true, JSON.stringify(validResult.errors));

const firsthandSelfActionInput = structuredClone(probeInput);
firsthandSelfActionInput.ownedMemory.episodes[0].source.kind = "firsthand_self_action";
firsthandSelfActionInput.ownedMemory.episodes[0].sourceType = "firsthand_self_action_summary";
const firsthandSelfActionResult = validateCharacterFoundationProbeDecision(
  firsthandSelfActionInput,
  boundarySafeDecision,
);
assert.equal(firsthandSelfActionResult.valid, true, JSON.stringify(firsthandSelfActionResult.errors));

const sourcedOwnedEpisodeInput = structuredClone(probeInput);
sourcedOwnedEpisodeInput.ownedMemory.episodes[0].source.kind = "reported";
sourcedOwnedEpisodeInput.ownedMemory.episodes[0].sourceType = "reported_claim";
const sourcedOwnedEpisodeDecision = structuredClone(boundarySafeDecision);
sourcedOwnedEpisodeDecision.perceivedFacts[1].status = "sourced_report";
const sourcedOwnedEpisodeResult = validateCharacterFoundationProbeDecision(
  sourcedOwnedEpisodeInput,
  sourcedOwnedEpisodeDecision,
);
assert.equal(sourcedOwnedEpisodeResult.valid, true, JSON.stringify(sourcedOwnedEpisodeResult.errors));

assert.ok(characterFoundationProbeDecisionSchema.properties.perceivedFacts.items.required.includes("basisIds"));

const validInferenceDecision = structuredClone(boundarySafeDecision);
validInferenceDecision.perceivedFacts.push({
  id: "inference:report-needs-verification",
  status: "inference",
  summary: "这项转述值得核实，但不足以证明谢真石已经拒绝举荐。",
  basisIds: [
    "impact:zhoumin:unverified-report",
    "fact:no-corroboration",
    "episode:zhoumin:firsthand-guidance-from-xie",
  ],
});
const validInferenceResult = validateCharacterFoundationProbeDecision(probeInput, validInferenceDecision);
assert.equal(validInferenceResult.valid, true, JSON.stringify(validInferenceResult.errors));

const chosenFactorSchema = characterFoundationProbeDecisionSchema
  .properties.factorLedger.properties.chosen.items;
assert.equal(chosenFactorSchema.properties.basisIds.minItems, 1);

const ungroundedPersonalityFactorDecision = structuredClone(boundarySafeDecision);
ungroundedPersonalityFactorDecision.factorLedger.chosen.push({
  factorId: "covertVerificationPreference",
  direction: "supports",
  strengthBand: "high",
  basisIds: ["impact:zhoumin:unverified-report", "fact:no-corroboration"],
});
const ungroundedPersonalityFactorResult = validateCharacterFoundationProbeDecision(
  probeInput,
  ungroundedPersonalityFactorDecision,
);
assert.equal(ungroundedPersonalityFactorResult.valid, false);
assert.ok(ungroundedPersonalityFactorResult.errors.some((entry) => entry.code === "FACTOR_PARAMETER_BASIS_MISSING"));

const groundedPersonalityFactorDecision = structuredClone(ungroundedPersonalityFactorDecision);
groundedPersonalityFactorDecision.factorLedger.chosen.at(-1).basisIds.push(
  "foundation.stablePsychology.dispositions.covertVerificationPreference",
);
const groundedPersonalityFactorResult = validateCharacterFoundationProbeDecision(
  probeInput,
  groundedPersonalityFactorDecision,
);
assert.equal(groundedPersonalityFactorResult.valid, true, JSON.stringify(groundedPersonalityFactorResult.errors));

const ownedResourceInput = structuredClone(probeInput);
ownedResourceInput.world.ownedResources = [{
  id: "resource:probe:owned-copper",
  currencyId: "copper_wen",
  amount: 8,
}];
const ownedResourceDecision = structuredClone(boundarySafeDecision);
ownedResourceDecision.factorLedger.chosen.push({
  factorId: "priceCost",
  direction: "opposes",
  strengthBand: "low",
  basisIds: ["resource:probe:owned-copper"],
});
const ownedResourceResult = validateCharacterFoundationProbeDecision(
  ownedResourceInput,
  ownedResourceDecision,
);
assert.equal(ownedResourceResult.valid, true, JSON.stringify(ownedResourceResult.errors));

const inventedOwnedResourceDecision = structuredClone(ownedResourceDecision);
inventedOwnedResourceDecision.factorLedger.chosen.at(-1).basisIds = ["resource:probe:not-owned"];
const inventedOwnedResourceResult = validateCharacterFoundationProbeDecision(
  ownedResourceInput,
  inventedOwnedResourceDecision,
);
assert.equal(inventedOwnedResourceResult.valid, false);
assert.ok(inventedOwnedResourceResult.errors.some((entry) => entry.code === "FACTOR_BASIS_UNKNOWN"));

const inventedFactorDecision = structuredClone(boundarySafeDecision);
inventedFactorDecision.factorLedger.chosen[0].factorId = "invented_personality_excuse";
const inventedFactorResult = validateCharacterFoundationProbeDecision(probeInput, inventedFactorDecision);
assert.equal(inventedFactorResult.valid, false);
assert.ok(inventedFactorResult.errors.some((entry) => entry.code === "FACTOR_ID_UNKNOWN"));

const aliasedSourceDecision = structuredClone(boundarySafeDecision);
aliasedSourceDecision.perceivedFacts[0].id = "pf:reported-claim";
aliasedSourceDecision.perceivedFacts[0].basisIds = ["impact:zhoumin:unverified-report"];
const aliasedSourceResult = validateCharacterFoundationProbeDecision(probeInput, aliasedSourceDecision);
assert.equal(aliasedSourceResult.valid, false);
assert.ok(aliasedSourceResult.errors.some((entry) => entry.code === "PERCEIVED_FACT_UNKNOWN"));

const sourceWithoutSelfBasisDecision = structuredClone(boundarySafeDecision);
sourceWithoutSelfBasisDecision.perceivedFacts[0].basisIds = ["fact:no-corroboration"];
const sourceWithoutSelfBasisResult = validateCharacterFoundationProbeDecision(probeInput, sourceWithoutSelfBasisDecision);
assert.equal(sourceWithoutSelfBasisResult.valid, false);
assert.ok(sourceWithoutSelfBasisResult.errors.some((entry) => entry.code === "PERCEIVED_FACT_SELF_BASIS_MISSING"));

const inferenceWithUnknownBasisDecision = structuredClone(validInferenceDecision);
inferenceWithUnknownBasisDecision.perceivedFacts.at(-1).basisIds = ["pf:reported-claim"];
const inferenceWithUnknownBasisResult = validateCharacterFoundationProbeDecision(probeInput, inferenceWithUnknownBasisDecision);
assert.equal(inferenceWithUnknownBasisResult.valid, false);
assert.ok(inferenceWithUnknownBasisResult.errors.some((entry) => entry.code === "PERCEIVED_INFERENCE_BASIS_UNKNOWN"));

const incompleteProjection = structuredClone(boundarySafeDecision);
delete incompleteProjection.candidateComparison;
const incompleteProjectionResult = validateCharacterFoundationProbeDecision(probeInput, incompleteProjection);
assert.equal(incompleteProjectionResult.valid, false);
assert.ok(incompleteProjectionResult.errors.some((entry) => entry.code === "HOLDOUT_PROJECTION_INCOMPLETE"));

const sourceSmugglingDecision = structuredClone(boundarySafeDecision);
sourceSmugglingDecision.relationshipUpdate.change = "provisional_doubt";
sourceSmugglingDecision.relationshipUpdate.durable = true;
sourceSmugglingDecision.memoryWrite.kind = "belief_update";
sourceSmugglingDecision.futureIntention.knowledgeLimit = "no_new_knowledge_yet";
sourceSmugglingDecision.factorLedger.chosen[0].basisIds = ["evidence:does-not-exist"];
const sourceSmugglingResult = validateCharacterFoundationProbeDecision(probeInput, sourceSmugglingDecision);
assert.equal(sourceSmugglingResult.valid, false);
assert.ok(sourceSmugglingResult.errors.some((entry) => entry.code === "PROVISIONAL_RELATIONSHIP_MARKED_DURABLE"));
assert.ok(sourceSmugglingResult.errors.some((entry) => entry.code === "REPORTED_EVENT_LOST_SOURCE"));
assert.ok(sourceSmugglingResult.errors.some((entry) => entry.code === "FACTOR_BASIS_UNKNOWN"));
assert.ok(sourceSmugglingResult.errors.some((entry) => entry.code === "FUTURE_KNOWLEDGE_LIMIT_INVALID"));

const systemPrompt = characterFoundationProbeSystemPrompt(probeInput);
assert.ok(systemPrompt.includes("人物 Agent"));
assert.ok(systemPrompt.includes("心理工具"));
assert.ok(systemPrompt.includes("不得另造 pf:"));
assert.ok(systemPrompt.includes("inference:*"));
assert.ok(systemPrompt.includes("人格参数作为 factorId"));
assert.ok(systemPrompt.includes("targetMode 是动作对象合同"));
assert.ok(systemPrompt.includes("事件来源或受益者不会自动成为动作对象"));
assert.ok(systemPrompt.includes("selfNarrative.mode 为 none"));
assert.ok(systemPrompt.includes("depends_on_future_evidence"));
assert.ok(systemPrompt.includes("firsthand_self_action"));
assert.ok(!systemPrompt.includes("AUTHOR_EXPECTED_ANSWER_MUST_NOT_ENTER_AGENT"));

console.log("characterFoundationBlindProbe:test passed", {
  characterId: ZHOU,
  probeId: probeInput.probeId,
  actionChoiceNotAsserted: true,
  authorAcceptanceStillRequired: true,
});
