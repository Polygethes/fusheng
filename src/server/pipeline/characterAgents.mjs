import { callOpenAIJson } from "./responseClient.mjs";
import { agentOutputSchema } from "./schemas.mjs";
import { calibrateAgentOutputWithMemory, normalizeAgentOutput } from "./context.mjs";
import { forbiddenTargetNames, relationshipIntensityScore, targetFor } from "./relationshipTargeting.mjs";
import { applyInterventionsToAgentOutput, interventionPromptBlock } from "../../state/interventions.js";

export { relationshipIntensityScore, targetFor };

function systemPrompt() {
  return `你是 Character Town 的 CharacterPrivateSimulator + 单一角色代理。你只驱动一个人物：先模拟这个人物的私人后台，再把私人后台转成下一步可表演行动；不替整体故事收束，不替别人做决定。

斯坦尼式硬规则：
- 先输出实时私人模拟：公开目标、私人欲望、防御面具、阴影冲动、高尚冲动、自欺句、行动候选、可见/隐藏信息。
- 再写这个人物在规定情境中的下一步可表演行动。
- 行动必须来自人物四线：显性行动线、欲望行动线、防御行动线、阴影行动线。
- 人物拥有自主计划：短期计划、中期伪装、长期自我神话。下一步行动必须执行、扭曲、背叛或暴露这个计划，不能只是响应场景。
- 不要把人物写成正确答案；高尚动作必须带污染，恶意动作必须带爱、恐惧、求救或自毁。
- 内心不能只解释，必须转成具体动作、话语、证据或对他人的压力。
- 输出一个 JSON 对象，严格匹配 schema。
- 不写露骨性内容；成人欲望以注意力、等待、语言、权力、证据、误读和关系行动表达。`;
}

function userPrompt({ compact, character, targetId }) {
  const target = compact.activeCharacters.find((item) => item.id === targetId) || compact.activeCharacters.find((item) => item.id !== character.id);
  const relevantRelationships = compact.relationships.filter((rel) => rel.fromCharacterId === character.id || rel.toCharacterId === character.id);
  return `请只作为这个人物行动：${character.name}。
目标人物优先：${target?.name || targetId}。

播放粒度：${compact.ui.timeGrain || "scene"}
操盘指令：${compact.ui.userDirective || "无"}
注入事件：${compact.ui.injectedEvent || "无"}
操盘手干预：
${interventionPromptBlock({ ...compact, interventions: compact.activeInterventions, characters: compact.activeCharacters })}
场所：${compact.selectedLocation.name} / ${compact.selectedLocation.subtext}

人物卡 JSON：
${JSON.stringify(character, null, 2)}

角色自主计划 JSON：
${JSON.stringify(character.plan || {}, null, 2)}

相关关系 JSON：
${JSON.stringify(relevantRelationships, null, 2)}

最近正史/证据/谣言/人物记忆：
${JSON.stringify({ recentCanon: compact.recentCanon, recentEvidence: compact.recentEvidence, recentRumors: compact.recentRumors, activeCharacterMemories: compact.activeCharacterMemories, memoryConflictSummaries: compact.memoryConflictSummaries, evidenceLinks: compact.evidenceLinks, irreversibleTraces: compact.irreversibleTraces }, null, 2)}

请生成这个人物本轮行动。关键：不能只有一个动机；必须有表层理由、欲望理由、羞耻理由、权力理由、自欺理由、不愿承认的快感和事后的自我惩罚。若人物记忆存在，行动必须显示记忆如何被准确、选择性、扭曲、伪造、压抑或武器化地使用。不能只说“想起”；必须把记忆转成动作、台词、删改、保存、误读、保护、报复、陷害、沉默或自毁。另一个硬要求：必须输出 planInfluence、planNextAction、planStatus，说明本轮行动如何执行、背叛或暴露角色自主计划。还必须输出 realtimePublicGoal、realtimePrivateDesire、realtimeDefensiveMask、realtimeShadowImpulse、realtimeNobleImpulse、realtimeLieToSelf、realtimeActionCandidate、realtimePressure、realtimeContradictionScore、falseBeliefs、withheldFacts。计划不是剧情；计划是人物进入场景前对自己的谎言。`;
}

export async function runCharacterAgents(compact, { signal } = {}) {
  const stages = [];
  const outputs = [];
  for (const character of compact.activeCharacters) {
    const targetId = targetFor(character, compact);
    const target = compact.activeCharacters.find((item) => item.id === targetId);
    const stageStarted = Date.now();
    const { parsed, meta } = await callOpenAIJson({
      system: systemPrompt(),
      user: userPrompt({ compact, character, targetId }),
      schema: agentOutputSchema,
      schemaName: "character_town_agent_output",
      signal,
    });
    const normalized = normalizeAgentOutput(parsed, character.id, targetId, {
      targetCharacterName: target?.name || targetId,
      forbiddenTargetNames: forbiddenTargetNames(compact, character.id, targetId),
    });
    const calibrated = calibrateAgentOutputWithMemory(normalized, { compact, character, target });
    outputs.push(applyInterventionsToAgentOutput(calibrated, { ...compact, interventions: compact.activeInterventions, characters: compact.activeCharacters }));
    stages.push({
      name: `CharacterAgent:${character.name}`,
      provider: "openai",
      model: meta.model,
      elapsedMs: Date.now() - stageStarted,
      responseId: meta.responseId,
    });
  }
  return { agentOutputs: outputs, stages };
}
