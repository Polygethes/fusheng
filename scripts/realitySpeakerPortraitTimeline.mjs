import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { renderApp } from "../src/ui/render.js";

const state = structuredClone(initialState);
state.ui.setupCompleted = true;
state.ui.activeTab = "reality";
state.ui.engineMode = "openai";

const gregor = state.characters.find((character) => character.id === "char_gregor");
const grete = state.characters.find((character) => character.id === "char_grete");
const draft = {
  id: "draft_speaker_timeline",
  createdAt: "2026-07-10T20:00:00.000Z",
  provider: "openai-pipeline",
  locationId: "loc_gregor_room",
  participantIds: [gregor.id, grete.id],
  novelText: "钥匙在门外转了半圈。\n\n格里高尔贴着门板说：“我今天去不了。”\n\n格蕾特没有松手：“那我去叫母亲？”",
  sceneInteraction: {
    agentExchanges: [{
      dialogueTurns: [
        { speakerId: gregor.id, speakerName: gregor.name, targetId: grete.id, targetName: grete.name, line: "我今天去不了。" },
        { speakerId: grete.id, speakerName: grete.name, targetId: gregor.id, targetName: gregor.name, line: "那我去叫母亲？" },
      ],
    }],
  },
};
state.draftScenes = [draft];
state.ui.lastDraftId = draft.id;
state.ui.observerPlayback = { draftId: draft.id, visibleCount: 3, totalCount: 3, status: "complete" };

const reality = renderApp(state);
assert.match(reality, /data-reality-timeline="true"/, "reality should use one vertical performance timeline");
assert.match(reality, /data-reality-axis="true"/, "the performance timeline should expose a continuous vertical axis");
assert.match(reality, new RegExp(`data-speaker-id="${gregor.id}"`), "Gregor's spoken line should carry his identity");
assert.match(reality, new RegExp(`data-speaker-id="${grete.id}"`), "Grete's spoken line should carry her identity");
assert.match(reality, new RegExp(`data-pixel-portrait="${gregor.id}"`), "a speaker should have a pixel portrait");
assert.equal((reality.match(/我今天去不了/g) || []).length, 1, "speaker attribution must not duplicate dialogue");
assert.equal((reality.match(/那我去叫母亲/g) || []).length, 1, "each spoken line should remain in the manuscript once");

state.ui.activeTab = "psychology";
state.ui.selectedCharacterId = gregor.id;
const psychology = renderApp(state);
for (const character of state.characters) {
  assert.match(psychology, new RegExp(`data-pixel-portrait="${character.id}"`), `character rail should give ${character.name} a stable pixel portrait`);
}

console.log("realitySpeakerPortraitTimeline:test passed");
