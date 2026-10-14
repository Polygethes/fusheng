import { callOpenAIJson } from "./responseClient.mjs";
import { visibilityLayerSchema } from "./schemas.mjs";
import { interventionPromptBlock } from "../../state/interventions.js";

function systemPrompt() {
  return `你是 Character Town 的 VisibilityLayer。你不写故事；你只决定这个 simulation tick 中谁知道什么、谁误以为什么、谁故意隐藏什么、谁有盲点。

硬规则：
- 不要让任何人物掌握完整真相；完整真相会杀死误读。
- 每个参与人物都必须有 knownFacts、blindSpots、falseBeliefs、withheldFacts、suspectedSecrets、secretLevers。
- falseBeliefs 必须能在场景中转成行动，不要抽象心理。
- withheldFacts 必须能转成沉默、删改、证据、回避、转移话题或过度解释。
- 可见性层只制造认知地形，不替人物决定行动。
- 输出 JSON，严格匹配 schema。`;
}

function userPrompt({ compact, privateSimulations }) {
  return `请生成本轮可见性层。

播放粒度：${compact.ui?.timeGrain || "scene"}
操盘指令：${compact.ui?.userDirective || "无"}
注入事件：${compact.ui?.injectedEvent || "无"}
场所：
${JSON.stringify(compact.selectedLocation, null, 2)}
操盘干预：
${interventionPromptBlock({ ...compact, interventions: compact.activeInterventions, characters: compact.activeCharacters })}

人物与关系：
${JSON.stringify({ activeCharacters: compact.activeCharacters, relationships: compact.relationships }, null, 2)}

私人内心模拟：
${JSON.stringify(privateSimulations, null, 2)}

最近正史、证据、谣言、记忆：
${JSON.stringify({ recentCanon: compact.recentCanon, recentEvidence: compact.recentEvidence, recentRumors: compact.recentRumors, activeCharacterMemories: compact.activeCharacterMemories, memoryConflictSummaries: compact.memoryConflictSummaries, irreversibleTraces: compact.irreversibleTraces }, null, 2)}

输出 VisibilityLayer。必须让每个人的认知不对称。`;
}

function normalizeVisibilityLayer(parsed = {}, compact, privateSimulations = []) {
  const rows = Array.isArray(parsed.perCharacter) ? parsed.perCharacter : [];
  const normalizedRows = privateSimulations.map((sim) => {
    const found = rows.find((row) => row.characterId === sim.characterId) || {};
    return {
      characterId: found.characterId || sim.characterId,
      characterName: found.characterName || sim.characterName,
      targetCharacterId: found.targetCharacterId || sim.targetCharacterId,
      targetCharacterName: found.targetCharacterName || sim.targetCharacterName,
      knownFacts: Array.isArray(found.knownFacts) ? found.knownFacts : (Array.isArray(found.visibleFacts) ? found.visibleFacts : [`${sim.characterName}知道自己身处${compact.selectedLocation?.name || "场所"}。`]),
      hiddenFacts: Array.isArray(found.hiddenFacts) ? found.hiddenFacts : [sim.privateDesire],
      blindSpots: Array.isArray(found.blindSpots) ? found.blindSpots : [`${sim.characterName}把自己的防御面具当成事实。`],
      falseBeliefs: Array.isArray(found.falseBeliefs) ? found.falseBeliefs : (sim.falseBeliefs || []),
      withheldFacts: Array.isArray(found.withheldFacts) ? found.withheldFacts : (sim.withheldFacts || []),
      suspectedSecrets: Array.isArray(found.suspectedSecrets) ? found.suspectedSecrets : [`${sim.targetCharacterName}可能没有按${sim.characterName}期待的方式理解这次动作。`],
      secretLevers: Array.isArray(found.secretLevers) ? found.secretLevers : [sim.refusesToAdmit || sim.privateDesire],
    };
  });
  return {
    visibleFacts: Array.isArray(parsed.visibleFacts) && parsed.visibleFacts.length ? parsed.visibleFacts : [`地点：${compact.selectedLocation?.name || "未知"}`, compact.ui?.injectedEvent ? `注入意外：${compact.ui.injectedEvent}` : "没有显式意外。"],
    hiddenFacts: Array.isArray(parsed.hiddenFacts) ? parsed.hiddenFacts : privateSimulations.map((sim) => sim.privateDesire),
    visibilityNotes: Array.isArray(parsed.visibilityNotes) ? parsed.visibilityNotes : [parsed.visibilityNotes || "人物不会共享完整真相。"],
    perCharacter: normalizedRows,
  };
}

export function buildLocalVisibilityLayer(compact, privateSimulations = []) {
  return normalizeVisibilityLayer({}, compact, privateSimulations);
}

export async function runVisibilityLayer(compact, privateSimulations, { signal } = {}) {
  const startedAt = Date.now();
  const { parsed, meta } = await callOpenAIJson({
    system: systemPrompt(),
    user: userPrompt({ compact, privateSimulations }),
    schema: visibilityLayerSchema,
    schemaName: "character_town_visibility_layer",
    signal,
  });
  return {
    visibilityLayer: normalizeVisibilityLayer(parsed, compact, privateSimulations),
    stage: {
      name: "VisibilityLayer",
      provider: "openai",
      model: meta.model,
      elapsedMs: Date.now() - startedAt,
      responseId: meta.responseId,
    },
  };
}
