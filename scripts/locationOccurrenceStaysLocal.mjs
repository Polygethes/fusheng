import assert from "node:assert/strict";
import { buildObservationEvents } from "../src/ui/render.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

const gate = state.locations.find((location) => location.name === "四方法契门");
const market = state.locations.find((location) => location.name === "无咎市");
const court = state.locations.find((location) => location.name === "照骨司");
const makeTick = (id, label, location, participantIds = []) => ({
  id,
  label,
  locationId: location.id,
  locationName: location.name,
  participantIds,
  agentOutputs: [],
  sceneInteraction: { agentExchanges: [] },
  backgroundEvents: [],
  surfaceEvent: `${label}，${location.name}留下痕迹`,
  synthesized: { irreversibleTraces: [] },
});

const draft = {
  id: "draft_location_occurrence_locality",
  periodSimulation: {
    ticks: [
      makeTick("tick_market_1", "上午", market),
      makeTick("tick_court_2", "中午", court),
      makeTick("tick_gate_3", "下午", gate, state.characters.slice(0, 3).map((character) => character.id)),
    ],
  },
};

const gateEvent = buildObservationEvents(draft, state).find((event) => event.locationId === gate.id);
const opening = String(gateEvent?.text || "").split(/[。！？]/)[0];

assert.ok(gateEvent, "fixture should render the contract-gate period event");
assert.match(opening, /界石|灵契|契牌|铜盘|锁灵索/, `contract-gate opening should use contract-gate props, got:\n${opening}`);
assert.doesNotMatch(opening, /茶盏|停剑令|妖丹盒|药炉|渡令/, `contract-gate opening must not borrow another location's props, got:\n${opening}`);

console.log("locationOccurrenceStaysLocal:test passed", { opening });
