import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { renderApp } from "../src/ui/render.js";

const state = structuredClone(initialState);
state.ui.timeGrain = "day";
state.ui.focusMode = "location";
state.ui.selectedLocationId = "loc_gregor_room";
state.ui.activeTab = "observe";

const draft = {
  id: "draft_observer_novel_prose",
  createdAt: "2026-06-29T01:00:00.000Z",
  locationId: "loc_gregor_room",
  participantIds: ["char_gregor", "char_grete"],
  periodSimulation: {
    ticks: [
      {
        id: "tick_room",
        label: "上午",
        resolution: "focused_scene",
        locationId: "loc_gregor_room",
        locationName: "格里高尔房间",
        participantIds: ["char_gregor", "char_grete"],
        agentOutputs: [
          {
            characterId: "char_gregor",
            targetCharacterId: "char_grete",
            visibleAction: "格里高尔贴近门缝，低声说：“我马上就好。”",
          },
          {
            characterId: "char_grete",
            targetCharacterId: "char_gregor",
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
  status: "playing",
};

const html = renderApp(state);
const proseRows = html.match(/data-observer-prose="true"/g) || [];
const proseTexts = [...html.matchAll(/<p class="observer-prose-text">([\s\S]*?)<\/p>/g)]
  .map((match) => match[1].replace(/\s+/g, " ").trim());
const forbiddenObserverLabels = [
  "observer-line-meta",
  "observer-beats",
  "data-observer-beats",
  "observer-time",
  "observer-kind",
  "observer-location",
  ">远景<",
  ">近景<",
  "事件流",
];

assert.ok(html.includes('data-observer-window="true"'), "observe tab should still render the realtime observation window");
assert.equal(proseRows.length, 1, "observer playback should render visible events as novel-like prose paragraphs");
assert.equal(proseTexts.length, proseRows.length, "each prose event should have exactly one paragraph");
for (const text of proseTexts) {
  assert.ok(text.length < 360, "observer prose paragraphs should stay readable instead of expanding into beat logs");
}
assert.equal(countOccurrences(proseTexts[0], "贴近门缝"), 1, "observer prose should not repeat the same visible action from the stage beats");
assert.equal(countOccurrences(proseTexts[0], "我马上就好"), 1, "observer prose should not repeat dialogue already present in the event sentence");
assert.ok(!proseTexts[0].includes("格蕾特把手放在门板上"), "observer prose should not expand into per-character action beat logs");
assert.ok(!proseTexts[0].includes("。”。"), "observer prose should not add extra punctuation after quoted speech");
for (const label of forbiddenObserverLabels) {
  assert.ok(!html.includes(label), `observer prose should not expose structured event label: ${label}`);
}
assert.ok(/“[^”]+”/.test(html), "dialogue should remain visible inside prose when the event contains speech");
assert.ok(!/低精度|后台运行|行动候选|自主计划|stage beat|beat-level/.test(html), "observer prose must not leak engine or staging language");

console.log("observerNovelProse:test passed", {
  proseRows: proseRows.length,
  draftId: draft.id,
});

function countOccurrences(text, fragment) {
  return String(text || "").split(fragment).length - 1;
}
