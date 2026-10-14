/**
 * Structural quality audit for a Character-Agent/world exchange.
 *
 * A failed attempt may be valid story evidence, so this audit does not reject
 * every world refusal. It rejects broken protocol operations that make the
 * visible exchange impossible to continue while a report still claims it is
 * ready for author review.
 */

export const CHARACTER_QUALITY_WORLD_AUDIT_VERSION = "character-quality-world-audit-v1";

const BLOCKING_SHARED_ACTIVITY_CODES = new Set([
  "SHARED_ACTIVITY_RESPONSE_NOT_OWNED",
  "SHARED_ACTIVITY_COORDINATION_NOT_READY",
  "SHARED_ACTIVITY_OPERATION_NOT_EXPRESSED",
  "SHARED_ACTIVITY_NOT_FOUND",
  "SHARED_ACTIVITY_ID_COLLISION",
  "SHARED_ACTIVITY_TARGET_NOT_PARTICIPANT",
  "SHARED_ACTIVITY_PARTICIPANT_NOT_PRESENT",
]);

function clean(value = "") {
  return String(value ?? "").trim();
}

export function auditCharacterAgentWorldContinuity({ actions = [] } = {}) {
  const issues = [];
  for (const action of actions || []) {
    const failureCodes = [...new Set(action?.worldResolution?.failureCodes || [])];
    for (const code of failureCodes) {
      if (!BLOCKING_SHARED_ACTIVITY_CODES.has(code)) continue;
      issues.push({
        code,
        actionId: clean(action?.id),
        actorId: clean(action?.actorId),
        worldStatus: clean(action?.worldResolution?.status),
        message: "共同活动协议在世界结算时断裂，不能进入作者质量评审。",
      });
    }
    const sharedOperation = clean(action?.sharedActivity?.operation);
    if (sharedOperation
      && sharedOperation !== "none"
      && action?.worldResolution?.status === "failed"
      && !failureCodes.some((code) => BLOCKING_SHARED_ACTIVITY_CODES.has(code))) {
      issues.push({
        code: "SHARED_ACTIVITY_WORLD_ATTEMPT_FAILED",
        actionId: clean(action?.id),
        actorId: clean(action?.actorId),
        worldStatus: "failed",
        message: "共同活动对应的世界动作完全失败，需先审计因果链。",
      });
    }
  }
  return {
    schemaVersion: CHARACTER_QUALITY_WORLD_AUDIT_VERSION,
    valid: issues.length === 0,
    issues,
  };
}
