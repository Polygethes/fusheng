import assert from "node:assert/strict";
import { compactState } from "../src/server/pipeline/context.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

const shen = state.characters.find((item) => item.id === "char_xianxia_shenheng");
const aoji = state.characters.find((item) => item.id === "char_xianxia_aoji");
assert.ok(shen && aoji, "test characters should exist");

state.characterMemories = [];
state.relationships = [{
  id: "rel_model_context_location_only_dialogue",
  projectId: state.project.id,
  fromCharacterId: shen.id,
  toCharacterId: aoji.id,
  label: "旧案 / 城规",
  resentment: 92,
  wantsToBeSeen: 74,
  fear: 22,
  dependence: 5,
  revenge: 47,
  deception: 20,
  wantsToEscape: 18,
  unspoken: "沈珩还没承认那次阻拦已经越过了执律边界。",
  misreading: "沈珩把敖霁的沉默误读成拖延。",
  lastDialogue: {
    source: "agent-dialogue-relationship",
    relationshipSource: "agent-exchange",
    locationId: "loc_xianxia_ferry",
    locationName: "归墟渡",
    periodSlot: "傍晚",
    sharedObject: "铜铃",
    eventOutcome: "铜铃留在两人中间，敖霁没有收回那句话。",
    finalTurn: "铃声停了，话还没完。",
    followupTurn: "你记住的是城规，还是我刚才的停顿？",
    dialogueTurnCount: 4,
    updatedAt: new Date().toISOString(),
  },
}];

state.ui.timeGrain = "day";
state.ui.focusMode = "ambient";
state.ui.selectedLocationId = "loc_xianxia_contract_gate";
state.ui.activeCharacterIds = [
  "char_xianxia_shenheng",
  "char_xianxia_yanwujie",
  "char_xianxia_luqingluo",
];

const compact = compactState(state);

assert.equal(
  compact.selectedLocation.id,
  "loc_xianxia_ferry",
  "model compact state should move ambient/day simulation to the unresolved relationship's remembered location",
);
assert.ok(compact.activeCharacterIds.includes(shen.id), "model compact state should keep the relationship owner active");
assert.ok(compact.activeCharacterIds.includes(aoji.id), "model compact state should pull the remembered target into active characters");
assert.ok(
  compact.relationships.some((rel) => rel.fromCharacterId === shen.id && rel.toCharacterId === aoji.id && rel.lastDialogue?.locationName === "归墟渡"),
  "model compact state should include the relationship dialogue memory for the pulled pair",
);

console.log("modelCompactStateLastDialogueFocus:test passed", {
  location: compact.selectedLocation.name,
  activeCharacterIds: compact.activeCharacterIds,
});
