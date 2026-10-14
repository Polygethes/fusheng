import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { renderApp } from "../src/ui/render.js";
import { OBSERVATION_EXPLANATION_BANLIST } from "../src/worldbuilding/skills.js";

const state = structuredClone(initialState);
state.ui.timeGrain = "day";
state.ui.focusMode = "location";
state.ui.selectedLocationId = "loc_gregor_room";
state.ui.activeTab = "observe";

const gregor = state.characters.find((character) => character.id === "char_gregor");
const grete = state.characters.find((character) => character.id === "char_grete");
gregor.currentState = {
  ...(gregor.currentState || {}),
  desire: 72,
  shame: 88,
  selfDeception: 74,
  rage: 26,
  revengeImpulse: 10,
  protectionImpulse: 28,
};
grete.currentState = {
  ...(grete.currentState || {}),
  desire: 58,
  shame: 46,
  selfDeception: 36,
  rage: 18,
  revengeImpulse: 4,
  protectionImpulse: 84,
};

const draft = {
  id: "draft_observer_character_state",
  createdAt: "2026-06-29T01:00:00.000Z",
  locationId: "loc_gregor_room",
  participantIds: ["char_gregor", "char_grete"],
  periodSimulation: {
    ticks: [
      {
        id: "tick_room_state",
        label: "上午",
        resolution: "focused_scene",
        locationId: "loc_gregor_room",
        locationName: "格里高尔房间",
        participantIds: ["char_gregor", "char_grete"],
        agentOutputs: [
          {
            characterId: "char_gregor",
            targetCharacterId: "char_grete",
            tone: "惩罚",
            realtimePublicGoal: "守住上班人的身份",
            visibleAction: "格里高尔贴近门缝，低声说：“我马上就好。”",
          },
          {
            characterId: "char_grete",
            targetCharacterId: "char_gregor",
            tone: "保护",
            realtimePublicGoal: "拖住门外的决定",
            visibleAction: "格蕾特把手放在门板上，没有推门。",
          },
        ],
      },
    ],
  },
};

state.draftScenes = [draft];
state.ui.lastDraftId = draft.id;
state.ui.observerPlayback = {
  draftId: draft.id,
  visibleCount: 1,
  totalCount: 1,
  status: "complete",
};

const html = renderApp(state);
const proseText = [...html.matchAll(/<p class="observer-prose-text">([\s\S]*?)<\/p>/g)]
  .map((match) => match[1].replace(/\s+/g, " ").trim())
  .join("\n");

assert.doesNotMatch(
  proseText,
  /绷着一层慌|急着护住身边的人|停在试探和退让之间|压着火气|等着被看见|(?:要|想|试图|希望|准备|必须)[^。；]{1,40}(?:身份|决定|目标|回应)/,
  `observer prose should not reveal inner state summaries, got:\n${proseText}`,
);
assert.match(proseText, /贴近门缝|门板|“我马上就好。”/, "observer prose should reveal state only through action and dialogue");
assert.ok(!/欲望\s*\d|羞耻\s*\d|rage|selfDeception|protectionImpulse|currentState|tone/.test(proseText), "state prose must not expose raw model state fields or numbers");
for (const term of OBSERVATION_EXPLANATION_BANLIST) {
  assert.ok(!proseText.includes(term), `observer character state prose should still forbid explanatory language: ${term}`);
}

console.log("observerCharacterState:test passed", {
  sample: proseText,
});
