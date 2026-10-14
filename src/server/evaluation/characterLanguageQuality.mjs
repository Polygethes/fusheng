import { createHash } from "node:crypto";

/**
 * Observer-only language regression diagnostics.
 *
 * This module deliberately has no runtime authority: it never rejects,
 * rewrites, ranks or selects a Character Agent utterance. It only describes
 * observable risks for later author review.
 */
export const CHARACTER_LANGUAGE_QUALITY_VERSION = "character-language-quality-observer-v2";

const DEFAULT_BACKEND_CLASSIFICATIONS = Object.freeze([
  "activationEvidenceIds",
  "cue_gated",
  "direct_contact",
  "factorLedger",
  "motiveSourceIds",
  "privateReason",
  "releasedMeaning",
  "selectedCandidateId",
  "speechHabitSurface",
  "terminalExperiencePreserved",
  "threadDisposition",
]);

const INTERNAL_IDENTIFIER_PATTERN = /(?:agent-turn|affordance|belief|candidate|desire|evidence|habit|impact|memory|private|psychology|thread)(?::|_id\s*[:=])[-a-z0-9_:.\/]+/giu;

function clean(value = "") {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function safeRef(value = "", fallback = "sample") {
  return clean(value).slice(0, 160) || fallback;
}

function fingerprint(value = "") {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 16);
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => clean(value))
    .filter(Boolean))];
}

function publicSurface(sample = {}) {
  return {
    utterance: clean(sample.utterance ?? sample.speech),
    visibleAction: clean(sample.visibleAction),
    affectiveTexture: (Array.isArray(sample.affectiveTexture) ? sample.affectiveTexture : [])
      .map((row) => clean(typeof row === "string" ? row : row?.feature))
      .filter(Boolean)
      .join("；"),
  };
}

function normalizedComparableText(value = "") {
  return clean(value)
    .toLocaleLowerCase("zh-CN")
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function levenshteinDistance(left = "", right = "") {
  const a = [...left];
  const b = [...right];
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 0; i < a.length; i += 1) {
    const current = [i + 1];
    for (let j = 0; j < b.length; j += 1) {
      current.push(Math.min(
        current[j] + 1,
        previous[j + 1] + 1,
        previous[j] + (a[i] === b[j] ? 0 : 1),
      ));
    }
    previous = current;
  }
  return previous[b.length];
}

function bigrams(value = "") {
  const chars = [...value];
  if (chars.length < 2) return chars;
  return chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`);
}

function diceSimilarity(left = "", right = "") {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.length || !b.length) return left === right && Boolean(left) ? 1 : 0;
  const remaining = new Map();
  for (const token of b) remaining.set(token, Number(remaining.get(token) || 0) + 1);
  let overlap = 0;
  for (const token of a) {
    const count = Number(remaining.get(token) || 0);
    if (count <= 0) continue;
    overlap += 1;
    remaining.set(token, count - 1);
  }
  return (2 * overlap) / (a.length + b.length);
}

export function observableLanguageSimilarity(left = "", right = "") {
  const a = normalizedComparableText(left);
  const b = normalizedComparableText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const editSimilarity = 1 - (levenshteinDistance(a, b) / Math.max([...a].length, [...b].length));
  return Number(Math.max(editSimilarity, diceSimilarity(a, b)).toFixed(4));
}

function diagnostic({
  code,
  sampleId = "",
  relatedSampleId = "",
  pairId = "",
  channel = "",
  severity = "author_review",
  details = {},
} = {}) {
  return {
    code: clean(code),
    severity,
    ...(sampleId ? { sampleId: safeRef(sampleId) } : {}),
    ...(relatedSampleId ? { relatedSampleId: safeRef(relatedSampleId) } : {}),
    ...(pairId ? { pairId: safeRef(pairId, "pair") } : {}),
    ...(channel ? { channel: clean(channel) } : {}),
    details,
  };
}

function leakageDiagnostics(sample = {}, {
  privateIdentifiers = [],
  backendClassifications = [],
} = {}) {
  const sampleId = safeRef(sample.sampleId);
  const surfaces = publicSurface(sample);
  const rows = [];
  const seen = new Set();
  const record = (code, channel, matched, source) => {
    const tokenFingerprint = fingerprint(matched);
    const key = `${code}:${channel}:${tokenFingerprint}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(diagnostic({
      code,
      sampleId,
      channel,
      severity: code === "PRIVATE_IDENTIFIER_EXPOSED" ? "privacy_review" : "author_review",
      details: {
        source,
        tokenFingerprint,
        tokenLength: [...String(matched)].length,
      },
    }));
  };

  for (const [channel, text] of Object.entries(surfaces)) {
    if (!text) continue;
    const lower = text.toLocaleLowerCase("zh-CN");
    for (const term of unique([...DEFAULT_BACKEND_CLASSIFICATIONS, ...backendClassifications])) {
      if (lower.includes(term.toLocaleLowerCase("zh-CN"))) {
        record("BACKEND_CLASSIFICATION_EXPOSED", channel, term, "configured_or_default_backend_term");
      }
    }
    for (const privateId of unique(privateIdentifiers)) {
      if (text.includes(privateId)) {
        record("PRIVATE_IDENTIFIER_EXPOSED", channel, privateId, "explicit_private_identifier");
      }
    }
    for (const match of text.matchAll(INTERNAL_IDENTIFIER_PATTERN)) {
      record("PRIVATE_IDENTIFIER_EXPOSED", channel, match[0], "internal_identifier_shape");
    }
  }
  return rows;
}

function repetitionMotivationRecorded(sample = {}) {
  const marker = sample.repetitionMotivation;
  if (marker === true) return true;
  if (typeof marker === "string") return Boolean(clean(marker));
  return Boolean(marker && typeof marker === "object" && (
    marker.intentional === true || clean(marker.basisCode || marker.publicBasis)
  ));
}

function nearRepetitionDiagnostics(samples = [], threshold = 0.86) {
  const groups = new Map();
  for (const sample of samples) {
    const conversationId = clean(sample.conversationId);
    const characterId = clean(sample.characterId);
    const utterance = publicSurface(sample).utterance;
    if (!conversationId || !characterId || !utterance) continue;
    const key = `${conversationId}\0${characterId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sample);
  }
  const rows = [];
  for (const group of groups.values()) {
    group.sort((left, right) => Number(left.turnIndex || 0) - Number(right.turnIndex || 0));
    for (let index = 1; index < group.length; index += 1) {
      const current = group[index];
      if (repetitionMotivationRecorded(current)) continue;
      const currentText = publicSurface(current).utterance;
      const priorWindow = group.slice(Math.max(0, index - 4), index);
      let nearest = null;
      for (const prior of priorWindow) {
        const similarity = observableLanguageSimilarity(publicSurface(prior).utterance, currentText);
        if (!nearest || similarity > nearest.similarity) nearest = { prior, similarity };
      }
      if (!nearest || nearest.similarity < threshold) continue;
      rows.push(diagnostic({
        code: "UNMOTIVATED_NEAR_REPETITION",
        sampleId: current.sampleId,
        relatedSampleId: nearest.prior.sampleId,
        channel: "utterance",
        details: {
          similarity: nearest.similarity,
          threshold,
          comparedWithinPriorSameSpeakerTurns: priorWindow.length,
          motivationRecorded: false,
        },
      }));
    }
  }
  return rows;
}

function crossSceneRepetitionDiagnostics(samples = [], threshold = 0.9) {
  const groups = new Map();
  const conversationOrder = new Map();
  for (const sample of samples) {
    const conversationId = clean(sample.conversationId);
    const characterId = clean(sample.characterId);
    const utterance = publicSurface(sample).utterance;
    if (!conversationId || !characterId || !utterance) continue;
    if (!conversationOrder.has(conversationId)) {
      conversationOrder.set(conversationId, conversationOrder.size);
    }
    const key = characterId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sample);
  }
  const rows = [];
  for (const [characterId, group] of groups.entries()) {
    const byConversation = new Map();
    for (const sample of group) {
      const conversationId = clean(sample.conversationId);
      if (!byConversation.has(conversationId)) byConversation.set(conversationId, []);
      byConversation.get(conversationId).push(sample);
    }
    const conversations = [...byConversation.entries()]
      .sort((left, right) => (
        Number(left[1][0]?.sceneIndex ?? conversationOrder.get(left[0]) ?? 0)
        - Number(right[1][0]?.sceneIndex ?? conversationOrder.get(right[0]) ?? 0)
      ));
    const priorUtterances = [];
    for (const [conversationId, turns] of conversations) {
      const sortedTurns = turns.slice().sort((left, right) => Number(left.turnIndex || 0) - Number(right.turnIndex || 0));
      for (const current of sortedTurns) {
        if (repetitionMotivationRecorded(current)) continue;
        const currentText = publicSurface(current).utterance;
        let nearest = null;
        for (const prior of priorUtterances.slice(-6)) {
          const similarity = observableLanguageSimilarity(prior.utterance, currentText);
          if (!nearest || similarity > nearest.similarity) {
            nearest = { prior, similarity };
          }
        }
        if (nearest && nearest.similarity >= threshold) {
          rows.push(diagnostic({
            code: "CROSS_SCENE_UNMOTIVATED_REPETITION",
            sampleId: current.sampleId,
            relatedSampleId: nearest.prior.sampleId,
            channel: "utterance",
            details: {
              similarity: nearest.similarity,
              threshold,
              characterId,
              currentConversationId: conversationId,
              priorConversationId: nearest.prior.conversationId,
              motivationRecorded: false,
            },
          }));
        }
      }
      for (const turn of sortedTurns) {
        const utterance = publicSurface(turn).utterance;
        if (utterance) priorUtterances.push({ utterance, conversationId, sampleId: turn.sampleId });
      }
    }
  }
  return rows;
}

function attributionDiagnostics(samples = []) {
  const rows = [];
  let attributed = 0;
  let actionable = 0;
  const unattributedSampleIds = [];
  for (const sample of samples) {
    const attribution = sample.attribution || null;
    if (!attribution) continue;
    const hasVisibleAction = Boolean(publicSurface(sample).visibleAction);
    if (!hasVisibleAction) continue;
    actionable += 1;
    const references = [
      ...(Array.isArray(attribution.desireIds) ? attribution.desireIds : []),
      ...(Array.isArray(attribution.memoryIds) ? attribution.memoryIds : []),
      ...(Array.isArray(attribution.beliefIds) ? attribution.beliefIds : []),
      ...(Array.isArray(attribution.cueIds) ? attribution.cueIds : []),
      ...(Array.isArray(attribution.relationshipStateIds) ? attribution.relationshipStateIds : []),
    ].map((value) => clean(value)).filter(Boolean);
    if (references.length) {
      attributed += 1;
      continue;
    }
    unattributedSampleIds.push(safeRef(sample.sampleId));
    rows.push(diagnostic({
      code: "VISIBLE_ACTION_UNATTRIBUTED",
      sampleId: sample.sampleId,
      channel: "visibleAction",
      details: {
        characterId: clean(sample.characterId),
        conversationId: clean(sample.conversationId),
        attributionKeys: Object.keys(attribution),
      },
    }));
  }
  return {
    rows,
    summary: {
      actionableActions: actionable,
      attributedActions: attributed,
      coverage: actionable ? Number((attributed / actionable).toFixed(4)) : 1,
      unattributedSampleIds,
    },
  };
}

function sampleIndex(samples = []) {
  return new Map(samples.map((sample, index) => [safeRef(sample.sampleId, `sample-${index + 1}`), sample]));
}

function pairDiagnosticReport(pair = {}, samplesById = new Map(), threshold = 0.55) {
  const pairId = safeRef(pair.pairId, "pair");
  const baselineSampleId = safeRef(pair.baselineSampleId, "baseline");
  const variantSampleId = safeRef(pair.variantSampleId, "variant");
  const baseline = samplesById.get(baselineSampleId) || null;
  const variant = samplesById.get(variantSampleId) || null;
  if (!baseline || !variant) {
    return {
      pairId,
      kind: clean(pair.kind || "comparison"),
      baselineSampleId,
      variantSampleId,
      changedInput: { kind: clean(pair.changedInput?.kind), itemCount: 0, fingerprint: "" },
      comparison: null,
      diagnostics: [diagnostic({
        code: "LANGUAGE_PAIR_SAMPLE_MISSING",
        pairId,
        details: { baselineFound: Boolean(baseline), variantFound: Boolean(variant) },
      })],
    };
  }

  const baselineSurface = publicSurface(baseline);
  const variantSurface = publicSurface(variant);
  const inputItems = unique(pair.changedInput?.itemIds || pair.irrelevantAffordanceIds || []);
  const changedInput = {
    kind: clean(pair.changedInput?.kind || pair.kind),
    itemCount: inputItems.length,
    fingerprint: inputItems.length ? fingerprint(inputItems.slice().sort().join("\0")) : "",
  };
  const comparison = {
    utteranceSimilarity: observableLanguageSimilarity(baselineSurface.utterance, variantSurface.utterance),
    visibleActionSimilarity: observableLanguageSimilarity(baselineSurface.visibleAction, variantSurface.visibleAction),
    speechPresenceChanged: Boolean(baselineSurface.utterance) !== Boolean(variantSurface.utterance),
    publicMoveChanged: clean(baseline.publicMove) !== clean(variant.publicMove),
    speechActChanged: clean(baseline.speechAct) !== clean(variant.speechAct),
    targetChanged: clean(baseline.publicTargetRef) !== clean(variant.publicTargetRef),
  };
  const pairDiagnostics = [];
  if (clean(pair.kind) === "irrelevant_affordance_enumeration") {
    const structuralDivergence = comparison.speechPresenceChanged
      || comparison.publicMoveChanged
      || comparison.speechActChanged
      || comparison.targetChanged;
    const surfaceDivergence = Boolean(baselineSurface.utterance && variantSurface.utterance)
      && comparison.utteranceSimilarity < threshold;
    if (structuralDivergence || surfaceDivergence) {
      pairDiagnostics.push(diagnostic({
        code: "IRRELEVANT_AFFORDANCE_PAIR_DIVERGED",
        pairId,
        details: {
          structuralDivergence,
          surfaceDivergence,
          utteranceSimilarity: comparison.utteranceSimilarity,
          reviewThreshold: threshold,
        },
      }));
    }
  }
  return {
    pairId,
    kind: clean(pair.kind || "comparison"),
    baselineSampleId,
    variantSampleId,
    changedInput,
    comparison,
    diagnostics: pairDiagnostics,
  };
}

export function buildCharacterLanguageQualityReport({
  samples = [],
  pairs = [],
  privateIdentifiers = [],
  backendClassifications = [],
  thresholds = {},
} = {}) {
  const safeSamples = Array.isArray(samples) ? samples : [];
  const repetitionThreshold = Number.isFinite(Number(thresholds.nearRepetition))
    ? Math.max(0, Math.min(1, Number(thresholds.nearRepetition)))
    : 0.86;
  const crossSceneThreshold = Number.isFinite(Number(thresholds.crossSceneRepetition))
    ? Math.max(0, Math.min(1, Number(thresholds.crossSceneRepetition)))
    : 0.9;
  const affordancePairThreshold = Number.isFinite(Number(thresholds.affordancePairSimilarity))
    ? Math.max(0, Math.min(1, Number(thresholds.affordancePairSimilarity)))
    : 0.55;
  const attribution = attributionDiagnostics(safeSamples);
  const diagnostics = [
    ...safeSamples.flatMap((sample) => leakageDiagnostics(sample, {
      privateIdentifiers,
      backendClassifications,
    })),
    ...nearRepetitionDiagnostics(safeSamples, repetitionThreshold),
    ...crossSceneRepetitionDiagnostics(safeSamples, crossSceneThreshold),
    ...attribution.rows,
  ];
  const pairsBySample = sampleIndex(safeSamples);
  const pairReports = (Array.isArray(pairs) ? pairs : [])
    .map((pair) => pairDiagnosticReport(pair, pairsBySample, affordancePairThreshold));
  diagnostics.push(...pairReports.flatMap((pair) => pair.diagnostics));
  const countsByCode = diagnostics.reduce((counts, row) => {
    counts[row.code] = Number(counts[row.code] || 0) + 1;
    return counts;
  }, {});

  return {
    schemaVersion: CHARACTER_LANGUAGE_QUALITY_VERSION,
    authority: "observer-only-language-regression-never-runtime-authority",
    status: "author_review_required",
    authorAcceptance: "pending",
    boundary: {
      mayRejectCharacterSpeech: false,
      mayRewriteCharacterSpeech: false,
      maySelectCharacterAction: false,
      mayMutateCharacterOrWorldState: false,
      diagnosticsOnly: true,
    },
    counts: {
      samples: safeSamples.length,
      pairs: pairReports.length,
      diagnostics: diagnostics.length,
      byCode: countsByCode,
    },
    attribution: attribution.summary,
    diagnostics,
    pairReports,
  };
}

