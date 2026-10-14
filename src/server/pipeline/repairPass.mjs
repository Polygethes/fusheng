import { callOpenAIJson } from "./responseClient.mjs";
import { repairedDraftSchema } from "./schemas.mjs";

function systemPrompt() {
  return `你是 Character Town 的修复代理。你不负责让文本更安全，而是修复“安全收束、人物单义、白纸角色、缺少不可逆痕迹、解释多于行动、人物记忆或自主计划没有真正驱动行动”的问题。

修复规则：
- 如果人物太干净，给行动增加阴影收益。
- 如果人物只是受害者，给他/她反行动、误读、爱、恨、保护、报复或利用。
- 如果场景像道德培训，增加关系互染和不可逆材料。
- 如果结尾像修复，改成行动留下债务、证据、误读或关系伤痕。
- 如果审查指出记忆盲区，必须让至少一段高热记忆进入 memoryId、memoryInfluence、memoryUse、memoryDistortionAction，并改变行动动词。
- 如果存在冲突记忆，必须让不同人物对同一正史持有不兼容版本，并在台词、沉默或证据选择里发生冲突。
- 如果人物拥有准确记忆、误记、压抑、篡改或武器化记忆，修复后的行动必须显示这段记忆如何被继承、压下、篡改、误读或当成证据使用。
- 如果同一正史在不同人物那里没有冲突版本，至少让两个人把同一材料记成不同意义。
- 不要用“他想起……”解释深度；必须把记忆转成动作、台词、删改、保存、沉默、误读、报复、保护、陷害或自毁。
- 如果审查指出 planRisk 或 planUseScore 问题，必须让每个 agentOutput 显式包含 planInfluence、planNextAction、planStatus，并让角色执行、背叛或暴露自己的短期计划。
- 不改变已给定角色卡和场所事实。
- 不写露骨性内容。
- 输出完整修复后的 draft JSON。`;
}

function userPrompt({ compact, draft, audit }) {
  return `请修复这个草稿。

当前审查结果：
${JSON.stringify(audit, null, 2)}

当前小镇/人物/记忆摘要：
${JSON.stringify(compact, null, 2)}

待修复草稿：
${JSON.stringify({
    surfaceEvent: draft.surfaceEvent,
    sceneText: draft.sceneText,
    agentOutputs: draft.agentOutputs,
    subtextMatrix: draft.subtextMatrix,
    relationshipShift: draft.relationshipShift,
    irreversibleTraces: draft.irreversibleTraces,
  }, null, 2)}

请输出修复后的完整 JSON。修复后每个受记忆影响的 agentOutput 尽量包含 memoryId 或 memoryInfluence；每个参与人物也必须包含 planInfluence、planNextAction、planStatus。修复时优先处理 memoryAudit 与 planAudit 中的 requiredFixes：让人物用记忆和计划行动，而不是只解释记忆或计划。`;
}

export async function runRepairPass(compact, draft, audit, { signal } = {}) {
  const stageStarted = Date.now();
  const { parsed, meta } = await callOpenAIJson({
    system: systemPrompt(),
    user: userPrompt({ compact, draft, audit }),
    schema: repairedDraftSchema,
    schemaName: "character_town_repaired_draft",
    signal,
  });
  return {
    repaired: parsed,
    stage: {
      name: "RepairPass",
      provider: "openai",
      model: meta.model,
      elapsedMs: Date.now() - stageStarted,
      responseId: meta.responseId,
    },
  };
}
