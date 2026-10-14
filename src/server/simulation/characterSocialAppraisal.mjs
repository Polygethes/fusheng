/**
 * Character-owned appraisal of objective social facts.
 *
 * The world may expose claims, requests, witnesses, grants and enforcement
 * history. Only the Character Agent may decide what those facts mean to this
 * person. This module is a private numerical instrument: it neither creates
 * candidates nor selects an action.
 */

export const CHARACTER_SOCIAL_APPRAISAL_VERSION = "character-social-appraisal-v1";

const WORLD_FORBIDDEN_KEYS = new Set([
  "normPressure",
  "venueNormPressure",
  "dutyConflict",
  "responsibilityPull",
  "shouldRespond",
  "selectedAction",
  "selectedCandidateId",
  "chosenAction",
]);

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").trim();
}

function unit(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function round(value, digits = 4) {
  const scale = 10 ** digits;
  return Math.round(Number(value || 0) * scale) / scale;
}

function unique(values = []) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function assertObjectiveFact(value, path = "socialFact") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`SOCIAL_FACT_OBJECT_REQUIRED:${path}`);
  }
  for (const key of Object.keys(value)) {
    if (WORLD_FORBIDDEN_KEYS.has(key)) {
      throw new Error(`SOCIAL_FACT_PSYCHOLOGICAL_FIELD_FORBIDDEN:${path}.${key}`);
    }
  }
}

export function normalizeObjectiveSocialFacts(facts = []) {
  const rows = [];
  const ids = new Set();
  for (const [index, source] of (facts || []).entries()) {
    assertObjectiveFact(source, `socialFacts[${index}]`);
    const factId = clean(source.factId || source.id);
    const kind = clean(source.kind || source.type);
    if (!factId || !kind) throw new Error(`SOCIAL_FACT_ID_AND_KIND_REQUIRED:${index}`);
    if (ids.has(factId)) throw new Error(`SOCIAL_FACT_ID_DUPLICATE:${factId}`);
    ids.add(factId);
    rows.push({
      ...clone(source),
      factId,
      kind,
      actorId: clean(source.actorId),
      claimantId: clean(source.claimantId),
      subjectId: clean(source.subjectId),
      entityId: clean(source.entityId),
      topic: clean(source.topic),
      addresseeIds: unique(source.addresseeIds || []),
      affectedActorIds: unique(source.affectedActorIds || []),
      sourceEvidenceIds: unique(source.sourceEvidenceIds || []),
      occurredAtSeconds: Number.isFinite(Number(source.occurredAtSeconds))
        ? Number(source.occurredAtSeconds)
        : null,
      authority: "objective-social-evidence-only",
    });
  }
  return rows;
}

function appraisalByFact(beliefAppraisals = []) {
  return new Map((beliefAppraisals || []).flatMap((source) => {
    const factId = clean(source?.factId);
    return factId ? [[factId, clone(source)]] : [];
  }));
}

export function computeCharacterSocialAppraisal({
  characterId = "",
  socialFacts = [],
  beliefAppraisals = [],
  characterParameters = {},
  candidateSocialImplications = {},
} = {}) {
  const facts = normalizeObjectiveSocialFacts(socialFacts);
  const factsById = new Map(facts.map((fact) => [fact.factId, fact]));
  const beliefs = appraisalByFact(beliefAppraisals);
  const violatesFactIds = unique(candidateSocialImplications.violatesFactIds || []);
  const respondsToFactIds = unique(candidateSocialImplications.respondsToFactIds || []);
  const supportsFactIds = unique(candidateSocialImplications.supportsFactIds || []);
  const implicatedIds = unique([...violatesFactIds, ...respondsToFactIds, ...supportsFactIds]);
  const lossSensitivity = unit(characterParameters.lossSensitivity, 0.5);
  const conscientiousness = unit(characterParameters.conscientiousness, 0.5);
  const observerExposure = unit(candidateSocialImplications.observerExposure);
  const exposureMultiplier = 0.5 + observerExposure * 0.5;
  const factorLedger = [];

  for (const factId of implicatedIds) {
    const fact = factsById.get(factId);
    if (!fact) continue;
    const belief = beliefs.get(factId) || {};
    const confidence = unit(belief.confidence);
    const violation = violatesFactIds.includes(factId);
    const response = respondsToFactIds.includes(factId);
    const support = supportsFactIds.includes(factId);
    const internalization = unit(belief.internalization);
    const expectedSanction = unit(belief.expectedSanction);
    const identityConflict = unit(belief.identityConflict);
    const expectedRelationshipCost = unit(belief.expectedRelationshipCost);
    const responsibilityAcceptance = unit(belief.responsibilityAcceptance);
    const identityCommitment = unit(belief.identityCommitment);
    const relationshipCare = unit(belief.relationshipCare);

    const normContribution = violation
      ? confidence * exposureMultiplier * (
        internalization * 0.35
        + expectedSanction * lossSensitivity * 0.25
        + identityConflict * 0.2
        + expectedRelationshipCost * 0.2
      )
      : 0;
    const responsibilityContribution = response
      ? confidence * (
        responsibilityAcceptance * 0.45
        + identityCommitment * 0.25
        + relationshipCare * 0.15
        + conscientiousness * 0.15
      )
      : 0;
    const supportContribution = support
      ? confidence * (internalization * 0.45 + identityCommitment * 0.35 + relationshipCare * 0.2)
      : 0;

    factorLedger.push({
      factId,
      factKind: fact.kind,
      confidence: round(confidence),
      implication: violation ? "violate" : response ? "respond" : "support",
      normContribution: round(normContribution),
      responsibilityContribution: round(responsibilityContribution),
      supportContribution: round(supportContribution),
      sourceEvidenceIds: [...fact.sourceEvidenceIds],
      interpretationAuthority: "character-agent",
    });
  }

  const sum = (key) => factorLedger.reduce((total, row) => total + Number(row[key] || 0), 0);
  return {
    schemaVersion: CHARACTER_SOCIAL_APPRAISAL_VERSION,
    authority: "character-private-mathematical-instrument",
    characterId: clean(characterId),
    normPressure: round(Math.min(1, sum("normContribution"))),
    responsibilityPull: round(Math.min(1, sum("responsibilityContribution"))),
    socialSupport: round(Math.min(1, sum("supportContribution"))),
    factorLedger,
    selection: {
      authority: "character-agent",
      selectedCandidateId: null,
      rule: "numbers inform one character; they do not choose or prescribe an action",
    },
  };
}
