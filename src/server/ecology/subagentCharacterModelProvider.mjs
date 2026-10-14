import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  auditCodexTrustedTavernCharacterAgentV2Input,
  buildCodexTrustedTavernCharacterAgentV2Prompt,
  tavernCharacterAgentV2StageDefinition,
} from "./codexTrustedTavernCharacterAgentV2Channel.mjs";
import { openAIJsonCharacterModelStageDefinition } from "./openAIJsonCharacterModelProvider.mjs";
import {
  tavernCharacterAgentV2SystemPrompt,
  tavernCharacterAgentV2UserPrompt,
} from "../pipeline/tavernCharacterAgentV2.mjs";
import { assertCharacterModelProviderPort } from "../simulation/characterModelSession.mjs";
import { reserveModelProviderRequest } from "../pipeline/modelRequestBudget.mjs";

export const SUBAGENT_CHARACTER_MODEL_PROVIDER_VERSION = "subagent-character-model-provider-v1";

/**
 * A character model transport whose "model" is an out-of-process agent that
 * cannot be spawned from inside Node. Each stage is written to disk as a
 * self-contained request; the operator (or an orchestrating agent) drops the
 * structured answer next to it, and this provider picks it up.
 *
 * This exists because the standalone `claude` CLI's saved login is revoked in
 * this environment, so the codex-style `spawn a CLI` transport is unavailable
 * for Anthropic models. The isolation contract is unchanged: one persistent
 * conversation per character, no tools, no project config, stage input audited
 * before it ever leaves the process.
 */
function clean(value = "") {
  return String(value ?? "").trim();
}

function fail(code, message, evidence = {}) {
  const error = new Error(message);
  error.code = code;
  error.evidence = evidence;
  return error;
}

function strictOutputSchema(schema = {}) {
  const output = structuredClone(schema);
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "object" && node.properties) {
      node.additionalProperties = false;
      const optional = new Set(node.optionalProperties || []);
      node.required = Object.keys(node.properties).filter((key) => !optional.has(key));
      delete node.optionalProperties;
      Object.values(node.properties).forEach(visit);
    }
    if (node.items) visit(node.items);
    for (const branch of node.anyOf || []) visit(branch);
    for (const branch of node.oneOf || []) visit(branch);
  };
  visit(output);
  return output;
}

function stageArtifacts(stageInput = {}) {
  if (clean(stageInput.phase) !== "awaiting_agent_turn_commit") {
    const audit = auditCodexTrustedTavernCharacterAgentV2Input(stageInput);
    if (!audit.valid) {
      throw fail(
        "SUBAGENT_CHARACTER_STAGE_INPUT_INVALID",
        (audit.errors || []).map((row) => `${row.code}@${row.path}: ${row.message}`).join("\n"),
      );
    }
    const definition = tavernCharacterAgentV2StageDefinition(stageInput.phase, stageInput);
    if (!definition) throw fail("SUBAGENT_CHARACTER_STAGE_UNKNOWN", "Unknown character agent stage.");
    return { audit, definition, prompt: buildCodexTrustedTavernCharacterAgentV2Prompt(stageInput) };
  }
  const definition = openAIJsonCharacterModelStageDefinition(stageInput);
  if (!definition) throw fail("SUBAGENT_CHARACTER_STAGE_UNKNOWN", "Unknown character agent commit stage.");
  const audit = {
    valid: true,
    serializedBytes: Buffer.byteLength(JSON.stringify(stageInput), "utf8"),
  };
  const prompt = `<character_agent_v2_contract>\n${tavernCharacterAgentV2SystemPrompt(stageInput)}\n</character_agent_v2_contract>\n\n<isolated_character_stage_input>\n${tavernCharacterAgentV2UserPrompt(stageInput)}\n</isolated_character_stage_input>\n\n不要调用任何工具、命令、文件、网络、记忆或其他 Agent。不要读取当前输入以外的项目资料。只作为同一个人物完成当前阶段；最终只输出符合指定 schema 的 JSON。`;
  return { audit, definition, prompt };
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function createSubagentCharacterModelProvider({
  model = "claude-sonnet-5",
  reasoningEffort = "medium",
  exchangeRoot,
  pollIntervalMs = 500,
  timeoutMs = 30 * 60 * 1000,
} = {}) {
  if (!exchangeRoot) {
    throw fail("SUBAGENT_CHARACTER_PROVIDER_EXCHANGE_ROOT_REQUIRED", "An exchange directory is required.");
  }
  fs.mkdirSync(exchangeRoot, { recursive: true });
  const liveStateByHandle = new WeakMap();

  function stateFor(handle) {
    const state = handle && typeof handle === "object" ? liveStateByHandle.get(handle) : null;
    if (!state || state.closed) {
      throw fail("SUBAGENT_CHARACTER_PROVIDER_HANDLE_UNKNOWN", "Provider handle is not open.");
    }
    return state;
  }

  return assertCharacterModelProviderPort({
    version: SUBAGENT_CHARACTER_MODEL_PROVIDER_VERSION,

    async openConversation(input = {}) {
      const characterId = clean(input.characterId);
      if (!characterId) {
        throw fail("SUBAGENT_CHARACTER_PROVIDER_CHARACTER_REQUIRED", "openConversation requires characterId.");
      }
      const restored = input.providerCheckpoint || null;
      const providerConversationId = clean(input.providerConversationId)
        || clean(restored?.providerConversationId)
        || `character-model:subagent:${randomUUID()}`;
      const handle = Object.freeze({
        schemaVersion: SUBAGENT_CHARACTER_MODEL_PROVIDER_VERSION,
        characterId,
        providerConversationId,
      });
      liveStateByHandle.set(handle, {
        characterId,
        providerConversationId,
        acceptedStageCount: Number(restored?.privateState?.acceptedStageCount || 0),
        invocationCount: 0,
        closed: false,
      });
      return handle;
    },

    async runStage(handle, stageInput = {}, context = {}) {
      const state = stateFor(handle);
      const { audit, definition, prompt } = stageArtifacts(stageInput);
      state.invocationCount += 1;
      const startedAt = Date.now();
      // The stem must be unique per stage attempt across the whole run. The
      // per-conversation invocation counter resets whenever a new conversation
      // is opened for an actor turn, so keying on it alone made a later turn
      // collide with an earlier turn's filename and instantly consume that
      // turn's stale response. agentTurnId is what actually distinguishes them.
      const safe = (value) => clean(value).replace(/[^a-z0-9_-]+/giu, "-").replace(/^-+|-+$/gu, "");
      const stem = [
        String(state.invocationCount).padStart(3, "0"),
        safe(state.characterId),
        safe(stageInput.agentTurnId),
        clean(stageInput.phase),
        `r${Number(stageInput.protocolRepairFeedback?.attempt || 0)}`,
      ].filter(Boolean).join("-");
      const requestPath = path.join(exchangeRoot, `${stem}.request.json`);
      const responsePath = path.join(exchangeRoot, `${stem}.response.json`);

      if (context.requestBudget) {
        reserveModelProviderRequest(context.requestBudget, context.requestContext || {
          characterId: state.characterId,
          agentTurnId: stageInput.agentTurnId,
          phase: stageInput.phase,
        });
      }

      fs.writeFileSync(requestPath, `${JSON.stringify({
        model,
        reasoningEffort,
        characterId: state.characterId,
        providerConversationId: state.providerConversationId,
        agentTurnId: clean(stageInput.agentTurnId),
        phase: clean(stageInput.phase),
        outputKey: definition.outputKey,
        responsePath,
        prompt,
        schema: strictOutputSchema(definition.schema),
      }, null, 2)}\n`, "utf8");

      const deadline = Date.now() + timeoutMs;
      while (!fs.existsSync(responsePath)) {
        if (Date.now() > deadline) {
          throw fail("SUBAGENT_CHARACTER_PROVIDER_TIMEOUT", `No response for ${stem} within ${timeoutMs}ms.`);
        }
        sleepSync(pollIntervalMs);
      }
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(responsePath, "utf8"));
      } catch (cause) {
        throw fail("SUBAGENT_CHARACTER_PROVIDER_INVALID_JSON", `Response for ${stem} is not parseable JSON: ${cause.message}`);
      }
      state.acceptedStageCount += 1;
      return {
        characterId: state.characterId,
        providerConversationId: state.providerConversationId,
        [definition.outputKey]: parsed,
        audit,
        stage: {
          name: `SubagentCharacterModelProvider:${definition.stage}:${state.characterId}`,
          phase: stageInput.phase,
          provider: "anthropic",
          channel: "anthropic-claude-subagent",
          transport: "orchestrating-agent",
          authentication: "host-session",
          model,
          reasoningEffort,
          elapsedMs: Date.now() - startedAt,
          isolation: "persistent-character-no-tools-no-project-config",
          sessionOperation: state.invocationCount === 1 ? "start" : "resume",
        },
      };
    },

    async checkpointConversation(handle) {
      const state = stateFor(handle);
      return {
        schemaVersion: "subagent-character-model-provider-checkpoint-v1",
        characterId: state.characterId,
        providerConversationId: state.providerConversationId,
        model,
        reasoningEffort,
        privateState: { acceptedStageCount: state.acceptedStageCount },
      };
    },

    async closeConversation(handle) {
      stateFor(handle).closed = true;
    },
  });
}
