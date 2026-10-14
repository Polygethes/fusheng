import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { buildObservationEvents } from "../src/ui/render.js";

const state = structuredClone(initialState);
state.ui.activeTab = "observe";
state.ui.timeGrain = "day";
state.ui.focusMode = "ambient";
state.ui.selectedLocationId = "loc_gregor_room";

const ticks = [
  ["tick_room_morning", "上午", "loc_gregor_room", "格里高尔房间", ["char_gregor", "char_grete", "char_father"]],
  ["tick_table_noon", "中午", "loc_parlor", "家庭餐桌", ["char_grete", "char_father", "char_mother"]],
  ["tick_office_afternoon", "下午", "loc_office_counter", "公司柜台", ["char_father", "char_mother", "char_gregor"]],
  ["tick_room_evening", "傍晚", "loc_gregor_room", "格里高尔房间", ["char_gregor", "char_grete", "char_father"]],
  ["tick_table_night", "夜间", "loc_parlor", "家庭餐桌", ["char_grete", "char_father", "char_mother"]],
].map(([id, label, locationId, locationName, participantIds], index) => ({
  id,
  label,
  resolution: index === 0 ? "focused_scene" : "background",
  locationId,
  locationName,
  participantIds,
  agentOutputs: participantIds.slice(0, 2).map((characterId, outputIndex) => ({
    characterId,
    targetCharacterId: participantIds[(outputIndex + 1) % participantIds.length],
    visibleAction: "私人模拟",
  })),
}));

const draft = {
  id: "draft_no_static_fallback_loop",
  createdAt: "2026-06-29T05:40:00.000Z",
  locationId: "loc_gregor_room",
  participantIds: ["char_gregor", "char_grete", "char_father", "char_mother"],
  periodSimulation: { ticks },
};

const events = buildObservationEvents(draft, state);
const actionBeats = events.flatMap((event) => event.beats || []).filter((beat) => beat.type === "action");

function uniqueActionsFor(actorId) {
  return new Set(actionBeats.filter((beat) => beat.actorId === actorId).map((beat) => beat.text));
}

assert.ok(uniqueActionsFor("char_gregor").size >= 2, "Gregor fallback actions should change across the day");
assert.ok(uniqueActionsFor("char_grete").size >= 3, "Grete fallback actions should not repeat the same door-board action all day");
assert.ok(uniqueActionsFor("char_father").size >= 2, "Father fallback actions should progress beyond pressing the account book");

const feedText = actionBeats.map((beat) => beat.text).join("\n");
assert.ok(!/格蕾特.*把手放在门板上.*\n.*格蕾特.*把手放在门板上/s.test(feedText), "Grete should not repeat the same fallback action in multiple ticks");
assert.ok(!/父亲.*把账本按到桌面上.*\n.*父亲.*把账本按到桌面上/s.test(feedText), "Father should not repeat the same fallback action in multiple ticks");

console.log("observerNoStaticFallbackLoop:test passed", {
  gregor: [...uniqueActionsFor("char_gregor")],
  grete: [...uniqueActionsFor("char_grete")],
  father: [...uniqueActionsFor("char_father")],
});
