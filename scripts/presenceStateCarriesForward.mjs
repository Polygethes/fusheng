import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { buildUpdateBundle } from "../src/engine/stateUpdater.js";
import { applyUpdateBundle, getState, importState } from "../src/state/store.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠中立城市。",
  setupPeoplePrompt: "正邪妖鬼在城中交涉。",
});
const character = state.characters[0];
const origin = state.locations[0];
const destination = state.locations[1];
character.currentLocationId = origin.id;
importState(JSON.stringify(state));

const bundle = buildUpdateBundle({
  id: "draft_presence_move",
  locationId: origin.id,
  participantIds: [character.id],
  agentOutputs: [],
  relationshipShift: [],
  irreversibleTraces: [],
  presenceChanges: [{
    characterId: character.id,
    characterName: character.name,
    decision: "leave",
    destinationId: destination.id,
    destinationName: destination.name,
    trigger: "压力超过了他能维持的体面。",
  }],
}, state);

const patch = bundle.characters.find((item) => item.id === character.id);
assert.equal(patch.currentLocationId, destination.id, "departure must become a character state patch");
assert.equal(patch.previousLocationId, origin.id);
assert.ok(bundle.townStateLedger.some((entry) => entry.kind === "presence_change" && entry.fromCharacterId === character.id), "the movement must enter town memory");
applyUpdateBundle(bundle);
const moved = getState().characters.find((item) => item.id === character.id);
assert.equal(moved.currentLocationId, destination.id, "accepted state must remember where the character went");
assert.equal(moved.lastPresenceDecision, "leave");

console.log("presenceStateCarriesForward:test passed", { from: origin.name, to: destination.name });
