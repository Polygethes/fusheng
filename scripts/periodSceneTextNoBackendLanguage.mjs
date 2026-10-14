import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

function makeState(focusMode = "ambient") {
  const state = buildPlayableWorldFromSetup({
    setupWorldPrompt: "赛博朋克海底避难城，氧气被公司征税，潮汐闸、黑市码头和祈祷舱互相牵制。",
    setupPeoplePrompt: "潜水员走私者、公司监察官、合成圣女、老工程师、黑市医生。",
  });
  state.ui.timeGrain = "day";
  state.ui.focusMode = focusMode;
  state.ui.activeTab = "observe";
  state.ui.selectedLocationId = state.locations.find((location) => /潮汐闸|黑市|祈祷/.test(location.name))?.id || state.locations[0]?.id;
  state.ui.userDirective = "运行整座小镇一天；未被盯住的位置只留下可见痕迹，盯住的位置展开成一场戏。";
  return state;
}

const ambientDraft = playNext(makeState("ambient"));
const focusedDraft = playNext(makeState("location"));
const text = [ambientDraft.sceneText, focusedDraft.sceneText].join("\n\n");

assert.ok(ambientDraft.periodSimulation?.ticks?.length >= 4, "ambient day should still run multiple time slots");
assert.ok(new Set(ambientDraft.periodSimulation.ticks.map((tick) => tick.locationId)).size >= 2, "ambient day should move through multiple locations, not one repeated stage");
assert.ok(focusedDraft.periodSimulation?.ticks?.some((tick) => tick.resolution === "focused_scene"), "focused day should still include a scene-level tick");
assert.ok(focusedDraft.periodSimulation?.ticks?.some((tick) => tick.resolution === "background"), "focused day should keep other locations moving");

assert.doesNotMatch(
  text,
  /低精度|后台运行|后台动作|表面执行|私人压力|镇级偏移|完整场景|聚焦场景|未被观察|被观察|运行：|执行“/,
  `period draft sceneText should be readable observation prose, not engine log text, got:\n${text}`,
);
assert.match(text, /上午|中午|下午|傍晚|夜间/, `period text should keep time passing, got:\n${text}`);
assert.match(text, /潮汐闸|黑市码头|祈祷舱|藻类工厂|赛博朋克海底避难城/, `period text should keep place movement visible, got:\n${text}`);
assert.match(text, /氧气|潮汐|祈祷|藻类|鱼人|凭证|记录|账/, `period text should preserve world objects and traces, got:\n${text}`);
// This used to require staged dialogue (`说：“`) in the focused scene.  The
// deterministic path no longer stages speech: it had no generator to give a
// character a voice, only fixed string banks, so the lines were slogans wearing
// quotation marks.  The surviving requirement is that a focused scene still
// resolves into something concrete rather than collapsing into a summary.
assert.doesNotMatch(
  focusedDraft.sceneText,
  /说：“/,
  `the deterministic path must not stage speech, got:\n${focusedDraft.sceneText}`,
);
assert.ok(
  String(focusedDraft.sceneText || "").trim().length >= 40,
  `focused period text should still render a concrete scene, got:\n${focusedDraft.sceneText}`,
);
assert.doesNotMatch(
  text,
  /([\u4e00-\u9fa5A-Za-z0-9]{2,12})被推到\1的明处/,
  `period text should not repeat the same place or object around 明处, got:\n${text}`,
);

console.log("periodSceneTextNoBackendLanguage:test passed", {
  ambientTicks: ambientDraft.periodSimulation.ticks.length,
  focusedTicks: focusedDraft.periodSimulation.ticks.filter((tick) => tick.resolution === "focused_scene").length,
  sample: focusedDraft.sceneText.slice(0, 600),
});
