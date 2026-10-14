import assert from "node:assert/strict";
import { playFromServer } from "../src/server/modelRouter.mjs";

const state = {
  project: { id: "proj_no_duplicate_dialogue", activeBranchId: "branch_main" },
  town: { name: "停剑城", summary: "四方法契门前，名字和灵契会改变证词归属。", recurringObjects: ["灵契"] },
  characters: [
    {
      id: "char_shen",
      name: "沈珩",
      publicIdentity: "执律剑修",
      defenseLanguage: ["那你要谁来盖印？"],
      actionVerbs: { visible: ["扣住"] },
      actionLines: { visible: "扣住灵契" },
      currentState: {},
      innerCourt: {},
      agentProfile: { leverageObject: "灵契", dialogueMoves: ["那你要谁来盖印？"] },
    },
    {
      id: "char_yan",
      name: "阎无咎",
      publicIdentity: "血河楼使者",
      defenseLanguage: ["我押的是灵契，不是命。"],
      actionVerbs: { visible: ["压住"] },
      actionLines: { visible: "压住魔印" },
      currentState: {},
      innerCourt: {},
      agentProfile: { leverageObject: "魔印", dialogueMoves: ["我押的是灵契，不是命。"] },
    },
  ],
  locations: [{
    id: "loc_contract_gate",
    name: "四方法契门",
    subtext: "界石照着灵契，盖印的人会决定证词归属。",
    likelyEvents: ["界石亮起"],
    frequentCharacters: ["char_shen", "char_yan"],
  }],
  relationships: [],
  characterMemories: [],
  characterPlans: [],
  rumors: [],
  evidence: [],
  irreversibleTraces: [],
  interventions: [],
  canonEvents: [],
  draftScenes: [],
  ui: {
    engineMode: "mock",
    timeGrain: "scene",
    focusMode: "location",
    selectedLocationId: "loc_contract_gate",
    activeCharacterIds: ["char_shen", "char_yan"],
    activeBranchId: "branch_main",
  },
};

const draft = await playFromServer(state, { mode: "mock", allowFallback: false });
const text = draft.sceneText || "";
const quotedLines = [...text.matchAll(/说：“([^”]+)”/g)].map((match) => match[1].replace(/[。！？…]+$/g, ""));
const counts = new Map();
for (const line of quotedLines) counts.set(line, (counts.get(line) || 0) + 1);
const duplicates = [...counts.entries()].filter(([, count]) => count > 1);

assert.deepEqual(
  duplicates,
  [],
  `focused scene text should not repeat the same spoken line as both agent output and exchange prose, got:\n${text}`,
);
assert.match(text, /沈珩说：“[^”]*那你要谁来盖印/, "scene text should still include the exchange dialogue");
assert.match(text, /阎无咎说：“/, "scene text should still include the responder dialogue");
assert.match(text, /扣住|按住|压到|推到/, "scene text should keep concrete actions after removing duplicate dialogue");

console.log("focusedSceneTextNoDuplicateDialogue:test passed", {
  quotedLines,
  sceneText: text,
});
