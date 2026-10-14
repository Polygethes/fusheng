import assert from "node:assert/strict";
import { buildAgentCognitiveFrame } from "../src/engine/cognitiveLoop.js";
import { buildUpdateBundle } from "../src/engine/stateUpdater.js";

const location = { id: "loc_square", name: "中央广场" };
const characters = [
  {
    id: "char_a",
    name: "甲",
    currentLocationId: location.id,
    currentActivity: {
      id: "activity_a",
      description: "清点摊位上的药瓶",
      locationId: location.id,
      remainingTicks: 2,
      status: "active",
    },
  },
  { id: "char_b", name: "乙", currentLocationId: location.id },
  { id: "char_c", name: "丙", currentLocationId: location.id },
];

const baseState = {
  project: { id: "project_cognitive", activeBranchId: "branch_main" },
  town: { name: "测试城" },
  characters,
  locations: [location],
  relationships: [],
  characterMemories: [],
  characterPlans: [],
  ui: { activeBranchId: "branch_main" },
};

const quietSimulations = [
  {
    characterId: "char_a",
    targetCharacterId: "char_b",
    currentActivity: "清点摊位上的药瓶",
    activityDurationTicks: 3,
    reactionIntent: "continue",
    reactionReason: "乙只是从广场经过，没有妨碍清点。",
    presenceIntent: "stay",
  },
  {
    characterId: "char_b",
    targetCharacterId: "char_a",
    currentActivity: "把货单送去城门",
    activityDurationTicks: 2,
    reactionIntent: "continue",
    reactionReason: "送货时间更紧。",
    presenceIntent: "stay",
  },
  {
    characterId: "char_c",
    targetCharacterId: "char_a",
    currentActivity: "离开广场去码头",
    activityDurationTicks: 1,
    reactionIntent: "leave",
    reactionReason: "潮水已经涨到第三阶。",
    presenceIntent: "leave",
    exitUrgency: 90,
    exitResistance: 20,
  },
];

const quiet = buildAgentCognitiveFrame({
  state: baseState,
  location,
  activeCharacters: characters,
  privateSimulations: quietSimulations,
});

assert.equal(quiet.conversations.length, 0, "co-location must not automatically create dialogue");
assert.equal(quiet.decisions.find((item) => item.characterId === "char_a")?.reaction, "continue");
assert.equal(quiet.decisions.find((item) => item.characterId === "char_c")?.reaction, "leave");
assert.equal(quiet.activities.find((item) => item.characterId === "char_a")?.id, "activity_a", "an unfinished activity should continue across ticks");
assert.equal(quiet.activities.find((item) => item.characterId === "char_a")?.remainingTicks, 1, "continuing an activity should consume one tick");

const talkSimulations = quietSimulations.map((simulation) => ({ ...simulation }));
Object.assign(talkSimulations[0], {
  reactionIntent: "talk",
  reactionTargetCharacterId: "char_b",
  reactionReason: "乙拿走了甲正在清点的最后一瓶药。",
  conversationObjective: "问清药瓶要送到哪里",
  conversationEndCondition: "乙说明药瓶的去向，或拒绝回答并离开",
});
Object.assign(talkSimulations[1], {
  reactionIntent: "respond",
  reactionTargetCharacterId: "char_a",
});

const collision = buildAgentCognitiveFrame({
  state: baseState,
  location,
  activeCharacters: characters,
  privateSimulations: talkSimulations,
});

assert.equal(collision.conversations.length, 1, "only the initiated pair should enter a conversation");
assert.equal(collision.conversations[0].sourceCharacterId, "char_a");
assert.equal(collision.conversations[0].responseCharacterId, "char_b");
assert.match(collision.conversations[0].endCondition, /说明|拒绝|离开/);
assert.equal(collision.decisions.find((item) => item.characterId === "char_c")?.reaction, "leave", "a third character must keep its own action");

const activityPatch = buildUpdateBundle({
  id: "draft_activity",
  projectId: baseState.project.id,
  branchId: "branch_main",
  locationId: location.id,
  participantIds: ["char_a"],
  agentOutputs: [{
    characterId: "char_a",
    currentActivity: quiet.activities.find((item) => item.characterId === "char_a"),
    selfDeceptionSentence: "我只是在清点。",
  }],
  relationshipShift: [],
  irreversibleTraces: [],
}, { ...baseState, evidence: [], rumors: [], irreversibleTraces: [] });
assert.equal(activityPatch.characters[0]?.currentActivity?.id, "activity_a", "the activity must be written back for the next tick");

console.log("smallvilleCognitiveLoop:test passed", {
  quietReactions: quiet.decisions.map((item) => `${item.characterId}:${item.reaction}`),
  conversation: collision.conversations[0],
});
