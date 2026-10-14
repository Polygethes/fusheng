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

state.characterMemories = [];
state.relationships = [{
  id: "rel_location_only_dialogue",
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
  unspoken: "沈珩还没承认那次拦渡已经越过了执律边界。",
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
state.ui.activeTab = "observe";
state.ui.selectedLocationId = "loc_xianxia_contract_gate";

const draft = playNext(state);
const pairedTick = draft.periodSimulation?.ticks?.find((tick) =>
  tick.participantIds?.includes(shen.id) && tick.participantIds?.includes(aoji.id)
);

assert.ok(pairedTick, "hot relationship lastDialogue should pull both characters into a period tick");
assert.equal(
  pairedTick.locationId,
  "loc_xianxia_ferry",
  "lastDialogue.locationName/locationId should pull the next unresolved encounter back to that exact place even without characterMemories",
);

const outputUsingRelationship = (pairedTick.agentOutputs || []).find((output) =>
  output.characterId === shen.id && output.targetCharacterId === aoji.id
);
assert.ok(outputUsingRelationship, "the relationship owner should act toward the remembered target");
assert.match(
  `${outputUsingRelationship.relationshipPressureSummary || ""} ${outputUsingRelationship.desireReason || ""}`,
  /归墟渡/,
  "the agent should read the remembered location as part of the unresolved relationship",
);

console.log("periodRelationshipLastDialogueLocationOnly:test passed", {
  tick: pairedTick.label,
  location: pairedTick.locationName,
  participants: pairedTick.participantIds,
});
