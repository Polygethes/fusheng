import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { playNext } from "../src/engine/mockEngine.js";
import { buildObservationEvents } from "../src/ui/render.js";

const state = structuredClone(initialState);
state.ui.engineMode = "mock";
state.ui.timeGrain = "day";
state.ui.focusMode = "location";
state.ui.selectedLocationId = "loc_lodgers_table";
state.ui.activeTab = "observe";

const draft = playNext(state);
const events = buildObservationEvents(draft, state);
const feedText = events.map((event) => `${event.kind} ${event.text}`).join("\n");
const forbiddenTerms = [
  "私人模拟",
  "低精度",
  "后台运行",
  "可见场所",
  "自主计划",
  "实时模拟",
  "行动候选",
  "suppressed",
  "selective",
  "weaponized",
];

assert.ok(events.length >= 5, "a day should still produce a town-wide event feed");
assert.ok(events.some((event) => event.kind === "近景"), "focused location should read as a close view, not an engine mode");
assert.ok(events.some((event) => event.kind === "远景"), "unfocused locations should read as distant events, not low-resolution internals");

for (const term of forbiddenTerms) {
  assert.ok(!feedText.includes(term), `observation feed should hide engine term: ${term}`);
}

assert.ok(feedText.includes("餐巾"), "focused event should include a concrete visible prop at the selected location");
assert.ok(/样布|账本|琴弓|缺勤记录|车票/.test(feedText), "background event should include a concrete prehistory prop elsewhere in town");
assert.ok(!feedText.includes("桌椅、门锁或托盘"), "background events should not reuse a generic prop list");
assert.ok(!feedText.includes("托盘"), "prehistory observation should not jump to later caregiver props");

console.log("observerDiegeticEvents:test passed", {
  events: events.length,
  kinds: [...new Set(events.map((event) => event.kind))],
});
