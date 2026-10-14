import assert from "node:assert/strict";
import { characterAgent } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

const shen = state.characters.find((item) => item.id === "char_xianxia_shenheng");
const aoji = state.characters.find((item) => item.id === "char_xianxia_aoji");
const azhao = state.characters.find((item) => item.id === "char_xianxia_azhao");
assert.ok(shen && aoji && azhao, "test characters should exist");

const firstDialogue = {
  source: "agent-dialogue-relationship",
  relationshipSource: "agent-exchange",
  sharedObject: "铜铃",
  eventOutcome: "铜铃留在两人中间。",
  finalTurn: "铃声停了，话还没完。",
  followupTurn: "你记住的是城规，还是我刚才的停顿？",
  dialogueTurnCount: 4,
  locationId: "loc_xianxia_ferry",
  locationName: "归墟渡",
  periodSlot: "上午",
  updatedAt: "2026-07-07T08:00:00.000Z",
};
const secondDialogue = {
  source: "agent-dialogue-relationship",
  relationshipSource: "agent-exchange",
  sharedObject: "渡令",
  eventOutcome: "渡令被压回湿冷的石阶。",
  finalTurn: "人可以退，渡令不走。",
  followupTurn: "你刚才问的是城规，现在渡令先别换手。",
  dialogueTurnCount: 4,
  locationId: "loc_xianxia_ferry",
  locationName: "归墟渡",
  periodSlot: "中午",
  updatedAt: "2026-07-07T09:00:00.000Z",
};

state.relationships = [{
  id: "rel_agent_reads_dialogue_history",
  projectId: state.project.id,
  fromCharacterId: shen.id,
  toCharacterId: aoji.id,
  resentment: 94,
  wantsToBeSeen: 82,
  fear: 25,
  dependence: 10,
  protection: 0,
  revenge: 52,
  deception: 22,
  wantsToEscape: 12,
  misreading: "沈珩把敖霁每一次留物都听成拖延。",
  unspoken: "沈珩知道这已经不是单次争执。",
  dialogueHistory: [firstDialogue, secondDialogue],
  lastDialogue: secondDialogue,
}];

const output = characterAgent({
  state,
  character: shen,
  activeCharacters: [shen, aoji, azhao],
  location: state.locations.find((item) => item.id === "loc_xianxia_ferry"),
});

const summary = `${output.relationshipPressureSummary || ""} ${output.desireReason || ""}`;
assert.match(summary, /连续|两轮|两次/, "agent should perceive repeated relationship history, not only the latest turn");
assert.match(summary, /铜铃/, "agent summary should retain the earlier dialogue object");
assert.match(summary, /渡令/, "agent summary should retain the latest dialogue object");

console.log("relationshipDialogueHistoryInfluencesAgent:test passed", {
  summary: output.relationshipPressureSummary,
});
