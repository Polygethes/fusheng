import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { renderApp } from "../src/ui/render.js";

const state = structuredClone(initialState);
state.ui.setupCompleted = true;
state.ui.engineMode = "openai";
state.ui.selectedCharacterId = state.characters[0].id;
const selected = state.characters[0];
state.ui.livePerformance = {
  runId: "run_novel",
  status: "running",
  phase: "writing",
  label: "正文正在写入",
  locationName: state.locations[0].name,
  agents: [],
  events: [{ type: "dialogue", speakerName: "旧通道", line: "这句话不该再显示。" }],
  novelText: "雨落在铜盘上。沈珩没有去擦。\n\n“把契牌留下。”",
  psychologyByCharacter: {
    [selected.id]: {
      characterId: selected.id,
      characterName: selected.name,
      heardLine: "把契牌留下。",
      speakerName: "沈珩",
      interpretation: "这不是命令，是一次逼迫。",
      feeling: "后颈发紧",
      bodyResponse: "指节抵住袖中的符。",
      privateThought: "他究竟知道了多少？",
      nextImpulse: "先问出证人的名字。",
    },
  },
};

state.ui.activeTab = "reality";
const reality = renderApp(state);
assert.match(reality, /雨落在铜盘上/, "reality should show the canonical manuscript while it is being written");
assert.equal((reality.match(/雨落在铜盘上/g) || []).length, 1, "the canonical prose should render exactly once");
assert.doesNotMatch(reality, /这句话不该再显示/, "legacy event cards should be suppressed once novel streaming begins");
assert.doesNotMatch(reality, /他究竟知道了多少/, "private reaction must never enter reality");

state.ui.activeTab = "psychology";
const psychology = renderApp(state);
assert.match(psychology, /把契牌留下/, "psychology should identify the current heard line");
assert.match(psychology, /他究竟知道了多少/, "psychology should show the character's immediate unspoken thought");
assert.match(psychology, /后颈发紧/, "psychology should show the felt response to the current dialogue");
assert.match(psychology, /先问出证人的名字/, "psychology should expose the next impulse formed by the exchange");

console.log("liveNovelPsychologyWorkspace:test passed");
