import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { renderApp } from "../src/ui/render.js";

const state = structuredClone(initialState);
const gregor = state.characters.find((character) => character.id === "char_gregor");
const grete = state.characters.find((character) => character.id === "char_grete");
state.ui.setupCompleted = true;
state.ui.activeTab = "reality";
state.ui.engineMode = "openai";
state.ui.livePerformance = {
  runId: "run_live_portraits",
  status: "running",
  phase: "writing",
  label: "正文正在写入",
  locationName: "格里高尔房间",
  agents: [
    { characterId: gregor.id, characterName: gregor.name, status: "speaking" },
    { characterId: grete.id, characterName: grete.name, status: "observing" },
  ],
  events: [
    { type: "dialogue", speakerId: gregor.id, speakerName: gregor.name, targetId: grete.id, targetName: grete.name, line: "我今天去不了。" },
    { type: "dialogue", speakerId: grete.id, speakerName: grete.name, targetId: gregor.id, targetName: gregor.name, line: "那我去叫母亲？" },
    { type: "dialogue", speakerId: "legacy", speakerName: "旧通道", line: "这句不在正文里。" },
  ],
  novelText: "钥匙在门外转了半圈。\n\n格里高尔贴着门板说：“我今天去不了。”\n\n格蕾特没有松手：“那我去叫母亲？”",
  psychologyByCharacter: {},
};

const html = renderApp(state);
assert.match(html, /data-live-reality-timeline="true"/, "live writing should use the speaker-aware timeline");
assert.match(html, new RegExp(`data-speaker-id="${gregor.id}"`), "live dialogue should display Gregor's portrait marker");
assert.match(html, new RegExp(`data-speaker-id="${grete.id}"`), "live dialogue should display Grete's portrait marker");
assert.equal((html.match(/我今天去不了/g) || []).length, 1, "live speaker treatment must not duplicate manuscript dialogue");
assert.doesNotMatch(html, /这句不在正文里/, "event dialogue absent from the manuscript must stay suppressed");

console.log("liveSpeakerPortraitTimeline:test passed");
