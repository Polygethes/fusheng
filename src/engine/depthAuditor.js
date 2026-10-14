import { auditMemoryUse, mergeMemoryAuditIntoAudit } from "../state/memoryAudit.js";
import { auditPlans } from "../state/intentPlanner.js";
import { buildSimulationAudit } from "../state/simulationLoop.js";

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function auditDraft(draft, state) {
  const participantCount = draft.participantIds?.length || 0;
  const outputs = draft.agentOutputs || [];
  const tones = new Set(outputs.map((item) => item.tone));
  const hasSubtext = (draft.subtextMatrix || []).length >= participantCount;
  const hasIrreversible = (draft.irreversibleTraces || []).length > 0;
  const hasMutualShift = (draft.relationshipShift || []).length >= participantCount;
  const allHaveShadow = outputs.every((item) => item.shadowAction && item.hiddenAction && item.defenseAction);
  const allHaveHarm = outputs.every((item) => item.possibleHarm);
  const activeCharacters = state.characters.filter((item) => draft.participantIds.includes(item.id));
  const whitePaperRisk = activeCharacters.some((character) => !character.actionLines?.shadow || !character.vileActions?.length) ? 62 : 14;
  const safeClosureRisk = /回避|说明|承认错误|保护权益|恢复|释怀|睡/.test(draft.sceneText) ? 48 : 22;
  const singleMotivationRisk = tones.size <= 1 ? 44 : 22;
  const moralRepairBias = /正确|负责|净化|修复|体面解决/.test(draft.sceneText) ? 58 : 26;

  const irreversibleConsequenceScore = clamp((hasIrreversible ? 48 : 10) + (draft.relationshipShift?.length || 0) * 4 + (draft.injectedEvent ? 12 : 0));
  const multiMotivationScore = clamp((allHaveShadow ? 42 : 18) + (allHaveHarm ? 18 : 8) + (hasSubtext ? 22 : 6) + tones.size * 6);
  const relationshipMutualContaminationScore = clamp((hasMutualShift ? 48 : 10) + (participantCount > 1 ? 22 : 0) + (draft.subtextMatrix?.length || 0) * 4);

  const warnings = [];
  const requiredFixes = [];
  if (whitePaperRisk > 50) {
    warnings.push("有角色缺少阴影行动或卑劣行动，容易变成白纸。需要补足其高尚中的索取、恶意中的求救。");
    requiredFixes.push("给每个参与人物增加至少一个阴影收益。");
  }
  if (singleMotivationRisk > 40) {
    warnings.push("本轮人物行动调性过于一致，关系可能不够互相污染。需要让至少一个人误读或反击。 ");
    requiredFixes.push("增加对方反行动：保护、陷害、爱慕、报复或故意误读。 ");
  }
  if (safeClosureRisk > 45) {
    warnings.push("场景可能滑向安全收束：承认、回避、保护、释怀。需要把这些动作污染化。 ");
    requiredFixes.push("把高尚行动拆出欲望、权力、自欺和阴影收益。 ");
  }
  if (!hasIrreversible) {
    warnings.push("缺少不可逆痕迹。场景需要留下材料、谣言、关系债或误读。 ");
    requiredFixes.push("新增证据、秘密或无法撤回的台词。 ");
  }

  const baseAudit = {
    flatCharacterRisk: whitePaperRisk,
    safeClosureRisk,
    singleMotivationRisk,
    moralRepairBias,
    whitePaperCharacterRisk: whitePaperRisk,
    irreversibleConsequenceScore,
    multiMotivationScore,
    relationshipMutualContaminationScore,
    warnings,
    requiredFixes,
    shouldRegenerate: whitePaperRisk > 72 || safeClosureRisk > 72 || multiMotivationScore < 38,
  };

  const memoryAudit = auditMemoryUse(draft, state);
  const planAudit = auditPlans(state, draft);
  const simulationAudit = buildSimulationAudit(draft, state);
  const merged = mergeMemoryAuditIntoAudit(baseAudit, memoryAudit);
  return {
    ...merged,
    planAudit,
    simulationAudit,
    planUseScore: planAudit.planUseScore,
    planRisk: planAudit.planRisk,
    activePlanCount: planAudit.activePlanCount,
    highPressurePlanCount: planAudit.highPressurePlanCount,
    privateIntentCoverage: simulationAudit.privateIntentCoverage,
    contradictionPressureScore: simulationAudit.contradictionPressureScore,
    visibilityTensionScore: simulationAudit.visibilityTensionScore,
    unscriptedCollisionScore: simulationAudit.unscriptedCollisionScore,
    planScriptRisk: simulationAudit.planScriptRisk,
    directorOverrideRisk: simulationAudit.directorOverrideRisk,
    sceneSimulationScore: simulationAudit.sceneSimulationScore,
    realtimeSimulationScore: simulationAudit.sceneSimulationScore,
    realtimeSimulationRisk: Math.max(simulationAudit.planScriptRisk || 0, simulationAudit.directorOverrideRisk || 0),
    avgContradiction: simulationAudit.contradictionPressureScore,
    visibilityScore: simulationAudit.visibilityTensionScore,
    privateSimulationCount: draft.privateSimulations?.length || draft.simulationTick?.privateSimulations?.length || 0,
    warnings: [...(merged.warnings || []), ...(planAudit.warnings || []), ...(simulationAudit.warnings || [])],
    requiredFixes: [
      ...(merged.requiredFixes || []),
      ...(planAudit.planRisk > 55 ? ["让人物下一步行动显式执行、背叛或扭曲自己的自主计划。"] : []),
      ...(Math.max(simulationAudit.planScriptRisk || 0, simulationAudit.directorOverrideRisk || 0) > 55 ? ["让每个参与人物先生成私人欲望、防御面具、阴影冲动，再把这些放进同一场所互相误读。"] : []),
    ],
    shouldRegenerate: Boolean(merged.shouldRegenerate || planAudit.planRisk > 86 || simulationAudit.shouldRegenerate),
  };
}
