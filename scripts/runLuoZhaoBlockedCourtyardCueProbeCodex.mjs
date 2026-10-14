import { runCharacterFoundationBlindProbeWithCodex } from "../src/server/ecology/codexTrustedBlindProbeChannel.mjs";
import { buildLuoZhaoBlockedCourtyardCueProbeInput } from "./fixtures/luoZhaoBlockedCourtyardCueProbeFixture.mjs";

const input = buildLuoZhaoBlockedCourtyardCueProbeInput();

try {
  const result = await runCharacterFoundationBlindProbeWithCodex(input);
  console.log(JSON.stringify({
    probeId: result.probeId,
    characterId: result.characterId,
    model: result.meta?.model || "",
    provider: result.meta?.provider || "",
    channel: result.meta?.channel || "",
    authentication: result.meta?.authentication || "",
    isolation: result.meta?.isolation || "",
    elapsedMs: result.meta?.elapsedMs || 0,
    inputAuditPassed: result.audit.valid,
    decisionBoundaryPassed: result.decisionValidation.valid,
    authorAcceptance: result.authorAcceptance,
    projection: result.decision,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    code: error?.code || "LUO_ZHAO_BLOCKED_COURTYARD_CUE_PROBE_FAILED",
    message: error?.message || String(error),
    issues: error?.issues || [],
    rejectedProjection: error?.decision || null,
    model: error?.meta?.model || "",
    provider: error?.meta?.provider || "",
    channel: error?.meta?.channel || "openai-codex-chatgpt",
    authentication: error?.meta?.authentication || "",
    isolation: error?.meta?.isolation || "",
    elapsedMs: error?.meta?.elapsedMs || 0,
    exitCode: error?.exitCode ?? null,
    terminationSignal: error?.terminationSignal || "",
    stdout: error?.stdout || "",
    stderr: error?.stderr || "",
  }, null, 2));
  process.exitCode = 1;
}
