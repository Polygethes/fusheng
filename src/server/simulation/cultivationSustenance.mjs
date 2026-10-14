const MODE_DEFAULTS = Object.freeze({
  ordinary_food_dependent: Object.freeze({
    ordinaryFoodDependence: 1,
    ordinaryFoodRecoveryEfficiency: 1,
    basalHungerGrowth: 1,
    exertionHungerCoupling: 1,
    spiritualFoodConversion: 0.25,
    fastingToleranceBand: "ordinary",
  }),
  reduced_mundane_dependence: Object.freeze({
    ordinaryFoodDependence: 0.58,
    ordinaryFoodRecoveryEfficiency: 0.72,
    basalHungerGrowth: 0.56,
    exertionHungerCoupling: 0.62,
    spiritualFoodConversion: 0.7,
    fastingToleranceBand: "extended",
  }),
  long_fasting_low_mundane_need: Object.freeze({
    ordinaryFoodDependence: 0.14,
    ordinaryFoodRecoveryEfficiency: 0.22,
    basalHungerGrowth: 0.14,
    exertionHungerCoupling: 0.18,
    spiritualFoodConversion: 0.92,
    fastingToleranceBand: "long",
  }),
  bigu_independent: Object.freeze({
    ordinaryFoodDependence: 0.02,
    ordinaryFoodRecoveryEfficiency: 0.05,
    basalHungerGrowth: 0.02,
    exertionHungerCoupling: 0.04,
    spiritualFoodConversion: 1,
    fastingToleranceBand: "indefinite_while_cultivation_supply_holds",
  }),
});

const RANGE_KEYS = Object.freeze([
  "ordinaryFoodDependenceRange",
  "ordinaryFoodRecoveryEfficiencyRange",
  "basalHungerGrowthRange",
  "exertionHungerCouplingRange",
  "spiritualFoodConversionRange",
]);

function clean(value = "", max = 180) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function clamp01(value, fallback = 0.5) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function range(value, fallback) {
  const source = Array.isArray(value) && value.length === 2 ? value : fallback;
  const low = clamp01(source[0], fallback[0]);
  const high = clamp01(source[1], fallback[1]);
  return low <= high ? [low, high] : [high, low];
}

function midpoint(value, fallback = 0.5) {
  if (!Array.isArray(value) || value.length !== 2) return fallback;
  return (Number(value[0]) + Number(value[1])) / 2;
}

function fixedRange(value) {
  const numeric = clamp01(value);
  return [numeric, numeric];
}

function inferredOfferingKind(offering = {}, offeringId = "") {
  const explicit = clean(offering.category || offering.serviceKind);
  if (explicit) return explicit;
  const id = clean(offeringId);
  if (/tea|water/u.test(id)) return "tea";
  if (/meal|food/u.test(id)) return "meal";
  return "service";
}

export function normalizeCultivationSustenanceProfile(profile = {}) {
  const source = profile?.sustenance && typeof profile.sustenance === "object"
    ? profile.sustenance
    : profile;
  const mode = Object.hasOwn(MODE_DEFAULTS, source?.mode)
    ? source.mode
    : "ordinary_food_dependent";
  const defaults = MODE_DEFAULTS[mode];
  return {
    schemaVersion: 1,
    authority: clean(source?.authority || "character-embodied-capacity"),
    mode,
    authorBand: clean(source?.authorBand || mode),
    numericAuthority: clean(source?.numericAuthority || "engine-operational-default-from-author-band"),
    authorNumericCalibration: clean(source?.authorNumericCalibration || "unassigned"),
    ordinaryFoodDependenceRange: range(
      source?.ordinaryFoodDependenceRange,
      fixedRange(defaults.ordinaryFoodDependence),
    ),
    ordinaryFoodRecoveryEfficiencyRange: range(
      source?.ordinaryFoodRecoveryEfficiencyRange,
      fixedRange(defaults.ordinaryFoodRecoveryEfficiency),
    ),
    basalHungerGrowthRange: range(
      source?.basalHungerGrowthRange,
      fixedRange(defaults.basalHungerGrowth),
    ),
    exertionHungerCouplingRange: range(
      source?.exertionHungerCouplingRange,
      fixedRange(defaults.exertionHungerCoupling),
    ),
    spiritualFoodConversionRange: range(
      source?.spiritualFoodConversionRange,
      fixedRange(defaults.spiritualFoodConversion),
    ),
    fastingToleranceBand: clean(source?.fastingToleranceBand || defaults.fastingToleranceBand),
    alternativeSustenanceSources: [...new Set((source?.alternativeSustenanceSources || [])
      .map((row) => clean(row))
      .filter(Boolean))],
    exceptions: [...new Set((source?.exceptions || []).map((row) => clean(row)).filter(Boolean))],
    choiceBoundary: "生理档案只改变身体需要与食物转化价值；口味、礼节、社交、信息掩护和个人选择仍由 Character Agent 独立评价。",
  };
}

export function auditCultivationSustenanceProfile(profile = {}) {
  const source = profile?.sustenance && typeof profile.sustenance === "object"
    ? profile.sustenance
    : profile;
  const issues = [];
  if (!Object.hasOwn(MODE_DEFAULTS, source?.mode)) {
    issues.push({ code: "SUSTENANCE_MODE_INVALID", path: "mode" });
  }
  for (const key of RANGE_KEYS) {
    if (source?.[key] === undefined) continue;
    const value = source[key];
    if (!Array.isArray(value)
      || value.length !== 2
      || value.some((part) => !Number.isFinite(Number(part)) || Number(part) < 0 || Number(part) > 1)
      || Number(value[0]) > Number(value[1])) {
      issues.push({ code: "SUSTENANCE_RANGE_INVALID", path: key });
    }
  }
  return { valid: issues.length === 0, issues };
}

export function operationalSustenanceFactors(profile = {}) {
  const normalized = normalizeCultivationSustenanceProfile(profile);
  return {
    mode: normalized.mode,
    ordinaryFoodDependence: midpoint(normalized.ordinaryFoodDependenceRange, 1),
    ordinaryFoodRecoveryEfficiency: midpoint(normalized.ordinaryFoodRecoveryEfficiencyRange, 1),
    basalHungerGrowth: midpoint(normalized.basalHungerGrowthRange, 1),
    exertionHungerCoupling: midpoint(normalized.exertionHungerCouplingRange, 1),
    spiritualFoodConversion: midpoint(normalized.spiritualFoodConversionRange, 0.25),
    fastingToleranceBand: normalized.fastingToleranceBand,
    numericAuthority: normalized.numericAuthority,
  };
}

export function normalizeOfferingSustenance(offering = {}, offeringId = "") {
  const explicit = offering.sustenance && typeof offering.sustenance === "object"
    ? offering.sustenance
    : {};
  const kind = inferredOfferingKind(offering, offeringId);
  const sustenanceClass = clean(explicit.class || offering.sustenanceClass || (
    kind === "tea" ? "mundane_drink"
      : ["meal", "work_meal"].includes(kind) ? "mundane_food"
        : "none"
  ));
  return {
    class: sustenanceClass,
    mundaneNutrition: clamp01(explicit.mundaneNutrition, sustenanceClass === "mundane_food" ? 1 : 0),
    spiritualNutrition: clamp01(explicit.spiritualNutrition, sustenanceClass === "spiritual_food" ? 1 : 0),
    hydration: clamp01(explicit.hydration, sustenanceClass === "mundane_drink" ? 1 : 0),
    sensoryValue: clamp01(explicit.sensoryValue, 0.4),
  };
}

export function appraiseOfferingSustenance({
  sustenanceProfile = {},
  bodyState = {},
  offering = {},
  offeringId = "",
} = {}) {
  const factors = operationalSustenanceFactors(sustenanceProfile);
  const nutrition = normalizeOfferingSustenance(offering, offeringId);
  const hunger = clamp01(bodyState.hunger, 0);
  const thirst = clamp01(bodyState.thirst, 0);
  let physiologicalNeed = 0;
  let recoveryEfficiency = 0;
  if (nutrition.class === "mundane_food") {
    physiologicalNeed = hunger * factors.ordinaryFoodDependence * nutrition.mundaneNutrition;
    recoveryEfficiency = factors.ordinaryFoodRecoveryEfficiency * nutrition.mundaneNutrition;
  } else if (nutrition.class === "spiritual_food") {
    physiologicalNeed = hunger * factors.spiritualFoodConversion * nutrition.spiritualNutrition;
    recoveryEfficiency = factors.spiritualFoodConversion * nutrition.spiritualNutrition;
  } else if (nutrition.class === "mundane_drink") {
    physiologicalNeed = thirst * nutrition.hydration;
    recoveryEfficiency = nutrition.hydration;
  }
  return {
    sustenanceClass: nutrition.class,
    rawHunger: hunger,
    rawThirst: thirst,
    physiologicalNeed: clamp01(physiologicalNeed, 0),
    recoveryEfficiency: clamp01(recoveryEfficiency, 0),
    ordinaryFoodDependence: factors.ordinaryFoodDependence,
    basalHungerGrowth: factors.basalHungerGrowth,
    exertionHungerCoupling: factors.exertionHungerCoupling,
    fastingToleranceBand: factors.fastingToleranceBand,
    sensoryValue: nutrition.sensoryValue,
    numericAuthority: factors.numericAuthority,
  };
}

export const CULTIVATION_SUSTENANCE_MODES = Object.freeze(Object.keys(MODE_DEFAULTS));
