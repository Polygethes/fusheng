// A compiled deadline means the same thing to the checkers and to the running
// world: it uses only condition shapes worldTemporalAgenda settles, it is not
// already met at the opening, the runtime's own resolver accepts it once the
// world really reaches it, and the smoke finds a real route to it in time.
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileBlueprint } from "../src/worlds/compiler/index.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { resolveWorldTemporalAgenda } from "../src/server/simulation/worldTemporalAgenda.mjs";
import { runWorldSmoke } from "../src/worlds/worldSmoke.mjs";

const RUNTIME_KINDS = new Set(["object_state", "object_holder", "actor_zone"]);
const clone = (value) => JSON.parse(JSON.stringify(value));

for (const name of ["tiny_hamlet", "river_town", "forest_village"]) {
  const blueprint = JSON.parse(fs.readFileSync(`scripts/fixtures/blueprints/${name}.json`, "utf8"));
  const { pack } = compileBlueprint(blueprint);

  // 1. Only shapes the runtime evaluates; "made" things are numeric progress.
  for (const item of pack.agenda.items) {
    for (const condition of item.conditions) {
      assert.ok(RUNTIME_KINDS.has(condition.kind), `${name}: ${item.label} uses runtime condition kinds (${condition.kind})`);
      if (condition.kind === "object_state") {
        assert.equal(condition.stateKey, "progress");
        assert.ok(Number.isInteger(condition.minimum) && condition.minimum >= 1);
        const work = pack.work.filter((row) => row.completionEffects.objectNumericDeltas.some((d) => d.objectId === condition.objectId));
        assert.equal(work.length, 1, `${name}: exactly one work makes ${condition.objectId}`);
        assert.equal(work[0].requiredUnits, condition.minimum, "the work offers as many units as are needed");
        assert.deepEqual(work[0].completionCondition, { objectId: condition.objectId, path: ["progress"], minimum: condition.minimum });
      }
    }
  }

  // 2. Nothing is already done at the opening, and the runtime agrees once it is.
  const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(pack), {
    worldPack: pack, pacingMode: "scene", runStage: async () => { throw new Error("no model"); },
  });
  const opening = clone(instance.coordinator.worldState);
  assert.ok(opening.temporalAgenda.length === pack.agenda.items.length);
  const atOpening = resolveWorldTemporalAgenda(opening);
  for (const row of atOpening.agenda) {
    assert.ok(!Number.isFinite(row.conditionsSatisfiedAtSeconds), `${name}: ${row.label} is not met at the opening`);
  }
  const reached = clone(opening);
  for (const row of reached.temporalAgenda) {
    for (const condition of row.conditions) {
      if (condition.kind === "object_state") reached.objects[condition.objectId].state[condition.stateKey] = condition.minimum;
      if (condition.kind === "object_holder") reached.objects[condition.objectId].holderCharacterId = condition.holderId;
      if (condition.kind === "actor_zone") reached.entities[condition.actorId].zoneId = condition.zoneId;
    }
  }
  const resolved = resolveWorldTemporalAgenda(reached);
  assert.equal(resolved.agenda.length, pack.agenda.items.length);
  for (const row of resolved.agenda) assert.ok(Number.isFinite(row.conditionsSatisfiedAtSeconds), `${name}: the runtime accepts ${row.label} once reached`);
  for (const actor of instance.runtime.actors.values()) await actor.close?.();

  // 3. The smoke reaches every deadline through real settlement, on time.
  const smoke = await runWorldSmoke(pack, { stages: false });
  assert.deepEqual(smoke.issues, [], `${name}: ${JSON.stringify(smoke.issues)}`);
  assert.ok(smoke.deadlines.every((row) => row.status === "fulfilled"));
}

console.log("Compiled deadlines passed: runtime condition shapes, not met at the opening, accepted by the runtime when reached, reachable in time.");
