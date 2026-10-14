// A chase can end. Shouting after someone you run toward reaches them where
// you arrive; a chaser who is clearly faster covers two stretches in a beat;
// reaching the one they chase, they make a grab.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { routeBetween, pursuitPlan, mergeSpeechAlong, FASTER_BY } from "../src/server/simulation/pursuit.mjs";
import { loadWorldPack } from "../src/worlds/registry.mjs";
import { defineWorldPack } from "../src/worlds/worldPack.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { buildObserverFeed } from "../src/server/observer/observerFeed.mjs";
import { reconcileSettledTurnRecords } from "../src/server/simulation/settledSimulationReport.mjs";

const cid = (rid) => `char_cangxinggu_${rid}`;
const hu = cid("shi_xiaohu"), he = cid("he_sao");

test("the way there, how far a chaser gets, and a shout heard at either end", () => {
  const place = { topology: { zones: { hall: {}, bedroom: {}, kitchen: {}, street: {}, shut: { closed: true } },
    edges: [{ from: "hall", to: "bedroom" }, { from: "hall", to: "kitchen" }, { from: "hall", to: "street" }, { from: "street", to: "shut" }] } };
  assert.deepEqual(routeBetween(place, "bedroom", "kitchen"), ["hall", "kitchen"]);
  assert.deepEqual(routeBetween(place, "hall", "kitchen"), ["kitchen"]);
  assert.deepEqual(routeBetween(place, "kitchen", "kitchen"), []);
  assert.equal(routeBetween(place, "kitchen", "shut"), null, "no way into a shut place");
  const person = (id, zoneId, ageGroup = "adult") => ({ id, kind: "character", name: id, placeId: "home", zoneId, present: true, ageGroup });
  const state = { nowSeconds: 0, places: { home: place }, entities: { he: person("he", "bedroom"), hu: person("hu", "kitchen", "child") } };
  assert.deepEqual(pursuitPlan({ state, actorId: "he", targetId: "hu" }), { ok: true, code: "", path: ["hall", "kitchen"], reaches: true, faster: true },
    "a grown woman after a boy covers two stretches and reaches him");
  const boyChases = { ...state, entities: { he: person("he", "kitchen"), hu: person("hu", "bedroom", "child") } };
  assert.deepEqual(pursuitPlan({ state: boyChases, actorId: "hu", targetId: "he" }), { ok: true, code: "", path: ["hall"], reaches: false, faster: false },
    "a boy after a grown woman gets one stretch");
  assert.equal(FASTER_BY, 1.25);
  const together = { ...state, entities: { he: person("he", "kitchen"), hu: person("hu", "kitchen", "child") } };
  assert.deepEqual(pursuitPlan({ state: together, actorId: "he", targetId: "hu" }).path, [], "already beside him: just the grab");
  const held = { ...state, entities: { ...state.entities, he: { ...person("he", "bedroom"), heldBy: "hu" }, hu: person("hu", "bedroom", "child") } };
  assert.equal(pursuitPlan({ state: held, actorId: "he", targetId: "hu" }).code, "MOVE_HELD");
  assert.equal(pursuitPlan({ state, actorId: "he", targetId: "nobody" }).code, "CHASE_TARGET_UNKNOWN");

  const shout = { status: "partial", failedEffects: [{ code: "SPEECH_TARGET_NOT_REACHED" }], resolvedEffects: [{ kind: "speech_emitted" }],
    deliveries: [{ recipientCharacterId: "bystander", eventKind: "speech", content: "站住！" }] };
  const arrived = { status: "success", failedEffects: [], resolvedEffects: [{ kind: "speech_emitted" }, { kind: "speech_delivered" }],
    deliveries: [{ recipientCharacterId: "hu", eventKind: "speech", content: "站住！", directed: true }, { recipientCharacterId: "neighbour", eventKind: "speech", content: "站住！" }] };
  const merged = mergeSpeechAlong(shout, arrived);
  assert.equal(merged.status, "success");
  assert.deepEqual(merged.failedEffects, [], "it reached him where she arrived");
  assert.deepEqual(merged.deliveries.map((row) => row.recipientCharacterId).sort(), ["bystander", "hu"], "and whoever heard it where she set off; bystanders where she arrives are left as they were");
  assert.deepEqual(merged.resolvedEffects.map((row) => row.kind), ["speech_emitted", "speech_delivered"], "once each");
  assert.equal(mergeSpeechAlong(shout, shout).failedEffects[0].code, "SPEECH_TARGET_NOT_REACHED", "out of earshot at both ends");
});

async function play(where) {
  const pack = await loadWorldPack("cangxinggu");
  const moved = defineWorldPack({ ...structuredClone(pack),
    cast: structuredClone(pack.cast).map((row) => (where[row.id] ? { ...row, startZoneId: where[row.id] } : row)),
    stage: { ...structuredClone(pack.stage), scenePositions: { ...structuredClone(pack.stage.scenePositions), ...where } } });
  const prompts = { [hu]: [], [he]: [] };
  const plans = { [hu]: [], [he]: [] };
  const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(moved), { worldPack: moved, pacingMode: "scene", characterIds: [hu, he],
    enableDayPlanning: false, characterAgentCallMode: "performance",
    async runStage(input) {
      const prompt = input.prompt?.user || "";
      prompts[input.characterId].push(prompt);
      const code = (prefix, label) => prompt.split("\n").find((line) => new RegExp(`^- ${prefix}\\d+ `, "u").test(line) && line.includes(label))?.match(new RegExp(`${prefix}\\d+`, "u"))?.[0] || "";
      const act = plans[input.characterId].shift() || { type: "wait", minutes: 30 };
      return { performance: { thought: "", say: { to: act.sayTo ? code("P", act.sayTo) : "", text: act.say || "", loud: false }, gesture: "",
        do: { target: act.target || "", person: act.to ? code("P", act.to) : "", minutes: act.minutes || 0, type: act.type } } };
    } });
  const { runtime } = instance;
  const beat = async (id, acts) => { plans[id] = acts; const before = prompts[id].length; await runtime.applyWorldEvent({ kind: "urge", toCharacterId: id, text: "动起来" });
    for (let i = 0; i < 12 && (plans[id].length || prompts[id].length === before); i += 1) if (!(await runtime.runNext())) break; };
  return { runtime, prompts, beat, pack: moved };
}

test("in play: 何嫂 runs from the gate to the bank shouting after the boy, and he hears her there", async () => {
  const { runtime, beat } = await play({ [he]: "gukou__gate", [hu]: "creek__bank" });
  await beat(he, [{ type: "move", target: "creek__bank", say: "石小虎你给我站住！", sayTo: "石小虎" }]);
  const ran = runtime.coordinator.journal.events.filter((row) => row.publicPayload?.primitive === "move").at(-1).publicPayload;
  assert.equal(runtime.coordinator.worldState.entities[he].zoneId, "creek__bank");
  assert.deepEqual(ran.failedEffects.map((row) => row.code), [], "the shout is not lost");
  assert.equal(ran.deliveries.find((row) => row.recipientCharacterId === hu && row.eventKind === "speech")?.content, "石小虎你给我站住！", "he hears it where she arrives");
  for (const actor of runtime.actors.values()) await actor.close?.();
});

test("in play: 何嫂 sees the boy in the next room, runs after him and grabs him", async () => {
  // Two stretches in one beat is settled by the rule above; here the chase is seen through to the grab.
  const { runtime, prompts, beat, pack } = await play({ [he]: "shi_home__hall", [hu]: "shi_home__kitchen" });
  await beat(he, [{ type: "chase", to: "石小虎" }]);
  assert.match(prompts[he][0], /^- chase：/mu, "chasing someone she can see is something she can do");
  const chased = runtime.coordinator.journal.events.filter((row) => row.publicPayload?.primitive === "pursue").at(-1).publicPayload;
  assert.equal(chased.status === "failed", false);
  assert.equal(runtime.coordinator.worldState.entities[he].zoneId, "shi_home__kitchen", "she gets to him");
  const grab = chased.attemptSurface.find((row) => row.kind === "confrontation");
  assert.deepEqual([grab?.act, grab?.targetCharacterId], ["grab", hu], "reaching him, she makes a grab");
  assert.ok(chased.deliveries.some((row) => row.recipientCharacterId === hu && row.eventKind === "confrontation"), "he feels it");

  const checkpoint = await runtime.checkpoint();
  for (const actor of runtime.actors.values()) await actor.close?.();
  const feed = buildObserverFeed({ checkpoint, settledTurns: reconcileSettledTurnRecords(checkpoint) }, pack);
  const frame = feed.frames.find((row) => row.kind === "pursue");
  assert.equal(frame.toZone, "shi_home__kitchen", "the stage walks her there");
  assert.match(frame.caption, /^何嫂追上石小虎/u);
  const director = fs.readFileSync(new URL("../src/stage/director.js", import.meta.url), "utf8");
  assert.match(director, /"pursue"/u);
});
