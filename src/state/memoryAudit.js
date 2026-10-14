import { normalizeMemory, memoryRisk, summarizeMemory } from "./memoryGraph.js";

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
}

function activeIdsForDraft(draft, state) {
  const ids = draft?.participantIds?.length ? draft.participantIds : state.ui?.activeCharacterIds || [];
  return ids.filter((id) => (state.characters || []).some((character) => character.id === id));
}

export function getRelevantMemoriesForDraft(draft, state) {
  const activeIds = new Set(activeIdsForDraft(draft, state));
  const memories = (state.characterMemories || [])
    .map(normalizeMemory)
    .filter((memory) => activeIds.has(memory.characterId) || activeIds.has(memory.targetCharacterId))
    .map((memory) => ({ ...memory, risk: memoryRisk(memory), summary: summarizeMemory(memory, state) }))
    .sort((a, b) => Number(b.heat || 0) + Number(b.risk || 0) - (Number(a.heat || 0) + Number(a.risk || 0)));
  return memories;
}

function outputUsesMemory(output) {
  const joined = [
    output?.memoryInfluence,
    output?.memoryId,
    output?.visibleAction,
    output?.hiddenAction,
    output?.defenseAction,
    output?.shadowAction,
    output?.desireReason,
    output?.shameReason,
    output?.selfDeceptionReason,
    output?.postActionSelfPunishment,
  ].filter(Boolean).join("\n");
  return /记忆|误记|压抑|篡改|武器化|证据|旧事|回流|记住|忘记|想起|删掉|留下/.test(joined);
}

function draftUsesMemory(draft) {
  const text = [draft?.sceneText, draft?.surfaceEvent, draft?.directorNotes, ...(draft?.irreversibleTraces || [])].filter(Boolean).join("\n");
  return /记忆|误记|压抑|篡改|武器化|证据|旧事|回流|记住|忘记|想起|删掉|留下/.test(text);
}

function memoryConflictScore(memories) {
  if (!memories.length) return 0;
  const bySource = new Map();
  for (const memory of memories) {
    const key = memory.sourceCanonEventId || memory.sourceDraftId || memory.sourceEvidenceId || memory.sourceRumorId || `${memory.characterId}:${memory.targetCharacterId}`;
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key).push(memory);
  }
  let conflict = 0;
  for (const group of bySource.values()) {
    const types = new Set(group.map((memory) => memory.type));
    const stances = new Set(group.map((memory) => memory.stance));
    if (group.length > 1 && (types.size > 1 || stances.size > 1)) conflict += 18 + group.length * 4;
    if (group.some((memory) => memory.type === "weaponized") && group.some((memory) => ["protection", "desire"].includes(memory.stance))) conflict += 14;
  }
  return clamp(conflict);
}

function selfRevisionScore(memories) {
  if (!memories.length) return 0;
  const distorted = memories.filter((memory) => ["selective", "misremembered", "suppressed", "fabricated", "weaponized"].includes(memory.type)).length;
  const unreliable = memories.filter((memory) => Number(memory.reliability || 0) < 55).length;
  const hot = memories.filter((memory) => Number(memory.heat || 0) >= 65).length;
  return clamp(distorted * 12 + unreliable * 8 + hot * 6);
}

export function auditMemoryUse(draft, state) {
  const activeIds = activeIdsForDraft(draft, state);
  const memories = getRelevantMemoriesForDraft(draft, state);
  const activeMemoryCount = memories.length;
  const highRiskMemories = memories.filter((memory) => Number(memory.risk || 0) >= 58 || Number(memory.heat || 0) >= 70);
  const outputs = draft?.agentOutputs || [];
  const outputsUsingMemory = outputs.filter(outputUsesMemory);
  const outputUseRatio = outputs.length ? outputsUsingMemory.length / outputs.length : 0;
  const sceneUsesMemory = draftUsesMemory(draft);
  const memoryIdsUsed = new Set(outputs.map((output) => output.memoryId).filter(Boolean));
  const memoryInfluenceCount = outputs.filter((output) => output.memoryInfluence).length;
  const conflictScore = memoryConflictScore(memories);
  const revisionScore = selfRevisionScore(memories);
  const memoryPressureScore = clamp(highRiskMemories.length * 14 + activeMemoryCount * 4 + conflictScore * 0.5 + revisionScore * 0.35);
  const memoryChangedActionScore = clamp(outputUseRatio * 45 + (sceneUsesMemory ? 22 : 0) + memoryInfluenceCount * 8 + memoryIdsUsed.size * 8);
  const ignoredMemoryRisk = activeMemoryCount ? clamp(memoryPressureScore - memoryChangedActionScore + (highRiskMemories.length ? 12 : 0)) : 0;
  const singleMemoryRisk = activeMemoryCount >= 2
    ? clamp(48 - conflictScore + (new Set(memories.map((memory) => memory.type)).size <= 1 ? 24 : 0) + (new Set(memories.map((memory) => memory.stance)).size <= 1 ? 18 : 0))
    : activeMemoryCount === 1 ? 42 : 0;
  const memoryUseRisk = clamp(ignoredMemoryRisk + singleMemoryRisk * 0.35);

  const warnings = [];
  const requiredFixes = [];
  if (activeMemoryCount && ignoredMemoryRisk > 45) {
    warnings.push("人物当前分支有高热度记忆，但本轮行动没有明显被记忆扭曲、压抑、武器化或修正。 ");
    requiredFixes.push("让至少一个角色把某段具体记忆转成行动：误读、保护、报复、沉默、删改证据或补偿性接近。 ");
  }
  if (singleMemoryRisk > 50) {
    warnings.push("记忆被单义使用：所有人似乎记得同一件事的同一种版本，缺少自我篡改和冲突版本。 ");
    requiredFixes.push("为同一正史或同一对象制造两种冲突记忆：一个自辩版本、一个欲望/报复/保护版本。 ");
  }
  if (memoryChangedActionScore < 35 && activeMemoryCount) {
    warnings.push("记忆没有改变下一步行动，只像背景资料。 ");
    requiredFixes.push("改写 CharacterAgent 输出，让 memoryId / memoryInfluence 进入 visibleAction、hiddenAction、shadowAction 或 possibleEvidenceLeft。 ");
  }
  if (activeMemoryCount === 0 && activeIds.length) {
    warnings.push("参与人物没有当前分支记忆；这会让人物像只根据当下数值反应。 ");
    requiredFixes.push("本轮赞同后应生成至少一条选择性或武器化记忆，供下一轮行动使用。 ");
  }

  const usedMemories = outputsUsingMemory.map((output) => ({
    memoryId: output.memoryId || null,
    characterId: output.characterId,
    targetCharacterId: output.targetCharacterId,
    type: memories.find((memory) => memory.id === output.memoryId)?.type || "unknown",
    stance: memories.find((memory) => memory.id === output.memoryId)?.stance || "unknown",
    influence: output.memoryInfluence || "memory keyword detected",
  })).filter((item) => item.memoryId || item.influence);
  const usedMemoryIds = new Set(usedMemories.map((item) => item.memoryId).filter(Boolean));
  const ignoredMemories = highRiskMemories
    .filter((memory) => !usedMemoryIds.has(memory.id))
    .slice(0, 8)
    .map((memory) => ({ memoryId: memory.id, characterId: memory.characterId, targetCharacterId: memory.targetCharacterId, type: memory.type, stance: memory.stance, risk: memory.risk, heat: memory.heat }));

  return {
    activeMemoryCount,
    highRiskMemoryCount: highRiskMemories.length,
    memoriesChecked: memories.slice(0, 8).map((memory) => ({
      id: memory.id,
      characterId: memory.characterId,
      targetCharacterId: memory.targetCharacterId,
      type: memory.type,
      stance: memory.stance,
      risk: memory.risk,
      heat: memory.heat,
      reliability: memory.reliability,
      summary: memory.summary,
    })),
    memoryPressureScore,
    memoryChangedActionScore,
    memoryConflictScore: conflictScore,
    memorySelfRevisionScore: revisionScore,
    ignoredMemoryRisk,
    singleMemoryRisk,
    memoryUseRisk,
    usedMemories,
    ignoredMemories,
    memoryContinuityScore: memoryChangedActionScore,
    memoryWeaponizationScore: memories.filter((memory) => memory.type === "weaponized" || memory.stance === "revenge").length * 18,
    memoryBlindnessRisk: ignoredMemoryRisk,
    memoryNeglectRisk: ignoredMemoryRisk,
    memoryActionInfluenceScore: memoryChangedActionScore,
    memoryConflictVersionScore: conflictScore,
    memoryPolysemyScore: revisionScore,
    memoryDistortionPressure: memoryPressureScore,
    warnings,
    requiredFixes,
    repairNeeded: Boolean(memoryUseRisk > 55 || ignoredMemoryRisk > 55 || singleMemoryRisk > 65),
    repairBrief: requiredFixes.join("；") || "记忆已进入行动链。",
  };
}

export function mergeMemoryAuditIntoAudit(audit, memoryAudit) {
  const warnings = [...new Set([...(audit?.warnings || []), ...(memoryAudit?.warnings || [])])];
  const requiredFixes = [...new Set([...(audit?.requiredFixes || []), ...(memoryAudit?.requiredFixes || [])])];
  return {
    ...audit,
    memoryPressureScore: memoryAudit.memoryPressureScore,
    memoryChangedActionScore: memoryAudit.memoryChangedActionScore,
    memoryConflictScore: memoryAudit.memoryConflictScore,
    memorySelfRevisionScore: memoryAudit.memorySelfRevisionScore,
    ignoredMemoryRisk: memoryAudit.ignoredMemoryRisk,
    singleMemoryRisk: memoryAudit.singleMemoryRisk,
    memoryUseRisk: memoryAudit.memoryUseRisk,
    activeMemoryCount: memoryAudit.activeMemoryCount,
    highRiskMemoryCount: memoryAudit.highRiskMemoryCount,
    memoriesChecked: memoryAudit.memoriesChecked,
    memoryAudit,
    warnings,
    requiredFixes,
    shouldRegenerate: Boolean(audit?.shouldRegenerate || memoryAudit.repairNeeded),
  };
}

// Compatibility facade for the v0.9 memory-audit UI. The preferred API is
// auditMemoryUse(draft, state), but older panels call buildMemoryAudit(state, draft).
export function buildMemoryAudit(state, draft = {}) {
  const audit = auditMemoryUse(draft, state);
  const activeIds = activeIdsForDraft(draft, state);
  const memories = getRelevantMemoriesForDraft(draft, state);
  const usedIds = new Set((audit.usedMemories || []).map((item) => item.memoryId).filter(Boolean));
  const perCharacter = activeIds.map((characterId) => {
    const own = memories.filter((memory) => memory.characterId === characterId || memory.targetCharacterId === characterId);
    const hot = own.filter((memory) => Number(memory.heat || 0) >= 65 || Number(memory.risk || 0) >= 58);
    const used = own.filter((memory) => usedIds.has(memory.id));
    const typeCount = new Set(own.map((memory) => memory.type)).size;
    const stanceCount = new Set(own.map((memory) => memory.stance)).size;
    const mostDangerous = own.slice().sort((a, b) => Number(b.risk || 0) - Number(a.risk || 0))[0];
    return {
      characterId,
      totalMemories: own.length,
      hotMemories: hot.length,
      usedMemories: used.length,
      ignoredHotMemories: hot.filter((memory) => !usedIds.has(memory.id)).length,
      typeCount,
      stanceCount,
      hasDistortionAction: (draft.agentOutputs || []).some((output) => output.characterId === characterId && /记忆|误记|压抑|篡改|武器化|证据/.test([output.memoryInfluence, output.memoryDistortionAction, output.shadowAction].filter(Boolean).join("\n"))),
      mostDangerousMemoryId: mostDangerous?.id || null,
    };
  });

  const bySource = new Map();
  for (const memory of memories) {
    const sourceId = memory.sourceCanonEventId || memory.sourceDraftId || memory.sourceEvidenceId || memory.sourceRumorId || `${memory.characterId}:${memory.targetCharacterId}`;
    if (!bySource.has(sourceId)) bySource.set(sourceId, []);
    bySource.get(sourceId).push(memory);
  }
  const conflictGroups = [...bySource.entries()].map(([sourceId, group]) => ({
    sourceId,
    count: group.length,
    characters: [...new Set(group.map((memory) => memory.characterId))],
    types: [...new Set(group.map((memory) => memory.type))],
    stances: [...new Set(group.map((memory) => memory.stance))],
    polaritySpread: Math.max(...group.map((memory) => Number(memory.heat || 0)), 0) - Math.min(...group.map((memory) => Number(memory.heat || 0)), 0),
  })).filter((group) => group.count > 1 && (group.types.length > 1 || group.stances.length > 1));

  return {
    ...audit,
    totalRelevantMemories: audit.activeMemoryCount,
    hotMemoryTotal: audit.highRiskMemoryCount,
    usedCharacterCount: new Set((audit.usedMemories || []).map((item) => item.characterId)).size,
    perCharacter,
    conflictGroups,
  };
}
