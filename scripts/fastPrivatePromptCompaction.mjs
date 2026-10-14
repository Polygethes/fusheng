import assert from "node:assert/strict";
import { buildPrivateSimulationUserPrompt } from "../src/server/pipeline/privateSimulator.mjs";

const character = {
  id: "yan", name: "阎无咎", publicIdentity: "血河楼使者",
  agentProfile: { dramaticObjective: "带走翻案证物", hiddenFear: "魔印被照见", leverageObject: "魔印", dialogueMoves: ["先试价", "再退让"] },
  internalSituation: { inadmissibleDesire: "逃离审讯" },
  externalSituation: { pressure: "证物正在被扣押" },
  selfMyth: { believesSelfToBe: "从不失手的人" },
  actionLines: { visible: "试价", desire: "翻案", defense: "只是交易", shadow: "让对方先失态" },
  actionVerbs: { visible: ["试价"], hidden: ["逃离"] },
  currentState: { shame: 72, desire: 80 },
  plan: { id: "plan_yan", shortTerm: "把魔印换成证物", immediateObjective: "在盖印前带走证物", status: "active" },
  historicalArchive: "旧档".repeat(4000),
};
const target = { id: "shen", name: "沈珩", publicIdentity: "玄衡宗执律剑修" };
const memories = Array.from({ length: 12 }, (_, index) => ({
  id: `mem_${index}`, characterId: "yan", targetCharacterId: "shen", heat: 100 - index,
  content: index === 0 ? "沈珩上次扣住了魔印。" : `较远记忆${index}：${"旁支".repeat(120)}`,
}));
const base = {
  selectedLocation: { id: "hall", name: "法契门" },
  availableLocations: [{ id: "hall", name: "法契门" }, { id: "alley", name: "后巷" }],
  activeCharacters: [character, target], activeCharacterIds: ["yan", "shen"],
  relationships: [{ fromCharacterId: "yan", toCharacterId: "shen", lastDialogue: { sharedObject: "魔印", finalTurn: "名字从哪里来？" } }],
  activeCharacterMemories: memories,
  memoryConflictSummaries: [{ characterId: "yan", summary: "他不确定沈珩是否知道真名。", mostRecentMemories: memories.slice(0, 8) }],
  activeCharacterPlans: [character.plan],
  recentCanon: memories.slice(0, 6), recentEvidence: memories.slice(0, 8), recentRumors: memories.slice(0, 8), irreversibleTraces: memories.slice(0, 8),
  activeInterventions: [], ui: { timeGrain: "scene" },
};

const qualityPrompt = buildPrivateSimulationUserPrompt({ compact: { ...base, pipelineMode: "quality" }, character, targetId: "shen" });
const fastPrompt = buildPrivateSimulationUserPrompt({ compact: { ...base, pipelineMode: "fast" }, character, targetId: "shen" });

assert.ok(fastPrompt.length < qualityPrompt.length * 0.55, `fast prompt should remove cold context (${fastPrompt.length}/${qualityPrompt.length})`);
assert.match(fastPrompt, /血河楼使者/);
assert.match(fastPrompt, /沈珩上次扣住了魔印/);
assert.match(fastPrompt, /在盖印前带走证物/);
assert.match(fastPrompt, /后巷/);
assert.doesNotMatch(fastPrompt, /旧档旧档旧档旧档旧档旧档/, "large cold archives should not enter the fast prompt");

console.log("fastPrivatePromptCompaction:test passed", { quality: qualityPrompt.length, fast: fastPrompt.length });
