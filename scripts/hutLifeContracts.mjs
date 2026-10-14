// Life in a hut, as 顾怀山 lived it in 雨夜入谷: a person sees how much water
// a jar or a bucket holds, can light a cold stove, reads what they just did in
// words rather than the world's codes, and knows the street outside a door is
// that house's doorstep. On the stage a person walks up to what they handle,
// comes in by the door, lies in bed when resting in a bedroom, and a stove
// shows fire only while it is lit.
import test from "node:test";
import assert from "node:assert/strict";
import { observeObjectPhysicalState, describeObjectPhysicalState } from "../src/server/simulation/objectPhysicalObservation.mjs";
import { loadWorldPack } from "../src/worlds/registry.mjs";
import { defineWorldPack } from "../src/worlds/worldPack.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { buildObserverFeed } from "../src/server/observer/observerFeed.mjs";
import { reconcileSettledTurnRecords } from "../src/server/simulation/settledSimulationReport.mjs";
import { flattenLayout } from "../src/worlds/layoutAtlas.mjs";
import { walkableTiles } from "../src/worlds/layoutGeometry.mjs";
import { createFixtureFire } from "../src/stage/fixtures.js";

// The stage draws on canvases; a stand-in is enough for its bookkeeping.
const ctx2d = new Proxy({}, { get: (target, key) => (key in target ? target[key] : () => ({ data: new Uint8ClampedArray(4) })), set: (target, key, value) => { target[key] = value; return true; } });
globalThis.document ||= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
const { createDirector } = await import("../src/stage/director.js");

const clone = (value) => JSON.parse(JSON.stringify(value));
const gu = "char_cangxinggu_gu_huaishan", du = "char_cangxinggu_du_popo";

test("a jar or a bucket says how much water it holds; a stove says whether it is lit", () => {
  const seen = (state) => describeObjectPhysicalState(observeObjectPhysicalState({ placeId: "p", zoneId: "z", state }, { id: "a", placeId: "p", zoneId: "z" }));
  assert.equal(seen({ water: 2, capacity: 4 }), "水：2/4 份");
  assert.equal(seen({ water: 0, capacity: 1 }), "水：空的（能装 1 份）");
  assert.equal(seen({ water: 4, capacity: 4 }), "水：4/4 份（满了）");
  assert.equal(seen({ water: 3, capacity: 4, sealed: true }), "能装 4 份", "a sealed vessel shows its size, not what is inside");
  assert.equal(seen({ lit: false }), "火：没点");
  assert.equal(seen({ lit: true }), "火：点着");
});

// 顾怀山 in the hut's kitchen, played by a fixed script; 杜婆婆 goes to bed.
async function playHut(script) {
  const pack = await loadWorldPack("cangxinggu");
  const bedroom = Object.keys(pack.layout.maps["interior:du_lu"].zones).find((id) => id.includes("bedroom"));
  const moved = defineWorldPack({ ...clone(pack),
    cast: clone(pack.cast).map((row) => (row.id === gu ? { ...row, startZoneId: "feiwu__kitchen" } : row)),
    stage: { ...clone(pack.stage), scenePositions: { ...clone(pack.stage.scenePositions), [gu]: "feiwu__kitchen", [du]: bedroom } } });
  const prompts = [];
  let step = 0, duStep = 0;
  const lead = { O: "- O", W: "- work W", F: "- finish F" };
  const code = (prompt, pattern, kind) => prompt.split("\n").find((line) => pattern.test(line) && line.startsWith(lead[kind]))?.match(new RegExp(`${kind}\\d+`, "u"))?.[0] || "";
  const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(moved), { worldPack: moved, pacingMode: "scene", characterIds: [gu, du],
    enableDayPlanning: false, characterAgentCallMode: "performance",
    async runStage(input) {
      const prompt = input.prompt?.user || "";
      const act = input.characterId === du ? (duStep++ ? { type: "wait", minutes: 30 } : { type: "wait", minutes: 30 })
        : (prompts.push(prompt), script[Math.min(step++, script.length - 1)]({ prompt, code }));
      if (act.again) { step -= 1; delete act.again; }
      return { performance: { thought: "", say: { to: "", text: "", loud: false }, gesture: "", do: { target: "", person: "", minutes: 0, ...act } } };
    } });
  for (const id of [gu, du]) await instance.runtime.applyWorldEvent({ kind: "urge", toCharacterId: id, text: "该动一动了" });
  for (let i = 0; i < 40 && step < script.length + 1; i += 1) if (!(await instance.runtime.runNext())) break;
  const state = clone(instance.runtime.coordinator.worldState);
  const checkpoint = await instance.runtime.checkpoint();
  for (const actor of instance.runtime.actors.values()) await actor.close?.();
  return { prompts, state, pack: moved, checkpoint };
}

test("顾怀山 sees the water, lights the stove, and reads what he did in words", async () => {
  const { prompts, state } = await playHut([
    ({ prompt, code }) => ({ type: "look", target: code(prompt, /水缸/u, "O") }),
    ({ prompt, code }) => ({ type: "work", target: code(prompt, /把灶火生起来/u, "W") }),
    ({ prompt, code }) => (/生火（可以收尾了）/u.test(prompt) ? { type: "finish", target: code(prompt, /灶火|生火/u, "F") } : { type: "wait", minutes: 10, again: true }),
    () => ({ type: "move", target: "feiwu__hall" }),
    () => ({ type: "move", target: "street_9" }),
    () => ({ type: "wait", minutes: 5 }),
  ]);
  assert.match(prompts[0], /水缸：就在你这儿；水：2\/4 份/u, "the jar's water is in plain sight");
  assert.match(prompts[0], /木桶：就在你这儿；水：空的（能装 1 份）/u);
  assert.match(prompts[0], /灶台：就在你这儿；火：没点/u);
  assert.match(prompts[0], /你在山口废屋·灶间。屋外下着雨。/u, "indoors he knows it is raining outside");
  assert.match(prompts[0], /把灶火生起来（一份约 10 分钟）/u, "a cold stove can be lit, no skill needed");
  assert.match(prompts[1], /你：看了看水缸/u, "his own look reads as words");
  assert.match(prompts[2], /你：开始把灶火生起来/u, "without his own name in front");
  assert.match(prompts[2], /你手上的活：生火（(还在做|可以收尾了)）/u, "the work in hand has a name, not a template id");
  assert.equal(state.objects.cangxinggu_feiwu_stove.state.lit, true, "finishing lights the stove");
  const later = prompts.at(-1);
  assert.doesNotMatch(prompts.join("\n"), /attention_oriented|movement_attempted|work_cangxinggu_/u, "no codes reach the prompt");
  assert.match(later, /你：看了看水缸/u, "a thing seen keeps its name after he walks away");
  assert.match(later, /你：走到南街一段/u);
  assert.match(later, /你在南街一段（山口废屋、谷神祠门外）。天色：下着雨。/u, "the street outside the hut is its doorstep, in the rain");
  assert.doesNotMatch(prompts.at(-1), /把灶火生起来（一份约 10 分钟）——眼下还不行：你先到山口废屋/u, "a lit stove is not lit again");
});

test("the stage walks a person up to what they handle, lays a resting person in bed, and shows fire only while a stove is lit", async () => {
  const { pack, checkpoint } = await playHut([
    ({ prompt, code }) => ({ type: "look", target: code(prompt, /水缸/u, "O") }),
    ({ prompt, code }) => ({ type: "look", target: code(prompt, /灶台/u, "O") }),
    () => ({ type: "wait", minutes: 10 }),
  ]);
  const feed = buildObserverFeed({ checkpoint, settledTurns: reconcileSettledTurnRecords(checkpoint) }, pack);
  const world = { ...pack.meta, layout: pack.layout, cast: pack.cast, zones: {}, work: pack.work.map((row) => ({ ...row, objectIds: [...(row.objectIds || [])] })) };
  const atlas = flattenLayout(pack.layout); const layout = atlas.layout;
  const director = createDirector({ world, initial: feed.initial, layout, scene: { walkable: walkableTiles(layout) }, atlas });
  director.setFrames(feed.frames);
  const settle = () => { for (let k = 0; k < 600; k += 1) director.update(1 / 30, { playing: false, speed: 1 }); };
  for (const [index, frame] of feed.frames.entries()) {
    if (frame.actorId !== gu || frame.kind !== "observe") continue;
    director.scrub(index); settle();
    const at = layout.objects[frame.targetId].at, tile = director.actors.get(gu).tile;
    assert.ok(Math.hypot(tile[0] - at[0], tile[1] - at[1]) < 1.6, `${frame.targetId}: he stands right by it (${tile} vs ${at})`);
  }
  const rest = feed.frames.findIndex((frame) => frame.actorId === du && frame.kind === "wait");
  assert.ok(rest >= 0, "杜婆婆 rests in her bedroom");
  director.scrub(rest); settle();
  assert.equal(director.actors.get(du).bed?.kind, "bed", "and lies on the bed");
  const fire = createFixtureFire(layout);
  const stove = layout.props.find((row) => row.kind === "stove" && row.zoneId === "feiwu__kitchen");
  assert.equal(fire.propLit(director.objects)(stove), false, "a cold stove shows no fire");
  const lit = { ...director.objects, cangxinggu_feiwu_stove: { ...director.objects.cangxinggu_feiwu_stove, state: { lit: true } } };
  assert.equal(fire.propLit(lit)(stove), true, "a lit one does");
  const glow = layout.lights.find((light) => light.flicker && fire.lightOn(lit)(light) && !fire.lightOn(director.objects)(light));
  assert.ok(glow, "and its glow comes and goes with it");
});

test("once 天意 clears the sky, people indoors and out are told it is no longer raining", async () => {
  const pack = await loadWorldPack("cangxinggu");
  const prompts = new Map();
  const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(pack), { worldPack: pack, pacingMode: "scene", characterIds: [gu, "char_cangxinggu_shi_xiaohu"],
    enableDayPlanning: false, characterAgentCallMode: "performance",
    async runStage(input) {
      prompts.set(input.characterId, input.prompt?.user || "");
      return { performance: { thought: "", say: { to: "", text: "", loud: false }, gesture: "", do: { type: "wait", target: "", person: "", minutes: 10 } } };
    } });
  await instance.runtime.applyWorldEvent({ kind: "weather", weather: "clear" });
  for (const id of [gu, "char_cangxinggu_shi_xiaohu"]) await instance.runtime.applyWorldEvent({ kind: "urge", toCharacterId: id, text: "看看外头" });
  for (let i = 0; i < 6 && prompts.size < 2; i += 1) if (!(await instance.runtime.runNext())) break;
  for (const actor of instance.runtime.actors.values()) await actor.close?.();
  assert.match(prompts.get(gu) || "", /你在山口废屋·堂屋。屋外天晴着，没有雨。/u, "顾怀山 indoors");
  assert.match(prompts.get("char_cangxinggu_shi_xiaohu") || "", /。天色：天晴着，没有雨。/u, "石小虎 out on the square");
});
