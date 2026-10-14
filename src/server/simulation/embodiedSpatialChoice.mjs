const FORBIDDEN_AUTHORING_KEYS = new Set([
  "characterFit",
  "chosen",
  "chosenPositionId",
  "expectedAction",
  "expectedChoice",
  "preferred",
  "preferredByCharacterId",
  "preferredPositionId",
  "rank",
  "recommendation",
  "score",
  "utility",
]);

export const EMBODIED_SPATIAL_METRIC_IDS = Object.freeze([
  "informationAccess",
  "visualCoverage",
  "socialExposure",
  "approachability",
  "trafficInterference",
  "movementClearance",
  "exitAccess",
  "comfort",
]);

function auditSocialAccess(access, path, errors) {
  if (access == null) return;
  if (!access || typeof access !== "object" || Array.isArray(access)) {
    errors.push(issue("SPATIAL_SOCIAL_ACCESS_INVALID", path, "位置的社会进入条件必须是结构化对象"));
    return;
  }
  for (const key of [
    "physicallyAttemptable",
    "permissionRequiredByNorm",
    "permissionCurrentlyGranted",
    "violationPhysicallyPossible",
  ]) {
    if (typeof access[key] !== "boolean") {
      errors.push(issue(
        "SPATIAL_SOCIAL_ACCESS_FLAG_MISSING",
        `${path}.${key}`,
        `社会进入条件必须明确 ${key}`,
      ));
    }
  }
  if (access.permissionRequiredByNorm === true
    && access.permissionCurrentlyGranted === false
    && access.violationPhysicallyPossible !== true) {
    errors.push(issue(
      "SPATIAL_SOCIAL_ACCESS_CONTRADICTION",
      path,
      "未获社会许可但仍提供移动候选时，必须明确越界是否物理可尝试",
    ));
  }
  if (access.permissionRequiredByNorm === true
    && !(access.evidenceIds || []).map(clean).filter(Boolean).length) {
    errors.push(issue(
      "SPATIAL_SOCIAL_ACCESS_EVIDENCE_MISSING",
      `${path}.evidenceIds`,
      "需要许可的社会边界必须引用人物可感知的世界依据",
    ));
  }
}

function clean(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
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
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_AUTHORING_KEYS.has(key)) {
      errors.push(issue(
        "SPATIAL_CHOICE_AUTHOR_ANSWER_LEAK",
        childPath,
        `空间选项只能描述客观属性，不能包含 ${key}`,
      ));
    }
    walkForbiddenKeys(child, childPath, errors);
  }
  return errors;
}

function validRange(value) {
  return Array.isArray(value)
    && value.length === 2
    && value.every((number) => Number.isFinite(number) && number >= 0 && number <= 1)
    && value[0] <= value[1];
}

export function auditEmbodiedSpatialChoiceInput(input = {}) {
  const errors = walkForbiddenKeys(input);
  const actorId = clean(input.actorId);
  if (!actorId) errors.push(issue("SPATIAL_ACTOR_MISSING", "input.actorId", "空间选择需要人物 id"));
  if (!clean(input.currentPosition?.id) || !clean(input.currentPosition?.zoneId)) {
    errors.push(issue("SPATIAL_CURRENT_POSITION_MISSING", "input.currentPosition", "空间选择需要人物当前的具体位置和区域"));
  }

  const options = Array.isArray(input.positionOptions) ? input.positionOptions : [];
  if (options.length < 2) {
    errors.push(issue("SPATIAL_OPTIONS_INSUFFICIENT", "input.positionOptions", "人物至少需要两个真实可比较的位置选项"));
  }
  const optionIds = new Set();
  for (const [index, option] of options.entries()) {
    const path = `input.positionOptions[${index}]`;
    const optionId = clean(option?.id);
    if (!optionId || optionIds.has(optionId)) {
      errors.push(issue("SPATIAL_OPTION_ID_INVALID", `${path}.id`, "位置选项必须有唯一稳定 id"));
    }
    optionIds.add(optionId);
    if (!clean(option?.zoneId)) errors.push(issue("SPATIAL_OPTION_ZONE_MISSING", `${path}.zoneId`, "位置选项必须属于一个客观区域"));
    if (typeof option?.available !== "boolean") {
      errors.push(issue("SPATIAL_OPTION_AVAILABILITY_MISSING", `${path}.available`, "位置选项必须说明当前是否可用"));
    }
    auditSocialAccess(option?.socialAccess, `${path}.socialAccess`, errors);
    if (option?.available === true && option?.socialAccess?.physicallyAttemptable === false) {
      errors.push(issue(
        "SPATIAL_OPTION_NOT_PHYSICALLY_ATTEMPTABLE",
        `${path}.available`,
        "available=true 表示人物当前至少能物理尝试移动，不能与 physicallyAttemptable=false 并存",
      ));
    }
    for (const metricId of EMBODIED_SPATIAL_METRIC_IDS) {
      if (!validRange(option?.metrics?.[metricId])) {
        errors.push(issue(
          "SPATIAL_METRIC_RANGE_INVALID",
          `${path}.metrics.${metricId}`,
          `${metricId} 必须是 0 到 1 的不确定范围`,
        ));
      }
    }
    for (const [clearanceIndex, row] of (option?.objectClearance || []).entries()) {
      if (!clean(row?.objectId) || !validRange(row?.range)) {
        errors.push(issue(
          "SPATIAL_OBJECT_CLEARANCE_INVALID",
          `${path}.objectClearance[${clearanceIndex}]`,
          "物件活动空间必须引用真实 objectId 和 0 到 1 的范围",
        ));
      }
    }
  }

  const objectIds = new Set();
  for (const [index, object] of (input.carriedObjects || []).entries()) {
    const path = `input.carriedObjects[${index}]`;
    const objectId = clean(object?.id);
    if (!objectId || objectIds.has(objectId)) {
      errors.push(issue("SPATIAL_CARRIED_OBJECT_ID_INVALID", `${path}.id`, "随身物件必须有唯一稳定 id"));
    }
    objectIds.add(objectId);
    if (clean(object?.holderActorId) !== actorId) {
      errors.push(issue("SPATIAL_OBJECT_HOLDER_MISMATCH", `${path}.holderActorId`, "随身物件持有人必须是当前人物"));
    }
    if (object?.attachment?.active === true) {
      if (clean(object.attachment.actorId) !== actorId) {
        errors.push(issue("SPATIAL_ATTACHMENT_ACTOR_MISMATCH", `${path}.attachment.actorId`, "贴身附着物件必须附着于当前人物"));
      }
      if (!clean(object.attachment.mode)) {
        errors.push(issue("SPATIAL_ATTACHMENT_MODE_MISSING", `${path}.attachment.mode`, "贴身物件必须说明客观附着方式"));
      }
    }
  }

  for (const [index, option] of options.entries()) {
    for (const row of option?.objectClearance || []) {
      if (!objectIds.has(clean(row?.objectId))) {
        errors.push(issue(
          "SPATIAL_OBJECT_CLEARANCE_UNKNOWN",
          `input.positionOptions[${index}].objectClearance`,
          `位置引用了当前人物未携带的物件 ${clean(row?.objectId)}`,
        ));
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function compileEmbodiedPositionAffordances(input = {}) {
  const audit = auditEmbodiedSpatialChoiceInput(input);
  if (!audit.valid) {
    const error = new TypeError(audit.errors.map((row) => `${row.code}@${row.path}: ${row.message}`).join("\n"));
    error.code = "INVALID_EMBODIED_SPATIAL_CHOICE_INPUT";
    error.issues = audit.errors;
    throw error;
  }
  const actorId = clean(input.actorId);
  const currentPositionId = clean(input.currentPosition?.id);
  const currentZoneId = clean(input.currentPosition?.zoneId);
  return input.positionOptions.filter((option) => option.available === true).map((option) => {
    const socialAccess = option.socialAccess ? structuredClone(option.socialAccess) : null;
    const isUnpermittedAttempt = socialAccess?.permissionRequiredByNorm === true
      && socialAccess?.permissionCurrentlyGranted === false;
    return {
      id: `affordance:position:${actorId}:${clean(option.id)}`,
      type: "move",
      actorId,
      targetCharacterId: "",
      fromPositionId: currentPositionId,
      destinationPositionId: clean(option.id),
      fromZoneId: currentZoneId,
      toZoneId: clean(option.zoneId),
      preconditions: [
        "目标位置当前可用",
        "人物与目标位置之间存在可走路线",
        "人物身体状态允许完成这次移动",
        ...(isUnpermittedAttempt
          ? ["该移动当前只在物理上可尝试，不等于已经得到进入许可"]
          : []),
      ],
      effects: [
        "人物的具体位置在世界提交后改变",
        "人物的贴身附着物保持附着并随人物一起移动",
        "位置带来的视听、暴露、人流和活动空间条件开始生效",
        ...(isUnpermittedAttempt
          ? ["若越过社会边界并被他人感知，只产生可见越界及社会影响；他人是否回应仍由其本人决定"]
          : []),
      ],
      socialAccess,
      objectivePosition: {
        id: clean(option.id),
        label: clean(option.label),
        zoneId: clean(option.zoneId),
        metrics: structuredClone(option.metrics || {}),
        objectClearance: structuredClone(option.objectClearance || []),
        observableFeatures: unique(option.observableFeatures || []),
      },
    };
  });
}

export function buildEmbodiedSpatialChoiceTool() {
  return Object.freeze({
    role: "character-private-spatial-appraisal-not-world-selection",
    choiceAuthority: "character-agent",
    qualitativeFormula: "U_i(p,t)=goalFit+informationAccess+competenceFit+spatialControl+equipmentControl+bodyFit+exitAccess-socialExposure-trafficInterference-switchingCost",
    objectiveMetricIds: [...EMBODIED_SPATIAL_METRIC_IDS],
    characterWeightSources: [
      "foundation.stablePsychology",
      "foundation.competenceModel",
      "foundation.desires",
      "foundation.inhibitors",
      "dynamicState",
      "ownedMemory",
    ],
    rules: [
      "世界只提供位置、路线、占用、视听、人流、活动空间和物件状态，不标记推荐位置",
      "available 只表示人物当前至少能物理尝试移动，不表示社会许可、合理性或人物会选择；未获许可的可尝试越界必须保留其可感知依据与可能代价",
      "社会边界不会自动替其他人物回应；只有越界动作真实提交、影响传播并被对方感知后，对方 Character Agent 才能自行忽略、询问、警告或干预",
      "职业能力改变人物容易注意的线索、能形成的可行手段和执行熟练度，不创造新的欲望",
      "性格和当前目的改变同一客观位置的私人权重，但公式不替人物作最终选择",
      "贴身物件随人物移动；解除附着、放置或转交必须分别具有明确行动和世界提交",
    ],
  });
}
