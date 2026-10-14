import assert from "node:assert/strict";
import path from "node:path";
import {
  CODEX_TRUSTED_BLIND_PROBE_CHANNEL,
  CODEX_TRUSTED_BLIND_PROBE_MODEL,
  CODEX_TRUSTED_BLIND_PROBE_REASONING_EFFORT,
  TRUSTED_MODEL_CHANNELS,
  assertCodexTrustedBlindProbeModel,
  assertCodexTrustedChannelPurpose,
  assertCodexTrustedReasoningEffort,
  buildCodexTrustedBlindProbeInvocation,
  buildCodexTrustedBlindProbePrompt,
  buildCodexTrustedStructuredInvocation,
  sanitizeCodexTrustedBlindProbeEnvironment,
} from "../src/server/ecology/codexTrustedBlindProbeChannel.mjs";
import { buildZhouMinSecondhandClaimProbeInput } from "./fixtures/zhouMinSecondhandClaimProbeFixture.mjs";

const input = buildZhouMinSecondhandClaimProbeInput();
const tempDirectory = "/private/tmp/gtown-codex-trusted-probe-contract";
const schemaPath = `${tempDirectory}/decision.schema.json`;
const outputPath = `${tempDirectory}/decision.json`;

const prompt = buildCodexTrustedBlindProbePrompt(input);
assert.ok(prompt.includes("<character_agent_contract>"));
assert.ok(prompt.includes("<blind_probe_input>"));
assert.ok(prompt.includes(input.probeId));
assert.ok(prompt.includes(input.character.name));

for (const forbidden of [
  path.resolve(import.meta.dirname, "..", ".."),
  "holdouts.md",
  "calibration-evidence.json",
  "calibrationEvidence",
  "holdouts",
  "authorCorrection",
  "expectedAction",
  "偷偷确认",
  "不向谢真石摊牌",
  "外表不立刻表态",
]) {
  assert.equal(prompt.includes(forbidden), false, `trusted prompt leaked ${forbidden}`);
}

const sanitizedEnvironment = sanitizeCodexTrustedBlindProbeEnvironment({
  HOME: "/Users/tester",
  PATH: "/usr/bin:/bin",
  CODEX_HOME: "/Users/tester/.codex",
  DEEPSEEK_API_KEY: "third-party-secret",
  DEEPSEEK_BASE_URL: "https://third-party.invalid",
  DEEPSEEK_MODEL: "third-party-model",
  OPENAI_API_KEY: "project-api-secret",
  OPENAI_BASE_URL: "https://redirect.invalid",
  OPENAI_MODEL: "project-model",
  CHARACTER_TOWN_MODEL: "project-model",
  CHARACTER_TOWN_API_STYLE: "chat-completions",
});

assert.equal(sanitizedEnvironment.HOME, "/Users/tester");
assert.equal(sanitizedEnvironment.PATH, "/usr/bin:/bin");
assert.equal(sanitizedEnvironment.CODEX_HOME, "/Users/tester/.codex");
for (const forbiddenKey of [
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  "CHARACTER_TOWN_MODEL",
  "CHARACTER_TOWN_API_STYLE",
]) {
  assert.equal(forbiddenKey in sanitizedEnvironment, false, `trusted environment kept ${forbiddenKey}`);
}

const invocation = buildCodexTrustedBlindProbeInvocation({
  input,
  tempDirectory,
  schemaPath,
  outputPath,
  environment: sanitizedEnvironment,
});

assert.equal(CODEX_TRUSTED_BLIND_PROBE_MODEL, "gpt-5.6-sol");
assert.equal(CODEX_TRUSTED_BLIND_PROBE_REASONING_EFFORT, "medium");
assert.equal(CODEX_TRUSTED_BLIND_PROBE_CHANNEL.provider, "openai");
assert.equal(CODEX_TRUSTED_BLIND_PROBE_CHANNEL.authentication, "saved-chatgpt-login");
assert.deepEqual(CODEX_TRUSTED_BLIND_PROBE_CHANNEL.allowedModels, ["gpt-5.6-sol", "gpt-5.6-luna"]);
assert.deepEqual(TRUSTED_MODEL_CHANNELS.channels.map((row) => row.id), ["openai-codex-chatgpt"]);
assert.throws(
  () => assertCodexTrustedBlindProbeModel("deepseek-v4-flash"),
  (error) => error?.code === "UNTRUSTED_BLIND_PROBE_MODEL",
);
assert.throws(
  () => assertCodexTrustedChannelPurpose("character-foundation-blind-probe", "gpt-5.6-luna"),
  (error) => error?.code === "UNTRUSTED_MODEL_PURPOSE_PAIR",
);
assert.equal(assertCodexTrustedReasoningEffort("gpt-5.6-sol", "low"), "low");
assert.equal(assertCodexTrustedReasoningEffort("gpt-5.6-sol", "high"), "high");
assert.equal(assertCodexTrustedReasoningEffort("gpt-5.6-luna", "medium"), "medium");
assert.equal(assertCodexTrustedReasoningEffort("gpt-5.6-luna", "high"), "high");
assert.equal(
  assertCodexTrustedChannelPurpose("tavern-character-agent-behavior-acceptance", "gpt-5.6-luna").model,
  "gpt-5.6-luna",
);
assert.equal(assertCodexTrustedReasoningEffort("gpt-5.6-luna", "max"), "max");
assert.equal(invocation.command, "codex");
assert.equal(invocation.cwd, tempDirectory);
assert.equal(invocation.stdin, prompt);
assert.deepEqual(invocation.environment, sanitizedEnvironment);
assert.deepEqual(invocation.args.slice(0, 2), ["exec", "-"]);

function optionValue(args, option) {
  const index = args.indexOf(option);
  assert.notEqual(index, -1, `missing option ${option}`);
  return args[index + 1];
}

assert.equal(optionValue(invocation.args, "--model"), CODEX_TRUSTED_BLIND_PROBE_MODEL);
assert.equal(optionValue(invocation.args, "--sandbox"), "read-only");
assert.equal(optionValue(invocation.args, "-C"), tempDirectory);
assert.equal(optionValue(invocation.args, "--output-schema"), schemaPath);
assert.equal(optionValue(invocation.args, "--output-last-message"), outputPath);

for (const flag of ["--ephemeral", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check"]) {
  assert.ok(invocation.args.includes(flag), `missing isolation flag ${flag}`);
}

const disabledFeatures = invocation.args
  .map((value, index) => (value === "--disable" ? invocation.args[index + 1] : ""))
  .filter(Boolean);
for (const feature of ["shell_tool", "unified_exec", "web_search", "apps", "hooks", "memories", "multi_agent", "remote_plugin", "goals"]) {
  assert.ok(disabledFeatures.includes(feature), `trusted channel did not disable ${feature}`);
}

const configValues = invocation.args
  .map((value, index) => (value === "--config" ? invocation.args[index + 1] : ""))
  .filter(Boolean);
assert.ok(configValues.includes('approval_policy="never"'));
assert.ok(configValues.includes('web_search="disabled"'));
assert.ok(configValues.includes('model_reasoning_effort="medium"'));
assert.ok(configValues.includes('model_verbosity="low"'));

const lunaInvocation = buildCodexTrustedStructuredInvocation({
  purpose: "tavern-character-agent-behavior-acceptance",
  prompt: "isolated tavern character input",
  tempDirectory,
  schemaPath,
  outputPath,
  model: "gpt-5.6-luna",
  reasoningEffort: "max",
  environment: sanitizedEnvironment,
});
assert.equal(optionValue(lunaInvocation.args, "--model"), "gpt-5.6-luna");
assert.equal(lunaInvocation.model, "gpt-5.6-luna");
assert.equal(lunaInvocation.reasoningEffort, "max");
const lunaConfigValues = lunaInvocation.args
  .map((value, index) => (value === "--config" ? lunaInvocation.args[index + 1] : ""))
  .filter(Boolean);
assert.ok(lunaConfigValues.includes('model_reasoning_effort="max"'));
const lunaHighInvocation = buildCodexTrustedStructuredInvocation({
  purpose: "tavern-character-agent-behavior-acceptance", prompt: "isolated tavern character input",
  tempDirectory, schemaPath, outputPath, model: "gpt-5.6-luna", reasoningEffort: "high",
  environment: sanitizedEnvironment,
});
assert.equal(optionValue(lunaHighInvocation.args, "--model"), "gpt-5.6-luna");
assert.ok(lunaHighInvocation.args.includes('model_reasoning_effort="high"'));

const solHighInvocation = buildCodexTrustedStructuredInvocation({
  purpose: "tavern-character-agent-behavior-acceptance",
  prompt: "isolated tavern character input",
  tempDirectory,
  schemaPath,
  outputPath,
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  environment: sanitizedEnvironment,
});
assert.equal(optionValue(solHighInvocation.args, "--model"), "gpt-5.6-sol");
assert.equal(solHighInvocation.reasoningEffort, "high");
assert.ok(solHighInvocation.args.includes('model_reasoning_effort="high"'));

console.log("codexTrustedBlindProbeChannel:test passed", {
  model: CODEX_TRUSTED_BLIND_PROBE_MODEL,
  toolSurface: "disabled",
  projectEnvironment: "removed",
  authorAcceptanceStillRequired: true,
});
