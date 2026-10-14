// 天意 in the built-in worlds, and 授意. The built-in worlds (借星, 逍遥游)
// are where the deep (three-call) mode runs, so a player could not reach them
// at all. A thing appearing, a message and a small mishap need only the
// world's zones, so they now work there; weather still needs to know which
// zones are outdoors, which only compiled towns say. 授意 gives one person a
// passing thought, felt from inside; nobody else perceives it, and what the
// person does with it is theirs. Both modes must actually show it to them.
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateWorldEvent, WORLD_EVENT_KINDS } from "../src/server/simulation/worldEvents.mjs";
import { compileBlueprint } from "../src/worlds/compiler/index.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { buildObserverFeed } from "../src/server/observer/observerFeed.mjs";
import { reconcileSettledTurnRecords } from "../src/server/simulation/settledSimulationReport.mjs";
import jiexing from "../src/worlds/jiexing/pack.mjs";

const WAIT = { performance: { thought: "", say: { to: "", text: "", loud: false }, do: { type: "wait", target: "", person: "", minutes: 10 }, gesture: "" } };
const make = (worldPack, mode, runStage) => createWorldRuntimeV27(buildPlayableWorldFromPack(worldPack), { worldPack, pacingMode: "scene",
  characterIds: worldPack.stage.sceneCast, characterAgentCallMode: mode, enableDayPlanning: false, runStage });
const closeAll = async (instance) => { for (const actor of instance.runtime.actors.values()) await actor.close?.(); };
const URGE = "很想把小满要去剑宗的事告诉何嫂";

assert.ok(WORLD_EVENT_KINDS.includes("urge"), "授意 is a world event kind");

// ── validation in a built-in world ──────────────────────────────────────
{
  const instance = make(jiexing, "performance", async () => WAIT);
  const state = instance.runtime.coordinator.worldState;
  assert.deepEqual(validateWorldEvent(state, { kind: "weather", weather: "rain" }).map((row) => row.field), ["weather"],
    "weather is refused on its own field: this world does not say which zones are outdoors");
  assert.match(validateWorldEvent(state, { kind: "weather", weather: "rain" })[0].message, /屋外/u);
  assert.deepEqual(validateWorldEvent(state, { kind: "object", label: "纸鸢", zoneId: "yard" }), []);
  assert.deepEqual(validateWorldEvent(state, { kind: "object", label: "纸鸢", zoneId: "nowhere" }).map((row) => row.field), ["zoneId"]);
  assert.deepEqual(validateWorldEvent(state, { kind: "message", toCharacterId: "char_jx_guxiaoman", text: "回来吃饭。" }), []);
  assert.deepEqual(validateWorldEvent(state, { kind: "accident", objectId: "jx_porridge_pot", stateKey: "spilled", value: true, description: "粥锅翻了。" }), []);
  assert.deepEqual(validateWorldEvent(state, { kind: "urge", toCharacterId: "char_jx_abao", text: URGE }), []);
  assert.deepEqual(validateWorldEvent(state, { kind: "urge", toCharacterId: "nobody", text: "" }).map((row) => row.field), ["toCharacterId", "text"]);
  assert.deepEqual(validateWorldEvent(state, { kind: "urge", toCharacterId: "char_jx_abao", text: "念".repeat(101) }).map((row) => row.field), ["text"],
    "a thought is short: at most 100 characters");
  await closeAll(instance);
}

// ── settlement and delivery in a built-in world ─────────────────────────
{
  const instance = make(jiexing, "performance", async () => WAIT);
  const runtime = instance.runtime;
  const state = () => runtime.coordinator.worldState;
  const placeId = Object.keys(state().places)[0];

  const kite = await runtime.applyWorldEvent({ kind: "object", label: "一只断了线的纸鸢", zoneId: "yard", description: "竹骨折了一根。" });
  const kiteId = Object.keys(state().objects).find((id) => state().objects[id].label === "一只断了线的纸鸢");
  assert.ok(kiteId, "the thing exists");
  assert.equal(state().objects[kiteId].zoneId, "yard");
  assert.equal(state().objects[kiteId].placeId, placeId, "it belongs to the place that has that zone");
  assert.ok(kite.deliveries.length >= 1 && kite.deliveries.every((row) => row.eventKind === "object_appeared"));

  const message = await runtime.applyWorldEvent({ kind: "message", toCharacterId: "char_jx_guxiaoman", text: "北坡阵眼昨夜有光。", from: "村口的货郎" });
  assert.deepEqual(message.deliveries.map((row) => row.recipientCharacterId), ["char_jx_guxiaoman"]);

  await runtime.applyWorldEvent({ kind: "accident", objectId: "jx_porridge_pot", stateKey: "spilled", value: true, description: "粥锅翻了，粥洒了一地。" });
  assert.equal(state().objects.jx_porridge_pot.state.spilled, true);

  const urge = await runtime.applyWorldEvent({ kind: "urge", toCharacterId: "char_jx_abao", text: URGE });
  assert.deepEqual(urge.deliveries.map((row) => row.recipientCharacterId), ["char_jx_abao"], "only the person given the thought has it");
  assert.equal(urge.deliveries[0].eventKind, "urge");
  assert.equal(urge.deliveries[0].modality, "proprioception", "a thought is felt from inside, not seen or heard");
  assert.ok(urge.deliveries[0].content.includes(URGE));
  assert.ok(urge.committedFacts.some((row) => row.kind === "urge_given" && row.toCharacterId === "char_jx_abao"));
  for (const [id, actor] of runtime.actors) {
    const hasIt = actor.mailbox.some((wake) => (wake.evidence || []).some((row) => row.eventKind === "urge"));
    assert.equal(hasIt, id === "char_jx_abao", `${id} ${id === "char_jx_abao" ? "has" : "does not have"} the thought`);
  }

  for (const event of runtime.coordinator.journal.events.filter((row) => row.type === "world_event")) {
    assert.equal(event.actorId, "");
    assert.ok(!JSON.stringify(event.publicPayload).includes("utterance"), "a world event carries no speech, a thought included");
  }

  const checkpoint = await runtime.checkpoint();
  const feed = buildObserverFeed({ checkpoint, settledTurns: reconcileSettledTurnRecords(checkpoint) }, jiexing);
  const marked = feed.frames.filter((frame) => frame.type === "world" && frame.kind === "world_event");
  assert.equal(marked.length, 4);
  assert.ok(marked.every((frame) => frame.source === "player" && frame.caption));
  const urgeFrame = marked.find((frame) => frame.worldEventKind === "urge");
  assert.match(urgeFrame.caption, /授意/u);
  assert.ok(urgeFrame.caption.includes("阿宝") && urgeFrame.caption.includes(URGE), "the observer sees whom and what");
  await closeAll(instance);
}

// ── the person really meets it, in both modes ───────────────────────────
for (const mode of ["three-call", "performance"]) {
  for (const [who, event, text] of [
    ["char_jx_abao", { kind: "urge", toCharacterId: "char_jx_abao", text: URGE }, URGE],
    ["char_jx_guxiaoman", { kind: "message", toCharacterId: "char_jx_guxiaoman", text: "北坡阵眼昨夜有光。", from: "村口的货郎" }, "北坡阵眼昨夜有光"],
  ]) {
    const inputs = [];
    const stop = Object.assign(new Error("contract stop"), { code: "CONTRACT_STOP" });
    const instance = make(jiexing, mode, async (input) => { inputs.push(input); if (mode === "performance") return WAIT; throw stop; });
    await instance.runtime.applyWorldEvent(event);
    for (let i = 0; i < 12 && !inputs.some((row) => row.characterId === who); i++) {
      try { await instance.runtime.runNext(); } catch (error) { if (error.code !== "CONTRACT_STOP") throw error; }
    }
    const first = inputs.find((row) => row.characterId === who);
    assert.ok(first, `${mode}: ${who} gets a turn after the event`);
    assert.ok(JSON.stringify(first).includes(text), `${mode}: ${who}'s first stage input (${first.phase}) contains what the player sent`);
    await closeAll(instance);
  }
}

// ── 授意 works in a compiled town too ───────────────────────────────────
{
  const { pack } = compileBlueprint(JSON.parse(fs.readFileSync("scripts/fixtures/blueprints/river_town.json", "utf8")), { seed: 1 });
  const instance = make(pack, "performance", async () => WAIT);
  const urge = await instance.runtime.applyWorldEvent({ kind: "urge", toCharacterId: "char_river_town_tie_kui", text: "想去渡口看看官船到了没有" });
  assert.deepEqual(urge.deliveries.map((row) => row.recipientCharacterId), ["char_river_town_tie_kui"]);
  await closeAll(instance);
}

console.log("World events in built-in worlds passed: things, messages and mishaps reach the deep-mode worlds, weather waits for outdoor zones, and 授意 gives one person a private thought both modes show.");
