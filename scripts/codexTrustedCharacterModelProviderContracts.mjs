import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createCodexTrustedCharacterModelProvider } from
  "../src/server/ecology/codexTrustedCharacterModelProvider.mjs";
import { buildCodexStrictOutputSchema, restoreCodexOptionalFields } from
  "../src/server/ecology/codexStructuredOutputSchema.mjs";
import {
  createCharacterModelSessionPool,
  restoreCharacterModelSessionPool,
} from "../src/server/simulation/characterModelSession.mjs";
import {
  buildCharacterAgentStageInput,
  createCharacterAgentTurnSession,
  submitCharacterSubjectiveAppraisal,
} from "../src/server/simulation/characterAgentTurnProtocol.mjs";
import { createTavernV27FixtureStageRunner } from
  "../src/server/pipeline/tavernV27FixtureStage.mjs";
import { tavernCharacterAgentV2OutputSchemaForStage } from
  "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import {
  createModelRequestBudget,
  modelRequestBudgetSnapshot,
} from "../src/server/pipeline/modelRequestBudget.mjs";

const XIE = "char_xyy_xiezenshi";
const LUO = "char_xyy_luozhao";
const REAL_THREAD_1 = "019f-real-codex-thread-xie";
const REAL_THREAD_2 = "019f-real-codex-thread-luo";
const rootDir = await mkdtemp(path.join(tmpdir(), "gtown-codex-character-provider-contract-"));
const FORBIDDEN_PROVIDER_SCHEMA_KEYWORDS = new Set([
  "$defs", "$ref", "allOf", "const", "contains", "dependentRequired",
  "dependentSchemas", "dependencies", "else", "if", "maxContains",
  "minContains", "not", "oneOf", "patternProperties", "propertyNames",
  "then", "unevaluatedProperties", "uniqueItems",
]);

function assertProviderSchemaCompatible(node, schemaPath = "schema") {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((child, index) => assertProviderSchemaCompatible(child, `${schemaPath}[${index}]`));
    return;
  }
  for (const keyword of FORBIDDEN_PROVIDER_SCHEMA_KEYWORDS) {
    assert.equal(
      Object.hasOwn(node, keyword),
      false,
      `${schemaPath} must not contain unsupported provider schema keyword ${keyword}`,
    );
  }
  if (node.type === "array"
    && Number.isFinite(Number(node.minItems))
    && Number.isFinite(Number(node.maxItems))) {
    assert.ok(
      Number(node.minItems) <= Number(node.maxItems),
      `${schemaPath} must not expose an unsatisfiable array bound`,
    );
  }
  if (node.properties && typeof node.properties === "object") {
    Object.entries(node.properties).forEach(([key, child]) => (
      assertProviderSchemaCompatible(child, `${schemaPath}.properties.${key}`)
    ));
  }
  if (node.items) assertProviderSchemaCompatible(node.items, `${schemaPath}.items`);
  for (const [branchName, branches] of [["anyOf", node.anyOf]]) {
    (branches || []).forEach((child, index) => (
      assertProviderSchemaCompatible(child, `${schemaPath}.${branchName}[${index}]`)
    ));
  }
}

function providerCompatibilityStageInput(phase) {
  return {
    phase,
    horizon: { durationSeconds: 86_400 },
    referenceContract: {
      ownedPsychologicalSourceIds: ["source:owned:1"],
      ownedSourceIds: ["source:owned:1"],
      allowedZoneHandles: ["zone:owned:hall"],
      ownedDesireIds: ["desire:owned:1"],
      ownedDesireCriterionIds: ["criterion:owned:1"],
      perceivedActionFeasibilityIds: ["feasibility:perceived:1"],
      perceivedTargetHandles: ["character:perceived:1"],
      perceivedTargetHandlesByBindingKind: {
        person: ["character:perceived:1"],
      },
      ownedEpistemicPositionIds: ["epistemic:owned:1"],
      perceivedEvidenceIds: ["evidence:perceived:1"],
      discourseAnchorIds: ["conversation:opaque:1"],
      knownEntityHandles: ["character:perceived:1"],
    },
    submissionContract: {
      allowedSourceMemoryIds: ["source:owned:1"],
    },
  };
}

for (const phase of [
  "awaiting_character_day_planning",
  "awaiting_character_reflection",
  "awaiting_subjective_appraisal",
  "awaiting_subjective_appraisal_and_candidates",
  "awaiting_agent_candidates",
  "awaiting_agent_choice_and_regulation",
  "awaiting_agent_choice_and_turn_commit",
  "awaiting_agent_expression_planning",
  "awaiting_agent_realization",
  "awaiting_agent_turn_commit",
]) {
  assertProviderSchemaCompatible(
    buildCodexStrictOutputSchema(tavernCharacterAgentV2OutputSchemaForStage(providerCompatibilityStageInput(phase))),
    phase,
  );
}

// Nullable wire placeholders preserve the domain's genuinely absent fields,
// including unchanged epistemic positions and structurally unused bindings.
const optionalSchema = {
  type: "object", required: ["rows", "requiredNull"], optionalProperties: ["unused"],
  properties: {
    unused: { type: "string", enum: ["present"] }, requiredNull: { type: ["string", "null"] },
    rows: { type: "array", items: {
      type: "object", required: ["id"], optionalProperties: ["carriedUnchanged", "reason"],
      properties: { id: { type: "string" }, carriedUnchanged: { type: "boolean" }, reason: { type: "string" } },
    } },
  },
};
const optionalSchemaBefore = structuredClone(optionalSchema);
const strictOptionalSchema = buildCodexStrictOutputSchema(optionalSchema);
assert.deepEqual(optionalSchema, optionalSchemaBefore, "provider compilation cannot mutate the domain schema");
assert.deepEqual(strictOptionalSchema.required, ["unused", "requiredNull", "rows"]);
assert.deepEqual(strictOptionalSchema.properties.unused.anyOf.at(-1), { type: "null" });
assert.deepEqual(strictOptionalSchema.properties.unused.anyOf[0].enum, ["present"]);
const nullableOutput = { unused: null, requiredNull: null, rows: [
  { id: "unchanged", carriedUnchanged: true, reason: null },
  { id: "changed", carriedUnchanged: null, reason: "A new observation" },
  { id: "false-is-present", carriedUnchanged: false, reason: "" },
] };
assert.deepEqual(restoreCodexOptionalFields(nullableOutput, optionalSchema), {
  requiredNull: null, rows: [
    { id: "unchanged", carriedUnchanged: true }, { id: "changed", reason: "A new observation" },
    { id: "false-is-present", carriedUnchanged: false, reason: "" },
  ],
});
assert.equal(nullableOutput.rows[0].reason, null, "the raw model response remains intact for inspection");

function firstStageInput(characterId, turn = 1) {
  return buildCharacterAgentStageInput(createCharacterAgentTurnSession({
    agentTurnId: `agent-turn:${characterId}:${turn}`,
    characterId,
    worldProjection: {
      authority: "recipient-specific-world-projection",
      scene: { id: "scene:contract:room", step: turn },
      evidence: [],
      perceivedImpacts: [],
      perceivedCharacters: [],
      perceivedObjects: [],
      affordances: [],
      reachableZones: [],
    },
    privateContext: {},
  }));
}

function dayPlanningStageInput(characterId) {
  return {
    schemaVersion: "character-day-planning-turn-v1",
    authority: "character-private-day-planning-stage-input",
    phase: "awaiting_character_day_planning",
    stage: "character_day_planning",
    characterId,
    agentTurnId: `agent-turn:${characterId}:day-planning`,
    ownerCharacterId: characterId,
    nowSeconds: 10_000,
    horizon: {
      startAtSeconds: 10_000,
      endAtSeconds: 96_400,
      durationSeconds: 86_400,
      granularity: "rough_blocks",
    },
    privateContext: {
      memoryAndBeliefs: {
        ownerCharacterId: characterId,
        episodes: [{ id: "episode:trusted-maintenance:morning", perception: { content: "清晨先烧水。" } }],
        beliefs: [],
      },
      selfNarrative: { ownerCharacterId: characterId, currentClaims: [], pendingCandidates: [], versions: [] },
      responsibilities: { ownerCharacterId: characterId, acceptedRoleIds: [], activeDutyContracts: [], selection: null },
      commitments: { ownerCharacterId: characterId, items: [] },
      currentActivities: { ownerCharacterId: characterId, items: [] },
    },
    referenceContract: {
      ownerCharacterId: characterId,
      ownedSourceIds: ["episode:trusted-maintenance:morning"],
      allowedZoneHandles: ["zone:trusted-maintenance:tavern"],
    },
    submissionContract: {
      ownerAuthority: "character-agent",
      minPlanBlocks: 5,
      maxPlanBlocks: 8,
      relativeHorizonSeconds: 86_400,
      allowedSourceIds: ["episode:trusted-maintenance:morning"],
      allowedZoneHandles: ["zone:trusted-maintenance:tavern"],
      forbiddenOutputAuthority: ["world", "action", "speech"],
      selection: null,
    },
  };
}

function reflectionStageInput(characterId) {
  return {
    schemaVersion: "character-reflection-turn-v1",
    authority: "character-private-reflection-stage-input",
    phase: "awaiting_character_reflection",
    stage: "character_reflection",
    characterId,
    agentTurnId: `agent-turn:${characterId}:reflection`,
    ownerCharacterId: characterId,
    nowSeconds: 10_100,
    opportunity: {
      authority: "character-private-reflection-opportunity",
      ownerCharacterId: characterId,
      opportunityId: "reflection-opportunity:trusted-maintenance:1",
      sourceMemoryIds: ["episode:trusted-maintenance:morning"],
      selection: null,
    },
    privateContext: {
      authority: "character-private-reflection-context-projection",
      ownerCharacterId: characterId,
      memorySlice: {
        ownerCharacterId: characterId,
        sourceMemoryIds: ["episode:trusted-maintenance:morning"],
        episodes: [{ id: "episode:trusted-maintenance:morning", perception: { content: "清晨先烧水。" } }],
        beliefs: [],
      },
      selfNarrative: { ownerCharacterId: characterId, currentClaims: [] },
      activePlanProjection: { ownerCharacterId: characterId, activePlanSteps: [], selection: null },
      selection: null,
    },
    submissionContract: {
      ownerAuthority: "character-agent",
      maxInsights: 5,
      requiredInsightFields: ["proposition", "sourceMemoryIds"],
      allowedSourceMemoryIds: ["episode:trusted-maintenance:morning"],
      forbiddenOutputAuthority: ["world", "action", "speech"],
    },
  };
}

async function firstTwoStageInputs(characterId) {
  const turn = createCharacterAgentTurnSession({
    agentTurnId: `agent-turn:${characterId}:1`,
    characterId,
    worldProjection: {
      authority: "recipient-specific-world-projection",
      scene: { id: "scene:contract:room", step: 1 },
      evidence: [],
      perceivedImpacts: [],
      perceivedCharacters: [],
      perceivedObjects: [],
      affordances: [],
      reachableZones: [],
    },
    privateContext: {},
  });
  const appraisalInput = buildCharacterAgentStageInput(turn);
  const fixture = createTavernV27FixtureStageRunner();
  const fixtureResult = await fixture(appraisalInput, { stage: "subjective_appraisal" });
  const candidateInput = buildCharacterAgentStageInput(
    submitCharacterSubjectiveAppraisal(turn, fixtureResult.appraisal),
  );
  return [appraisalInput, candidateInput];
}

function makeFakeExecutor({ missingThread = false } = {}) {
  const invocations = [];
  const threadByDirectory = new Map();
  let starts = 0;
  return {
    invocations,
    threadByDirectory,
    async execute(invocation) {
      invocations.push(structuredClone(invocation));
      const assertStrictSchema = (node) => {
        if (!node || typeof node !== "object") return;
        if (node.type === "object" && node.properties) {
          assert.deepEqual(new Set(node.required), new Set(Object.keys(node.properties)),
            "Codex strict output requires every property, including optional carriedUnchanged, in required");
          assert.equal(node.additionalProperties, false);
        }
        Object.values(node).forEach(assertStrictSchema);
      };
      assertStrictSchema(JSON.parse(await readFile(invocation.schemaPath, "utf8")));
      await writeFile(invocation.outputPath, "{}\n", { encoding: "utf8", mode: 0o600 });
      if (invocation.sessionOperation === "start") {
        starts += 1;
        const threadId = starts === 1 ? REAL_THREAD_1 : REAL_THREAD_2;
        threadByDirectory.set(invocation.cwd, threadId);
        return {
          exitCode: 0,
          stdout: missingThread ? `${JSON.stringify({ type: "turn.completed" })}\n`
            : `${JSON.stringify({ type: "thread.started", thread_id: threadId })}\n`,
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: `${JSON.stringify({ type: "turn.completed" })}\n`, stderr: "" };
    },
  };
}

let opaqueSequence = 0;
const fake = makeFakeExecutor();
const provider = createCodexTrustedCharacterModelProvider({
  model: "gpt-5.6-sol",
  reasoningEffort: "medium",
  tempRoot: rootDir,
  environment: {
    PATH: "/usr/bin:/bin",
    OPENAI_API_KEY: "must-not-reach-executor",
    CHARACTER_TOWN_API_KEY: "must-not-reach-executor",
  },
  execute: fake.execute,
  opaqueConversationIdFactory: () => `opaque-character-conversation:${++opaqueSequence}`,
});
const pool = createCharacterModelSessionPool({ providerPort: provider });

try {
  // RED: stage protocol audit must fail before the executor sees anything.
  const invalidHandle = await provider.openConversation({
    characterId: XIE,
    providerConversationId: "opaque:red:invalid-stage",
  });
  await assert.rejects(
    provider.runStage(invalidHandle, {
      characterId: XIE,
      agentTurnId: `agent-turn:${XIE}:red`,
      phase: "not-a-character-agent-phase",
    }, {
      characterId: XIE,
      providerConversationId: "opaque:red:invalid-stage",
    }),
    (error) => error.code === "INVALID_TAVERN_CHARACTER_AGENT_V2_STAGE_INPUT",
  );
  assert.equal(fake.invocations.length, 0, "invalid stage input must never reach Codex executor");
  await provider.closeConversation(invalidHandle);

  // RED: a first invocation without thread.started cannot establish a
  // resumable character conversation.
  const missingThreadFake = makeFakeExecutor({ missingThread: true });
  const missingThreadProvider = createCodexTrustedCharacterModelProvider({
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
    tempRoot: rootDir,
    execute: missingThreadFake.execute,
    opaqueConversationIdFactory: () => "opaque:red:missing-thread",
  });
  const missingThreadPool = createCharacterModelSessionPool({ providerPort: missingThreadProvider });
  await assert.rejects(
    missingThreadPool.runStage(firstStageInput(XIE, 99)),
    (error) => error.code === "CODEX_TRUSTED_CHARACTER_PROVIDER_THREAD_ID_MISSING",
  );
  const missingThreadDirectory = missingThreadFake.invocations[0].cwd;
  await missingThreadPool.close();
  await assert.rejects(access(missingThreadDirectory), { code: "ENOENT" });

  // GREEN: two different protocol stages and a later Agent turn continue in
  // one private Codex thread while exposing only the local opaque id.
  const [xieAppraisal, xieCandidates] = await firstTwoStageInputs(XIE);
  const requestBudget = createModelRequestBudget({
    authorizationId: "authorization:codex-provider-contract",
    maxProviderRequests: 1,
  });
  const firstResult = await pool.runStage(xieAppraisal, {
    requestBudget,
    requestContext: {
      characterId: XIE,
      agentTurnId: xieAppraisal.agentTurnId,
      phase: xieAppraisal.phase,
    },
  });
  assert.equal(modelRequestBudgetSnapshot(requestBudget).usedProviderRequests, 1);
  const secondResult = await pool.runStage(xieCandidates);
  const laterTurnResult = await pool.runStage(firstStageInput(XIE, 2));
  const atomicCommitResult = await pool.runStage({
    characterId: XIE,
    agentTurnId: `agent-turn:${XIE}:2`,
    phase: "awaiting_agent_turn_commit",
    requestedOutput: "character_turn_commit_only",
    worldProjection: {
      authority: "recipient-specific-world-projection",
      scene: { id: "scene:contract:room", step: 2 },
      evidence: [],
      perceivedImpacts: [],
      perceivedCharacters: [],
      perceivedObjects: [],
      affordances: [],
      reachableZones: [],
    },
    privateContext: {},
  });
  const xieOpaqueId = pool.snapshot(XIE).providerConversationId;

  assert.match(xieOpaqueId, /^opaque-character-conversation:/u);
  assert.equal(JSON.stringify(pool.snapshot(XIE)).includes(REAL_THREAD_1), false);
  assert.equal(JSON.stringify(firstResult).includes(REAL_THREAD_1), false);
  assert.equal(JSON.stringify(secondResult).includes(REAL_THREAD_1), false);
  assert.equal(JSON.stringify(laterTurnResult).includes(REAL_THREAD_1), false);
  assert.deepEqual(atomicCommitResult.turnCommit, {});
  assert.deepEqual(fake.invocations.slice(0, 4).map((row) => row.sessionOperation), ["start", "resume", "resume", "resume"]);
  assert.equal(fake.invocations[1].args.includes(REAL_THREAD_1), true);
  assert.equal(fake.invocations[2].args.includes(REAL_THREAD_1), true);
  assert.equal(fake.invocations[3].args.includes(REAL_THREAD_1), true);
  assert.equal(new Set(fake.invocations.slice(0, 4).map((row) => row.cwd)).size, 1,
    "one live character conversation must use one stable temporary directory");

  for (const invocation of fake.invocations) {
    assert.equal(invocation.args.includes("--ephemeral"), false);
    assert.equal(invocation.args.includes("--ignore-user-config"), true);
    assert.equal(invocation.args.includes("--ignore-rules"), true);
    assert.equal(invocation.args.includes("--skip-git-repo-check"), true);
    assert.equal(Object.hasOwn(invocation.environment, "OPENAI_API_KEY"), false);
    assert.equal(Object.hasOwn(invocation.environment, "CHARACTER_TOWN_API_KEY"), false);
    for (const feature of [
      "shell_tool", "unified_exec", "web_search", "apps", "hooks",
      "memories", "multi_agent", "remote_plugin", "goals",
    ]) {
      assert.equal(
        invocation.args.some((value, index) => value === "--disable" && invocation.args[index + 1] === feature),
        true,
        `trusted persistent provider must disable ${feature}`,
      );
    }
  }

  const luoResult = await pool.runStage(firstStageInput(LUO, 1));
  const luoOpaqueId = pool.snapshot(LUO).providerConversationId;
  assert.notEqual(luoOpaqueId, xieOpaqueId);
  assert.equal(JSON.stringify(luoResult).includes(REAL_THREAD_1), false);
  assert.equal(fake.invocations[4].sessionOperation, "start");
  assert.equal(fake.invocations[4].args.includes(REAL_THREAD_1), false);

  // Private maintenance stages use the same persistent CharacterModel
  // conversation and production prompt/schema contract as action stages.
  const dayPlanningInput = dayPlanningStageInput(XIE);
  const reflectionInput = reflectionStageInput(XIE);
  const dayPlanningResult = await pool.runStage(dayPlanningInput);
  const reflectionResult = await pool.runStage(reflectionInput);
  assert.deepEqual(dayPlanningResult.dayPlan, {});
  assert.deepEqual(reflectionResult.reflection, {});
  assert.equal(dayPlanningResult.stage.name.includes("character_day_planning"), true);
  assert.equal(reflectionResult.stage.name.includes("character_reflection"), true);
  assert.match(fake.invocations[5].stdin, /正在为自己安排本次 horizon 指定范围内的生活意向/u);
  assert.match(fake.invocations[5].stdin, /整天模式使用 24 小时内的五至八个粗时间块/u);
  assert.match(fake.invocations[6].stdin, /正在独自整理最近真正留在本人记忆里的经历/u);
  const dayPlanningSchema = JSON.parse(await readFile(fake.invocations[5].schemaPath, "utf8"));
  const reflectionSchema = JSON.parse(await readFile(fake.invocations[6].schemaPath, "utf8"));
  assert.ok(dayPlanningSchema.properties.planBlocks);
  assert.ok(reflectionSchema.properties.insights);
  assert.deepEqual(
    dayPlanningSchema.properties.planBlocks.items.properties.sourceIds.items.enum,
    ["episode:trusted-maintenance:morning"],
  );
  assert.deepEqual(
    reflectionSchema.properties.insights.items.properties.sourceMemoryIds.items.enum,
    ["episode:trusted-maintenance:morning"],
  );

  // Isolation failures remain fail-closed before the fake executor.
  for (const [tampered, expectedIssueCode] of [
    [{ ...dayPlanningStageInput(XIE), localPath: "/Users/tester/private-plan.json" }, "FORBIDDEN_V2_STAGE_TEXT"],
    [{ ...reflectionStageInput(XIE), secretName: "OPENAI_API_KEY" }, "FORBIDDEN_V2_STAGE_TEXT"],
    [{ ...reflectionStageInput(XIE), authorCorrection: "force this insight" }, "FORBIDDEN_V2_STAGE_FIELD"],
    [{
      ...dayPlanningStageInput(XIE),
      privateContext: {
        ...dayPlanningStageInput(XIE).privateContext,
        memoryAndBeliefs: {
          ...dayPlanningStageInput(XIE).privateContext.memoryAndBeliefs,
          ownerCharacterId: LUO,
        },
      },
    }, "V2_MAINTENANCE_OWNER_MISMATCH"],
  ]) {
    const invocationCountBefore = fake.invocations.length;
    await assert.rejects(
      pool.runStage(tampered),
      (error) => error.code === "INVALID_TAVERN_CHARACTER_AGENT_V2_STAGE_INPUT"
        && error.issues.some((issue) => issue.code === expectedIssueCode),
    );
    assert.equal(fake.invocations.length, invocationCountBefore);
  }

  const checkpoint = await pool.checkpoint();
  const xieCheckpoint = checkpoint.sessions.find((row) => row.characterId === XIE);
  const luoCheckpoint = checkpoint.sessions.find((row) => row.characterId === LUO);
  assert.equal(xieCheckpoint.providerConversationId, xieOpaqueId);
  assert.equal(xieCheckpoint.providerCheckpoint.privateState.codexThreadId, REAL_THREAD_1,
    "real Codex thread id belongs only to the provider-private checkpoint");
  assert.equal(xieCheckpoint.providerCheckpoint.privateState.acceptedStageCount, 6,
    "action, atomic commit and private maintenance stages share one accepted-stage ledger");
  assert.equal(luoCheckpoint.providerCheckpoint.privateState.codexThreadId, REAL_THREAD_2);
  assert.equal(JSON.stringify(xieCheckpoint.providerCheckpoint).includes(REAL_THREAD_2), false);
  assert.equal(JSON.stringify(luoCheckpoint.providerCheckpoint).includes(REAL_THREAD_1), false);

  const liveDirectory = fake.invocations[0].cwd;
  await pool.close();
  await assert.rejects(access(liveDirectory), { code: "ENOENT" });

  const restoredFake = makeFakeExecutor();
  const restoredProvider = createCodexTrustedCharacterModelProvider({
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
    tempRoot: rootDir,
    execute: restoredFake.execute,
    opaqueConversationIdFactory: () => "must-not-replace-restored-opaque-id",
  });
  const restoredPool = restoreCharacterModelSessionPool(
    JSON.parse(JSON.stringify(checkpoint)),
    { providerPort: restoredProvider },
  );
  const restoredReflectionInput = reflectionStageInput(XIE);
  restoredReflectionInput.agentTurnId = `agent-turn:${XIE}:reflection:restored`;
  const restoredResult = await restoredPool.runStage(restoredReflectionInput);
  assert.equal(restoredPool.snapshot(XIE).providerConversationId, xieOpaqueId);
  assert.equal(restoredFake.invocations[0].sessionOperation, "resume");
  assert.equal(restoredFake.invocations[0].args.includes(REAL_THREAD_1), true);
  assert.deepEqual(restoredResult.reflection, {});
  assert.equal(restoredResult.stage.name.includes("character_reflection"), true);
  assert.equal(JSON.stringify(restoredResult).includes(REAL_THREAD_1), false);
  const restoredDirectory = restoredFake.invocations[0].cwd;
  await restoredPool.close();
  await assert.rejects(access(restoredDirectory), { code: "ENOENT" });

  console.log(JSON.stringify({
    status: "all-passed",
    checks: {
      invalidStageRejectedBeforeExecutor: true,
      missingStartThreadIdRejected: true,
      firstStageStartsCodexThread: true,
      laterStagesAndTurnsResumeCodexThread: true,
      atomicTurnCommitResumesCodexThread: true,
      dayPlanningUsesProductionPromptSchemaAndOutputMapping: true,
      reflectionUsesProductionPromptSchemaAndOutputMapping: true,
      allProviderBoundStageSchemasUseSupportedKeywords: true,
      maintenanceIsolationAuditFailsClosed: true,
      publicHandleUsesOpaqueConversationId: true,
      realThreadIdStaysInProviderPrivateCheckpoint: true,
      charactersRemainIsolated: true,
      trustedToolsAndProjectEnvironmentDisabled: true,
      ephemeralModeAbsent: true,
      liveSessionUsesStableTempDirectory: true,
      closeRemovesTempDirectory: true,
      checkpointRestoreResumesThread: true,
      providerInvocationConsumesAuthorizedBudget: true,
      externalCodexNeverCalled: true,
    },
  }, null, 2));
} finally {
  await rm(rootDir, { recursive: true, force: true });
}
