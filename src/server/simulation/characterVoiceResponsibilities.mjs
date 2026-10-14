/**
 * Character-private voice responsibility separation.
 *
 * This module is intentionally a pure projection. Cognition may
 * supply attention, role skill may supply expressive resolution, and emotion
 * regulation may supply residual leakage pressure. None of them supplies a
 * service menu, judges a world fact, selects an action, or writes a line.
 */
export const CHARACTER_VOICE_RESPONSIBILITIES_VERSION = "character-voice-responsibilities-v1";

export const VOICE_SURFACE_KEYS = Object.freeze([
  "wording",
  "rhythm",
  "register",
  "relationshipDistance",
  "emotionalLeakageTendency",
]);

const VOICE_PARAMETER_IDS = Object.freeze([
  "directness",
  "compression",
  "warmth",
  "reserve",
  "formality",
  "emotionalLeakage",
]);

const VOICE_CHANNEL_IDS = Object.freeze([
  "voiceOnset",
  "prosody",
  "tempo",
  "pause",
]);

const QUALITATIVE_SKILL_LEVELS = Object.freeze({
  novice: 0.24,
  basic: 0.38,
  familiar: 0.54,
  trained: 0.68,
  trained_routine: 0.72,
  advanced: 0.82,
  expert: 0.9,
  master: 0.96,
});

const DEFAULT_PARAMETER_MODEL = Object.freeze({
  base: Object.freeze({
    directness: 0.5,
    compression: 0.5,
    warmth: 0.5,
    reserve: 0.5,
    formality: 0.5,
    emotionalLeakage: 0.4,
  }),
  pressure: Object.freeze({
    directness: 0,
    compression: 0,
    warmth: 0,
    reserve: 0,
    formality: 0,
    emotionalLeakage: 0,
  }),
  closeness: Object.freeze({
    directness: 0,
    compression: 0,
    warmth: 0,
    reserve: 0,
    formality: 0,
    emotionalLeakage: 0,
  }),
  fatigue: Object.freeze({
    directness: 0,
    compression: 0,
    warmth: 0,
    reserve: 0,
    formality: 0,
    emotionalLeakage: 0,
  }),
});

function clean(value = "") {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => clean(value))
    .filter(Boolean))];
}

function clamp01(value, fallback = 0) {
  const numeric = Number(value);
  return Math.max(0, Math.min(1, Number.isFinite(numeric) ? numeric : fallback));
}

function rounded(value) {
  return Math.round(clamp01(value) * 1000) / 1000;
}

function band(value = 0.5) {
  const numeric = clamp01(value);
  if (numeric >= 0.78) return "very_high";
  if (numeric >= 0.62) return "high";
  if (numeric >= 0.38) return "medium";
  if (numeric >= 0.2) return "low";
  return "very_low";
}

function dimension(value = 0) {
  const normalized = rounded(value);
  return { value: normalized, band: band(normalized) };
}

function parameterRow(source = {}, fallback = {}) {
  return Object.fromEntries(VOICE_PARAMETER_IDS.map((id) => [
    id,
    Number.isFinite(Number(source?.[id])) ? Number(source[id]) : Number(fallback[id] || 0),
  ]));
}

function parameterModel(voiceContract = {}) {
  const source = voiceContract?.voiceFormation?.parameterModel
    || voiceContract?.parameterModel
    || {};
  return {
    base: parameterRow(source.base, DEFAULT_PARAMETER_MODEL.base),
    pressure: parameterRow(source.pressure, DEFAULT_PARAMETER_MODEL.pressure),
    closeness: parameterRow(source.closeness, DEFAULT_PARAMETER_MODEL.closeness),
    fatigue: parameterRow(source.fatigue, DEFAULT_PARAMETER_MODEL.fatigue),
  };
}

function voiceParameters(voiceContract = {}, context = {}) {
  const model = parameterModel(voiceContract);
  const signals = {
    pressure: clamp01(context.pressure),
    closeness: clamp01(context.closeness),
    fatigue: clamp01(context.fatigue),
  };
  return Object.fromEntries(VOICE_PARAMETER_IDS.map((id) => {
    const value = model.base[id]
      + model.pressure[id] * signals.pressure
      + model.closeness[id] * signals.closeness
      + model.fatigue[id] * signals.fatigue;
    return [id, dimension(value)];
  }));
}

function foundationAttentionTargets(foundation = {}) {
  const targets = [];
  for (const registers of [
    foundation.relationshipRegisters,
    foundation.topicRegisters,
    foundation.emotionalTransforms,
  ]) {
    if (!registers || typeof registers !== "object" || Array.isArray(registers)) continue;
    for (const register of Object.values(registers)) {
      targets.push(...unique(register?.attentionTargets || []));
    }
  }
  return unique(targets);
}

function cognitiveAttentionLayer({ voiceContract = {}, voiceFoundation = {}, cognitiveState = {} } = {}) {
  return {
    authority: "character-owned-cognitive-attention",
    selection: null,
    stableAttentionPriorities: unique(voiceContract?.personalityVoice?.attentionPriorities || []),
    stableAppraisalHabits: unique(voiceContract?.personalityVoice?.appraisalHabits || []),
    foundationAttentionTargets: foundationAttentionTargets(voiceFoundation),
    noticedEvidenceIds: unique(cognitiveState.noticedEvidenceIds || []),
    activeAttentionTargets: unique(cognitiveState.activeAttentionTargets || []),
    uncertainty: dimension(cognitiveState.uncertainty),
  };
}

function competenceLevel(row = {}, fallback = 0.5) {
  const range = row.competenceRange || row.range;
  if (Array.isArray(range) && range.length === 2 && range.every((value) => Number.isFinite(Number(value)))) {
    return clamp01((Number(range[0]) + Number(range[1])) / 2, fallback);
  }
  if (Number.isFinite(Number(row.competence ?? row.operationalValue))) {
    return clamp01(row.competence ?? row.operationalValue, fallback);
  }
  const key = clean(row.qualitativeLevel)
    .toLowerCase()
    .replace(/[ -]+/gu, "_");
  if (Object.hasOwn(QUALITATIVE_SKILL_LEVELS, key)) return QUALITATIVE_SKILL_LEVELS[key];
  if (/master|宗师|顶尖/u.test(key)) return QUALITATIVE_SKILL_LEVELS.master;
  if (/expert|精通|专家/u.test(key)) return QUALITATIVE_SKILL_LEVELS.expert;
  if (/advanced|高阶|娴熟/u.test(key)) return QUALITATIVE_SKILL_LEVELS.advanced;
  if (/trained|受训|熟练/u.test(key)) return QUALITATIVE_SKILL_LEVELS.trained;
  if (/familiar|熟悉/u.test(key)) return QUALITATIVE_SKILL_LEVELS.familiar;
  if (/basic|基础/u.test(key)) return QUALITATIVE_SKILL_LEVELS.basic;
  if (/novice|新手/u.test(key)) return QUALITATIVE_SKILL_LEVELS.novice;
  return fallback;
}

function average(values = [], fallback = 0.5) {
  const usable = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!usable.length) return fallback;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function roleSkillLayer(roleSkillProfile = {}) {
  const competenceModel = roleSkillProfile.competenceModel
    || (roleSkillProfile.perceptualCompetences || roleSkillProfile.proceduralCompetences
      ? roleSkillProfile
      : {});
  const perceptualRows = Array.isArray(competenceModel.perceptualCompetences)
    ? competenceModel.perceptualCompetences
    : [];
  const proceduralRows = Array.isArray(competenceModel.proceduralCompetences)
    ? competenceModel.proceduralCompetences
    : [];
  const authoredTerminology = Number.isFinite(Number(roleSkillProfile.terminologyPrecision))
    ? Number(roleSkillProfile.terminologyPrecision)
    : average(perceptualRows.map((row) => competenceLevel(row)), 0.5);
  const authoredProcedural = Number.isFinite(Number(roleSkillProfile.proceduralFluency))
    ? Number(roleSkillProfile.proceduralFluency)
    : average(proceduralRows.map((row) => competenceLevel(row)), 0.5);
  const authoredAudienceAdaptation = Number.isFinite(Number(roleSkillProfile.audienceAdaptation))
    ? Number(roleSkillProfile.audienceAdaptation)
    : 0.5;
  return {
    authority: "character-owned-role-skill",
    selection: null,
    domainIds: unique([
      ...(roleSkillProfile.domainIds || []),
      ...perceptualRows.map((row) => row?.domain),
      ...proceduralRows.map((row) => row?.domain),
    ]),
    attentionLenses: unique([
      ...(roleSkillProfile.attentionLenses || []),
      ...perceptualRows.flatMap((row) => row?.perceptualPriorities || []),
      ...proceduralRows.flatMap((row) => [
        ...(row?.proceduralKnowledge || []),
        ...(row?.executionQualities || []),
      ]),
    ]),
    terminologyPrecision: dimension(authoredTerminology),
    proceduralFluency: dimension(authoredProcedural),
    audienceAdaptation: dimension(authoredAudienceAdaptation),
  };
}

function residualAffect(regulationOutcome = {}) {
  return (Array.isArray(regulationOutcome.residualEmotion) ? regulationOutcome.residualEmotion : [])
    .map((row) => ({
      emotionId: clean(row?.emotionId),
      intensity: dimension(row?.value ?? row?.intensity),
    }))
    .filter((row) => row.emotionId);
}

function voiceChannelLeakage(regulationOutcome = {}) {
  const source = regulationOutcome.channelLeakagePressures || {};
  return Object.fromEntries(VOICE_CHANNEL_IDS.map((id) => [id, dimension(source[id])]));
}

function emotionalRegulationLayer({ voiceContract = {}, regulationOutcome = {} } = {}) {
  return {
    authority: "character-owned-emotion-regulation-residue",
    selection: null,
    remainingControl: dimension(regulationOutcome.remainingControl),
    regulationCost: dimension(regulationOutcome.regulationCost),
    residualAffect: residualAffect(regulationOutcome),
    voiceChannelLeakage: voiceChannelLeakage(regulationOutcome),
    stableLeakageConditions: unique(voiceContract?.personalityVoice?.emotionalLeakage || []),
  };
}

function relationshipDistanceLabel({ rawDistance = "", closeness = 0 } = {}) {
  const normalized = clean(rawDistance).toLocaleLowerCase("zh-CN");
  if (/亲近|熟近|亲密|熟悉|默契|family|close|intimate|familiar/u.test(normalized)) return "familiar";
  if (/疏远|陌生|正式距离|封闭|低暴露|stranger|distant|remote/u.test(normalized)) return "distant";
  if (closeness >= 0.67) return "familiar";
  if (closeness <= 0.25) return "distant";
  return "moderate";
}

function registerKey(value = "") {
  return clean(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Resolve only a delivery register from already-authored relationship and
 * candidate-domain material. This never confirms identity or relationship and
 * never selects an action; it merely chooses which existing register may tint
 * the voice surface.
 */
export function resolveCharacterVoiceRegisterId({
  voiceContract = {},
  relationship = null,
  candidateDomains = [],
} = {}) {
  const registers = voiceContract.relationshipRegisters || {};
  const keys = Object.keys(registers);
  if (!keys.length) return "";
  const byNormalizedKey = new Map(keys.map((key) => [registerKey(key), key]));
  const find = (...aliases) => aliases
    .map(registerKey)
    .map((alias) => byNormalizedKey.get(alias))
    .find(Boolean) || "";
  const explicit = clean(voiceContract.activeContext?.relationshipRegisterId);
  if (explicit && Object.hasOwn(registers, explicit)) return explicit;

  const label = clean(relationship?.label);
  const addresses = unique(relationship?.allowedAddresses || []).join(" ");
  const relationText = `${label} ${addresses}`.toLowerCase();
  if (relationship) {
    const exactLabel = byNormalizedKey.get(registerKey(label));
    if (exactLabel) return exactLabel;
    if (/夫妻|配偶|夫|妻|spouse|partner/u.test(relationText)) {
      const match = find("spouse", "partner", "family");
      if (match) return match;
    }
    if (/父|母|爹|娘|儿|女|兄|弟|姐|妹|家人|family/u.test(relationText)) {
      const match = find("family", "father", "mother", "son", "daughter", "sibling");
      if (match) return match;
    }
    if (/发小|好友|朋友|旧识|同门|熟客|close.?peer|friend/u.test(relationText)) {
      const match = find("closePeer", "close_peer", "friend", "familiar");
      if (match) return match;
    }
    if (/长辈|前辈|长老|师长|elder|senior/u.test(relationText)) {
      const match = find("elder", "senior", "visitingPeer", "visiting_peer");
      if (match) return match;
    }
    if (/东家|掌柜|店家|主人|host/u.test(relationText)) {
      const match = find("host", "tavernHost", "tavern_host");
      if (match) return match;
    }
    if (/客|访|陌生|guest|visitor|stranger/u.test(relationText)) {
      const match = find("stranger", "guest", "supplierOrGuest", "supplier_or_guest");
      if (match) return match;
    }
    const closeness = unitOrFallback(
      relationship?.publicPressure?.closeness ?? relationship?.closeness,
      0,
    );
    if (closeness >= 0.58) {
      const match = find("closePeer", "close_peer", "familiar", "family");
      if (match) return match;
    }
  }

  if ((Array.isArray(candidateDomains) ? candidateDomains : [])
    .some((domain) => /martial|sword|combat|剑|武|交手|比试/u.test(clean(domain)))) {
    const match = find("prospectiveOpponent", "prospective_opponent", "opponent");
    if (match) return match;
  }
  if (!relationship) {
    const stranger = find("stranger");
    if (stranger) return stranger;
  }
  return "";
}

function unitOrFallback(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp01(numeric) : fallback;
}

function wordingToneTags(value = "") {
  const text = clean(value).toLowerCase();
  const tags = [];
  const add = (tag, pattern) => { if (pattern.test(text)) tags.push(tag); };
  add("direct", /直接|利落|坦率|direct|plainspoken/u);
  add("restrained", /克制|寡言|保留|内敛|restrain|reserved/u);
  add("cool", /冷静|冷淡|冷若|疏离|cool|aloof/u);
  add("warm", /温和|体贴|亲切|照料|warm|gentle/u);
  add("formal", /正式|守礼|礼数|权威|formal|courteous/u);
  add("youthful", /少年|年轻|天真|youth/u);
  add("practical", /实际|务实|现实|practical/u);
  add("precise", /精确|具体|客观|precise|exact/u);
  add("patient", /耐心|从容|patient/u);
  add("confident", /自信|清高|风头正盛|confident|proud/u);
  return unique(tags);
}

function rhythmTags(value = "") {
  const text = clean(value).toLowerCase();
  const tags = [];
  const add = (tag, pattern) => { if (pattern.test(text)) tags.push(tag); };
  add("usually_concise", /简练|简短|短句|惜字|concise|brief/u);
  add("can_expand_when_needed", /完整|展开|长句|说长|elaborat|complete sentence/u);
  add("allows_pause", /停顿|停一|pause/u);
  add("allows_self_correction", /改口|收住|self.?correct/u);
  add("measured", /冷静|平静|从容|measured|calm/u);
  add("ordered", /条理|逐项|ordered|structured/u);
  add("contextual_lead_in", /铺垫|自然转入|lead.?in/u);
  return unique(tags);
}

function relationshipRegisterTags(register = {}) {
  const text = `${clean(register.distance)} ${clean(register.adjustment || register.description)}`.toLowerCase();
  const tags = [];
  const add = (tag, pattern) => { if (pattern.test(text)) tags.push(tag); };
  add("contextual_ellipsis", /省略|少解释|默认默契|共享前情|ellipsis/u);
  add("softened_delivery", /语气可软|温和|体贴|soft/u);
  add("formal_courtesy", /守礼|礼数|正式|formal|courteous/u);
  add("low_disclosure", /低暴露|低披露|保留距离|封闭|不分享|low disclosure/u);
  add("plain_address", /称呼简短|不用称号|plain address/u);
  add("respectful_distance", /尊重|长老|晚辈|respect/u);
  return unique(tags);
}

function relationshipDistanceSurface({ voiceContract = {}, context = {}, parameters = {} } = {}) {
  const registerId = clean(context.relationshipRegisterId);
  const register = registerId && voiceContract?.relationshipRegisters?.[registerId];
  const closeness = rounded(context.closeness);
  return {
    registerId,
    distanceLabel: relationshipDistanceLabel({ rawDistance: register?.distance, closeness }),
    closeness: dimension(closeness),
    reserve: parameters.reserve,
  };
}

function technicalPrecision(roleSkill = {}) {
  return dimension((
    Number(roleSkill.terminologyPrecision?.value || 0)
    + Number(roleSkill.proceduralFluency?.value || 0)
  ) / 2);
}

function leakageSurface(parameters = {}, regulation = {}) {
  const channel = regulation.voiceChannelLeakage || {};
  const peakChannelLeakage = Math.max(0, ...VOICE_CHANNEL_IDS.map((id) => Number(channel[id]?.value || 0)));
  const base = Number(parameters.emotionalLeakage?.value || 0);
  const control = Number(regulation.remainingControl?.value || 0);
  const overall = clamp01(base * 0.72 + peakChannelLeakage * 0.38 - control * 0.1);
  return {
    overall: dimension(overall),
    voiceOnset: channel.voiceOnset,
    prosody: channel.prosody,
    tempo: channel.tempo,
    pause: channel.pause,
  };
}

function voiceSurfaceLayer({ voiceContract = {}, roleSkill = {}, regulation = {}, context = {} } = {}) {
  const parameters = voiceParameters(voiceContract, context);
  const precision = technicalPrecision(roleSkill);
  const interactionStance = clean(voiceContract?.personalityVoice?.interactionStance);
  const rhythmTendency = clean(voiceContract?.expressionTendencies?.rhythmTendency);
  const registerId = clean(context.relationshipRegisterId);
  const relationshipRegister = registerId
    ? voiceContract?.relationshipRegisters?.[registerId] || {}
    : {};
  return {
    wording: {
      directness: parameters.directness,
      compression: parameters.compression,
      warmth: parameters.warmth,
      reserve: parameters.reserve,
      technicalPrecision: precision,
      toneTags: wordingToneTags(interactionStance),
    },
    rhythm: {
      compression: parameters.compression,
      fatigueDrag: dimension(context.fatigue),
      tempoVariability: regulation.voiceChannelLeakage.tempo,
      pauseTendency: regulation.voiceChannelLeakage.pause,
      tendencyTags: rhythmTags(rhythmTendency),
    },
    register: {
      formality: parameters.formality,
      warmth: parameters.warmth,
      technicalPrecision: precision,
      audienceAdaptation: roleSkill.audienceAdaptation,
      surfaceAdjustmentTags: relationshipRegisterTags(relationshipRegister),
    },
    relationshipDistance: relationshipDistanceSurface({ voiceContract, context, parameters }),
    emotionalLeakageTendency: {
      ...leakageSurface(parameters, regulation),
    },
  };
}

/**
 * Separates existing voiceContract/voiceFoundation data into four explicit
 * responsibilities. The returned voiceSurface is a closed allow-list and is
 * therefore unable to carry semantic options, world conclusions, actions or
 * literal dialogue even when such fields are present in the input object.
 */
export function buildCharacterVoiceResponsibilities({
  voiceContract = {},
  voiceFoundation = voiceContract?.voiceFoundation || {},
  cognitiveState = {},
  roleSkillProfile = {},
  regulationOutcome = {},
  context = {},
} = {}) {
  const cognitiveAttention = cognitiveAttentionLayer({
    voiceContract,
    voiceFoundation,
    cognitiveState,
  });
  const roleSkill = roleSkillLayer(roleSkillProfile);
  const emotionalRegulation = emotionalRegulationLayer({ voiceContract, regulationOutcome });
  const voiceSurface = voiceSurfaceLayer({
    voiceContract,
    roleSkill,
    regulation: emotionalRegulation,
    context,
  });
  return {
    schemaVersion: 1,
    toolVersion: CHARACTER_VOICE_RESPONSIBILITIES_VERSION,
    authority: "character-private-voice-responsibility-separation",
    selection: null,
    cognitiveAttention,
    roleSkill,
    emotionalRegulation,
    voiceSurface,
    boundary: {
      cognitionMayNoticeButNotChooseAction: true,
      roleSkillMayShapePrecisionButNotSupplyFacts: true,
      regulationMayShapeLeakageButNotChooseExpression: true,
      surfaceMayShapeDeliveryButNotSupplyMeaning: true,
      mayNotReadServiceMenusOrAffordances: true,
      mayNotJudgeWorldFacts: true,
      mayNotSelectActions: true,
      mayNotWriteLiteralSpeech: true,
    },
  };
}
