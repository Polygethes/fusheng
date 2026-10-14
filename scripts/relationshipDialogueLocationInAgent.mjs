import assert from "node:assert/strict";
import { characterAgent } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

const shen = state.characters.find((item) => item.id === "char_xianxia_shenheng");
const aoji = state.characters.find((item) => item.id === "char_xianxia_aoji");
const yan = state.characters.find((item) => item.id === "char_xianxia_yanwujie");
assert.ok(shen && aoji && yan, "test characters should exist");

state.relationships = [{
  id: "rel_agent_reads_dialogue_location",
  projectId: state.project.id,
  fromCharacterId: shen.id,
  toCharacterId: aoji.id,
  resentment: 92,
  wantsToBeSeen: 78,
  fear: 30,
  dependence: 10,
  protection: 0,
  revenge: 48,
  deception: 22,
  wantsToEscape: 12,
  misreading: "沈珩把敖霁的水阵听成替血河楼开路。",
  unspoken: "沈珩还没决定敖霁的渡令是不是破禁证据。",
  lastDialogue: {
    source: "agent-dialogue-relationship",
    relationshipSource: "agent-exchange",
    sharedObject: "渡令",
    eventOutcome: "敖霁把渡令压回岸上，沈珩没有让水阵撤开。",
    finalTurn: "渡令先停，水阵不开。",
    followupTurn: "你扣的是渡令，还是龙裔的退路？",
    dialogueTurnCount: 4,
    locationId: "loc_xianxia_ferry",
    locationName: "归墟渡",
    periodSlot: "上午",
    updatedAt: new Date().toISOString(),
  },
}];

const output = characterAgent({
  state,
  character: shen,
  activeCharacters: [shen, aoji, yan],
  location: state.locations.find((item) => item.id === "loc_xianxia_ferry"),
});

assert.equal(output.targetCharacterId, aoji.id, "agent should target the relationship carrying the last dialogue");
assert.equal(output.relationshipDialogueMemory?.locationName, "归墟渡", "raw lastDialogue should expose location");
assert.match(
  `${output.relationshipPressureSummary || ""} ${output.desireReason || ""}`,
  /归墟渡/,
  "agent-facing relationship memory line should include where the unfinished dialogue happened",
);

console.log("relationshipDialogueLocationInAgent:test passed", {
  target: output.targetCharacterId,
  summary: output.relationshipPressureSummary,
});
