import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  createTavernWorldRuntimeV27,
  projectTavernWorldRuntimeV27ForObserver,
} from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import { tavernCharacterAgentV2OutputSchemaForStage } from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import { openAIJsonCharacterModelStageDefinition } from "../src/server/ecology/openAIJsonCharacterModelProvider.mjs";
import { createOpenAIJsonCharacterModelProvider } from "../src/server/ecology/openAIJsonCharacterModelProvider.mjs";
import { createCodexTrustedCharacterModelProvider } from "../src/server/ecology/codexTrustedCharacterModelProvider.mjs";
import { createCharacterModelSessionPool } from "../src/server/simulation/characterModelSession.mjs";
import { createTavernV27CharacterModelSessionStageFactory } from
  "../src/server/pipeline/tavernV27PersistentModelSession.mjs";
import { resolveV27CharacterAgentCallMode } from "../src/server/v27CharacterModelProvider.mjs";
import {
  auditCodexTrustedTavernCharacterAgentV2Input,
  tavernCharacterAgentV2StageDefinition,
} from "../src/server/ecology/codexTrustedTavernCharacterAgentV2Channel.mjs";

const CHARACTER_IDS = ["char_xyy_xiezenshi", "char_xyy_luozhao"];
const WORLD_ID = "world:test:v27-two-call-fast-path";

assert.equal(resolveV27CharacterAgentCallMode({}), "three-call",
  "the browser product uses actual post-regulation expression by default");
assert.equal(resolveV27CharacterAgentCallMode({
  GTOWN_V27_CHARACTER_AGENT_CALL_MODE: "   ",
}), "three-call", "a blank browser configuration keeps the strict default");
assert.equal(resolveV27CharacterAgentCallMode({
  GTOWN_V27_CHARACTER_AGENT_CALL_MODE: "standard",
  GTOWN_V27_DIAGNOSTIC_LEGACY_CALL_MODE: "1",
}), "standard", "legacy four-call operation remains an explicit diagnostic option");
assert.throws(
  () => resolveV27CharacterAgentCallMode({ GTOWN_V27_CHARACTER_AGENT_CALL_MODE: "unknown" }),
  (error) => error.code === "TAVERN_CHARACTER_AGENT_CALL_MODE_INVALID",
);

function clone(value) {
  return structuredClone(value);
}

function seedState() {
  return buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
}

async function runOneTurn({
  runStage,
  characterAgentCallMode = "standard",
  maxStageProtocolRepairs = 0,
} = {}) {
  const instance = createTavernWorldRuntimeV27(seedState(), {
    characterIds: CHARACTER_IDS,
    positions: {
      char_xyy_xiezenshi: "hall",
      char_xyy_luozhao: "hall",
    },
    worldId: WORLD_ID,
    characterAgentCallMode,
    maxStageProtocolRepairs,
    runStage,
  });
  await instance.runtime.enqueueWake("char_xyy_xiezenshi", {
    wakeId: "wake:test:v27-two-call-fast-path",
    kind: "opportunity_window",
    evidenceIds: [],
    evidence: [],
  });
  const turns = await instance.runtime.runUntilIdle({ maxTurns: 1 });
  return { instance, turns };
}

// Capture a known-good four-stage turn from the deterministic fixture. The
// fast-path runner below returns the same Character-authored material in two
// provider envelopes, so this contract tests orchestration rather than a
// second hand-maintained psychology fixture.
const fixture = createTavernV27FixtureStageRunner();
const baselineResults = new Map();
const baselineCalls = [];
await runOneTurn({
  runStage: async (stageInput, options = {}) => {
    const result = await fixture(stageInput, options);
    baselineCalls.push(options.stage);
    baselineResults.set(options.stage, clone(result));
    return result;
  },
});
assert.deepEqual(baselineCalls, [
  "subjective_appraisal",
  "agent_candidates",
  "agent_choice_and_regulation",
  "agent_turn_commit",
], "standard mode must remain the compatible four-call default at the library seam");

const fastCalls = [];
function combinedFixtureResult(stageInput, stage) {
  if (stage === "subjective_appraisal_and_candidates") {
    return {
      appraisalAndCandidates: {
        appraisal: clone(baselineResults.get("subjective_appraisal").appraisal),
        candidates: clone(baselineResults.get("agent_candidates").candidates),
      },
      stage: {
        name: `FastFixture:subjective_appraisal_and_candidates:${stageInput.characterId}`,
        provider: "local-fixture",
        elapsedMs: 0,
      },
    };
  }
  if (stage === "agent_choice_and_turn_commit") {
    return {
      choiceAndTurnCommit: {
        choice: clone(baselineResults.get("agent_choice_and_regulation").choice),
        turnCommit: clone(baselineResults.get("agent_turn_commit").turnCommit),
      },
      stage: {
        name: `FastFixture:agent_choice_and_turn_commit:${stageInput.characterId}`,
        provider: "local-fixture",
        elapsedMs: 0,
      },
    };
  }
  return clone(baselineResults.get(stage));
}

const fastRunner = async (stageInput, options = {}) => {
  fastCalls.push({ stage: options.stage, input: clone(stageInput) });
  return combinedFixtureResult(stageInput, options.stage);
};

const fast = await runOneTurn({
  characterAgentCallMode: "two-call",
  runStage: fastRunner,
});

assert.deepEqual(
  fastCalls.map((row) => row.stage),
  ["subjective_appraisal_and_candidates", "agent_choice_and_turn_commit"],
  "two-call mode must make exactly two provider invocations",
);
assert.equal(
  fastCalls[0].input.requestedOutput,
  "subjective_appraisal_and_character_candidates",
  "the first invocation asks one Character Agent for appraisal and candidates together",
);
assert.equal(
  fastCalls[1].input.requestedOutput,
  "character_choice_regulation_and_turn_commit",
  "the second invocation asks the same Character Agent to choose and commit",
);
assert.equal(
  fastCalls[1].input.candidateEvaluation.authority,
  "character-private-psychology-tool",
  "the second invocation must receive the existing local candidate mathematics",
);
assert.equal(
  fastCalls[1].input.candidateEvaluation.selection,
  null,
  "the mathematics may evaluate but must not select for the Character Agent",
);
assert.ok(
  fastCalls[1].input.generatedCandidates.some((candidate) => (
    candidate.candidateId === baselineResults.get("agent_choice_and_regulation").choice.selectedCandidateId
  )),
  "the Character Agent's selected candidate must remain one of its own generated candidates",
);

for (const call of fastCalls) {
  const schema = tavernCharacterAgentV2OutputSchemaForStage(call.input);
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  const trustedAudit = auditCodexTrustedTavernCharacterAgentV2Input(call.input);
  assert.deepEqual(trustedAudit.errors, [],
    `trusted provider must accept ${call.input.phase}: ${JSON.stringify(trustedAudit.errors)}`);
  assert.ok(tavernCharacterAgentV2StageDefinition(call.input.phase, call.input),
    "the trusted Codex provider must expose a combined-stage schema");
  assert.ok(openAIJsonCharacterModelStageDefinition(call.input),
    "the JSON API provider must expose a combined-stage schema");
}

const forgedCommitContexts = clone(fastCalls[1].input);
// A real Sol response repeatedly named live emotions but left their channel
// empty. Catch that combination in the provider schema before a paid repair.
function acceptsAffectiveShape(schema, value) {
  if (schema.anyOf) return schema.anyOf.some(branch => acceptsAffectiveShape(branch, value));
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === "object") return (schema.required || []).every(key => Object.hasOwn(value, key))
    && Object.entries(schema.properties || {}).every(([key, child]) => acceptsAffectiveShape(child, value[key]));
  if (schema.type === "array") return Array.isArray(value)
    && value.length >= (schema.minItems || 0) && value.length <= (schema.maxItems ?? Infinity)
    && value.every(child => acceptsAffectiveShape(schema.items, child));
  return true;
}
const combinedInfluenceSchema = tavernCharacterAgentV2OutputSchemaForStage(fastCalls[1].input)
  .properties.turnCommit.properties.privateExpressionTrace.properties.affectiveInfluence;
const liveInfluence = { sourceEmotionIds: ["curiosity"], mode: "shape_wording", primaryChannelId: "attentionLock", privateBasis: "好奇进入问法。" };
assert.equal(acceptsAffectiveShape(combinedInfluenceSchema, { ...liveInfluence, primaryChannelId: "" }), false,
  "combined output must reject the real live-emotion/empty-channel failure before generation");
assert.equal(acceptsAffectiveShape(combinedInfluenceSchema, liveInfluence), true);
assert.equal(acceptsAffectiveShape(combinedInfluenceSchema, { ...liveInfluence, mode: "contained_privately" }), true);
assert.equal(acceptsAffectiveShape(combinedInfluenceSchema, {
  ...liveInfluence, mode: "no_live_influence", sourceEmotionIds: [], primaryChannelId: "",
}), true, "the schema must still allow an actually empty emotional state");

forgedCommitContexts.candidateCommitContexts[0].candidateId = "candidate:forged-context";
const forgedContextAudit = auditCodexTrustedTavernCharacterAgentV2Input(forgedCommitContexts);
assert.ok(
  forgedContextAudit.errors.some((row) => row.code === "V2_TWO_CALL_CANDIDATE_CONTEXT_IDENTITY_INVALID"),
  "trusted audit must reject same-length candidate contexts that duplicate or replace a candidate id",
);

const forgedLockedAction = clone(fastCalls[1].input);
forgedLockedAction.candidateCommitContexts[0].selectedAction.attemptPrimitive = "wait";
const forgedActionAudit = auditCodexTrustedTavernCharacterAgentV2Input(forgedLockedAction);
assert.ok(
  forgedActionAudit.errors.some((row) => row.code === "V2_TWO_CALL_CANDIDATE_CONTEXT_ACTION_MISMATCH"),
  "trusted audit must reject a candidate context that rewrites its locked action before provider use",
);

// Both production provider adapters must carry the composite envelopes, not
// just the local runner. Fakes stop at the provider boundary: no model or
// network is invoked.
const providerOutputs = [
  {
    appraisal: clone(baselineResults.get("subjective_appraisal").appraisal),
    candidates: clone(baselineResults.get("agent_candidates").candidates),
  },
  {
    choice: clone(baselineResults.get("agent_choice_and_regulation").choice),
    turnCommit: clone(baselineResults.get("agent_turn_commit").turnCommit),
  },
];

{
  let sequence = 0;
  const calls = [];
  const provider = createOpenAIJsonCharacterModelProvider({
    model: "test-two-call-json",
    opaqueConversationIdFactory: () => "opaque:test:two-call-json",
    callJson: async (input) => {
      calls.push(clone(input));
      const index = sequence++;
      return {
        parsed: clone(providerOutputs[index]),
        meta: {
          provider: "responses",
          model: "test-two-call-json",
          elapsedMs: 1,
          conversationCheckpoint: {
            schemaVersion: "model-conversation-context-v1",
            kind: "responses",
            previousResponseId: `response:test:two-call:${index + 1}`,
          },
        },
      };
    },
  });
  const pool = createCharacterModelSessionPool({ providerPort: provider });
  const first = await pool.runStage(fastCalls[0].input);
  const second = await pool.runStage(fastCalls[1].input);
  assert.deepEqual(first.appraisalAndCandidates, providerOutputs[0]);
  assert.deepEqual(second.choiceAndTurnCommit, providerOutputs[1]);
  assert.deepEqual(calls.map((row) => row.schemaName), [
    "tavern_character_appraisal_candidates_v27_fast",
    "tavern_character_choice_commit_v27_fast",
  ]);
  await pool.close();
}

{
  const stageFactory = createTavernV27CharacterModelSessionStageFactory({
    model: "test-two-call-budget",
    maxProviderRequestsPerCommand: 3,
    providerPortFactory: ({ model }) => createOpenAIJsonCharacterModelProvider({
      model,
      callJson: async () => {
        throw new Error("budget contract must not call the provider");
      },
    }),
  });
  const stageRunner = await stageFactory({
    purpose: "command",
    sessionId: "session:test:two-call-budget",
    executionContext: {
      operation: "continue",
      authorizationAcknowledged: true,
      authorizationId: "authorization:test:two-call-budget",
      maxProviderRequests: 5,
    },
  });
  try {
    assert.equal(
      stageRunner.publicMetadata().providerRequestBudget.maxProviderRequests,
      3,
      "the server-side two-call authorization cap must remain three even if a client asks for five",
    );
  } finally {
    await stageRunner.close();
  }
}

{
  const tempRoot = await mkdtemp(path.join(tmpdir(), "gtown-v27-two-call-provider-"));
  let sequence = 0;
  const invocations = [];
  const provider = createCodexTrustedCharacterModelProvider({
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
    tempRoot,
    opaqueConversationIdFactory: () => "opaque:test:two-call-codex",
    execute: async (invocation) => {
      const index = sequence++;
      invocations.push(clone(invocation));
      await writeFile(invocation.outputPath, `${JSON.stringify(providerOutputs[index])}\n`, "utf8");
      return {
        exitCode: 0,
        stdout: index === 0
          ? `${JSON.stringify({ type: "thread.started", thread_id: "thread:test:two-call" })}\n`
          : `${JSON.stringify({ type: "turn.completed" })}\n`,
        stderr: "",
      };
    },
  });
  const pool = createCharacterModelSessionPool({ providerPort: provider });
  try {
    const first = await pool.runStage(fastCalls[0].input);
    const second = await pool.runStage(fastCalls[1].input);
    assert.deepEqual(first.appraisalAndCandidates, providerOutputs[0]);
    assert.deepEqual(second.choiceAndTurnCommit, providerOutputs[1]);
    assert.deepEqual(invocations.map((row) => row.sessionOperation), ["start", "resume"]);
    assert.match(invocations[0].stdin, /主观评估与候选生成/u);
    assert.match(invocations[1].stdin, /candidateEvaluation/u);
  } finally {
    await pool.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
}

const observer = projectTavernWorldRuntimeV27ForObserver(fast.instance, fast.turns);
assert.equal(observer.turns.length, 1);
assert.equal(observer.turns[0].submissionMode, "atomic");
assert.equal(observer.turns[0].characterAgentCompleted, true);
assert.equal(observer.turns[0].acceptedStageCount, 4,
  "two provider calls still pass all four causal acceptance boundaries");
assert.equal(observer.turns[0].outcome.status, "success",
  "the world remains the authority that settles the Character's attempt");

const repairCalls = [];
let forgedCommitReturned = false;
const repaired = await runOneTurn({
  characterAgentCallMode: "two-call",
  maxStageProtocolRepairs: 1,
  runStage: async (stageInput, options = {}) => {
    repairCalls.push({ stage: options.stage, input: clone(stageInput) });
    const result = combinedFixtureResult(stageInput, options.stage);
    if (options.stage === "agent_choice_and_turn_commit" && !forgedCommitReturned) {
      forgedCommitReturned = true;
      result.choiceAndTurnCommit.turnCommit.privateExpressionTrace
        .affectiveInfluence.sourceEmotionIds = ["anger"];
    }
    return result;
  },
});
assert.deepEqual(repairCalls.map((row) => row.stage), [
  "subjective_appraisal_and_candidates",
  "agent_choice_and_turn_commit",
  "agent_turn_commit",
], "a mathematically inconsistent paired commit must use its one repair on an exact post-regulation commit stage");
assert.equal(repairCalls[2].input.phase, "awaiting_agent_turn_commit");
assert.ok(
  repairCalls[2].input.expressionMoment.innerContinuity.affectiveResidue.liveEmotions.length > 0,
  "the repair call must receive the exact locally computed post-regulation residue",
);
const repairedObserver = projectTavernWorldRuntimeV27ForObserver(repaired.instance, repaired.turns);
assert.equal(repairedObserver.turns[0].protocolRepairCount, 1,
  "two-call observer projection must report the actual repair instead of subtracting four logical stages");
assert.equal(repairedObserver.turns[0].outcome.status, "success");

console.log(JSON.stringify({
  status: "all-passed",
  providerCalls: fastCalls.length,
  logicalAcceptedStages: observer.turns[0].acceptedStageCount,
  outcomeStatus: observer.turns[0].outcome.status,
}, null, 2));
