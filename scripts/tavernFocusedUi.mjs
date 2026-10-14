import assert from "node:assert/strict";
import { renderApp } from "../src/ui/render.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.setupCompleted = true;
state.ui.activeTab = "reality";
state.ui.engineMode = "local";
state.tavernState.eventThreads = [{
  id: "ui_thread",
  topic: "今晚是否需要进米",
  status: "open",
  participantIds: ["char_xyy_xieheng", "char_xyy_xiemu"],
  nextObligationCharacterId: "char_xyy_xieheng",
  turns: [],
}];
state.branches = [{ id: "branch_main", title: "主线", snapshot: {} }];

const realityHtml = renderApp(state);
assert.match(realityHtml, /固定舞台/);
assert.match(realityHtml, /第1日|第一日|开场日/);
assert.match(realityHtml, /热饭\s*18/);
assert.match(realityHtml, /谢家经营/);
assert.match(realityHtml, /谢恒东家/);
assert.match(realityHtml, /谢母掌柜/);
assert.match(realityHtml, /1条未完事务/);
assert.match(realityHtml, /今晚是否需要进米/);
assert.match(realityHtml, /规则预演/);
assert.doesNotMatch(realityHtml, /data-key="focusMode"/);
assert.doesNotMatch(realityHtml, /data-key="selectedLocationId"/);
assert.doesNotMatch(realityHtml, />全镇</);

state.ui.activeTab = "setup";
state.ui.setupStep = "world";
state.ui.setupWorldPrompt = "";
state.ui.setupPeoplePrompt = "";
const setupHtml = renderApp(state);
assert.match(setupHtml, /望梯酒馆/);
assert.match(setupHtml, /逍遥游/);
assert.doesNotMatch(setupHtml, /《变形记》|《西游记》|《三国》|《教父》|仙侠中立城/);

console.log("tavernFocusedUi:test passed");
