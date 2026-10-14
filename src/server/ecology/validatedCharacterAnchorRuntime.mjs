import {
  VALIDATED_CHARACTER_ANCHOR_REGISTRY,
  VALIDATED_CHARACTER_ANCHOR_REGISTRY_VERSION,
} from "../../data/validatedCharacterAnchorRegistry.js";
import { normalizeCharacterAgentMemoryState } from "../../engine/characterAgentMemory.js";
import { normalizeCharacterPerceptionProfile } from "../simulation/characterPerception.mjs";
import { compileCharacterVoiceFoundation } from "../simulation/characterVoiceHabits.mjs";
import {
  auditCultivationSustenanceProfile,
  normalizeCultivationSustenanceProfile,
} from "../simulation/cultivationSustenance.mjs";

export const VALIDATED_CHARACTER_ANCHOR_RUNTIME_VERSION = 2;

const AUTHORING_ONLY_KEYS = new Set([
  "evidenceId",
  "evidenceIds",
  "inferredEvidenceIds",
  "provenance",
  "confidence",
]);

const OPERATIONAL_STRENGTH_DEFAULTS = Object.freeze({
  very_high: 0.86,
  high_current: 0.78,
  current_high_but_inhibited: 0.74,
  strong_state_activated: 0.7,
  state_activated: 0.56,
  medium: 0.5,
  low: 0.28,
});

const OPERATIONAL_GROWTH_DEFAULTS = Object.freeze({
  very_high: 0.03,
  high_current: 0.026,
  current_high_but_inhibited: 0.024,
  strong_state_activated: 0.022,
  state_activated: 0.018,
  medium: 0.014,
  low: 0.008,
});

const OPERATIONAL_PERSONALITY_DEFAULTS = Object.freeze({
  autonomy: 0.5,
  introversion: 0.5,
  persistence: 0.5,
  conscientiousness: 0.5,
  competitiveness: 0.5,
  care: 0.5,
  caution: 0.5,
  impulsivity: 0.2,
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function clean(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set(values.map((value) => clean(value)).filter(Boolean))];
}

function projectFoundationValue(value) {
  if (Array.isArray(value)) return value.map(projectFoundationValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !AUTHORING_ONLY_KEYS.has(key))
    .map(([key, child]) => [key, projectFoundationValue(child)]));
}

function removeEmbeddedSpeechExamples(value) {
  if (Array.isArray(value)) return value.map(removeEmbeddedSpeechExamples);
  if (!value || typeof value !== "object") {
    if (typeof value !== "string") return value;
    return clean(value
      .replace(/(?:：\s*)?[“‘「『][^”’」』]+[”’」』]/gu, "示例措辞")
      .replace(/:\s*"[^"]+"/gu, "示例措辞")
      .replace(/(?:示例措辞\s*(?:或|、)\s*)+示例措辞/gu, "示例措辞"));
  }
  return Object.fromEntries(Object.entries(value)
    .map(([key, child]) => [key, removeEmbeddedSpeechExamples(child)]));
}

function removeSurfaceFormPrescriptions(value) {
  if (Array.isArray(value)) return value.map(removeSurfaceFormPrescriptions).filter((entry) => entry !== "");
  if (!value || typeof value !== "object") {
    if (typeof value !== "string") return value;
    return clean(value
      .replace(/用极短句缩小问题/gu, "缩小问题范围")
      .replace(/直接短促赞叹/gu, "直接表达真实赞叹")
      .replace(/短促而真诚地?/gu, "直接而真诚地")
      .replace(/句子越短/gu, "表达越收拢到眼前要点")
      .replace(/压力改变句长与披露程度/gu, "压力改变注意、披露与表达节奏")
      .replace(/缩短分句但不破坏口语语法/gu, "收拢到此刻愿意承担的内容，但不破坏口语语法")
      .replace(/缩成一个完整短句/gu, "把表达收拢到一个完整意思"));
  }
  return Object.fromEntries(Object.entries(value)
    .map(([key, child]) => [key, removeSurfaceFormPrescriptions(child)]));
}

function compileSpeechFoundation(policy = {}) {
  const projected = projectFoundationValue(policy || {});
  if (!projected || typeof projected !== "object") return {};
  delete projected.evidenceAnchors;
  return removeSurfaceFormPrescriptions(removeEmbeddedSpeechExamples(projected));
}

function foundationIssue(code, path, message) {
  return { code, path, message };
}

function containsOwnKey(value, forbiddenKey) {
  if (!value || typeof value !== "object") return false;
  if (Object.hasOwn(value, forbiddenKey)) return true;
  return Object.values(value).some((child) => containsOwnKey(child, forbiddenKey));
}

export function compileCharacterFoundation(anchor = {}) {
  if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) return null;
  const stateVariables = projectFoundationValue(anchor.dynamicPsychology?.stateVariables || []);
  const legacyIdentityModel = {
    conflicts: projectFoundationValue(anchor.evidence?.conflicts || []),
    openChoiceAxes: projectFoundationValue(anchor.evidence?.openChoiceAxes || []),
  };
  return deepFreeze({
    schemaVersion: anchor.schemaVersion,
    runtimeSurface: "character-foundation",
    characterId: clean(anchor.characterId),
    status: clean(anchor.status),
    numericCalibrationStatus: clean(anchor.numericCalibrationStatus) || "unassigned",
    identityModel: projectFoundationValue(anchor.identityModel || legacyIdentityModel),
    stablePsychology: projectFoundationValue(anchor.stablePsychology || {}),
    ...(anchor.physiology ? { physiology: projectFoundationValue(anchor.physiology) } : {}),
    ...(anchor.materialEconomy ? { materialEconomy: projectFoundationValue(anchor.materialEconomy) } : {}),
    ...(anchor.competenceModel ? { competenceModel: projectFoundationValue(anchor.competenceModel) } : {}),
    perceptionProfile: normalizeCharacterPerceptionProfile(projectFoundationValue(anchor.perceptionProfile || {})),
    dynamicPsychology: { stateVariables },
    epistemics: projectFoundationValue(anchor.epistemics || {}),
    sceneBindings: projectFoundationValue(anchor.sceneBindings || []),
    desires: projectFoundationValue(anchor.desires || []),
    inhibitors: projectFoundationValue(anchor.inhibitors || []),
    speechPolicy: compileSpeechFoundation(anchor.speechPolicy || {}),
    relationshipModel: projectFoundationValue(anchor.relationshipModel || {}),
    memoryPolicy: projectFoundationValue(anchor.memoryPolicy || {}),
  });
}

function midpoint(range = [], fallback = 0.5) {
  if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite)) return fallback;
  return Math.max(0, Math.min(1, (Number(range[0]) + Number(range[1])) / 2));
}

function compileDynamicPsychologyState(foundation = {}) {
  return Object.fromEntries((foundation.dynamicPsychology?.stateVariables || [])
    .map((row) => [clean(row?.id), midpoint(row?.baselineRange, 0.5)])
    .filter(([id]) => id));
}

export function validateCharacterFoundation(candidate) {
  const errors = [];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { valid: false, errors: [foundationIssue("FOUNDATION_NOT_OBJECT", "foundation", "运行时人物底座必须是对象")] };
  }
  if (candidate.runtimeSurface !== "character-foundation") {
    errors.push(foundationIssue("FOUNDATION_SURFACE_INVALID", "runtimeSurface", "运行时人物底座缺少明确 surface 标记"));
  }
  if (!clean(candidate.characterId)) errors.push(foundationIssue("FOUNDATION_CHARACTER_ID_MISSING", "characterId", "运行时人物底座缺少 characterId"));
  if (!Array.isArray(candidate.desires) || candidate.desires.length === 0) {
    errors.push(foundationIssue("FOUNDATION_DESIRES_MISSING", "desires", "运行时人物底座至少需要一个人物自有欲望"));
  }
  if (!candidate.stablePsychology || typeof candidate.stablePsychology !== "object") {
    errors.push(foundationIssue("FOUNDATION_STABLE_PSYCHOLOGY_MISSING", "stablePsychology", "运行时人物底座缺少稳定心理参数"));
  }
  if (candidate.physiology !== undefined) {
    const sustenance = candidate.physiology?.sustenance;
    const audit = auditCultivationSustenanceProfile(sustenance || {});
    if (!sustenance || !audit.valid) {
      errors.push(...(audit.issues.length ? audit.issues : [{ code: "SUSTENANCE_MISSING", path: "sustenance" }]).map((entry) => foundationIssue(
        `FOUNDATION_${entry.code}`,
        `physiology.${entry.path}`,
        "人物身体底座声明补给模式时必须提供有效的修行生理参数",
      )));
    }
  }
  if (candidate.materialEconomy !== undefined) {
    const economy = candidate.materialEconomy;
    const validUnitRange = (value) => Array.isArray(value)
      && value.length === 2
      && value.every((part) => Number.isFinite(Number(part)) && Number(part) >= 0 && Number(part) <= 1)
      && Number(value[0]) <= Number(value[1]);
    if (!economy || typeof economy !== "object" || Array.isArray(economy)) {
      errors.push(foundationIssue("FOUNDATION_MATERIAL_ECONOMY_INVALID", "materialEconomy", "财富来源与消费倾向必须是独立对象"));
    } else {
      if (!clean(economy.wealthBand) || !clean(economy.materialPosition)) {
        errors.push(foundationIssue("FOUNDATION_MATERIAL_POSITION_MISSING", "materialEconomy", "人物底座必须说明稳定财富处境，而不只是当前铜钱数量"));
      }
      for (const [key, range] of Object.entries(economy.consumptionPreferences || {})) {
        if (!validUnitRange(range)) {
          errors.push(foundationIssue("FOUNDATION_CONSUMPTION_RANGE_INVALID", `materialEconomy.consumptionPreferences.${key}`, "消费倾向必须是 0 到 1 的不确定范围"));
        }
      }
      for (const [currencyId, access] of Object.entries(economy.currencyAccess || {})) {
        if (!clean(currencyId) || !clean(access?.currencyClass)) {
          errors.push(foundationIssue("FOUNDATION_CURRENCY_ACCESS_INVALID", `materialEconomy.currencyAccess.${currencyId}`, "货币取得能力必须说明货币类别"));
          continue;
        }
        for (const key of ["acquisitionEaseRange", "strategicValueRange", "conversionFrictionRange"]) {
          if (!validUnitRange(access?.[key])) {
            errors.push(foundationIssue("FOUNDATION_CURRENCY_RANGE_INVALID", `materialEconomy.currencyAccess.${currencyId}.${key}`, "取得难度、战略价值与兑换摩擦必须是 0 到 1 的范围"));
          }
        }
      }
      for (const forbiddenKey of ["fixedPurchase", "defaultOrder", "preferredOfferingId", "situationToPurchase"]) {
        if (containsOwnKey(economy, forbiddenKey)) {
          errors.push(foundationIssue(
            "FOUNDATION_CONSUMPTION_ACTION_LEAK",
            `materialEconomy.${forbiddenKey}`,
            `消费习惯不能包含 ${forbiddenKey} 这类固定购买答案`,
          ));
        }
      }
    }
  }
  if (candidate.competenceModel !== undefined) {
    if (!candidate.competenceModel || typeof candidate.competenceModel !== "object" || Array.isArray(candidate.competenceModel)) {
      errors.push(foundationIssue("FOUNDATION_COMPETENCE_MODEL_INVALID", "competenceModel", "职业与程序性能力必须是独立对象"));
    } else {
      const competenceRows = [
        ...(candidate.competenceModel.perceptualCompetences || []),
        ...(candidate.competenceModel.proceduralCompetences || []),
      ];
      if (competenceRows.length === 0) {
        errors.push(foundationIssue("FOUNDATION_COMPETENCE_MODEL_EMPTY", "competenceModel", "声明 competenceModel 时至少需要一项感知或程序性能力"));
      }
      for (const [index, row] of competenceRows.entries()) {
        if (!clean(row?.id) || !clean(row?.domain)) {
          errors.push(foundationIssue("FOUNDATION_COMPETENCE_ROW_INVALID", `competenceModel.rows[${index}]`, "能力条目必须有稳定 id 和 domain"));
        }
      }
      for (const forbiddenKey of ["expectedChoice", "fixedAction", "preferredPositionId", "situationToAction"]) {
        if (containsOwnKey(candidate.competenceModel, forbiddenKey)) {
          errors.push(foundationIssue(
            "FOUNDATION_COMPETENCE_ACTION_LEAK",
            `competenceModel.${forbiddenKey}`,
            `职业能力不能包含 ${forbiddenKey} 这类情境答案`,
          ));
        }
      }
    }
  }
  if (candidate.perceptionProfile !== undefined) {
    const authoredProfile = candidate.perceptionProfile;
    const authoredRangeShape = authoredProfile
      && typeof authoredProfile === "object"
      && !Array.isArray(authoredProfile)
      && authoredProfile.schemaVersion === undefined
      && authoredProfile.attention
      && Array.isArray(authoredProfile.domainDecoders)
      && authoredProfile.informationStyle;
    const profile = authoredRangeShape
      ? normalizeCharacterPerceptionProfile(authoredProfile)
      : authoredProfile;
    const channels = profile?.sensoryChannels;
    const attention = profile?.attention;
    const informationStyle = profile?.informationStyle;
    const unitValue = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1;
    const profileShapeValid = profile
      && typeof profile === "object"
      && !Array.isArray(profile)
      && profile.schemaVersion === 1
      && channels
      && typeof channels === "object"
      && Object.values(channels).every((channel) => (
        channel
        && typeof channel === "object"
        && unitValue(channel.availability)
        && unitValue(channel.acuity)
      ))
      && attention
      && Number.isInteger(attention.baselineBudget)
      && attention.baselineBudget >= 1
      && attention.baselineBudget <= 12
      && unitValue(attention.sensitivityThreshold)
      && unitValue(attention.distractibility)
      && unitValue(attention.overloadSensitivity)
      && informationStyle
      && [
        "directInquiry",
        "concealmentNeed",
        "patience",
        "verificationThreshold",
        "socialRiskSensitivity",
        "reactionReadingConfidence",
      ].every((key) => unitValue(informationStyle[key]))
      && Array.isArray(profile.domainDecoders)
      && profile.domainDecoders.every((decoder) => clean(decoder?.domain) && unitValue(decoder?.competence));
    if (!profileShapeValid) {
      errors.push(foundationIssue(
        "FOUNDATION_PERCEPTION_PROFILE_INVALID",
        "perceptionProfile",
        "人物感知档案必须使用规范化感官、注意力、职业解码与信息风格范围",
      ));
    }
    for (const forbiddenKey of ["expectedChoice", "fixedAction", "preferredQuestion", "situationToAction"]) {
      if (containsOwnKey(authoredProfile, forbiddenKey)) {
        errors.push(foundationIssue(
          "FOUNDATION_PERCEPTION_ACTION_LEAK",
          `perceptionProfile.${forbiddenKey}`,
          `人物感知档案不能包含 ${forbiddenKey} 这类行为答案`,
        ));
      }
    }
  }
  for (const forbiddenKey of ["evidence", "validation", "actionPolicy", "candidateFamilies"]) {
    if (containsOwnKey(candidate, forbiddenKey)) {
      errors.push(foundationIssue("FOUNDATION_AUTHORING_DATA_LEAK", forbiddenKey, `运行时人物底座不得包含 ${forbiddenKey}`));
    }
  }
  if (Object.hasOwn(candidate.dynamicPsychology || {}, "updateRules")) {
    errors.push(foundationIssue(
      "FOUNDATION_AUTHORING_DATA_LEAK",
      "dynamicPsychology.updateRules",
      "运行时人物底座不得包含人物专属认知状态更新脚本",
    ));
  }
  if (Object.hasOwn(candidate.speechPolicy || {}, "evidenceAnchors")) {
    errors.push(foundationIssue(
      "FOUNDATION_AUTHORING_DATA_LEAK",
      "speechPolicy.evidenceAnchors",
      "运行时人物底座不得包含校准原句",
    ));
  }
  return { valid: errors.length === 0, errors };
}

function qualitativeKey(value = "") {
  const key = clean(value).toLowerCase();
  if (OPERATIONAL_STRENGTH_DEFAULTS[key] != null) return key;
  if (key.includes("very") && key.includes("high")) return "very_high";
  if (key.includes("strong")) return "strong_state_activated";
  if (key.includes("high")) return "high_current";
  if (key.includes("low")) return "low";
  if (key.includes("state")) return "state_activated";
  return "medium";
}

function normalizeTarget(target, desire = {}) {
  if (target && typeof target === "object" && !Array.isArray(target)) {
    return {
      type: clean(target.type) || "dynamic_target",
      id: clean(target.id) || clean(desire.id),
      label: clean(target.label) || clean(desire.desiredState?.object) || clean(desire.id),
    };
  }
  const targetId = clean(target);
  if (targetId === "self") {
    return { type: "self", id: desire.ownerCharacterId, label: "自己" };
  }
  if (/^char_/u.test(targetId)) {
    return { type: "character", id: targetId, label: clean(desire.desiredState?.object) || targetId };
  }
  return {
    type: "dynamic_target",
    id: targetId || `target:${clean(desire.id)}`,
    label: clean(desire.desiredState?.object) || targetId || clean(desire.id),
  };
}

function compileEcologyDesire(desire = {}) {
  const strengthKey = qualitativeKey(desire.qualitativeStrength);
  const satisfaction = desire.satisfactionCondition || {};
  const authoredActivationPolicy = desire.activationPolicy && typeof desire.activationPolicy === "object"
    ? structuredClone(desire.activationPolicy)
    : {};
  const cueGated = clean(authoredActivationPolicy.mode) === "cue_gated"
    || strengthKey === "strong_state_activated"
    || strengthKey === "state_activated";
  const latentActivationCap = Math.max(0, Math.min(1, Number(
    authoredActivationPolicy.latentActivationCap ?? (cueGated ? 0.12 : OPERATIONAL_STRENGTH_DEFAULTS[strengthKey]),
  )));
  return {
    kind: "desire",
    id: clean(desire.id),
    ownerCharacterId: clean(desire.ownerCharacterId),
    polarity: "positive",
    desiredState: structuredClone(desire.desiredState || {}),
    target: normalizeTarget(desire.target, desire),
    baseStrength: OPERATIONAL_STRENGTH_DEFAULTS[strengthKey],
    growthPerHour: OPERATIONAL_GROWTH_DEFAULTS[strengthKey],
    activationCues: unique(desire.activationCues || []),
    activationMode: cueGated ? "cue_gated" : "persistent",
    activationPolicy: {
      ...authoredActivationPolicy,
      mode: cueGated ? "cue_gated" : "persistent",
      latentActivationCap,
      doesNotCount: unique(authoredActivationPolicy.doesNotCount || []),
    },
    latentActivationCap,
    progressEvidence: unique(desire.progressEvidence || []),
    authoredSatisfactionCondition: structuredClone(satisfaction),
    satisfactionCondition: {
      beneficiaryCharacterId: clean(desire.ownerCharacterId),
      type: "validated_anchor_evidence",
      criteria: {
        anchorDesireId: clean(desire.id),
        evidenceTags: [`anchor-desire:${clean(desire.id)}:resolved`],
        requiredEvidence: clean(satisfaction.requiredEvidence) || clean(desire.desiredState?.observableOutcome),
        doesNotCount: unique(satisfaction.doesNotCount || []),
      },
    },
    runtimeProjection: {
      source: "validated-character-anchor",
      qualitativeStrength: clean(desire.qualitativeStrength),
      numericAuthority: "engine-operational-default",
      authorNumericCalibration: "unassigned",
      operationalStrengthKey: strengthKey,
      activationMode: cueGated ? "cue_gated" : "persistent",
    },
  };
}

export function compileCharacterVoiceProjection(anchor = {}) {
  const policy = anchor.speechPolicy || {};
  const runtimePolicy = compileSpeechFoundation(policy);
  const relationshipRegisters = Object.fromEntries(Object.entries(runtimePolicy.relationshipRegisters || {}).map(([key, value]) => [key, {
    distance: clean(value),
    adjustment: clean(value),
  }]));
  const stable = anchor.stablePsychology || {};
  const corePursuits = unique((stable.corePursuits || []).map((row) => row?.desiredSelfState || row?.desiredState || row?.id));
  const selfThreats = unique((stable.selfThreats || []).map((row) => row?.fearedSelfState || row?.threat || row?.id));
  const pragmaticForms = unique(runtimePolicy.pragmaticForms || []);
  const pressureMutation = unique(runtimePolicy.pressureMutation || []);
  const voiceFoundation = anchor.voiceFoundation
    ? compileCharacterVoiceFoundation(projectFoundationValue(anchor.voiceFoundation))
    : null;
  return {
    authoritySource: "validated-character-anchor",
    attentionPriorities: unique([
      ...(runtimePolicy.attentionPriorities || []),
      ...corePursuits,
      ...selfThreats,
    ]),
    appraisalHabits: unique(runtimePolicy.appraisalHabits || []),
    interactionStance: clean(runtimePolicy.interactionStance),
    disclosureStrategy: clean(runtimePolicy.disclosureStrategy),
    thoughtMovement: unique(runtimePolicy.thoughtMovement || []),
    rhythmTendency: clean(runtimePolicy.rhythmTendency),
    emotionalLeakage: unique(runtimePolicy.praiseConditions || []),
    pressureResponse: {
      ...(pressureMutation.length ? { attentionShift: pressureMutation.join("；") } : {}),
      ...(clean(runtimePolicy.silenceDefault) ? { disclosureShift: clean(runtimePolicy.silenceDefault) } : {}),
    },
    silenceStyle: clean(runtimePolicy.silenceDefault),
    relationshipRegisters,
    driftRisks: unique(runtimePolicy.forbiddenRegisters || []),
    disclosureDrivers: {
      ...(Array.isArray(runtimePolicy.explanationCostRange) ? { explanationCostRange: structuredClone(runtimePolicy.explanationCostRange) } : {}),
      ...(Array.isArray(runtimePolicy.socialMaintenanceRange) ? { socialMaintenanceRange: structuredClone(runtimePolicy.socialMaintenanceRange) } : {}),
    },
    psychologicalFunctions: {
      silenceDefault: clean(runtimePolicy.silenceDefault),
      pragmaticForms,
      praiseConditions: unique(runtimePolicy.praiseConditions || []),
      pressureMutation,
    },
    ...(voiceFoundation ? { voiceFoundation } : {}),
  };
}

function operationalMemoryConfidence(row = {}) {
  const source = clean(row.sourceType || row.source?.kind || row.provenance?.kind).toLowerCase();
  if (source.includes("firsthand") || source.includes("self_")) return 0.9;
  if (source.includes("direct")) return 0.86;
  if (source.includes("report") || source.includes("gossip")) return 0.58;
  if (source.includes("inference")) return 0.62;
  return 0.68;
}

function compileMemorySeed(seed = {}, source = {}) {
  const marker = {
    source: "validated-character-memory-seed",
    numericAuthority: "engine-operational-default",
    authorNumericCalibration: clean(seed.numericCalibrationStatus) || "unassigned",
  };
  const projected = {
    ...structuredClone(seed),
    runtimeProjection: {
      ...marker,
      sourcePath: source.memoryPath || "",
      sourceSha256: source.memorySha256 || "",
    },
    episodes: (seed.episodes || []).map((episode) => ({
      ...structuredClone(episode),
      source: {
        ...structuredClone(episode.source || {}),
        confidence: episode.source?.confidence ?? operationalMemoryConfidence(episode),
      },
      runtimeProjection: { ...marker },
    })),
    beliefs: (seed.beliefs || []).map((belief) => ({
      ...structuredClone(belief),
      confidence: belief.confidence ?? operationalMemoryConfidence(belief),
      runtimeProjection: { ...marker },
    })),
    commitments: (seed.commitments || []).map((commitment) => ({
      ...structuredClone(commitment),
      importance: commitment.importance ?? (commitment.status === "open" ? 0.78 : 0.58),
      runtimeProjection: { ...marker },
    })),
    impressions: (seed.impressions || []).map((impression) => ({
      ...structuredClone(impression),
      runtimeProjection: { ...marker },
    })),
  };
  return normalizeCharacterAgentMemoryState(projected, seed.ownerCharacterId);
}

export function compileValidatedCharacterAnchorRuntime(entry = {}) {
  const anchor = entry.characterFoundation || entry.anchor;
  if (!anchor || anchor.status !== "validated") return null;
  if (entry.characterId !== anchor.characterId) return null;
  const characterFoundation = compileCharacterFoundation(anchor);
  const sceneBinding = (characterFoundation.sceneBindings || []).find((row) => row?.sceneId === entry.sceneId) || null;
  return deepFreeze({
    schemaVersion: VALIDATED_CHARACTER_ANCHOR_RUNTIME_VERSION,
    registryVersion: VALIDATED_CHARACTER_ANCHOR_REGISTRY_VERSION,
    status: "runtime-mapped",
    sceneId: entry.sceneId,
    characterId: entry.characterId,
    source: structuredClone(entry.source || {}),
    characterFoundation,
    psychologyAnchor: characterFoundation,
    perceptionProjection: structuredClone(characterFoundation.perceptionProfile),
    ecologyProjection: {
      desires: (characterFoundation.desires || []).map(compileEcologyDesire),
      personality: structuredClone(OPERATIONAL_PERSONALITY_DEFAULTS),
      personalityRuntimeProjection: {
        source: "character-foundation-numeric-gap",
        numericAuthority: "engine-operational-default",
        authorNumericCalibration: clean(characterFoundation.numericCalibrationStatus) || "unassigned",
        rule: "通用人格轴未获作者数值校准时保持中性；领域倾向继续由 foundation dispositions、threats 与 inhibitors 交给 Character Agent 使用，不外推成全局人格值。",
      },
      dynamicPsychologyState: compileDynamicPsychologyState(characterFoundation),
      sustenanceProfile: normalizeCultivationSustenanceProfile(characterFoundation.physiology?.sustenance || {}),
      numericPolicy: {
        authority: "engine-operational-default",
        authorNumericCalibration: clean(characterFoundation.numericCalibrationStatus) || "unassigned",
        strengthDefaults: { ...OPERATIONAL_STRENGTH_DEFAULTS },
        growthDefaults: { ...OPERATIONAL_GROWTH_DEFAULTS },
      },
    },
    voiceProjection: compileCharacterVoiceProjection(anchor),
    relationshipProjection: structuredClone(characterFoundation.relationshipModel || {}),
    memoryProjection: {
      policy: structuredClone(characterFoundation.memoryPolicy || {}),
      seed: compileMemorySeed(entry.memorySeed || {}, entry.source || {}),
    },
    presenceProjection: structuredClone(sceneBinding),
    candidatePolicy: {
      authority: "generic-cognitive-core",
      candidateSource: "perceived-world-affordances-plus-universal-primitives",
      parameterSources: [
        "characterFoundation.stablePsychology",
        "characterFoundation.desires",
        "characterFoundation.inhibitors",
        "characterFoundation.physiology.sustenance",
        "characterFoundation.materialEconomy",
        "characterFoundation.epistemics",
        "characterFoundation.relationshipModel",
        "characterFoundation.dynamicPsychology.stateVariables",
        "characterFoundation.perceptionProfile",
      ],
    },
  });
}

const runtimeCache = new Map();

export function getValidatedCharacterAnchorRuntime(sceneId, characterId) {
  const key = `${clean(sceneId)}::${clean(characterId)}`;
  if (runtimeCache.has(key)) return runtimeCache.get(key);
  const entry = VALIDATED_CHARACTER_ANCHOR_REGISTRY.entries?.[key] || null;
  const runtime = entry ? compileValidatedCharacterAnchorRuntime(entry) : null;
  runtimeCache.set(key, runtime);
  return runtime;
}

export function findValidatedCharacterAnchorRuntime(characterId, { sceneId = "" } = {}) {
  if (sceneId) return getValidatedCharacterAnchorRuntime(sceneId, characterId);
  const matches = Object.values(VALIDATED_CHARACTER_ANCHOR_REGISTRY.entries || {})
    .filter((entry) => entry.characterId === characterId);
  if (matches.length !== 1) return null;
  return getValidatedCharacterAnchorRuntime(matches[0].sceneId, characterId);
}

export function listValidatedCharacterAnchorRuntimes() {
  return Object.values(VALIDATED_CHARACTER_ANCHOR_REGISTRY.entries || {})
    .map((entry) => getValidatedCharacterAnchorRuntime(entry.sceneId, entry.characterId))
    .filter(Boolean);
}

export function createValidatedCharacterAnchorMemoryState(characterId, { sceneId = "" } = {}) {
  const runtime = findValidatedCharacterAnchorRuntime(characterId, { sceneId });
  return runtime?.memoryProjection?.seed
    ? structuredClone(runtime.memoryProjection.seed)
    : null;
}

function mergeMemoryRows(existingRows = [], seedRows = []) {
  const seedById = new Map((seedRows || []).filter((row) => clean(row?.id)).map((row) => [clean(row.id), row]));
  const merged = [];
  const seen = new Set();
  for (const row of existingRows || []) {
    if (!row) continue;
    const id = clean(row.id);
    if (id && seen.has(id)) continue;
    merged.push(id && seedById.has(id)
      ? { ...structuredClone(seedById.get(id)), ...structuredClone(row) }
      : structuredClone(row));
    if (id) seen.add(id);
  }
  for (const row of seedRows || []) {
    const id = clean(row?.id);
    if (!row || (id && seen.has(id))) continue;
    merged.push(structuredClone(row));
    if (id) seen.add(id);
  }
  return merged;
}

/**
 * Adds validated pre-story memory to a lived character memory without
 * replacing later perceptions, beliefs, obligations or identity revisions.
 * Repeated calls are idempotent by stable memory id.
 */
export function mergeValidatedCharacterAnchorMemoryState(existing = {}, characterId = "", { sceneId = "" } = {}) {
  const ownerCharacterId = clean(characterId || existing?.ownerCharacterId);
  const lived = normalizeCharacterAgentMemoryState(existing || {}, ownerCharacterId);
  const seed = createValidatedCharacterAnchorMemoryState(ownerCharacterId, { sceneId });
  if (!seed) return lived;
  const normalizedSeed = normalizeCharacterAgentMemoryState(seed, ownerCharacterId);
  return normalizeCharacterAgentMemoryState({
    ...structuredClone(normalizedSeed),
    ...structuredClone(lived),
    runtimeProjection: {
      ...structuredClone(lived.runtimeProjection || {}),
      ...structuredClone(normalizedSeed.runtimeProjection || {}),
    },
    episodes: mergeMemoryRows(lived.episodes, normalizedSeed.episodes),
    beliefs: mergeMemoryRows(lived.beliefs, normalizedSeed.beliefs),
    commitments: mergeMemoryRows(lived.commitments, normalizedSeed.commitments),
    impressions: mergeMemoryRows(lived.impressions, normalizedSeed.impressions),
    selfNarrative: {
      currentClaims: mergeMemoryRows(
        lived.selfNarrative?.currentClaims,
        normalizedSeed.selfNarrative?.currentClaims,
      ),
      versions: mergeMemoryRows(
        lived.selfNarrative?.versions,
        normalizedSeed.selfNarrative?.versions,
      ),
      pendingCandidates: mergeMemoryRows(
        lived.selfNarrative?.pendingCandidates,
        normalizedSeed.selfNarrative?.pendingCandidates,
      ),
    },
    lastAdvancedAtSeconds: Math.max(
      Number(lived.lastAdvancedAtSeconds || 0),
      Number(normalizedSeed.lastAdvancedAtSeconds || 0),
    ),
    lastEncodedAtSeconds: Math.max(
      Number(lived.lastEncodedAtSeconds || 0),
      Number(normalizedSeed.lastEncodedAtSeconds || 0),
    ),
  }, ownerCharacterId);
}

export function buildValidatedAnchorCandidateGuidance(runtime, candidate = {}) {
  if (!runtime) return null;
  return deepFreeze({
    sourceSceneId: runtime.sceneId,
    sourceCharacterId: runtime.characterId,
    selectedDriveId: clean(candidate.driveId),
    authority: runtime.candidatePolicy.authority,
    candidateSource: runtime.candidatePolicy.candidateSource,
    rule: "从当前可感知事实、世界 affordance、通用行动原语与本人人物参数比较可行手段；校准答案和 Holdout 不提供行动。世界只验证事实、可行性与后果。",
    parameterSources: [...runtime.candidatePolicy.parameterSources],
    dispositionIds: Object.keys(runtime.characterFoundation.stablePsychology?.dispositions || {}),
    desireIds: (runtime.characterFoundation.desires || []).map((row) => clean(row.id)).filter(Boolean),
    inhibitorIds: (runtime.characterFoundation.inhibitors || []).map((row) => clean(row.id)).filter(Boolean),
    relationshipForbiddenCollapses: [...(runtime.relationshipProjection.forbiddenCollapses || [])],
  });
}
