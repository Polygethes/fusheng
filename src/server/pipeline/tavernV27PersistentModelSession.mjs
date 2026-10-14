import { randomUUID } from "node:crypto";

import { runTavernCharacterAgentV2Stage } from "./tavernCharacterAgentV2.mjs";
import {
  createModelRequestBudget,
  modelRequestBudgetSnapshot,
} from "./modelRequestBudget.mjs";
import { buildTavernV27RemoteRunPolicy } from "./tavernV27RemoteRunPolicy.mjs";
import { createTavernV27SessionHttpHandler } from "./tavernV27SessionHttp.mjs";
import {
  createCharacterModelSessionPool,
  restoreCharacterModelSessionPool,
} from "../simulation/characterModelSession.mjs";

export const TAVERN_V27_PERSISTENT_MODEL_SESSION_VERSION = "tavern-v27-persistent-model-session-v1";

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function authorizedProviderRequestLimit(value, policyLimit) {
  const policy = Math.max(0, Math.floor(Number(policyLimit) || 0));
  const requested = Math.floor(Number(value));
  if (!Number.isFinite(requested)) return policy;
  return Math.max(0, Math.min(policy, requested));
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeIssues(rows = []) {
  return (rows || []).map((row) => ({
    code: clean(row?.code || "VALIDATION_ISSUE").slice(0, 160),
    path: clean(row?.path).slice(0, 240),
    message: clean(row?.message).slice(0, 600),
  }));
}

function publicBudget(snapshot = {}) {
  return {
    schemaVersion: clean(snapshot.schemaVersion),
    maxProviderRequests: Number(snapshot.maxProviderRequests || 0),
    usedProviderRequests: Number(snapshot.usedProviderRequests || 0),
    remainingProviderRequests: Number(snapshot.remainingProviderRequests || 0),
    rejectedProviderRequests: Number(snapshot.rejectedProviderRequests || 0),
    attempts: (snapshot.attempts || []).map((row) => ({
      requestIndex: Number(row.requestIndex || 0),
      characterId: clean(row.characterId),
      agentTurnId: clean(row.agentTurnId),
      phase: clean(row.phase),
      retryKind: clean(row.retryKind),
      parseRetryCount: Number(row.parseRetryCount || 0),
      networkRetryCount: Number(row.networkRetryCount || 0),
    })),
  };
}

export function createTavernV27PersistentModelStageFactory({
  runProviderStage = runTavernCharacterAgentV2Stage,
  requestBudgetFactory = createModelRequestBudget,
  requestBudgetSnapshot = modelRequestBudgetSnapshot,
  model = "",
  maxProviderRequestsPerCommand,
  onStageAccepted: observeStageAccepted = null,
  onStageRejected: observeStageRejected = null,
} = {}) {
  if (typeof runProviderStage !== "function") {
    throw fail("TAVERN_V27_MODEL_STAGE_RUNNER_REQUIRED", "Persistent model session requires a provider stage runner.");
  }
  const policy = buildTavernV27RemoteRunPolicy({ maxTurns: 1 });
  const configuredProviderRequestLimit = authorizedProviderRequestLimit(
    maxProviderRequestsPerCommand,
    policy.maxProviderRequests,
  );
  return async function persistentModelStageFactory({ purpose, executionContext } = {}) {
    if (purpose !== "command") return null;
    if (executionContext?.operation === "reset") return null;
    if (executionContext?.authorizationAcknowledged !== true || !clean(executionContext?.authorizationId)) {
      throw fail(
        "TAVERN_V27_EXTERNAL_MODEL_AUTHORIZATION_REQUIRED",
        "This Character Agent command requires explicit external-model authorization.",
      );
    }
    const resolvedModel = clean(executionContext.model) || clean(model);
    const budget = requestBudgetFactory({
      maxProviderRequests: authorizedProviderRequestLimit(
        executionContext.maxProviderRequests,
        configuredProviderRequestLimit,
      ),
      authorizationId: clean(executionContext.authorizationId),
    });
    let stageInvocations = 0;
    const protocolRepairEvents = [];
    const metadata = ({ verdict = "pending" } = {}) => {
      const snapshot = publicBudget(requestBudgetSnapshot(budget));
      return {
        schemaVersion: TAVERN_V27_PERSISTENT_MODEL_SESSION_VERSION,
        mode: "persistent-external-character-agent",
        externalModelCalled: snapshot.usedProviderRequests > 0,
        model: resolvedModel,
        stageInvocations,
        providerRequestBudget: snapshot,
        protocolRepairEvents: clone(protocolRepairEvents),
        authorQualityVerdict: verdict,
      };
    };
    return {
      async runStage(input, options) {
        stageInvocations += 1;
        return runProviderStage(input, {
          ...options,
          requestBudget: budget,
          requestContext: {
            characterId: input.characterId,
            agentTurnId: input.agentTurnId,
            phase: input.phase,
          },
        });
      },
      async onStageAccepted(event = {}) {
        if (typeof observeStageAccepted === "function") await observeStageAccepted(clone(event));
      },
      async onStageRejected(event = {}) {
        protocolRepairEvents.push({
          characterId: clean(event.characterId),
          agentTurnId: clean(event.agentTurnId),
          phase: clean(event.phase),
          stage: clean(event.stage),
          repairAttempt: Number(event.repairAttempt || 0),
          issues: safeIssues(event.issues),
        });
        if (typeof observeStageRejected === "function") await observeStageRejected(clone(event));
      },
      publicMetadata: () => metadata(),
    };
  };
}

/**
 * Persistent Character-model variant of the command stage factory.  The
 * command still owns authorization and request budget, while the private
 * provider conversation checkpoint travels with the durable world session.
 * The provider port performs the actual request reservation so retries count
 * as real requests rather than as one logical stage.
 */
export function createTavernV27CharacterModelSessionStageFactory({
  providerPortFactory,
  requestBudgetFactory = createModelRequestBudget,
  requestBudgetSnapshot = modelRequestBudgetSnapshot,
  model = "",
  maxProviderRequestsPerCommand,
  onStageAccepted: observeStageAccepted = null,
  onStageRejected: observeStageRejected = null,
} = {}) {
  if (typeof providerPortFactory !== "function") {
    throw fail(
      "TAVERN_V27_CHARACTER_MODEL_PROVIDER_FACTORY_REQUIRED",
      "Persistent Character model sessions require a provider port factory.",
    );
  }
  const policy = buildTavernV27RemoteRunPolicy({ maxTurns: 1 });
  const configuredProviderRequestLimit = authorizedProviderRequestLimit(
    maxProviderRequestsPerCommand,
    policy.maxProviderRequests,
  );
  return async function persistentCharacterModelStageFactory({
    purpose,
    sessionId,
    executionContext,
    characterModelSessionCheckpoint = null,
  } = {}) {
    if (purpose !== "command") return null;
    if (executionContext?.operation === "reset") return null;
    if (executionContext?.authorizationAcknowledged !== true || !clean(executionContext?.authorizationId)) {
      throw fail(
        "TAVERN_V27_EXTERNAL_MODEL_AUTHORIZATION_REQUIRED",
        "This Character Agent command requires explicit external-model authorization.",
      );
    }

    const resolvedModel = clean(executionContext.model) || clean(model);
    const budget = requestBudgetFactory({
      maxProviderRequests: authorizedProviderRequestLimit(
        executionContext.maxProviderRequests,
        configuredProviderRequestLimit,
      ),
      authorizationId: clean(executionContext.authorizationId),
    });
    const providerPort = await providerPortFactory({
      model: resolvedModel,
      sessionId: clean(sessionId),
      requestBudget: budget,
      authorizationId: clean(executionContext.authorizationId),
    });
    const pool = characterModelSessionCheckpoint
      ? restoreCharacterModelSessionPool(characterModelSessionCheckpoint, { providerPort })
      : createCharacterModelSessionPool({ providerPort });
    let stageInvocations = 0;
    const protocolRepairEvents = [];

    return {
      async runStage(input, options = {}) {
        stageInvocations += 1;
        return pool.runStage(input, {
          ...options,
          requestBudget: budget,
          requestContext: {
            characterId: input.characterId,
            agentTurnId: input.agentTurnId,
            phase: input.phase,
          },
        });
      },
      async onStageAccepted(event = {}) {
        if (typeof observeStageAccepted === "function") await observeStageAccepted(clone(event));
      },
      async onStageRejected(event = {}) {
        protocolRepairEvents.push({
          characterId: clean(event.characterId),
          agentTurnId: clean(event.agentTurnId),
          phase: clean(event.phase),
          stage: clean(event.stage),
          repairAttempt: Number(event.repairAttempt || 0),
          issues: safeIssues(event.issues),
        });
        if (typeof observeStageRejected === "function") await observeStageRejected(clone(event));
      },
      async checkpoint() {
        return pool.checkpoint();
      },
      async close() {
        await pool.close();
      },
      publicMetadata() {
        const snapshot = publicBudget(requestBudgetSnapshot(budget));
        return {
          schemaVersion: TAVERN_V27_PERSISTENT_MODEL_SESSION_VERSION,
          mode: "persistent-character-model-session",
          externalModelCalled: snapshot.usedProviderRequests > 0,
          model: resolvedModel,
          stageInvocations,
          providerRequestBudget: snapshot,
          protocolRepairEvents: clone(protocolRepairEvents),
          authorQualityVerdict: "pending",
        };
      },
    };
  };
}

export function createTavernV27PersistentModelExecutionContextFactory({
  model = "",
  authorizationIdFactory = () => `authorization:tavern-v27-model-session:${randomUUID()}`,
} = {}) {
  return async function modelExecutionContext({ operation, body, request } = {}) {
    if (!clean(request?.sessionKey?.runtimeId).startsWith("tavern-v27-model:")) {
      throw fail(
        "TAVERN_V27_MODEL_SESSION_RUNTIME_INVALID",
        "Persistent model sessions require an isolated tavern-v27-model runtime id.",
      );
    }
    if (["reset", "snapshot", "restore"].includes(operation)) return { operation, authorizationAcknowledged: false };
    if (body?.authorizationAcknowledged !== true) {
      throw fail(
        "TAVERN_V27_EXTERNAL_MODEL_AUTHORIZATION_REQUIRED",
        "需要针对这一个人物回合明确勾选外部模型数据授权。",
      );
    }
    return {
      authorizationAcknowledged: true,
      authorizationId: clean(authorizationIdFactory()),
      model: clean(model),
      maxProviderRequests: body?.maxProviderRequests,
      operation,
    };
  };
}

export function projectTavernV27PersistentModelExecution(metadata = {}) {
  const mode = clean(metadata?.mode);
  if (!metadata || ![
    "persistent-external-character-agent",
    "persistent-character-model-session",
  ].includes(mode)) return {};
  return {
    mode,
    externalModelCalled: metadata.externalModelCalled === true,
    model: clean(metadata.model),
    stageInvocations: Number(metadata.stageInvocations || 0),
    providerRequestBudget: clone(metadata.providerRequestBudget || {}),
    protocolRepairEvents: clone(metadata.protocolRepairEvents || []),
    authorQualityVerdict: clean(metadata.authorQualityVerdict || "pending"),
  };
}

export function createTavernV27PersistentModelSessionHttpHandler({
  adapter,
  model = "",
  authorizationIdFactory,
} = {}) {
  return createTavernV27SessionHttpHandler({
    adapter,
    executionContextFactory: createTavernV27PersistentModelExecutionContextFactory({
      model,
      authorizationIdFactory,
    }),
    projectError: ({ error }) => {
      const projected = projectTavernV27PersistentModelExecution(error?.publicExecutionMetadata || {});
      if (!Object.keys(projected).length) return {};
      return {
        ...projected,
        authorQualityVerdict: "not_available",
      };
    },
  });
}
