import {
  getCharacterPsychologyAnchor,
  validateCharacterPsychologyAnchor,
} from "./characterPsychologyAnchor.mjs";
import { findValidatedCharacterAnchorRuntime } from "./validatedCharacterAnchorRuntime.mjs";
import { resolveTavernZoneId, tavernZoneLabel } from "./tavernZoneVocabulary.mjs";
import {
  auditCultivationSustenanceProfile,
  normalizeCultivationSustenanceProfile,
} from "../simulation/cultivationSustenance.mjs";

export const TAVERN_ECOLOGY_PROFILE_VERSION = 1;

export const TAVERN_ECOLOGY_CHARACTER_IDS = Object.freeze([
  "char_xyy_xiezenshi",
  "char_xyy_xieheng",
  "char_xyy_xiemu",
  "char_xyy_zhoumin",
  "char_xyy_luozhao",
  "char_xyy_yanzhizhong",
  "char_xyy_chenyan",
]);

const TAVERN_LOCATION_ID = "loc_xyy_tavern";
export const TAVERN_SCENE_ID = "scene_xyy_wangti_tavern";
const NEGATIVE_OR_DEONTIC_START = /^(?:不|别|勿|未|无|避免|拒绝|不能|不要|不得|应当|应该|必须)/u;
const DEONTIC_LANGUAGE = /(?:应当|应该|必须|不得|不许|不能因为|务必)/u;
const VAGUE_ONLY_OUTCOMES = new Set(["处理事情", "把事情处理好", "情况变好", "有所进展", "心里有数", "完成目标"]);
const CATEGORY_NAMES = ["desires", "duties", "principles", "boundaries", "sensitivities"];

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function issue(code, path, message) {
  return { code, path, message };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isUnitInterval(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export const TAVERN_RECOMMENDATION_REQUEST_FRAME = deepFreeze({
  id: "frame:xyy:zhou-inner-sect-recommendation",
  kind: "social_request",
  predicate: "request_recommendation",
  topicId: "recommendation",
  roles: {
    requester: "char_xyy_zhoumin",
    requestedActor: "char_xyy_xiezenshi",
    beneficiary: "char_xyy_zhoumin",
    ultimateRecipient: "char_xyy_yanzhizhong",
  },
  object: { id: "inner_sect_assessment", label: "内门考核举荐" },
  requestedAct: "谢真石向掌籍长老严执中举荐周珉参加内门考核",
  lexicalAnchors: ["举荐", "内门"],
  importance: 0.9,
});

function desire({ id, semanticId = "", semanticFrame = null, ownerCharacterId, verb, object, outcome, target, baseStrength, growthPerHour, condition }) {
  return {
    kind: "desire",
    id,
    ...(semanticId ? { semanticId } : {}),
    ...(semanticFrame ? { semanticFrame: deepFreeze(structuredClone(semanticFrame)) } : {}),
    ownerCharacterId,
    polarity: "positive",
    desiredState: {
      subjectCharacterId: ownerCharacterId,
      verb,
      object,
      observableOutcome: outcome,
    },
    target,
    baseStrength,
    growthPerHour,
    satisfactionCondition: {
      beneficiaryCharacterId: ownerCharacterId,
      ...condition,
    },
  };
}

function duty(id, responsibility, scope, completionCondition) {
  // Zones are canonical topology ids; labels ride along only for display.
  const zones = (scope?.zones || []).map(resolveTavernZoneId);
  const normalizedScope = scope ? {
    ...scope,
    zones,
    zoneLabels: zones.map(tavernZoneLabel),
  } : scope;
  return { kind: "duty", id, responsibility, scope: normalizedScope, completionCondition };
}

function principle(id, statement, decisionRule) {
  return { kind: "principle", id, statement, decisionRule };
}

function boundary(id, protectedInterest, trigger, responseBias) {
  return { kind: "boundary", id, protectedInterest, trigger, responseBias };
}

function sensitivity(id, cue, threatMeaning, activationGain, recoveryHalfLifeSeconds) {
  return { kind: "sensitivity", id, cue, threatMeaning, activationGain, recoveryHalfLifeSeconds };
}

function profile({
  characterId,
  name,
  standing,
  observationStageId = TAVERN_LOCATION_ID,
  homeLocationId,
  homeZoneId = null,
  personality,
  bodyBaseline,
  affectBaseline,
  desires,
  duties,
  principles,
  boundaries,
  sensitivities,
  physiology = null,
  psychologyAnchor = null,
  sceneId = TAVERN_SCENE_ID,
  requiresValidatedRuntime = false,
}) {
  const validatedRuntime = findValidatedCharacterAnchorRuntime(characterId, { sceneId });
  if (requiresValidatedRuntime && !validatedRuntime) {
    throw new Error(`Validated character runtime missing for ${sceneId}::${characterId}; refusing to revive retired static psychology.`);
  }
  const usesValidatedPsychology = Boolean(validatedRuntime);
  const resolvedPsychologyAnchor = psychologyAnchor
    || validatedRuntime?.psychologyAnchor
    || getCharacterPsychologyAnchor(characterId, { sceneId });
  return {
    schemaVersion: TAVERN_ECOLOGY_PROFILE_VERSION,
    characterId,
    name,
    standing,
    sceneId,
    observationStageId,
    initialConditions: {
      locationId: homeLocationId,
      zoneId: homeZoneId == null ? homeZoneId : resolveTavernZoneId(homeZoneId),
      body: bodyBaseline,
      affect: affectBaseline,
    },
    sustenanceProfile: normalizeCultivationSustenanceProfile(
      validatedRuntime?.characterFoundation?.physiology?.sustenance
        || physiology?.sustenance
        || physiology
        || {},
    ),
    personality: validatedRuntime?.ecologyProjection?.personality || personality,
    desires: validatedRuntime?.ecologyProjection?.desires || desires,
    duties: (duties || []).map((item) => usesValidatedPsychology ? {
      ...item,
      runtimeProjection: { source: "scene-role-contract" },
    } : item),
    principles: usesValidatedPsychology ? [] : principles,
    boundaries: usesValidatedPsychology ? [] : boundaries,
    sensitivities: usesValidatedPsychology ? [] : sensitivities,
    psychologyAnchor: resolvedPsychologyAnchor,
    dynamicPsychologyState: structuredClone(validatedRuntime?.ecologyProjection?.dynamicPsychologyState || {}),
    personalityRuntimeProjection: validatedRuntime
      ? structuredClone(validatedRuntime.ecologyProjection.personalityRuntimeProjection)
      : null,
    runtimeAuthority: validatedRuntime ? {
      psychology: "validated-character-foundation",
      personality: "engine-operational-default-from-foundation-gap",
      desires: "validated-character-foundation",
      duties: "scene-role-contract",
      bodyAndAffect: "world-operational-baseline-plus-character-physiology",
      legacyPsychologyFieldsUsed: [],
    } : null,
    validatedAnchorRuntime: validatedRuntime ? {
      schemaVersion: validatedRuntime.schemaVersion,
      status: validatedRuntime.status,
      sceneId: validatedRuntime.sceneId,
      characterId: validatedRuntime.characterId,
      source: validatedRuntime.source,
      numericPolicy: validatedRuntime.ecologyProjection.numericPolicy,
      presenceProjection: validatedRuntime.presenceProjection,
    } : null,
  };
}

function compactText(value = "", fallback = "") {
  const result = String(value ?? "").replace(/\s+/g, " ").trim();
  return result || fallback;
}

function normalizedUnit(value, fallback = 0.5) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, Math.abs(numeric) > 1 ? numeric / 100 : numeric));
}

function genericVisibleActions(character = {}) {
  const source = Array.isArray(character.visibleActionOptions)
    ? character.visibleActionOptions
    : compactText(character.visible || character.visibleActions || character.lifeProfile?.activities?.personal)
      .split(/[、，,。；;]/u);
  return source.map((item) => compactText(item)).filter(Boolean).slice(0, 4);
}

/**
 * Compile the shared ecology schema from ordinary character data. Authored
 * profiles remain richer adapters, but they are no longer an admission list:
 * any character with an id and a concrete want can enter the same simulation.
 */
export function compileEcologyProfile(character = {}, {
  observationStageId = TAVERN_LOCATION_ID,
  defaultZoneId = null,
} = {}) {
  if (!character?.id) return null;
  const embedded = character.ecologyProfile;
  if (isPlainObject(embedded) && validateEcologyProfile(embedded).valid) return embedded;
  const characterId = compactText(character.id);
  const name = compactText(character.name, characterId);
  const lifeProfile = character.lifeProfile || {};
  const agency = lifeProfile.agency || character.agency || character.sceneAgency || lifeProfile.tavernAgency || {};
  const want = compactText(
    character.desire
      || lifeProfile.privatePursuit
      || character.lifeState?.activeGoal
      || character.goal,
    `亲手推进${name}眼前最在意的目标`,
  );
  const visibleActions = genericVisibleActions(character);
  const actionOptions = (visibleActions.length ? visibleActions : ["检查眼前条件并完成一个可见步骤"])
    .map((actionLabel, index) => ({
      id: `goal-step-${index + 1}`,
      label: actionLabel,
      actionKind: "pursue_desired_state",
      mode: "act",
      visibleActionHint: `${name}${actionLabel}`,
      expectedSatisfaction: Math.max(36, 68 - index * 8),
      opportunity: Math.max(42, 72 - index * 7),
      bodyDemand: { exertion: 8 + index * 4, energyDemand: 4 + index * 2 },
      satisfactionEvidence: {
        tags: [`goal:${characterId}:primary`],
        beneficiaryActorIds: [characterId],
        subjectActorIds: [characterId],
      },
    }));
  const personalitySource = character.personality || character.traits || character.agentProfile?.traits || {};
  const personality = Object.fromEntries([
    ["autonomy", 0.55], ["introversion", 0.5], ["persistence", 0.55], ["conscientiousness", 0.55],
    ["competitiveness", 0.35], ["care", 0.5], ["caution", 0.5], ["impulsivity", 0.25],
  ].map(([trait, fallback]) => [trait, normalizedUnit(personalitySource[trait], fallback)]));
  const bodySource = character.bodyState || character.lifeState?.body || {};
  const affectSource = character.affectState || character.lifeState?.affect || {};
  const initialLocationId = compactText(
    character.currentLocationId || character.lifeState?.currentLocationId || observationStageId,
    observationStageId,
  );
  return profile({
    characterId,
    name,
    standing: compactText(agency.standing || character.standing, "resident"),
    observationStageId,
    homeLocationId: initialLocationId,
    homeZoneId: compactText(character.lifeState?.zoneId || defaultZoneId) || null,
    personality,
    bodyBaseline: {
      energy: normalizedUnit(bodySource.energy, 0.65),
      hunger: normalizedUnit(bodySource.hunger, 0.2),
      thirst: normalizedUnit(bodySource.thirst, 0.2),
      pain: normalizedUnit(bodySource.pain, 0.05),
      exertion: normalizedUnit(bodySource.exertion, 0.1),
    },
    physiology: lifeProfile.physiology || character.physiology || null,
    affectBaseline: {
      valence: Math.max(-1, Math.min(1, Number(affectSource.valence || 0))),
      arousal: normalizedUnit(affectSource.arousal, 0.3),
      dominance: normalizedUnit(affectSource.dominance, 0.5),
    },
    desires: [desire({
      id: `desire_${characterId}_primary`,
      ownerCharacterId: characterId,
      verb: "亲手推进",
      object: want,
      outcome: `${name}完成一个与“${want}”直接相关、可被现场观察的行动步骤`,
      target: { type: "self_goal", id: `goal:${characterId}:primary`, label: want },
      baseStrength: normalizedUnit(character.desireStrength, 0.62),
      growthPerHour: Math.max(0, Number(character.desireGrowthPerHour || 0.02)),
      condition: {
        type: "verified_action_evidence",
        criteria: { actorCharacterId: characterId, requiredEvidenceTags: [`goal:${characterId}:primary`] },
      },
    })].map((item) => ({ ...item, actionOptions })),
    duties: [],
    principles: [],
    boundaries: [],
    sensitivities: [],
    psychologyAnchor: character.psychologyAnchor || null,
  });
}

const profiles = {
  char_xyy_xiezenshi: profile({
    characterId: "char_xyy_xiezenshi",
    name: "谢真石",
    standing: "household_worker",
    homeLocationId: TAVERN_LOCATION_ID,
    homeZoneId: "courtyard",
    personality: { autonomy: 0.9, introversion: 0.78, persistence: 0.68, conscientiousness: 0.62, competitiveness: 0.66, care: 0.48, caution: 0.52, impulsivity: 0.25 },
    bodyBaseline: { energy: 0.58, hunger: 0.24, thirst: 0.22, pain: 0.08, exertion: 0.18 },
    affectBaseline: { valence: 0.02, arousal: 0.26, dominance: 0.48 },
    // Validated characters fail closed here: their live desires are compiled
    // from the generated author-anchor registry inside profile().
    desires: [],
    duties: [
      duty("duty_xiezenshi_opening_fuel_water", "开门前补足当餐所需的柴和水", { locationId: TAVERN_LOCATION_ID, zones: ["courtyard", "stove"] }, { type: "stock_threshold", criteria: { firewoodBundlesAtLeast: 2, waterJarFillAtLeast: 0.9 } }),
      duty("duty_xiezenshi_keep_passage_clear", "练剑和搬运时保持客人过道可通行", { locationId: TAVERN_LOCATION_ID, zones: ["hall", "courtyard"] }, { type: "zone_state", criteria: { passageBlocked: false } }),
    ],
    principles: [principle("principle_xiezenshi_own_path", "自己的修行方向要由亲身尝试决定", "遇到别人替他宣布归宿时提高自主行动的价值")],
    boundaries: [
      boundary("boundary_xiezenshi_public_exhaustion", "在人前保有身体体面", "旁人公开谈论或展示他的力竭", "退到较私密处、缩短回应或明确制止"),
      boundary("boundary_xiezenshi_substitute_decision", "保有对举荐和修行的决定权", "父母或长辈替他向当事人作出决定", "取回话题并由自己给答复"),
    ],
    sensitivities: [
      sensitivity("sensitivity_xiezenshi_public_pressure", ["public_scrutiny", "genius_title", "forced_answer"], "自己的选择再次被众人变成必须完成的表演", 0.34, 900),
      sensitivity("sensitivity_xiezenshi_fatigue_exposure", ["heavy_exertion", "visible_breathlessness", "crowd_attention"], "体力不足会被当成他不配继续的证据", 0.42, 1200),
    ],
  }),

  char_xyy_xieheng: profile({
    characterId: "char_xyy_xieheng",
    name: "谢恒",
    standing: "proprietor",
    homeLocationId: TAVERN_LOCATION_ID,
    homeZoneId: "counter",
    personality: { autonomy: 0.78, introversion: 0.74, persistence: 0.77, conscientiousness: 0.88, competitiveness: 0.42, care: 0.66, caution: 0.72, impulsivity: 0.12 },
    bodyBaseline: { energy: 0.64, hunger: 0.2, thirst: 0.25, pain: 0.13, exertion: 0.12 },
    affectBaseline: { valence: -0.05, arousal: 0.32, dominance: 0.59 },
    desires: [
      desire({
        id: "desire_xieheng_secure_medicine_fund",
        ownerCharacterId: "char_xyy_xieheng",
        verb: "筹齐并保留",
        object: "下一轮药钱和酒馆两日进货周转金",
        outcome: "谢恒可支配的药钱达到十二文，同时公账仍留有八文周转金",
        target: { type: "resource", id: "xie_household_funds", label: "谢家药钱与酒馆周转金" },
        baseStrength: 0.82,
        growthPerHour: 0.028,
        condition: { type: "ledger_threshold", criteria: { controllerCharacterId: "char_xyy_xieheng", medicineFundAtLeast: 12, operatingReserveAtLeast: 8 } },
      }),
      desire({
        id: "desire_xieheng_hear_sons_choice",
        ownerCharacterId: "char_xyy_xieheng",
        verb: "听到并理解",
        object: "儿子对是否继续修炼的本人决定",
        outcome: "谢真石在谢恒在场时亲口说明继续或停下以及一个自己的理由",
        target: { type: "character", id: "char_xyy_xiezenshi", label: "谢真石" },
        baseStrength: 0.46,
        growthPerHour: 0.012,
        condition: { type: "received_explanation", criteria: { receiverCharacterId: "char_xyy_xieheng", speakerCharacterId: "char_xyy_xiezenshi", topicId: "continue_cultivation", requiresReason: true } },
      }),
    ],
    duties: [
      duty("duty_xieheng_receive_delivery", "核对送货数量、来路和货款后再入库", { locationId: TAVERN_LOCATION_ID, zones: ["counter", "hall"] }, { type: "delivery_reconciled", criteria: { quantityChecked: true, sourceChecked: true, paymentRecorded: true } }),
      duty("duty_xieheng_record_shortage", "把当天发现的进货短缺记入酒馆账板", { locationId: TAVERN_LOCATION_ID, zones: ["counter"] }, { type: "ledger_entry", criteria: { entryKind: "delivery_shortage", recordedSameBusinessDay: true } }),
    ],
    principles: [principle("principle_xieheng_public_private_separation", "酒馆公账与家中药钱要分别核算", "任何挪用候选都增加账目风险成本")],
    boundaries: [
      boundary("boundary_xieheng_pawn_ticket_privacy", "保留功法当票的私人决定权", "外客在场时追问钱的来源", "把家事推迟到无外客的地点再谈"),
      boundary("boundary_xieheng_no_sacrifice_debt", "不让儿子把父亲付出理解为必须偿还的债", "有人要求他用牺牲逼儿子继续", "拒绝以当票交换儿子的服从"),
    ],
    sensitivities: [
      sensitivity("sensitivity_xieheng_public_money_question", ["public_question_about_money", "pawn_ticket_reference"], "钱的来路会使自己的失去变成公开债务", 0.48, 1500),
      sensitivity("sensitivity_xieheng_backlog", ["unrecorded_shortage", "unpaid_delivery", "low_operating_reserve"], "积压会让酒馆和药钱同时失控", 0.31, 720),
    ],
  }),

  char_xyy_xiemu: profile({
    characterId: "char_xyy_xiemu",
    name: "谢母",
    standing: "manager",
    homeLocationId: TAVERN_LOCATION_ID,
    homeZoneId: "stove",
    personality: { autonomy: 0.66, introversion: 0.42, persistence: 0.74, conscientiousness: 0.94, competitiveness: 0.18, care: 0.91, caution: 0.63, impulsivity: 0.2 },
    bodyBaseline: { energy: 0.61, hunger: 0.21, thirst: 0.28, pain: 0.07, exertion: 0.22 },
    affectBaseline: { valence: 0, arousal: 0.38, dominance: 0.62 },
    desires: [
      desire({
        id: "desire_xiemu_close_household_accounts",
        ownerCharacterId: "char_xyy_xiemu",
        verb: "弄清并记实",
        object: "下一轮药钱的来源和对应家账",
        outcome: "谢母听到谢恒说明每笔药钱来源，并把金额和来源写入家账",
        target: { type: "information", id: "medicine_fund_provenance", label: "药钱来源" },
        baseStrength: 0.79,
        growthPerHour: 0.026,
        condition: { type: "verified_private_ledger", criteria: { ownerCharacterId: "char_xyy_xiemu", sourceSpeakerCharacterId: "char_xyy_xieheng", topicId: "medicine_fund_provenance", amountRecorded: true, sourceRecorded: true } },
      }),
      desire({
        id: "desire_xiemu_complete_family_conversation",
        ownerCharacterId: "char_xyy_xiemu",
        verb: "完成",
        object: "一次不受外客打断的家庭谈话",
        outcome: "谢母、谢恒和谢真石在无外客可听见的地方各自说完一轮且没有以杂务中断",
        target: { type: "interaction", id: "xie_family_private_conversation", label: "谢家私下谈话" },
        baseStrength: 0.55,
        growthPerHour: 0.014,
        condition: { type: "conversation_completed", criteria: { participantCharacterIds: ["char_xyy_xiemu", "char_xyy_xieheng", "char_xyy_xiezenshi"], privacyRequired: true, minimumTurnsPerParticipant: 1 } },
      }),
    ],
    duties: [
      duty("duty_xiemu_host_guests", "问清来意、安排服务、交付饭茶客房并结清交换", { locationId: TAVERN_LOCATION_ID, zones: ["hall", "counter", "stove", "guest_room"] }, { type: "hospitality_transaction", criteria: { requestKnown: true, serviceDelivered: true, settlementRecorded: true } }),
      duty("duty_xiemu_manage_stock", "按实际出餐和收货更新灶房存量", { locationId: TAVERN_LOCATION_ID, zones: ["stove", "counter"] }, { type: "stock_ledger_reconciled", criteria: { physicalAndLedgerMatch: true } }),
    ],
    principles: [principle("principle_xiemu_no_invented_excuse", "家账只记录本人确认过的来路", "缺少来源证据时保持未核实而不替家人编理由")],
    boundaries: [boundary("boundary_xiemu_family_privacy", "家人能在不受外客围观时谈家计", "外客能听见时有人逼问当票或药钱", "暂停家事并转回接客，等私密条件成立再继续")],
    sensitivities: [
      sensitivity("sensitivity_xiemu_evasive_answer", ["vague_money_answer", "topic_deflection", "repeated_delay"], "自己的照料再次被用沉默当成无需知情", 0.41, 900),
      sensitivity("sensitivity_xiemu_service_overload", ["waiting_guest", "meal_queue", "room_request", "crowded_tavern"], "漏接一项服务会直接损害酒馆生计", 0.36, 480),
    ],
  }),

  char_xyy_zhoumin: profile({
    characterId: "char_xyy_zhoumin",
    name: "周珉",
    standing: "delivery_guest",
    homeLocationId: "loc_xyy_tiyunzong_outer_court",
    requiresValidatedRuntime: true,
    personality: null,
    bodyBaseline: { energy: 0.69, hunger: 0.3, thirst: 0.24, pain: 0.04, exertion: 0.16 },
    affectBaseline: { valence: -0.02, arousal: 0.36, dominance: 0.5 },
    desires: [],
    duties: [duty("duty_zhoumin_complete_delivery", "把给谢母肺上旧疾的药包和清单交给有验收权限的人", { locationId: TAVERN_LOCATION_ID, zones: ["hall", "counter"] }, { type: "delivery_handoff", criteria: { recipientStandingAnyOf: ["proprietor", "manager"], intendedRecipientActorId: "char_xyy_xiemu", treatmentTargetActorId: "char_xyy_xiemu", packageAccepted: true, manifestAccepted: true } })],
    principles: [],
    boundaries: [],
    sensitivities: [],
  }),

  char_xyy_luozhao: profile({
    characterId: "char_xyy_luozhao",
    name: "洛照",
    standing: "visitor",
    homeLocationId: "loc_xyy_yuheng_guest_route",
    requiresValidatedRuntime: true,
    personality: null,
    bodyBaseline: { energy: 0.77, hunger: 0.19, thirst: 0.2, pain: 0.03, exertion: 0.09 },
    affectBaseline: { valence: 0.04, arousal: 0.29, dominance: 0.67 },
    desires: [],
    duties: [],
    principles: [],
    boundaries: [],
    sensitivities: [],
  }),

  char_xyy_yanzhizhong: profile({
    characterId: "char_xyy_yanzhizhong",
    name: "严执中",
    standing: "tea_guest",
    homeLocationId: "loc_xyy_registry_hall",
    personality: { autonomy: 0.64, introversion: 0.52, persistence: 0.76, conscientiousness: 0.95, competitiveness: 0.37, care: 0.48, caution: 0.9, impulsivity: 0.08 },
    bodyBaseline: { energy: 0.7, hunger: 0.18, thirst: 0.22, pain: 0.1, exertion: 0.07 },
    affectBaseline: { valence: 0.01, arousal: 0.21, dominance: 0.72 },
    desires: [
      desire({
        id: "desire_yanzhizhong_verify_candidate",
        ownerCharacterId: "char_xyy_yanzhizhong",
        verb: "亲自核验并选出",
        object: "一名有完整实绩证据的大比候选",
        outcome: "严执中查看候选的名录、剑痕和一次本人行动后签下可复核的候选结论",
        target: { type: "record", id: "grand_tournament_candidate", label: "大比候选记录" },
        baseStrength: 0.76,
        growthPerHour: 0.021,
        condition: { type: "verified_nomination", criteria: { verifierCharacterId: "char_xyy_yanzhizhong", registryChecked: true, physicalEvidenceChecked: true, directObservationChecked: true, signedConclusion: true } },
      }),
    ],
    duties: [duty("duty_yanzhizhong_keep_registry_auditable", "只把有来源和证据的候选信息写入名录", { locationId: "loc_xyy_registry_hall", zones: ["名录案"] }, { type: "registry_audit", criteria: { everyEntryHasProvenance: true, everyEntryHasEvidence: true } })],
    principles: [principle("principle_yanzhizhong_evidence_before_rank", "候选结论要先有可复核证据", "缺少证据时保持未决，不用名声补齐事实")],
    boundaries: [boundary("boundary_yanzhizhong_no_private_slot_trade", "候选名额不受私下交易污染", "有人以钱、人情或公开压力要求提前盖印", "拒绝盖印并记录干预来源")],
    sensitivities: [
      sensitivity("sensitivity_yanzhizhong_hearsay", ["unsourced_rumor", "contradictory_testimony", "missing_record"], "自己的名录可能正在把传闻固定成命运", 0.38, 1020),
      sensitivity("sensitivity_yanzhizhong_procedure_bypass", ["request_to_skip_review", "public_pressure", "premature_promise"], "程序一旦绕开就无法说明这次选择是否公正", 0.44, 1200),
    ],
  }),

  char_xyy_chenyan: profile({
    characterId: "char_xyy_chenyan",
    name: "陈砚",
    standing: "work_exchange_guest",
    homeLocationId: "loc_xyy_tiyunzong_practice_yard",
    personality: { autonomy: 0.7, introversion: 0.64, persistence: 0.96, conscientiousness: 0.86, competitiveness: 0.39, care: 0.52, caution: 0.61, impulsivity: 0.1 },
    bodyBaseline: { energy: 0.52, hunger: 0.56, thirst: 0.3, pain: 0.11, exertion: 0.27 },
    affectBaseline: { valence: -0.08, arousal: 0.31, dominance: 0.39 },
    desires: [
      desire({
        id: "desire_chenyan_earn_today_meal",
        ownerCharacterId: "char_xyy_chenyan",
        verb: "换得并吃到",
        object: "由自己完成约定杂务所得的今日一碗热饭",
        outcome: "陈砚完成店家指定杂务、通过验收并实际收到和吃下一碗热饭",
        target: { type: "resource", id: "tavern_work_exchange_meal", label: "以工换得的热饭" },
        baseStrength: 0.84,
        growthPerHour: 0.055,
        condition: {
          type: "work_exchange_consumed",
          criteria: {
            workerCharacterId: "char_xyy_chenyan",
            agreedWorkCompleted: true,
            workAccepted: true,
            mealDelivered: true,
            mealConsumed: true,
            requiredEvidenceTags: ["service_consumed", "service:work_meal", "payment:work_settled"],
            requireOwnerAsBeneficiary: true,
          },
        },
      }),
      desire({
        id: "desire_chenyan_qualify_for_assessment",
        ownerCharacterId: "char_xyy_chenyan",
        verb: "完成并取得",
        object: "一百次基础剑式和下一次外门考核的有效登记",
        outcome: "陈砚本人完成一百次合格剑式，练功册记录无跳次，并收到有效考核登记",
        target: { type: "qualification", id: "outer_court_assessment", label: "外门考核资格" },
        baseStrength: 0.69,
        growthPerHour: 0.016,
        condition: { type: "practice_and_registration", criteria: { actorCharacterId: "char_xyy_chenyan", validRepetitionsAtLeast: 100, skippedRepetitions: 0, assessmentRegistrationValid: true } },
      }),
    ],
    duties: [duty("duty_chenyan_finish_agreed_work", "先问清并完成店家当面指定的换饭杂务，再归还工具", { locationId: TAVERN_LOCATION_ID, zones: ["hall", "stove", "courtyard"] }, { type: "work_exchange_verified", criteria: { taskAgreed: true, taskCompleted: true, toolsReturned: true, hostVerified: true } })],
    principles: [principle("principle_chenyan_count_own_work", "自己的练习只按本人真实完成的次数记录", "旁人经过、鼓励或比较都不改变有效次数")],
    boundaries: [boundary("boundary_chenyan_no_pity_exchange", "用真实劳动而非怜悯获得资源", "有人未验收杂务就因同情递饭或替他虚报次数", "说明交换尚未完成并要求按原约定验收")],
    sensitivities: [
      sensitivity("sensitivity_chenyan_free_rider_shame", ["accusation_of_free_meal", "unearned_help", "status_comparison"], "别人会把他的需要理解成占便宜或能力不足", 0.43, 960),
      sensitivity("sensitivity_chenyan_body_depletion", ["high_hunger", "high_exertion", "hand_tremor"], "身体耗尽会使今天真实完成的步数归零", 0.4, 600),
    ],
  }),
};

export const TAVERN_ECOLOGY_PROFILES = deepFreeze(profiles);

export function getTavernEcologyProfile(characterOrId, options = {}) {
  const characterId = typeof characterOrId === "object" ? characterOrId?.id : characterOrId;
  const authored = TAVERN_ECOLOGY_PROFILES[characterId] || null;
  if (authored) return authored;
  return typeof characterOrId === "object" ? compileEcologyProfile(characterOrId, options) : null;
}

export function validateEcologyDesire(candidate, profileCharacterId, path = "desire") {
  const errors = [];
  if (!isPlainObject(candidate)) return { valid: false, errors: [issue("DESIRE_NOT_OBJECT", path, "欲望必须是对象")] };
  if (candidate.kind !== "desire") errors.push(issue("DESIRE_KIND_INVALID", `${path}.kind`, "欲望 kind 必须为 desire"));
  if (!hasText(candidate.id)) errors.push(issue("DESIRE_ID_MISSING", `${path}.id`, "欲望必须有稳定 id"));
  if (candidate.polarity !== "positive") errors.push(issue("DESIRE_NOT_POSITIVE", `${path}.polarity`, "欲望必须以正向状态表达"));
  if (!hasText(candidate.ownerCharacterId) || candidate.ownerCharacterId !== profileCharacterId) {
    errors.push(issue("DESIRE_NOT_SELF_OWNED", `${path}.ownerCharacterId`, "欲望所有者必须是该人物本人"));
  }

  const state = candidate.desiredState;
  if (!isPlainObject(state)) {
    errors.push(issue("DESIRED_STATE_MISSING", `${path}.desiredState`, "欲望必须描述目标状态"));
  } else {
    if (state.subjectCharacterId !== profileCharacterId) errors.push(issue("DESIRED_STATE_NOT_SELF_OWNED", `${path}.desiredState.subjectCharacterId`, "目标状态主体必须是人物本人"));
    for (const field of ["verb", "object", "observableOutcome"]) {
      if (!hasText(state[field])) errors.push(issue("DESIRED_STATE_NOT_CONCRETE", `${path}.desiredState.${field}`, `目标状态缺少具体 ${field}`));
    }
    const stateText = [state.verb, state.object, state.observableOutcome].filter(hasText).join(" ").trim();
    if (NEGATIVE_OR_DEONTIC_START.test(String(state.verb || "").trim()) || DEONTIC_LANGUAGE.test(stateText)) {
      errors.push(issue("DESIRE_WRITTEN_AS_RULE", `${path}.desiredState`, "欲望不能写成否定句、禁令或工作标准"));
    }
    if (VAGUE_ONLY_OUTCOMES.has(String(state.observableOutcome || "").trim())) {
      errors.push(issue("DESIRED_STATE_VAGUE", `${path}.desiredState.observableOutcome`, "欲望结果过于抽象，无法由事件判定"));
    }
  }

  if (!isPlainObject(candidate.target) || !hasText(candidate.target.type) || !hasText(candidate.target.id) || !hasText(candidate.target.label)) {
    errors.push(issue("DESIRE_TARGET_NOT_CONCRETE", `${path}.target`, "欲望必须指向有 type、id 和 label 的具体对象"));
  }
  if (!isUnitInterval(candidate.baseStrength)) errors.push(issue("DESIRE_BASE_STRENGTH_INVALID", `${path}.baseStrength`, "baseStrength 必须在 0 到 1 之间"));
  if (!Number.isFinite(candidate.growthPerHour) || candidate.growthPerHour < 0) errors.push(issue("DESIRE_GROWTH_INVALID", `${path}.growthPerHour`, "growthPerHour 必须是非负数"));

  const condition = candidate.satisfactionCondition;
  if (!isPlainObject(condition) || !hasText(condition.type) || !isPlainObject(condition.criteria) || Object.keys(condition.criteria).length === 0) {
    errors.push(issue("SATISFACTION_CONDITION_MISSING", `${path}.satisfactionCondition`, "欲望必须有可机器判定的满足条件"));
  } else if (condition.beneficiaryCharacterId !== profileCharacterId) {
    errors.push(issue("SATISFACTION_NOT_SELF_OWNED", `${path}.satisfactionCondition.beneficiaryCharacterId`, "满足条件的受益者必须是人物本人"));
  }
  return { valid: errors.length === 0, errors };
}

function validateCategoryItems(candidate, category, expectedKind, characterId, errors) {
  if (!Array.isArray(candidate[category])) {
    errors.push(issue("PROFILE_CATEGORY_MISSING", category, `${category} 必须是数组`));
    return;
  }
  for (const [index, item] of candidate[category].entries()) {
    const path = `${category}[${index}]`;
    if (!isPlainObject(item)) {
      errors.push(issue("PROFILE_CATEGORY_ITEM_INVALID", path, `${category} 项必须是对象`));
      continue;
    }
    if (item.kind !== expectedKind) errors.push(issue("PROFILE_CATEGORY_KIND_MISMATCH", `${path}.kind`, `${category} 不能混入 ${item.kind || "未知"} 类型`));
    if (!hasText(item.id)) errors.push(issue("PROFILE_CATEGORY_ID_MISSING", `${path}.id`, `${category} 项必须有稳定 id`));
    if (category === "desires") {
      errors.push(...validateEcologyDesire(item, characterId, path).errors);
    } else if (category === "duties") {
      if (!hasText(item.responsibility) || !isPlainObject(item.scope) || !isPlainObject(item.completionCondition)) {
        errors.push(issue("DUTY_SEMANTICS_MISSING", path, "职责必须有责任内容、作用范围和完成条件"));
      }
    } else if (category === "principles") {
      if (!hasText(item.statement) || !hasText(item.decisionRule)) errors.push(issue("PRINCIPLE_SEMANTICS_MISSING", path, "原则必须有价值陈述和决策规则"));
    } else if (category === "boundaries") {
      if (!hasText(item.protectedInterest) || !hasText(item.trigger) || !hasText(item.responseBias)) errors.push(issue("BOUNDARY_SEMANTICS_MISSING", path, "边界必须说明保护对象、触发条件和反应倾向"));
    } else if (category === "sensitivities") {
      if (!Array.isArray(item.cue) || item.cue.length === 0 || !item.cue.every(hasText) || !hasText(item.threatMeaning) || !isUnitInterval(item.activationGain) || !Number.isFinite(item.recoveryHalfLifeSeconds) || item.recoveryHalfLifeSeconds <= 0) {
        errors.push(issue("SENSITIVITY_SEMANTICS_MISSING", path, "敏感点必须有线索、威胁解释、激活增益和正数恢复半衰期"));
      }
    }
  }
}

export function validateEcologyProfile(candidate) {
  const errors = [];
  if (!isPlainObject(candidate)) return { valid: false, errors: [issue("PROFILE_NOT_OBJECT", "profile", "人物生态档案必须是对象")] };
  if (candidate.schemaVersion !== TAVERN_ECOLOGY_PROFILE_VERSION) errors.push(issue("PROFILE_VERSION_INVALID", "schemaVersion", "人物生态档案版本不匹配"));
  if (!hasText(candidate.characterId)) errors.push(issue("PROFILE_CHARACTER_ID_MISSING", "characterId", "人物档案必须有 characterId"));
  if (!hasText(candidate.name)) errors.push(issue("PROFILE_NAME_MISSING", "name", "人物档案必须有姓名"));
  if (!isPlainObject(candidate.personality)) errors.push(issue("PROFILE_PERSONALITY_MISSING", "personality", "人物档案必须有性格权重"));
  else {
    for (const [trait, value] of Object.entries(candidate.personality)) {
      if (!isUnitInterval(value)) errors.push(issue("PROFILE_TRAIT_INVALID", `personality.${trait}`, "性格权重必须在 0 到 1 之间"));
    }
  }
  if (!isPlainObject(candidate.initialConditions?.body) || !isPlainObject(candidate.initialConditions?.affect)) {
    errors.push(issue("PROFILE_BASELINE_MISSING", "initialConditions", "人物档案必须有身体和情绪基线"));
  } else {
    if (!hasText(candidate.initialConditions.locationId)) errors.push(issue("PROFILE_LOCATION_MISSING", "initialConditions.locationId", "人物档案必须有生活基点"));
    for (const [field, value] of Object.entries(candidate.initialConditions.body)) {
      if (!isUnitInterval(value)) errors.push(issue("PROFILE_BODY_BASELINE_INVALID", `initialConditions.body.${field}`, "身体基线必须在 0 到 1 之间"));
    }
    for (const [field, value] of Object.entries(candidate.initialConditions.affect)) {
      const valid = field === "valence" ? Number.isFinite(value) && value >= -1 && value <= 1 : isUnitInterval(value);
      if (!valid) errors.push(issue("PROFILE_AFFECT_BASELINE_INVALID", `initialConditions.affect.${field}`, "情绪基线超出允许范围"));
    }
  }
  const sustenanceAudit = auditCultivationSustenanceProfile(candidate.sustenanceProfile || {});
  if (!sustenanceAudit.valid) {
    errors.push(...sustenanceAudit.issues.map((entry) => issue(
      `PROFILE_${entry.code}`,
      `sustenanceProfile.${entry.path}`,
      "人物补给生理档案无效",
    )));
  }

  validateCategoryItems(candidate, "desires", "desire", candidate.characterId, errors);
  validateCategoryItems(candidate, "duties", "duty", candidate.characterId, errors);
  validateCategoryItems(candidate, "principles", "principle", candidate.characterId, errors);
  validateCategoryItems(candidate, "boundaries", "boundary", candidate.characterId, errors);
  validateCategoryItems(candidate, "sensitivities", "sensitivity", candidate.characterId, errors);
  if (candidate.psychologyAnchor != null) {
    const anchorResult = validateCharacterPsychologyAnchor(candidate.psychologyAnchor);
    if (!anchorResult.valid) {
      errors.push(...anchorResult.errors.map((entry) => issue(
        `PROFILE_${entry.code}`,
        `psychologyAnchor.${entry.path}`,
        entry.message,
      )));
    } else if (candidate.psychologyAnchor.characterId !== candidate.characterId) {
      errors.push(issue("PROFILE_PSYCHOLOGY_ANCHOR_ID_MISMATCH", "psychologyAnchor.characterId", "心理锚定与人物档案 id 不一致"));
    }
  }

  const seenIds = new Map();
  for (const category of CATEGORY_NAMES) {
    for (const item of candidate[category] || []) {
      if (!hasText(item?.id)) continue;
      if (seenIds.has(item.id)) errors.push(issue("PROFILE_ITEM_ID_DUPLICATE", `${category}.${item.id}`, `id 已在 ${seenIds.get(item.id)} 中使用`));
      else seenIds.set(item.id, category);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateTavernEcologyProfiles(candidate = TAVERN_ECOLOGY_PROFILES) {
  const errors = [];
  if (!isPlainObject(candidate)) return { valid: false, errors: [issue("PROFILE_SET_NOT_OBJECT", "profiles", "人物档案集合必须是对象")] };
  const actualIds = Object.keys(candidate);
  const requiredIds = candidate === TAVERN_ECOLOGY_PROFILES ? TAVERN_ECOLOGY_CHARACTER_IDS : [];
  for (const characterId of requiredIds) {
    if (!candidate[characterId]) {
      errors.push(issue("PROFILE_MISSING_CHARACTER", characterId, `缺少 ${characterId} 的人物档案`));
    }
  }
  for (const characterId of actualIds) {
    if (candidate[characterId]?.characterId !== characterId) errors.push(issue("PROFILE_KEY_ID_MISMATCH", characterId, "档案键与 characterId 不一致"));
    const result = validateEcologyProfile(candidate[characterId]);
    errors.push(...result.errors.map((entry) => ({ ...entry, path: `${characterId}.${entry.path}` })));
  }
  return { valid: errors.length === 0, errors };
}

export function assertValidEcologyProfile(candidate) {
  const result = validateEcologyProfile(candidate);
  if (!result.valid) {
    const error = new TypeError(result.errors.map((entry) => `${entry.code}@${entry.path}: ${entry.message}`).join("\n"));
    error.code = "INVALID_TAVERN_ECOLOGY_PROFILE";
    error.issues = result.errors;
    throw error;
  }
  return candidate;
}
