import assert from "node:assert/strict";
import { buildSceneInteractionUserPrompt } from "../src/server/pipeline/sceneInteractionSimulator.mjs";

const prompt = buildSceneInteractionUserPrompt({
  compact: {
    ui: { timeGrain: "scene", userDirective: "真实模型测试。" },
    selectedLocation: { id: "loc_gate", name: "四方法契门" },
    activeInterventions: [],
    activeCharacters: [],
    recentCanon: [],
    recentEvidence: [],
    recentRumors: [],
    activeCharacterMemories: [],
    evidenceLinks: [],
    irreversibleTraces: [],
  },
  privateSimulations: [
    {
      characterId: "char_xianxia_shenheng",
      characterName: "沈珩",
      targetCharacterId: "char_xianxia_yanwujie",
      targetCharacterName: "阎无咎",
      publicGoal: "扣住灵契。",
      privateDesire: "逼出旧案。",
    },
  ],
  visibilityLayer: { perCharacter: [] },
});

assert.match(prompt, /数组最多|最多\s*2|最多\s*3/, "prompt should cap array sizes for chat-completions providers");
assert.match(prompt, /不要复写|不要照抄|不要整段复述/, "prompt should forbid copying private simulation fields into the response");

console.log("sceneInteractionPromptBudget:test passed");
