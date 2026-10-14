// Water and snow get in the way: in a deluge no one gets through to the
// stream's edge; wading through floodwater or deep snow takes longer. A
// person sees a flooded place on their way list, and knows why a walk failed.
import test from "node:test";
import assert from "node:assert/strict";
import { movementHindrance, MOVE_BLOCKED_BY_FLOOD } from "../src/server/simulation/movementHindrance.mjs";
import { FAILURE_LABELS } from "../src/server/simulation/settledSimulationReport.mjs";
import { loadWorldPack } from "../src/worlds/registry.mjs";
import { defineWorldPack } from "../src/worlds/worldPack.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import fs from "node:fs";

const place = (stages) => ({
  sites: [{ id: "feiwu", kind: "building" }, { id: "creek", kind: "outdoor" }, { id: "gukou", kind: "outdoor" }],
  topology: { zones: { creek__bank: { waterDistance: 1 }, gukou__gate: { waterDistance: 5 }, street_9: { waterDistance: 40 }, feiwu__hall: { waterDistance: 41 } } },
  environment: { stages: { stream: "normal", ground: "dry", snow: "none", dryness: "normal", ...stages } },
});

test("what water and snow do to a walk, by where it goes", () => {
  assert.deepEqual(movementHindrance(place({ stream: "deluge" }), "creek__bank"), { blocked: true, slowdown: 1, reason: "floodwater", note: "淹了水，过不去" });
  assert.deepEqual(movementHindrance(place({ stream: "deluge" }), "gukou__gate"), { blocked: false, slowdown: 3, reason: "floodwater", note: "积着水，得趟过去" });
  assert.deepEqual(movementHindrance(place({ stream: "flood" }), "creek__bank"), { blocked: false, slowdown: 3, reason: "floodwater", note: "积着水，得趟过去" });
  assert.equal(movementHindrance(place({ stream: "flood" }), "gukou__gate").slowdown, 1, "five tiles off is dry in a flood");
  assert.equal(movementHindrance(place({ snow: "deep" }), "street_9").slowdown, 2);
  assert.equal(movementHindrance(place({ snow: "ankle" }), "street_9").slowdown, 1.5);
  assert.equal(movementHindrance(place({ snow: "deep" }), "feiwu__hall").slowdown, 1, "no snow indoors");
  assert.deepEqual(movementHindrance({ topology: { zones: {} } }, "hall"), { blocked: false, slowdown: 1, reason: "", note: "" }, "a world without weather's work");
  assert.equal(FAILURE_LABELS[MOVE_BLOCKED_BY_FLOOD], "水太深，过不去");
  const director = fs.readFileSync(new URL("../src/stage/director.js", import.meta.url), "utf8");
  assert.match(director, /MOVE_BLOCKED_BY_FLOOD: "水太深，过不去"/u, "the stage says so too");
});

test("宝大川 wades to the bank in the flood, and cannot get there in the deluge", async () => {
  const pack = await loadWorldPack("cangxinggu");
  const bao = "char_cangxinggu_bao_dachuan";
  const moved = defineWorldPack({ ...structuredClone(pack), stage: { ...structuredClone(pack.stage), scenePositions: { ...structuredClone(pack.stage.scenePositions), [bao]: "gukou__gate" } } });
  let plan = [];
  const prompts = [];
  const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(moved), { worldPack: moved, pacingMode: "scene", characterIds: [bao],
    enableDayPlanning: false, characterAgentCallMode: "performance",
    async runStage(input) {
      prompts.push(input.prompt?.user || "");
      const act = plan.shift() || { type: "wait", minutes: 30 };
      return { performance: { thought: "", say: { to: "", text: "", loud: false }, gesture: "", do: { target: "", person: "", minutes: 0, ...act } } };
    } });
  const { runtime } = instance;
  const { coordinator } = runtime;
  const stage = () => Object.values(coordinator.worldState.places).find((row) => row.environment).environment.stages.stream;
  const beat = async (acts) => { plan = acts; const before = prompts.length; await runtime.applyWorldEvent({ kind: "urge", toCharacterId: bao, text: "去溪边看看" });
    for (let i = 0; i < 8 && (plan.length || prompts.length === before); i += 1) if (!(await runtime.runNext())) break; };
  await runtime.applyWorldEvent({ kind: "weather", weather: "storm" });
  for (let i = 0; i < 20 && stage() !== "flood"; i += 1) await coordinator.advanceWorldClockTo({ targetSeconds: 6000 });
  assert.equal(stage(), "flood");
  await beat([{ type: "move", target: "creek__bank" }]);
  assert.match(prompts.at(-1), /creek__bank=藏星溪边·岸边（积着水，得趟过去）/u, "he sees the water on his way list");
  const wade = coordinator.journal.events.filter((row) => row.publicPayload?.primitive === "move").at(-1).publicPayload;
  assert.equal(wade.status, "success");
  assert.ok(wade.resolvedEffects.some((row) => row.kind === "movement_hindered" && row.reason === "floodwater" && row.slowdown === 3), "wading is slow");
  assert.equal(coordinator.worldState.entities[bao].zoneId, "creek__bank");
  await beat([{ type: "move", target: "gukou__gate" }]);
  assert.equal(coordinator.worldState.entities[bao].zoneId, "gukou__gate");
  for (let i = 0; i < 20 && stage() !== "deluge"; i += 1) await coordinator.advanceWorldClockTo({ targetSeconds: 10200 });
  assert.equal(stage(), "deluge");
  await beat([{ type: "move", target: "creek__bank" }, { type: "wait", minutes: 5 }]);
  const blocked = coordinator.journal.events.filter((row) => row.publicPayload?.primitive === "move").at(-1).publicPayload;
  assert.equal(blocked.status, "failed");
  assert.deepEqual(blocked.failedEffects.map((row) => row.code), [MOVE_BLOCKED_BY_FLOOD]);
  assert.equal(coordinator.worldState.entities[bao].zoneId, "gukou__gate", "he stays where he was");
  assert.match(prompts.at(-1), /前面淹了水，水太深，过不去。/u, "and knows why");
  assert.match(prompts.at(-1), /creek__bank=藏星溪边·岸边（淹了水，过不去）/u);
  for (const actor of runtime.actors.values()) await actor.close?.();
});
