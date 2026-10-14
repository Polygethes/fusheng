const PREFERENCE_KEYS = Object.freeze([
  "priceSensitivity",
  "qualitySensitivity",
  "statusDisplayDrive",
  "wasteAversion",
  "bargainingWillingness",
  "transactionPatience",
]);

function text(value = "", max = 180) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function clamp01(value, fallback = 0.5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function normalizeRange(value, fallback = [0.4, 0.6]) {
  const source = Array.isArray(value) ? value : fallback;
  const low = clamp01(source[0], fallback[0]);
  const high = clamp01(source[1], fallback[1]);
  return low <= high ? [low, high] : [high, low];
}

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function midpoint(value, fallback = 0.5) {
  if (!Array.isArray(value) || value.length !== 2) return fallback;
  return (Number(value[0]) + Number(value[1])) / 2;
}

function normalizeCurrencyAccess(source = {}) {
  const entries = Object.entries(source || {});
  const normalized = {};
  for (const [currencyId, row] of entries) {
    const id = text(currencyId || row?.currencyId);
    if (!id) continue;
    normalized[id] = {
      currencyId: id,
      currencyClass: text(row?.currencyClass || (id === "copper_wen" ? "mundane" : "unclassified")),
      acquisitionEaseRange: normalizeRange(row?.acquisitionEaseRange, [0.2, 0.4]),
      strategicValueRange: normalizeRange(row?.strategicValueRange, [0.4, 0.6]),
      conversionFrictionRange: normalizeRange(row?.conversionFrictionRange, [0.4, 0.6]),
      acquisitionRequiresAction: row?.acquisitionRequiresAction !== false,
      carriedTenderRequiredAtSettlement: row?.carriedTenderRequiredAtSettlement !== false,
      description: text(row?.description || "取得难度与当前随身余额分别结算"),
    };
  }
  if (!normalized.copper_wen) {
    normalized.copper_wen = {
      currencyId: "copper_wen",
      currencyClass: "mundane",
      acquisitionEaseRange: [0.2, 0.4],
      strategicValueRange: [0.4, 0.6],
      conversionFrictionRange: [0.4, 0.6],
      acquisitionRequiresAction: true,
      carriedTenderRequiredAtSettlement: true,
      description: "没有人物依据时不假定凡俗钱财易得；当前随身余额仍独立结算",
    };
  }
  return normalized;
}

export function normalizeMaterialEconomyProfile(profile = {}, resources = {}) {
  const wallet = profile.initialWallet || {};
  const actualCoins = Number.isFinite(Number(resources.coins))
    ? Math.max(0, Number(resources.coins))
    : Math.max(0, Number(wallet.amount || 0));
  const preferences = {};
  for (const key of PREFERENCE_KEYS) {
    preferences[key] = normalizeRange(profile.consumptionPreferences?.[key]);
  }
  return {
    schemaVersion: 1,
    authority: "character-owned-material-state",
    wealthBand: text(profile.wealthBand || "unanchored"),
    materialPosition: text(profile.materialPosition || "尚未建立稳定财富事实"),
    wallet: {
      currencyId: text(wallet.currencyId || "copper_wen"),
      amount: actualCoins,
      sourceId: text(wallet.sourceId || "unanchored_wallet"),
    },
    access: {
      reserveMode: text(profile.access?.reserveMode || "none_known"),
      reserveDescription: text(profile.access?.reserveDescription || "没有可安全假定的额外钱财"),
      businessTillAccess: Boolean(profile.access?.businessTillAccess),
      institutionalSupport: Boolean(profile.access?.institutionalSupport),
    },
    sources: (profile.sources || []).map((row) => ({
      id: text(row.id),
      kind: text(row.kind),
      description: text(row.description),
      reliability: normalizeRange(row.reliability, [0.8, 1]),
    })).filter((row) => row.id && row.kind),
    obligations: (profile.obligations || []).map((row) => ({
      id: text(row.id),
      description: text(row.description),
      pressureRange: normalizeRange(row.pressureRange, [0, 0]),
    })).filter((row) => row.id),
    currencyAccess: normalizeCurrencyAccess(profile.currencyAccess || {}),
    consumptionPreferences: preferences,
    categoryKnowledge: clone(profile.categoryKnowledge || {}),
    compilationNote: "取得凡俗钱财的难度、钱财的战略价值和此刻随身流动性彼此独立；这些范围只改变私有评价，不生成钱币，也不指定购买结果。",
  };
}

export function auditMaterialEconomyProfile(profile = {}) {
  const issues = [];
  if (!text(profile.wealthBand)) issues.push({ code: "ECONOMY_WEALTH_BAND_MISSING", path: "wealthBand" });
  if (!text(profile.initialWallet?.currencyId) || !Number.isFinite(Number(profile.initialWallet?.amount))) {
    issues.push({ code: "ECONOMY_INITIAL_WALLET_INVALID", path: "initialWallet" });
  }
  for (const key of PREFERENCE_KEYS) {
    const value = profile.consumptionPreferences?.[key];
    if (!Array.isArray(value) || value.length !== 2 || value.some((part) => !Number.isFinite(Number(part)) || Number(part) < 0 || Number(part) > 1)) {
      issues.push({ code: "ECONOMY_PREFERENCE_RANGE_INVALID", path: `consumptionPreferences.${key}` });
    }
  }
  for (const [currencyId, row] of Object.entries(profile.currencyAccess || {})) {
    if (!text(currencyId) || !text(row?.currencyClass)) {
      issues.push({ code: "ECONOMY_CURRENCY_ACCESS_INVALID", path: `currencyAccess.${currencyId}` });
      continue;
    }
    for (const key of ["acquisitionEaseRange", "strategicValueRange", "conversionFrictionRange"]) {
      const value = row?.[key];
      if (!Array.isArray(value)
        || value.length !== 2
        || value.some((part) => !Number.isFinite(Number(part)) || Number(part) < 0 || Number(part) > 1)
        || Number(value[0]) > Number(value[1])) {
        issues.push({ code: "ECONOMY_CURRENCY_RANGE_INVALID", path: `currencyAccess.${currencyId}.${key}` });
      }
    }
  }
  return { valid: issues.length === 0, issues };
}

export function appraiseServicePrice({ economicContext = {}, price = {} } = {}) {
  const normalized = normalizeMaterialEconomyProfile(economicContext, {
    coins: economicContext?.wallet?.amount,
  });
  const currencyId = text(price.currencyId || "copper_wen");
  const amount = Math.max(0, Number(price.amount || 0));
  const access = normalized.currencyAccess[currencyId] || normalizeCurrencyAccess({})["copper_wen"];
  const walletAmount = normalized.wallet.currencyId === currencyId
    ? Math.max(0, Number(normalized.wallet.amount || 0))
    : 0;
  const acquisitionEase = midpoint(access.acquisitionEaseRange, 0.3);
  const strategicValue = midpoint(access.strategicValueRange, 0.5);
  const conversionFriction = midpoint(access.conversionFrictionRange, 0.5);
  const priceRelativeToLiquidity = amount <= 0 ? 0 : Math.min(1, amount / Math.max(amount, walletAmount));
  const acquisitionBurden = amount <= 0
    ? 0
    : clamp01(
      priceRelativeToLiquidity
        * ((1 - acquisitionEase) * 0.52 + strategicValue * 0.32 + conversionFriction * 0.16),
      0,
    );
  const coversListedPrice = walletAmount >= amount;
  return {
    currencyId,
    currencyClass: access.currencyClass,
    listedAmount: amount,
    carriedAmount: walletAmount,
    coversListedPrice,
    immediateLiquidityFriction: coversListedPrice ? 0 : 1,
    acquisitionEase,
    strategicValue,
    conversionFriction,
    acquisitionBurden,
    acquisitionRequiresAction: access.acquisitionRequiresAction,
    carriedTenderRequiredAtSettlement: access.carriedTenderRequiredAtSettlement,
    rule: "低取得成本只降低价格压力；若随身余额不足，仍须先发生取得、兑换、借取或获准记账的真实行动。",
  };
}

export function offeringServiceKind(offering = {}, offeringId = "") {
  const explicit = text(offering.serviceKind || offering.category);
  if (explicit) return explicit;
  const id = text(offeringId);
  if (/tea|water/u.test(id)) return "tea";
  if (/meal|food/u.test(id)) return "meal";
  if (/lodging|room/u.test(id)) return "lodging";
  return "service";
}

export function offeringStockCost(offering = {}, offeringId = "") {
  const explicit = offering.stockCost && typeof offering.stockCost === "object"
    ? offering.stockCost
    : null;
  if (explicit) {
    return Object.fromEntries(Object.entries(explicit)
      .filter(([key, amount]) => text(key) && Number(amount) > 0)
      .map(([key, amount]) => [key, Number(amount)]));
  }
  const kind = offeringServiceKind(offering, offeringId);
  if (kind === "tea") return { tea: 1, water: 1 };
  if (kind === "meal") return { meals: 1 };
  return {};
}

export function offeringCurrentlyAvailable(stock = {}, offering = {}, offeringId = "") {
  if (offering.available === false) return false;
  return Object.entries(offeringStockCost(offering, offeringId)).every(([stockId, amount]) => (
    Number(stock?.[stockId] || 0) >= Number(amount || 0)
  ));
}

export function consumeOfferingStock(stock = {}, offering = {}, offeringId = "") {
  const cost = offeringStockCost(offering, offeringId);
  if (!offeringCurrentlyAvailable(stock, offering, offeringId)) return null;
  const delta = {};
  for (const [stockId, amount] of Object.entries(cost)) {
    stock[stockId] = Number(stock[stockId] || 0) - amount;
    delta[stockId] = -amount;
  }
  return delta;
}

export function serviceNeedChannels(offering = {}, offeringId = "") {
  if (Array.isArray(offering.needChannels) && offering.needChannels.length) {
    return [...new Set(offering.needChannels.map((row) => text(row)).filter(Boolean))];
  }
  const kind = offeringServiceKind(offering, offeringId);
  if (kind === "tea") return ["thirst", "stay_legitimacy", "information_cover"];
  if (kind === "meal") return ["hunger", "fatigue", "stay_legitimacy"];
  return ["situational_goal"];
}

export function serviceBodyDemand(offering = {}, offeringId = "") {
  const explicit = offering.bodyDemand && typeof offering.bodyDemand === "object"
    ? clone(offering.bodyDemand)
    : null;
  if (explicit) return explicit;
  const kind = offeringServiceKind(offering, offeringId);
  if (kind === "tea") return { exertion: 4, energyDemand: 1, thirstRelief: 45 };
  if (kind === "meal") return { exertion: 4, energyDemand: 1, hungerRelief: 45, recovery: 8 };
  return { exertion: 2, energyDemand: 1 };
}

export const MATERIAL_ECONOMY_PREFERENCE_KEYS = PREFERENCE_KEYS;
