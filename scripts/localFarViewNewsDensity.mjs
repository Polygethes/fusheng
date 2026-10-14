import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { playNext } from "../src/engine/mockEngine.js";
import { renderApp } from "../src/ui/render.js";
import { buildLocalNewsBriefs } from "../src/ui/realityTimeline.js";

const state = structuredClone(initialState);
const originalRandom = Math.random;
Math.random = () => 0.18;
state.ui.setupCompleted = true;
state.ui.activeTab = "reality";
state.ui.engineMode = "local";
state.ui.timeGrain = "day";
state.ui.focusMode = "ambient";

const draft = playNext(state);
state.draftScenes = [draft];
state.ui.lastDraftId = draft.id;
state.ui.observerPlayback = {
  draftId: draft.id,
  visibleCount: draft.periodSimulation.ticks.length,
  totalCount: draft.periodSimulation.ticks.length,
  status: "complete",
};

const html = renderApp(state);
const briefs = html.match(/data-news-brief="true"/g) || [];
const actions = html.match(/data-news-action="true"/g) || [];
const dialogue = html.match(/data-news-dialogue="true"/g) || [];
const consequences = html.match(/data-news-consequence="true"/g) || [];
const quoteLines = [...html.matchAll(/：“([^”]+)”/g)].map((match) => match[1].replace(/[，,。！？!?；;：:\s]/g, ""));
const occurrences = [...html.matchAll(/<p class="news-occurrence">([^<]+)<\/p>/g)].map((match) => match[1].replace(/[。！？\s]/g, ""));
const speakerIds = [...html.matchAll(/data-speaker-id="([^"]+)"/g)].map((match) => match[1]);
const speakerCounts = speakerIds.reduce((counts, id) => counts.set(id, (counts.get(id) || 0) + 1), new Map());

assert.equal(briefs.length, 5, "a local day should render five far-view news anchors");
assert.equal(actions.length, briefs.length, "every local news brief must name one concrete actor action");
assert.equal(dialogue.length, briefs.length, "every local news brief must retain one attributed exchange");
assert.equal(consequences.length, briefs.length, "every local news brief must report one changed condition");
assert.ok((html.match(/data-speaker-id=/g) || []).length >= briefs.length, "each far-view quote should identify its speaker");
assert.equal(new Set(quoteLines).size, quoteLines.length, "a local day must not repeat the same reportable line");
assert.equal(new Set(occurrences).size, occurrences.length, "a repeated location must surface a different occurrence later in the day");
assert.ok(Math.max(...speakerCounts.values()) <= 3, "far-view reporting should rotate speakers when the town has enough alternatives");
assert.doesNotMatch(html, /<p class="news-action"[^>]*>\s*[”」』"]/, "compressed actions must not start with a dangling quote");
assert.doesNotMatch(html, /围着\S+停住/, "far-view news must not fall back to generic gathering prose");
assert.doesNotMatch(html, /低精度|后台运行|行动候选|关系数值/, "news briefs must remain diegetic");

const cast = state.characters.slice(0, 6);
const repeatedPair = cast.slice(0, 2);
const rotatingPairs = [[cast[2], cast[3]], [cast[4], cast[5]], [cast[2], cast[4]], [cast[3], cast[5]], [cast[2], cast[5]]];
const rotationDraft = {
  id: "rotation_fixture",
  periodSimulation: {
    ticks: rotatingPairs.map((pair, index) => ({
      id: `rotation_${index}`,
      order: index + 1,
      label: ["上午", "中午", "下午", "傍晚", "夜间"][index],
      locationId: state.locations[0].id,
      locationName: state.locations[0].name,
      slotFocus: "门口出现异响",
      agentOutputs: [{ characterId: pair[0].id, visibleAction: `${pair[0].name}把钥匙压到门边。` }],
      sceneInteraction: {
        agentExchanges: [
          fixtureExchange(repeatedPair[0], repeatedPair[1], index, "旧账"),
          fixtureExchange(pair[0], pair[1], index, "钥匙"),
        ],
      },
    })),
  },
};
const rotatedBriefs = buildLocalNewsBriefs(rotationDraft, state, 5);
const rotatedSpeakers = rotatedBriefs.flatMap((brief) => brief.dialogue.map((turn) => turn.speakerId));
const rotatedCounts = rotatedSpeakers.reduce((counts, id) => counts.set(id, (counts.get(id) || 0) + 1), new Map());
assert.ok(Math.max(...rotatedCounts.values()) <= 3, "the reporter should choose a fresher real exchange instead of repeating the first pair");
assert.equal(new Set(rotatedBriefs.map((brief) => brief.occurrence)).size, 5, "the reporter should rotate occurrences when revisiting one location");

Math.random = originalRandom;
console.log("localFarViewNewsDensity:test passed", { briefs: briefs.length });

function fixtureExchange(source, target, index, object) {
  return {
    sharedObject: object,
    dialogueTurns: [
      { speakerId: source.id, speakerName: source.name, targetId: target.id, targetName: target.name, line: `${object}第${index + 1}次留在门边，你先别拿。` },
      { speakerId: target.id, speakerName: target.name, targetId: source.id, targetName: source.name, line: `我只回答${object}为什么还在这里。` },
    ],
    eventOutcome: `${object}没有被带走；${target.name}把它留在门边。`,
  };
}
