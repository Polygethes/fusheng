import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { renderApp } from "../src/ui/render.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const state = clone(initialState);
state.ui.activeTab = "diff";
state.ui.activeBranchId = "branch_main";
state.project.activeBranchId = "branch_main";
state.ui.diffBaseBranchId = "branch_main";
state.ui.diffCompareBranchId = "branch_alt";

const altCharacters = clone(state.characters).map((character) => {
  if (character.id !== "char_lin") return character;
  return {
    ...character,
    currentState: {
      ...character.currentState,
      desire: character.currentState.desire + 17,
      rage: character.currentState.rage + 13,
      selfDeception: character.currentState.selfDeception - 9,
    },
    actionLines: {
      ...character.actionLines,
      shadow: `${character.actionLines.shadow} 她开始把被看见的位置反过来用作试探。`,
    },
  };
});

const altRelationships = clone(state.relationships).map((rel) => {
  if (rel.fromCharacterId === "char_lin" && rel.toCharacterId === "char_shen") {
    return {
      ...rel,
      resentment: rel.resentment + 22,
      wantsToBeSeen: rel.wantsToBeSeen + 18,
      misreading: "她把他的撤退读成更隐秘的召唤，同时也把这种召唤视为可惩罚的弱点。",
    };
  }
  return rel;
});

state.branches = [
  {
    id: "branch_main",
    projectId: state.project.id,
    title: "主线",
    parentBranchId: null,
    canonEventIds: [],
    draftSceneIds: [],
    stateMode: "isolated",
    snapshotSchemaVersion: 1,
    snapshot: {
      characters: clone(state.characters),
      relationships: clone(state.relationships),
      canonEvents: [],
      draftScenes: [],
      rumors: [],
      evidence: [],
      secrets: [],
      irreversibleTraces: [],
    },
    note: "默认正史线。",
  },
  {
    id: "branch_alt",
    projectId: state.project.id,
    title: "林澄反向操控线",
    parentBranchId: "branch_main",
    canonEventIds: ["canon_alt_1"],
    draftSceneIds: [],
    stateMode: "isolated",
    snapshotSchemaVersion: 1,
    snapshot: {
      characters: altCharacters,
      relationships: altRelationships,
      canonEvents: [{ id: "canon_alt_1", title: "林澄把修订记录交给第三方", summary: "她既自保，也让教师失去解释权。" }],
      draftScenes: [],
      rumors: [{ id: "rumor_alt_1", content: "有人说那些批注不像批注。", distortion: "把精神关系粗暴简化成不伦传闻。" }],
      evidence: [{ id: "evidence_alt_1", content: "九页修订记录", canBeMisreadAs: "私人通信" }],
      secrets: [],
      irreversibleTraces: [{ id: "trace_alt_1", content: "林澄第一次主动改变外界叙事。" }],
    },
    note: "测试分支差异视图。",
  },
];
state.project.branchIds = state.branches.map((branch) => branch.id);

const html = renderApp(state);
assert.match(html, /分支差异视图/);
assert.match(html, /人物状态差异/);
assert.match(html, /关系张力差异/);
assert.match(html, /林澄/);
assert.match(html, /B 新增/);
assert.match(html, /九页修订记录/);
console.log("branch diff render test passed");
