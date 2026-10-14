/**
 * Deterministic appraisal for an event that physically reached one tavern Agent.
 *
 * This module is deliberately pure and model-free.  `observerTrace` is returned
 * separately and is never written into `nextState`, so another character Agent
 * cannot receive the observer explanation as if it were world knowledge.
 */

export const TAVERN_EVENT_APPRAISAL_VERSION = 1;

const COPING_KEYS = Object.freeze(["approach", "avoid", "assert", "inhibit", "repair"]);
const DEFAULT_AFFECT_HALF_LIFE_SECONDS = 1800;
const MAX_PERCEIVED_EVENT_IDS = 48;

const INFERRED_CUE_PATTERNS = Object.freeze({
  public_scrutiny: /当众|众人|人前|围观|公开/u,
  genius_title: /天才|璞玉|奇才/u,
  forced_answer: /现在.{0,8}(?:回答|答复)|必须.{0,8}(?:回答|答复)|逼.{0,8}(?:回答|表态)/u,
  heavy_exertion: /力竭|重活|搬运|劈柴|大汗/u,
  visible_breathlessness: /喘|气息不稳|呼吸急促/u,
  crowd_attention: /围观|众人.{0,8}(?:看|听)|所有人.{0,8}(?:看|听)/u,
  public_question_about_money: /(?:当众|人前|外客|众人).{0,24}(?:钱|账|当票)|(?:钱|药钱|来路).{0,18}(?:哪里来|哪来的|说清)/u,
  pawn_ticket_reference: /当票|典当/u,
  unrecorded_shortage: /短缺.{0,12}(?:没记|未记)|尚未.{0,8}记账/u,
  unpaid_delivery: /货款.{0,12}(?:未付|没付)|欠.{0,8}货款/u,
  low_operating_reserve: /周转.{0,8}(?:不足|不够)|钱箱.{0,8}(?:见底|没钱)/u,
  vague_money_answer: /钱.{0,10}(?:自有来路|你别问|以后再说)|私房.{0,10}(?:说不清|不便说)/u,
  topic_deflection: /别再问|改日再说|先不说这个|岔开话/u,
  repeated_delay: /再等等|明日再说|明早再说|以后再说/u,
  waiting_guest: /客人.{0,8}(?:等|候)|来客.{0,8}(?:无人|没人).{0,6}(?:招呼|接待)/u,
  meal_queue: /等饭|催饭|饭还没上/u,
  room_request: /住店|客房|要房/u,
  crowded_tavern: /满堂|客满|堂前.{0,8}挤/u,
  vague_answer: /没拿定|再想想|到时再说|含糊/u,
  walk_away_during_request: /话没说完.{0,12}(?:走|离开)|转身.{0,8}(?:走|离开)/u,
  unkept_reply_time: /失约|过了.{0,8}(?:答复|回话).{0,8}时辰|没有按时.{0,8}(?:答复|回话)/u,
  care_called_favor: /人情|恩情|讨债|欠我/u,
  senior_present: /长老|师长|前辈在场/u,
  crowded_public_space: /人多|公共场合|满堂|众目/u,
  spectator_attention: /看客|围观|观战/u,
  teasing_about_interest: /取笑|打趣|起哄/u,
  hearsay_verdict: /听说.{0,18}(?:胜|败|强|弱)|传闻.{0,18}(?:胜|败|强|弱)/u,
  prewritten_evaluation: /早有定论|评语已经写好|替.{0,8}评价/u,
  rank_based_claim: /只凭.{0,8}(?:排名|宗门|名次)|因为.{0,8}(?:排名|宗门).{0,8}所以/u,
  unsourced_rumor: /听人说|不知谁说|传言|没有来源/u,
  contradictory_testimony: /说法矛盾|前后不一|证词不一/u,
  missing_record: /没有记录|名录缺失|查无记录/u,
  request_to_skip_review: /不用核验|跳过核验|直接盖印/u,
  public_pressure: /当众施压|众人逼迫|公开施压/u,
  premature_promise: /先答应再说|尚未核验.{0,8}答应/u,
  accusation_of_free_meal: /白吃|蹭饭|占便宜/u,
  unearned_help: /不用做活|免了杂务|没验收.{0,8}(?:给饭|端饭)/u,
  status_comparison: /比不上|不如.{0,8}(?:内门|师兄|别人)|出身/u,
  high_hunger: /饿得|饥饿|空腹/u,
  high_exertion: /脱力|耗尽|手臂发酸|力竭/u,
  hand_tremor: /手抖|手指发颤|握不稳/u,
});

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneValue(nested)]));
  }
  return value;
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, finite(value)));
}

function unit(value, fallback = 0) {
  if (value == null || value === "") return fallback;
  const number = finite(value, fallback);
  return clamp(Math.abs(number) > 1 ? number / 100 : number);
}

function signedUnit(value, fallback = 0) {
  if (value == null || value === "") return fallback;
  const number = finite(value, fallback);
  return clamp(Math.abs(number) > 1 ? number / 100 : number, -1, 1);
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(finite(value) * scale) / scale;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

function normalizedCue(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function eventText(delivery = {}, impact = {}) {
  return [impact.content, impact.topic, delivery.content, delivery.topic]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function eventCueIds(delivery = {}, impact = {}) {
  const explicit = [
    ...asArray(impact.cueIds),
    ...asArray(impact.cues),
    ...asArray(impact.tags),
    ...asArray(impact.actionOutcome?.cueIds),
    ...asArray(delivery.cueIds),
    ...asArray(delivery.cues),
    ...asArray(delivery.tags),
  ].map(normalizedCue).filter(Boolean);
  const text = eventText(delivery, impact);
  const inferred = Object.entries(INFERRED_CUE_PATTERNS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([cueId]) => cueId);
  return [...new Set([...explicit, ...inferred])];
}

function relationshipFactors(relationship = {}) {
  const publicPressure = relationship.publicPressure || {};
  const dependence = unit(relationship.dependence);
  const protection = unit(relationship.protection);
  const resentment = unit(relationship.resentment);
  const fear = unit(relationship.fear);
  const closeness = unit(firstDefined(
    relationship.closeness,
    publicPressure.closeness,
    dependence || protection ? (dependence + protection) / 2 : undefined,
  ));
  const tension = unit(firstDefined(
    relationship.tension,
    publicPressure.tension,
    resentment || fear ? (resentment + fear) / 2 : undefined,
  ));
  const trust = unit(firstDefined(relationship.trust, clamp((closeness + (1 - tension)) / 2)));
  return { closeness, tension, trust, dependence, protection, resentment, fear };
}

function impactIdFor(delivery = {}, impact = {}) {
  return String(delivery.impactId || impact.id || impact.impactId || "").trim();
}

function isPerceived(profile = {}, delivery = {}, impact = {}) {
  if (!delivery || typeof delivery !== "object" || delivery.perceived === false) return false;
  const impactId = impactIdFor(delivery, impact);
  if (!impactId) return false;
  if (impact.id && delivery.impactId && impact.id !== delivery.impactId) return false;
  if (delivery.recipientId && profile.characterId && delivery.recipientId !== profile.characterId) return false;
  return true;
}

function isCommitted(delivery = {}, impact = {}) {
  const flags = [
    impact.committed,
    impact.actionCommitted,
    impact.actionOutcome?.committed,
    delivery.committed,
  ].filter((value) => typeof value === "boolean");
  if (flags.includes(false)) return false;
  if (flags.includes(true)) return true;
  const status = String(firstDefined(impact.status, impact.actionOutcome?.status, delivery.status, "")).toLowerCase();
  if (["draft", "pending", "proposed", "rejected", "uncommitted", "invalid"].includes(status)) return false;
  // A runtime delivery is only emitted after the action/world impact is committed.
  return Boolean(impactIdFor(delivery, impact));
}

function eventSalience(delivery = {}, impact = {}) {
  return unit(firstDefined(
    impact.salience,
    delivery.salience,
    delivery.impactScore,
    delivery.receivedIntensity,
    impact.intensity,
    0.5,
  ), 0.5);
}

function inferredValence(delivery = {}, impact = {}) {
  const explicit = firstDefined(
    impact.outcomeValence,
    impact.valence,
    impact.actionOutcome?.valence,
    delivery.outcomeValence,
    delivery.valence,
  );
  if (explicit != null) return signedUnit(explicit);
  const speechAct = String(impact.speechAct || impact.actionOutcome?.speechAct || "");
  if (["warn", "refuse"].includes(speechAct)) return -0.35;
  if (["greet", "offer", "confide"].includes(speechAct)) return 0.2;
  if (impact.actionOutcome?.satisfactionConditionMet === true) return 0.4;
  if (impact.actionOutcome?.blocked === true) return -0.4;
  return 0;
}

function eventDimensions(delivery = {}, impact = {}, matchedSensitivityPeak = 0, relationship = {}) {
  const salience = eventSalience(delivery, impact);
  const valence = inferredValence(delivery, impact);
  const directed = Boolean(delivery.directed || impact.directed || impact.directedTargetId === delivery.recipientId);
  const explicitThreat = unit(firstDefined(impact.threat, impact.actionOutcome?.threat, delivery.threat, 0));
  const publicness = unit(firstDefined(impact.publicness, impact.actionOutcome?.publicness, delivery.publicness, 0));
  const repairOpportunity = unit(firstDefined(impact.repairOpportunity, impact.actionOutcome?.repairOpportunity, delivery.repairOpportunity, 0));
  const controlDelta = signedUnit(firstDefined(impact.controlDelta, impact.actionOutcome?.controlDelta, delivery.controlDelta, 0));
  const feltThreat = clamp(
    salience * (0.12 + explicitThreat * 0.46 + matchedSensitivityPeak * 0.32 + relationship.tension * 0.2 + (directed ? 0.08 : 0)),
  );
  const feltSupport = clamp(
    Math.max(0, valence) * salience * 0.52
    + repairOpportunity * 0.38
    + relationship.trust * relationship.closeness * 0.22,
  );
  return { salience, valence, directed, explicitThreat, publicness, repairOpportunity, controlDelta, feltThreat, feltSupport };
}

function decayToward(value, baseline, elapsedSeconds, halfLifeSeconds = DEFAULT_AFFECT_HALF_LIFE_SECONDS) {
  if (elapsedSeconds <= 0) return value;
  const retention = 0.5 ** (elapsedSeconds / Math.max(1, halfLifeSeconds));
  return baseline + (value - baseline) * retention;
}

function sensitivityPatch(profile = {}, ecologyState = {}, cueIds = [], salience = 0, relationship = {}, elapsedSeconds = 0) {
  const eventCueSet = new Set(cueIds.map(normalizedCue));
  const sensitivityActivations = cloneValue(ecologyState.sensitivityActivations || {});
  const trace = [];
  for (const sensitivity of profile.sensitivities || []) {
    const previous = sensitivityActivations[sensitivity.id] || {
      sensitivityId: sensitivity.id,
      activation: 0,
      lastTriggeredAtSecond: null,
      matchedCueIds: [],
    };
    const before = unit(previous.activation);
    const halfLife = Math.max(1, finite(sensitivity.recoveryHalfLifeSeconds, 900));
    const decayed = before * (0.5 ** (Math.max(0, elapsedSeconds) / halfLife));
    const matchedCueIds = (sensitivity.cue || []).map(normalizedCue).filter((cueId) => eventCueSet.has(cueId));
    const relationalAmplifier = 1 + relationship.closeness * 0.18 + relationship.tension * 0.34;
    const gain = matchedCueIds.length
      ? clamp(unit(sensitivity.activationGain) * salience * relationalAmplifier)
      : 0;
    const after = clamp(decayed + gain * (1 - decayed));
    sensitivityActivations[sensitivity.id] = {
      sensitivityId: sensitivity.id,
      activation: round(after),
      lastTriggeredAtSecond: matchedCueIds.length
        ? finite(ecologyState.elapsedSeconds) + Math.max(0, elapsedSeconds)
        : previous.lastTriggeredAtSecond ?? null,
      matchedCueIds: matchedCueIds.length
        ? [...new Set([...(previous.matchedCueIds || []), ...matchedCueIds])].slice(-12)
        : [...(previous.matchedCueIds || [])],
    };
    trace.push({
      sensitivityId: sensitivity.id,
      threatMeaning: sensitivity.threatMeaning || "",
      matchedCueIds,
      before: round(before),
      decayed: round(decayed),
      gain: round(gain),
      after: round(after),
      halfLifeSeconds: halfLife,
    });
  }
  return { sensitivityActivations, trace };
}

function softmaxBias(utilities = {}) {
  const temperature = 0.72;
  const maximum = Math.max(...COPING_KEYS.map((key) => finite(utilities[key])));
  const exponentials = Object.fromEntries(COPING_KEYS.map((key) => [
    key,
    Math.exp((finite(utilities[key]) - maximum) / temperature),
  ]));
  const total = Object.values(exponentials).reduce((sum, value) => sum + value, 0) || 1;
  const scores = Object.fromEntries(COPING_KEYS.map((key) => [key, round(exponentials[key] / total)]));
  const dominant = COPING_KEYS.slice().sort((left, right) => scores[right] - scores[left] || left.localeCompare(right))[0];
  return { ...scores, dominant };
}

function repairNeedFor(dimensions = {}, relationship = {}) {
  if (dimensions.repairNeed != null) return unit(dimensions.repairNeed);
  const conflictPain = clamp(-signedUnit(dimensions.valence), 0, 1);
  const relationshipStrain = clamp(
    relationship.tension * 0.7
    + relationship.resentment * 0.3,
  );
  const ruptureEvidence = clamp(
    conflictPain * 0.7
    + relationshipStrain * 0.6,
  );
  // Ordinary friction, delay, or mild negative affect may change patience, but
  // does not by itself mean that the relationship has ruptured.
  if (ruptureEvidence < 0.16) return 0;
  return clamp(
    ruptureEvidence
    * (0.65 + unit(dimensions.repairOpportunity) * 0.35),
  );
}

function copingFor(profile = {}, affect = {}, dimensions = {}, relationship = {}, sensitivityPeak = 0) {
  const personality = profile.personality || {};
  const autonomy = unit(personality.autonomy, 0.5);
  const introversion = unit(personality.introversion, 0.5);
  const caution = unit(personality.caution, 0.5);
  const care = unit(personality.care, 0.5);
  const impulsivity = unit(personality.impulsivity, 0.2);
  const dominance = unit(affect.dominance, 0.5);
  const positiveValence = clamp(signedUnit(affect.valence), 0, 1);
  const repairNeed = repairNeedFor(dimensions, relationship);
  const utilities = {
    approach: 0.2 + autonomy * 0.72 + care * 0.28 + impulsivity * 0.22 + positiveValence * 0.32
      + relationship.closeness * 0.32 + dimensions.feltSupport * 0.3 - dimensions.feltThreat * 0.58,
    avoid: 0.18 + caution * 0.76 + introversion * 0.62 + relationship.fear * 0.42
      + dimensions.feltThreat * 0.76 - dominance * 0.38,
    assert: 0.18 + autonomy * 0.82 + dominance * 0.64 + relationship.tension * 0.35
      + sensitivityPeak * 0.48 + (dimensions.directed ? 0.2 : 0) - caution * 0.16,
    inhibit: 0.16 + introversion * 0.7 + caution * 0.54 + dimensions.publicness * 0.58
      + dimensions.feltThreat * 0.34 - dominance * 0.3,
    repair: 0.04
      + repairNeed * (
        0.65
        + care
        + relationship.closeness * 0.85
        + relationship.trust * 0.75
      )
      - relationship.resentment * 0.42,
  };
  return {
    utilities,
    bias: {
      ...softmaxBias(utilities),
      repairNeed: round(repairNeed),
    },
  };
}

function noUpdate(ecologyState = {}, impactId = "", reason = "ignored") {
  const nextState = cloneValue(ecologyState);
  const copingBias = cloneValue(ecologyState.copingBiases || {
    approach: 0.2,
    avoid: 0.2,
    assert: 0.2,
    inhibit: 0.2,
    repair: 0.2,
    dominant: "approach",
    repairNeed: 0,
  });
  return {
    applied: false,
    reason,
    impactId,
    nextState,
    copingBias,
    observerTrace: {
      observerOnly: true,
      schemaVersion: TAVERN_EVENT_APPRAISAL_VERSION,
      applied: false,
      reason,
      impactId,
      factors: [],
    },
  };
}

/**
 * Appraise one delivered, committed impact for its recipient.
 * `elapsedSeconds` is a duration since the previous appraisal, not wall time.
 */
export function appraiseTavernPerceivedEvent({
  profile = {},
  ecologyState = {},
  delivery = null,
  impact = {},
  relationship = {},
  elapsedSeconds = 0,
} = {}) {
  const impactId = impactIdFor(delivery || {}, impact);
  if (!isPerceived(profile, delivery, impact)) return noUpdate(ecologyState, impactId, "unperceived");
  if (!isCommitted(delivery, impact)) return noUpdate(ecologyState, impactId, "uncommitted");
  if ((ecologyState.attention?.perceivedEventIds || []).includes(impactId)) return noUpdate(ecologyState, impactId, "duplicate-impact");

  const elapsed = Math.max(0, finite(elapsedSeconds));
  const relation = relationshipFactors(relationship);
  const cueIds = eventCueIds(delivery, impact);
  const salience = eventSalience(delivery, impact);
  const sensitivity = sensitivityPatch(profile, ecologyState, cueIds, salience, relation, elapsed);
  const sensitivityPeak = Math.max(0, ...sensitivity.trace.map((entry) => entry.after));
  const dimensions = eventDimensions(delivery, impact, sensitivityPeak, relation);
  const baseline = profile.initialConditions?.affect || { valence: 0, arousal: 0.3, dominance: 0.5 };
  const before = {
    valence: signedUnit(ecologyState.affect?.valence, signedUnit(baseline.valence)),
    arousal: unit(ecologyState.affect?.arousal, unit(baseline.arousal, 0.3)),
    dominance: unit(ecologyState.affect?.dominance, unit(baseline.dominance, 0.5)),
  };
  const decayed = {
    valence: decayToward(before.valence, signedUnit(baseline.valence), elapsed),
    arousal: decayToward(before.arousal, unit(baseline.arousal, 0.3), elapsed),
    dominance: decayToward(before.dominance, unit(baseline.dominance, 0.5), elapsed),
  };
  const deltas = {
    valence: dimensions.valence * dimensions.salience * 0.24
      + dimensions.feltSupport * 0.08 - dimensions.feltThreat * 0.18,
    arousal: dimensions.salience * 0.13 + dimensions.feltThreat * 0.2
      + sensitivityPeak * 0.12 - dimensions.feltSupport * 0.05,
    dominance: dimensions.controlDelta * dimensions.salience * 0.18
      + dimensions.feltSupport * 0.07 - dimensions.feltThreat * 0.16,
  };
  const affect = {
    ...cloneValue(ecologyState.affect || {}),
    valence: round(clamp(decayed.valence + deltas.valence, -1, 1)),
    arousal: round(clamp(decayed.arousal + deltas.arousal)),
    dominance: round(clamp(decayed.dominance + deltas.dominance)),
  };
  const coping = copingFor(profile, affect, dimensions, relation, sensitivityPeak);
  const perceivedEventIds = [...new Set([
    ...(ecologyState.attention?.perceivedEventIds || []),
    impactId,
  ])].slice(-MAX_PERCEIVED_EVENT_IDS);
  const patch = {
    elapsedSeconds: finite(ecologyState.elapsedSeconds) + elapsed,
    affect,
    sensitivityActivations: sensitivity.sensitivityActivations,
    copingBiases: {
      ...coping.bias,
      sourceImpactId: impactId,
      updatedAtSecond: finite(ecologyState.elapsedSeconds) + elapsed,
    },
    attention: {
      ...cloneValue(ecologyState.attention || {}),
      perceivedEventIds,
    },
  };
  const nextState = applyTavernEventAppraisal(ecologyState, patch);
  const observerTrace = {
    observerOnly: true,
    schemaVersion: TAVERN_EVENT_APPRAISAL_VERSION,
    applied: true,
    impactId,
    cueIds,
    factors: [
      { id: "event.salience", value: round(dimensions.salience) },
      { id: "event.valence", value: round(dimensions.valence) },
      { id: "event.feltThreat", value: round(dimensions.feltThreat) },
      { id: "event.feltSupport", value: round(dimensions.feltSupport) },
      { id: "relationship.closeness", value: round(relation.closeness) },
      { id: "relationship.tension", value: round(relation.tension) },
      { id: "relationship.trust", value: round(relation.trust) },
      { id: "coping.repairNeed", value: round(coping.bias.repairNeed) },
    ],
    sensitivities: sensitivity.trace,
    affect: {
      before: Object.fromEntries(Object.entries(before).map(([key, value]) => [key, round(value)])),
      decayed: Object.fromEntries(Object.entries(decayed).map(([key, value]) => [key, round(value)])),
      deltas: Object.fromEntries(Object.entries(deltas).map(([key, value]) => [key, round(value)])),
      after: cloneValue(affect),
    },
    copingUtilities: Object.fromEntries(Object.entries(coping.utilities).map(([key, value]) => [key, round(value)])),
    copingBias: cloneValue(coping.bias),
  };
  return { applied: true, reason: "applied", impactId, nextState, copingBias: cloneValue(coping.bias), observerTrace };
}

/** Apply a patch produced by the deterministic appraisal without mutating state. */
export function applyTavernEventAppraisal(ecologyState = {}, patch = {}) {
  return {
    ...cloneValue(ecologyState),
    ...cloneValue(patch),
    affect: { ...cloneValue(ecologyState.affect || {}), ...cloneValue(patch.affect || {}) },
    attention: { ...cloneValue(ecologyState.attention || {}), ...cloneValue(patch.attention || {}) },
    sensitivityActivations: {
      ...cloneValue(ecologyState.sensitivityActivations || {}),
      ...cloneValue(patch.sensitivityActivations || {}),
    },
  };
}

/** Advance private ecology time without inventing a perceived event. */
export function advanceTavernEcologyTime({
  profile = {},
  ecologyState = {},
  elapsedSeconds = 0,
} = {}) {
  const elapsed = Math.max(0, finite(elapsedSeconds));
  if (!elapsed) return cloneValue(ecologyState);
  const baseline = profile.initialConditions?.affect || { valence: 0, arousal: 0.3, dominance: 0.5 };
  const affect = {
    ...cloneValue(ecologyState.affect || {}),
    valence: round(decayToward(
      signedUnit(ecologyState.affect?.valence, signedUnit(baseline.valence)),
      signedUnit(baseline.valence),
      elapsed,
    )),
    arousal: round(decayToward(
      unit(ecologyState.affect?.arousal, unit(baseline.arousal, 0.3)),
      unit(baseline.arousal, 0.3),
      elapsed,
    )),
    dominance: round(decayToward(
      unit(ecologyState.affect?.dominance, unit(baseline.dominance, 0.5)),
      unit(baseline.dominance, 0.5),
      elapsed,
    )),
  };
  const sensitivity = sensitivityPatch(profile, ecologyState, [], 0, relationshipFactors({}), elapsed);
  const sensitivityPeak = Math.max(0, ...sensitivity.trace.map((entry) => entry.after));
  const retainedRepairNeed = unit(ecologyState.copingBiases?.repairNeed)
    * (0.5 ** (elapsed / DEFAULT_AFFECT_HALF_LIFE_SECONDS));
  const coping = copingFor(profile, affect, {
    salience: 0,
    valence: 0,
    directed: false,
    publicness: 0,
    repairOpportunity: 0,
    feltThreat: 0,
    feltSupport: 0,
    repairNeed: retainedRepairNeed,
  }, relationshipFactors({}), sensitivityPeak);
  return applyTavernEventAppraisal(ecologyState, {
    elapsedSeconds: finite(ecologyState.elapsedSeconds) + elapsed,
    affect,
    sensitivityActivations: sensitivity.sensitivityActivations,
    copingBiases: {
      ...coping.bias,
      sourceImpactId: ecologyState.copingBiases?.sourceImpactId || "",
      updatedAtSecond: finite(ecologyState.elapsedSeconds) + elapsed,
    },
  });
}
