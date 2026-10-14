import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { assignDialogueSides, buildSpeakerThoughtMap, speakerThoughtForEntry } from "../src/ui/realityTimeline.js";
import { renderApp } from "../src/ui/render.js";

const gregor = initialState.characters.find((character) => character.id === "char_gregor");
const grete = initialState.characters.find((character) => character.id === "char_grete");
const turns = [
  { type: "dialogue", speakerId: gregor.id, speakerName: gregor.name, targetId: grete.id, targetName: grete.name, text: "我今天去不了。" },
  { type: "dialogue", speakerId: grete.id, speakerName: grete.name, targetId: gregor.id, targetName: gregor.name, text: "那我去叫母亲？" },
  { type: "dialogue", speakerId: gregor.id, speakerName: gregor.name, targetId: grete.id, targetName: grete.name, text: "先别叫她。" },
];
const staged = assignDialogueSides(turns);
assert.deepEqual(staged.map((entry) => entry.side), ["left", "right", "left"], "a conversation pair should keep stable opposite sides");

const reactions = [
  { characterId: gregor.id, spokenLine: "我今天去不了。", heardLine: "", privateThought: "只要声音和平常一样，她就不会推门。", feeling: "侥幸" },
  { characterId: grete.id, spokenLine: "那我去叫母亲？", heardLine: "我今天去不了。", privateThought: "他在撒谎，还是病了？", feeling: "担心" },
  { characterId: gregor.id, spokenLine: "先别叫她。", heardLine: "那我去叫母亲？", privateThought: "再给我一分钟。", feeling: "羞耻" },
];
const thoughtMap = buildSpeakerThoughtMap(reactions);
assert.equal(thoughtMap.get(gregor.id).thought, "再给我一分钟。", "Gregor's portrait should receive only Gregor's thought");
assert.equal(thoughtMap.get(grete.id).thought, "他在撒谎，还是病了？", "Grete's portrait should receive only Grete's thought");
assert.equal(thoughtMap.get(gregor.id).moments.length, 2, "one character should retain a separate thought for each speaking moment");
assert.equal(speakerThoughtForEntry(thoughtMap, turns[0]).thought, "只要声音和平常一样，她就不会推门。", "the first line should resolve to the thought before that line");
assert.equal(speakerThoughtForEntry(thoughtMap, turns[2]).thought, "再给我一分钟。", "the later line should resolve to the changed thought before that line");

const state = structuredClone(initialState);
state.ui.setupCompleted = true;
state.ui.activeTab = "reality";
state.ui.engineMode = "openai";
const draft = {
  id: "draft_dialogue_stage",
  createdAt: "2026-07-10T22:00:00.000Z",
  provider: "openai-pipeline",
  locationId: "loc_gregor_room",
  participantIds: [gregor.id, grete.id],
  novelText: "格里高尔贴着门板说：“我今天去不了。”\n\n格蕾特没有松手：“那我去叫母亲？”\n\n格里高尔闭了闭眼：“先别叫她。”",
  dialoguePsychology: reactions,
  sceneInteraction: { agentExchanges: [{ dialogueTurns: turns.map((turn) => ({ ...turn, line: turn.text })) }] },
};
state.draftScenes = [draft];
state.ui.lastDraftId = draft.id;
state.ui.observerPlayback = { draftId: draft.id, visibleCount: 5, totalCount: 5, status: "complete" };

const html = renderApp(state);
assert.equal((html.match(/data-dialogue-side="left"/g) || []).length, 2, "both turns from the first speaker should stay on the left");
assert.equal((html.match(/data-dialogue-side="right"/g) || []).length, 1, "the interlocutor should speak from the right");
assert.match(html, new RegExp(`data-thought-owner="${gregor.id}"[^>]*[\\s\\S]*?再给我一分钟。`), "the left portrait should expose its own momentary thought");
assert.match(html, /只要声音和平常一样，她就不会推门/, "the first spoken line should carry its own thought");
assert.match(html, /再给我一分钟/, "the later spoken line should carry its changed thought");
assert.match(html, new RegExp(`data-thought-owner="${grete.id}"[^>]*[\\s\\S]*?他在撒谎，还是病了？`), "the right portrait should expose its own momentary thought");
assert.equal((html.match(/role="tooltip"/g) || []).length, 3, "each speaking moment should have an accessible hover/focus thought");

state.ui.livePerformance = {
  runId: "run_dialogue_stage",
  status: "running",
  phase: "writing",
  label: "正文正在写入",
  locationName: "格里高尔房间",
  agents: [],
  events: turns.map((turn) => ({ ...turn, type: "dialogue", line: turn.text })),
  novelText: draft.novelText,
  psychologyByCharacter: {
    [gregor.id]: reactions.filter((reaction) => reaction.characterId === gregor.id),
    [grete.id]: reactions.filter((reaction) => reaction.characterId === grete.id),
  },
};
const liveHtml = renderApp(state);
assert.match(liveHtml, /data-live-reality-timeline="true"/, "the live manuscript should share the two-sided stage");
assert.equal((liveHtml.match(/data-dialogue-side="left"/g) || []).length, 2, "live dialogue should preserve the first speaker's side");
assert.equal((liveHtml.match(/data-dialogue-side="right"/g) || []).length, 1, "live dialogue should preserve the interlocutor's side");
assert.match(liveHtml, /data-thought-owner="char_gregor"/, "live psychology should attach to the speaking portrait");

console.log("realityDialogueStage:test passed");
