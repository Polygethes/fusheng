import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildObservationEvents } from "../src/ui/render.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

state.ui.timeGrain = "day";
state.ui.focusMode = "location";
state.ui.selectedLocationId = "loc_xianxia_contract_gate";
state.ui.activeTab = "observe";

const draft = playNext(state);
const events = buildObservationEvents(draft, state);
const actionText = events
  .filter((event) => event.movementSource === "period-tick" && event.locationId === state.ui.selectedLocationId)
  .map((event) => event.text || "")
  .join("\n");

const quotedLines = [...actionText.matchAll(/说：“([^”]+)”/g)].map((match) => match[1]);
const firstClauses = quotedLines.map((line) => line.split(/[，。；]/)[0]).filter(Boolean);

assert.ok(quotedLines.length >= 3, "the focused scene should contain a substantial spoken exchange");
assert.doesNotMatch(actionText, /你说[^，。；]{1,12}/, "dialogue should not use the fixed '你说 X' response formula");
assert.doesNotMatch(actionText, /这件东西也得留在这里|也得留在这里/, "dialogue should not rely on generic retention formula");
assert.doesNotMatch(actionText, /这件东西/, "dialogue should name the concrete object instead of saying this thing");
assert.ok(new Set(firstClauses).size >= 3, "dialogue openings should vary inside the focused exchange");

console.log("dialogueFreeformNaturalness:test passed", {
  sample: quotedLines.slice(0, 6),
});
