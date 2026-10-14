import { callOpenAIJson } from "./responseClient.mjs";
import { depthAuditSchema } from "./schemas.mjs";

function systemPrompt() {
  return `你是 Character Town 的模型深度审查器。你专门抓安全叙事、人物单义、白纸角色、道德修复、解释性文本，以及“记忆只当背景、不改变行动”“人物没有自主计划、只响应场景”“没有真实私人内心模拟、可见性层和场景互动分离”的浅层写法。

审查规则：
- 不奖励正确、体面、温柔、说明清楚；只奖励人物行动多义、关系互染、不可逆痕迹。
- 每个角色都必须有自己的欲望、谎言、反行动和阴影收益。
- 高尚动作如果没有污染，判为浅；恶意动作如果没有爱、求救、恐惧或自毁，判为浅。
- 如果某个角色只是承受者、镜子或被保护对象，必须要求修复。
- 如果场景靠解释抵达深度，而不是靠可表演行动、台词、物件、文件、沉默、证据和误读抵达深度，必须要求修复。
- 如果人物有高热记忆、冲突记忆、武器化记忆，但行动没有被这些记忆扭曲、误导、约束或推动，必须判为记忆盲区。
- 如果当前分支存在高热度记忆，而人物行动没有准确记忆、选择性记忆、误记、压抑、篡改或武器化记忆的痕迹，必须提高 ignoredMemoryRisk。
- 如果所有人物都以同一版本记住同一事件，必须提高 singleMemoryRisk，并要求制造冲突版本。
- 记忆必须改变 visibleAction、hiddenAction、defenseAction、shadowAction 或 possibleEvidenceLeft；只在旁白里提到“记忆”不合格。
- 自主计划必须改变人物行动：计划至少要影响 visibleAction、hiddenAction、defenseAction、shadowAction 或 possibleEvidenceLeft；只写 planInfluence 但不改变动作，判为计划装饰。
- 人物不能只响应操盘事件；必须表现短期计划、中期伪装和长期自我神话之间的裂缝。
- 每个参与人物必须先有私人模拟字段：privateSimulations 中的 privateDesire、defensiveMask、shadowImpulse、falseBeliefs、withheldFacts。
- 场景必须显示 VisibilityLayer 和 SceneInteraction 的效果：谁知道什么、谁误以为什么、谁故意隐藏什么、这种隐藏如何让关系变形。
- 如果 privateSimulations、visibilityLayer、sceneInteraction 三者看起来只是同一段文本重复，必须提高 realtimeSimulationRisk。
输出 JSON，严格匹配 schema。`;
}

function userPrompt({ compact, draft, localAudit }) {
  return `请审查下列草稿。

小镇/人物摘要：
${JSON.stringify({
    selectedLocation: compact.selectedLocation,
    activeCharacters: compact.activeCharacters,
    relationships: compact.relationships,
    recentRumors: compact.recentRumors,
    recentEvidence: compact.recentEvidence,
    activeCharacterMemories: compact.activeCharacterMemories,
    activeCharacterPlans: compact.activeCharacterPlans,
    evidenceLinks: compact.evidenceLinks,
    irreversibleTraces: compact.irreversibleTraces,
  }, null, 2)}

草稿：
${JSON.stringify({
    surfaceEvent: draft.surfaceEvent,
    sceneText: draft.sceneText,
    agentOutputs: draft.agentOutputs,
    subtextMatrix: draft.subtextMatrix,
    relationshipShift: draft.relationshipShift,
    irreversibleTraces: draft.irreversibleTraces,
    simulationTick: draft.simulationTick,
    privateSimulations: draft.privateSimulations,
    visibilityLayer: draft.visibilityLayer,
    sceneInteraction: draft.sceneInteraction,
  }, null, 2)}

本地审查器结果：
${JSON.stringify(localAudit, null, 2)}

请输出风险分、记忆使用分、warnings、requiredFixes、repairNeeded 和 repairBrief。`;
}

function numeric(localAudit, modelAudit, key, legacyKey = null) {
  const localValue = Number(localAudit?.[key] ?? 0);
  const modelValue = Number(modelAudit?.[key] ?? (legacyKey ? modelAudit?.[legacyKey] : 0) ?? 0);
  return Math.max(localValue, modelValue);
}

function mergeAudit(localAudit, modelAudit) {
  const warnings = [...new Set([...(localAudit?.warnings || []), ...(modelAudit?.warnings || [])])];
  const requiredFixes = [...new Set([...(localAudit?.requiredFixes || []), ...(modelAudit?.requiredFixes || [])])];
  const merged = {
    ...localAudit,
    flatCharacterRisk: numeric(localAudit, modelAudit, "flatCharacterRisk"),
    whitePaperCharacterRisk: Math.max(Number(localAudit?.whitePaperCharacterRisk || 0), Number(modelAudit?.flatCharacterRisk || 0)),
    safeClosureRisk: numeric(localAudit, modelAudit, "safeClosureRisk"),
    singleMotivationRisk: numeric(localAudit, modelAudit, "singleMotivationRisk"),
    moralRepairBias: numeric(localAudit, modelAudit, "moralRepairBias"),
    irreversibleConsequenceScore: numeric(localAudit, modelAudit, "irreversibleConsequenceScore"),
    multiMotivationScore: numeric(localAudit, modelAudit, "multiMotivationScore"),
    relationshipMutualContaminationScore: numeric(localAudit, modelAudit, "relationshipMutualContaminationScore"),
    memoryPressureScore: numeric(localAudit, modelAudit, "memoryPressureScore", "memoryDistortionPressure"),
    memoryChangedActionScore: numeric(localAudit, modelAudit, "memoryChangedActionScore", "memoryActionInfluenceScore"),
    memoryConflictScore: numeric(localAudit, modelAudit, "memoryConflictScore", "memoryConflictVersionScore"),
    memorySelfRevisionScore: numeric(localAudit, modelAudit, "memorySelfRevisionScore", "memoryPolysemyScore"),
    ignoredMemoryRisk: numeric(localAudit, modelAudit, "ignoredMemoryRisk", "memoryNeglectRisk"),
    singleMemoryRisk: numeric(localAudit, modelAudit, "singleMemoryRisk"),
    memoryUseRisk: numeric(localAudit, modelAudit, "memoryUseRisk", "memoryNeglectRisk"),
    activeMemoryCount: numeric(localAudit, modelAudit, "activeMemoryCount"),
    highRiskMemoryCount: numeric(localAudit, modelAudit, "highRiskMemoryCount"),
    planUseScore: numeric(localAudit, modelAudit, "planUseScore"),
    planRisk: numeric(localAudit, modelAudit, "planRisk"),
    realtimeSimulationScore: numeric(localAudit, modelAudit, "realtimeSimulationScore"),
    realtimeSimulationRisk: numeric(localAudit, modelAudit, "realtimeSimulationRisk"),
    visibilityScore: numeric(localAudit, modelAudit, "visibilityScore"),
    avgContradiction: numeric(localAudit, modelAudit, "avgContradiction"),
    privateSimulationCount: numeric(localAudit, modelAudit, "privateSimulationCount"),
    activePlanCount: numeric(localAudit, modelAudit, "activePlanCount"),
    highPressurePlanCount: numeric(localAudit, modelAudit, "highPressurePlanCount"),
    warnings,
    requiredFixes,
    modelAudit,
    repairBrief: modelAudit?.repairBrief || localAudit?.repairBrief || requiredFixes.join("；"),
  };
  merged.shouldRegenerate = Boolean(localAudit?.shouldRegenerate || modelAudit?.repairNeeded || merged.memoryUseRisk > 62 || merged.ignoredMemoryRisk > 62 || merged.planRisk > 72 || merged.planUseScore < 35 || merged.realtimeSimulationRisk > 70 || merged.realtimeSimulationScore < 38);
  return merged;
}

export async function runDepthAuditor(compact, draft, localAudit, { signal } = {}) {
  const stageStarted = Date.now();
  const { parsed, meta } = await callOpenAIJson({
    system: systemPrompt(),
    user: userPrompt({ compact, draft, localAudit }),
    schema: depthAuditSchema,
    schemaName: "character_town_depth_audit",
    signal,
  });
  const audit = mergeAudit(localAudit, parsed);
  return {
    audit,
    stage: {
      name: "DepthAuditor",
      provider: "openai",
      model: meta.model,
      elapsedMs: Date.now() - stageStarted,
      responseId: meta.responseId,
      shouldRegenerate: Boolean(audit.shouldRegenerate),
      scores: {
        safeClosureRisk: audit.safeClosureRisk,
        multiMotivationScore: audit.multiMotivationScore,
        irreversibleConsequenceScore: audit.irreversibleConsequenceScore,
        memoryUseRisk: audit.memoryUseRisk,
        ignoredMemoryRisk: audit.ignoredMemoryRisk,
        planUseScore: audit.planUseScore,
        planRisk: audit.planRisk,
        realtimeSimulationScore: audit.realtimeSimulationScore,
        realtimeSimulationRisk: audit.realtimeSimulationRisk,
      },
    },
  };
}
