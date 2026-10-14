import assert from "node:assert/strict";

const sceneModule = await import("../src/server/pipeline/sceneInteractionSimulator.mjs");

assert.equal(
  typeof sceneModule.buildSceneInteractionUserPrompt,
  "function",
  "scene interaction simulator should expose a testable user prompt builder",
);

const dialogueTurns = [
  "按城法扣契，不按宗门私仇。",
  "我押的是灵契，不是命。",
  "剑可以停，证据不能走。",
  "那你要谁替你盖印？",
];

const compact = {
  ui: {
    timeGrain: "scene",
    userDirective: "",
    injectedEvent: "",
  },
  selectedLocation: {
    id: "loc_gate",
    name: "四方法契门",
    subtext: "所有入城者都把本命灵契押在铜盘里。",
  },
  activeCharacters: [
    { id: "char_shen", name: "沈珩" },
    { id: "char_yan", name: "阎无咎" },
  ],
  activeInterventions: [],
  recentCanon: [],
  recentEvidence: [],
  recentRumors: [],
  activeCharacterMemories: [],
  evidenceLinks: [],
  irreversibleTraces: [],
};

const privateSimulations = [
  {
    characterId: "char_shen",
    characterName: "沈珩",
    targetCharacterId: "char_yan",
    targetCharacterName: "阎无咎",
    memorySource: "agent_dialogue_relationship",
    relationshipDialogueTranscript: `上一轮对白全文：沈珩：“${dialogueTurns[0]}” 阎无咎：“${dialogueTurns[1]}” 沈珩：“${dialogueTurns[2]}” 阎无咎：“${dialogueTurns[3]}”`,
    relationshipDialogueMemory: {
      sharedObject: "灵契",
      followupTurn: dialogueTurns[3],
      eventOutcome: "沈珩把灵契推向阎无咎，守门人没有盖印。",
    },
  },
  {
    characterId: "char_yan",
    characterName: "阎无咎",
    targetCharacterId: "char_shen",
    targetCharacterName: "沈珩",
    memorySource: "agent_dialogue_relationship",
    relationshipDialogueTranscript: `上一轮对白全文：沈珩：“${dialogueTurns[0]}” 阎无咎：“${dialogueTurns[1]}” 沈珩：“${dialogueTurns[2]}” 阎无咎：“${dialogueTurns[3]}”`,
    relationshipDialogueMemory: {
      sharedObject: "灵契",
      followupTurn: dialogueTurns[3],
      eventOutcome: "沈珩把灵契推向阎无咎，守门人没有盖印。",
    },
  },
];

const prompt = sceneModule.buildSceneInteractionUserPrompt({
  compact,
  privateSimulations,
  visibilityLayer: { perCharacter: [] },
});

assert.match(prompt, /场景对白续接上下文/, "scene prompt should include an explicit dialogue-continuation block");
assert.match(prompt, /agentExchanges\.dialogueTurns|dialogueTurns/, "scene prompt should bind continuation to structured dialogueTurns");
assert.match(prompt, /接住|回应|追问|拒绝|改口/, "scene prompt should instruct the model to continue unresolved dialogue as an interaction");

for (const line of dialogueTurns) {
  assert.match(
    prompt,
    new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `scene prompt should include full prior dialogue line: ${line}`,
  );
}

console.log("sceneInteractionPromptIncludesDialogueContinuation:test passed", {
  excerpt: prompt.match(/场景对白续接上下文：[\s\S]*?私人模拟 privateSimulations：/)?.[0]?.slice(0, 600),
});
