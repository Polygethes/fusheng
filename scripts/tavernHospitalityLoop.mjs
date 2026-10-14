import assert from "node:assert/strict";
import { playTavernLifeNext } from "../src/engine/tavernLifeEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.timeGrain = "week";

const draft = playTavernLifeNext(state);
const ticks = draft.periodSimulation?.ticks || [];
const events = ticks.flatMap((tick) => (tick.lifeEvents || []).map((event) => ({ ...event, tickLabel: tick.label })));
const arrivals = events.filter((event) => event.activityType === "arrive");
const hostActions = events.filter((event) => ["receive_guest", "serve_guest", "accept_delivery", "settle_visit", "refuse_service"].includes(event.activityType));
const departures = events.filter((event) => event.activityType === "depart");

assert.ok(arrivals.length >= 4, "named guests must actually visit during a week");
assert.ok(arrivals.every((event) => event.visitId && event.visitPurpose && event.situationalRole), "every arrival must carry purpose and role");
assert.ok(arrivals.every((event) => event.expectedHostIds?.length), "every guest must expect a responsible person");

assert.ok(hostActions.some((event) => event.activityType === "receive_guest"), "a host Agent must notice and receive a waiting guest");
assert.ok(hostActions.some((event) => event.activityType === "serve_guest"), "a host Agent must serve a guest instead of guests taking stock themselves");
assert.ok(hostActions.some((event) => event.activityType === "accept_delivery"), "a delivery must be accepted by an authorized Agent");
assert.ok(hostActions.every((event) => event.visitId && event.targetCharacterId), "hospitality actions must target one real visit and person");

const guestIds = new Set(arrivals.map((event) => event.characterId));
const unmediatedConsumption = events.filter((event) => guestIds.has(event.characterId) && ["eat", "drink"].includes(event.activityType) && !event.visitId);
assert.equal(unmediatedConsumption.length, 0, "guests cannot take meals or tea from shared stock without a visit transaction");

assert.ok(departures.length, "visits must eventually end");
assert.ok(departures.every((event) => event.visitId && event.visitOutcome), "departures must close or abandon a known visit");

const ledger = draft.updateBundle?.tavernState?.ledger || [];
assert.ok(ledger.some((entry) => ["sale", "credit", "work_exchange"].includes(entry.type)), "food or tea service must be settled");
assert.ok(ledger.some((entry) => entry.type === "delivery"), "accepted deliveries must enter the tavern ledger");
assert.ok(ledger.every((entry) => entry.visitId && entry.actorId), "ledger entries need Agent and visit provenance");

assert.match(draft.novelText, /东家|掌柜|店里|食客|住客|换饭|送药|名录/, "prose must establish people's relationship to the place");
assert.match(draft.novelText, /招呼|接过|端出|送到桌边|结账|记账|验收/, "prose must show hospitality or trade rather than a shared action room");

assert.ok((draft.updateBundle?.tavernState?.visits || []).length <= 24, "visit history must stay bounded");
assert.ok((draft.updateBundle?.tavernState?.activeVisits || []).length <= 6, "unfinished visits must stay bounded");

console.log("tavernHospitalityLoop:test passed", {
  arrivals: arrivals.length,
  hostActions: hostActions.map((event) => event.activityType),
  departures: departures.length,
  ledger: ledger.map((entry) => entry.type),
});
