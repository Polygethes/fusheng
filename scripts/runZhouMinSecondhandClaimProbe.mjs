import { runCharacterFoundationBlindProbe } from "../src/server/ecology/characterFoundationBlindProbe.mjs";
import { buildZhouMinSecondhandClaimProbeInput } from "./fixtures/zhouMinSecondhandClaimProbeFixture.mjs";

const input = buildZhouMinSecondhandClaimProbeInput();

try {
  const result = await runCharacterFoundationBlindProbe(input);
  console.log(JSON.stringify({
    probeId: result.probeId,
    characterId: result.characterId,
    model: result.meta?.model || "",
    provider: result.meta?.provider || "",
    elapsedMs: result.meta?.elapsedMs || 0,
    inputAuditPassed: result.audit.valid,
    decisionBoundaryPassed: result.decisionValidation.valid,
    authorAcceptance: result.authorAcceptance,
    projection: result.decision,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    code: error?.code || "ZHOU_MIN_BLIND_PROBE_FAILED",
    message: error?.message || String(error),
    issues: error?.issues || [],
    rejectedProjection: error?.decision || null,
    model: error?.meta?.model || "",
  }, null, 2));
  process.exitCode = 1;
}
