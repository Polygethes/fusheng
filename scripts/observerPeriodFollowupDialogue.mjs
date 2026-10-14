import assert from "node:assert/strict";
import { buildObservationEvents } from "../src/ui/render.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

state.ui.timeGrain = "day";
state.ui.focusMode = "ambient";
state.ui.activeTab = "observe";

const actor = state.characters[0];
const target = state.characters[1];
const location = state.locations[0];

const draft = {
  id: "draft_period_followup_dialogue",
  createdAt: "2026-07-07T08:55:00.000Z",
  locationId: location.id,
  participantIds: [actor.id, target.id],
  periodSimulation: {
    ticks: [
      {
        id: "tick_period_followup_dialogue",
        label: "上午",
        resolution: "focused_scene",
        locationId: location.id,
        locationName: location.name,
        participantIds: [actor.id, target.id],
        agentOutputs: [],
        sceneInteraction: {
          agentExchanges: [
            {
              sourceCharacterId: actor.id,
              responseCharacterId: target.id,
              sourceCharacterName: actor.name,
              responseCharacterName: target.name,
              sharedObject: "灵契",
              eventOutcome: `${actor.name}把灵契留在铜盘边，${target.name}没有把符拿走。`,
              dialogueTurns: [
                {
                  speakerId: actor.id,
                  speakerName: actor.name,
                  targetId: target.id,
                  targetName: target.name,
                  line: "按城法扣契，不按宗门私仇。",
                  turnRole: "claim",
                },
                {
                  speakerId: target.id,
                  speakerName: target.name,
                  targetId: actor.id,
                  targetName: actor.name,
                  line: "我押的是灵契，不是命。",
                  turnRole: "response",
                },
                {
                  speakerId: actor.id,
                  speakerName: actor.name,
                  targetId: target.id,
                  targetName: target.name,
                  line: "剑可以停，证据不能走。",
                  turnRole: "counter",
                },
                {
                  speakerId: target.id,
                  speakerName: target.name,
                  targetId: actor.id,
                  targetName: actor.name,
                  line: "你要谁替你盖印？",
                  turnRole: "turn",
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

assert.match(text, /“你要谁替你盖印？”/, "period observer prose should include the fourth relationship follow-up turn");
assert.match(text, new RegExp(`${actor.name}.*${target.name}`), "period observer prose should name the actual exchange participants");
assert.doesNotMatch(text, /有人靠近|另一个人没有让开/, "period observer prose should not fall back to generic people when an agent exchange names participants");
assert.ok(
  beats.some((beat) => beat.type === "dialogue" && beat.speakerId === target.id && /你要谁替你盖印/.test(beat.text)),
  "period observer stage beats should include the fourth relationship follow-up turn",
);

console.log("observerPeriodFollowupDialogue:test passed", {
  text,
  beatCount: beats.length,
});
