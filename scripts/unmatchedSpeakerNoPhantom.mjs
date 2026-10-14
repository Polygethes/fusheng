import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { buildManuscriptTimelineEntries, buildLocalNewsBriefs } from "../src/ui/realityTimeline.js";
import { renderApp } from "../src/ui/render.js";

const gregor = initialState.characters.find((character) => character.id === "char_gregor");
const grete = initialState.characters.find((character) => character.id === "char_grete");
const turns = [{
  speakerId: gregor.id,
  speakerName: gregor.name,
  targetId: grete.id,
  targetName: grete.name,
  line: "我今天去不了。",
}];
const manuscript = "格里高尔贴着门说：“我今天去不了。”\n\n门外又传来一句：“账本还在楼下。”";
const entries = buildManuscriptTimelineEntries(manuscript, turns);
const attributed = entries.filter((entry) => entry.type === "dialogue");
const unmatched = entries.find((entry) => entry.type === "narration" && entry.text.includes("账本还在楼下"));

assert.equal(attributed.length, 1, "only a quotation matched to a real turn may become a speaker node");
assert.equal(attributed[0].speakerId, gregor.id);
assert.ok(unmatched, "an unmatched quotation should remain visible as unattributed prose");
assert.match(unmatched.text, /“账本还在楼下。”/, "unmatched prose should preserve its quotation marks");

const state = structuredClone(initialState);
state.ui.setupCompleted = true;
state.ui.activeTab = "reality";
state.ui.engineMode = "openai";
state.ui.livePerformance = {
  runId: "run_partial_unknown",
  status: "error",
  phase: "writing",
  errorKind: "model_stage",
  errorStage: "novel_streamer",
  label: "正文中断 · 现场已保留",
  locationName: state.locations[0].name,
  agents: [{ characterId: gregor.id, characterName: gregor.name, status: "speaking" }],
  events: [{ type: "dialogue", ...turns[0] }],
  novelText: manuscript,
  psychologyByCharacter: {},
};
state.ui.lastPlayError = "writer interrupted";
const html = renderApp(state);
assert.match(html, /账本还在楼下/, "partial unmatched prose should remain visible after an error");
assert.doesNotMatch(html, /data-pixel-name="人物"/, "error rendering must never invent a generic portrait");
assert.doesNotMatch(html, /data-speaker-id="character"/, "error rendering must never invent a generic speaker id");

const malformedDraft = {
  id: "malformed_news",
  periodSimulation: {
    ticks: [{
      id: "malformed_tick",
      order: 1,
      label: "上午",
      locationId: state.locations[0].id,
      locationName: state.locations[0].name,
      slotFocus: "门外传来声音",
      agentOutputs: [],
      sceneInteraction: { agentExchanges: [{ dialogueTurns: [{ line: "没有人知道是谁说的。" }], eventOutcome: "门仍然关着。" }] },
    }],
  },
};
assert.equal(buildLocalNewsBriefs(malformedDraft, state, 1)[0].dialogue.length, 0, "malformed local turns must not materialize an unknown cast member");

console.log("unmatchedSpeakerNoPhantom:test passed");
