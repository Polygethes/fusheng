import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { buildObservationEvents } from "../src/ui/render.js";

const state = structuredClone(initialState);
state.ui.timeGrain = "day";
state.ui.focusMode = "location";
state.ui.selectedLocationId = "loc_gregor_room";
state.ui.activeTab = "observe";

const draft = {
  id: "draft_observer_no_intent_summary",
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
        visiblePressure: "门外有人停住脚步。",
        agentOutputs: [
          {
            characterId: "char_gregor",
            targetCharacterId: "char_grete",
            tone: "伪装",
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

const events = buildObservationEvents(draft, state);
const text = events.map((event) => event.text).join("\n");

assert.ok(events.length, "fixture should produce observer events");
assert.doesNotMatch(
  text,
  /(?:要|想|试图|希望|准备|必须)[^。；]{1,40}(?:身份|决定|目标|回应)|绷着一层慌|停在试探和退让之间|急着护住身边的人|压着火气|等着被看见/,
  `observer prose should not expose intent or inner-state summaries, got:\n${text}`,
);
assert.match(
  text,
  /贴近门缝|门板|钥匙|车次|“我马上就好。”/,
  `observer prose should still show observable action and dialogue, got:\n${text}`,
);

const sceneDraft = {
  id: "draft_observer_scene_no_intent_summary",
  createdAt: "2026-07-09T01:00:00.000Z",
  locationId: "loc_gregor_room",
  participantIds: ["char_gregor", "char_grete"],
  agentOutputs: [
    {
      characterId: "char_gregor",
      targetCharacterId: "char_grete",
      tone: "伪装",
      realtimePublicGoal: "守住上班人的身份",
      realtimePrivateDesire: "让妹妹继续替自己挡住门外的人",
      visibleAction: "格里高尔把车次表压在门缝下，没有把门打开。",
    },
    {
      characterId: "char_grete",
      targetCharacterId: "char_gregor",
      tone: "保护",
      realtimePublicGoal: "拖住门外的决定",
      realtimePrivateDesire: "逼哥哥承认他已经起不来",
      visibleAction: "格蕾特把钥匙攥在掌心，问他是否错过了第一班车。",
    },
  ],
  sceneInteraction: {
    agentExchanges: [{
      sourceCharacterId: "char_gregor",
      sourceCharacterName: "格里高尔",
      responseCharacterId: "char_grete",
      responseCharacterName: "格蕾特",
      sharedObject: "车次表",
      dialogueTurns: [
        { speakerId: "char_gregor", speakerName: "格里高尔", targetId: "char_grete", targetName: "格蕾特", line: "把经理留在客厅，我马上出来。", turnRole: "claim" },
        { speakerId: "char_grete", speakerName: "格蕾特", targetId: "char_gregor", targetName: "格里高尔", line: "第一班车已经走了，你先把门打开。", turnRole: "response" },
      ],
      eventOutcome: "车次表留在门缝下，钥匙仍在格蕾特手里。",
    }],
  },
  irreversibleTraces: ["车次表的一角被门缝压皱。"],
};
const sceneText = buildObservationEvents(sceneDraft, state).map((event) => event.text).join("\n");
assert.doesNotMatch(
  sceneText,
  /格里高尔要|格蕾特想|绷着一层慌|停在试探和退让之间|realtimePrivateDesire/,
  `a completed model scene must not fall back to intent exposition, got:\n${sceneText}`,
);
assert.match(sceneText, /车次表压在门缝下|第一班车已经走了|钥匙仍在格蕾特手里/);

console.log("observerProseNoIntentSummary:test passed", {
  sample: text,
});
