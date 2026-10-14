import assert from "node:assert/strict";
import { buildCharacterDialogueDecision } from "../src/engine/dialogueProtocol.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { buildModelAgentDialogueProtocol } from "../src/server/pipeline/openaiPipeline.mjs";
import { compactState } from "../src/server/pipeline/context.mjs";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于 Downloads 下《逍遥游》策划案与当前版剧本，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
const xie = state.characters.find((character) => character.name === "谢真石");
const zhou = state.characters.find((character) => character.name === "周珉");
const chen = state.characters.find((character) => character.name === "陈砚");
const blueprintLines = [
  ...state.characters.flatMap((character) => character.defenseLanguage || []),
  "九重还没走完，先别替我说到中州。",
  "我问的是还有没有下一重。",
  "让我自己把这一剑走完。",
];

const opening = buildCharacterDialogueDecision({
  character: xie,
  target: zhou,
  output: {
    outputId: "runtime_xie",
    characterId: xie.id,
    targetCharacterId: zhou.id,
    dialogueTopic: "广场上的欢呼",
    conversationObjective: "让周珉停止替自己解释，并说清他为什么追上来",
    reactionReason: "周珉挡住了去剑阁的路",
    currentActivity: "离开人群，进入剑阁",
    tone: "求证",
  },
});

assert.ok(opening.utterance, "a talking agent still needs a public utterance");
assert.ok(!(xie.defenseLanguage || []).includes(opening.utterance), "worldbuilding dialogue examples must never become performed dialogue");
assert.ok(!(xie.agentProfile?.dialogueMoves || []).includes(opening.utterance), "agent profile examples must remain backstage material");
assert.doesNotMatch(opening.utterance, /九重还没走完，先别替我说到中州/, "the source blueprint must not write the live line");

const previousOwnDecision = { turnId: "chen_previous", utterance: "我会把次数记完。", act: "claim", topic: "练功次数" };
const heardCondition = { turnId: "heard_condition", utterance: "你可以继续，但今天先停在这里。", act: "condition", topic: "练功次数" };
const response = buildCharacterDialogueDecision({
  character: chen,
  target: zhou,
  output: {
    outputId: "runtime_chen",
    characterId: chen.id,
    targetCharacterId: zhou.id,
    dialogueTopic: "刚才被打断的练习",
    conversationObjective: "让周珉不要替自己判断这一式是否值得",
    reactionReason: "周珉要求他停下",
    currentActivity: "完成今天剩下的基础剑式",
    tone: "拒绝",
  },
  observedDecision: heardCondition,
  previousOwnDecision,
  turnIndex: 1,
});

assert.equal(response.observedTurnId, heardCondition.turnId, "the responder must causally hear the previous turn");
assert.doesNotMatch(response.utterance, /先说好|还放在这里|得留下|不能一起带走|先别动/, "a response must not paste a universal object-retention template");
assert.doesNotMatch(response.utterance, /磨损的练功册/, "a carried object must not enter speech unless the agent chose to discuss it");
assert.match(response.utterance, /。$/, "a refusal or command must not be punctuated as a question just because it contains 值不值得");

state.ui.selectedLocationId = state.locations.find((location) => location.name === "望梯酒馆").id;
state.ui.activeCharacterIds = [xie.id, zhou.id];
const compact = compactState(state);
const modelProtocol = buildModelAgentDialogueProtocol(compact, [
  {
    characterId: xie.id,
    characterName: xie.name,
    targetCharacterId: zhou.id,
    targetCharacterName: zhou.name,
    agentProfile: xie.agentProfile,
    privateDesire: xie.agentProfile.dramaticObjective,
    publicGoal: xie.agentProfile.dramaticObjective,
    currentActivity: "离开围观者，走向剑阁",
    reactionIntent: "talk",
    reactionTargetCharacterId: zhou.id,
    reactionReason: "周珉挡住了去路",
    conversationObjective: xie.agentProfile.desiredResponse,
    conversationEndCondition: xie.agentProfile.responseBoundary,
  },
  {
    characterId: zhou.id,
    characterName: zhou.name,
    targetCharacterId: xie.id,
    targetCharacterName: xie.name,
    agentProfile: zhou.agentProfile,
    privateDesire: zhou.agentProfile.dramaticObjective,
    publicGoal: zhou.agentProfile.dramaticObjective,
    currentActivity: "追上谢真石",
    reactionIntent: "respond",
    reactionTargetCharacterId: xie.id,
    reactionReason: "谢真石要结束谈话",
    conversationObjective: zhou.agentProfile.desiredResponse,
    conversationEndCondition: zhou.agentProfile.responseBoundary,
  },
]);
const modelLines = modelProtocol.agentExchanges.flatMap((exchange) => exchange.dialogueTurns || []).map((turn) => turn.line);
for (const line of modelLines) {
  assert.ok(!blueprintLines.includes(line), `the model route cannot replay a worldbuilding line: ${line}`);
}

console.log("worldSeedDoesNotWriteDialogue:test passed", { opening: opening.utterance, response: response.utterance, modelLines });
