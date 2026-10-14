/**
 * Generic observer-relative perception.
 *
 * The world supplies physical signal surfaces. This module is a private tool
 * inside a Character Agent: it models reception, automatic salience and
 * competence-limited decoding. It never identifies a canonical person, changes
 * world state or selects a public action.
 */

export const CHARACTER_PERCEPTION_FORMULA_VERSION = "character-perception-v1";

const MODALITIES = Object.freeze(["visual", "sound", "smell", "touch", "vibration", "proprioception"]);

const DEFAULT_CHANNELS = Object.freeze({
  visual: Object.freeze({ availability: 1, acuity: 0.62, motionSensitivity: 0.55, lowLightTolerance: 0.18 }),
  sound: Object.freeze({ availability: 1, acuity: 0.62, rhythmResolution: 0.5, sourceLocalization: 0.5 }),
  smell: Object.freeze({ availability: 1, acuity: 0.45 }),
  touch: Object.freeze({ availability: 1, acuity: 0.65 }),
  vibration: Object.freeze({ availability: 0.35, acuity: 0.35 }),
  proprioception: Object.freeze({ availability: 1, acuity: 0.7 }),
});

const DEFAULT_ATTENTION = Object.freeze({
  baselineBudget: 4,
  sensitivityThreshold: 0.22,
  distractibility: 0.35,
  overloadSensitivity: 0.5,
  orientingBiases: Object.freeze({}),
});

const DEFAULT_INFORMATION_STYLE = Object.freeze({
  directInquiry: 0.5,
  concealmentNeed: 0.5,
  patience: 0.5,
  verificationThreshold: 0.62,
  socialRiskSensitivity: 0.5,
  reactionReadingConfidence: 0.5,
});

const WORLD_SIGNAL_FORBIDDEN_KEYS = Object.freeze([
  "canonicalLabel",
  "hiddenIntent",
  "recognizedIdentity",
  "relationshipMeaning",
  "skillLevel",
  "worldConclusion",
]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, finite(value)));
}

function unit(value, fallback = 0) {
  let number = finite(value, fallback);
  if (Math.abs(number) > 1 && Math.abs(number) <= 100) number /= 100;
  return clamp(number);
}

function clean(value = "", limit = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function unique(values = []) {
  return [...new Set((values || []).map((value) => clean(value, 120)).filter(Boolean))];
}

/**
 * Turn a received physical surface into what this observer can actually report.
 *
 * Fidelity and ambiguity are not decorative telemetry.  Once vision is too
 * uncertain, exact narrator prose must stop crossing the perception boundary.
 * Literal sound is intentionally preserved here: mishearing needs a separate
 * phonetic model instead of silently rewriting somebody's spoken words.
 */
export function projectNoticedPhysicalFeature({
  physicalFeature = "",
  modality = "visual",
  domainTags = [],
  fidelity = 1,
  ambiguity = 0,
} = {}) {
  const original = clean(physicalFeature, 500);
  const normalizedModality = clean(modality, 40);
  const tags = new Set(unique(domainTags || []));
  const lowFidelity = unit(fidelity, 1) < 0.36 || unit(ambiguity) > 0.72;
  if (!original || normalizedModality === "sound" || !lowFidelity) return original;
  if (tags.has("action:observe") || tags.has("observe")) {
    return tags.has("directed")
      ? "对方似乎在留意你，但你没有看清目光具体落在哪里，也无法仅凭这一眼确定用意。"
      : "对方似乎在留意现场某处，但你没有看清具体落点，也无法确定用意。";
  }
  if (normalizedModality === "visual") return "你捕捉到对方有一个动作，但没有看清细节。";
  return "你察觉到现场有一点变化，但无法分辨具体细节。";
}

function signalIssue(code, path, message) {
  return { code, path, message };
}

export function normalizeWorldSignalFeature(input = {}) {
  const modality = MODALITIES.includes(clean(input.modality, 40)) ? clean(input.modality, 40) : "";
  return {
    schemaVersion: 1,
    signalId: clean(input.signalId, 180),
    sourceEntityId: clean(input.sourceEntityId, 180),
    sourceZoneId: clean(input.sourceZoneId, 180),
    modality,
    featureId: clean(input.featureId, 180),
    physicalFeature: clean(input.physicalFeature, 500),
    domainTags: unique(input.domainTags || []),
    intensity: unit(input.intensity, 0.5),
    durationSeconds: Math.max(0, finite(input.durationSeconds)),
    transmissionFactor: unit(input.transmissionFactor, 1),
    noiseResistance: unit(input.noiseResistance, 0.15),
    transmission: {
      factor: unit(input.transmission?.factor, 1),
      distanceLoss: unit(input.transmission?.distanceLoss),
      barrierLoss: unit(input.transmission?.barrierLoss),
      occlusion: unit(input.transmission?.occlusion),
      ...(input.transmission && Object.hasOwn(input.transmission, "light")
        ? { light: unit(input.transmission.light) }
        : {}),
      ...(input.transmission && Object.hasOwn(input.transmission, "ambientNoise")
        ? { ambientNoise: unit(input.transmission.ambientNoise) }
        : {}),
    },
    occurredAtSeconds: Math.max(0, finite(input.occurredAtSeconds)),
  };
}

export function validateWorldSignalFeature(candidate = {}) {
  const errors = [];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { valid: false, errors: [signalIssue("WORLD_SIGNAL_NOT_OBJECT", "signal", "世界信号必须是对象")] };
  }
  if (!clean(candidate.signalId, 180)) errors.push(signalIssue("WORLD_SIGNAL_ID_MISSING", "signalId", "世界信号缺少稳定 id"));
  if (!MODALITIES.includes(clean(candidate.modality, 40))) {
    errors.push(signalIssue("WORLD_SIGNAL_MODALITY_INVALID", "modality", "世界信号必须声明受支持的感官模态"));
  }
  if (!clean(candidate.featureId, 180) || !clean(candidate.physicalFeature, 500)) {
    errors.push(signalIssue("WORLD_SIGNAL_FEATURE_MISSING", "physicalFeature", "世界信号必须描述可传播的物理表面"));
  }
  const rawIntensity = Number(candidate.intensity);
  if (!Number.isFinite(rawIntensity) || rawIntensity < 0 || rawIntensity > 1) {
    errors.push(signalIssue("WORLD_SIGNAL_INTENSITY_INVALID", "intensity", "规范化世界信号强度必须在 0 到 1 之间"));
  }
  for (const key of WORLD_SIGNAL_FORBIDDEN_KEYS) {
    if (Object.hasOwn(candidate, key)) {
      errors.push(signalIssue(
        "WORLD_SIGNAL_HIDDEN_SEMANTIC_LEAK",
        key,
        `世界信号不能直接携带 ${key} 这类身份、内心、关系或能力结论`,
      ));
    }
  }
  return { valid: errors.length === 0, errors };
}

export function projectWorldSignalForObserver(signalInput = {}, { sourceEntityHandle = "" } = {}) {
  const report = validateWorldSignalFeature(signalInput);
  if (!report.valid) {
    const error = new TypeError(report.errors.map((row) => `${row.code}@${row.path}: ${row.message}`).join("\n"));
    error.code = "INVALID_WORLD_SIGNAL_FEATURE";
    error.issues = report.errors;
    throw error;
  }
  const signal = normalizeWorldSignalFeature(signalInput);
  return {
    schemaVersion: 1,
    signalId: signal.signalId,
    sourceEntityHandle: clean(sourceEntityHandle, 180),
    sourceZoneId: signal.sourceZoneId,
    modality: signal.modality,
    featureId: signal.featureId,
    physicalFeature: signal.physicalFeature,
    domainTags: [...signal.domainTags],
    intensity: signal.intensity,
    durationSeconds: signal.durationSeconds,
    transmissionFactor: signal.transmissionFactor,
    noiseResistance: signal.noiseResistance,
    transmission: { ...signal.transmission },
    occurredAtSeconds: signal.occurredAtSeconds,
  };
}

function midpoint(value, fallback = 0.35) {
  if (Array.isArray(value) && value.length === 2) return unit((finite(value[0]) + finite(value[1])) / 2, fallback);
  return unit(value, fallback);
}

function midpointSigned(value, fallback = 0) {
  const numeric = Array.isArray(value) && value.length === 2
    ? (finite(value[0], fallback) + finite(value[1], fallback)) / 2
    : finite(value, fallback);
  return Math.max(-1, Math.min(1.5, numeric));
}

function rangedUnit(source = {}, key = "", fallback = 0) {
  return midpoint(source[`${key}Range`] ?? source[key], fallback);
}

function hashUnit(value = "") {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function normalizedChannel(modality, source = {}) {
  const defaults = DEFAULT_CHANNELS[modality] || { availability: 1, acuity: 0.5 };
  return {
    ...defaults,
    ...source,
    availability: unit(source.availability, defaults.availability),
    acuity: unit(source.acuity, defaults.acuity),
    ...(Object.hasOwn(defaults, "motionSensitivity") || Object.hasOwn(source, "motionSensitivity")
      ? { motionSensitivity: unit(source.motionSensitivity, defaults.motionSensitivity ?? 0.5) }
      : {}),
    ...(Object.hasOwn(defaults, "lowLightTolerance") || Object.hasOwn(source, "lowLightTolerance")
      ? { lowLightTolerance: unit(source.lowLightTolerance, defaults.lowLightTolerance ?? 0) }
      : {}),
    ...(Object.hasOwn(defaults, "rhythmResolution") || Object.hasOwn(source, "rhythmResolution")
      ? { rhythmResolution: unit(source.rhythmResolution, defaults.rhythmResolution ?? 0.5) }
      : {}),
    ...(Object.hasOwn(defaults, "sourceLocalization") || Object.hasOwn(source, "sourceLocalization")
      ? { sourceLocalization: unit(source.sourceLocalization, defaults.sourceLocalization ?? 0.5) }
      : {}),
  };
}

export function normalizeCharacterPerceptionProfile(input = {}) {
  const suppliedChannels = input.sensoryChannels || {};
  const sensoryChannels = Object.fromEntries(MODALITIES.map((modality) => [
    modality,
    normalizedChannel(modality, suppliedChannels[modality] || {}),
  ]));
  const suppliedAttention = input.attention || {};
  const baselineBudget = Math.max(1, Math.min(12, Math.round(finite(
    Array.isArray(suppliedAttention.baselineBudgetRange)
      ? (finite(suppliedAttention.baselineBudgetRange[0], DEFAULT_ATTENTION.baselineBudget)
        + finite(suppliedAttention.baselineBudgetRange[1], DEFAULT_ATTENTION.baselineBudget)) / 2
      : suppliedAttention.baselineBudget,
    DEFAULT_ATTENTION.baselineBudget,
  ))));
  const orientingBiases = Object.fromEntries(Object.entries(suppliedAttention.orientingBiases || {})
    .map(([key, value]) => [clean(key, 120), midpointSigned(value)])
    .filter(([key]) => key));
  const domainDecoders = (input.domainDecoders || []).map((row, index) => ({
    id: clean(row?.id, 160) || `decoder:${index + 1}`,
    domain: clean(row?.domain, 120),
    competence: midpoint(row?.competenceRange ?? row?.competence, 0.35),
    supportedInferences: unique(row?.supportedInferences || []),
  })).filter((row) => row.domain);
  return {
    schemaVersion: 1,
    sensoryChannels,
    attention: {
      baselineBudget,
      sensitivityThreshold: rangedUnit(suppliedAttention, "sensitivityThreshold", DEFAULT_ATTENTION.sensitivityThreshold),
      distractibility: rangedUnit(suppliedAttention, "distractibility", DEFAULT_ATTENTION.distractibility),
      overloadSensitivity: rangedUnit(suppliedAttention, "overloadSensitivity", DEFAULT_ATTENTION.overloadSensitivity),
      orientingBiases,
    },
    domainDecoders,
    informationStyle: {
      ...DEFAULT_INFORMATION_STYLE,
      ...(input.informationStyle || {}),
      directInquiry: rangedUnit(input.informationStyle, "directInquiry", DEFAULT_INFORMATION_STYLE.directInquiry),
      concealmentNeed: rangedUnit(input.informationStyle, "concealmentNeed", DEFAULT_INFORMATION_STYLE.concealmentNeed),
      patience: rangedUnit(input.informationStyle, "patience", DEFAULT_INFORMATION_STYLE.patience),
      verificationThreshold: rangedUnit(input.informationStyle, "verificationThreshold", DEFAULT_INFORMATION_STYLE.verificationThreshold),
      socialRiskSensitivity: rangedUnit(input.informationStyle, "socialRiskSensitivity", DEFAULT_INFORMATION_STYLE.socialRiskSensitivity),
      reactionReadingConfidence: rangedUnit(input.informationStyle, "reactionReadingConfidence", DEFAULT_INFORMATION_STYLE.reactionReadingConfidence),
    },
  };
}

function bodyReceptionModifier(bodyState = {}, modality = "") {
  const fatigue = unit(bodyState.fatigue);
  const pain = unit(bodyState.pain);
  const cognitiveLoad = unit(bodyState.cognitiveLoad);
  const modalityImpairment = unit(bodyState.sensoryImpairments?.[modality]);
  return clamp(1 - fatigue * 0.16 - pain * 0.08 - cognitiveLoad * 0.06 - modalityImpairment, 0, 1);
}

function transmissionFor(signal = {}, environment = {}, channel = {}) {
  const modality = clean(signal.modality, 40);
  let transmission = unit(environment.modalityTransmission?.[modality], 1)
    * unit(signal.transmissionFactor ?? signal.transmission?.factor, 1);
  const distanceLoss = unit(signal.transmission?.distanceLoss);
  const barrierLoss = unit(signal.transmission?.barrierLoss);
  const occlusion = unit(signal.transmission?.occlusion);
  transmission *= (1 - distanceLoss) * (1 - barrierLoss) * (1 - occlusion);
  if (modality === "visual") {
    const light = unit(signal.transmission?.light ?? environment.light, 1);
    const lowLightTolerance = unit(channel.lowLightTolerance);
    transmission *= clamp(light + (1 - light) * lowLightTolerance);
  }
  if (modality === "sound") {
    const ambientNoise = unit(signal.transmission?.ambientNoise ?? environment.ambientNoise);
    const signalNoiseResistance = unit(signal.noiseResistance, 0.15);
    transmission *= clamp(1 - ambientNoise * (1 - signalNoiseResistance));
  }
  return clamp(transmission);
}

export function receiveSignalCandidates({
  signals = [],
  profile: profileInput = {},
  environment = {},
  bodyState = {},
} = {}) {
  const profile = profileInput?.schemaVersion === 1 && profileInput.sensoryChannels
    ? profileInput
    : normalizeCharacterPerceptionProfile(profileInput);
  return (signals || []).flatMap((signal, index) => {
    const modality = clean(signal?.modality, 40);
    const channel = profile.sensoryChannels?.[modality];
    if (!channel || channel.availability <= 0 || channel.acuity <= 0) return [];
    const signalStrength = unit(signal.intensity, 0.5);
    const transmission = transmissionFor(signal, environment, channel);
    const bodyModifier = bodyReceptionModifier(bodyState, modality);
    const receivedStrength = clamp(signalStrength * channel.availability * channel.acuity * transmission * bodyModifier);
    if (receivedStrength <= 0.005) return [];
    return [{
      receivedSignalId: `received:${clean(signal.signalId, 180) || index + 1}`,
      signalId: clean(signal.signalId, 180) || `signal:${index + 1}`,
      sourceEntityHandle: clean(signal.sourceEntityHandle, 180),
      modality,
      featureId: clean(signal.featureId, 180) || `feature:${index + 1}`,
      physicalFeature: clean(signal.physicalFeature, 500),
      domainTags: unique(signal.domainTags || []),
      receivedStrength,
      receptionTrace: {
        signalStrength,
        transmission,
        sensoryAvailability: channel.availability,
        sensoryAcuity: channel.acuity,
        bodyModifier,
      },
      occurredAtSeconds: Math.max(0, finite(signal.occurredAtSeconds)),
    }];
  });
}

function contextDomains(attentionContext = {}) {
  return {
    goal: new Set(unique(attentionContext.goalDomains || [])),
    desire: new Set(unique(attentionContext.desireDomains || [])),
    duty: new Set(unique(attentionContext.dutyDomains || [])),
    threat: new Set(unique(attentionContext.threatDomains || [])),
    novel: new Set(unique(attentionContext.novelDomains || [])),
    relationship: new Set(unique(attentionContext.relationshipDomains || [])),
    deliberate: new Set(unique(attentionContext.deliberateFocusDomains || [])),
  };
}

function salienceFor(row, profile, attentionContext, seed) {
  const domains = contextDomains(attentionContext);
  const tags = new Set([row.modality, ...(row.domainTags || [])]);
  let bias = 0;
  const reasonTags = [];
  if (tags.has("directed")) {
    bias += 0.58;
    reasonTags.push("bottom-up:directed-to-self");
  }
  for (const tag of tags) {
    const orienting = finite(profile.attention.orientingBiases?.[tag]);
    if (orienting) {
      bias += orienting;
      reasonTags.push(`trait-or-profession:${tag}`);
    }
    if (domains.goal.has(tag)) {
      bias += 0.34;
      reasonTags.push(`goal:${tag}`);
    }
    if (domains.desire.has(tag)) {
      bias += 0.4;
      reasonTags.push(`desire:${tag}`);
    }
    if (domains.duty.has(tag)) {
      bias += 0.28;
      reasonTags.push(`duty:${tag}`);
    }
    if (domains.threat.has(tag)) {
      bias += 0.48;
      reasonTags.push(`threat:${tag}`);
    }
    if (domains.novel.has(tag)) {
      bias += 0.18;
      reasonTags.push(`novel:${tag}`);
    }
    if (domains.relationship.has(tag)) {
      bias += 0.2;
      reasonTags.push(`relationship:${tag}`);
    }
    if (domains.deliberate.has(tag)) {
      bias += 0.72;
      reasonTags.push(`character-chosen-focus:${tag}`);
    }
  }
  const noise = (hashUnit(`${seed}:${row.signalId}:${row.featureId}`) - 0.5)
    * 0.08
    * profile.attention.distractibility;
  const salience = clamp(row.receivedStrength * Math.max(0.05, 1 + bias) + noise);
  return { salience, reasonTags: unique(reasonTags), noise };
}

export function selectNoticedEvidence({
  receivedSignals = [],
  profile: profileInput = {},
  attentionContext = {},
  bodyState = {},
  seed = "",
  maxEvidence = null,
} = {}) {
  const profile = profileInput?.schemaVersion === 1 && profileInput.sensoryChannels
    ? profileInput
    : normalizeCharacterPerceptionProfile(profileInput);
  const fatigue = unit(bodyState.fatigue);
  const pain = unit(bodyState.pain);
  const cognitiveLoad = unit(bodyState.cognitiveLoad);
  const capacityRatio = clamp(1 - fatigue * 0.45 - pain * 0.18 - cognitiveLoad * 0.55, 0.15, 1);
  const explicitLimit = maxEvidence == null || !Number.isFinite(Number(maxEvidence))
    ? 12
    : Math.max(1, Math.floor(Number(maxEvidence)));
  const effectiveBudget = Math.max(1, Math.min(
    explicitLimit,
    Math.floor(profile.attention.baselineBudget * capacityRatio),
  ));
  const threshold = clamp(profile.attention.sensitivityThreshold * (1 + fatigue * 0.35 + cognitiveLoad * 0.35));
  const ranked = (receivedSignals || []).map((row) => ({
    row,
    ...salienceFor(row, profile, attentionContext, seed),
  })).filter((entry) => entry.salience >= threshold)
    .sort((left, right) => right.salience - left.salience || left.row.signalId.localeCompare(right.row.signalId));
  // Direct, intelligible speech is presented independently of optional focus.
  // Reception still applies hearing, transmission, noise and body limits.
  // Excess direct messages are paged by the host, never silently discarded.
  const directed = (receivedSignals || []).filter(row => row.modality === "sound"
    && row.domainTags.includes("directed") && row.domainTags.includes("speech") && row.receivedStrength >= 0.18)
    .sort((left, right) => left.occurredAtSeconds - right.occurredAtSeconds || left.signalId.localeCompare(right.signalId));
  const protectedRows = directed.slice(0, 32).map(row => ({ row, ...salienceFor(row, profile, attentionContext, seed) }));
  const protectedIds = new Set(directed.map(row => row.signalId));
  const selected = [...protectedRows, ...ranked.filter(entry => !protectedIds.has(entry.row.signalId)).slice(0, Math.max(0, effectiveBudget - protectedRows.length))];
  const selectedIds = new Set(selected.map(entry => entry.row.signalId));
  const overloadRatio = clamp(Math.max(0, ranked.length - effectiveBudget) / Math.max(1, effectiveBudget));
  const uncertaintyPenalty = clamp(
    fatigue * 0.3
      + pain * 0.14
      + cognitiveLoad * 0.36
      + overloadRatio * profile.attention.overloadSensitivity * 0.35,
  );
  const noticedEvidence = selected.map(({ row, salience, reasonTags }, index) => {
    const fidelity = clamp(row.receivedStrength * (1 - uncertaintyPenalty * 0.42));
    const ambiguity = clamp(1 - fidelity + uncertaintyPenalty * 0.18);
    return {
      evidenceId: `noticed:${row.signalId}:${index + 1}`,
      sourceEntityHandle: row.sourceEntityHandle,
      modality: row.modality,
      featureId: row.featureId,
      noticedFeature: projectNoticedPhysicalFeature({
        physicalFeature: row.physicalFeature,
        modality: row.modality,
        domainTags: row.domainTags,
        fidelity,
        ambiguity,
      }),
      domainTags: [...row.domainTags],
      salience,
      fidelity,
      ambiguity,
      attentionReasonTags: reasonTags.length ? reasonTags : ["bottom-up-salience"],
      sourceSignalIds: [row.signalId],
      occurredAtSeconds: row.occurredAtSeconds,
    };
  });
  return {
    noticedEvidence,
    attentionTrace: {
      formulaVersion: CHARACTER_PERCEPTION_FORMULA_VERSION,
      authority: "character-private-automatic-attention",
      baselineBudget: profile.attention.baselineBudget,
      effectiveBudget,
      sensitivityThreshold: threshold,
      eligibleSignalCount: ranked.length,
      receivedSignalCount: receivedSignals.length,
      overloadRatio,
      uncertaintyPenalty,
      excludedSignalIds: ranked.filter(entry => !selectedIds.has(entry.row.signalId)).map(entry => entry.row.signalId),
      protectedDirectedSignalIds: protectedRows.map(entry => entry.row.signalId),
      deferredDirectedSignalIds: directed.slice(32).map(row => row.signalId),
    },
  };
}

function competenceFor(profile, domain) {
  return Math.max(0.12, ...(profile.domainDecoders || [])
    .filter((decoder) => decoder.domain === domain)
    .map((decoder) => decoder.competence));
}

export function decodeNoticedEvidence({
  noticedEvidence = [],
  profile: profileInput = {},
  hypothesisCatalog = [],
} = {}) {
  const profile = profileInput?.schemaVersion === 1 && profileInput.sensoryChannels
    ? profileInput
    : normalizeCharacterPerceptionProfile(profileInput);
  const byFeature = new Map((noticedEvidence || []).map((row) => [row.featureId, row]));
  return (hypothesisCatalog || []).flatMap((hypothesis, index) => {
    const required = unique(hypothesis.supportingFeatureIds || []);
    const supporting = required.map((featureId) => byFeature.get(featureId)).filter(Boolean);
    if (!supporting.length) return [];
    const domain = clean(hypothesis.domain, 120);
    const expertise = competenceFor(profile, domain);
    const coverage = supporting.length / Math.max(1, required.length);
    const meanFidelity = supporting.reduce((sum, row) => sum + unit(row.fidelity), 0) / supporting.length;
    const diagnosticity = unit(hypothesis.baseDiagnosticity, 0.5);
    const confidence = clamp(diagnosticity * expertise * meanFidelity * (0.55 + coverage * 0.45));
    return [{
      hypothesisId: clean(hypothesis.hypothesisId, 180) || `hypothesis:${index + 1}`,
      status: "hypothesis",
      proposition: clean(hypothesis.proposition, 500),
      domain,
      confidence,
      confidenceBand: confidence >= 0.75 ? "high" : confidence >= 0.5 ? "medium" : confidence >= 0.25 ? "low" : "very_low",
      expertise,
      diagnosticity,
      basisEvidenceIds: supporting.map((row) => row.evidenceId),
      sourceEntityHandles: unique(supporting.map((row) => row.sourceEntityHandle)),
    }];
  }).sort((left, right) => right.confidence - left.confidence || left.hypothesisId.localeCompare(right.hypothesisId));
}

export function buildCharacterPerceptionFrame({
  signals = [],
  profile: profileInput = {},
  environment = {},
  bodyState = {},
  attentionContext = {},
  hypothesisCatalog = [],
  seed = "",
  maxEvidence = null,
} = {}) {
  const profile = profileInput?.schemaVersion === 1 && profileInput.sensoryChannels
    ? profileInput
    : normalizeCharacterPerceptionProfile(profileInput);
  const receivedSignals = receiveSignalCandidates({ signals, profile, environment, bodyState });
  const selected = selectNoticedEvidence({
    receivedSignals,
    profile,
    attentionContext,
    bodyState,
    seed,
    maxEvidence,
  });
  const interpretations = decodeNoticedEvidence({
    noticedEvidence: selected.noticedEvidence,
    profile,
    hypothesisCatalog,
  });
  return {
    schemaVersion: 1,
    formulaVersion: CHARACTER_PERCEPTION_FORMULA_VERSION,
    authority: "character-private-perception-tool",
    noticedEvidence: selected.noticedEvidence,
    interpretations,
    attentionTrace: selected.attentionTrace,
    serverAudit: {
      visibility: "server-debug-only",
      excludedFromAgentMemory: true,
      receivedSignals,
    },
  };
}
