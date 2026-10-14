import assert from "node:assert/strict";
import { resolvePresenceDecision } from "../src/server/pipeline/presenceResolver.mjs";

const locations = [
  { id: "hall", name: "法契门" },
  { id: "alley", name: "后巷" },
];
const character = {
  id: "yan",
  name: "阎无咎",
  actionVerbs: { visible: ["遮掩"], hidden: ["撤退"], defense: ["试价"] },
  currentState: { shame: 76, selfDestruction: 42 },
  internalSituation: { inadmissibleDesire: "逃离审讯，又不肯承认害怕。" },
};
const relationships = [{
  fromCharacterId: "yan",
  toCharacterId: "shen",
  fear: 78,
  wantsToEscape: 86,
  dependence: 12,
  protection: 4,
}];

const leaves = resolvePresenceDecision({
  simulation: {
    characterId: "yan",
    characterName: "阎无咎",
    presenceIntent: "leave",
    exitUrgency: 92,
    exitResistance: 24,
    exitTrigger: "沈珩说出了血河楼证人的真名。",
    exitReason: "继续留下会暴露魔印。",
    desiredDestinationId: "alley",
    pressure: 90,
    tone: "撤退",
  },
  character,
  relationships,
  currentLocation: locations[0],
  availableLocations: locations,
});
assert.equal(leaves.decision, "leave", "desire plus acute pressure should overcome weak resistance");
assert.equal(leaves.destinationId, "alley");
assert.ok(leaves.drive > leaves.resistance);

const blocked = resolvePresenceDecision({
  simulation: {
    characterId: "yan",
    characterName: "阎无咎",
    presenceIntent: "leave",
    exitUrgency: 74,
    exitResistance: 95,
    exitTrigger: "沈珩逼问证人。",
    exitReason: "想离开审讯。",
    desiredDestinationId: "alley",
    pressure: 72,
    tone: "撤退",
  },
  character,
  relationships: [{ ...relationships[0], dependence: 88, protection: 72 }],
  currentLocation: locations[0],
  availableLocations: locations,
});
assert.equal(blocked.decision, "blocked", "obligation and attachment should be able to hold a character in the room");

const stays = resolvePresenceDecision({
  simulation: {
    characterId: "yan",
    characterName: "阎无咎",
    presenceIntent: "stay",
    exitUrgency: 18,
    exitResistance: 60,
    pressure: 34,
    tone: "试探",
  },
  character,
  relationships,
  currentLocation: locations[0],
  availableLocations: locations,
});
assert.equal(stays.decision, "stay");

console.log("presenceDecisionResolver:test passed", {
  leaveDrive: leaves.drive,
  blockedResistance: blocked.resistance,
});
