import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { buildObservationEvents } from "../src/ui/render.js";

const state = structuredClone(initialState);
const draft = {
  id: "draft_canonical_novel",
  createdAt: "2026-07-10T10:00:00.000Z",
  locationId: state.locations[0].id,
  participantIds: state.characters.slice(0, 2).map((character) => character.id),
  novelText: "雨落在铜盘上。\n\n沈珩说：“把契牌留下。”",
  surfaceEvent: "雨落在铜盘上。",
  sceneText: "旧场景又说了一遍：把契牌留下。",
  agentOutputs: [{ visibleAction: "旧动作通道：把契牌留下。" }],
  sceneInteraction: {
    agentExchanges: [{ dialogueTurns: [{ speakerName: "沈珩", line: "把契牌留下。" }] }],
  },
};

const events = buildObservationEvents(draft, state);
const visible = events.map((event) => event.text).join("\n");
assert.equal((visible.match(/把契牌留下/g) || []).length, 1, "the final observer must keep one canonical prose channel");
assert.doesNotMatch(visible, /旧场景|旧动作通道/, "legacy scene/action text must stay internal when novelText exists");
assert.equal(events.length, 2, "blank-line manuscript paragraphs should remain readable paragraphs");

console.log("finalNovelCanonicalObserver:test passed", { paragraphs: events.length });
