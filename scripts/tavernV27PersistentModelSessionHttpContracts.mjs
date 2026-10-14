import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import { unpackCharacterContext } from "../src/server/pipeline/characterModelPromptPacking.mjs";
import { createOpenAIJsonCharacterModelProvider } from
  "../src/server/ecology/openAIJsonCharacterModelProvider.mjs";
import {
  createTavernV27PersistentModelSessionHttpHandler,
  createTavernV27CharacterModelSessionStageFactory,
  projectTavernV27PersistentModelExecution,
} from "../src/server/pipeline/tavernV27PersistentModelSession.mjs";
import { createTavernV27SessionAdapter } from "../src/server/pipeline/tavernV27SessionAdapter.mjs";
import { reserveModelProviderRequest } from "../src/server/pipeline/modelRequestBudget.mjs";
import { createFileWorldRuntimeSessionRepository } from "../src/server/simulation/worldRuntimeSessionRepository.mjs";

const XIE = "char_xyy_xiezenshi";
const LUO = "char_xyy_luozhao";
const REJECTED_REFLECTION_SECRET = "private-rejected-reflection-must-never-reach-observers";
const FORGED_REFLECTION_SOURCE_ID = "episode:reflection:http:forged-private-source";
const rootDir = await mkdtemp(path.join(tmpdir(), "gtown-v27-model-http-"));
let providerCalls = 0;
let authorizationIds = 0;
let responseIds = 0;
const providerContinuity = [];

function firstJsonObject(value = "") {
  const source = String(value || "");
  const start = source.indexOf("{");
  if (start < 0) throw new SyntaxError("provider request did not contain a JSON object");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && (depth -= 1) === 0) return JSON.parse(source.slice(start, index + 1));
  }
  throw new SyntaxError("provider request JSON object was incomplete");
}

function seedEnvelope() {
  return {
    state: buildPlayableWorldFromSetup({
      setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
      setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
    }),
    characterIds: [XIE, LUO],
    positions: { [XIE]: "hall", [LUO]: "hall" },
    initialWake: { characterId: XIE, kind: "opportunity_window" },
  };
}

function request(operation, overrides = {}) {
  return {
    operation,
    body: {
      projectId: "project:model-http",
      branchId: "branch:main",
      runtimeId: "tavern-v27-model:world-http",
      commandId: `command:${operation}`,
      sessionId: "",
      expectedRevision: 0,
      authorizationAcknowledged: false,
      ...overrides,
    },
  };
}

function stack({ failProvider = false, enableDayPlanning = false, repairFirstReflection = false } = {}) {
  const repository = createFileWorldRuntimeSessionRepository({ rootDir });
  const fixture = createTavernV27FixtureStageRunner();
  const reflectionRequests = [];
  const callJson = async (request = {}) => {
    providerCalls += 1;
    reserveModelProviderRequest(request.requestBudget, request.requestContext);
    if (failProvider) {
      const error = new Error("provider-private-payload-must-not-leak");
      error.code = "TEST_MODEL_STAGE_FAILED";
      error.privateState = { secret: "must-not-leak" };
      throw error;
    }
    const payload = firstJsonObject(request.user);
    // This model substitute consumes the exact transport representation sent
    // by the provider, including shared references when enabled.
    const input = payload.encoding === "shared-json-v1" ? unpackCharacterContext(payload) : payload;
    const stageByPhase = {
      awaiting_subjective_appraisal: "subjective_appraisal",
      awaiting_subjective_appraisal_and_candidates: "subjective_appraisal_and_candidates",
      awaiting_agent_candidates: "agent_candidates",
      awaiting_agent_choice_and_regulation: "agent_choice_and_regulation",
      awaiting_agent_expression_planning: "agent_expression_planning",
      awaiting_agent_realization: "agent_realization",
      awaiting_agent_turn_commit: "agent_turn_commit",
      awaiting_character_day_planning: "character_day_planning",
      awaiting_character_reflection: "character_reflection",
    };
    const outputKeyByPhase = {
      awaiting_subjective_appraisal: "appraisal",
      awaiting_subjective_appraisal_and_candidates: "appraisalAndCandidates",
      awaiting_agent_candidates: "candidates",
      awaiting_agent_choice_and_regulation: "choice",
      awaiting_agent_expression_planning: "expressionPlan",
      awaiting_agent_realization: "realization",
      awaiting_agent_turn_commit: "turnCommit",
      awaiting_character_day_planning: "dayPlan",
      awaiting_character_reflection: "reflection",
    };
    const result = await fixture(input, { stage: stageByPhase[input.phase] });
    if (input.phase === "awaiting_character_reflection") {
      reflectionRequests.push(structuredClone(input));
      if (repairFirstReflection && reflectionRequests.length === 1) {
        result.reflection = {
          ownerAuthority: "character-agent",
          insights: [{
            proposition: REJECTED_REFLECTION_SECRET,
            sourceMemoryIds: [FORGED_REFLECTION_SOURCE_ID],
          }],
        };
      }
    }
    const previousResponseId = String(request.conversationContext?.previousResponseId || "");
    const responseId = `response:${input.characterId}:${responseIds += 1}`;
    providerContinuity.push({
      characterId: input.characterId,
      agentTurnId: input.agentTurnId,
      phase: input.phase,
      previousResponseId,
      responseId,
    });
    return {
      parsed: structuredClone(result[outputKeyByPhase[input.phase]]),
      meta: {
        provider: "responses",
        model: "test-model-medium",
        elapsedMs: 1,
        conversationCheckpoint: {
          schemaVersion: "model-conversation-context-v1",
          kind: "responses",
          previousResponseId: responseId,
        },
      },
    };
  };
  const stageRunnerFactory = createTavernV27CharacterModelSessionStageFactory({
    model: "test-model-medium",
    providerPortFactory: ({ model }) => createOpenAIJsonCharacterModelProvider({ model, callJson }),
  });
  const adapter = createTavernV27SessionAdapter({
    repository,
    stateFactory: async () => seedEnvelope(),
    stageRunnerFactory,
    maxStageProtocolRepairs: 1,
    projectExecutionMetadata: projectTavernV27PersistentModelExecution,
    enableDayPlanning,
  });
  return {
    repository,
    reflectionRequests,
    handler: createTavernV27PersistentModelSessionHttpHandler({
      adapter,
      model: "test-model-medium",
      authorizationIdFactory: () => `authorization:http:${authorizationIds += 1}:must-not-persist`,
    }),
  };
}

try {
  const main = stack();
  const deniedStart = await main.handler(request("start", { commandId: "command:start:denied" }));
  assert.equal(deniedStart.status, 403);
  assert.equal(deniedStart.body.code, "TAVERN_V27_EXTERNAL_MODEL_AUTHORIZATION_REQUIRED");
  assert.equal(providerCalls, 0);
  assert.equal(await main.repository.load({
    projectId: "project:model-http",
    branchId: "branch:main",
    runtimeId: "tavern-v27-model:world-http",
  }), null, "an unauthorized start may not even create a persistent session");

  const started = await main.handler(request("start", {
    commandId: "command:start:authorized",
    authorizationAcknowledged: true,
  }));
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.mode, "persistent-character-model-session");
  assert.equal(started.body.externalModelCalled, true);
  assert.equal(started.body.stageInvocations, 3, JSON.stringify({ repairEvents: started.body.protocolRepairEvents, budget: started.body.providerRequestBudget }));
  assert.equal(started.body.providerRequestBudget.usedProviderRequests, 3);
  assert.equal(started.body.providerRequestBudget.maxProviderRequests, 5);
  assert.equal(started.body.observation.turns.length, 1);
  assert.equal(providerCalls, 3);

  const sessionId = started.body.sessionRef.sessionId;
  const deniedContinue = await main.handler(request("continue", {
    commandId: "command:continue:denied",
    sessionId,
    expectedRevision: started.body.sessionRevision,
  }));
  assert.equal(deniedContinue.status, 403);
  assert.equal(providerCalls, 3);
  const afterDenied = await main.repository.load({
    projectId: "project:model-http",
    branchId: "branch:main",
    runtimeId: "tavern-v27-model:world-http",
  });
  assert.equal(afterDenied.sessionRevision, started.body.sessionRevision);

  const continued = await main.handler(request("continue", {
    commandId: "command:continue:authorized",
    sessionId,
    expectedRevision: started.body.sessionRevision,
    authorizationAcknowledged: true,
  }));
  assert.equal(continued.status, 200, JSON.stringify(continued.body));
  assert.ok(continued.body.sessionRevision > started.body.sessionRevision);
  assert.equal(continued.body.observation.turns[0].characterId, LUO);
  assert.equal(providerCalls, 6);

  const replay = await main.handler(request("continue", {
    commandId: "command:continue:authorized",
    sessionId,
    expectedRevision: started.body.sessionRevision,
    authorizationAcknowledged: true,
  }));
  assert.equal(replay.status, 200);
  assert.equal(providerCalls, 6, "completed HTTP replay may not consume another provider request");
  assert.deepEqual(replay.body, continued.body);

  const continuedAgain = await main.handler(request("continue", {
    commandId: "command:continue:xie-again",
    sessionId,
    expectedRevision: continued.body.sessionRevision,
    authorizationAcknowledged: true,
  }));
  assert.equal(continuedAgain.status, 200, JSON.stringify(continuedAgain.body));
  assert.equal(continuedAgain.body.observation.turns[0].characterId, XIE);
  assert.equal(providerCalls, 9);
  const xieCalls = providerContinuity.filter((row) => row.characterId === XIE);
  assert.equal(xieCalls.length, 6, "Xie must use three atomic stages in each of two commands");
  assert.equal(
    xieCalls[3].previousResponseId,
    xieCalls[2].responseId,
    "the next command must resume Xie's private provider conversation from its accepted checkpoint",
  );

  const storedBeforeReset = await main.repository.load({
    projectId: "project:model-http",
    branchId: "branch:main",
    runtimeId: "tavern-v27-model:world-http",
  });
  assert.equal(
    Array.isArray(storedBeforeReset.checkpoint?.characterModelSessions?.sessions),
    true,
    "the durable world checkpoint must include character-owned model session checkpoints",
  );
  assert.equal(
    storedBeforeReset.checkpoint.characterModelSessions.sessions.some((row) => (
      row.characterId === XIE
      && String(row.providerCheckpoint?.privateState?.conversationContext?.previousResponseId || "")
    )),
    true,
    "the API path must durably retain Xie's private Responses continuation checkpoint",
  );

  const reset = await main.handler(request("reset", {
    commandId: "command:reset:no-provider",
    sessionId,
    expectedRevision: continuedAgain.body.sessionRevision,
  }));
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.equal(reset.body.worldVersion, 0);
  assert.equal(providerCalls, 9, "reset must not require or invoke a model provider");

  const stored = await main.repository.load({
    projectId: "project:model-http",
    branchId: "branch:main",
    runtimeId: "tavern-v27-model:world-http",
  });
  const storedJson = JSON.stringify(stored);
  assert.equal(storedJson.includes("authorization:http"), false);
  assert.equal(storedJson.includes("authorizationAcknowledged"), false);

  const failing = stack({ failProvider: true });
  const beforeFailure = providerCalls;
  const failed = await failing.handler(request("start", {
    branchId: "branch:failure",
    runtimeId: "tavern-v27-model:world-failure",
    commandId: "command:model:failure",
    authorizationAcknowledged: true,
  }));
  assert.equal(failed.status, 500);
  assert.equal(failed.body.code, "TEST_MODEL_STAGE_FAILED");
  assert.equal(failed.body.error, "Persistent tavern session command failed.");
  assert.equal(failed.body.authorQualityVerdict, "not_available");
  assert.equal(failed.body.providerRequestBudget.usedProviderRequests, 1);
  assert.equal(providerCalls, beforeFailure + 1);
  const failedJson = JSON.stringify(failed.body);
  assert.equal(failedJson.includes("provider-private-payload"), false);
  assert.equal(failedJson.includes("must-not-leak"), false);
  assert.equal(failedJson.includes("privateState"), false);
  assert.equal(failedJson.includes("checkpoint"), false);

  const failedReplay = await failing.handler(request("start", {
    branchId: "branch:failure",
    runtimeId: "tavern-v27-model:world-failure",
    commandId: "command:model:failure",
    authorizationAcknowledged: true,
  }));
  assert.equal(failedReplay.status, 500);
  assert.equal(providerCalls, beforeFailure + 1, "failed command replay may not silently retry the provider");

  const recoveredStack = stack();
  const recovered = await recoveredStack.handler(request("continue", {
    branchId: "branch:failure",
    runtimeId: "tavern-v27-model:world-failure",
    commandId: "command:model:recovery-with-new-authorization",
    sessionId: failed.body.sessionRef.sessionId,
    expectedRevision: failed.body.sessionRevision,
    authorizationAcknowledged: true,
  }));
  assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
  assert.equal(recovered.body.worldVersion, 1);
  assert.equal(recovered.body.observation.turns[0].agentTurnId, `agent-turn:${XIE}:1`, "a partial failed model turn may not advance Actor identity or memory");
  assert.equal(providerCalls, beforeFailure + 4, "only the explicitly authorized new command may spend one failed request plus three atomic-stage requests");

  const planningEnabled = stack({ enableDayPlanning: true });
  const activationCoordinates = {
    projectId: "project:model-http-day-planning",
    branchId: "branch:main",
    runtimeId: "tavern-v27-model:world-http-day-planning",
  };
  let activated = await planningEnabled.handler(request("start", {
    ...activationCoordinates,
    commandId: "command:model-day-planning:start",
    authorizationAcknowledged: true,
  }));
  assert.equal(activated.status, 200, JSON.stringify(activated.body));
  assert.equal(activated.body.observation.turns[0].submissionMode, "atomic",
    "enabling private day planning may not replace the explicit bootstrap action");
  assert.equal(activated.body.providerRequestBudget.usedProviderRequests, 3);
  assert.equal(activated.body.providerRequestBudget.maxProviderRequests, 5);

  let planningResponse = null;
  let planningReplayRequest = null;
  for (let index = 1; index <= 6 && !planningResponse; index += 1) {
    const expectedRevision = activated.body.sessionRevision;
    const commandId = `command:model-day-planning:continue:${index}`;
    const beforeCommandRequests = providerCalls;
    const response = await planningEnabled.handler(request("continue", {
      ...activationCoordinates,
      commandId,
      sessionId: activated.body.sessionRef.sessionId,
      expectedRevision,
      authorizationAcknowledged: true,
    }));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.observation.turns.length, 1, "one authorization advances exactly one Actor turn");
    assert.ok(response.body.providerRequestBudget.usedProviderRequests <= 5);
    assert.equal(
      providerCalls - beforeCommandRequests,
      response.body.providerRequestBudget.usedProviderRequests,
      "the public command budget must match actual provider requests",
    );
    if (response.body.observation.turns[0].submissionMode === "day_planning") {
      planningResponse = response;
      planningReplayRequest = {
        ...activationCoordinates,
        commandId,
        sessionId: activated.body.sessionRef.sessionId,
        expectedRevision,
        authorizationAcknowledged: true,
      };
    }
    activated = response;
  }
  assert.ok(planningResponse, "an enabled persistent model session must eventually execute private day planning");
  assert.equal(planningResponse.body.stageInvocations, 1);
  assert.equal(planningResponse.body.providerRequestBudget.usedProviderRequests, 1,
    "a private day-plan command spends one request and never auto-runs an action turn");
  assert.equal(planningResponse.body.providerRequestBudget.maxProviderRequests, 5);
  const planningPublicJson = JSON.stringify(planningResponse.body);
  for (const privateField of [
    "lifePlanState",
    "planBlocks",
    "privatePurpose",
    "sourceIds",
    "currentBodyNeeds",
    "sourceHandle",
    "character-private-body-need",
  ]) {
    assert.equal(planningPublicJson.includes(privateField), false, `${privateField} must not leave the Character session`);
  }
  const beforePlanningReplay = providerCalls;
  const planningReplay = await planningEnabled.handler(request("continue", planningReplayRequest));
  assert.equal(planningReplay.status, 200);
  assert.equal(providerCalls, beforePlanningReplay, "replaying a completed day-plan command spends no provider request");
  assert.deepEqual(planningReplay.body, planningResponse.body);

  const reflectionRepair = stack({ repairFirstReflection: true });
  const reflectionCoordinates = {
    projectId: "project:model-http-reflection-repair",
    branchId: "branch:main",
    runtimeId: "tavern-v27-model:world-http-reflection-repair",
  };
  let reflectionCursor = await reflectionRepair.handler(request("start", {
    ...reflectionCoordinates,
    commandId: "command:model-reflection-repair:start",
    authorizationAcknowledged: true,
  }));
  assert.equal(reflectionCursor.status, 200, JSON.stringify(reflectionCursor.body));
  let reflectionResponse = null;
  let reflectionReplayRequest = null;
  let modelCheckpointBeforeReflection = null;
  for (let index = 1; index <= 30 && !reflectionResponse; index += 1) {
    const expectedRevision = reflectionCursor.body.sessionRevision;
    const commandId = `command:model-reflection-repair:continue:${index}`;
    const beforeStored = await reflectionRepair.repository.load(reflectionCoordinates);
    const beforeCommandRequests = providerCalls;
    const response = await reflectionRepair.handler(request("continue", {
      ...reflectionCoordinates,
      commandId,
      sessionId: reflectionCursor.body.sessionRef.sessionId,
      expectedRevision,
      authorizationAcknowledged: true,
    }));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(response.body.providerRequestBudget.usedProviderRequests <= 5);
    assert.equal(
      providerCalls - beforeCommandRequests,
      response.body.providerRequestBudget.usedProviderRequests,
      "every reflection-search command must report its exact real request use",
    );
    if (response.body.observation.turns[0]?.submissionMode === "reflection") {
      reflectionResponse = response;
      reflectionReplayRequest = {
        ...reflectionCoordinates,
        commandId,
        sessionId: reflectionCursor.body.sessionRef.sessionId,
        expectedRevision,
        authorizationAcknowledged: true,
      };
      modelCheckpointBeforeReflection = structuredClone(
        beforeStored?.checkpoint?.characterModelSessions || null,
      );
      assert.equal(response.body.worldVersion, reflectionCursor.body.worldVersion,
        "private reflection may not create a public world version");
    }
    reflectionCursor = response;
  }
  assert.ok(reflectionResponse, "a persistent lived session must eventually execute a private reflection opportunity");
  assert.equal(reflectionResponse.body.stageInvocations, 2);
  assert.equal(reflectionResponse.body.providerRequestBudget.usedProviderRequests, 2);
  assert.equal(reflectionResponse.body.providerRequestBudget.maxProviderRequests, 5);
  const reflectionTurn = reflectionResponse.body.observation.turns[0];
  assert.equal(reflectionTurn.acceptedStageCount, 1);
  assert.equal(reflectionTurn.protocolRepairCount, 1);
  assert.equal(reflectionResponse.body.protocolRepairEvents.length, 1);
  const reflectionRepairEvent = reflectionResponse.body.protocolRepairEvents[0];
  assert.equal(reflectionRepairEvent.stage, "character_reflection");
  assert.equal(reflectionRepairEvent.repairAttempt, 1);
  assert.deepEqual(
    Object.keys(reflectionRepairEvent.issues[0]).sort(),
    ["code", "message", "path"],
  );
  assert.equal(reflectionRepair.reflectionRequests.length, 2);
  assert.equal(reflectionRepair.reflectionRequests[0].protocolRepairFeedback, undefined);
  assert.equal(
    reflectionRepair.reflectionRequests[1].protocolRepairFeedback.operation,
    "same-character-same-stage-rewrite",
  );
  const feedbackJson = JSON.stringify(reflectionRepair.reflectionRequests[1].protocolRepairFeedback);
  assert.equal(feedbackJson.includes(REJECTED_REFLECTION_SECRET), false);
  assert.equal(feedbackJson.includes(FORGED_REFLECTION_SOURCE_ID), false);

  const reflectionPublicJson = JSON.stringify(reflectionResponse.body);
  for (const privateValue of [
    REJECTED_REFLECTION_SECRET,
    FORGED_REFLECTION_SOURCE_ID,
    "reflectionState",
    "completedOpportunityIds",
    "proposition",
  ]) {
    assert.equal(reflectionPublicJson.includes(privateValue), false,
      `${privateValue} must remain private after reflection repair`);
  }

  const storedReflection = await reflectionRepair.repository.load(reflectionCoordinates);
  const beforeReflectionModelSession = modelCheckpointBeforeReflection.sessions.find((row) => (
    row.characterId === reflectionTurn.characterId
  ));
  const afterReflectionModelSession = storedReflection.checkpoint.characterModelSessions.sessions.find((row) => (
    row.characterId === reflectionTurn.characterId
  ));
  assert.equal(
    afterReflectionModelSession.stageSequence,
    beforeReflectionModelSession.stageSequence + 2,
    "both provider invocations must persist in the private model conversation checkpoint",
  );
  assert.equal(
    afterReflectionModelSession.providerCheckpoint.privateState.acceptedStageCount,
    beforeReflectionModelSession.providerCheckpoint.privateState.acceptedStageCount + 2,
  );
  const reflectedActor = storedReflection.checkpoint.actors.find((row) => (
    row.characterId === reflectionTurn.characterId
  ));
  assert.equal(reflectedActor.privateState.reflectionState.pendingOpportunity, null);
  assert.ok(reflectedActor.privateState.reflectionState.completedOpportunityIds.length > 0,
    "the accepted rewrite must durably consume the private reflection opportunity");

  const beforeReflectionReplay = providerCalls;
  const reflectionReplay = await reflectionRepair.handler(request("continue", reflectionReplayRequest));
  assert.equal(reflectionReplay.status, 200);
  assert.equal(providerCalls, beforeReflectionReplay,
    "replaying a repaired reflection command spends no provider request");
  assert.deepEqual(reflectionReplay.body, reflectionResponse.body);

  console.log(JSON.stringify({
    status: "all-passed",
    checks: {
      unauthorizedStartAndContinueReturn403WithoutProvider: true,
      eachAuthorizedCommandOwnsOneFiveRequestBudget: true,
      threeProviderStagesPerActorTurn: true,
      sameCharacterConversationRestoredAcrossCommands: true,
      completedReplayMakesNoProviderCall: true,
      resetMakesNoProviderCall: true,
      authorizationCapabilityNeverPersists: true,
      providerFailureIsRedactedAndRecoverable: true,
      failedCommandReplayMakesNoProviderCall: true,
      newAuthorizedCommandResumesSavedExecution: true,
      enabledDayPlanningKeepsOneTurnPerAuthorization: true,
      dayPlanningUsesOneOfFiveRequests: true,
      dayPlanningReplayMakesNoProviderCall: true,
      reflectionMapsThroughPersistentProvider: true,
      reflectionRepairUsesTwoOfFiveRequests: true,
      reflectionCheckpointAndReplayAreDurable: true,
      reflectionObserverProjectionStaysPrivate: true,
    },
  }, null, 2));
} finally {
  await rm(rootDir, { recursive: true, force: true });
}
