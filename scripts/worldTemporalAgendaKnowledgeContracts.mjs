import assert from "node:assert/strict";
import {
  projectWorldTemporalContext,
  resolveWorldTemporalAgenda,
  temporalDeadlineDeliveries,
} from "../src/server/simulation/worldTemporalAgenda.mjs";

const place = "loc_probe";
const actor = (id, zoneId) => ({ id, kind: "character", present: true, placeId: place, zoneId });
const state = (overrides = {}) => ({
  nowSeconds: 0,
  entities: { a: actor("a", "room"), b: actor("b", "yard") },
  objects: {
    token: { id: "token", zoneId: "room", holderCharacterId: "b", state: {} },
    marks: { id: "marks", zoneId: "room", holderCharacterId: "", state: { level: 3 } },
    vat: { id: "vat", zoneId: "yard", holderCharacterId: "", state: { fill: 0.5 } },
  },
  temporalAgenda: [],
  ...overrides,
});
const deadline = (extra = {}) => ({ id: "d", label: "出发", placeId: place, dueAtSeconds: 100, warningAtSeconds: 50,
  status: "pending", warned: false, responsibleActorIds: ["a"], conditions: [], ...extra });

// (a) legacy numeric conditions keep their meaning
let resolved = resolveWorldTemporalAgenda(state({ nowSeconds: 100, temporalAgenda: [deadline({ conditions: [{ objectId: "vat", stateKey: "fill", minimum: 1 }] })] }));
assert.equal(resolved.agenda[0].status, "overdue");
resolved = resolveWorldTemporalAgenda(state({ nowSeconds: 100, temporalAgenda: [deadline({ conditions: [{ objectId: "vat", stateKey: "fill", minimum: 0.5 }] })] }));
assert.equal(resolved.agenda[0].status, "fulfilled");

// (b) holder, zone and maximum conditions
const met = (conditions, overrides) => resolveWorldTemporalAgenda(state({ nowSeconds: 100, temporalAgenda: [deadline({ conditions })], ...overrides })).agenda[0].status === "fulfilled";
assert.equal(met([{ kind: "object_holder", objectId: "token", holderId: "b" }]), true);
assert.equal(met([{ kind: "object_holder", objectId: "token", holderId: "a" }]), false);
assert.equal(met([{ kind: "actor_zone", actorId: "a", zoneId: "room" }]), true);
assert.equal(met([{ kind: "actor_zone", actorId: "a", zoneId: "yard" }]), false);
assert.equal(met([{ kind: "actor_zone", actorId: "a", zoneId: "room" }], { entities: { a: { ...actor("a", "room"), present: false }, b: actor("b", "yard") } }), false);
assert.equal(met([{ objectId: "marks", stateKey: "level", maximum: 1 }]), false);
assert.equal(met([{ objectId: "marks", stateKey: "level", maximum: 3 }]), true);

// (c) knownByActorIds limits projection and deadline announcements
const privateDeadline = deadline({ knownByActorIds: ["a"], conditions: [{ kind: "actor_zone", actorId: "b", zoneId: "yard" }] });
const privateState = state({ temporalAgenda: [privateDeadline] });
assert.equal(projectWorldTemporalContext(privateState, privateState.entities.a, []).deadlines.length, 1);
assert.equal(projectWorldTemporalContext(privateState, privateState.entities.b, []).deadlines.length, 0,
  "a private schedule is not shown to people who do not know it");
const warning = temporalDeadlineDeliveries(privateState, { kind: "world_deadline_warning", deadline: privateDeadline }, "event:w");
assert.deepEqual(warning.map((row) => row.recipientCharacterId), ["a"], "only people who know the deadline are reminded");

// (d) without knownByActorIds everybody present sees it, as before
const publicState = state({ temporalAgenda: [deadline({ conditions: [{ objectId: "vat", stateKey: "fill", minimum: 1 }] })] });
assert.equal(projectWorldTemporalContext(publicState, publicState.entities.b, ["vat"]).deadlines.length, 1);
assert.equal(projectWorldTemporalContext(publicState, publicState.entities.b, ["vat"]).deadlines[0].knownCompletion, false);
assert.deepEqual(temporalDeadlineDeliveries(publicState, { kind: "world_deadline_due", deadline: publicState.temporalAgenda[0] }, "event:d")
  .map((row) => row.recipientCharacterId), ["a", "b"]);

// knownCompletion only for what the person can actually see
const zoneState = state({ temporalAgenda: [deadline({ conditions: [{ kind: "actor_zone", actorId: "b", zoneId: "yard" }] })] });
assert.equal(projectWorldTemporalContext(zoneState, zoneState.entities.a, []).deadlines[0].knownCompletion, null,
  "a person elsewhere cannot know whether someone reached the yard");
assert.equal(projectWorldTemporalContext(zoneState, { ...zoneState.entities.a, zoneId: "yard" }, []).deadlines[0].knownCompletion, true);

console.log("Temporal agenda knowledge passed: holder, zone and maximum conditions; private deadlines reach only those who know them.");
