export const CHARACTER_VOICE_HABIT_TOOL_VERSION = "character-voice-habit-tool-v1";

const QUALITATIVE_LEVELS = Object.freeze({
  very_low: 0.12,
  low: 0.28,
  medium: 0.5,
  high: 0.7,
  very_high: 0.86,
});

const MODULATOR_STRENGTHS = Object.freeze({
  very_low: 0.025,
  low: 0.06,
  medium: 0.1,
  high: 0.16,
  very_high: 0.22,
});

const REPEAT_PENALTIES = Object.freeze({
  very_low: 0.025,
  low: 0.055,
  medium: 0.09,
  high: 0.14,
  very_high: 0.2,
});

const TAG_SIGNALS = new Set(["topic", "relationship", "affect", "body", "venue", "turnMode"]);
const CONTINUOUS_SIGNALS = new Set([
  "publicExposure", "closeness", "tension", "arousal", "fatigue",
  "motiveAlignment", "disclosurePressure", "inhibitionPressure",
]);
const MODULATOR_SIGNALS = new Set([...TAG_SIGNALS, ...CONTINUOUS_SIGNALS]);
const DIRECTIONS = new Set(["increase", "decrease"]);
const HABIT_KINDS = new Set(["discourse", "rhythm", "attention", "turn_taking", "surface"]);

const FORBIDDEN_LITERAL_KEYS = new Set([
  "line", "lines", "phrase", "phrases", "fixedphrase", "fixedphrases", "literal", "literals",
  "literalspeech", "candidateLine", "candidateLines", "example", "examples", "mustuse", "requiredtoken",
  "requiredtokens", "signatureword", "signaturewords", "canonicaltext", "acceptedline", "acceptedlines",
].map((value) => value.toLowerCase()));

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => clean(value)).filter(Boolean))];
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function rounded(value) {
  return Math.round(clamp01(value) * 1000) / 1000;
}

function qualitativeKey(value = "medium") {
  const normalized = clean(value).toLowerCase().replace(/[ -]+/g, "_");
  if (Object.hasOwn(QUALITATIVE_LEVELS, normalized)) return normalized;
  if (/very.*high|extreme|极高|很强/u.test(normalized)) return "very_high";
  if (/high|strong|高|强/u.test(normalized)) return "high";
  if (/very.*low|极低/u.test(normalized)) return "very_low";
  if (/low|weak|低|弱/u.test(normalized)) return "low";
  return "medium";
}

function operationalLevel(value, table = QUALITATIVE_LEVELS) {
  if (Number.isFinite(Number(value))) return clamp01(value);
  if (Array.isArray(value) && value.length === 2 && value.every((row) => Number.isFinite(Number(row)))) {
    return clamp01((Number(value[0]) + Number(value[1])) / 2);
  }
  if (value && typeof value === "object") {
    if (Array.isArray(value.range)) return operationalLevel(value.range, table);
    if (Number.isFinite(Number(value.operationalValue))) return clamp01(value.operationalValue);
    return Number(table[qualitativeKey(value.qualitativeLevel)] ?? table.medium ?? 0.5);
  }
  return Number(table[qualitativeKey(value)] ?? table.medium ?? 0.5);
}

function issue(code, path, message) {
  return { code, path, message };
}

function visitForbiddenLiteralKeys(value, path, issues, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((row, index) => visitForbiddenLiteralKeys(row, `${path}[${index}]`, issues, seen));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const keyId = clean(key).toLowerCase();
    if (FORBIDDEN_LITERAL_KEYS.has(keyId)) {
      issues.push(issue(
        "VOICE_HABIT_LITERAL_TEMPLATE_FORBIDDEN",
        `${path}.${key}`,
        "Voice habits may describe functions and tendencies but may not store a line, phrase, required token or canonical wording.",
      ));
    }
    visitForbiddenLiteralKeys(child, `${path}.${key}`, issues, seen);
  }
}

function normalizeHabit(raw = {}, index = 0, issues = []) {
  const path = `voiceFoundation.habits[${index}]`;
  const id = clean(raw.id);
  if (!id) issues.push(issue("VOICE_HABIT_ID_MISSING", `${path}.id`, "Every speech habit needs a stable id."));
  const kind = clean(raw.kind || "discourse");
  if (!HABIT_KINDS.has(kind)) issues.push(issue("VOICE_HABIT_KIND_INVALID", `${path}.kind`, `Unsupported speech habit kind ${kind || "(empty)"}.`));
  const fn = clean(raw.function);
  if (!fn) issues.push(issue("VOICE_HABIT_FUNCTION_MISSING", `${path}.function`, "A speech habit must name its pragmatic or surface function without providing wording."));
  const baselineKey = qualitativeKey(raw.baseline?.qualitativeLevel || raw.baseline || "medium");
  const modulators = (Array.isArray(raw.modulators) ? raw.modulators : []).map((row, modulatorIndex) => {
    const modulatorPath = `${path}.modulators[${modulatorIndex}]`;
    const signal = clean(row?.signal);
    const direction = clean(row?.direction);
    if (!MODULATOR_SIGNALS.has(signal)) issues.push(issue("VOICE_HABIT_MODULATOR_SIGNAL_INVALID", `${modulatorPath}.signal`, `Unsupported context signal ${signal || "(empty)"}.`));
    if (!DIRECTIONS.has(direction)) issues.push(issue("VOICE_HABIT_MODULATOR_DIRECTION_INVALID", `${modulatorPath}.direction`, "Habit modulation must increase or decrease pressure."));
    return {
      signal,
      matches: unique(row?.matches || []),
      direction,
      strength: qualitativeKey(row?.strength || "medium"),
    };
  });
  const repeatSensitivity = qualitativeKey(raw.fatigue?.repeatSensitivity || "medium");
  const cooldownTurns = Math.max(1, Math.min(20, Math.round(Number(raw.fatigue?.cooldownTurns) || 4)));
  const minimumPressure = qualitativeKey(raw.fatigue?.minimumPressure || "very_low");
  return {
    id,
    kind,
    function: fn,
    description: clean(raw.description),
    baseline: {
      qualitativeLevel: baselineKey,
      operationalValue: rounded(QUALITATIVE_LEVELS[baselineKey]),
      numericAuthority: "engine-operational-default",
    },
    modulators,
    realizationChannels: unique(raw.realizationChannels || []),
    fatigue: {
      repeatSensitivity,
      operationalPenalty: rounded(REPEAT_PENALTIES[repeatSensitivity]),
      cooldownTurns,
      minimumPressure,
      operationalFloor: rounded(QUALITATIVE_LEVELS[minimumPressure]),
      numericAuthority: "engine-operational-default",
    },
  };
}

function normalizeRegisters(source = {}) {
  return Object.fromEntries(Object.entries(source && typeof source === "object" && !Array.isArray(source) ? source : {})
    .map(([id, row]) => [clean(id), {
      description: clean(row?.description || row?.adjustment || row),
      habitAdjustments: Object.fromEntries(Object.entries(row?.habitAdjustments || {})
        .map(([habitId, direction]) => [clean(habitId), clean(direction)])
        .filter(([habitId, direction]) => habitId && DIRECTIONS.has(direction))),
      attentionTargets: unique(row?.attentionTargets || []),
    }])
    .filter(([id]) => id));
}

export function compileCharacterVoiceFoundation(source = {}) {
  const issues = [];
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    const error = new TypeError("Character voice foundation must be an object.");
    error.code = "CHARACTER_VOICE_FOUNDATION_INVALID";
    error.issues = [issue("VOICE_FOUNDATION_NOT_OBJECT", "voiceFoundation", "Character voice foundation must be an object.")];
    throw error;
  }
  visitForbiddenLiteralKeys(source, "voiceFoundation", issues);
  const habits = (Array.isArray(source.habits) ? source.habits : []).map((row, index) => normalizeHabit(row, index, issues));
  const ids = new Set();
  for (const [index, habit] of habits.entries()) {
    if (habit.id && ids.has(habit.id)) issues.push(issue("VOICE_HABIT_ID_DUPLICATE", `voiceFoundation.habits[${index}].id`, `Duplicate speech habit id ${habit.id}.`));
    if (habit.id) ids.add(habit.id);
  }
  if (!habits.length) issues.push(issue("VOICE_FOUNDATION_HABITS_MISSING", "voiceFoundation.habits", "A voice foundation needs at least one conditional speech habit."));
  const relationshipRegisters = normalizeRegisters(source.relationshipRegisters || {});
  const topicRegisters = normalizeRegisters(source.topicRegisters || {});
  for (const [registerKind, registers] of [["relationshipRegisters", relationshipRegisters], ["topicRegisters", topicRegisters]]) {
    for (const [registerId, register] of Object.entries(registers)) {
      for (const habitId of Object.keys(register.habitAdjustments || {})) {
        if (!ids.has(habitId)) issues.push(issue("VOICE_REGISTER_HABIT_UNKNOWN", `voiceFoundation.${registerKind}.${registerId}.habitAdjustments.${habitId}`, `Unknown speech habit ${habitId}.`));
      }
    }
  }
  if (issues.length) {
    const error = new TypeError("Character voice foundation failed validation.");
    error.code = "CHARACTER_VOICE_FOUNDATION_INVALID";
    error.issues = issues;
    throw error;
  }
  return Object.freeze({
    schemaVersion: Number(source.schemaVersion || 1),
    authority: "character-voice-foundation",
    numericStatus: clean(source.numericStatus || "engine-operational-default-from-qualitative-foundation"),
    habits: clone(habits),
    relationshipRegisters: clone(relationshipRegisters),
    topicRegisters: clone(topicRegisters),
    emotionalTransforms: clone(normalizeRegisters(source.emotionalTransforms || {})),
    surfaceRule: "Speech habits describe conditional pressure and attention. They never prescribe a line, phrase, sentence count or required token.",
  });
}

function compiledFoundation(source = {}) {
  return source?.authority === "character-voice-foundation"
    ? source
    : compileCharacterVoiceFoundation(source);
}

function tagValues(context = {}, signal = "") {
  if (signal === "topic") return unique(context.topicTags || []);
  if (signal === "relationship") return unique(context.relationshipTags || []);
  if (signal === "affect") return unique(context.affectTags || []);
  if (signal === "body") return unique(context.bodyTags || []);
  if (signal === "venue") return unique(context.venueTags || []);
  if (signal === "turnMode") return unique([context.turnMode]);
  return [];
}

function modulatorActivation(modulator = {}, context = {}) {
  if (TAG_SIGNALS.has(modulator.signal)) {
    const actual = new Set(tagValues(context, modulator.signal));
    const expected = unique(modulator.matches || []);
    return expected.length && expected.some((value) => actual.has(value)) ? 1 : 0;
  }
  if (CONTINUOUS_SIGNALS.has(modulator.signal)) return clamp01(context[modulator.signal]);
  return 0;
}

function activeRegisterAdjustment(foundation = {}, context = {}, habitId = "") {
  let signed = 0;
  const evidence = [];
  for (const [registerKind, activeIds] of [
    ["relationshipRegisters", unique(context.relationshipTags || [])],
    ["topicRegisters", unique(context.topicTags || [])],
    ["emotionalTransforms", unique(context.affectTags || [])],
  ]) {
    for (const registerId of activeIds) {
      const direction = foundation[registerKind]?.[registerId]?.habitAdjustments?.[habitId];
      if (!DIRECTIONS.has(direction)) continue;
      signed += direction === "increase" ? 0.08 : -0.08;
      evidence.push({ registerKind, registerId, direction });
    }
  }
  return { signed, evidence };
}

function recentHabitFatigue(habit = {}, history = [], currentTurnIndex = 0) {
  const cooldown = Math.max(1, Number(habit.fatigue?.cooldownTurns || 4));
  const perUse = Number(habit.fatigue?.operationalPenalty || 0.09);
  const relevant = (Array.isArray(history) ? history : []).filter((row) => (
    row?.committed === true
    && Array.isArray(row.realizedHabitIds)
    && row.realizedHabitIds.includes(habit.id)
  ));
  let weightedUses = 0;
  for (const row of relevant) {
    const turnIndex = Number(row.turnIndex || 0);
    const age = currentTurnIndex > 0 && turnIndex > 0 ? Math.max(0, currentTurnIndex - turnIndex) : 1;
    if (age > cooldown) continue;
    weightedUses += Math.max(0, 1 - age / cooldown);
  }
  return {
    weightedUses: Math.round(weightedUses * 1000) / 1000,
    committedUseCount: relevant.length,
    penalty: Math.round(perUse * weightedUses * 1000) / 1000,
  };
}

function pressureBand(value = 0) {
  if (value >= 0.78) return "very_high";
  if (value >= 0.62) return "high";
  if (value >= 0.42) return "medium";
  if (value >= 0.22) return "low";
  return "very_low";
}

function matchingAttentionTargets(foundation = {}, context = {}) {
  const result = [];
  for (const topicId of unique(context.topicTags || [])) result.push(...(foundation.topicRegisters?.[topicId]?.attentionTargets || []));
  for (const relationshipId of unique(context.relationshipTags || [])) result.push(...(foundation.relationshipRegisters?.[relationshipId]?.attentionTargets || []));
  for (const affectId of unique(context.affectTags || [])) result.push(...(foundation.emotionalTransforms?.[affectId]?.attentionTargets || []));
  return unique(result);
}

export function buildCharacterSpeechHabitPressureTool({
  characterId = "",
  foundation = {},
  context = {},
  recentCommittedSpeech = [],
} = {}) {
  const compiled = compiledFoundation(foundation);
  const currentTurnIndex = Number(context.turnIndex || 0);
  const habitPressures = {};
  const factorLedger = {};
  for (const habit of compiled.habits) {
    const baseline = Number(habit.baseline.operationalValue || 0.5);
    const factors = [];
    let value = baseline;
    for (const modulator of habit.modulators || []) {
      const activation = modulatorActivation(modulator, context);
      const strength = Number(MODULATOR_STRENGTHS[qualitativeKey(modulator.strength)] || MODULATOR_STRENGTHS.medium);
      const positive = modulator.direction === "increase";
      const contribution = positive
        ? strength * activation * (1 - baseline)
        : -strength * activation * baseline;
      value += contribution;
      factors.push({
        signal: modulator.signal,
        direction: modulator.direction,
        strength: modulator.strength,
        activation: rounded(activation),
        contribution: Math.round(contribution * 1000) / 1000,
      });
    }
    const registerAdjustment = activeRegisterAdjustment(compiled, context, habit.id);
    value += registerAdjustment.signed * (registerAdjustment.signed >= 0 ? 1 - baseline : baseline);
    const repetitionFatigue = recentHabitFatigue(habit, recentCommittedSpeech, currentTurnIndex);
    value -= repetitionFatigue.penalty;
    value = Math.max(Number(habit.fatigue.operationalFloor || 0), clamp01(value));
    habitPressures[habit.id] = {
      habitId: habit.id,
      kind: habit.kind,
      function: habit.function,
      description: habit.description,
      value: rounded(value),
      band: pressureBand(value),
      realizationChannels: clone(habit.realizationChannels || []),
      repeatFatigue: {
        band: pressureBand(Math.min(1, repetitionFatigue.penalty * 3)),
        committedUseCount: repetitionFatigue.committedUseCount,
      },
    };
    factorLedger[habit.id] = {
      baseline: rounded(baseline),
      contextModulators: factors,
      registerAdjustments: clone(registerAdjustment.evidence),
      repetitionFatigue,
      operationalFloor: Number(habit.fatigue.operationalFloor || 0),
    };
  }
  return {
    schemaVersion: 1,
    toolVersion: CHARACTER_VOICE_HABIT_TOOL_VERSION,
    authority: "character-private-speech-habit-tool",
    characterId: clean(characterId),
    selectionAuthority: "character-agent",
    selection: null,
    formula: "H=clamp(B+context_modulators+register_modulators-committed_repeat_fatigue,habit_floor,1)",
    contextSignals: {
      topicTags: unique(context.topicTags || []),
      relationshipTags: unique(context.relationshipTags || []),
      affectTags: unique(context.affectTags || []),
      bodyTags: unique(context.bodyTags || []),
      venueTags: unique(context.venueTags || []),
      turnMode: clean(context.turnMode),
      publicExposure: rounded(context.publicExposure),
      closeness: rounded(context.closeness),
      tension: rounded(context.tension),
      arousal: rounded(context.arousal),
      fatigue: rounded(context.fatigue),
      motiveAlignment: rounded(context.motiveAlignment),
      disclosurePressure: rounded(context.disclosurePressure),
      inhibitionPressure: rounded(context.inhibitionPressure),
    },
    attentionTargets: matchingAttentionTargets(compiled, context),
    habitPressures,
    factorLedger,
    recentUsageSummary: {
      committedEntriesConsidered: (Array.isArray(recentCommittedSpeech) ? recentCommittedSpeech : []).filter((row) => row?.committed === true).length,
      literalSpeechStored: false,
    },
    forbiddenAuthority: {
      mayNotSelectHabit: true,
      mayNotSelectAction: true,
      mayNotChooseDisclosure: true,
      mayNotWriteDialogue: true,
      mayNotRewriteAfterGeneration: true,
    },
  };
}

export function projectCharacterSpeechHabitSurface(tool = {}) {
  return {
    schemaVersion: 1,
    authority: "character-private-speech-habit-surface",
    characterId: clean(tool.characterId),
    selectionAuthority: "character-agent",
    selection: null,
    attentionTargets: unique(tool.attentionTargets || []),
    habitPressures: Object.fromEntries(Object.entries(tool.habitPressures || {}).map(([id, row]) => [id, {
      habitId: clean(row?.habitId || id),
      kind: clean(row?.kind),
      function: clean(row?.function),
      description: clean(row?.description),
      pressureBand: clean(row?.band),
      realizationChannels: unique(row?.realizationChannels || []),
      repeatFatigueBand: clean(row?.repeatFatigue?.band),
    }])),
    surfaceRule: "These are conditional tendencies, not required moves. The Character Agent may follow, combine, resist or depart from them and must generate the actual wording.",
    forbiddenAuthority: clone(tool.forbiddenAuthority || {}),
  };
}

export function recordCommittedSpeechHabitUse(history = [], action = {}, { foundation = {} } = {}) {
  const source = Array.isArray(history) ? history : [];
  if (action?.committed !== true) return clone(source);
  const actionId = clean(action.actionId || action.id);
  const characterId = clean(action.characterId || action.actorId);
  if (!actionId || !characterId) return clone(source);
  if (source.some((row) => clean(row?.actionId) === actionId)) return clone(source);
  const compiled = compiledFoundation(foundation);
  const knownIds = new Set(compiled.habits.map((row) => row.id));
  const realizedHabitIds = unique(action.realizedHabitIds || action.speechHabitIds || []).filter((id) => knownIds.has(id));
  if (!realizedHabitIds.length) return clone(source);
  return [
    ...clone(source),
    {
      actionId,
      characterId,
      committed: true,
      turnIndex: Math.max(0, Math.round(Number(action.turnIndex || action.step || 0))),
      realizedHabitIds,
    },
  ].slice(-32);
}
