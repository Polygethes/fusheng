import assert from "node:assert/strict";
import { buildSceneInteractionUserPrompt } from "../src/server/pipeline/sceneInteractionSimulator.mjs";

const compactBase = {
  selectedLocation: { id: "hall", name: "法契门" },
  availableLocations: [{ id: "hall", name: "法契门" }, { id: "alley", name: "后巷" }],
  activeCharacters: [{ id: "yan", name: "阎无咎" }, { id: "shen", name: "沈珩" }],
  activeInterventions: [], relationships: [], ui: { timeGrain: "scene" },
  recentCanon: Array.from({ length: 6 }, (_, i) => ({ id: i, text: `正史${i}${"旧档".repeat(300)}` })),
  recentEvidence: Array.from({ length: 8 }, (_, i) => ({ id: i, text: `证据${i}${"旁支".repeat(300)}` })),
  recentRumors: Array.from({ length: 8 }, (_, i) => ({ id: i, text: `谣言${i}${"传闻".repeat(300)}` })),
  activeCharacterMemories: Array.from({ length: 12 }, (_, i) => ({ id: i, content: `记忆${i}${"回声".repeat(300)}` })),
  evidenceLinks: [], irreversibleTraces: [],
};
const simulations = [{
  characterId: "yan", characterName: "阎无咎", targetCharacterId: "shen", targetCharacterName: "沈珩",
  tone: "撤退", publicGoal: "换符", privateDesire: "带走证物", defensiveMask: "只是交易",
  shadowImpulse: "让沈珩先失态", nobleImpulse: "不牵连摊主", selfLie: "我没有害怕",
  actionCandidate: "阎无咎把魔印压到铜盘旁。", pressure: 88, contradictionScore: 76,
  presenceIntent: "leave", exitUrgency: 90, exitResistance: 24, desiredDestinationId: "alley",
  relationshipDialogueTranscript: "沈珩：“名字从哪里来？” 阎无咎：“先把契牌还我。”",
  relationshipDialogueHistory: Array.from({ length: 8 }, (_, i) => ({ transcript: `旧对白${i}${"重复".repeat(300)}` })),
  coldArchive: "无关后台".repeat(3000),
}];

const visibilityLayer = { visibleFacts: ["界石亮起。"], hiddenFacts: [], perCharacter: [] };
const quality = buildSceneInteractionUserPrompt({ compact: { ...compactBase, pipelineMode: "quality" }, privateSimulations: simulations, visibilityLayer });
const fast = buildSceneInteractionUserPrompt({ compact: { ...compactBase, pipelineMode: "fast" }, privateSimulations: simulations, visibilityLayer });

assert.ok(fast.length < quality.length * 0.45, `fast shared-scene prompt should remove cold history (${fast.length}/${quality.length})`);
assert.match(fast, /名字从哪里来/);
assert.match(fast, /presenceIntent/);
assert.match(fast, /后巷/);
assert.doesNotMatch(fast, /无关后台无关后台无关后台/);

console.log("fastScenePromptCompaction:test passed", { quality: quality.length, fast: fast.length });
