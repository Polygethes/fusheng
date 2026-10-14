import {
  compileCharacterFoundation,
  compileCharacterVoiceProjection,
  findValidatedCharacterAnchorRuntime,
  listValidatedCharacterAnchorRuntimes,
  validateCharacterFoundation,
} from "./validatedCharacterAnchorRuntime.mjs";

export const CHARACTER_PSYCHOLOGY_ANCHOR_VERSION = 1;

const NEGATIVE_OR_RULE_START = /^(?:不|别|勿|未|无|避免|拒绝|不能|不要|不得|应当|应该|必须)/u;

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isUnitRange(value) {
  return Array.isArray(value)
    && value.length === 2
    && value.every((entry) => Number.isFinite(entry) && entry >= 0 && entry <= 1)
    && value[0] <= value[1];
}

function isSignedRange(value) {
  return Array.isArray(value)
    && value.length === 2
    && value.every((entry) => Number.isFinite(entry) && entry >= -1 && entry <= 1)
    && value[0] <= value[1];
}

function issue(code, path, message) {
  return { code, path, message };
}

function validateRangeMap(candidate, path, errors, { qualitativeUnassigned = false } = {}) {
  if (!isObject(candidate)) {
    errors.push(issue("ANCHOR_RANGE_MAP_MISSING", path, "参数集合必须是对象"));
    return;
  }
  for (const [key, value] of Object.entries(candidate)) {
    const range = isObject(value) ? value.range : value;
    if (qualitativeUnassigned && range == null && hasText(value?.qualitativeLevel)) continue;
    if (!isUnitRange(range)) errors.push(issue("ANCHOR_RANGE_INVALID", `${path}.${key}`, "参数必须保留 0 到 1 的证据范围"));
  }
}

function validateDesire(candidate, characterId, path, errors, { qualitativeUnassigned = false } = {}) {
  if (!isObject(candidate)) {
    errors.push(issue("ANCHOR_DESIRE_INVALID", path, "欲望必须是对象"));
    return;
  }
  if (!hasText(candidate.id)) errors.push(issue("ANCHOR_DESIRE_ID_MISSING", `${path}.id`, "欲望缺少稳定 id"));
  if (candidate.ownerCharacterId !== characterId) errors.push(issue("ANCHOR_DESIRE_NOT_SELF_OWNED", `${path}.ownerCharacterId`, "欲望必须由人物本人拥有"));
  const state = candidate.desiredState;
  if (!isObject(state) || state.subjectCharacterId !== characterId) {
    errors.push(issue("ANCHOR_DESIRED_STATE_NOT_SELF_OWNED", `${path}.desiredState`, "目标状态的主体必须是人物本人"));
  } else {
    for (const field of ["verb", "object", "observableOutcome"]) {
      if (!hasText(state[field])) errors.push(issue("ANCHOR_DESIRED_STATE_INCOMPLETE", `${path}.desiredState.${field}`, "目标状态必须具体可理解"));
    }
    if (NEGATIVE_OR_RULE_START.test(String(state.verb || "").trim())) {
      errors.push(issue("ANCHOR_DESIRE_WRITTEN_AS_RULE", `${path}.desiredState.verb`, "欲望不能写成否定句、规则或职责"));
    }
  }
  if (!isUnitRange(candidate.baselineRange)
    && !(qualitativeUnassigned && candidate.baselineRange == null && hasText(candidate.qualitativeStrength))) {
    errors.push(issue("ANCHOR_DESIRE_RANGE_INVALID", `${path}.baselineRange`, "欲望基线必须保留范围，或明确标注尚未数值校准的定性强度"));
  }
  const unresolved = candidate.unresolvedDynamics;
  if (!isObject(unresolved)) {
    errors.push(issue("ANCHOR_UNRESOLVED_DYNAMICS_MISSING", `${path}.unresolvedDynamics`, "欲望必须说明受阻后的更新方式"));
  } else {
    for (const field of ["retentionRange", "frustrationGainRange", "cueGainRange", "resolutionGainRange"]) {
      const explicitlyUnassigned = qualitativeUnassigned
        && unresolved.numericStatus === "unassigned"
        && unresolved[field] == null;
      if (!isUnitRange(unresolved[field]) && !explicitlyUnassigned) {
        errors.push(issue("ANCHOR_UNRESOLVED_RANGE_INVALID", `${path}.unresolvedDynamics.${field}`, "受阻参数必须是 0 到 1 的范围，或明确标注尚未数值校准"));
      }
    }
  }
}

export function validateCharacterPsychologyAnchor(candidate) {
  if (candidate?.runtimeSurface === "character-foundation") {
    return validateCharacterFoundation(candidate);
  }
  const errors = [];
  if (!isObject(candidate)) return { valid: false, errors: [issue("ANCHOR_NOT_OBJECT", "anchor", "人物心理锚定必须是对象")] };
  const qualitativeUnassigned = candidate.numericCalibrationStatus === "unassigned";
  if (candidate.schemaVersion !== CHARACTER_PSYCHOLOGY_ANCHOR_VERSION) errors.push(issue("ANCHOR_VERSION_INVALID", "schemaVersion", "人物心理锚定版本不匹配"));
  if (!hasText(candidate.characterId)) errors.push(issue("ANCHOR_CHARACTER_ID_MISSING", "characterId", "人物心理锚定缺少 characterId"));
  if (!["draft", "calibrated", "validated"].includes(candidate.status)) errors.push(issue("ANCHOR_STATUS_INVALID", "status", "锚定状态无效"));

  const evidence = candidate.evidence;
  if (!isObject(evidence)) {
    errors.push(issue("ANCHOR_EVIDENCE_MISSING", "evidence", "锚定必须保留证据边界"));
  } else {
    for (const field of ["confirmed", "inferences", "unknowns", "conflicts", "openChoiceAxes"]) {
      if (!Array.isArray(evidence[field])) errors.push(issue("ANCHOR_EVIDENCE_CATEGORY_MISSING", `evidence.${field}`, "证据分类必须是数组"));
    }
  }

  validateRangeMap(candidate.stablePsychology?.dispositions, "stablePsychology.dispositions", errors, { qualitativeUnassigned });
  for (const [key, value] of Object.entries(candidate.epistemics?.sourceReliability || {})) {
    const range = isObject(value) ? value.range : value;
    const qualitativePolicy = isObject(value) ? value.qualitativePolicy : "";
    if (!isUnitRange(range) && !(qualitativeUnassigned && range == null && hasText(qualitativePolicy))) {
      errors.push(issue("ANCHOR_SOURCE_RELIABILITY_INVALID", `epistemics.sourceReliability.${key}`, "信息来源可信度必须是范围，或明确标注尚未数值校准的定性政策"));
    }
  }
  if (!Array.isArray(candidate.epistemics?.knownEntities)) errors.push(issue("ANCHOR_KNOWN_ENTITIES_MISSING", "epistemics.knownEntities", "必须区分姓名知识与身份识别"));

  if (!Array.isArray(candidate.desires) || candidate.desires.length === 0) {
    errors.push(issue("ANCHOR_DESIRES_MISSING", "desires", "人物至少需要一个正向自有欲望"));
  } else {
    candidate.desires.forEach((desire, index) => validateDesire(
      desire,
      candidate.characterId,
      `desires[${index}]`,
      errors,
      { qualitativeUnassigned },
    ));
  }

  if (!Array.isArray(candidate.inhibitors)) errors.push(issue("ANCHOR_INHIBITORS_MISSING", "inhibitors", "阻碍必须独立于欲望"));
  else candidate.inhibitors.forEach((inhibitor, index) => {
    const weightValid = isUnitRange(inhibitor?.weightRange)
      || (qualitativeUnassigned && inhibitor?.weightRange == null);
    if (!hasText(inhibitor?.id) || !hasText(inhibitor?.meaning) || !hasText(inhibitor?.doesNotMean) || !weightValid) {
      errors.push(issue("ANCHOR_INHIBITOR_INVALID", `inhibitors[${index}]`, "阻碍必须有范围、含义和排除解释"));
    }
  });

  if (!Array.isArray(candidate.actionPolicy?.candidateFamilies) || candidate.actionPolicy.candidateFamilies.length === 0) {
    errors.push(issue("ANCHOR_ACTION_POLICY_MISSING", "actionPolicy.candidateFamilies", "必须记录经证据支持的行动候选族"));
  }
  if (!Array.isArray(candidate.speechPolicy?.evidenceAnchors) || candidate.speechPolicy.evidenceAnchors.length < 3) {
    errors.push(issue("ANCHOR_SPEECH_EVIDENCE_INSUFFICIENT", "speechPolicy.evidenceAnchors", "语言至少需要三种功能锚点"));
  } else if (candidate.speechPolicy.evidenceAnchors.some((entry) => !hasText(entry?.function) || !hasText(entry?.line))) {
    errors.push(issue("ANCHOR_SPEECH_EVIDENCE_INVALID", "speechPolicy.evidenceAnchors", "语言锚点必须说明功能和原话"));
  }

  if (!Array.isArray(candidate.relationshipModel?.updateRules)) errors.push(issue("ANCHOR_RELATIONSHIP_RULES_MISSING", "relationshipModel.updateRules", "关系必须按维度更新"));
  else candidate.relationshipModel.updateRules.forEach((rule, index) => {
    for (const [dimension, range] of Object.entries(rule?.deltas || {})) {
      const qualitativeDelta = qualitativeUnassigned && hasText(range);
      if (!isSignedRange(range) && !qualitativeDelta) {
        errors.push(issue("ANCHOR_RELATIONSHIP_DELTA_INVALID", `relationshipModel.updateRules[${index}].deltas.${dimension}`, "关系变化必须保留 -1 到 1 的有符号范围，或明确标注尚未数值校准的方向"));
      }
    }
  });

  if (candidate.status === "validated") {
    const holdouts = candidate.validation?.holdouts;
    if (!Array.isArray(holdouts) || holdouts.length < 3 || holdouts.some((entry) => entry?.accepted !== true)) {
      errors.push(issue("ANCHOR_HOLDOUTS_NOT_PASSED", "validation.holdouts", "validated 锚定必须通过至少三个未见情境"));
    }
  }
  return { valid: errors.length === 0, errors };
}

const authoringRecords = {
  char_xyy_luozhao: {
    schemaVersion: CHARACTER_PSYCHOLOGY_ANCHOR_VERSION,
    characterId: "char_xyy_luozhao",
    status: "validated",
    evidence: {
      confirmed: [
        { id: "luo-pursues-dao", claim: "一心求道，最在意自己是否触及极限", provenance: "user-confirmed", confidence: 1 },
        { id: "luo-fears-own-weakness", claim: "不能容忍的是自己弱小，而不是别人看见她示弱", provenance: "user-confirmed", confidence: 1 },
        { id: "luo-retains-sect-path-conflict", claim: "保留宗门安排之路是否属于自己的深层冲突", provenance: "user-confirmed", confidence: 1 },
        { id: "luo-direct-evidence", claim: "二手剑术评价不能形成她对实力的结论；能力判断只相信自己的观察与交手验证", provenance: "user-confirmed", confidence: 1 },
        { id: "luo-observes-before-identifying", claim: "只知谢真石传闻和姓名时不能凭空视觉认出本人；无人自报且缺少情境关联时会先观察", provenance: "user-confirmed", confidence: 1 },
        { id: "luo-public-trouble", claim: "不在公共酒馆挑战是为了避免无关麻烦，不是害怕评价", provenance: "user-confirmed", confidence: 1 },
        { id: "luo-controlled-probing", claim: "会控制力度；场所合适时即使受拒也会继续试探", provenance: "user-confirmed", confidence: 1 },
        { id: "luo-nonverbal-pressure", claim: "先以剑意、态度和眼神表明来意，被故意忽视后开口", provenance: "user-confirmed", confidence: 1 },
        { id: "luo-domain-excitement", claim: "亲见高妙剑招会兴奋", provenance: "user-confirmed", confidence: 1 },
        { id: "luo-waits-for-recovery", claim: "确认谢真石真正受伤时等待他恢复", provenance: "user-confirmed", confidence: 1 },
        { id: "luo-suppresses-and-returns", claim: "能压住突破诱惑离开，但受挫后可能再次回来", provenance: "user-confirmed", confidence: 1 },
      ],
      inferences: [
        { id: "luo-valid-test-inference", claim: "她要的是能验证自身极限的有效交手，不是对受伤者取胜", evidenceIds: ["luo-pursues-dao", "luo-waits-for-recovery"], confidence: 0.97 },
        { id: "luo-cold-not-flat", claim: "社交冷淡不等于情绪低平；求道领域具有高情绪增益", evidenceIds: ["luo-domain-excitement"], confidence: 0.96 },
      ],
      unknowns: [
        { id: "luo-general-emotion-control", question: "武力控制是否能推广到所有情绪领域", consequence: "不能据此给出全局情绪控制高值" },
        { id: "luo-care-development", question: "等待何时可能从有效测试转化为真正关心", consequence: "初始 care、trust、affection 不因等待自动增加" },
      ],
      conflicts: [{
        id: "luo-core-threat-hierarchy",
        poles: ["不能容忍自己弱小", "宗门安排的道路是否属于自己"],
        hierarchy: {
          primary: "cannot-tolerate-own-weakness",
          secondary: "sect-arranged-path-may-not-be-her-own",
        },
        status: "ranked-not-erased",
      }],
      openChoiceAxes: [{
        id: "luo-breakthrough-versus-assigned-path",
        valuesInConflict: ["亲自验证和突破", "服从宗门替她安排的稳妥道路"],
        contexts: ["高价值突破资源出现", "宗门明确禁止接触", "此前修炼连续受挫"],
        resolution: "story-open",
      }],
    },
    stablePsychology: {
      corePursuits: [{ id: "pursuit_luo_mastery", desiredSelfState: "亲自触及并验证自己的修行极限", weightRange: [0.9, 0.98], evidenceIds: ["luo-pursues-dao"] }],
      selfThreats: [{ id: "threat_luo_own_weakness", fearedSelfState: "发现自己弱小却没有继续逼近极限", activationRange: [0.86, 0.98], evidenceIds: ["luo-fears-own-weakness"] }],
      dispositions: {
        masteryDrive: { range: [0.9, 0.98], confidence: 0.98, evidenceIds: ["luo-pursues-dao"], scope: "cultivation" },
        directEvidencePreference: { range: [0.92, 0.99], confidence: 0.99, evidenceIds: ["luo-direct-evidence", "luo-observes-before-identifying"], scope: "martial-ability-and-unidentified-visual-recognition" },
        socialApprovalNeed: { range: [0.03, 0.15], confidence: 0.95, evidenceIds: ["luo-fears-own-weakness", "luo-public-trouble"], scope: "ordinary-public-evaluation" },
        inhibitoryControl: { range: [0.8, 0.92], confidence: 0.91, evidenceIds: ["luo-suppresses-and-returns"], scope: "immediate-action" },
        controlledForce: { range: [0.82, 0.95], confidence: 0.94, evidenceIds: ["luo-controlled-probing"], scope: "martial-probing" },
        unresolvedDesireRetention: { range: [0.86, 0.96], confidence: 0.94, evidenceIds: ["luo-suppresses-and-returns"], scope: "high-value-unverified-opportunity" },
        frustrationReactivation: { range: [0.68, 0.86], confidence: 0.87, evidenceIds: ["luo-suppresses-and-returns"], scope: "cultivation-setback" },
        domainExcitementGain: { range: [0.82, 0.96], confidence: 0.94, evidenceIds: ["luo-domain-excitement"], scope: "novel-sword-evidence" },
        irrelevantComplicationCost: { range: [0.62, 0.82], confidence: 0.92, evidenceIds: ["luo-public-trouble"], scope: "low-goal-value-complication" },
      },
    },
    dynamicPsychology: {
      stateVariables: [
        { id: "desireIntensity", baselineRange: [0.78, 0.9], decayRange: [0.04, 0.14], bounds: [0, 1] },
        { id: "frustration", baselineRange: [0.05, 0.2], decayRange: [0.08, 0.24], bounds: [0, 1] },
        { id: "domainExcitement", baselineRange: [0.04, 0.16], decayRange: [0.18, 0.42], bounds: [0, 1] },
      ],
      updateRules: [{
        id: "luo-unresolved-desire-recurrence",
        expression: "D_next = clamp(retention * D_now + frustrationGain * frustration + cueGain * newCue - resolutionGain * verifiedResolution)",
        parameters: {
          retention: [0.86, 0.96],
          frustrationGain: [0.68, 0.86],
          cueGain: [0.62, 0.82],
          resolutionGain: [0.86, 0.98],
        },
        evidenceIds: ["luo-suppresses-and-returns"],
      }],
    },
    epistemics: {
      sourceReliability: {
        direct: [0.96, 1],
        witnessed: [0.82, 0.95],
        trustedReport: [0.25, 0.45],
        hearsay: [0.02, 0.12],
        rumor: [0, 0.08],
      },
      knownEntities: [{
        entityId: "char_xyy_xiezenshi",
        knowsName: true,
        recognizesIdentity: false,
        basis: "hearsay",
      }],
      beliefUpdatePolicy: {
        learningRateRange: [0.74, 0.94],
        contradictionResponse: "优先延长观察或亲自试探，不用传闻修补矛盾",
      },
    },
    desires: [{
      id: "desire_luozhao_test_own_limit_against_xiezenshi",
      ownerCharacterId: "char_xyy_luozhao",
      desiredState: {
        subjectCharacterId: "char_xyy_luozhao",
        verb: "亲自验证",
        object: "自己在谢真石完整状态的剑下能否触及新的极限",
        observableOutcome: "洛照在谢真石未受伤且能够真实回应时完成至少一轮有效攻防，并形成自己的第一手判断",
      },
      target: { type: "character", id: "char_xyy_xiezenshi", label: "谢真石" },
      baselineRange: [0.78, 0.9],
      activationCues: ["与传闻相符但尚未确认的步法", "直接观察到高妙剑招", "此前压下欲望后的修炼受挫"],
      progressEvidence: ["持续观察", "确认身份", "展示剑意", "点破回避", "受控试探", "等待恢复", "因未完成验证而返回"],
      satisfactionCondition: {
        type: "valid_firsthand_exchange",
        criteria: {
          targetCharacterId: "char_xyy_xiezenshi",
          targetCapableToRespond: true,
          directObservation: true,
          attackDefenseRoundsAtLeast: 1,
          ownJudgmentFormed: true,
        },
      },
      unresolvedDynamics: {
        retentionRange: [0.86, 0.96],
        frustrationGainRange: [0.68, 0.86],
        cueGainRange: [0.62, 0.82],
        resolutionGainRange: [0.86, 0.98],
      },
    }],
    inhibitors: [
      {
        id: "inhibitor_luozhao_irrelevant_public_trouble",
        conditionPattern: "公共酒馆拥挤、容易牵连客人、店家会干涉或交手被围观打断",
        costChannel: "irrelevantComplication",
        weightRange: [0.62, 0.82],
        meaning: "避免与有效验证无关的麻烦和干扰",
        doesNotMean: "不是羞耻、害羞或在意旁人评价",
      },
      {
        id: "inhibitor_luozhao_invalid_opponent_state",
        conditionPattern: "目标确实受伤、无法以完整状态回应",
        costChannel: "evidenceContamination",
        weightRange: [0.86, 0.98],
        meaning: "受伤状态无法提供她想要的有效判断",
        doesNotMean: "等待本身不能直接解释为关心或温柔",
      },
      {
        id: "inhibitor_luozhao_sect_prohibition",
        conditionPattern: "宗门明确禁止接触可能帮助突破的资源",
        costChannel: "identityAndObligationConflict",
        weightRange: [0.72, 0.9],
        meaning: "短期可以压过欲望并使她离开",
        doesNotMean: "离开不是欲望完成，冲突仍保持开放",
      },
    ],
    actionPolicy: {
      candidateFamilies: [
        { id: "observe-before-identifying", function: "在无人自报且缺少可信情境关联时积累身份线索；不把视觉识别、工作性采用与最终确认混为一谈", evidenceRequirements: ["目标尚无本人自报或可信情境关联"], typicalEscalationAfter: "形成可供交往的暂时身份假说，或本人决定继续核验" },
        { id: "reveal-sword-intent", function: "用态度、眼神和剑意表明挑战", evidenceRequirements: ["目标身份已确认，或已被本人暂时采用为可逆交往假说", "场所至少允许非破坏性施压"], typicalEscalationAfter: "目标察觉后故意无视" },
        { id: "question-deliberate-avoidance", function: "用带压力的问题点破回避", evidenceRequirements: ["本人已确认对方看见挑战"], typicalEscalationAfter: "场所合适且对方仍拒绝回应" },
        { id: "controlled-probe", function: "以受控力度迫使对方给出真实反应", evidenceRequirements: ["场所合适", "目标能够回应", "牵连风险在可接受范围"], typicalEscalationAfter: "获得新的剑术证据" },
        { id: "wait-for-valid-opponent-state", function: "等待真正受伤的目标恢复", evidenceRequirements: ["伤势由本人确认", "当前交手会污染判断"], typicalEscalationAfter: "目标恢复或出现新证据" },
        { id: "return-after-unresolved-frustration", function: "受挫后重新接近尚未验证的高价值机会", evidenceRequirements: ["欲望此前被压下但未完成", "后来修炼受挫或出现新线索"], typicalEscalationAfter: "重新观察风险与进入方法" },
      ],
      invalidShortcuts: ["因传闻在见面前直接视觉认出谢真石", "因别人评价直接形成胜负结论", "把离开或等待写成欲望完成", "把高妙剑招直接写成信任或爱慕"],
      domainControl: [{ domain: "martial-probing", controlRange: [0.82, 0.95], evidenceIds: ["luo-controlled-probing"] }],
    },
    speechPolicy: {
      silenceDefault: "话语不能推动验证、施压或承诺时保持沉默并继续观察",
      explanationCostRange: [0.72, 0.9],
      socialMaintenanceRange: [0.02, 0.12],
      pragmaticForms: ["点破回避的压力问题", "只基于亲见证据的短评", "不征求许可的未来决定句"],
      praiseConditions: ["本人直接观察到高妙剑招时可以短促而真诚地肯定"],
      pressureMutation: ["先非语言施压", "被故意忽视后点破回避", "解释继续减少但问题保持完整"],
      relationshipRegisters: {
        prospectiveOpponent: "平等审视，不用宗门称号压低或抬高对方",
        host: "只处理真实房饭、接引和费用，不制造寒暄",
        stranger: "不给普通搭讪留下继续展开的机会",
      },
      forbiddenRegisters: ["现代客服腔", "空泛礼貌", "引用二手剑术评价作为自己的能力结论", "解释自己的兴奋", "把挑战柔化成有机会再切磋"],
      evidenceAnchors: [
        { function: "pressure", line: "你打算一直装作没看见？", evidenceId: "luo-nonverbal-pressure" },
        { function: "genuine-domain-evaluation", line: "好剑。", evidenceId: "luo-domain-excitement" },
        { function: "future-commitment", line: "我会再来。", evidenceId: "luo-suppresses-and-returns" },
      ],
    },
    relationshipModel: {
      dimensions: ["familiarity", "trust", "affection", "care", "dependence", "competenceRespect", "rivalry", "resentment", "fear", "obligation"],
      updateRules: [{
        id: "luo-observes-excellent-sword",
        observedPattern: "谢真石以高妙剑招迫使她后退",
        appraisal: "发现能推动自己触及新极限的真实可能",
        deltas: {
          competenceRespect: [0.14, 0.28],
          rivalry: [0.1, 0.22],
          familiarity: [0.02, 0.08],
          trust: [0, 0],
          care: [0, 0],
          affection: [0, 0],
        },
        evidenceIds: ["luo-domain-excitement"],
      }],
      forbiddenCollapses: ["能力尊重不等于信任", "等待恢复不等于关心", "竞争兴趣不等于亲密或爱慕"],
    },
    validation: {
      calibrationScenarios: [
        { id: "luo-identification", changedVariable: "identity-certainty", answer: "只知道传闻时不能凭空认人；出现本人自报或可信情境后，可暂时采用并继续验证", inferredEvidenceIds: ["luo-observes-before-identifying"] },
        { id: "luo-refusal-suitable-place", changedVariable: "venue-suitability", answer: "以剑意、态度和眼神继续试探，被忽视后开口", inferredEvidenceIds: ["luo-nonverbal-pressure", "luo-controlled-probing"] },
        { id: "luo-forbidden-breakthrough", changedVariable: "sect-prohibition", answer: "压住欲望离开，受挫后可能再来", inferredEvidenceIds: ["luo-suppresses-and-returns"] },
        { id: "luo-excellent-counter", changedVariable: "observed-opponent-quality", answer: "兴奋并评价好剑", inferredEvidenceIds: ["luo-domain-excitement"] },
        { id: "luo-opponent-injured", changedVariable: "opponent-capacity", answer: "等待恢复", inferredEvidenceIds: ["luo-waits-for-recovery"] },
      ],
      holdouts: [
        { id: "luo-holdout-flattery", unseenSituation: "陌生人借玉衡宗名头奉承并攀谈", prediction: "不应酬；挡路时只说让开", accepted: true },
        { id: "luo-holdout-rumor", unseenSituation: "周珉断言谢真石接不住三招", prediction: "不改变能力判断；最多询问他在哪里", accepted: true },
        { id: "luo-holdout-return", unseenSituation: "离开禁地后修炼连续受挫", prediction: "未完成欲望再激活，回到附近先观察风险和进入方法", accepted: true },
      ],
    },
  },
};

for (const authoringRecord of Object.values(authoringRecords)) {
  const result = validateCharacterPsychologyAnchor(authoringRecord);
  if (!result.valid) {
    const error = new TypeError(result.errors.map((entry) => `${entry.code}@${entry.path}: ${entry.message}`).join("\n"));
    error.code = "INVALID_CHARACTER_PSYCHOLOGY_ANCHOR";
    throw error;
  }
}

export const CHARACTER_PSYCHOLOGY_AUTHORING_RECORDS = deepFreeze(authoringRecords);

const characterFoundations = Object.fromEntries(Object.entries(CHARACTER_PSYCHOLOGY_AUTHORING_RECORDS)
  .map(([characterId, authoringRecord]) => [characterId, compileCharacterFoundation(authoringRecord)]));
const characterVoiceProjections = Object.fromEntries(Object.entries(CHARACTER_PSYCHOLOGY_AUTHORING_RECORDS)
  .map(([characterId, authoringRecord]) => [characterId, compileCharacterVoiceProjection(authoringRecord)]));
const staticFoundationIds = new Set(Object.keys(characterFoundations));
const retiredStaticFoundationIds = new Set();
for (const runtime of listValidatedCharacterAnchorRuntimes()) {
  if (characterFoundations[runtime.characterId]) {
    delete characterFoundations[runtime.characterId];
    delete characterVoiceProjections[runtime.characterId];
    staticFoundationIds.delete(runtime.characterId);
    retiredStaticFoundationIds.add(runtime.characterId);
  }
  characterFoundations[runtime.characterId] = runtime.characterFoundation;
  characterVoiceProjections[runtime.characterId] = runtime.voiceProjection;
}

export const RETIRED_STATIC_CHARACTER_FOUNDATION_IDS = Object.freeze([...retiredStaticFoundationIds]);

for (const foundation of Object.values(characterFoundations)) {
  const result = validateCharacterFoundation(foundation);
  if (!result.valid) {
    const error = new TypeError(result.errors.map((entry) => `${entry.code}@${entry.path}: ${entry.message}`).join("\n"));
    error.code = "INVALID_CHARACTER_FOUNDATION";
    throw error;
  }
}

export const CHARACTER_PSYCHOLOGY_ANCHORS = deepFreeze(characterFoundations);
export const CHARACTER_VOICE_PROJECTIONS = deepFreeze(characterVoiceProjections);

export function getCharacterPsychologyAuthoringRecord(characterOrId) {
  const characterId = typeof characterOrId === "object" ? characterOrId?.id : characterOrId;
  return CHARACTER_PSYCHOLOGY_AUTHORING_RECORDS[characterId] || null;
}

export function getCharacterPsychologyAnchor(characterOrId, { sceneId = "" } = {}) {
  const characterId = typeof characterOrId === "object" ? characterOrId?.id : characterOrId;
  const runtime = findValidatedCharacterAnchorRuntime(characterId, { sceneId });
  if (runtime) return runtime.characterFoundation;
  if (sceneId && !staticFoundationIds.has(characterId)) return null;
  return CHARACTER_PSYCHOLOGY_ANCHORS[characterId] || null;
}

export function getCharacterPsychologyVoiceProjection(characterOrId, { sceneId = "" } = {}) {
  const characterId = typeof characterOrId === "object" ? characterOrId?.id : characterOrId;
  const runtime = findValidatedCharacterAnchorRuntime(characterId, { sceneId });
  if (runtime) return runtime.voiceProjection;
  if (sceneId && !staticFoundationIds.has(characterId)) return null;
  return CHARACTER_VOICE_PROJECTIONS[characterId] || null;
}
