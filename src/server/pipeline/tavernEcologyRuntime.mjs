import {
  getTavernEcologyProfile,
} from "../ecology/tavernEcologyProfile.mjs";
import {
  createInitialEcologyState,
  validateEcologyState,
} from "../ecology/tavernEcologyState.mjs";
import { appraiseTavernEcology } from "./tavernEcologyAppraisal.mjs";
import { getDirectedRelationship } from "../ecology/tavernRelationshipDynamics.mjs";
import {
  appraiseServicePrice,
  normalizeMaterialEconomyProfile,
} from "../simulation/materialEconomy.mjs";
import { appraiseOfferingSustenance } from "../simulation/cultivationSustenance.mjs";

const TAVERN_LOCATION_ID = "loc_xyy_tavern";
const MAX_PAIR_SPEECH_TURNS_PER_SCENE = 6;

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function clamp(value, min = 0, max = 100) {
  const numeric = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(numeric) ? numeric : 0));
}

function scale01(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return clamp(numeric <= 1 ? numeric * 100 : numeric);
}

function line(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hanBigrams(value = "") {
  const segments = String(value || "").match(/[\p{Script=Han}]+/gu) || [];
  const result = new Set();
  for (const segment of segments) {
    for (let index = 0; index < segment.length - 1; index += 1) result.add(segment.slice(index, index + 2));
  }
  return result;
}

function lexicalCueScore(desire = {}, impact = {}) {
  const desireTerms = hanBigrams([
    desire.desiredState?.verb,
    desire.desiredState?.object,
    desire.desiredState?.observableOutcome,
    desire.target?.label,
    ...(desire.activationCues || []),
  ].filter(Boolean).join(" "));
  const impactTerms = hanBigrams(`${impact.topic || ""} ${impact.content || ""}`);
  let shared = 0;
  for (const term of impactTerms) if (desireTerms.has(term)) shared += 1;
  return clamp(shared * 12, 0, 42);
}

function firstVisibleProfileByStanding(visibleCharacterIds = [], standingPriority = [], excludedId = "", runtime = {}) {
  for (const standing of standingPriority) {
    const match = visibleCharacterIds.find((characterId) => (
      characterId !== excludedId
      && (runtime.agents?.[characterId]?.standing || getTavernEcologyProfile(characterId)?.standing) === standing
    ));
    if (match) return match;
  }
  return "";
}

function samePairSpeechTurnCount(runtime = {}, actorId = "", targetCharacterId = "") {
  if (!actorId || !targetCharacterId) return 0;
  return (runtime.actions || []).filter((action) => {
    if (!action?.speech) return false;
    return (action.actorId === actorId && action.targetCharacterId === targetCharacterId)
      || (action.actorId === targetCharacterId && action.targetCharacterId === actorId);
  }).length;
}

function slotKind(slotLabel = "") {
  if (/夜/.test(slotLabel)) return "night";
  if (/黄昏/.test(slotLabel)) return "dusk";
  if (/清晨/.test(slotLabel)) return "morning";
  if (/正午|午后/.test(slotLabel)) return "day";
  return "continuous-scene";
}

function profileTraits(profile = {}) {
  const personality = profile.personality || {};
  const introversion = scale01(personality.introversion, 50);
  const autonomy = scale01(personality.autonomy, 50);
  const caution = scale01(personality.caution, 50);
  return {
    autonomy,
    introversion,
    persistence: scale01(personality.persistence, 50),
    conscientiousness: scale01(personality.conscientiousness, 50),
    competitiveness: scale01(personality.competitiveness, 50),
    care: scale01(personality.care, 50),
    caution,
    impulsivity: scale01(personality.impulsivity, 20),
    shameSensitivity: clamp(introversion * 0.68 + caution * 0.22 + 10),
    privacyNeed: clamp(introversion * 0.62 + autonomy * 0.28 + 10),
    assertiveness: clamp((100 - introversion) * 0.55 + autonomy * 0.45),
    fatigueSensitivity: clamp(45 + caution * 0.25),
    painSensitivity: clamp(40 + caution * 0.3),
  };
}

function directedRelationship(relationships = [], fromCharacterId = "", toCharacterId = "") {
  return getDirectedRelationship(relationships, fromCharacterId, toCharacterId);
}

function relationshipAppraisal(relationships = [], fromCharacterId = "", toCharacterId = "") {
  const relationship = directedRelationship(relationships, fromCharacterId, toCharacterId) || {};
  const closeness = clamp((
    scale01(relationship.dependence)
    + scale01(relationship.protection)
    + scale01(relationship.love)
  ) / 3);
  const tension = clamp((
    scale01(relationship.resentment)
    + scale01(relationship.fear)
    + scale01(relationship.shame)
  ) / 3);
  const trust = clamp((closeness * 0.72) + ((100 - tension) * 0.28) - scale01(relationship.deception) * 0.25);
  return {
    relationshipId: relationship.id || "",
    fromCharacterId,
    toCharacterId,
    closeness,
    tension,
    trust,
    dependence: scale01(relationship.dependence),
    protection: scale01(relationship.protection),
    resentment: scale01(relationship.resentment),
    fear: scale01(relationship.fear),
    wantsToBeSeen: scale01(relationship.wantsToBeSeen),
  };
}

function normalizeBiases(scores = {}) {
  const keys = ["approach", "avoid", "assert", "inhibit", "repair"];
  const positive = Object.fromEntries(keys.map((key) => [key, Math.max(0.001, Number(scores[key] || 0))]));
  const total = Object.values(positive).reduce((sum, value) => sum + value, 0) || 1;
  const normalized = Object.fromEntries(keys.map((key) => [key, Number((positive[key] / total).toFixed(6))]));
  normalized.dominant = keys.slice().sort((left, right) => normalized[right] - normalized[left] || left.localeCompare(right))[0];
  return normalized;
}

function currentCopingBias(profile = {}, state = {}, relationship = {}) {
  const retained = state.copingBiases?.dominant ? state.copingBiases : {};
  const personality = profile.personality || {};
  const affect = state.affect || {};
  const arousal = scale01(affect.arousal, 30);
  const dominance = scale01(affect.dominance, 50);
  const valence = clamp((Number(affect.valence || 0) + 1) * 50);
  const sensitivityPeak = clamp(Math.max(0, ...Object.values(state.sensitivityActivations || {}).map((item) => scale01(item?.activation))));
  const repairNeed = scale01(retained.repairNeed);
  const care = scale01(personality.care, 50) / 100;
  const closeness = Number(relationship.closeness || 0) / 100;
  const trust = Number(relationship.trust || 0) / 100;
  const repairRetention = Number(retained.repair || 0) * 24 * (repairNeed / 100);
  const normalized = normalizeBiases({
    approach: 22 + scale01(personality.autonomy, 50) * 0.48 + valence * 0.18 + Number(relationship.closeness || 0) * 0.28 - sensitivityPeak * 0.18 + Number(retained.approach || 0) * 24,
    avoid: 16 + scale01(personality.caution, 50) * 0.46 + scale01(personality.introversion, 50) * 0.34 + arousal * 0.22 + Number(relationship.tension || 0) * 0.38 + Number(relationship.fear || 0) * 0.22 - dominance * 0.22 + Number(retained.avoid || 0) * 24,
    assert: 14 + scale01(personality.autonomy, 50) * 0.42 + dominance * 0.42 + arousal * 0.26 + sensitivityPeak * 0.24 + Number(relationship.tension || 0) * 0.22 + Number(retained.assert || 0) * 24,
    inhibit: 14 + scale01(personality.introversion, 50) * 0.5 + scale01(personality.caution, 50) * 0.3 + sensitivityPeak * 0.32 - dominance * 0.24 + Number(retained.inhibit || 0) * 24,
    repair: 6
      + repairNeed * (0.65 + care * 0.6 + closeness * 0.45 + trust * 0.4)
      - Number(relationship.resentment || 0) * 0.25
      - scale01(personality.competitiveness, 30) * 0.05
      + repairRetention,
  });
  normalized.repairNeed = Number((repairNeed / 100).toFixed(6));
  return normalized;
}

function effectiveCopingDominant(copingBias = {}) {
  if (copingBias.dominant === "repair" && scale01(copingBias.repairNeed) < 16) return "approach";
  return copingBias.dominant || "approach";
}

function expressionStrategyFor(copingBias = {}, relationship = {}, candidate = {}) {
  const dominant = effectiveCopingDominant(copingBias);
  const modeIsNormallySilent = ["observe", "rest", "practice"].includes(candidate.realization?.mode);
  if (candidate.realization?.allowSpeech === false
    || (modeIsNormallySilent && candidate.realization?.allowSpeech !== true)) {
    return {
      mode: dominant === "inhibit" || dominant === "avoid" ? "quiet-withdrawal" : "silent-focus",
      directness: "none",
      warmth: relationship.closeness >= 55 ? "warm" : "neutral",
      motive: dominant,
    };
  }
  const modes = {
    approach: {
      mode: "direct-engagement",
      directness: "clear",
      warmth: relationship.closeness >= 55 && relationship.tension < 34 ? "warm" : "neutral",
    },
    avoid: { mode: "brief-deferral", directness: "indirect", warmth: "cool" },
    assert: { mode: "firm-boundary", directness: "firm", warmth: "cool" },
    inhibit: { mode: "minimal-response", directness: "guarded", warmth: "neutral" },
    repair: { mode: "relationship-repair", directness: "clear", warmth: "warm" },
  };
  return { ...(modes[dominant] || modes.approach), motive: dominant };
}

function applySocialAffectToCandidate(candidate, profile, state, context) {
  const relationship = relationshipAppraisal(
    context.relationships,
    profile.characterId,
    candidate.targetCharacterId,
  );
  const copingBias = currentCopingBias(profile, state, relationship);
  const affect = state.affect || {};
  const arousal = scale01(affect.arousal, 30);
  const sensitivityPeak = clamp(Math.max(0, ...Object.values(state.sensitivityActivations || {}).map((item) => scale01(item?.activation))));
  const interpersonal = Boolean(candidate.targetCharacterId);
  if (interpersonal) {
    const existingSocialPull = clamp(candidate.socialPull);
    const relationalPull = clamp(
      28
      + relationship.closeness * 0.5
      + copingBias.repair * 42
      + copingBias.approach * 24
      - relationship.tension * 0.18,
    );
    candidate.socialPull = candidate.actionKind === "respond_to_impact"
      ? relationalPull
      : clamp(existingSocialPull * 0.45 + relationalPull * 0.55);
    candidate.emotionalPull = clamp(
      clamp(candidate.emotionalPull) * 0.42
      + arousal * 0.34
      + relationship.tension * 0.22
      + sensitivityPeak * 0.28,
    );
    if (relationship.tension > 34 && ["respond", "speak"].includes(candidate.realization?.mode)) {
      candidate.obstacles = [...(candidate.obstacles || []), {
        id: "relationshipTension",
        label: "本人对这个人的戒备使开口更费力",
        intensity: clamp((relationship.tension - 24) * 0.55),
        source: "directed-relationship",
      }];
    }
  } else {
    candidate.emotionalPull = clamp(clamp(candidate.emotionalPull) * 0.6 + arousal * 0.14);
  }
  if (candidate.actionKind === "invite_private_duel" && sensitivityPeak > 0) {
    const exposure = sensitivityPeak / 100;
    candidate.expectedSatisfaction = clamp(Number(candidate.expectedSatisfaction || 0) * (1 - exposure * 0.58));
    candidate.opportunity = clamp(Number(candidate.opportunity || 0) * (1 - exposure * 0.72));
    candidate.obstacles = [...(candidate.obstacles || []), {
      id: "activePublicExposure",
      label: "此刻被旁人看见会直接阻住邀战",
      intensity: sensitivityPeak,
      source: "active-sensitivity",
    }];
  } else if (candidate.actionKind === "observe_target" && sensitivityPeak > 0) {
    const exposure = sensitivityPeak / 100;
    candidate.expectedSatisfaction = clamp(Number(candidate.expectedSatisfaction || 0) + exposure * 34);
    candidate.opportunity = clamp(Number(candidate.opportunity || 0) + exposure * 18);
    candidate.emotionalPull = clamp(Number(candidate.emotionalPull || 0) + exposure * 46);
  }
  candidate.relationshipAppraisal = relationship;
  candidate.copingBias = copingBias;
  candidate.expressionStrategy = expressionStrategyFor(copingBias, relationship, candidate);
  if (candidate.actionKind === "respond_to_impact") {
    candidate.traumaDrive = Math.max(
      Number(candidate.traumaDrive || 0),
      sensitivityPeak > 0
        ? 100 * Math.max(copingBias.assert || 0, copingBias.avoid || 0, copingBias.inhibit || 0)
        : 0,
    );
    const effectiveDominant = effectiveCopingDominant(copingBias);
    const allowedByCoping = {
      approach: ["answer", "inform", "ask", "offer"],
      avoid: ["answer", "refuse"],
      // Assertion changes firmness; it does not erase a Character Agent's
      // chosen question and silently turn it into an unanswerable statement.
      assert: ["answer", "inform", "ask", "refuse", "warn"],
      inhibit: ["none"],
      // Repair-oriented people may need one concrete question before they can
      // answer or offer help.  Forcing that question into `inform` erases the
      // conversational turn and makes the next person sound unprompted.
      repair: ["answer", "inform", "ask", "offer", "confide"],
    }[effectiveDominant] || ["answer", "inform"];
    if (effectiveDominant === "inhibit" && !candidate.requiresResolution) {
      candidate.realization = {
        ...(candidate.realization || {}),
        mode: "observe",
        requireSpeech: false,
        allowSpeech: false,
        allowedSpeechActs: ["none"],
      };
    } else {
      candidate.realization = {
        ...(candidate.realization || {}),
        allowedSpeechActs: candidate.requiresResolution && effectiveDominant === "inhibit"
          ? ["answer", "refuse", "inform"]
          : allowedByCoping,
      };
    }
  }
  return candidate;
}

export function ecologyFactorWeightsForProfile(profile = {}) {
  const personality = profile.personality || {};
  const autonomy = Number(personality.autonomy || 0.5);
  const introversion = Number(personality.introversion || 0.5);
  const persistence = Number(personality.persistence || 0.5);
  const conscientiousness = Number(personality.conscientiousness || 0.5);
  const care = Number(personality.care || 0.5);
  const caution = Number(personality.caution || 0.5);
  const impulsivity = Number(personality.impulsivity || 0.2);
  const fixed = (value) => Number(value.toFixed(4));
  return {
    desire: {
      baseline: fixed(0.50 + autonomy * 0.18),
      urgency: fixed(0.10 + impulsivity * 0.12),
      frustration: fixed(0.10 + persistence * 0.10),
    },
    bodyCost: {
      exertion: fixed(0.44 + caution * 0.20),
      painRisk: fixed(0.18 + caution * 0.16),
    },
    resistance: {
      persistenceRelief: fixed(0.10 + persistence * 0.12),
      assertivenessRelief: fixed(0.05 + (1 - introversion) * 0.08),
    },
    activation: {
      desireFit: fixed(0.48 + autonomy * 0.18),
      opportunity: fixed(0.10 + impulsivity * 0.10),
      dutyPressure: fixed(0.05 + conscientiousness * 0.16),
      socialPull: fixed(0.04 + care * 0.14),
      emotionalPull: fixed(0.04 + impulsivity * 0.14),
      intentionContinuity: fixed(0.06 + persistence * 0.15),
      obstacleResistance: fixed(0.36 + caution * 0.20 + introversion * 0.08),
      bodyCost: fixed(0.20 + caution * 0.12),
      switchingCost: fixed(0.08 + persistence * 0.10),
      repetitionPenalty: fixed(0.08 + conscientiousness * 0.08),
    },
  };
}

function isUnitValue(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function migratedUnitRecord(baseline = {}, existing = {}, { signedKeys = [] } = {}) {
  const next = clone(baseline);
  const signed = new Set(signedKeys);
  for (const [key, value] of Object.entries(existing || {})) {
    const valid = signed.has(key)
      ? Number.isFinite(value) && value >= -1 && value <= 1
      : isUnitValue(value);
    if (valid) next[key] = value;
  }
  return next;
}

function migratedTimedUnitRow(baseline = {}, existing = {}, idKey = "id", id = "", unitKeys = [], timeKeys = []) {
  const next = { ...clone(baseline), [idKey]: id };
  for (const key of unitKeys) {
    if (isUnitValue(existing?.[key])) next[key] = existing[key];
  }
  for (const key of timeKeys) {
    const value = existing?.[key];
    if (value === null || (Number.isFinite(value) && value >= 0)) next[key] = value;
  }
  return next;
}

function currentIntentionSurvivesProfile(existing, migrated = {}) {
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) return false;
  const validDesireIds = new Set(Object.keys(migrated.desires || {}));
  const desireReferences = [existing.sourceId, existing.desireId, existing.driveId].filter(Boolean);
  if (existing.sourceKind === "desire" && existing.sourceId && !validDesireIds.has(existing.sourceId)) return false;
  if (desireReferences.some((id) => /^desire_/u.test(id) && !validDesireIds.has(id))) return false;
  return true;
}

/**
 * Rebinds a lived ecology state to the current profile without treating a
 * profile revision as a new person. Only still-declared drives and state axes
 * survive by id; body, affect, perception, location and lived outcomes remain.
 */
export function migrateTavernEcologyStateToProfile(existing = {}, profile = {}, options = {}) {
  const baseline = createInitialEcologyState(profile, options);
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) return baseline;
  if (existing.characterId && existing.characterId !== profile.characterId) return baseline;

  const migrated = {
    ...baseline,
    elapsedSeconds: Number.isFinite(existing.elapsedSeconds) && existing.elapsedSeconds >= 0
      ? Math.max(existing.elapsedSeconds, baseline.elapsedSeconds)
      : baseline.elapsedSeconds,
    presence: {
      ...baseline.presence,
      ...(existing.presence && typeof existing.presence === "object" ? clone(existing.presence) : {}),
    },
    body: migratedUnitRecord(baseline.body, existing.body),
    affect: migratedUnitRecord(baseline.affect, existing.affect, { signedKeys: ["valence"] }),
    dynamicPsychology: Object.fromEntries(Object.entries(baseline.dynamicPsychology || {}).map(([stateId, value]) => [
      stateId,
      isUnitValue(existing.dynamicPsychology?.[stateId]) ? existing.dynamicPsychology[stateId] : value,
    ])),
    desires: Object.fromEntries(Object.entries(baseline.desires || {}).map(([desireId, row]) => {
      const profileDesire = (profile.desires || []).find((desire) => desire.id === desireId) || {};
      const existingRow = existing.desires?.[desireId] || {};
      const hasValidActivationState = ["latent", "active"].includes(existingRow.activationState);
      const migratedRow = migratedTimedUnitRow(
        row,
        existingRow,
        "desireId",
        desireId,
        ["strength", "frustration", "satisfaction"],
        ["lastSatisfiedAtSecond", "lastBlockedAtSecond"],
      );
      if (profileDesire.activationMode === "cue_gated") {
        migratedRow.activationState = hasValidActivationState ? existingRow.activationState : "latent";
        if (!hasValidActivationState) migratedRow.strength = row.strength;
      } else migratedRow.activationState = "active";
      return [desireId, migratedRow];
    })),
    duties: Object.fromEntries(Object.entries(baseline.duties || {}).map(([dutyId, row]) => [
      dutyId,
      {
        ...migratedTimedUnitRow(
          row,
          existing.duties?.[dutyId],
          "dutyId",
          dutyId,
          ["urgency", "progress"],
          ["lastCompletedAtSecond"],
        ),
        active: typeof existing.duties?.[dutyId]?.active === "boolean"
          ? existing.duties[dutyId].active
          : row.active,
      },
    ])),
    sensitivityActivations: Object.fromEntries(Object.entries(baseline.sensitivityActivations || {}).map(([sensitivityId, row]) => [
      sensitivityId,
      {
        ...migratedTimedUnitRow(
          row,
          existing.sensitivityActivations?.[sensitivityId],
          "sensitivityId",
          sensitivityId,
          ["activation"],
          ["lastTriggeredAtSecond"],
        ),
        matchedCueIds: Array.isArray(existing.sensitivityActivations?.[sensitivityId]?.matchedCueIds)
          ? clone(existing.sensitivityActivations[sensitivityId].matchedCueIds)
          : row.matchedCueIds,
      },
    ])),
    attention: existing.attention && Array.isArray(existing.attention.perceivedEventIds)
      ? clone(existing.attention)
      : baseline.attention,
    perceivedEnvironment: existing.perceivedEnvironment && typeof existing.perceivedEnvironment === "object"
      ? { ...baseline.perceivedEnvironment, ...clone(existing.perceivedEnvironment) }
      : baseline.perceivedEnvironment,
    recentActionSignatures: Array.isArray(existing.recentActionSignatures)
      ? clone(existing.recentActionSignatures)
      : baseline.recentActionSignatures,
    lastOutcome: existing.lastOutcome === undefined ? baseline.lastOutcome : clone(existing.lastOutcome),
    conversationLocks: existing.conversationLocks && typeof existing.conversationLocks === "object" && !Array.isArray(existing.conversationLocks)
      ? clone(existing.conversationLocks)
      : baseline.conversationLocks,
  };
  if (!migrated.presence.locationId) migrated.presence.locationId = baseline.presence.locationId;
  if (currentIntentionSurvivesProfile(existing.currentIntention, migrated)) {
    migrated.currentIntention = Object.fromEntries(Object.keys(baseline.currentIntention)
      .map((key) => [
        key,
        existing.currentIntention[key] === undefined
          ? baseline.currentIntention[key]
          : clone(existing.currentIntention[key]),
      ]));
  }
  if (existing.copingBiases && typeof existing.copingBiases === "object") {
    const fields = ["approach", "avoid", "assert", "inhibit", "repair"];
    if (fields.every((field) => isUnitValue(existing.copingBiases[field]))
      && fields.includes(existing.copingBiases.dominant)) {
      migrated.copingBiases = clone(existing.copingBiases);
    }
  }
  return validateEcologyState(migrated, profile).valid ? migrated : baseline;
}

export function ensureTavernEcology(character = {}, {
  present = Boolean(character.lifeState?.present),
  zoneId = null,
  elapsedSeconds = 0,
  locationId = character.currentLocationId || character.ecologyState?.presence?.locationId || TAVERN_LOCATION_ID,
} = {}) {
  const profile = getTavernEcologyProfile(character, {
    observationStageId: locationId,
    defaultZoneId: zoneId,
  });
  if (!profile) return { profile: null, state: null };
  const existing = character.ecologyState;
  const state = validateEcologyState(existing, profile).valid
    ? clone(existing)
    : migrateTavernEcologyStateToProfile(existing, profile, {
      elapsedSeconds,
      locationId: present ? locationId : profile.initialConditions.locationId,
      zoneId: present ? (zoneId || profile.initialConditions.zoneId) : profile.initialConditions.zoneId,
      observableAtStage: present,
    });
  state.dynamicPsychology = Object.fromEntries(Object.entries(profile.dynamicPsychologyState || {})
    .map(([stateId, baseline]) => [
      stateId,
      Number.isFinite(state.dynamicPsychology?.[stateId])
        ? clamp(Number(state.dynamicPsychology[stateId]), 0, 1)
        : baseline,
    ]));
  state.elapsedSeconds = Math.max(Number(state.elapsedSeconds || 0), Number(elapsedSeconds || 0));
  state.presence = {
    ...state.presence,
    locationId: present ? locationId : state.presence?.locationId || profile.initialConditions.locationId,
    zoneId: present ? (zoneId || state.presence?.zoneId) : state.presence?.zoneId,
    observableAtStage: present,
    arrivedAtSecond: present
      ? state.presence?.arrivedAtSecond ?? state.elapsedSeconds
      : null,
  };
  return { profile, state };
}

function desireText(desire = {}) {
  const desired = desire.desiredState || {};
  return line(`${desired.verb || "想"}${desired.object || desire.target?.label || "推进自己的目标"}`);
}

function cueActivationFor(desire = {}, pendingImpacts = [], recognizedCharacterIds = []) {
  const targetId = desire.target?.type === "character" ? desire.target.id : "";
  const criteria = desire.satisfactionCondition?.criteria || {};
  const relatedIds = new Set([
    targetId,
    criteria.receiverCharacterId,
    criteria.speakerCharacterId,
    criteria.sourceSpeakerCharacterId,
    ...(criteria.actorCharacterIds || []),
    ...(criteria.participantCharacterIds || []),
  ].filter(Boolean));
  let score = [...relatedIds].some((id) => recognizedCharacterIds.includes(id)) ? 34 : 0;
  for (const impact of pendingImpacts) {
    const recognizedSourceId = impact.identityKnown === false
      ? (impact.perceivedSourceCharacterId || impact.sourceEntityHandle || "")
      : impact.sourceCharacterId;
    if (relatedIds.has(recognizedSourceId)
      || (impact.identityKnown !== false && targetId && impact.directedTargetId === targetId)) score += 28;
    score += lexicalCueScore(desire, impact);
  }
  return clamp(score);
}

function desiresForAppraisal(profile, state, context) {
  return (profile.desires || []).map((desire) => {
    const dynamic = state.desires?.[desire.id] || {};
    const strength = scale01(dynamic.strength, scale01(desire.baseStrength));
    return {
      id: desire.id,
      want: desireText(desire),
      baseline: strength,
      urgency: clamp(strength * 0.35 + scale01(dynamic.frustration) * 0.35),
      cueActivation: cueActivationFor(desire, context.pendingImpacts, context.recognizedCharacterIds),
      frustration: scale01(dynamic.frustration),
      needCoupling: /meal|fund|ledger|work_exchange/.test(desire.satisfactionCondition?.type || "") ? 62 : 34,
      deadlineUrgency: 0,
      satiation: scale01(dynamic.satisfaction),
    };
  });
}

function targetForDesire(profile, desire, visibleCharacterIds) {
  const criteria = desire.satisfactionCondition?.criteria || {};
  const candidates = [
    desire.target?.type === "character" ? desire.target.id : "",
    criteria.receiverCharacterId,
    criteria.speakerCharacterId,
    criteria.sourceSpeakerCharacterId,
    ...(criteria.actorCharacterIds || []).filter((id) => id !== profile.characterId),
    ...(criteria.participantCharacterIds || []).filter((id) => id !== profile.characterId),
  ].filter(Boolean);
  return candidates.find((id) => visibleCharacterIds.includes(id)) || candidates[0] || "";
}

function targetGate(targetCharacterId, visibleCharacterIds) {
  if (!targetCharacterId) return [];
  const passed = visibleCharacterIds.includes(targetCharacterId);
  return [{
    id: "target-perceived",
    label: "目标人物在本人可感知范围内",
    passed,
    reason: passed ? "目标人物当前可见或可听见" : "目标人物不在当前可感知范围",
  }];
}

function privacyObstacles(profile, context) {
  return [
    {
      id: "publicScrutiny",
      label: "旁人会看见这次表达",
      environmentKey: "atmosphere.publicScrutiny",
      sensitivityKey: "shameSensitivity",
      source: "atmosphere",
    },
    {
      id: "crowding",
      label: "场内人数使私下表达变难",
      environmentKey: "atmosphere.crowding",
      sensitivityKey: "privacyNeed",
      source: "environment",
    },
  ];
}

function practiceCandidate(desire, profile) {
  return {
    id: `desire:${desire.id}:practice`,
    label: desireText(desire),
    driveId: desire.id,
    actionKind: "practice",
    targetCharacterId: "",
    expectedSatisfaction: 66,
    opportunity: 62,
    bodyDemand: { exertion: 72, painRisk: 18, energyDemand: 28 },
    realization: { mode: "practice", allowSpeech: false, commitmentTopic: desire.target?.label || "练习" },
  };
}

function desireCandidates(profile, desire, context) {
  const conditionType = desire.satisfactionCondition?.type || "";
  const recognizedCharacterIds = context.recognizedCharacterIds || context.visibleCharacterIds;
  const targetCharacterId = targetForDesire(profile, desire, recognizedCharacterIds);
  const hardGates = targetGate(targetCharacterId, recognizedCharacterIds);
  const common = {
    driveId: desire.id,
    targetCharacterId,
    hardGates,
    semanticFrame: clone(desire.semanticFrame || null),
  };
  if (Array.isArray(desire.actionOptions) && desire.actionOptions.length) {
    return desire.actionOptions.map((option, index) => {
      const optionTargetId = option.targetCharacterId || targetCharacterId || "";
      const mode = option.mode || (optionTargetId ? "speak" : "act");
      const requireSpeech = option.requireSpeech ?? mode === "speak";
      return {
        ...common,
        id: `desire:${desire.id}:${option.id || index + 1}`,
        label: option.label || desireText(desire),
        actionKind: option.actionKind || "pursue_desired_state",
        targetCharacterId: optionTargetId,
        hardGates: targetGate(optionTargetId, recognizedCharacterIds),
        expectedSatisfaction: clamp(option.expectedSatisfaction ?? 58),
        opportunity: clamp(option.opportunity ?? (optionTargetId ? 68 : 56)),
        dutyPressure: clamp(option.dutyPressure),
        socialPull: clamp(option.socialPull),
        emotionalPull: clamp(option.emotionalPull),
        obstacles: clone(option.obstacles || []),
        bodyDemand: clone(option.bodyDemand || { exertion: 6 }),
        satisfactionEvidence: clone(option.satisfactionEvidence || null),
        realization: {
          mode,
          requireSpeech,
          allowSpeech: option.allowSpeech ?? requireSpeech,
          allowedSpeechActs: [...(option.allowedSpeechActs || (requireSpeech ? ["ask", "inform", "offer"] : ["none"]))],
          commitmentAction: option.commitmentAction || "none",
          commitmentTopic: option.commitmentTopic || desire.target?.label || desire.desiredState?.object || "个人目标",
          visibleActionHint: option.visibleActionHint || "",
        },
      };
    });
  }
  if (conditionType === "practice_result" || conditionType === "practice_and_registration") {
    return [practiceCandidate(desire, profile)];
  }
  if (conditionType === "validated_anchor_evidence") {
    return [{
      ...common,
      id: `desire:${desire.id}:pursue`,
      label: desireText(desire),
      actionKind: "pursue_desired_state",
      targetCharacterId: "",
      hardGates: [],
      expectedSatisfaction: 58,
      opportunity: 56,
      emotionalPull: 36,
      bodyDemand: { exertion: 4, energyDemand: 2 },
      satisfactionEvidence: {
        tags: [...(desire.satisfactionCondition?.criteria?.evidenceTags || [])],
        requiredEvidence: desire.satisfactionCondition?.criteria?.requiredEvidence || "",
        doesNotCount: [...(desire.satisfactionCondition?.criteria?.doesNotCount || [])],
      },
      realization: {
        mode: "adaptive",
        requireSpeech: false,
        allowSpeech: true,
        allowedSpeechActs: ["none", "ask", "inform", "offer", "answer", "refuse", "negotiate"],
        commitmentAction: "none",
        commitmentTopic: desire.target?.label || desire.desiredState?.object || "个人目标",
      },
    }];
  }
  if (conditionType === "mutual_duel_completed") {
    const targetLabel = desire.target?.label || "对方";
    return [
      {
        ...common,
        id: `desire:${desire.id}:invite`,
        label: `询问${targetLabel}是否愿意在合适地点正式交手`,
        actionKind: "invite_private_duel",
        expectedSatisfaction: 78,
        opportunity: targetCharacterId && recognizedCharacterIds.includes(targetCharacterId) ? 72 : 8,
        emotionalPull: 44,
        obstacles: [
          ...privacyObstacles(profile, context),
          {
            id: "duelingNormConflict",
            label: "酒馆营业与拔剑规范",
            environmentKey: "atmosphere.duelingNormConflict",
            sensitivityKey: "conscientiousness",
            source: "social-norm",
          },
        ],
        bodyDemand: { exertion: 4, painRisk: 2, energyDemand: 2 },
        realization: { mode: "speak", requireSpeech: true, allowedSpeechActs: ["offer", "ask"], commitmentAction: "open", commitmentTopic: "双方同意的正式交手" },
      },
      {
        ...common,
        id: `desire:${desire.id}:observe`,
        label: `先观察${targetLabel}本人如何行动`,
        actionKind: "observe_target",
        expectedSatisfaction: 36,
        opportunity: targetCharacterId && recognizedCharacterIds.includes(targetCharacterId) ? 76 : 6,
        emotionalPull: 26,
        obstacles: privacyObstacles(profile, context).slice(0, 1),
        bodyDemand: { exertion: 2 },
        realization: { mode: "observe", allowSpeech: false, commitmentTopic: `亲眼判断${targetLabel}` },
      },
    ];
  }
  const askKinds = new Set(["received_decision", "received_explanation", "verified_private_ledger", "conversation_completed"]);
  const communicateKinds = new Set(["communicated_decision"]);
  if (askKinds.has(conditionType) || communicateKinds.has(conditionType)) {
    const privateTopic = ["verified_private_ledger", "conversation_completed"].includes(conditionType);
    return [{
      ...common,
      id: `desire:${desire.id}:${communicateKinds.has(conditionType) ? "state" : "ask"}`,
      label: desireText(desire),
      actionKind: communicateKinds.has(conditionType) ? "state_clear_decision" : "request_clear_response",
      expectedSatisfaction: communicateKinds.has(conditionType) ? 92 : 72,
      opportunity: targetCharacterId && recognizedCharacterIds.includes(targetCharacterId) ? 82 : 6,
      socialPull: 44,
      obstacles: privateTopic ? privacyObstacles(profile, context) : [],
      bodyDemand: { exertion: 3, energyDemand: 2 },
      realization: {
        mode: "speak",
        requireSpeech: true,
        allowedSpeechActs: communicateKinds.has(conditionType) ? ["inform", "answer", "refuse"] : ["ask", "negotiate"],
        commitmentAction: communicateKinds.has(conditionType) ? "fulfill" : "open",
        commitmentTopic: desire.target?.label || desire.desiredState?.object || "未完请求",
      },
    }];
  }
  if (conditionType === "work_exchange_consumed") {
    const managerId = firstVisibleProfileByStanding(
      context.visibleCharacterIds,
      ["manager", "proprietor", "household_worker"],
      profile.characterId,
      context.runtime,
    );
    return [{
      ...common,
      id: `desire:${desire.id}:seek-work`,
      label: "向店家问清今天能换饭的具体杂务",
      actionKind: "request_work_exchange",
      targetCharacterId: managerId,
      hardGates: targetGate(managerId, context.visibleCharacterIds),
      expectedSatisfaction: 58,
      opportunity: context.visibleCharacterIds.includes(managerId) ? 82 : 5,
      socialPull: 24,
      obstacles: [{ id: "statusExposure", label: "开口讨活会显出手头拮据", intensity: 38, sensitivityKey: "shameSensitivity", source: "self-image" }],
      realization: { mode: "speak", requireSpeech: true, allowedSpeechActs: ["ask", "offer"], commitmentAction: "open", commitmentTopic: "以工换饭" },
    }];
  }
  if (conditionType === "verified_nomination") {
    const criteria = desire.satisfactionCondition?.criteria || {};
    const candidateIds = [
      ...(criteria.candidateCharacterIds || []),
      ...(criteria.participantCharacterIds || []),
    ].filter((id) => id && id !== profile.characterId);
    const candidateId = candidateIds.find((id) => recognizedCharacterIds.includes(id)) || "";
    return [{
      ...common,
      id: `desire:${desire.id}:verify`,
      label: candidateId ? "向在场候选核验本人实绩" : "核对手中已有候选记录",
      actionKind: candidateId ? "request_evidence" : "inspect_records",
      targetCharacterId: candidateId,
      hardGates: targetGate(candidateId, context.visibleCharacterIds),
      expectedSatisfaction: candidateId ? 55 : 32,
      opportunity: candidateId ? 72 : 48,
      dutyPressure: 66,
      bodyDemand: { exertion: 4 },
      realization: { mode: candidateId ? "speak" : "act", requireSpeech: Boolean(candidateId), allowedSpeechActs: ["ask", "inform"], commitmentTopic: "核验候选实绩" },
    }];
  }
  return [{
    ...common,
    id: `desire:${desire.id}:advance`,
    label: desireText(desire),
    actionKind: "advance_personal_goal",
    targetCharacterId: "",
    hardGates: [],
    expectedSatisfaction: 32,
    opportunity: 45,
    dutyPressure: conditionType === "ledger_threshold" ? 58 : 18,
    bodyDemand: { exertion: 6 },
    realization: { mode: "act", allowSpeech: false, commitmentTopic: desire.target?.label || "个人目标" },
  }];
}

function metricMidpoint(value, fallback = 0.5) {
  if (!Array.isArray(value) || value.length !== 2) return fallback;
  return (Number(value[0] || 0) + Number(value[1] || 0)) / 2;
}

function materialCandidates(profile, context) {
  return (context.availableAffordances || []).map((affordance) => {
    if (affordance.type === "request_service") {
      const body = context.body || {};
      const needChannels = new Set(affordance.needChannels || []);
      const sustenanceAppraisal = appraiseOfferingSustenance({
        sustenanceProfile: context.sustenanceProfile || profile.sustenanceProfile || {},
        bodyState: body,
        offering: affordance.offering || {},
        offeringId: affordance.offeringId || "",
      });
      const directNeed = Math.max(
        needChannels.has("thirst") ? scale01(sustenanceAppraisal.physiologicalNeed) : 0,
        needChannels.has("hunger") ? scale01(sustenanceAppraisal.physiologicalNeed) : 0,
        needChannels.has("fatigue")
          ? scale01(body.fatigue) * Number(sustenanceAppraisal.recoveryEfficiency || 0)
          : 0,
      );
      const informationCover = needChannels.has("information_cover") ? 62 : 0;
      const stayLegitimacy = needChannels.has("stay_legitimacy") ? 56 : 0;
      const cannotCoverPrice = affordance.paymentCapacity?.coversListedPrice === false;
      const preferences = context.economicContext?.consumptionPreferences || {};
      const qualitySensitivity = metricMidpoint(preferences.qualitySensitivity, 0.5);
      const wasteAversion = metricMidpoint(preferences.wasteAversion, 0.5);
      const statusDisplayDrive = metricMidpoint(preferences.statusDisplayDrive, 0.2);
      const tierValue = ({ plain: 0.28, rough: 0.2, house: 0.62, fine: 0.9, hearty: 0.66 })[
        affordance.offering?.qualityTier
      ] ?? 0.4;
      const qualityFit = clamp(tierValue * qualitySensitivity * 100);
      const sensoryValue = clamp(Number(sustenanceAppraisal.sensoryValue || 0) * 100);
      const portions = Math.max(1, Number(affordance.offering?.serving?.portions || 1));
      const wasteRisk = portions <= 1 ? 0 : clamp(
        (1 - Number(sustenanceAppraisal.physiologicalNeed || 0))
          * wasteAversion
          * Math.min(1, (portions - 1) / 2)
          * 100,
      );
      const priceAppraisal = appraiseServicePrice({
        economicContext: context.economicContext || {},
        price: affordance.price || affordance.offering?.price || {},
      });
      const priceBurden = clamp(priceAppraisal.acquisitionBurden * 100);
      const statusFit = clamp(tierValue * statusDisplayDrive * 100);
      const anticipatedBodyDemand = clone(affordance.bodyDemand || { exertion: 2, energyDemand: 1 });
      if (anticipatedBodyDemand.hungerRelief !== undefined) {
        anticipatedBodyDemand.hungerRelief = Number(anticipatedBodyDemand.hungerRelief || 0)
          * Number(sustenanceAppraisal.recoveryEfficiency || 0);
      }
      if (anticipatedBodyDemand.recovery !== undefined
        && ["mundane_food", "spiritual_food"].includes(sustenanceAppraisal.sustenanceClass)) {
        anticipatedBodyDemand.recovery = Number(anticipatedBodyDemand.recovery || 0)
          * Number(sustenanceAppraisal.recoveryEfficiency || 0);
      }
      return {
        id: `affordance:${affordance.id}`,
        label: affordance.label || "向经营者提出服务请求",
        driveId: `situated_service:${affordance.offeringId || affordance.id}`,
        actionKind: "request_situated_service",
        targetCharacterId: affordance.targetCharacterId || "",
        expectedSatisfaction: clamp(
          20
          + directNeed * 0.34
          + Math.max(informationCover, stayLegitimacy) * 0.24
          + qualityFit * 0.18
          + sensoryValue * 0.08
          + statusFit * 0.04
          - priceBurden * 0.12
          - wasteRisk * 0.1,
        ),
        opportunity: cannotCoverPrice ? 42 : 90,
        dutyPressure: 0,
        socialPull: 24,
        bodyDemand: anticipatedBodyDemand,
        hardGates: targetGate(affordance.targetCharacterId, context.visibleCharacterIds),
        desire: {
          id: `situated_service:${affordance.offeringId || affordance.id}`,
          want: "决定是否用眼前这项服务满足自己的身体、口味、停留或信息需要",
          baseline: clamp(
            18
            + directNeed * 0.42
            + Math.max(informationCover, stayLegitimacy) * 0.2
            + qualityFit * 0.14
            + sensoryValue * 0.08
            - priceBurden * 0.1
            - wasteRisk * 0.08,
          ),
          urgency: directNeed,
          cueActivation: 76,
          needCoupling: clamp(Math.max(directNeed, informationCover, stayLegitimacy)),
          satiation: 0,
        },
        serviceAppraisal: {
          directNeed,
          sustenance: clone(sustenanceAppraisal),
          informationCover,
          stayLegitimacy,
          qualityFit,
          sensoryValue,
          statusFit,
          wasteRisk,
          priceBurden,
          priceAppraisal,
          listedPrice: Number(affordance.price?.amount || 0),
          paymentCapacity: clone(affordance.paymentCapacity || {}),
        },
        realization: {
          mode: "affordance",
          affordanceId: affordance.id,
          requireSpeech: true,
          allowSpeech: true,
          allowedSpeechActs: [...(affordance.allowedSpeechActs || ["ask", "inform", "offer"])],
          commitmentTopic: affordance.offering?.label || affordance.label || "服务请求",
        },
      };
    }
    if (affordance.type === "take_guest_seat") {
      const metrics = affordance.position?.metrics || {};
      const informationAccess = metricMidpoint(metrics.informationAccess);
      const comfort = metricMidpoint(metrics.comfort);
      const socialExposure = metricMidpoint(metrics.socialExposure);
      const exitAccess = metricMidpoint(metrics.exitAccess);
      return {
        id: `affordance:${affordance.id}`,
        label: affordance.label || "选择一个当前可用的客位",
        driveId: `situated_position:${affordance.seatingPositionId || affordance.id}`,
        actionKind: "choose_guest_position",
        targetCharacterId: "",
        expectedSatisfaction: 44,
        opportunity: 92,
        dutyPressure: 0,
        socialPull: 8,
        bodyDemand: clone(affordance.bodyDemand || { exertion: 4, energyDemand: 1, recovery: 4 }),
        hardGates: [],
        desire: {
          id: `situated_position:${affordance.seatingPositionId || affordance.id}`,
          want: "为自己选择一个合适的停留位置",
          baseline: 38,
          urgency: 24,
          cueActivation: 68,
          needCoupling: 42,
          satiation: 0,
        },
        spatialAppraisal: { informationAccess, comfort, socialExposure, exitAccess },
        realization: {
          mode: "affordance",
          affordanceId: affordance.id,
          requireSpeech: false,
          allowSpeech: true,
          allowedSpeechActs: ["none", "greet", "ask", "inform"],
          commitmentTopic: affordance.position?.label || "客位选择",
          objectivePosition: clone(affordance.position || null),
        },
      };
    }
    return {
    id: `affordance:${affordance.id}`,
    label: affordance.label || affordance.canonicalVisibleAction || "完成眼前经营事务",
    driveId: `duty:${affordance.type || affordance.id}`,
    actionKind: `affordance_${affordance.type || "interact"}`,
    targetCharacterId: affordance.targetCharacterId || "",
    expectedSatisfaction: 24,
    opportunity: 94,
    priorityClass: affordance.priorityClass || "",
    obligationPriority: Number(affordance.obligationPriority || 0),
    commitmentPressure: Number(affordance.commitmentPressure || 0),
    waitingOnly: affordance.waitingOnly === true,
    dutyPressure: Math.round(52 + clamp(context.responsibilityPriority) * 44),
    socialPull: 34,
    bodyDemand: clone(affordance.bodyDemand || { exertion: 12, energyDemand: 4 }),
    hardGates: targetGate(affordance.targetCharacterId, context.visibleCharacterIds),
    desire: { id: `duty:${affordance.type || affordance.id}`, want: affordance.label || "完成职责", baseline: 42, urgency: 52, cueActivation: 80, needCoupling: 20, satiation: 0 },
    realization: {
      mode: "affordance",
      affordanceId: affordance.id,
      requireSpeech: Boolean(affordance.requiresSpeech),
      allowSpeech: affordance.requiresSpeech ? true : affordance.allowSpeech !== false,
      allowedSpeechActs: affordance.allowedSpeechActs?.length
        ? [...affordance.allowedSpeechActs]
        : ["none", "greet", "ask", "answer", "offer", "inform"],
      commitmentTopic: affordance.label || "经营事务",
    },
    };
  });
}

function impactCandidate(profile, context) {
  return (context.pendingImpacts || []).slice(0, 8).flatMap((impact) => (
    impactCandidateFrom(profile, context, impact)
  ));
}

function impactCandidateFrom(profile, context, impact) {
  const sourceCharacterId = impact.sourceCharacterId?.startsWith("world:") ? "" : impact.sourceCharacterId || "";
  const directed = Boolean(impact.directed || impact.directedTargetId === profile.characterId);
  const interpersonalObservation = Boolean(sourceCharacterId && !directed);
  const sourceAction = (context.runtime?.actions || []).find((action) => action.id === impact.provenance?.sourceActionId) || null;
  const sourceThread = impact.provenance?.sourceThreadId
    ? (context.runtime?.commitments || []).find((commitment) => commitment.id === impact.provenance.sourceThreadId)
    : null;
  // A thread id carries context, not an endless obligation to reply. It only
  // forces a turn when the scene was seeded from an unresolved obligation and
  // there is no current source action yet. Descendant answers may keep the
  // provenance for auditing, but cannot turn every answer into a new question.
  const seededThreadObligation = Boolean(
    !sourceAction
    && sourceThread?.status === "open"
    && sourceThread.ownerId === profile.characterId
    && directed,
  );
  const responseRequired = Boolean(sourceCharacterId && (
    seededThreadObligation
    || ["ask", "offer", "negotiate", "warn"].includes(sourceAction?.speechAct)
    || sourceAction?.commitmentAction === "open"
    || /[？?]|(?:请|能否|可否|是不是|要不要|愿不愿|答复|回话|等.{0,6}回应|正在等|想要|需要)/.test(`${impact.topic || ""} ${impact.content || ""}`)
  ));
  const interpersonalPressure = responseRequired ? 1 : sourceCharacterId ? 0.38 : 0.64;
  const requestLock = responseRequired ? [...(context.runtime?.requestLocks || [])].reverse().find((lock) => (
    lock.responderId === profile.characterId
    && lock.requesterId === sourceCharacterId
    && ["awaiting", "unresolved"].includes(lock.status)
    && (!sourceAction?.id || lock.latestActionId === sourceAction.id || lock.sourceActionId === sourceAction.id)
  )) : null;
  return [{
    id: `impact:${impact.impactId}:respond`,
    label: directed
      ? "回应刚刚直接抵达自己的言行"
      : interpersonalObservation ? "留意或接触刚刚进入感知范围的人" : "处理刚刚真正感知到的变化",
    driveId: `impact:${impact.impactId}`,
    actionKind: sourceCharacterId ? "respond_to_impact" : "handle_environment_event",
    semanticFrame: clone(impact.semanticFrame || null),
    targetCharacterId: sourceCharacterId,
    respondsToRequestId: requestLock?.id || "",
    priorityClass: requestLock ? "response_obligation" : "",
    obligationPriority: 0,
    commitmentPressure: requestLock ? 100 : responseRequired ? 72 : 0,
    requiresResolution: responseRequired,
    expectedSatisfaction: Math.round((directed ? 82 : 44) * interpersonalPressure),
    opportunity: Math.round(90 * interpersonalPressure),
    dutyPressure: sourceCharacterId ? 16 : 18,
    socialPull: Math.round((directed ? 88 : 22) * interpersonalPressure),
    emotionalPull: Math.round(clamp(impact.impactScore || 50) * interpersonalPressure),
    bodyDemand: { exertion: 4 },
    hardGates: targetGate(sourceCharacterId, context.visibleCharacterIds),
    desire: { id: `impact:${impact.impactId}`, want: responseRequired ? "对实际向自己提出的请求作出回应" : "留意刚刚抵达自己的变化", baseline: Math.round((directed ? 64 : 38) * interpersonalPressure), urgency: Math.round(clamp(impact.impactScore || 55) * interpersonalPressure), cueActivation: Math.round(92 * interpersonalPressure), frustration: 0, satiation: 0 },
    realization: {
      // Perceiving another person's ordinary movement creates an opportunity,
      // not an obligation.  The Character Agent may merely observe, remain
      // silent, greet, or ask; the world must not erase all social choices just
      // because no service transaction or explicit request exists yet.
      mode: sourceCharacterId ? (responseRequired ? "respond" : "observe") : "act",
      requireSpeech: Boolean(sourceCharacterId && responseRequired && impact.type === "speech"),
      allowSpeech: sourceCharacterId ? (responseRequired || interpersonalObservation) : true,
      allowedSpeechActs: sourceCharacterId && responseRequired
        ? ["answer", "inform", "ask", "refuse", "offer", "warn"]
        : interpersonalObservation
          ? ["none", "greet", "ask", "inform", "offer"]
          : ["none", "inform", "ask", "offer", "warn"],
      responseSourceImpactId: responseRequired ? impact.impactId : "",
      observationSourceImpactId: responseRequired ? "" : impact.impactId,
      responseSourceActionId: impact.provenance?.sourceActionId || "",
      commitmentTopic: impact.topic || "眼前变化",
    },
  }];
}

function restCandidate(profile, state) {
  const fatigue = scale01(state.body?.fatigue, clamp(100 - scale01(state.body?.energy, 60)));
  return {
    id: "body:recover",
    label: "让身体在原处缓过一阵",
    driveId: "body:recover",
    actionKind: "rest",
    targetCharacterId: "",
    expectedSatisfaction: 88,
    opportunity: 80,
    bodyDemand: { recovery: 92, safetyGain: 8 },
    desire: { id: "body:recover", want: "让自己的疲劳降下来", baseline: clamp(fatigue * 0.58), urgency: fatigue, cueActivation: fatigue, needCoupling: 76, satiation: clamp(100 - fatigue) },
    realization: { mode: "rest", allowSpeech: false, commitmentTopic: "恢复体力" },
  };
}

function intentionForAppraisal(state, elapsedSeconds) {
  const intention = state.currentIntention || {};
  if (!intention.sourceId) return null;
  const targetCharacterId = intention.target?.type === "character" ? intention.target.id : intention.targetCharacterId || "";
  return {
    driveId: intention.sourceId,
    actionKind: intention.actionKind || "",
    targetCharacterId,
    strength: clamp(intention.utility ?? 60),
    ageSeconds: Math.max(0, Number(elapsedSeconds || 0) - Number(intention.committedAtSecond || 0)),
    halfLifeSeconds: 240,
  };
}

function bodyForAppraisal(state) {
  const body = state.body || {};
  return {
    fatigue: scale01(body.fatigue, clamp(100 - scale01(body.energy, 60))),
    hunger: scale01(body.hunger),
    thirst: scale01(body.thirst),
    pain: scale01(body.pain),
    safetyNeed: 0,
    stamina: scale01(body.stamina, scale01(body.energy, 60)),
  };
}

function environmentForAppraisal(runtime, actor, visibleCount, situatedPosition = null) {
  const isPublicZone = ["threshold", "hall", "counter", "stove", "stairs"].includes(actor.zoneId);
  const open = runtime.slotContext?.slotBaseId !== "night" && !/夜深/.test(runtime.slotContext?.slotLabel || "");
  const traffic = metricMidpoint(situatedPosition?.metrics?.trafficInterference, 0.5) * 100;
  const exposure = metricMidpoint(situatedPosition?.metrics?.socialExposure, isPublicZone ? 0.55 : 0.2) * 100;
  const crowding = clamp(Math.max(0, visibleCount - 1) * 23 + (situatedPosition ? traffic * 0.18 : 0));
  return {
    locationId: runtime.locationId || TAVERN_LOCATION_ID,
    zoneId: actor.zoneId,
    timeOfDay: slotKind(runtime.slotContext?.slotLabel),
    atmosphere: {
      publicScrutiny: isPublicZone ? clamp(20 + crowding * 0.42 + exposure * 0.46) : clamp(8 + crowding * 0.25),
      crowding,
      duelingNormConflict: open ? (isPublicZone ? 96 : 68) : (isPublicZone ? 46 : 14),
      privacy: isPublicZone ? clamp(100 - crowding * 0.72 - exposure * 0.62) : clamp(88 - crowding * 0.35),
      tension: clamp(runtime.atmosphere?.tension || 12),
      hospitalityPressure: clamp(runtime.atmosphere?.hospitalityPressure || 0),
    },
    situatedPosition: clone(situatedPosition || null),
  };
}

export function appraiseTavernAgentEcology({
  character = {},
  runtime = {},
  actor = {},
  pendingImpacts = [],
  visibleCharacterIds = [],
  recognizedCharacterIds = visibleCharacterIds,
  availableAffordances = [],
  recentOwnActions = [],
  relationships = [],
  situatedPosition = null,
} = {}) {
  const sceneAgency = character.lifeProfile?.agency
    || character.agency
    || character.sceneAgency
    || character.lifeProfile?.tavernAgency
    || {};
  const { profile, state } = ensureTavernEcology(character, {
    present: actor.present !== false,
    zoneId: actor.zoneId,
    elapsedSeconds: runtime.elapsedSeconds,
    locationId: runtime.locationId || TAVERN_LOCATION_ID,
  });
  if (!profile || !state) return null;
  const context = {
    pendingImpacts,
    visibleCharacterIds,
    recognizedCharacterIds,
    availableAffordances,
    relationships,
    runtime,
    body: clone(state.body || {}),
    sustenanceProfile: clone(profile.sustenanceProfile || {}),
    economicContext: normalizeMaterialEconomyProfile(
      character.lifeProfile?.materialEconomy || {},
      character.lifeState?.resources || {},
    ),
    authority: sceneAgency.authority || sceneAgency.capabilities || {},
    responsibilityPriority: scale01(sceneAgency.servicePolicy?.priority ?? sceneAgency.responsibilityPriority, 50) / 100,
  };
  const desires = desiresForAppraisal(profile, state, context);
  const rawCandidates = [
    ...materialCandidates(profile, context),
    ...impactCandidate(profile, context),
    ...profile.desires.flatMap((desire) => desireCandidates(profile, desire, context)),
    restCandidate(profile, state),
  ].map((candidate) => applySocialAffectToCandidate(candidate, profile, state, context));
  const recentSignatures = new Set([
    ...(state.recentActionSignatures || []),
    ...(recentOwnActions || []).map((action) => line(`${action.actionType}:${action.targetCharacterId || ""}:${action.visibleAction || action.speech || ""}`).slice(0, 120)),
  ]);
  for (const candidate of rawCandidates) {
    const causalScopeId = candidate.respondsToRequestId
      || candidate.realization?.responseSourceImpactId
      || candidate.realization?.observationSourceImpactId
      || candidate.driveId
      || candidate.id;
    const signature = line(`${candidate.realization?.mode || candidate.actionKind}:${candidate.targetCharacterId || ""}:${candidate.actionKind}:${causalScopeId}`).slice(0, 180);
    const sameSceneSignatureCount = (recentOwnActions || []).filter((action) => action.ecologyRuntimeSignature === signature).length;
    if (sameSceneSignatureCount >= 2) {
      candidate.hardGates = [...(candidate.hardGates || []), {
        id: "same-scene-intention-cycle",
        label: "同一种行动意图不能在同一场景原地循环",
        passed: false,
        reason: "这个人物已经在本场用同一种方式行动两次，必须改做别的事或停止回应。",
      }];
    } else if (sameSceneSignatureCount > 0 || recentSignatures.has(signature)) {
      candidate.repetitionPenalty = 88;
    }
    const realizationMode = candidate.realization?.mode || "";
    const pairSpeechTurns = samePairSpeechTurnCount(runtime, profile.characterId, candidate.targetCharacterId);
    const opensRequest = candidate.realization?.commitmentAction === "open"
      || ["request_clear_response", "request_evidence", "request_work_exchange", "invite_private_duel"].includes(candidate.actionKind);
    const existingRequestLock = opensRequest
      ? [...(runtime.requestLocks || [])].reverse().find((lock) => (
        lock.requesterId === profile.characterId
        && lock.responderId === candidate.targetCharacterId
        && ["awaiting", "paused"].includes(lock.status)
      ))
      : null;
    if (existingRequestLock) {
      candidate.hardGates = [...(candidate.hardGates || []), {
        id: "same-scene-request-already-made",
        label: "已经向这个人提出请求并在等待结果",
        passed: false,
        reason: `本场已经提出“${existingRequestLock.topic || "这项请求"}”，没有新事实前不能换一种说法再问。`,
      }];
    }
    const freshDeliveredCause = Boolean(
      candidate.realization?.responseSourceImpactId
      && !(recentOwnActions || []).some((action) => (
        action.causalParentImpactId === candidate.realization.responseSourceImpactId
      )),
    );
    if (["speak", "respond"].includes(realizationMode)
      && pairSpeechTurns >= MAX_PAIR_SPEECH_TURNS_PER_SCENE
      && !freshDeliveredCause) {
      candidate.hardGates = [...(candidate.hardGates || []), {
        id: "same-scene-conversation-saturated",
        label: "同一对话必须产生新变化才能继续",
        passed: false,
        reason: `两人已连续交谈 ${pairSpeechTurns} 轮却没有新的事实或物理后果，本场先停止这条话题。`,
      }];
    }
    candidate.runtimeSignature = signature;
  }
  const environment = environmentForAppraisal(runtime, actor, visibleCharacterIds.length + 1, situatedPosition);
  const characterInput = {
    id: character.id,
    name: character.name || profile.name,
    traits: profileTraits(profile),
    ecologyProfile: { traits: profileTraits(profile) },
    factorWeights: ecologyFactorWeightsForProfile(profile),
  };
  const appraisal = appraiseTavernEcology({
    character: characterInput,
    bodyState: bodyForAppraisal(state),
    currentState: {
      arousal: state.affect?.arousal,
      traumaActivation: Math.max(0, ...Object.values(state.sensitivityActivations || {}).map((entry) => Number(entry.activation || 0))),
      affect: clone(state.affect || {}),
    },
    environment,
    desires,
    intention: intentionForAppraisal(state, runtime.elapsedSeconds),
    candidates: rawCandidates,
    relationships,
    pendingInteractions: runtime.requestLocks || [],
    recentActions: recentOwnActions,
    selectionPolicy: {
      authority: "character-agent",
      selectCandidate: false,
      nearTopWindow: 8,
      temperature: clamp(2 + scale01(profile.personality?.impulsivity) * 0.04, 2, 6),
    },
    seed: `${runtime.macroDay || 0}:${runtime.macroTick || 0}:${runtime.slotContext?.slotId || "scene"}:${runtime.step || 0}:${character.id}`,
  });
  const feasibleEvaluations = (appraisal.candidates || []).filter((candidate) => candidate.feasible);
  const priorityTier = Math.max(0, ...feasibleEvaluations.map((candidate) => Number(candidate.genericPriorityTier || 0)));
  const activationPool = feasibleEvaluations.filter((candidate) => Number(candidate.genericPriorityTier || 0) === priorityTier);
  const activationScore = Math.max(0, ...activationPool.map((candidate) => Number(candidate.activationScore || 0)));
  return {
    profile,
    state,
    desires,
    environment,
    candidates: rawCandidates,
    appraisal,
    selectionAuthority: "character-agent",
    selectedIntent: null,
    selectedDesire: null,
    activationScore,
    priorityTier,
  };
}

export function ecologyAgentCandidateBundle(ecology = null) {
  if (!ecology) return [];
  const evaluations = new Map((ecology.appraisal?.candidates || []).map((row) => [row.candidateId, row]));
  const desires = new Map((ecology.desires || []).map((desire) => [desire.id, desire]));
  return (ecology.candidates || []).map((candidate) => {
    const evaluation = evaluations.get(candidate.id) || {};
    const desire = desires.get(candidate.driveId) || candidate.desire || null;
    return {
      candidateId: candidate.id,
      label: candidate.label || candidate.id,
      driveId: candidate.driveId || "",
      desire: desire?.want || "",
      actionKind: candidate.actionKind || "",
      targetCharacterId: candidate.targetCharacterId || "",
      semanticFrame: clone(candidate.semanticFrame || null),
      realization: clone(candidate.realization || {}),
      relationshipAppraisal: clone(candidate.relationshipAppraisal || {}),
      copingBias: clone(candidate.copingBias || {}),
      expressionStrategy: clone(candidate.expressionStrategy || {}),
      feasible: Boolean(evaluation.feasible),
      blockedBy: [...(evaluation.blockedBy || [])],
      activationScore: Number(evaluation.activationScore || 0),
      priorityTier: Number(evaluation.genericPriorityTier || 0),
      ownDecisionFactors: {
        desirePressure: clone(evaluation.desirePressure || {}),
        bodyAppraisal: clone(evaluation.bodyAppraisal || {}),
        serviceAppraisal: clone(candidate.serviceAppraisal || {}),
        spatialAppraisal: clone(candidate.spatialAppraisal || {}),
        obstacleResistance: clone(evaluation.obstacleResistance || {}),
        intentionContinuity: clone(evaluation.intentionContinuity || {}),
        hardGates: clone(evaluation.hardGates || []),
        factorLedger: clone(evaluation.factorLedger || []),
      },
    };
  });
}

export function bindTavernAgentEcologyChoice(ecology = null, candidateId = "") {
  if (!ecology || !candidateId) return null;
  const selectedIntent = (ecology.candidates || []).find((candidate) => candidate.id === candidateId) || null;
  const selectedCandidate = (ecology.appraisal?.candidates || []).find((candidate) => candidate.candidateId === candidateId) || null;
  if (!selectedIntent || !selectedCandidate?.feasible) return null;
  const selectedDesire = (ecology.desires || []).find((desire) => desire.id === selectedIntent.driveId)
    || selectedIntent.desire
    || null;
  const selection = {
    ...(ecology.appraisal?.selection || {}),
    authority: "character-agent",
    selectedCandidateId: candidateId,
    randomDraw: null,
    pool: (ecology.appraisal?.selection?.pool || []).map((row) => ({
      ...row,
      selected: row.candidateId === candidateId,
    })),
  };
  const observerFactorTrace = ecology.appraisal?.observerFactorTrace ? {
    ...ecology.appraisal.observerFactorTrace,
    selection: clone(selection),
  } : null;
  return {
    ...ecology,
    selectionAuthority: "character-agent",
    selectedIntent,
    selectedDesire,
    activationScore: Number(selectedCandidate.activationScore || 0),
    priorityTier: Number(selectedCandidate.genericPriorityTier || 0),
    appraisal: {
      ...ecology.appraisal,
      selectedCandidateId: candidateId,
      selectedCandidate,
      selection,
      observerFactorTrace,
    },
  };
}

export function ecologyDecisionSummary(ecology = null) {
  if (!ecology?.selectedIntent) return null;
  return {
    formulaVersion: ecology.appraisal?.formulaVersion || "",
    selectedCandidateId: ecology.selectedIntent.id,
    label: ecology.selectedIntent.label,
    driveId: ecology.selectedIntent.driveId,
    desire: ecology.selectedDesire?.want || "",
    actionKind: ecology.selectedIntent.actionKind,
    targetCharacterId: ecology.selectedIntent.targetCharacterId || "",
    semanticFrame: clone(ecology.selectedIntent.semanticFrame || null),
    realization: clone(ecology.selectedIntent.realization || {}),
    relationshipAppraisal: clone(ecology.selectedIntent.relationshipAppraisal || {}),
    copingBias: clone(ecology.selectedIntent.copingBias || {}),
    expressionStrategy: clone(ecology.selectedIntent.expressionStrategy || {}),
    activationScore: Number(ecology.activationScore || 0),
    priorityTier: Number(ecology.priorityTier || 0),
    alternatives: (ecology.appraisal?.candidates || []).map((candidate) => ({
      candidateId: candidate.candidateId,
      label: candidate.label,
      feasible: candidate.feasible,
      activationScore: candidate.activationScore,
      blockedBy: [...(candidate.blockedBy || [])],
    })).sort((left, right) => right.activationScore - left.activationScore).slice(0, 6),
  };
}
