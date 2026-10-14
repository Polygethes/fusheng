import { runCharacterFoundationBlindProbeWithCodex } from "../src/server/ecology/codexTrustedBlindProbeChannel.mjs";
import { buildZhouMinConsequentialChoiceProbeInput } from "./fixtures/zhouMinConsequentialChoiceProbeFixture.mjs";

const input = buildZhouMinConsequentialChoiceProbeInput();

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
    code: error?.code || "ZHOU_MIN_CONSEQUENTIAL_CHOICE_PROBE_FAILED",
    message: error?.message || String(error),
    issues: error?.issues || [],
    rejectedProjection: error?.decision || null,
    model: error?.meta?.model || "",
    channel: error?.meta?.channel || "openai-codex-chatgpt",
  }, null, 2));
  process.exitCode = 1;
}
