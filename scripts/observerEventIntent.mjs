import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { buildObservationEvents, renderApp } from "../src/ui/render.js";
import { OBSERVATION_EXPLANATION_BANLIST } from "../src/worldbuilding/skills.js";

const state = structuredClone(initialState);
state.ui.timeGrain = "day";
state.ui.focusMode = "location";
state.ui.selectedLocationId = "loc_gregor_room";
state.ui.activeTab = "observe";

const draft = {
  id: "draft_observer_event_intent",
  createdAt: "2026-06-29T01:00:00.000Z",
  locationId: "loc_gregor_room",
  participantIds: ["char_gregor", "char_grete"],
  periodSimulation: {
    ticks: [
      {
        id: "tick_room_intent",
        label: "上午",
        resolution: "focused_scene",
        locationId: "loc_gregor_room",
        locationName: "格里高尔房间",
        participantIds: ["char_gregor", "char_grete"],
        agentOutputs: [
          {
            characterId: "char_gregor",
            targetCharacterId: "char_grete",
            realtimePublicGoal: "守住上班人的身份",
            realtimePrivateDesire: "让格蕾特先站在自己这一边",
            wantsFromOthers: "希望格蕾特不要立刻开门。",
            visibleAction: "格里高尔贴近门缝，低声说：“我马上就好。”",
          },
          {
            characterId: "char_grete",
            targetCharacterId: "char_gregor",
            realtimePublicGoal: "拖住门外的决定",
            realtimePrivateDesire: "确认哥哥是否还把她当作唯一能帮忙的人",
            wantsFromOthers: "希望格里高尔给出一句可相信的话。",
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

const events = buildObservationEvents(draft, state);
const html = renderApp(state);
const proseText = [...html.matchAll(/<p class="observer-prose-text">([\s\S]*?)<\/p>/g)]
  .map((match) => match[1].replace(/\s+/g, " ").trim())
  .join("\n");

assert.equal(events.length, 1, "fixture should produce one observable event");
assert.doesNotMatch(
  proseText,
  /(?:要|想|试图|希望|准备|必须)[^。；]{1,40}(?:身份|决定|目标|回应)|绷着一层慌|停在试探和退让之间|急着护住身边的人/,
  `observer prose should not explain what characters are trying to do, got:\n${proseText}`,
);
assert.match(proseText, /门|车次|钥匙|门缝/, "observer prose should stay anchored in a concrete event");
assert.match(proseText, /“我马上就好。”/, "observer prose should keep visible dialogue");
assert.ok(!/realtimePublicGoal|realtimePrivateDesire|wantsFromOthers|hiddenAction|desireReason/.test(proseText), "observer prose must not expose model fields");
for (const term of OBSERVATION_EXPLANATION_BANLIST) {
  assert.ok(!proseText.includes(term), `observer intent prose should still forbid explanatory language: ${term}`);
}

console.log("observerEventIntent:test passed", {
  sample: proseText,
});
