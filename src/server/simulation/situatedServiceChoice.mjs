const FORBIDDEN_ANSWER_KEYS = new Set([
  "characterFit",
  "chosen",
  "chosenOfferId",
  "expectedAction",
  "expectedChoice",
  "preferred",
  "preferredOfferId",
  "rank",
  "recommendation",
  "score",
  "utility",
]);

function clean(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function issue(code, path, message) {
  return { code, path, message };
}

function walkForbiddenKeys(value, path = "input", errors = []) {
  if (!value || typeof value !== "object") return errors;
  if (Array.isArray(value)) {
    value.forEach((row, index) => walkForbiddenKeys(row, `${path}[${index}]`, errors));
    return errors;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_ANSWER_KEYS.has(key)) {
      errors.push(issue(
        "SERVICE_CHOICE_AUTHOR_ANSWER_LEAK",
        `${path}.${key}`,
        `服务选项只能描述客观条件，不能包含 ${key}`,
      ));
    }
    walkForbiddenKeys(child, `${path}.${key}`, errors);
  }
  return errors;
}

function validNeed(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validRange(value) {
  return Array.isArray(value)
    && value.length === 2
    && value.every((part) => Number.isFinite(Number(part)) && Number(part) >= 0 && Number(part) <= 1)
    && Number(value[0]) <= Number(value[1]);
}

export function auditSituatedServiceChoiceInput(input = {}) {
  const errors = walkForbiddenKeys(input);
  const actorId = clean(input.actorId);
  if (!actorId) errors.push(issue("SERVICE_ACTOR_MISSING", "input.actorId", "服务选择需要人物 id"));

  const operatorIds = [...new Set((input.operatorActorIds || []).map(clean).filter(Boolean))];
  if (operatorIds.length === 0) {
    errors.push(issue("SERVICE_OPERATOR_MISSING", "input.operatorActorIds", "服务选择需要至少一名当前可感知的服务经手人"));
  }

  const offers = Array.isArray(input.offers) ? input.offers : [];
  if (offers.length === 0) errors.push(issue("SERVICE_OFFERS_MISSING", "input.offers", "场所必须提供至少一项当前可感知服务"));
  const offerIds = new Set();
  for (const [index, offer] of offers.entries()) {
    const path = `input.offers[${index}]`;
    const offerId = clean(offer?.id);
    if (!offerId || offerIds.has(offerId)) {
      errors.push(issue("SERVICE_OFFER_ID_INVALID", `${path}.id`, "服务必须有唯一稳定 id"));
    }
    offerIds.add(offerId);
    if (!clean(offer?.label) || typeof offer?.available !== "boolean") {
      errors.push(issue("SERVICE_OFFER_CONTRACT_INVALID", path, "服务必须说明名称和当前可用性"));
    }
    if (!Number.isFinite(offer?.price?.amount) || offer.price.amount < 0 || !clean(offer?.price?.currencyId)) {
      errors.push(issue("SERVICE_PRICE_INVALID", `${path}.price`, "服务价格必须是非负金额和明确货币"));
    }
    if (typeof offer?.price?.knownToActor !== "boolean") {
      errors.push(issue("SERVICE_PRICE_KNOWLEDGE_MISSING", `${path}.price.knownToActor`, "必须区分客观价格与人物是否已经知道价格"));
    }
    if (offer?.category != null && !clean(offer.category)) {
      errors.push(issue("SERVICE_CATEGORY_INVALID", `${path}.category`, "商品类别必须是稳定的非空标识"));
    }
    if (offer?.observableQualities != null && !Array.isArray(offer.observableQualities)) {
      errors.push(issue("SERVICE_QUALITIES_INVALID", `${path}.observableQualities`, "商品品质线索必须是人物可感知的事实列表"));
    }
    if (offer?.sustenance != null && (!clean(offer.sustenance.class)
      || !["mundaneNutrition", "spiritualNutrition", "hydration", "sensoryValue"]
        .every((key) => validNeed(Number(offer.sustenance[key]))))) {
      errors.push(issue("SERVICE_SUSTENANCE_INVALID", `${path}.sustenance`, "饮食商品必须声明客观补给类别与 0 到 1 的物质属性"));
    }
  }

  for (const [stateId, value] of Object.entries(input.bodyNeeds || {})) {
    if (!validNeed(value)) errors.push(issue("SERVICE_BODY_NEED_INVALID", `input.bodyNeeds.${stateId}`, "身体需要必须在 0 到 1 之间"));
  }
  for (const [index, tender] of (input.ownedTender || []).entries()) {
    if (!clean(tender?.id) || !clean(tender?.currencyId) || !Number.isFinite(tender?.amount) || tender.amount < 0) {
      errors.push(issue("SERVICE_TENDER_INVALID", `input.ownedTender[${index}]`, "人物钱币必须有 id、货币和非负数量"));
    }
  }

  const economic = input.economicContext;
  if (economic != null) {
    if (clean(economic.authority) !== "character-owned-material-state") {
      errors.push(issue("SERVICE_ECONOMIC_AUTHORITY_INVALID", "input.economicContext.authority", "财富与消费倾向必须来自人物拥有的物质状态"));
    }
    if (!clean(economic.wealthBand) || !clean(economic.materialPosition)) {
      errors.push(issue("SERVICE_ECONOMIC_POSITION_MISSING", "input.economicContext", "人物需要可解释的财富处境，而不只是一个铜钱数字"));
    }
    if (!clean(economic.wallet?.currencyId) || !Number.isFinite(Number(economic.wallet?.amount)) || Number(economic.wallet.amount) < 0) {
      errors.push(issue("SERVICE_ECONOMIC_WALLET_INVALID", "input.economicContext.wallet", "人物钱包必须有货币、来源和非负余额"));
    }
    for (const [key, range] of Object.entries(economic.consumptionPreferences || {})) {
      if (!validRange(range)) errors.push(issue("SERVICE_CONSUMPTION_RANGE_INVALID", `input.economicContext.consumptionPreferences.${key}`, "消费倾向必须是 0 到 1 的不确定范围"));
    }
  }

  const sustenance = input.sustenanceContext;
  if (sustenance != null) {
    if (clean(sustenance.authority) !== "character-embodied-capacity" || !clean(sustenance.mode)) {
      errors.push(issue("SERVICE_SUSTENANCE_CONTEXT_INVALID", "input.sustenanceContext", "补给需求必须来自人物自己的身体能力档案"));
    }
    for (const key of [
      "ordinaryFoodDependenceRange",
      "ordinaryFoodRecoveryEfficiencyRange",
      "basalHungerGrowthRange",
      "exertionHungerCouplingRange",
      "spiritualFoodConversionRange",
    ]) {
      if (!validRange(sustenance[key])) {
        errors.push(issue("SERVICE_SUSTENANCE_RANGE_INVALID", `input.sustenanceContext.${key}`, "修行生理参数必须是不确定范围"));
      }
    }
  }

  const norm = input.tableUseNorm || {};
  if (!clean(norm.id)
    || norm.sitWithoutOrderingPhysicallyPossible !== true
    || norm.operatorResponseRequiresOwnAction !== true
    || !clean(norm.pressureOnset)) {
    errors.push(issue(
      "SERVICE_TABLE_NORM_INVALID",
      "input.tableUseNorm",
      "占桌惯例必须保留不消费的物理可能，并要求经营者以自己的行动作出回应",
    ));
  }
  return { valid: errors.length === 0, errors };
}

function totalTender(input, currencyId) {
  return (input.ownedTender || [])
    .filter((row) => clean(row.currencyId) === clean(currencyId))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

export function compileSituatedServiceAffordances(input = {}) {
  const audit = auditSituatedServiceChoiceInput(input);
  if (!audit.valid) {
    const error = new TypeError(audit.errors.map((row) => `${row.code}@${row.path}: ${row.message}`).join("\n"));
    error.code = "INVALID_SITUATED_SERVICE_CHOICE_INPUT";
    error.issues = audit.errors;
    throw error;
  }
  const actorId = clean(input.actorId);
  const targetActorIds = [...new Set((input.operatorActorIds || []).map(clean).filter(Boolean))];
  const affordances = [];
  for (const offer of input.offers.filter((row) => row.available === true)) {
    const offeringId = clean(offer.id);
    const currencyId = clean(offer.price.currencyId);
    const availableAmount = totalTender(input, currencyId);
    affordances.push({
      id: `affordance:service-request:${actorId}:${offeringId}`,
      type: "request_service",
      actorId,
      targetActorIds,
      offeringId,
      offering: clone(offer),
      paymentCapacity: {
        currencyId,
        knownOwnedAmount: availableAmount,
        coversListedPrice: availableAmount >= Number(offer.price.amount || 0),
      },
      preconditions: [
        "人物选择向可感知的经营者提出服务请求",
        "该服务当前可询问或可请求",
      ],
      effects: [
        "只建立一项待经营者回应的服务请求",
        "不会自动交付茶饭、扣款、结账、形成关系变化或完成信息目的",
        "经营者必须感知请求并由自己的 Character Agent 决定接受、追问、拒绝或延后",
      ],
    });
    if (offer.price.knownToActor !== true) {
      affordances.push({
        id: `affordance:service-terms:${actorId}:${offeringId}`,
        type: "ask_service_terms",
        actorId,
        targetActorIds,
        offeringId,
        preconditions: ["人物选择先询问服务内容或价格", "经营者处在有效声路内"],
        effects: [
          "只产生一项待经营者回答的询价或询问",
          "不会自动建立订单、交付物品或扣款",
        ],
      });
    }
  }
  return affordances;
}

export function buildSituatedServiceChoiceTool() {
  return Object.freeze({
    role: "character-private-service-appraisal-not-world-selection",
    choiceAuthority: "character-agent",
    qualitativeFormula: "U_i(service,t)=effectivePhysiologicalNeed+goalUse+qualityFit+sensoryValue+stayLegitimacy+informationCover+comfort-priceBurden-statusMismatch-wasteRisk-interactionExposure-serviceDelay-switchingCost",
    characterWeightSources: [
      "foundation.stablePsychology",
      "foundation.desires",
      "foundation.inhibitors",
      "foundation.physiology.sustenance",
      "dynamicState",
      "ownedTender",
      "characterOwnedEconomicContext",
      "perceivedServiceOffers",
      "perceivedSocialNorms",
    ],
    rules: [
      "场所提供服务、价格、库存、经手人和社会惯例，不能标记人物应点什么",
      "凡食只能按人物自己的凡食依赖度和转化效率产生生理价值；高阶修士仍可因口味、礼节、社交、信息掩护或习惯消费",
      "取得凡俗钱财很容易不等于钱已在袖中；取得成本影响价格压力，随身余额仍单独约束当场付款",
      "饥饿、口渴、钱包余额、财富来源、义务、品质偏好、价格敏感、预计停留和当前目的共同改变服务价值，但不替人物选择",
      "最贵只是一项客观价格事实；有钱不等于必买最贵，节俭也不等于永远买最低价",
      "占桌不消费在物理上仍可发生；社会压力与经营者回应必须在真实感知和后续行动后产生",
      "提出点单只打开请求，不等于经营者接受、茶饭交付、付款完成或人物目的满足",
    ],
  });
}
