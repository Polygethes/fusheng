// Helper factory functions for world casting structures
// Equivalent to jiexing/cast.mjs profile/desire/episode/belief/voice

const SUSTENANCE = Object.freeze({
  schemaVersion: 1,
  authority: "character-embodied-capacity",
  mode: "ordinary_food_dependent",
  authorBand: "ordinary_food_dependent",
  numericAuthority: "engine-operational-default-from-author-band",
  authorNumericCalibration: "unassigned",
  ordinaryFoodDependenceRange: [1, 1],
  ordinaryFoodRecoveryEfficiencyRange: [1, 1],
  basalHungerGrowthRange: [1, 1],
  exertionHungerCouplingRange: [1, 1],
  spiritualFoodConversionRange: [0.25, 0.25],
  fastingToleranceBand: "ordinary",
  alternativeSustenanceSources: [],
  exceptions: [],
  choiceBoundary: "生理档案只改变身体需要与食物转化价值；口味、礼节、社交与个人选择仍由人物独立评价。",
});

export function profile(characterId, name, standing, zoneId, body, affect, personality, sections) {
  return {
    schemaVersion: 1,
    characterId,
    name,
    standing,
    sceneId: sections.sceneId || "scene:town",
    observationStageId: sections.placeId || "loc_town",
    initialConditions: {
      locationId: sections.placeId || "loc_town",
      zoneId,
      body,
      affect,
    },
    sustenanceProfile: SUSTENANCE,
    personality,
    desires: sections.desires || [],
    duties: sections.duties || [],
    principles: sections.principles || [],
    boundaries: sections.boundaries || [],
    sensitivities: sections.sensitivities || [],
    psychologyAnchor: null,
    dynamicPsychologyState: {},
    personalityRuntimeProjection: null,
    runtimeAuthority: null,
    validatedAnchorRuntime: null,
  };
}

export function desire(owner, id, verb, object, outcome, target, baseStrength, growthPerHour, type, criteria) {
  return {
    kind: "desire",
    id,
    ownerCharacterId: owner,
    polarity: "positive",
    desiredState: {
      subjectCharacterId: owner,
      verb,
      object,
      observableOutcome: outcome,
    },
    target,
    baseStrength,
    growthPerHour,
    satisfactionCondition: {
      beneficiaryCharacterId: owner,
      type,
      criteria,
    },
  };
}

export function episode(owner, content, {
  importance = 0.7,
  topic = "",
  cues = [],
  source = "firsthand",
  confidence = 0.92,
  when = "昨夜",
  secondsAgo = 3600,
  about = [],
  index = 1,
} = {}) {
  return {
    id: `episode:town:backstory:${owner}:${index}`,
    ownerCharacterId: owner,
    kind: "backstory",
    perceivedAt: { worldSeconds: -secondsAgo, label: when },
    perception: {
      modality: source === "firsthand" ? "visual" : "sound",
      content,
      topic,
    },
    source: {
      kind: source,
      directness: source === "firsthand" ? 0.9 : 0.4,
      confidence,
    },
    retrievalCues: [...cues, ...about],
    importance,
    accessibility: Math.min(1, importance + 0.05),
    retentionStrength: Math.min(1, importance + 0.1),
    interpretations: [],
  };
}

export function belief(owner, id, proposition, {
  status = "held",
  confidence = 0.7,
  importance = 0.6,
  mysteryId,
} = {}) {
  return {
    id: `belief:town:${owner}:${id}`,
    kind: "belief",
    ownerCharacterId: owner,
    propositionKey: id,
    proposition,
    currentValue: proposition,
    status,
    confidence,
    importance,
    ...(mysteryId ? { mysteryId } : {}),
    supportingEpisodeIds: [],
    conflictingEpisodeIds: [],
    sourceChains: [],
    reasoningMode: "memory",
    lastOperation: "seeded_backstory",
    lastUpdatedAtSeconds: 0,
  };
}

export function voice(stance, priorities, habits, disclosure, rhythm, leakage, silence, surface, registers, drift) {
  return {
    attentionPriorities: priorities,
    appraisalHabits: habits,
    interactionStance: stance,
    disclosureStrategy: disclosure,
    thoughtMovement: ["从眼前看得见、摸得着的事情切入", "根据彼此熟悉程度自然开口"],
    rhythmTendency: rhythm,
    emotionalLeakage: leakage,
    pressureResponse: {
      attentionShift: "先关注身边要紧的生计与亲近之人",
      disclosureShift: "遇事审慎不轻信外人",
      deliveryShift: "节奏因情绪而异",
    },
    silenceStyle: silence,
    surfaceDynamics: {
      base: surface || { directness: 0.5, compression: 0.5, warmth: 0.5, reserve: 0.5, formality: 0.5, emotionalLeakage: 0.2 },
      pressure: { directness: 0.06, compression: 0.14, warmth: -0.08, reserve: 0.12, formality: 0, emotionalLeakage: 0.12 },
      closeness: { directness: 0.05, compression: 0.1, warmth: 0.14, reserve: -0.1, formality: -0.1, emotionalLeakage: 0.08 },
      fatigue: { directness: 0, compression: 0.16, warmth: -0.06, reserve: 0.08, formality: -0.03, emotionalLeakage: 0.12 },
    },
    relationshipRegisters: registers || [],
    driftRisks: drift || [],
  };
}
