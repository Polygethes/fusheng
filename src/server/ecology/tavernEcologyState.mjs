import {
  TAVERN_ECOLOGY_CHARACTER_IDS,
  TAVERN_ECOLOGY_PROFILE_VERSION,
  TAVERN_ECOLOGY_PROFILES,
  assertValidEcologyProfile,
  getTavernEcologyProfile,
} from "./tavernEcologyProfile.mjs";

export const TAVERN_ECOLOGY_STATE_VERSION = 1;

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneValue(nested)]));
  return value;
}

function clamp01(value, fallback) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

function resolveProfile(profileOrCharacterId) {
  const candidate = typeof profileOrCharacterId === "string" ? getTavernEcologyProfile(profileOrCharacterId) : profileOrCharacterId;
  if (!candidate) throw new RangeError(`Unknown tavern ecology character: ${String(profileOrCharacterId)}`);
  return assertValidEcologyProfile(candidate);
}

function initializeDesires(profile) {
  return Object.fromEntries(profile.desires.map((desire) => [desire.id, {
    desireId: desire.id,
    strength: desire.activationMode === "cue_gated"
      ? Math.min(desire.baseStrength, desire.latentActivationCap ?? 0.12)
      : desire.baseStrength,
    activationState: desire.activationMode === "cue_gated" ? "latent" : "active",
    frustration: 0,
    satisfaction: 0,
    lastSatisfiedAtSecond: null,
    lastBlockedAtSecond: null,
  }]));
}

function initializeDuties(profile) {
  return Object.fromEntries(profile.duties.map((duty) => [duty.id, {
    dutyId: duty.id,
    urgency: 0,
    progress: 0,
    active: false,
    lastCompletedAtSecond: null,
  }]));
}

function initializeSensitivities(profile) {
  return Object.fromEntries(profile.sensitivities.map((sensitivity) => [sensitivity.id, {
    sensitivityId: sensitivity.id,
    activation: 0,
    lastTriggeredAtSecond: null,
    matchedCueIds: [],
  }]));
}

export function createInitialEcologyState(profileOrCharacterId, options = {}) {
  const profile = resolveProfile(profileOrCharacterId);
  const elapsedSeconds = Number.isFinite(options.elapsedSeconds) && options.elapsedSeconds >= 0 ? options.elapsedSeconds : 0;
  const body = cloneValue(profile.initialConditions.body);
  const affect = cloneValue(profile.initialConditions.affect);

  for (const [key, value] of Object.entries(options.body || {})) body[key] = clamp01(value, body[key]);
  body.stamina = Object.hasOwn(options.body || {}, "stamina") ? clamp01(body.stamina, body.energy) : body.energy;
  body.fatigue = Object.hasOwn(options.body || {}, "fatigue") ? clamp01(body.fatigue, body.exertion) : body.exertion;
  for (const [key, value] of Object.entries(options.affect || {})) {
    affect[key] = key === "valence" && Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : clamp01(value, affect[key]);
  }

  return {
    schemaVersion: TAVERN_ECOLOGY_STATE_VERSION,
    profileVersion: TAVERN_ECOLOGY_PROFILE_VERSION,
    characterId: profile.characterId,
    elapsedSeconds,
    presence: {
      locationId: options.locationId || profile.initialConditions.locationId,
      zoneId: options.zoneId === undefined ? profile.initialConditions.zoneId : options.zoneId,
      observableAtStage: options.observableAtStage === true,
      arrivedAtSecond: options.observableAtStage === true ? elapsedSeconds : null,
    },
    body,
    affect,
    dynamicPsychology: cloneValue(profile.dynamicPsychologyState || {}),
    desires: initializeDesires(profile),
    duties: initializeDuties(profile),
    sensitivityActivations: initializeSensitivities(profile),
    currentIntention: {
      intentionId: null,
      sourceKind: null,
      sourceId: null,
      actionId: null,
      target: null,
      utility: null,
      committedAtSecond: null,
      interruptedAtSecond: null,
    },
    attention: {
      focusEntityIds: [],
      perceivedEventIds: [],
      pendingImpactIds: [],
    },
    perceivedEnvironment: {
      atmosphere: { privacy: 0.5, crowding: 0, tension: 0, hospitalityPressure: 0 },
      availableAffordanceIds: [],
    },
    recentActionSignatures: [],
    voiceHabitUsage: [],
    lastOutcome: null,
    conversationLocks: {},
  };
}

export function createInitialTavernEcologyStates(optionsByCharacterId = {}) {
  return Object.fromEntries(TAVERN_ECOLOGY_CHARACTER_IDS.map((characterId) => [
    characterId,
    createInitialEcologyState(TAVERN_ECOLOGY_PROFILES[characterId], optionsByCharacterId[characterId] || {}),
  ]));
}

function stateIssue(code, path, message) {
  return { code, path, message };
}

function isUnitInterval(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validateEcologyState(candidate, profileOrCharacterId = candidate?.characterId) {
  const errors = [];
  let profile;
  try {
    profile = resolveProfile(profileOrCharacterId);
  } catch (error) {
    return { valid: false, errors: [stateIssue("STATE_PROFILE_UNKNOWN", "characterId", error.message)] };
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return { valid: false, errors: [stateIssue("STATE_NOT_OBJECT", "state", "人物生态状态必须是对象")] };
  if (candidate.schemaVersion !== TAVERN_ECOLOGY_STATE_VERSION) errors.push(stateIssue("STATE_VERSION_INVALID", "schemaVersion", "人物生态状态版本不匹配"));
  if (candidate.profileVersion !== profile.schemaVersion) errors.push(stateIssue("STATE_PROFILE_VERSION_INVALID", "profileVersion", "状态绑定的档案版本不匹配"));
  if (candidate.characterId !== profile.characterId) errors.push(stateIssue("STATE_CHARACTER_MISMATCH", "characterId", "状态与人物档案不属于同一人物"));
  if (!Number.isFinite(candidate.elapsedSeconds) || candidate.elapsedSeconds < 0) errors.push(stateIssue("STATE_CLOCK_INVALID", "elapsedSeconds", "连续时钟必须是非负秒数"));
  if (!candidate.presence || typeof candidate.presence.locationId !== "string" || !candidate.presence.locationId) errors.push(stateIssue("STATE_LOCATION_MISSING", "presence.locationId", "状态必须有当前位置"));

  for (const [key, value] of Object.entries(candidate.body || {})) {
    if (!isUnitInterval(value)) errors.push(stateIssue("STATE_BODY_VALUE_INVALID", `body.${key}`, "身体状态必须在 0 到 1 之间"));
  }
  if (!candidate.body || Object.keys(candidate.body).length === 0) errors.push(stateIssue("STATE_BODY_MISSING", "body", "状态必须有身体变量"));
  for (const requiredField of ["energy", "stamina", "hunger", "thirst", "pain", "exertion", "fatigue"]) {
    if (!isUnitInterval(candidate.body?.[requiredField])) errors.push(stateIssue("STATE_BODY_FIELD_MISSING", `body.${requiredField}`, "状态缺少统一身体字段或字段超出范围"));
  }
  for (const [key, value] of Object.entries(candidate.affect || {})) {
    const valid = key === "valence" ? Number.isFinite(value) && value >= -1 && value <= 1 : isUnitInterval(value);
    if (!valid) errors.push(stateIssue("STATE_AFFECT_VALUE_INVALID", `affect.${key}`, "情绪状态超出允许范围"));
  }
  if (!candidate.affect || Object.keys(candidate.affect).length === 0) errors.push(stateIssue("STATE_AFFECT_MISSING", "affect", "状态必须有情绪变量"));
  if (!Number.isFinite(candidate.affect?.valence) || candidate.affect.valence < -1 || candidate.affect.valence > 1) errors.push(stateIssue("STATE_AFFECT_FIELD_MISSING", "affect.valence", "状态缺少效价或效价超出范围"));
  for (const field of ["arousal", "dominance"]) {
    if (!isUnitInterval(candidate.affect?.[field])) errors.push(stateIssue("STATE_AFFECT_FIELD_MISSING", `affect.${field}`, "状态缺少统一情绪字段或字段超出范围"));
  }
  for (const stateId of Object.keys(profile.dynamicPsychologyState || {})) {
    if (!isUnitInterval(candidate.dynamicPsychology?.[stateId])) {
      errors.push(stateIssue("STATE_DYNAMIC_PSYCHOLOGY_MISSING", `dynamicPsychology.${stateId}`, "状态缺少人物底座声明的动态心理变量"));
    }
  }

  for (const sensitivity of profile.sensitivities || []) {
    const activation = candidate.sensitivityActivations?.[sensitivity.id];
    if (!activation) {
      errors.push(stateIssue("STATE_SENSITIVITY_MISSING", `sensitivityActivations.${sensitivity.id}`, "状态缺少档案中的敏感点"));
      continue;
    }
    if (activation.sensitivityId !== sensitivity.id) errors.push(stateIssue("STATE_SENSITIVITY_ID_MISMATCH", `sensitivityActivations.${sensitivity.id}.sensitivityId`, "敏感点状态键与 sensitivityId 不一致"));
    if (!isUnitInterval(activation.activation)) errors.push(stateIssue("STATE_SENSITIVITY_VALUE_INVALID", `sensitivityActivations.${sensitivity.id}.activation`, "敏感点激活必须在 0 到 1 之间"));
    if (!Array.isArray(activation.matchedCueIds)) errors.push(stateIssue("STATE_SENSITIVITY_CUES_INVALID", `sensitivityActivations.${sensitivity.id}.matchedCueIds`, "敏感点线索必须是数组"));
  }
  if (!candidate.attention || !Array.isArray(candidate.attention.perceivedEventIds)) errors.push(stateIssue("STATE_ATTENTION_INVALID", "attention.perceivedEventIds", "注意状态必须记录已感知事件数组"));
  if (candidate.copingBiases) {
    for (const field of ["approach", "avoid", "assert", "inhibit", "repair"]) {
      if (!isUnitInterval(candidate.copingBiases[field])) errors.push(stateIssue("STATE_COPING_VALUE_INVALID", `copingBiases.${field}`, "应对倾向必须在 0 到 1 之间"));
    }
    if (!["approach", "avoid", "assert", "inhibit", "repair"].includes(candidate.copingBiases.dominant)) errors.push(stateIssue("STATE_COPING_DOMINANT_INVALID", "copingBiases.dominant", "主导应对方式不在登记集合中"));
    if (candidate.copingBiases.repairNeed !== undefined && !isUnitInterval(candidate.copingBiases.repairNeed)) {
      errors.push(stateIssue("STATE_REPAIR_NEED_INVALID", "copingBiases.repairNeed", "关系修复需要必须在 0 到 1 之间"));
    }
  }

  for (const desire of profile.desires) {
    const state = candidate.desires?.[desire.id];
    if (!state) {
      errors.push(stateIssue("STATE_DESIRE_MISSING", `desires.${desire.id}`, "状态缺少档案中的欲望"));
      continue;
    }
    if (state.desireId !== desire.id) errors.push(stateIssue("STATE_DESIRE_ID_MISMATCH", `desires.${desire.id}.desireId`, "欲望状态键与 desireId 不一致"));
    for (const field of ["strength", "frustration", "satisfaction"]) {
      if (!isUnitInterval(state[field])) errors.push(stateIssue("STATE_DESIRE_VALUE_INVALID", `desires.${desire.id}.${field}`, "欲望状态必须在 0 到 1 之间"));
    }
    if (desire.activationMode === "cue_gated" && !["latent", "active"].includes(state.activationState)) {
      errors.push(stateIssue("STATE_DESIRE_ACTIVATION_STATE_MISSING", `desires.${desire.id}.activationState`, "条件性欲望必须区分潜在状态与已激活状态"));
    }
  }
  for (const desireId of Object.keys(candidate.desires || {})) {
    if (!profile.desires.some((desire) => desire.id === desireId)) errors.push(stateIssue("STATE_DESIRE_UNKNOWN", `desires.${desireId}`, "状态含有档案中不存在的欲望"));
  }

  if (!candidate.currentIntention || typeof candidate.currentIntention !== "object") errors.push(stateIssue("STATE_INTENTION_MISSING", "currentIntention", "状态必须有当前意图槽位"));
  if (!Array.isArray(candidate.recentActionSignatures)) errors.push(stateIssue("STATE_ACTION_HISTORY_INVALID", "recentActionSignatures", "近期行动签名必须是数组"));
  if (!Array.isArray(candidate.voiceHabitUsage)) {
    errors.push(stateIssue("STATE_VOICE_HABIT_HISTORY_INVALID", "voiceHabitUsage", "已实现言语习惯历史必须是数组"));
  } else {
    for (const [index, row] of candidate.voiceHabitUsage.entries()) {
      if (!row || typeof row !== "object" || row.committed !== true || !row.actionId || !row.characterId || !Array.isArray(row.realizedHabitIds)) {
        errors.push(stateIssue("STATE_VOICE_HABIT_HISTORY_ENTRY_INVALID", `voiceHabitUsage[${index}]`, "言语习惯历史只能保存已提交行动、人物、回合与实际习惯 id"));
      }
      if (row && Object.hasOwn(row, "literalSpeech")) {
        errors.push(stateIssue("STATE_VOICE_HABIT_LITERAL_SPEECH_FORBIDDEN", `voiceHabitUsage[${index}].literalSpeech`, "言语习惯疲劳不得保存字面台词"));
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
