import assert from "node:assert/strict";
import { buildObservationEvents } from "../src/ui/render.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

state.ui.timeGrain = "scene";
state.ui.focusMode = "location";
state.ui.activeTab = "observe";
state.ui.selectedLocationId = state.locations[0].id;

const actor = state.characters[0];
const target = state.characters[1];
const location = state.locations[0];

const draft = {
  id: "draft_scene_agent_exchange_dialogue",
  createdAt: "2026-07-07T08:50:00.000Z",
  locationId: location.id,
  participantIds: [actor.id, target.id],
  sceneText: "铜盘前停了一下。",
  agentOutputs: [],
  sceneInteraction: {
    agentExchanges: [
      {
        sourceCharacterId: actor.id,
        responseCharacterId: target.id,
        sourceCharacterName: actor.name,
        responseCharacterName: target.name,
        sharedObject: "灵契",
        eventOutcome: `${actor.name}把灵契扣在铜盘里，${target.name}没有把符拿走。`,
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
        ],
      },
    ],
  },
};

const events = buildObservationEvents(draft, state);
const prose = events.map((event) => event.text).join("\n");
const beats = events.flatMap((event) => event.beats || []);

assert.match(prose, /“按城法扣契，不按宗门私仇。”/, "single-scene observer prose should include structured exchange dialogue");
assert.match(prose, /“我押的是灵契，不是命。”/, "single-scene observer prose should include responder dialogue");
assert.match(prose, /灵契扣在铜盘|没有把符拿走/, "single-scene observer prose should include the exchange outcome");
assert.ok(
  beats.some((beat) => beat.type === "dialogue" && beat.speakerId === actor.id),
  "single-scene observer stage beats should include initiating dialogue",
);
assert.ok(
  beats.some((beat) => beat.type === "dialogue" && beat.speakerId === target.id),
  "single-scene observer stage beats should include responding dialogue",
);

console.log("observerSceneAgentExchangeDialogue:test passed", {
  prose,
  beatCount: beats.length,
});
