import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CODEX_TRUSTED_BLIND_PROBE_CHANNEL,
  CODEX_TRUSTED_BLIND_PROBE_MODEL,
  CODEX_TRUSTED_BLIND_PROBE_REASONING_EFFORT,
  assertCodexTrustedChannelPurpose,
  assertCodexTrustedReasoningEffort,
  buildCodexTrustedPersistentStructuredInvocation,
  executeCodexTrustedBlindProbeInvocation,
  sanitizeCodexTrustedBlindProbeEnvironment,
} from "./codexTrustedBlindProbeChannel.mjs";
import {
  CODEX_TRUSTED_TAVERN_CHARACTER_AGENT_V2_PURPOSE,
  auditCodexTrustedTavernCharacterAgentV2Input,
  buildCodexTrustedTavernCharacterAgentV2Prompt,
  parseCodexTrustedConversationId,
  tavernCharacterAgentV2StageDefinition,
} from "./codexTrustedTavernCharacterAgentV2Channel.mjs";
import { openAIJsonCharacterModelStageDefinition } from "./openAIJsonCharacterModelProvider.mjs";
import {
  tavernCharacterAgentV2SystemPrompt,
  tavernCharacterAgentV2UserPrompt,
} from "../pipeline/tavernCharacterAgentV2.mjs";
import { assertCharacterModelProviderPort } from "../simulation/characterModelSession.mjs";
import { reserveModelProviderRequest } from "../pipeline/modelRequestBudget.mjs";
import { buildCodexStrictOutputSchema as strictOutputSchema, restoreCodexOptionalFields } from "./codexStructuredOutputSchema.mjs";

export const CODEX_TRUSTED_CHARACTER_MODEL_PROVIDER_VERSION = "codex-trusted-character-model-provider-v1";
export const CODEX_TRUSTED_CHARACTER_MODEL_PROVIDER_CHECKPOINT_VERSION =
  "codex-trusted-character-model-provider-checkpoint-v1";

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

function invalidStageInput(audit = {}) {
  const error = fail(
    "INVALID_TAVERN_CHARACTER_AGENT_V2_STAGE_INPUT",
    (audit.errors || []).map((row) => `${row.code}@${row.path}: ${row.message}`).join("\n")
      || "Character Agent stage input failed the trusted-channel audit.",
  );
  error.issues = clone(audit.errors || []);
  return error;
}

function trustedStageArtifacts(stageInput = {}) {
  if (clean(stageInput.phase) !== "awaiting_agent_turn_commit") {
    const audit = auditCodexTrustedTavernCharacterAgentV2Input(stageInput);
    if (!audit.valid) throw invalidStageInput(audit);
    const definition = tavernCharacterAgentV2StageDefinition(stageInput.phase, stageInput);
    if (!definition) throw invalidStageInput(audit);
    return {
      audit,
      definition,
      prompt: buildCodexTrustedTavernCharacterAgentV2Prompt(stageInput),
    };
  }
  const valid = Boolean(
    clean(stageInput.characterId)
    && clean(stageInput.agentTurnId)
    && clean(stageInput.requestedOutput) === "character_turn_commit_only",
  );
  const audit = {
    valid,
    errors: valid ? [] : [{
      code: "V2_ATOMIC_COMMIT_STAGE_INVALID",
      path: "stageInput",
      message: "Atomic Character Agent commit requires characterId, agentTurnId and character_turn_commit_only.",
    }],
    phase: clean(stageInput.phase),
    stage: "agent_turn_commit",
    characterId: clean(stageInput.characterId),
    agentTurnId: clean(stageInput.agentTurnId),
    serializedBytes: Buffer.byteLength(JSON.stringify(stageInput), "utf8"),
  };
  if (!valid) throw invalidStageInput(audit);
  const definition = openAIJsonCharacterModelStageDefinition(stageInput);
  if (!definition) throw invalidStageInput(audit);
  const prompt = `<character_agent_v2_contract>\n${tavernCharacterAgentV2SystemPrompt(stageInput)}\n</character_agent_v2_contract>\n\n<isolated_character_stage_input>\n${tavernCharacterAgentV2UserPrompt(stageInput)}\n</isolated_character_stage_input>\n\n不要调用任何工具、命令、文件、网络、记忆或其他 Agent。不要读取当前输入以外的项目资料。只作为同一个人物完成当前阶段；最终只输出符合指定 schema 的 JSON。`;
  return { audit, definition, prompt };
}

function normalizePrivateCheckpoint(checkpoint = null) {
  if (checkpoint == null) return null;
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) {
    throw fail(
      "CODEX_TRUSTED_CHARACTER_PROVIDER_CHECKPOINT_INVALID",
      "Codex character provider checkpoint must be an object.",
    );
  }
  const version = clean(checkpoint.schemaVersion);
  if (version !== CODEX_TRUSTED_CHARACTER_MODEL_PROVIDER_CHECKPOINT_VERSION) {
    throw fail(
      "CODEX_TRUSTED_CHARACTER_PROVIDER_CHECKPOINT_VERSION_UNSUPPORTED",
      "Codex character provider checkpoint version is not supported.",
      { version },
    );
  }
  const privateState = checkpoint.privateState;
  if (!privateState || typeof privateState !== "object" || Array.isArray(privateState)) {
    throw fail(
      "CODEX_TRUSTED_CHARACTER_PROVIDER_PRIVATE_CHECKPOINT_REQUIRED",
      "Codex character provider checkpoint is missing its private state.",
    );
  }
  const acceptedStageCount = Number(privateState.acceptedStageCount || 0);
  if (!Number.isInteger(acceptedStageCount) || acceptedStageCount < 0) {
    throw fail(
      "CODEX_TRUSTED_CHARACTER_PROVIDER_STAGE_COUNT_INVALID",
      "Codex character provider accepted stage count must be a non-negative integer.",
    );
  }
  const codexThreadId = clean(privateState.codexThreadId);
  if (acceptedStageCount > 0 && !codexThreadId) {
    throw fail(
      "CODEX_TRUSTED_CHARACTER_PROVIDER_RESUME_ID_REQUIRED",
      "A continued Codex character conversation is missing its private thread id.",
    );
  }
  return {
    characterId: clean(checkpoint.characterId),
    providerConversationId: clean(checkpoint.providerConversationId),
    model: clean(checkpoint.model),
    reasoningEffort: clean(checkpoint.reasoningEffort),
    codexThreadId,
    acceptedStageCount,
  };
}

function safeFileSegment(value = "stage") {
  return clean(value).replace(/[^a-z0-9_-]+/giu, "-").replace(/^-+|-+$/gu, "") || "stage";
}

/**
 * Provider port for CharacterModelSession. Public handles carry only a local,
 * opaque conversation id. The resumable Codex thread id is held in the
 * provider's private live state and private checkpoint, never in stage output.
 */
export function createCodexTrustedCharacterModelProvider({
  model = CODEX_TRUSTED_BLIND_PROBE_MODEL,
  reasoningEffort = CODEX_TRUSTED_BLIND_PROBE_REASONING_EFFORT,
  tempRoot = os.tmpdir(),
  environment = process.env,
  execute = executeCodexTrustedBlindProbeInvocation,
  opaqueConversationIdFactory = () => `character-model:codex:${randomUUID()}`,
} = {}) {
  assertCodexTrustedChannelPurpose(CODEX_TRUSTED_TAVERN_CHARACTER_AGENT_V2_PURPOSE, model);
  assertCodexTrustedReasoningEffort(model, reasoningEffort);
  if (typeof execute !== "function") {
    throw fail(
      "CODEX_TRUSTED_CHARACTER_PROVIDER_EXECUTOR_REQUIRED",
      "Codex character provider requires an invocation executor.",
    );
  }
  if (typeof opaqueConversationIdFactory !== "function") {
    throw fail(
      "CODEX_TRUSTED_CHARACTER_PROVIDER_ID_FACTORY_REQUIRED",
      "Codex character provider requires an opaque conversation id factory.",
    );
  }

  const sanitizedEnvironment = sanitizeCodexTrustedBlindProbeEnvironment(environment);
  const liveStateByHandle = new WeakMap();
  const ownerByOpaqueId = new Map();

  function stateFor(handle = {}) {
    const state = handle && typeof handle === "object" ? liveStateByHandle.get(handle) : null;
    if (!state || state.closed) {
      throw fail(
        "CODEX_TRUSTED_CHARACTER_PROVIDER_HANDLE_UNKNOWN",
        "Codex character provider handle is not open.",
      );
    }
    return state;
  }

  function assertOwnerAvailable(providerConversationId, characterId) {
    const owner = ownerByOpaqueId.get(providerConversationId);
    if (owner && owner !== characterId) {
      throw fail(
        "CODEX_TRUSTED_CHARACTER_PROVIDER_CONVERSATION_SHARED",
        "Two characters may not share one Codex provider conversation.",
        { providerConversationId, owner, characterId },
      );
    }
  }

  return assertCharacterModelProviderPort({
    version: CODEX_TRUSTED_CHARACTER_MODEL_PROVIDER_VERSION,

    async openConversation(input = {}) {
      const characterId = clean(input.characterId);
      if (!characterId) {
        throw fail(
          "CODEX_TRUSTED_CHARACTER_PROVIDER_CHARACTER_REQUIRED",
          "Opening a Codex character conversation requires characterId.",
        );
      }
      const restored = normalizePrivateCheckpoint(input.providerCheckpoint);
      if (restored?.characterId && restored.characterId !== characterId) {
        throw fail(
          "CODEX_TRUSTED_CHARACTER_PROVIDER_CHECKPOINT_OWNER_MISMATCH",
          "Codex provider checkpoint belongs to another character.",
        );
      }
      const suppliedOpaqueId = clean(input.providerConversationId);
      if (restored?.providerConversationId && suppliedOpaqueId
        && restored.providerConversationId !== suppliedOpaqueId) {
        throw fail(
          "CODEX_TRUSTED_CHARACTER_PROVIDER_CHECKPOINT_CONVERSATION_MISMATCH",
          "Codex provider checkpoint belongs to another opaque conversation.",
        );
      }
      if (restored?.model && restored.model !== model) {
        throw fail(
          "CODEX_TRUSTED_CHARACTER_PROVIDER_CHECKPOINT_MODEL_MISMATCH",
          "Codex provider checkpoint was created with another model.",
        );
      }
      if (restored?.reasoningEffort && restored.reasoningEffort !== reasoningEffort) {
        throw fail(
          "CODEX_TRUSTED_CHARACTER_PROVIDER_CHECKPOINT_REASONING_MISMATCH",
          "Codex provider checkpoint was created with another reasoning effort.",
        );
      }

      const providerConversationId = suppliedOpaqueId
        || restored?.providerConversationId
        || clean(opaqueConversationIdFactory(characterId));
      if (!providerConversationId) {
        throw fail(
          "CODEX_TRUSTED_CHARACTER_PROVIDER_CONVERSATION_ID_REQUIRED",
          "Opaque conversation id factory returned an empty id.",
        );
      }
      assertOwnerAvailable(providerConversationId, characterId);
      const tempDirectory = await fs.promises.mkdtemp(path.join(tempRoot, "gtown-codex-character-model-"));
      const handle = Object.freeze({
        schemaVersion: CODEX_TRUSTED_CHARACTER_MODEL_PROVIDER_VERSION,
        characterId,
        providerConversationId,
      });
      liveStateByHandle.set(handle, {
        characterId,
        providerConversationId,
        codexThreadId: restored?.codexThreadId || "",
        acceptedStageCount: restored?.acceptedStageCount || 0,
        invocationCount: 0,
        tempDirectory,
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
          "CODEX_TRUSTED_CHARACTER_PROVIDER_STAGE_OWNER_MISMATCH",
          "Codex character stage belongs to another character.",
          { owner: state.characterId, inputCharacterId, contextCharacterId: context.characterId },
        );
      }
      if (clean(context.providerConversationId) !== state.providerConversationId) {
        throw fail(
          "CODEX_TRUSTED_CHARACTER_PROVIDER_OPAQUE_ID_MISMATCH",
          "Codex character stage used another opaque provider conversation id.",
        );
      }
      if (state.running) {
        throw fail(
          "CODEX_TRUSTED_CHARACTER_PROVIDER_BUSY",
          "One Codex character conversation may execute only one stage at a time.",
        );
      }
      const { audit, definition, prompt } = trustedStageArtifacts(stageInput);

      state.running = true;
      state.invocationCount += 1;
      const startedAt = Date.now();
      const fileStem = `${String(state.invocationCount).padStart(4, "0")}-${safeFileSegment(definition.stage)}`;
      const schemaPath = path.join(state.tempDirectory, `${fileStem}.schema.json`);
      const outputPath = path.join(state.tempDirectory, `${fileStem}.output.json`);
      try {
        await fs.promises.writeFile(
          schemaPath,
          `${JSON.stringify(strictOutputSchema(definition.schema), null, 2)}\n`,
          { encoding: "utf8", mode: 0o600 },
        );
        const invocation = buildCodexTrustedPersistentStructuredInvocation({
          purpose: CODEX_TRUSTED_TAVERN_CHARACTER_AGENT_V2_PURPOSE,
          prompt,
          providerConversationId: state.codexThreadId,
          tempDirectory: state.tempDirectory,
          schemaPath,
          outputPath,
          model,
          reasoningEffort,
          environment: sanitizedEnvironment,
        });
        if (context.requestBudget) {
          reserveModelProviderRequest(context.requestBudget, context.requestContext || {
            characterId: state.characterId,
            agentTurnId: stageInput.agentTurnId,
            phase: stageInput.phase,
          });
        }
        const execution = await execute(invocation, { signal: context.signal });
        if (execution?.exitCode != null && Number(execution.exitCode) !== 0) {
          throw fail(
            "CODEX_TRUSTED_CHARACTER_PROVIDER_EXECUTION_FAILED",
            `Codex character provider executor exited with code ${execution.exitCode}.`,
            { exitCode: Number(execution.exitCode) },
          );
        }

        const observedThreadId = parseCodexTrustedConversationId(execution?.stdout || "");
        if (!state.codexThreadId) {
          if (!observedThreadId) {
            throw fail(
              "CODEX_TRUSTED_CHARACTER_PROVIDER_THREAD_ID_MISSING",
              "Initial Codex character stage did not emit thread.started.",
            );
          }
          state.codexThreadId = observedThreadId;
        } else if (observedThreadId && observedThreadId !== state.codexThreadId) {
          throw fail(
            "CODEX_TRUSTED_CHARACTER_PROVIDER_THREAD_ID_CHANGED",
            "Resumed Codex character stage emitted another thread id.",
          );
        }

        let parsed;
        try {
          parsed = restoreCodexOptionalFields(JSON.parse(await fs.promises.readFile(outputPath, "utf8")), definition.schema);
        } catch (cause) {
          const error = fail(
            "CODEX_TRUSTED_CHARACTER_PROVIDER_INVALID_JSON",
            `Codex character stage did not produce parseable JSON: ${cause.message}`,
            {},
            cause,
          );
          error.stderr = clean(execution?.stderr);
          throw error;
        }
        state.acceptedStageCount += 1;
        return {
          characterId: state.characterId,
          providerConversationId: state.providerConversationId,
          [definition.outputKey]: parsed,
          audit,
          stage: {
            name: `CodexTrustedCharacterModelProvider:${definition.stage}:${state.characterId}`,
            phase: stageInput.phase,
            provider: CODEX_TRUSTED_BLIND_PROBE_CHANNEL.provider,
            channel: CODEX_TRUSTED_BLIND_PROBE_CHANNEL.id,
            transport: CODEX_TRUSTED_BLIND_PROBE_CHANNEL.transport,
            authentication: CODEX_TRUSTED_BLIND_PROBE_CHANNEL.authentication,
            model,
            reasoningEffort,
            elapsedMs: Date.now() - startedAt,
            isolation: "persistent-character-no-tools-no-project-config",
            sessionOperation: invocation.sessionOperation,
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
          "CODEX_TRUSTED_CHARACTER_PROVIDER_CHECKPOINT_DURING_STAGE",
          "Codex character provider cannot checkpoint during a running stage.",
        );
      }
      return {
        schemaVersion: CODEX_TRUSTED_CHARACTER_MODEL_PROVIDER_CHECKPOINT_VERSION,
        characterId: state.characterId,
        providerConversationId: state.providerConversationId,
        model,
        reasoningEffort,
        privateState: {
          codexThreadId: state.codexThreadId,
          acceptedStageCount: state.acceptedStageCount,
        },
      };
    },

    async closeConversation(handle) {
      const state = stateFor(handle);
      if (state.running) {
        throw fail(
          "CODEX_TRUSTED_CHARACTER_PROVIDER_CLOSE_DURING_STAGE",
          "Codex character provider cannot close during a running stage.",
        );
      }
      state.closed = true;
      ownerByOpaqueId.delete(state.providerConversationId);
      await fs.promises.rm(state.tempDirectory, { recursive: true, force: true });
    },
  });
}
