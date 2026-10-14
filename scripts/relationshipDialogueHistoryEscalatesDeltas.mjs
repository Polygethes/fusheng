import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

const shen = state.characters.find((item) => item.id === "char_xianxia_shenheng");
const aoji = state.characters.find((item) => item.id === "char_xianxia_aoji");
assert.ok(shen && aoji, "test characters should exist");

const dialogueHistory = [
  {
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
  },
  {
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
  },
];

state.characterMemories = [];
state.relationships = [{
  id: "rel_history_escalates_deltas",
  projectId: state.project.id,
  fromCharacterId: shen.id,
  toCharacterId: aoji.id,
  resentment: 88,
  wantsToBeSeen: 78,
  fear: 25,
  dependence: 10,
  protection: 0,
  revenge: 45,
  deception: 22,
  wantsToEscape: 12,
  misreading: "沈珩把敖霁每一次留物都听成拖延。",
  unspoken: "沈珩知道这已经不是单次争执。",
  dialogueHistory,
  lastDialogue: dialogueHistory.at(-1),
}];

state.ui.timeGrain = "day";
state.ui.focusMode = "ambient";
state.ui.activeTab = "observe";
state.ui.selectedLocationId = "loc_xianxia_contract_gate";

const draft = playNext(state);
const shift = (draft.relationshipShift || []).find((item) =>
  item.generatedFrom === "agent-dialogue-relationship"
  && item.fromCharacterId === shen.id
  && item.toCharacterId === aoji.id
);

assert.ok(shift, "history-pulled pair should create a dialogue relationship shift");
assert.equal(
  shift.relationshipMomentum?.historyCount,
  2,
  "relationship shift should record that repeated dialogue history intensified this turn",
);
assert.ok(
  Number(shift.deltas?.resentment || 0) >= 5 || Number(shift.deltas?.wantsToBeSeen || 0) >= 5,
  "repeated unresolved dialogue should increase the magnitude of relationship deltas",
);
assert.match(
  shift.relationshipMomentum?.reason || "",
  /连续|历史|没结清|铜铃|渡令/,
  "relationship momentum should explain which repeated unresolved history intensified the shift",
);

console.log("relationshipDialogueHistoryEscalatesDeltas:test passed", {
  deltas: shift.deltas,
  momentum: shift.relationshipMomentum,
});
