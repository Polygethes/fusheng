import {
  CODEX_TRUSTED_BLIND_PROBE_MODEL,
  CODEX_TRUSTED_BLIND_PROBE_REASONING_EFFORT,
  CODEX_TRUSTED_BLIND_PROBE_CHANNEL,
  assertCodexTrustedChannelPurpose,
  assertCodexTrustedReasoningEffort,
} from "./ecology/codexTrustedBlindProbeChannel.mjs";
import {
  CODEX_TRUSTED_TAVERN_CHARACTER_AGENT_V2_PURPOSE,
} from "./ecology/codexTrustedTavernCharacterAgentV2Channel.mjs";
import { createCodexTrustedCharacterModelProvider } from "./ecology/codexTrustedCharacterModelProvider.mjs";
import { createOpenAIJsonCharacterModelProvider } from "./ecology/openAIJsonCharacterModelProvider.mjs";
import { createSubagentCharacterModelProvider } from "./ecology/subagentCharacterModelProvider.mjs";
import { currentProviderConfig } from "./pipeline/responseClient.mjs";
import {
  CHARACTER_MODEL_TRANSPORTS,
  MODEL_API_TRANSPORT,
  NO_MODEL_TRANSPORT,
  SUBAGENT_TRANSPORT,
  resolveCharacterModelEnvironment,
} from "./modelEnvironment.mjs";
import { resolveTavernCharacterAgentV2CallMode } from "./pipeline/tavernCharacterAgentV2.mjs";

const API_TRANSPORT = MODEL_API_TRANSPORT;
const CODEX_TRANSPORT = "codex-cli";

function clean(value = "") {
  return String(value ?? "").trim();
}

/** New runs use the post-regulation expression snapshot. */
export function resolveV27CharacterAgentCallMode(environment = {}) {
  const mode = resolveTavernCharacterAgentV2CallMode(
    clean(environment.GTOWN_V27_CHARACTER_AGENT_CALL_MODE) || "three-call",
  );
  if (mode !== "three-call" && clean(environment.GTOWN_V27_DIAGNOSTIC_LEGACY_CALL_MODE) !== "1") {
    const error = new Error("Production simulations require three-call. Legacy call modes require the explicit GTOWN_V27_DIAGNOSTIC_LEGACY_CALL_MODE=1 diagnostic opt-in.");
    error.code = "GTOWN_V27_LEGACY_CALL_MODE_REQUIRES_DIAGNOSTIC_OPT_IN";
    throw error;
  }
  return mode;
}

/**
 * Resolve this run's Character model transport. There is no default model: the
 * run uses operator-supplied API credentials, or the agent shell it is running
 * inside, or nothing at all. `GTOWN_V27_MODEL_TRANSPORT` remains supported as a
 * v2.7-scoped override of the shared `GTOWN_MODEL_TRANSPORT`.
 */
export function resolveV27CharacterModelProviderConfig(environment = {}, {
  apiModel = "",
} = {}) {
  const scoped = clean(environment.GTOWN_V27_MODEL_TRANSPORT).toLowerCase();
  if (scoped && !CHARACTER_MODEL_TRANSPORTS.includes(scoped)) {
    // Report the variable the operator actually set, not the shared one it maps
    // onto, so the fix is obvious from the message alone.
    const error = new TypeError(
      `GTOWN_V27_MODEL_TRANSPORT must be one of ${CHARACTER_MODEL_TRANSPORTS.join(", ")}.`,
    );
    error.code = "GTOWN_V27_MODEL_TRANSPORT_UNSUPPORTED";
    error.evidence = { requested: scoped };
    throw error;
  }
  const resolved = resolveCharacterModelEnvironment(
    scoped ? { ...environment, GTOWN_MODEL_TRANSPORT: scoped } : environment,
  );

  if (resolved.transport === CODEX_TRANSPORT) {
    // The trusted Codex channel keeps its own declared model whitelist; that is
    // a deliberate provenance boundary, not a default model for the project.
    const model = clean(resolved.model) || CODEX_TRUSTED_BLIND_PROBE_MODEL;
    const reasoningEffort = clean(resolved.reasoningEffort) || CODEX_TRUSTED_BLIND_PROBE_REASONING_EFFORT;
    assertCodexTrustedChannelPurpose(CODEX_TRUSTED_TAVERN_CHARACTER_AGENT_V2_PURPOSE, model);
    assertCodexTrustedReasoningEffort(model, reasoningEffort);
    return {
      ...resolved,
      transport: CODEX_TRANSPORT,
      model,
      reasoningEffort,
      authentication: CODEX_TRUSTED_BLIND_PROBE_CHANNEL.authentication,
      usesApiKey: false,
      displayLabel: "本机 Codex · ChatGPT 登录",
    };
  }

  if (resolved.transport === API_TRANSPORT) {
    // `apiModel` is what the operator configured; the resolver already refused
    // to select this transport without one.
    return { ...resolved, model: clean(resolved.model) || clean(apiModel) };
  }

  return resolved;
}

export function createV27CharacterModelProvider(config = {}, {
  environment = process.env,
  execute,
  tempRoot,
  exchangeRoot,
} = {}) {
  if (config.transport === CODEX_TRANSPORT) {
    return createCodexTrustedCharacterModelProvider({
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      environment,
      ...(typeof execute === "function" ? { execute } : {}),
      ...(tempRoot ? { tempRoot } : {}),
    });
  }
  if (config.transport === API_TRANSPORT) {
    return createOpenAIJsonCharacterModelProvider({ model: config.model, providerConfig: currentProviderConfig(environment) });
  }
  if (config.transport === SUBAGENT_TRANSPORT) {
    const root = clean(exchangeRoot) || clean(environment.GTOWN_V27_SUBAGENT_EXCHANGE);
    if (!root) {
      const error = new TypeError(
        "The subagent transport needs an exchange directory: set GTOWN_V27_SUBAGENT_EXCHANGE. Each Character stage is written there for the surrounding agent shell to answer.",
      );
      error.code = "GTOWN_SUBAGENT_EXCHANGE_REQUIRED";
      throw error;
    }
    return createSubagentCharacterModelProvider({
      model: clean(config.model) || "agent-shell-default",
      reasoningEffort: clean(config.reasoningEffort) || "default",
      exchangeRoot: root,
    });
  }
  if (config.transport === NO_MODEL_TRANSPORT) {
    const error = new TypeError(
      "No Character model is configured, so no model-backed turn can run. Supply an API key and model, run inside an agent shell, or stay on the deterministic fixture path.",
    );
    error.code = "GTOWN_MODEL_NOT_CONFIGURED";
    throw error;
  }
  throw new TypeError(`Unsupported v2.7 CharacterModel transport: ${clean(config.transport) || "missing"}.`);
}
