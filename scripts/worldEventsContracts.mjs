// 天意 — player world events (spec §10): the world settles a weather change,
// a thing appearing, a message or a small mishap like any other fact; only
// those who perceive it receive evidence (rain reaches people outdoors, not
// indoors); the journal records it as a player world event and the observer
// marks it 天意. Built-in worlds refuse only the weather.
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateWorldEvent, settleWorldEvent, zoneIsOutdoor } from "../src/server/simulation/worldEvents.mjs";
import { compileBlueprint } from "../src/worlds/compiler/index.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { buildObserverFeed } from "../src/server/observer/observerFeed.mjs";
import { reconcileSettledTurnRecords } from "../src/server/simulation/settledSimulationReport.mjs";
import jiexing from "../src/worlds/jiexing/pack.mjs";

const blueprint = JSON.parse(fs.readFileSync("scripts/fixtures/blueprints/river_town.json", "utf8"));
const { pack } = compileBlueprint(blueprint, { seed: 1 });
const make = (worldPack) => createWorldRuntimeV27(buildPlayableWorldFromPack(worldPack), { worldPack, pacingMode: "scene", characterIds: worldPack.stage.sceneCast,
  characterAgentCallMode: "performance", runStage: async () => ({ performance: { thought: "", say: { to: "", text: "", loud: false }, do: { type: "wait", target: "", person: "", minutes: 10 }, gesture: "" } }) });
const instance = make(pack);
const runtime = instance.runtime;
const state = () => runtime.coordinator.worldState;
const place = Object.values(state().places)[0];

// Indoors and outdoors.
assert.equal(zoneIsOutdoor(place, "street_1"), true);
assert.equal(zoneIsOutdoor(place, "river_pier__bank"), true);
assert.equal(zoneIsOutdoor(place, "iron_forge__shop"), false);

// Validation.
assert.equal(validateWorldEvent(state(), { kind: "boom" })[0].field, "kind");
assert.equal(validateWorldEvent(state(), { kind: "weather", weather: "tornado" })[0].field, "weather");
assert.deepEqual(validateWorldEvent(state(), { kind: "message", toCharacterId: "nobody", text: "" }).map((row) => row.field), ["toCharacterId", "text"]);
assert.ok(validateWorldEvent(state(), { kind: "object", label: "", zoneId: "nowhere" }).length >= 2);
await assert.rejects(() => runtime.applyWorldEvent({ kind: "weather", weather: "tornado" }), (error) => error.code === "WORLD_EVENT_INVALID");
const builtIn = make(jiexing);
assert.equal(validateWorldEvent(builtIn.runtime.coordinator.worldState, { kind: "weather", weather: "rain" })[0].field, "weather");

// Rain: people outdoors receive it and get their next beat; people indoors do not.
const outdoors = Object.values(state().entities).filter((row) => row.kind === "character" && zoneIsOutdoor(place, row.zoneId)).map((row) => row.id).sort();
const indoors = Object.values(state().entities).filter((row) => row.kind === "character" && !zoneIsOutdoor(place, row.zoneId)).map((row) => row.id);
assert.ok(outdoors.length >= 1 && indoors.length >= 1);
const versionBefore = runtime.coordinator.journal.worldVersion;
const rain = await runtime.applyWorldEvent({ kind: "weather", weather: "rain" });
assert.equal(rain.source, "player");
assert.equal(runtime.coordinator.journal.worldVersion, versionBefore + 1);
assert.equal(runtime.coordinator.journal.events.at(-1).type, "world_event");
assert.equal(state().places[place.id].perceptionEnvironment.weather, "rain");
assert.deepEqual(rain.deliveries.map((row) => row.recipientCharacterId).sort(), outdoors);
for (const id of outdoors) {
  const actor = runtime.actors.get(id);
  assert.ok(actor.mailbox.some((wake) => (wake.evidence || []).some((row) => row.eventKind === "weather")), `${id} outdoors notices the rain`);
}
for (const id of indoors) {
  const actor = runtime.actors.get(id);
  assert.ok(!actor.mailbox.some((wake) => (wake.evidence || []).some((row) => row.eventKind === "weather")), `${id} indoors does not`);
}

// A thing appears where some can see it; a message reaches one person; a mishap changes an object.
const letter = await runtime.applyWorldEvent({ kind: "object", label: "一封没署名的信", zoneId: "street_8", description: "信封上沾着泥。" });
const letterId = Object.keys(state().objects).find((id) => state().objects[id].label === "一封没署名的信");
assert.ok(letterId, "the thing exists in the world");
assert.equal(state().objects[letterId].zoneId, "street_8");
assert.ok(letter.deliveries.every((row) => row.eventKind === "object_appeared"));
const message = await runtime.applyWorldEvent({ kind: "message", toCharacterId: "char_river_town_tie_kui", text: "官船提前到了。", from: "渡口的人" });
assert.deepEqual(message.deliveries.map((row) => row.recipientCharacterId), ["char_river_town_tie_kui"]);
assert.equal(message.deliveries[0].directed, true);
await runtime.applyWorldEvent({ kind: "accident", objectId: "river_town_iron_forge_anvil", stateKey: "ready", value: false, description: "铁砧上裂开一道缝。" });
assert.equal(state().objects.river_town_iron_forge_anvil.state.ready, false);

// Nothing here speaks for anyone.
for (const event of runtime.coordinator.journal.events.filter((row) => row.type === "world_event")) {
  assert.equal(event.actorId, "");
  assert.ok(!JSON.stringify(event.publicPayload).includes("utterance"), "a world event carries no speech");
}

// The observer shows each as 天意.
const checkpoint = await runtime.checkpoint();
const feed = buildObserverFeed({ checkpoint, settledTurns: reconcileSettledTurnRecords(checkpoint) }, pack);
const marked = feed.frames.filter((frame) => frame.type === "world" && frame.kind === "world_event");
assert.equal(marked.length, 4);
assert.ok(marked.every((frame) => frame.source === "player" && frame.caption));
for (const one of [instance, builtIn]) for (const actor of one.runtime.actors.values()) await actor.close?.();

// The pure settlement agrees with what the runtime committed.
const settled = settleWorldEvent(state(), { kind: "weather", weather: "clear" }, { eventId: "probe" });
assert.equal(settled.operations[0].value.weather, "clear");

console.log("World events passed: validated, settled as world facts, delivered only to those who perceive them, journaled and shown as 天意.");
