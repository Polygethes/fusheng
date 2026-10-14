/**
 * Generic responsibility classification and relevance.
 *
 * The simulation kernel does not know what a door, alarm, patient, guest, or
 * workbench means. A scene adapter declares observable rules and capability
 * tags; this module only matches structured facts against those rules.
 */

function clean(value = "") {
  return String(value ?? "").trim();
}

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalize01(value, fallback = 0) {
  const numeric = finite(value, fallback);
  return Math.max(0, Math.min(1, Math.abs(numeric) > 1 ? numeric / 100 : numeric));
}

function unique(values = []) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function valuesMatch(allowed = [], actual = "") {
  const rows = unique(allowed);
  return rows.length === 0 || rows.includes(clean(actual));
}

function prefixesMatch(prefixes = [], actual = "") {
  const rows = unique(prefixes);
  return rows.length === 0 || rows.some((prefix) => clean(actual).startsWith(prefix));
}

function tokenConstraintsMatch(rule = {}, impact = {}) {
  const haystack = clean([
    impact.topic,
    impact.content,
    impact.surfaceEvent,
  ].filter(Boolean).join(" "));
  const anyTokens = unique(rule.anyTokens || rule.anyTextTokens);
  const allTokens = unique(rule.allTokens || rule.allTextTokens);
  if (anyTokens.length && !anyTokens.some((token) => haystack.includes(token))) return false;
  if (allTokens.length && !allTokens.every((token) => haystack.includes(token))) return false;
  return true;
}

export function responsibilityRuleMatches(impact = {}, rule = {}) {
  if (!clean(rule.tag || rule.responsibilityTag)) return false;
  if (!prefixesMatch(rule.sourceActorPrefixes, impact.sourceActorId || impact.sourceCharacterId)) return false;
  if (!valuesMatch(rule.sourceActorIds, impact.sourceActorId || impact.sourceCharacterId)) return false;
  if (!valuesMatch(rule.eventKinds || rule.publicEventKinds, impact.publicEventKind || impact.eventKind)) return false;
  if (!valuesMatch(rule.impactTypes, impact.type)) return false;
  if (!valuesMatch(rule.modalities, impact.modality)) return false;
  if (!tokenConstraintsMatch(rule, impact)) return false;

  const hasConstraint = [
    rule.sourceActorPrefixes,
    rule.sourceActorIds,
    rule.eventKinds,
    rule.publicEventKinds,
    rule.impactTypes,
    rule.modalities,
    rule.anyTokens,
    rule.anyTextTokens,
    rule.allTokens,
    rule.allTextTokens,
  ].some((value) => Array.isArray(value) && value.length > 0);
  return hasConstraint;
}

export function compileResponsibilityTags({ impact = {}, rules = [] } = {}) {
  const explicit = unique(impact.responsibilityTags);
  const inferred = (rules || [])
    .filter((rule) => responsibilityRuleMatches(impact, rule))
    .map((rule) => clean(rule.tag || rule.responsibilityTag));
  return unique([...explicit, ...inferred]);
}

export function responsibilityRelevance({
  responsibilityTags = [],
  capabilities = {},
  priority = 0,
  base = 0.35,
  range = 0.65,
} = {}) {
  const matchedTags = unique(responsibilityTags).filter((tag) => {
    const capability = capabilities?.[tag];
    return capability === true || finite(capability) > 0;
  });
  if (!matchedTags.length) return { matched: false, matchedTags: [], score: 0 };
  const capabilityStrength = Math.max(...matchedTags.map((tag) => (
    capabilities[tag] === true ? 1 : normalize01(capabilities[tag])
  )));
  const score = Math.max(0, Math.min(1, finite(base) + normalize01(priority) * finite(range)))
    * capabilityStrength;
  return { matched: true, matchedTags, score };
}
