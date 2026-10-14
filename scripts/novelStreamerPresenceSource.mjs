import assert from "node:assert/strict";
import { buildCanonicalSceneSource } from "../src/server/pipeline/novelStreamer.mjs";

const source = buildCanonicalSceneSource({
  selectedLocation: { id: "hall", name: "法契门" },
  activeCharacters: [{ id: "shen", name: "沈珩" }, { id: "yan", name: "阎无咎" }, { id: "lu", name: "鹿青萝" }],
}, {
  surfaceEvent: "证人的名字落在铜盘上。",
  interactionBeats: [],
  agentExchanges: [],
  presenceChanges: [{
    characterId: "yan",
    characterName: "阎无咎",
    decision: "leave",
    destinationId: "alley",
    destinationName: "后巷",
    trigger: "沈珩说出证人的名字。",
    visibleDeparture: "阎无咎撞开侧门，退进雨里的后巷。",
  }],
  remainingCastAftermath: [{
    characterIds: ["shen", "lu"],
    beat: "门合上后，鹿青萝把魔印推回沈珩面前。",
    dialogue: "鹿青萝说：“现在轮到你解释名字从哪里来。”",
  }],
});

assert.match(source.departures[0].text, /撞开侧门/);
assert.equal(source.departures[0].destinationName, "后巷");
assert.match(source.aftermath[0].beat, /鹿青萝把魔印推回沈珩/);

console.log("novelStreamerPresenceSource:test passed", { departures: source.departures.length });
