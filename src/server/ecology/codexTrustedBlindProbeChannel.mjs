import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  auditCharacterFoundationProbeInput,
  characterFoundationProbeDecisionSchema,
  characterFoundationProbeSystemPrompt,
  characterFoundationProbeUserPrompt,
  validateCharacterFoundationProbeDecision,
} from "./characterFoundationBlindProbe.mjs";

const TRUSTED_CHANNEL_CONFIG_URL = new URL("../../../config/trusted-model-channels.json", import.meta.url);
const PURPOSE = "character-foundation-blind-probe";
export const TOOL_FEATURES_DISABLED_FOR_BLINDNESS = Object.freeze([
  "shell_tool",
  "unified_exec",
  "web_search",
  "apps",
  "hooks",
  "memories",
  "multi_agent",
  "remote_plugin",
  "goals",
]);
const PROJECT_MODEL_ENVIRONMENT_KEYS = Object.freeze([
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  "OPENAI_API_STYLE",
  "OPENAI_ORGANIZATION",
  "OPENAI_ORG_ID",
  "OPENAI_PROJECT",
  "OPENAI_PROJECT_ID",
  "CODEX_API_KEY",
  "CHARACTER_TOWN_API_KEY",
  "CHARACTER_TOWN_BASE_URL",
  "CHARACTER_TOWN_MODEL",
  "CHARACTER_TOWN_API_STYLE",
  "MODEL_PROVIDER",
  "AI_PROVIDER",
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function readTrustedChannelConfiguration() {
  const parsed = JSON.parse(fs.readFileSync(TRUSTED_CHANNEL_CONFIG_URL, "utf8"));
  const channels = Array.isArray(parsed.channels) ? parsed.channels : [];
  const defaultChannel = channels.find((row) => row.id === parsed.defaultChannelId);
  if (!defaultChannel) throw new TypeError("trusted-model-channels.json 缺少有效的 defaultChannelId");
  if (defaultChannel.provider !== "openai"
    || defaultChannel.transport !== "codex-cli"
    || defaultChannel.authentication !== "saved-chatgpt-login") {
    throw new TypeError("默认受信任通道必须使用 OpenAI Codex CLI 与本机 ChatGPT 登录");
  }
  if (!defaultChannel.allowedPurposes?.includes(PURPOSE)) {
    throw new TypeError(`默认受信任通道未授权用途 ${PURPOSE}`);
  }
  if (!defaultChannel.allowedModels?.includes(defaultChannel.defaultModel)) {
    throw new TypeError("默认受信任模型不在 allowedModels 白名单中");
  }
  for (const model of defaultChannel.allowedModels || []) {
    const modelPurposes = defaultChannel.allowedPurposesByModel?.[model];
    if (!Array.isArray(modelPurposes) || !modelPurposes.length
      || modelPurposes.some((purpose) => !defaultChannel.allowedPurposes.includes(purpose))) {
      throw new TypeError(`受信任模型 ${model} 缺少有效的用途白名单`);
    }
    const reasoningEfforts = defaultChannel.allowedReasoningEffortsByModel?.[model];
    if (!Array.isArray(reasoningEfforts) || !reasoningEfforts.length) {
      throw new TypeError(`受信任模型 ${model} 缺少推理档位白名单`);
    }
  }
  if (!defaultChannel.allowedReasoningEffortsByModel?.[defaultChannel.defaultModel]
    ?.includes(defaultChannel.defaultReasoningEffort)) {
    throw new TypeError("默认受信任推理档位不在默认模型白名单中");
  }
  return deepFreeze(parsed);
}

export const TRUSTED_MODEL_CHANNELS = readTrustedChannelConfiguration();
export const CODEX_TRUSTED_BLIND_PROBE_CHANNEL = TRUSTED_MODEL_CHANNELS.channels.find(
  (row) => row.id === TRUSTED_MODEL_CHANNELS.defaultChannelId,
);
export const CODEX_TRUSTED_BLIND_PROBE_MODEL = CODEX_TRUSTED_BLIND_PROBE_CHANNEL.defaultModel;
export const CODEX_TRUSTED_BLIND_PROBE_REASONING_EFFORT = CODEX_TRUSTED_BLIND_PROBE_CHANNEL.defaultReasoningEffort;

function invalidProbeInputError(audit) {
  const error = new TypeError(audit.errors.map((entry) => `${entry.code}@${entry.path}: ${entry.message}`).join("\n"));
  error.code = "INVALID_CHARACTER_FOUNDATION_PROBE_INPUT";
  error.issues = audit.errors;
  return error;
}

export function assertCodexTrustedBlindProbeModel(model = CODEX_TRUSTED_BLIND_PROBE_MODEL) {
  if (!CODEX_TRUSTED_BLIND_PROBE_CHANNEL.allowedModels.includes(model)) {
    const error = new TypeError(`模型 ${model} 不在受信任盲测白名单中`);
    error.code = "UNTRUSTED_BLIND_PROBE_MODEL";
    error.allowedModels = [...CODEX_TRUSTED_BLIND_PROBE_CHANNEL.allowedModels];
    throw error;
  }
  return model;
}

export function assertCodexTrustedChannelPurpose(
  purpose,
  model = CODEX_TRUSTED_BLIND_PROBE_MODEL,
) {
  assertCodexTrustedBlindProbeModel(model);
  if (!CODEX_TRUSTED_BLIND_PROBE_CHANNEL.allowedPurposes?.includes(purpose)) {
    const error = new TypeError(`受信任通道未授权用途 ${purpose}`);
    error.code = "UNTRUSTED_MODEL_CHANNEL_PURPOSE";
    error.allowedPurposes = [...(CODEX_TRUSTED_BLIND_PROBE_CHANNEL.allowedPurposes || [])];
    throw error;
  }
  const modelPurposes = CODEX_TRUSTED_BLIND_PROBE_CHANNEL.allowedPurposesByModel?.[model] || [];
  if (!modelPurposes.includes(purpose)) {
    const error = new TypeError(`受信任模型 ${model} 未授权用途 ${purpose}`);
    error.code = "UNTRUSTED_MODEL_PURPOSE_PAIR";
    error.allowedPurposes = [...modelPurposes];
    throw error;
  }
  return { channel: CODEX_TRUSTED_BLIND_PROBE_CHANNEL, model, purpose };
}

export function assertCodexTrustedReasoningEffort(
  model = CODEX_TRUSTED_BLIND_PROBE_MODEL,
  reasoningEffort = CODEX_TRUSTED_BLIND_PROBE_REASONING_EFFORT,
) {
  assertCodexTrustedBlindProbeModel(model);
  const allowedReasoningEfforts = CODEX_TRUSTED_BLIND_PROBE_CHANNEL
    .allowedReasoningEffortsByModel?.[model] || [];
  if (!allowedReasoningEfforts.includes(reasoningEffort)) {
    const error = new TypeError(`模型 ${model} 的推理档位 ${reasoningEffort} 不在受信任白名单中`);
    error.code = "UNTRUSTED_MODEL_REASONING_EFFORT_PAIR";
    error.allowedReasoningEfforts = [...allowedReasoningEfforts];
    throw error;
  }
  return reasoningEffort;
}

export function sanitizeCodexTrustedBlindProbeEnvironment(environment = process.env) {
  const sanitized = { ...environment };
  for (const key of PROJECT_MODEL_ENVIRONMENT_KEYS) delete sanitized[key];
  return sanitized;
}

export function buildCodexTrustedBlindProbePrompt(input = {}) {
  const audit = auditCharacterFoundationProbeInput(input);
  if (!audit.valid) throw invalidProbeInputError(audit);
  return `<character_agent_contract>\n${characterFoundationProbeSystemPrompt(input)}\n</character_agent_contract>\n\n<blind_probe_input>\n${characterFoundationProbeUserPrompt(input)}\n</blind_probe_input>\n\n不要调用任何工具、命令、文件、网络、记忆或其他 Agent。只能根据 blind_probe_input 作答；最终只输出符合指定 schema 的 JSON。`;
}

export function buildCodexTrustedStructuredInvocation({
  purpose,
  prompt,
  tempDirectory,
  schemaPath,
  outputPath,
  model = CODEX_TRUSTED_BLIND_PROBE_MODEL,
  reasoningEffort = CODEX_TRUSTED_BLIND_PROBE_REASONING_EFFORT,
  environment = sanitizeCodexTrustedBlindProbeEnvironment(),
} = {}) {
  assertCodexTrustedChannelPurpose(purpose, model);
  assertCodexTrustedReasoningEffort(model, reasoningEffort);
  if (!tempDirectory || !schemaPath || !outputPath) {
    throw new TypeError("受信任模型调用缺少临时目录、schema 路径或输出路径");
  }
  if (!String(prompt || "").trim()) throw new TypeError("受信任模型调用缺少隔离 prompt");
  const args = [
    "exec",
    "-",
    "--model",
    model,
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
  ];
  for (const feature of TOOL_FEATURES_DISABLED_FOR_BLINDNESS) args.push("--disable", feature);
  args.push(
    "--config",
    'approval_policy="never"',
    "--config",
    'web_search="disabled"',
    "--config",
    `model_reasoning_effort="${reasoningEffort}"`,
    "--config",
    'model_verbosity="low"',
    "-C",
    tempDirectory,
    "--output-schema",
    schemaPath,
    "--output-last-message",
    outputPath,
    "--color",
    "never",
  );
  return {
    command: "codex",
    args,
    cwd: tempDirectory,
    environment,
    stdin: prompt,
    purpose,
    model,
    reasoningEffort,
    schemaPath,
    outputPath,
  };
}

/**
 * Build one isolated invocation in a persistent, character-owned Codex
 * conversation.  The first invocation deliberately omits --ephemeral; later
 * invocations resume the exact provider conversation id.  This is separate
 * from blind probes, which must remain stateless.
 */
export function buildCodexTrustedPersistentStructuredInvocation({
  purpose,
  prompt,
  providerConversationId = "",
  tempDirectory,
  schemaPath,
  outputPath,
  model = CODEX_TRUSTED_BLIND_PROBE_MODEL,
  reasoningEffort = CODEX_TRUSTED_BLIND_PROBE_REASONING_EFFORT,
  environment = sanitizeCodexTrustedBlindProbeEnvironment(),
} = {}) {
  assertCodexTrustedChannelPurpose(purpose, model);
  assertCodexTrustedReasoningEffort(model, reasoningEffort);
  if (!tempDirectory || !schemaPath || !outputPath) {
    throw new TypeError("持续受信任模型调用缺少临时目录、schema 路径或输出路径");
  }
  if (!String(prompt || "").trim()) throw new TypeError("持续受信任模型调用缺少隔离 prompt");

  const conversationId = String(providerConversationId || "").trim();
  const sessionOperation = conversationId ? "resume" : "start";
  const args = conversationId
    ? ["exec", "resume"]
    : ["exec"];
  args.push(
    "--model",
    model,
  );
  if (!conversationId) args.push("--sandbox", "read-only");
  args.push(
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
  );
  for (const feature of TOOL_FEATURES_DISABLED_FOR_BLINDNESS) args.push("--disable", feature);
  args.push(
    "--config",
    'approval_policy="never"',
    "--config",
    'web_search="disabled"',
    "--config",
    `model_reasoning_effort="${reasoningEffort}"`,
    "--config",
    'model_verbosity="low"',
    "--output-schema",
    schemaPath,
    "--output-last-message",
    outputPath,
    "--json",
  );
  if (!conversationId) args.push("-C", tempDirectory);
  if (conversationId) args.push(conversationId);
  args.push("-");

  return {
    command: "codex",
    args,
    cwd: tempDirectory,
    environment,
    stdin: prompt,
    purpose,
    model,
    reasoningEffort,
    sessionOperation,
    providerConversationId: conversationId,
    schemaPath,
    outputPath,
  };
}

export function buildCodexTrustedBlindProbeInvocation({
  input,
  tempDirectory,
  schemaPath,
  outputPath,
  model = CODEX_TRUSTED_BLIND_PROBE_MODEL,
  reasoningEffort = CODEX_TRUSTED_BLIND_PROBE_REASONING_EFFORT,
  environment = sanitizeCodexTrustedBlindProbeEnvironment(),
} = {}) {
  return buildCodexTrustedStructuredInvocation({
    purpose: PURPOSE,
    prompt: buildCodexTrustedBlindProbePrompt(input),
    tempDirectory,
    schemaPath,
    outputPath,
    model,
    reasoningEffort,
    environment,
  });
}

function appendBounded(current, chunk, maxLength = 200_000) {
  const next = `${current}${chunk}`;
  return next.length <= maxLength ? next : next.slice(next.length - maxLength);
}

export function executeCodexTrustedBlindProbeInvocation(invocation, { signal, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.environment,
      stdio: ["pipe", "pipe", "pipe"],
      signal,
    });
    let stdout = "";
    let stderr = "";
    let pendingLine = "";
    const reportProgress = line => {
      if (typeof onProgress !== "function") return;
      try {
        const event = JSON.parse(line);
        const usage = event.type === "turn.completed" && event.usage
          ? Object.fromEntries(["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens"]
            .filter(key => Number.isFinite(event.usage[key]))
            .map(key => [key, event.usage[key]]))
          : undefined;
        // Timing metadata only: reasoning, message text, tool arguments and
        // results must never enter a progress log through this callback.
        onProgress({ type: String(event.type || ""), elapsedMs: performance.now() - startedAt,
          ...(event.item?.type ? { itemType: String(event.item.type) } : {}),
          ...(usage ? { usage } : {}),
        });
      } catch { /* Diagnostics and observational callback failures do not change execution. */ }
    };
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout = appendBounded(stdout, text);
      if (typeof onProgress !== "function") return;
      pendingLine += text;
      let newline;
      while ((newline = pendingLine.indexOf("\n")) >= 0) {
        reportProgress(pendingLine.slice(0, newline));
        pendingLine = pendingLine.slice(newline + 1);
      }
      if (pendingLine.length > 2_000_000) pendingLine = "";
    });
    child.stderr.on("data", (chunk) => { stderr = appendBounded(stderr, chunk.toString()); });
    child.once("error", (cause) => {
      const error = new Error(`无法启动受信任 Codex 通道：${cause.message}`, { cause });
      error.code = "CODEX_TRUSTED_CHANNEL_START_FAILED";
      reject(error);
    });
    child.once("close", (exitCode, terminationSignal) => {
      if (pendingLine) reportProgress(pendingLine);
      if (exitCode === 0) {
        resolve({ exitCode, stdout, stderr });
        return;
      }
      const error = new Error(`受信任 Codex 通道退出（code=${exitCode}, signal=${terminationSignal || "none"}）`);
      error.code = "CODEX_TRUSTED_CHANNEL_FAILED";
      error.exitCode = exitCode;
      error.terminationSignal = terminationSignal;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
    child.stdin.end(invocation.stdin);
  });
}

export async function runCharacterFoundationBlindProbeWithCodex(input, {
  signal,
  model = CODEX_TRUSTED_BLIND_PROBE_MODEL,
  reasoningEffort = CODEX_TRUSTED_BLIND_PROBE_REASONING_EFFORT,
  tempRoot = os.tmpdir(),
  execute = executeCodexTrustedBlindProbeInvocation,
} = {}) {
  const audit = auditCharacterFoundationProbeInput(input);
  if (!audit.valid) throw invalidProbeInputError(audit);
  assertCodexTrustedChannelPurpose(PURPOSE, model);
  assertCodexTrustedReasoningEffort(model, reasoningEffort);

  const startedAt = Date.now();
  const tempDirectory = await fs.promises.mkdtemp(path.join(tempRoot, "gtown-codex-trusted-probe-"));
  const schemaPath = path.join(tempDirectory, "decision.schema.json");
  const outputPath = path.join(tempDirectory, "decision.json");
  try {
    await fs.promises.writeFile(schemaPath, `${JSON.stringify(characterFoundationProbeDecisionSchema, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    const invocation = buildCodexTrustedBlindProbeInvocation({
      input,
      tempDirectory,
      schemaPath,
      outputPath,
      model,
      reasoningEffort,
      environment: sanitizeCodexTrustedBlindProbeEnvironment(),
    });
    const execution = await execute(invocation, { signal });
    let parsed;
    try {
      parsed = JSON.parse(await fs.promises.readFile(outputPath, "utf8"));
    } catch (cause) {
      const error = new TypeError(`受信任 Codex 通道没有生成可解析的结构化决定：${cause.message}`, { cause });
      error.code = "CODEX_TRUSTED_CHANNEL_INVALID_JSON";
      error.stderr = execution?.stderr || "";
      throw error;
    }

    const meta = {
      provider: CODEX_TRUSTED_BLIND_PROBE_CHANNEL.provider,
      channel: CODEX_TRUSTED_BLIND_PROBE_CHANNEL.id,
      transport: CODEX_TRUSTED_BLIND_PROBE_CHANNEL.transport,
      authentication: CODEX_TRUSTED_BLIND_PROBE_CHANNEL.authentication,
      model,
      reasoningEffort,
      elapsedMs: Date.now() - startedAt,
      isolation: "ephemeral-no-tools-no-project-config",
    };
    const decisionValidation = validateCharacterFoundationProbeDecision(input, parsed);
    if (!decisionValidation.valid) {
      const error = new TypeError(decisionValidation.errors.map((entry) => `${entry.code}@${entry.path}: ${entry.message}`).join("\n"));
      error.code = "CHARACTER_FOUNDATION_PROBE_DECISION_REJECTED";
      error.issues = decisionValidation.errors;
      error.decision = parsed;
      error.meta = meta;
      throw error;
    }
    return {
      probeId: input.probeId,
      characterId: input.character?.id || "",
      decision: parsed,
      audit,
      decisionValidation,
      meta,
      authorAcceptance: "pending",
    };
  } finally {
    await fs.promises.rm(tempDirectory, { recursive: true, force: true });
  }
}
