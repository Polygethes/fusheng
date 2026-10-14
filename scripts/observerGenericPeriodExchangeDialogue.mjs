import assert from "node:assert/strict";
import { buildObservationEvents } from "../src/ui/render.js";
import { initialState } from "../src/data/seed.js";

const state = structuredClone(initialState);
state.ui.activeTab = "observe";
state.ui.timeGrain = "day";
state.ui.focusMode = "location";
state.worldSetup = { ...(state.worldSetup || {}), generatedBySkills: false };

const actor = state.characters.find((character) => character.id === "char_gregor");
const target = state.characters.find((character) => character.id === "char_grete");
const location = state.locations.find((item) => item.id === "loc_gregor_room") || state.locations[0];

const draft = {
  id: "draft_generic_period_exchange_dialogue",
  createdAt: "2026-07-07T09:20:00.000Z",
  locationId: location.id,
  participantIds: [actor.id, target.id],
  periodSimulation: {
    ticks: [
      {
        id: "tick_generic_period_exchange_dialogue",
        label: "上午",
        resolution: "focused_scene",
        locationId: location.id,
        locationName: location.name,
        participantIds: [actor.id, target.id],
        agentOutputs: [
          {
            characterId: actor.id,
            targetCharacterId: target.id,
            visibleAction: `${actor.name}把话递到门缝边。`,
            realtimePublicGoal: "解释自己还会赶上车。",
          },
          {
            characterId: target.id,
            targetCharacterId: actor.id,
            visibleAction: `${target.name}把手停在门板上。`,
            realtimePublicGoal: "确认门后的人还听得见。",
          },
        ],
        sceneInteraction: {
          agentExchanges: [
            {
              sourceCharacterId: actor.id,
              responseCharacterId: target.id,
              sourceCharacterName: actor.name,
              responseCharacterName: target.name,
              sharedObject: "门缝",
              eventOutcome: `${target.name}没有推门，钥匙停在锁孔半圈。`,
              dialogueTurns: [
                {
                  speakerId: actor.id,
                  speakerName: actor.name,
                  targetId: target.id,
                  targetName: target.name,
                  line: "我马上就好。",
                  turnRole: "claim",
                },
                {
                  speakerId: target.id,
                  speakerName: target.name,
                  targetId: actor.id,
                  targetName: actor.name,
                  line: "你先别开门。",
                  turnRole: "response",
                },
                {
                  speakerId: actor.id,
                  speakerName: actor.name,
                  targetId: target.id,
                  targetName: target.name,
                  line: "车次还来得及。",
                  turnRole: "counter",
                },
              ],
            },
          ],
        },
      },
    ],
  },
};

const events = buildObservationEvents(draft, state);
const tickEvent = events.find((event) => event.movementSource === "period-tick");
const text = tickEvent?.text || "";
const beats = tickEvent?.beats || [];

assert.match(text, /“我马上就好。”/, "generic period observer prose should include the initiating exchange dialogue");
assert.match(text, /“你先别开门。”/, "generic period observer prose should include the responder exchange dialogue");
assert.match(text, /钥匙停在锁孔半圈/, "generic period observer prose should include the exchange outcome");
assert.ok(
  beats.some((beat) => beat.type === "dialogue" && beat.speakerId === actor.id && /我马上就好/.test(beat.text)),
  "generic period stage beats should still include the structured dialogue",
);

console.log("observerGenericPeriodExchangeDialogue:test passed", {
  text,
  beatCount: beats.length,
});
