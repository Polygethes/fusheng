import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";

import {
  CODEX_TRUSTED_TAVERN_AGENT_PURPOSE,
  auditCodexTrustedTavernAgentInput,
  buildCodexTrustedTavernAgentDecisionSchema,
  buildCodexTrustedTavernAgentInvocation,
  buildCodexTrustedTavernAgentPrompt,
  runTavernCausalAgentWithCodex,
} from "../src/server/ecology/codexTrustedTavernAgentChannel.mjs";
import { runTavernCausalScene } from "../src/server/pipeline/tavernCausalScene.mjs";
import { evaluateCharacterExchangeIntegrity } from "../src/server/simulation/characterExchangeIntegrity.mjs";
import {
  ZHOU_MIN_BEHAVIOR_ACCEPTANCE_IDS,
  buildZhouMinTavernBehaviorAcceptanceFixture,
} from "./fixtures/zhouMinTavernBehaviorAcceptanceFixture.mjs";

const ids = ZHOU_MIN_BEHAVIOR_ACCEPTANCE_IDS;

function noOpContinuity(input, candidateId) {
  const desireIds = Object.keys(input.agent?.privateState?.ecologyState?.desires || {});
  return {
    phase: "pending_world_resolution",
    choiceSignificance: "ordinary",
    actionMemory: { mode: "none", content: "", basisIds: [] },
    desireContinuity: desireIds.map((desireId) => ({
      desireId,
      status: "unaffected",
      pressureDirection: "stable",
      strengthBand: "low",
      settlementCondition: "action_committed",
      reason: "结构 dry-run 不声明人物心理发生变化。",
      basisIds: [desireId, candidateId],
    })),
    dynamicStateContinuity: [],
    selfNarrative: {
      mode: "none",
      proposedClaim: "",
      replacesClaimIds: [],
      significanceBand: "low",
      permanenceBand: "low",
      basisIds: [],
      consolidationStatus: "not_applicable",
    },
  };
}

function noOpRelationshipAppraisal() {
  return {
    phase: "pending_perception_appraisal",
    targetCharacterId: "",
    sourceImpactIds: [],
    changeMode: "none",
    dimensionChanges: [],
    reason: "",
  };
}

function schemaCompletePass(input) {
  const candidate = input.privateActionCandidates.find((row) => row.feasible);
  assert.ok(candidate, "dry-run input must contain one feasible candidate");
  return {
    candidateId: candidate.candidateId,
    actionType: "pass",
    speechAct: "none",
    targetCharacterId: candidate.targetCharacterId || "",
    speech: "",
    visibleAction: "",
    moveToZoneId: "",
    vocalMode: "conversational",
    affordanceId: "",
    informationSourceImpactId: "",
    commitmentAction: "none",
    commitmentTopic: "",
    decisionValue: "none",
    semanticFrameId: candidate.semanticFrame?.id || "",
    semanticRoleBindings: candidate.semanticFrame?.roles || {},
    privateReason: "结构 dry-run 只检查受信任通道，不作为人物行为答案。",
    relationshipAppraisal: noOpRelationshipAppraisal(),
    postChoiceContinuity: noOpContinuity(input, candidate.candidateId),
  };
}

function schemaCompleteDryRunQuestion(input) {
  const zhou = input.perceivedCharacters.find((row) => row.id === "char_xyy_zhoumin");
  assert.ok(zhou, "Xie Zhenshi must actually perceive Zhou Min before choosing to address him");
  const candidate = input.privateActionCandidates.find((row) => (
    row.feasible
    && (!row.targetCharacterId || row.targetCharacterId === "char_xyy_zhoumin")
    && (row.realization?.allowedSpeechActs || []).includes("ask")
  ));
  assert.ok(candidate, "Xie Zhenshi dry-run input must expose a feasible intention that he may direct toward a perceived Zhou Min");
  return {
    candidateId: candidate.candidateId,
    actionType: "speak",
    speechAct: "ask",
    targetCharacterId: zhou.id,
    speech: "周珉，药一时交不了。你还等什么？",
    visibleAction: "",
    moveToZoneId: "",
    vocalMode: "conversational",
    affordanceId: "",
    informationSourceImpactId: "",
    commitmentAction: "none",
    commitmentTopic: "眼前停留",
    decisionValue: "none",
    semanticFrameId: candidate.semanticFrame?.id || "",
    semanticRoleBindings: candidate.semanticFrame?.roles || {},
    privateReason: "结构 dry-run 只验证由第一位 Agent 的真实动作触发第二位 Agent，不作为人物台词答案。",
    relationshipAppraisal: noOpRelationshipAppraisal(),
    postChoiceContinuity: noOpContinuity(input, candidate.candidateId),
  };
}

function schemaCompleteDryRunReply(input) {
  const candidate = input.privateActionCandidates.find((row) => (
    row.feasible
    && row.targetCharacterId === "char_xyy_xiezenshi"
    && row.realization?.mode === "respond"
  ));
  assert.ok(candidate, "Zhou Min dry-run input must contain a feasible response to Xie Zhenshi's live turn");
  return {
    candidateId: candidate.candidateId,
    actionType: "speak",
    speechAct: "answer",
    targetCharacterId: candidate.targetCharacterId,
    speech: "等你。替我看一遍剑？",
    visibleAction: "",
    moveToZoneId: "",
    vocalMode: "conversational",
    affordanceId: "",
    informationSourceImpactId: "",
    commitmentAction: "none",
    commitmentTopic: "请教剑法",
    decisionValue: "none",
    semanticFrameId: candidate.semanticFrame?.id || "",
    semanticRoleBindings: candidate.semanticFrame?.roles || {},
    privateReason: "结构 dry-run 只验证第二位 Agent 承接第一位 Agent 的真实话轮，不作为人物台词答案。",
    relationshipAppraisal: noOpRelationshipAppraisal(),
    postChoiceContinuity: noOpContinuity(input, candidate.candidateId),
  };
}

const fixture = buildZhouMinTavernBehaviorAcceptanceFixture();
const capturedInputs = [];
const dryScene = await runTavernCausalScene(fixture.state, {
  characterIds: fixture.characterIds,
  positions: fixture.positions,
  seedImpacts: fixture.seedImpacts,
  slotContext: fixture.slotContext,
  maxSteps: 2,
  maxLocalFollowupSteps: 1,
  minimumActivationScore: 0,
  async runAgent(input) {
    capturedInputs.push(structuredClone(input));
    return {
      decision: capturedInputs.length === 1
        ? schemaCompleteDryRunQuestion(input)
        : schemaCompleteDryRunReply(input),
    };
  },
});

assert.equal(capturedInputs.length, 2, "formal tavern runtime must allow both present Character Agents to decide without a scripted opener");
assert.equal(capturedInputs[0].agent.id, "char_xyy_xiezenshi", "the real scheduler may activate Xie Zhenshi from the perceived stalled handoff");
assert.deepEqual(
  new Set(capturedInputs.map((input) => input.agent.id)),
  new Set(["char_xyy_xiezenshi", "char_xyy_zhoumin"]),
);
const capturedInput = capturedInputs.find((input) => input.agent.id === "char_xyy_zhoumin");
assert.ok(capturedInput, "Zhou Min must still receive an unscripted decision turn");
for (const input of capturedInputs) {
  const peerId = input.agent.id === "char_xyy_xiezenshi" ? "char_xyy_zhoumin" : "char_xyy_xiezenshi";
  const peerResponses = input.privateActionCandidates.filter((candidate) => (
    candidate.feasible
    && (candidate.targetCharacterId === peerId || (
      input.agent.id === "char_xyy_xiezenshi"
      && !candidate.targetCharacterId
    ))
  ));
  assert.ok(peerResponses.length > 0, `${input.agent.id} must retain a feasible intention and personally choose whether to direct it toward the perceived peer`);
  for (const candidate of peerResponses) {
    assert.equal(Number(candidate.copingBias?.repairNeed || 0), 0, "ordinary familiar coordination carries no invented rupture");
    assert.notEqual(candidate.expressionStrategy?.mode, "relationship-repair", "closeness alone must not tell either Agent to repair the relationship");
  }
}
assert.equal(
  dryScene.actions.length,
  2,
  `both test-only Agent decisions must commit as one causal exchange: ${JSON.stringify(dryScene.decisions.map((row) => ({
    characterId: row.characterId,
    candidateId: row.candidateId,
    actionType: row.decision?.actionType,
    speechAct: row.decision?.speechAct,
    semanticViolations: row.decision?.semanticViolations,
  })), null, 2)}`,
);
const [dryQuestion, dryReply] = dryScene.actions;
assert.equal(dryQuestion.actorId, "char_xyy_xiezenshi");
assert.equal(dryQuestion.speechAct, "ask");
assert.equal(dryQuestion.semanticFrame?.roles?.actor, "char_xyy_xiezenshi");
assert.equal(dryQuestion.semanticFrame?.roles?.addressee, "char_xyy_zhoumin");
assert.equal(dryReply.actorId, "char_xyy_zhoumin");
assert.equal(dryReply.speechAct, "answer");
assert.equal(dryReply.semanticFrame?.roles?.actor, "char_xyy_zhoumin", "a reply memory must belong to its actual speaker");
assert.equal(dryReply.semanticFrame?.roles?.addressee, "char_xyy_xiezenshi", "a reply memory must point to its actual addressee");
assert.equal(dryReply.semanticFrame?.parentFrameId, dryQuestion.publicSemanticFrame?.id, "the reply keeps the preceding public utterance, not the speaker's private motive, as its semantic parent");
assert.doesNotMatch(
  JSON.stringify(dryQuestion.impactFactors || []),
  /desire_xiezenshi_obtain_father_help_and_recover/u,
  "Xie Zhenshi's private recovery desire must not enter Zhou Min's response input",
);
assert.equal(dryReply.sourceThreadId, dryQuestion.sourceThreadId, "both turns keep one conversation identity");
assert.equal(
  dryScene.privateSceneRuntime.requestLocks.find((lock) => lock.threadId === dryQuestion.sourceThreadId)?.status,
  "resolved",
  "the answer resolves the obligation even while provenance keeps the thread id",
);
const dryIntegrity = evaluateCharacterExchangeIntegrity({
  requiredCharacterIds: fixture.characterIds,
  decisions: dryScene.decisions,
  actions: dryScene.actions,
});
assert.equal(dryIntegrity.complete, true, JSON.stringify(dryIntegrity.issues));

const exactChainIntegrity = evaluateCharacterExchangeIntegrity({
  requiredCharacterIds: [ids.xieZhenshi, ids.zhou],
  decisions: [
    { characterId: ids.xieZhenshi, decision: { choiceAuthority: "character-agent", actionType: "speak" } },
    { characterId: ids.zhou, decision: { choiceAuthority: "character-agent", actionType: "speak" } },
  ],
  actions: [
    {
      id: "chain:a",
      actorId: ids.xieZhenshi,
      targetCharacterId: ids.zhou,
      sourceThreadId: "thread:exact-chain",
      impactFactors: [{ id: "impact:chain:a" }],
    },
    {
      id: "chain:b",
      actorId: ids.zhou,
      targetCharacterId: ids.xieZhenshi,
      sourceThreadId: "thread:exact-chain",
      responseToTurnId: "chain:a",
      causalParentImpactId: "impact:chain:a",
      impactFactors: [{ id: "impact:chain:b" }],
    },
    {
      id: "chain:c",
      actorId: ids.xieZhenshi,
      targetCharacterId: ids.zhou,
      sourceThreadId: "thread:exact-chain",
      responseToTurnId: "chain:b",
      causalParentImpactId: "impact:chain:b",
      impactFactors: [{ id: "impact:chain:c" }],
    },
    {
      id: "chain:d",
      actorId: ids.zhou,
      targetCharacterId: ids.xieZhenshi,
      sourceThreadId: "thread:exact-chain",
      responseToTurnId: "chain:c",
      causalParentImpactId: "impact:chain:c",
      impactFactors: [{ id: "impact:chain:d" }],
    },
  ],
});
assert.deepEqual(
  exactChainIntegrity.causalPairs.map((pair) => `${pair.sourceActionId}->${pair.responseActionId}`),
  ["chain:a->chain:b", "chain:b->chain:c", "chain:c->chain:d"],
  "one conversation thread must not turn every compatible old turn into the direct parent of the latest reply",
);
const incompleteIntegrity = evaluateCharacterExchangeIntegrity({
  requiredCharacterIds: fixture.characterIds,
  decisions: [dryScene.decisions[0]],
  actions: [dryScene.actions[0]],
});
assert.equal(incompleteIntegrity.complete, false);
assert.ok(incompleteIntegrity.issues.some((issue) => (
  issue.code === "REQUIRED_CHARACTER_DECISION_MISSING"
  && issue.characterIds.includes("char_xyy_zhoumin")
)));
assert.ok(incompleteIntegrity.issues.some((issue) => issue.code === "CAUSAL_EXCHANGE_MISSING"));

const technicallyRejectedIntegrity = evaluateCharacterExchangeIntegrity({
  requiredCharacterIds: fixture.characterIds,
  decisions: [
    ...dryScene.decisions,
    {
      step: 99,
      characterId: "char_xyy_zhoumin",
      choiceAuthority: "character-agent:technical-rejection",
      repair: { attempted: true, accepted: false },
      decision: {
        semanticViolations: [{ code: "TEST_PRIVATE_REALIZATION_REJECTED" }],
      },
    },
  ],
  actions: dryScene.actions,
  stopReason: "character-decision-unrealized",
});
assert.equal(technicallyRejectedIntegrity.complete, false);
assert.ok(technicallyRejectedIntegrity.issues.some((issue) => (
  issue.code === "CHARACTER_DECISION_TECHNICAL_REJECTION"
)));

const unresolvedIntegrity = evaluateCharacterExchangeIntegrity({
  requiredCharacterIds: fixture.characterIds,
  decisions: dryScene.decisions,
  actions: dryScene.actions,
  stopReason: "unresolved-request",
  unresolvedRequests: [{
    id: "request:test",
    threadId: "thread:test",
    requesterId: "char_xyy_xiezenshi",
    responderId: "char_xyy_zhoumin",
    status: "awaiting",
  }],
});
assert.equal(unresolvedIntegrity.complete, false);
assert.ok(unresolvedIntegrity.issues.some((issue) => issue.code === "UNRESOLVED_CHARACTER_REQUEST"));

// A rejected implementation is not a world action.  If a valid question then
// lands on the final ordinary step, one bounded same-scene turn must still be
// available to the actual addressee.
const recoveryInputs = [];
const recoveryScene = await runTavernCausalScene(buildZhouMinTavernBehaviorAcceptanceFixture().state, {
  characterIds: fixture.characterIds,
  positions: fixture.positions,
  seedImpacts: fixture.seedImpacts,
  slotContext: fixture.slotContext,
  maxSteps: 2,
  maxLocalFollowupSteps: 1,
  minimumActivationScore: 0,
  async runAgent(input) {
    recoveryInputs.push(structuredClone(input));
    if (recoveryInputs.length === 1) {
      return {
        decision: {
          ...schemaCompletePass(input),
          candidateId: "candidate_not_available_to_this_character",
        },
      };
    }
    return {
      decision: input.agent.id === "char_xyy_xiezenshi"
        ? schemaCompleteDryRunQuestion(input)
        : schemaCompleteDryRunReply(input),
    };
  },
});
assert.deepEqual(
  recoveryInputs.map((input) => input.agent.id),
  ["char_xyy_xiezenshi", "char_xyy_xiezenshi", "char_xyy_zhoumin"],
  "a rejected first implementation must not let the final-step question strand its addressee",
);
const recoveryIntegrity = evaluateCharacterExchangeIntegrity({
  requiredCharacterIds: fixture.characterIds,
  decisions: recoveryScene.decisions,
  actions: recoveryScene.actions,
});
assert.equal(recoveryIntegrity.complete, true, JSON.stringify(recoveryIntegrity.issues));
for (const input of capturedInputs) {
  const audit = auditCodexTrustedTavernAgentInput(input);
  assert.deepEqual(audit.errors, []);
  assert.equal(audit.valid, true);
  assert.equal(audit.boundary.finalChoiceOwner, "character-agent");
  for (const candidate of input.privateActionCandidates) {
    assert.equal(candidate.speechRealization?.authority, "generic-conversational-realization");
    assert.equal(candidate.speechRealization?.privateReasonIsNotSpeech, true);
  }
}
const audit = auditCodexTrustedTavernAgentInput(capturedInput);

const prompt = buildCodexTrustedTavernAgentPrompt(capturedInput);
for (const forbidden of [
  path.resolve(import.meta.dirname, "..", ".."),
  "anchor-payload.json",
  "calibration-evidence.json",
  "holdouts.md",
  "这名额我不要",
  "拿朋友的私事换",
  "听谁说的？",
  "我娘还没回来。药先拿着。你还站这儿，是另有事？",
  "真石，我想请你指点剑法。举荐的事，也想和你说清。",
]) {
  assert.equal(prompt.includes(forbidden), false, `trusted tavern prompt leaked ${forbidden}`);
}
assert.ok(prompt.includes("desire_zhoumin_become_inner_court_disciple"));
assert.ok(prompt.includes("谢真石"));
assert.ok(prompt.includes("药包要等谢母回来验收"));

const strictSchema = buildCodexTrustedTavernAgentDecisionSchema(capturedInput);
function assertStrictObjects(node, pathName = "$") {
  if (!node || typeof node !== "object") return;
  if (node.type === "object" && node.properties) {
    assert.equal(node.additionalProperties, false, `${pathName} must reject unknown output fields`);
    assert.deepEqual(new Set(node.required || []), new Set(Object.keys(node.properties)), `${pathName} must require every property`);
    for (const [key, child] of Object.entries(node.properties)) assertStrictObjects(child, `${pathName}.${key}`);
  }
  if (node.items) assertStrictObjects(node.items, `${pathName}[]`);
}
assertStrictObjects(strictSchema);
assert.ok(strictSchema.required.includes("vocalMode"));
assert.ok(strictSchema.required.includes("relationshipAppraisal"));
assert.ok(strictSchema.properties.relationshipAppraisal.properties.changeMode.enum.includes("retained"));
assert.ok(strictSchema.properties.semanticRoleBindings.required.length >= 2);

for (const [index, input] of capturedInputs.entries()) {
  const inputPrompt = buildCodexTrustedTavernAgentPrompt(input);
  const invocation = buildCodexTrustedTavernAgentInvocation({
    input,
    tempDirectory: `/private/tmp/gtown-two-agent-behavior-contract-${index}`,
    schemaPath: `/private/tmp/gtown-two-agent-behavior-contract-${index}/decision.schema.json`,
    outputPath: `/private/tmp/gtown-two-agent-behavior-contract-${index}/decision.json`,
  });
  assert.equal(invocation.purpose, CODEX_TRUSTED_TAVERN_AGENT_PURPOSE);
  assert.equal(invocation.command, "codex");
  assert.equal(invocation.stdin, inputPrompt);
  assert.ok(invocation.args.includes("--ephemeral"));
  assert.ok(invocation.args.includes("--ignore-user-config"));

  const stubDecision = schemaCompletePass(input);
  const trustedResult = await runTavernCausalAgentWithCodex(input, {
    async execute(stubInvocation) {
      const outputIndex = stubInvocation.args.indexOf("--output-last-message");
      assert.notEqual(outputIndex, -1);
      await fs.writeFile(stubInvocation.args[outputIndex + 1], `${JSON.stringify(stubDecision)}\n`, "utf8");
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });
  assert.deepEqual(trustedResult.decision, stubDecision);
  assert.equal(trustedResult.stage.provider, "openai");
  assert.equal(trustedResult.stage.inputAuditPassed, true);
  assert.equal(trustedResult.stage.purpose, CODEX_TRUSTED_TAVERN_AGENT_PURPOSE);
}

const manifest = JSON.parse(await fs.readFile(
  new URL("../.codex/anchors/scene_xyy_wangti_tavern/characters/char_xyy_zhoumin/manifest.json", import.meta.url),
  "utf8",
));
assert.ok(
  ["pending", "passed"].includes(manifest.gates.behaviorAcceptance),
  "dry-run may inspect but must not invent an author-owned behavior-gate state",
);

console.log("zhouMinTavernBehaviorAcceptance:test passed", {
  characterIds: capturedInputs.map((input) => input.agent.id),
  candidateCounts: Object.fromEntries(capturedInputs.map((input) => [input.agent.id, input.privateActionCandidates.length])),
  inputAuditPassed: audit.valid,
  trustedPurpose: CODEX_TRUSTED_TAVERN_AGENT_PURPOSE,
  remoteModelCalled: false,
  prewrittenDialogue: false,
  rejectedAttemptRecovery: recoveryInputs.length,
  recordedBehaviorAcceptance: manifest.gates.behaviorAcceptance,
  dryRunPromotedBehaviorGate: false,
});
