import { randomUUID } from "node:crypto";

import {
  callOpenAIJson,
} from "../pipeline/responseClient.mjs";
import {
  tavernCharacterAgentV2OutputSchemaForStage,
  tavernCharacterAgentV2SystemPrompt,
  tavernCharacterAgentV2UserPrompt,
} from "../pipeline/tavernCharacterAgentV2.mjs";
import { assertCharacterModelProviderPort } from "../simulation/characterModelSession.mjs";

export const OPENAI_JSON_CHARACTER_MODEL_PROVIDER_VERSION = "openai-json-character-model-provider-v1";
export const OPENAI_JSON_CHARACTER_MODEL_PROVIDER_CHECKPOINT_VERSION =
  "openai-json-character-model-provider-checkpoint-v1";

const STAGE_DEFINITIONS = Object.freeze({
  awaiting_character_day_planning: Object.freeze({
    stage: "character_day_planning",
    schemaName: "tavern_character_day_planning_v27",
    outputKey: "dayPlan",
  }),
  awaiting_character_reflection: Object.freeze({
    stage: "character_reflection",
    schemaName: "tavern_character_reflection_v27",
    outputKey: "reflection",
  }),
  awaiting_subjective_appraisal: Object.freeze({
    stage: "subjective_appraisal",
    schemaName: "tavern_character_subjective_appraisal_v2",
    outputKey: "appraisal",
  }),
  awaiting_subjective_appraisal_and_candidates: Object.freeze({
    stage: "subjective_appraisal_and_candidates",
    schemaName: "tavern_character_appraisal_candidates_v27_fast",
    outputKey: "appraisalAndCandidates",
  }),
  awaiting_agent_candidates: Object.freeze({
    stage: "agent_candidates",
    schemaName: "tavern_character_candidates_v2",
    outputKey: "candidates",
  }),
  awaiting_agent_choice_and_regulation: Object.freeze({
    stage: "agent_choice_and_regulation",
    schemaName: "tavern_character_choice_v2",
    outputKey: "choice",
  }),
  awaiting_agent_choice_and_turn_commit: Object.freeze({
    stage: "agent_choice_and_turn_commit",
    schemaName: "tavern_character_choice_commit_v27_fast",
    outputKey: "choiceAndTurnCommit",
  }),
  awaiting_agent_expression_planning: Object.freeze({
    stage: "agent_expression_planning",
    schemaName: "tavern_character_regulated_expression_plan_v2",
    outputKey: "expressionPlan",
  }),
  awaiting_agent_realization: Object.freeze({
    stage: "agent_realization",
    schemaName: "tavern_character_realization_v2",
    outputKey: "realization",
  }),
});

const PROVIDER_KINDS = new Set(["responses", "chat-completions"]);

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").trim();
}

function fail(code, message, evidence = {}, cause = undefined) {
  const error = cause === undefined ? new Error(message) : new Error(message, { cause });
  error.code = code;
  error.evidence = clone(evidence);
  return error;
}

function atomicTurnCommitSchema(stageInput = {}) {
  return tavernCharacterAgentV2OutputSchemaForStage(stageInput);
}

/** Every stage, including the atomic public commit, uses the production schema. */
export function openAIJsonCharacterModelStageDefinition(stageInput = {}) {
  const phase = clean(stageInput.phase);
  if (phase === "awaiting_agent_turn_commit") {
    return {
      stage: "agent_turn_commit",
      schemaName: "tavern_character_turn_commit_v2",
      outputKey: "turnCommit",
      schema: atomicTurnCommitSchema(stageInput),
      compatibilityMapping: false,
    };
  }
  const definition = STAGE_DEFINITIONS[phase];
  if (!definition) return null;
  return {
    ...definition,
    schema: tavernCharacterAgentV2OutputSchemaForStage(stageInput),
    compatibilityMapping: false,
  };
}

function assertStageInput(stageInput = {}) {
  const characterId = clean(stageInput.characterId);
  const agentTurnId = clean(stageInput.agentTurnId);
  const definition = openAIJsonCharacterModelStageDefinition(stageInput);
  if (!characterId || !agentTurnId || !definition) {
    throw fail(
      "OPENAI_JSON_CHARACTER_PROVIDER_STAGE_INPUT_INVALID",
      "OpenAI JSON character stage requires a supported phase, characterId and agentTurnId.",
      { characterId, agentTurnId, phase: clean(stageInput.phase) },
    );
  }
  if (stageInput.phase === "awaiting_agent_turn_commit"
    && clean(stageInput.requestedOutput) !== "character_turn_commit_only") {
    throw fail(
      "OPENAI_JSON_CHARACTER_PROVIDER_ATOMIC_COMMIT_INPUT_INVALID",
      "Atomic Character Agent stage requires character_turn_commit_only.",
    );
  }
  return definition;
}

function trimMessages(messages = [], maxTranscriptMessages = 40) {
  if (!Array.isArray(messages)) return [];
  return messages.filter((row) => (
    row && ["system", "user", "assistant"].includes(row.role) && typeof row.content === "string"
  )).slice(-maxTranscriptMessages).map((row) => ({ role: row.role, content: row.content }));
}

function normalizeConversationCheckpoint(checkpoint = {}, maxTranscriptMessages = 40) {
  const kind = clean(checkpoint.kind);
  if (!PROVIDER_KINDS.has(kind)) {
    throw fail(
      "OPENAI_JSON_CHARACTER_PROVIDER_KIND_INVALID",
      "OpenAI JSON conversation checkpoint has an unsupported provider kind.",
      { kind },
    );
  }
  if (kind === "responses") {
    const previousResponseId = clean(checkpoint.previousResponseId);
    if (!previousResponseId) {
      throw fail(
        "OPENAI_JSON_CHARACTER_PROVIDER_RESPONSE_ID_REQUIRED",
        "Responses conversation checkpoint requires previousResponseId.",
      );
    }
    return {
      schemaVersion: "model-conversation-context-v1",
      kind,
      previousResponseId,
    };
  }
  const messages = trimMessages(checkpoint.messages, maxTranscriptMessages);
  if (!messages.length) {
    throw fail(
      "OPENAI_JSON_CHARACTER_PROVIDER_TRANSCRIPT_REQUIRED",
      "Chat Completions conversation checkpoint requires a non-empty transcript.",
    );
  }
  return {
    schemaVersion: "model-conversation-context-v1",
    kind,
    messages,
  };
}

function normalizeProviderCheckpoint(checkpoint = null, maxTranscriptMessages = 40) {
  if (checkpoint == null) return null;
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) {
    throw fail(
      "OPENAI_JSON_CHARACTER_PROVIDER_CHECKPOINT_INVALID",
      "OpenAI JSON character provider checkpoint must be an object.",
    );
  }
  if (clean(checkpoint.schemaVersion) !== OPENAI_JSON_CHARACTER_MODEL_PROVIDER_CHECKPOINT_VERSION) {
    throw fail(
      "OPENAI_JSON_CHARACTER_PROVIDER_CHECKPOINT_VERSION_UNSUPPORTED",
      "OpenAI JSON character provider checkpoint version is not supported.",
    );
  }
  const acceptedStageCount = Number(checkpoint.privateState?.acceptedStageCount || 0);
  if (!Number.isInteger(acceptedStageCount) || acceptedStageCount < 0) {
    throw fail(
      "OPENAI_JSON_CHARACTER_PROVIDER_STAGE_COUNT_INVALID",
      "Accepted stage count must be a non-negative integer.",
    );
  }
  const rawConversationContext = checkpoint.privateState?.conversationContext;
  const conversationContext = rawConversationContext == null
    ? null
    : normalizeConversationCheckpoint(rawConversationContext, maxTranscriptMessages);
  if (acceptedStageCount > 0 && !conversationContext) {
    throw fail(
      "OPENAI_JSON_CHARACTER_PROVIDER_CONTINUITY_MISSING",
      "Continued OpenAI JSON character session is missing private conversation context.",
    );
  }
  return {
    characterId: clean(checkpoint.characterId),
    providerConversationId: clean(checkpoint.providerConversationId),
    model: clean(checkpoint.model),
    providerKind: clean(checkpoint.privateState?.providerKind),
    acceptedStageCount,
    conversationContext,
  };
}

export function createOpenAIJsonCharacterModelProvider({
  model = "",
  maxTranscriptMessages = 40,
  callJson = callOpenAIJson,
  providerConfig = null,
  opaqueConversationIdFactory = () => `character-model:openai-json:${randomUUID()}`,
} = {}) {
  if (typeof callJson !== "function") {
    throw fail(
      "OPENAI_JSON_CHARACTER_PROVIDER_CALL_REQUIRED",
      "OpenAI JSON character provider requires callJson.",
    );
  }
  if (typeof opaqueConversationIdFactory !== "function") {
    throw fail(
      "OPENAI_JSON_CHARACTER_PROVIDER_ID_FACTORY_REQUIRED",
      "OpenAI JSON character provider requires an opaque id factory.",
    );
  }
  const transcriptLimit = Number(maxTranscriptMessages);
  if (!Number.isInteger(transcriptLimit) || transcriptLimit < 1 || transcriptLimit > 200) {
    throw fail(
      "OPENAI_JSON_CHARACTER_PROVIDER_TRANSCRIPT_LIMIT_INVALID",
      "Chat transcript limit must be an integer from 1 to 200.",
    );
  }

  const liveStateByHandle = new WeakMap();
  const ownerByOpaqueId = new Map();

  function stateFor(handle = {}) {
    const state = handle && typeof handle === "object" ? liveStateByHandle.get(handle) : null;
    if (!state || state.closed) {
      throw fail(
        "OPENAI_JSON_CHARACTER_PROVIDER_HANDLE_UNKNOWN",
        "OpenAI JSON character provider handle is not open.",
      );
    }
    return state;
  }

  return assertCharacterModelProviderPort({
    version: OPENAI_JSON_CHARACTER_MODEL_PROVIDER_VERSION,

    async openConversation(input = {}) {
      const characterId = clean(input.characterId);
      if (!characterId) {
        throw fail(
          "OPENAI_JSON_CHARACTER_PROVIDER_CHARACTER_REQUIRED",
          "Opening an OpenAI JSON character conversation requires characterId.",
        );
      }
      const restored = normalizeProviderCheckpoint(input.providerCheckpoint, transcriptLimit);
      if (restored?.characterId && restored.characterId !== characterId) {
        throw fail(
          "OPENAI_JSON_CHARACTER_PROVIDER_CHECKPOINT_OWNER_MISMATCH",
          "OpenAI JSON provider checkpoint belongs to another character.",
        );
      }
      const suppliedOpaqueId = clean(input.providerConversationId);
      if (restored?.providerConversationId && suppliedOpaqueId
        && restored.providerConversationId !== suppliedOpaqueId) {
        throw fail(
          "OPENAI_JSON_CHARACTER_PROVIDER_CHECKPOINT_CONVERSATION_MISMATCH",
          "OpenAI JSON provider checkpoint belongs to another opaque conversation.",
        );
      }
      if (model && restored?.model && restored.model !== model) {
        throw fail(
          "OPENAI_JSON_CHARACTER_PROVIDER_CHECKPOINT_MODEL_MISMATCH",
          "OpenAI JSON provider checkpoint was created with another model.",
        );
      }
      const providerConversationId = suppliedOpaqueId
        || restored?.providerConversationId
        || clean(opaqueConversationIdFactory(characterId));
      if (!providerConversationId) {
        throw fail(
          "OPENAI_JSON_CHARACTER_PROVIDER_CONVERSATION_ID_REQUIRED",
          "Opaque conversation id factory returned an empty id.",
        );
      }
      const existingOwner = ownerByOpaqueId.get(providerConversationId);
      if (existingOwner && existingOwner !== characterId) {
        throw fail(
          "OPENAI_JSON_CHARACTER_PROVIDER_CONVERSATION_SHARED",
          "Two characters may not share one OpenAI JSON provider conversation.",
        );
      }
      const handle = Object.freeze({
        schemaVersion: OPENAI_JSON_CHARACTER_MODEL_PROVIDER_VERSION,
        characterId,
        providerConversationId,
      });
      liveStateByHandle.set(handle, {
        characterId,
        providerConversationId,
        model: restored?.model || clean(model),
        providerKind: restored?.providerKind || restored?.conversationContext?.kind || "",
        conversationContext: clone(restored?.conversationContext || {}),
        acceptedStageCount: restored?.acceptedStageCount || 0,
        running: false,
        closed: false,
      });
      ownerByOpaqueId.set(providerConversationId, characterId);
      return handle;
    },

    async runStage(handle, stageInput = {}, context = {}) {
      const state = stateFor(handle);
      const inputCharacterId = clean(stageInput.characterId);
      if (inputCharacterId !== state.characterId || clean(context.characterId) !== state.characterId) {
        throw fail(
          "OPENAI_JSON_CHARACTER_PROVIDER_STAGE_OWNER_MISMATCH",
          "OpenAI JSON character stage belongs to another character.",
        );
      }
      if (clean(context.providerConversationId) !== state.providerConversationId) {
        throw fail(
          "OPENAI_JSON_CHARACTER_PROVIDER_OPAQUE_ID_MISMATCH",
          "OpenAI JSON character stage used another opaque conversation id.",
        );
      }
      if (state.running) {
        throw fail(
          "OPENAI_JSON_CHARACTER_PROVIDER_BUSY",
          "One OpenAI JSON character conversation may execute only one stage at a time.",
        );
      }
      const definition = assertStageInput(stageInput);
      state.running = true;
      const startedAt = Date.now();
      try {
        const response = await callJson({
          system: tavernCharacterAgentV2SystemPrompt(stageInput),
          user: tavernCharacterAgentV2UserPrompt(stageInput),
          schema: clone(definition.schema),
          schemaName: definition.schemaName,
          schemaHintMode: "full",
          model: state.model || undefined,
          signal: context.signal,
          requestBudget: context.requestBudget || null,
          requestContext: {
            ...(clone(context.requestContext || {})),
            characterId: state.characterId,
            agentTurnId: clean(stageInput.agentTurnId),
            phase: clean(stageInput.phase),
          },
          conversationContext: clone(state.conversationContext || {}),
          ...(providerConfig ? { providerConfig } : {}),
        });
        if (!response || typeof response !== "object" || Array.isArray(response)
          || !response.parsed || typeof response.parsed !== "object" || Array.isArray(response.parsed)) {
          throw fail(
            "OPENAI_JSON_CHARACTER_PROVIDER_RESULT_INVALID",
            "OpenAI JSON character call returned an invalid structured result.",
          );
        }
        const nextConversation = normalizeConversationCheckpoint(
          response.meta?.conversationCheckpoint || {},
          transcriptLimit,
        );
        const nextProviderKind = clean(response.meta?.provider || nextConversation.kind);
        if (nextProviderKind !== nextConversation.kind) {
          throw fail(
            "OPENAI_JSON_CHARACTER_PROVIDER_KIND_CONTRADICTION",
            "OpenAI JSON response metadata contradicts its conversation checkpoint.",
          );
        }
        if (state.providerKind && state.providerKind !== nextProviderKind) {
          throw fail(
            "OPENAI_JSON_CHARACTER_PROVIDER_KIND_CHANGED",
            "One character conversation cannot switch API styles mid-session.",
            { previous: state.providerKind, next: nextProviderKind },
          );
        }
        const responseModel = clean(response.meta?.model);
        if (state.model && responseModel && state.model !== responseModel) {
          throw fail(
            "OPENAI_JSON_CHARACTER_PROVIDER_MODEL_CHANGED",
            "One character conversation cannot switch models mid-session.",
          );
        }
        state.providerKind = nextProviderKind;
        state.model = state.model || responseModel;
        state.conversationContext = nextConversation;
        state.acceptedStageCount += 1;
        return {
          characterId: state.characterId,
          providerConversationId: state.providerConversationId,
          [definition.outputKey]: clone(response.parsed),
          stage: {
            name: `OpenAIJsonCharacterModelProvider:${definition.stage}:${state.characterId}`,
            phase: clean(stageInput.phase),
            provider: state.providerKind,
            model: state.model,
            elapsedMs: Number(response.meta?.elapsedMs ?? (Date.now() - startedAt)),
            isolation: "persistent-character-private-conversation-context",
            sessionOperation: state.acceptedStageCount === 1 ? "start" : "continue",
            compatibilityMapping: definition.compatibilityMapping === true,
          },
        };
      } finally {
        state.running = false;
      }
    },

    async checkpointConversation(handle) {
      const state = stateFor(handle);
      if (state.running) {
        throw fail(
          "OPENAI_JSON_CHARACTER_PROVIDER_CHECKPOINT_DURING_STAGE",
          "OpenAI JSON character provider cannot checkpoint during a running stage.",
        );
      }
      return {
        schemaVersion: OPENAI_JSON_CHARACTER_MODEL_PROVIDER_CHECKPOINT_VERSION,
        characterId: state.characterId,
        providerConversationId: state.providerConversationId,
        model: state.model,
        privateState: {
          providerKind: state.providerKind,
          acceptedStageCount: state.acceptedStageCount,
          conversationContext: state.providerKind ? clone(state.conversationContext) : null,
        },
      };
    },

    async closeConversation(handle) {
      const state = stateFor(handle);
      if (state.running) {
        throw fail(
          "OPENAI_JSON_CHARACTER_PROVIDER_CLOSE_DURING_STAGE",
          "OpenAI JSON character provider cannot close during a running stage.",
        );
      }
      state.closed = true;
      ownerByOpaqueId.delete(state.providerConversationId);
      state.conversationContext = null;
    },
  });
}
