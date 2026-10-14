import { applyWeatherToBody } from "./weatherOnBody.mjs";

export const CHARACTER_PHYSIOLOGY_CONTINUITY_VERSION = "character-physiology-continuity-v1";

const DEFAULT_BODY_PER_HOUR = Object.freeze({
  hunger: 0.018,
  thirst: 0.024,
  fatigue: 0.006,
  painRecovery: 0.001,
  staminaDrain: 0.004,
});

const COMMITTED_STATUSES = new Set([
  "applied",
  "committed",
  "completed",
  "executed",
  "success",
  "succeeded",
]);

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp01(value, fallback = 0) {
  return Math.min(1, Math.max(0, finite(value, fallback)));
}

function rounded(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(finite(value) * factor) / factor;
}

function clean(value = "") {
  return String(value ?? "").trim().toLowerCase();
}

function canonicalBody(source = {}) {
  const body = clone(source || {});
  const fatigue = clamp01(body.fatigue ?? body.exertion, 0);
  const stamina = clamp01(body.stamina ?? body.energy, 1 - fatigue);
  return {
    ...body,
    hunger: clamp01(body.hunger),
    thirst: clamp01(body.thirst),
    fatigue,
    exertion: fatigue,
    pain: clamp01(body.pain),
    stamina,
    energy: stamina,
  };
}

function applyDeltas(body, deltas = {}) {
  const next = canonicalBody(body);
  for (const key of ["hunger", "thirst", "fatigue", "pain", "stamina"]) {
    next[key] = rounded(clamp01(next[key] + finite(deltas[key])));
  }
  next.energy = next.stamina;
  next.exertion = next.fatigue;
  return next;
}

/**
 * Advances private physiology by objective wall-clock time. The caller owns
 * `lastWorldSyncSeconds`; keeping that boundary outside ecology elapsed time
 * makes repeated and stale projections idempotent.
 */
export function advanceCharacterPhysiologyTo({
  ecologyState = {},
  lastWorldSyncSeconds = 0,
  targetWorldSeconds = 0,
  bodyPerHour = DEFAULT_BODY_PER_HOUR,
  exposure = null,
  vulnerability = 1,
} = {}) {
  const state = clone(ecologyState || {});
  const previousBoundary = Math.max(0, finite(lastWorldSyncSeconds));
  const targetBoundary = Math.max(0, finite(targetWorldSeconds));
  if (targetBoundary <= previousBoundary) {
    return {
      ecologyState: state,
      lastWorldSyncSeconds: previousBoundary,
    };
  }

  const elapsedSeconds = targetBoundary - previousBoundary;
  const hours = elapsedSeconds / 3600;
  const basal = applyDeltas(state.body || state.bodyState || {}, {
    hunger: finite(bodyPerHour.hunger, DEFAULT_BODY_PER_HOUR.hunger) * hours,
    thirst: finite(bodyPerHour.thirst, DEFAULT_BODY_PER_HOUR.thirst) * hours,
    fatigue: finite(bodyPerHour.fatigue, DEFAULT_BODY_PER_HOUR.fatigue) * hours,
    pain: -finite(bodyPerHour.painRecovery, DEFAULT_BODY_PER_HOUR.painRecovery) * hours,
    stamina: -finite(bodyPerHour.staminaDrain, DEFAULT_BODY_PER_HOUR.staminaDrain) * hours,
  });
  const body = exposure ? applyWeatherToBody(basal, exposure, elapsedSeconds, vulnerability) : basal;
  return {
    ecologyState: {
      ...state,
      elapsedSeconds: rounded(Math.max(0, finite(state.elapsedSeconds)) + elapsedSeconds),
      body,
    },
    lastWorldSyncSeconds: targetBoundary,
  };
}

function actionSpecificDeltas(primitive, durationSeconds) {
  const durationScale = Math.max(0.25, Math.min(2, durationSeconds / 600 || 1));
  if (["rest", "sleep", "recover", "sit_and_recover"].includes(primitive)) {
    return {
      fatigue: -0.18 * durationScale,
      pain: -0.015 * durationScale,
      stamina: 0.18 * 1.15 * durationScale,
    };
  }
  if (["eat", "have_meal", "consume_food", "serve_self_meal"].includes(primitive)) {
    return { hunger: -0.28, fatigue: -0.03, stamina: 0.07 };
  }
  if (["drink", "have_drink", "consume_drink", "drink_tea", "drink_water"].includes(primitive)) {
    return { thirst: -0.28 };
  }

  const exertionByPrimitive = {
    move: 0.06,
    gesture: 0.015,
    work: 0.18,
    practice: 0.18,
    spar: 0.28,
    fight: 0.36,
    carry: 0.2,
    chop: 0.22,
    chop_wood: 0.22,
    fetch_water: 0.16,
    physical_labor: 0.24,
    use_affordance: 0.12,
  };
  const baseExertion = exertionByPrimitive[primitive];
  if (baseExertion === undefined) return {};
  const actionScale = Math.max(0.1, Math.min(2, durationSeconds / 1800 || 0.1));
  const exertion = baseExertion * actionScale;
  return {
    hunger: exertion * 0.08,
    thirst: exertion * 0.1,
    fatigue: exertion * 0.28,
    stamina: -exertion * 0.34,
  };
}

/**
 * Applies the activity-specific load or recovery of an action that the world
 * actually settled. Basal wall-clock change belongs to
 * `advanceCharacterPhysiologyTo` and is intentionally not duplicated here.
 */
export function applySettledCharacterActionPhysiology({
  ecologyState = {},
  actionOutcome = {},
} = {}) {
  const state = clone(ecologyState || {});
  if (!COMMITTED_STATUSES.has(clean(actionOutcome.status))) return state;
  const primitive = clean(actionOutcome.primitive || actionOutcome.actionKind);
  const durationSeconds = Math.max(0, finite(actionOutcome.durationSeconds));
  const deltas = actionSpecificDeltas(primitive, durationSeconds);
  if (!Object.keys(deltas).length) return state;
  return {
    ...state,
    body: applyDeltas(state.body || state.bodyState || {}, deltas),
  };
}
