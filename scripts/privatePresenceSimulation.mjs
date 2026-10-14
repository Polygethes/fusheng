import assert from "node:assert/strict";
import { privateSimulationSchema } from "../src/server/pipeline/schemas.mjs";
import { normalizePrivateSimulation } from "../src/server/pipeline/privateSimulator.mjs";

const compact = {
  selectedLocation: { id: "hall", name: "法契门" },
  availableLocations: [{ id: "hall", name: "法契门" }, { id: "alley", name: "后巷" }],
  activeCharacters: [{ id: "yan", name: "阎无咎" }, { id: "shen", name: "沈珩" }],
  relationships: [],
  activeCharacterPlans: [],
};
const normalized = normalizePrivateSimulation({
  characterId: "yan",
  targetCharacterId: "shen",
  tone: "撤退",
  presenceIntent: "leave",
  exitUrgency: 91,
  exitResistance: 28,
  exitTrigger: "沈珩说出证人的名字。",
  exitReason: "魔印将被看见。",
  desiredDestinationId: "alley",
  departureMethod: "撞开侧门退入雨里。",
  pressure: 90,
}, compact, compact.activeCharacters[0], "shen");

for (const field of ["presenceIntent", "exitUrgency", "exitResistance", "exitTrigger", "exitReason", "desiredDestinationId", "departureMethod"]) {
  assert.ok(privateSimulationSchema.required.includes(field), `${field} should be part of the model contract`);
}
assert.equal(normalized.presenceIntent, "leave");
assert.equal(normalized.desiredDestinationId, "alley");
assert.equal(normalized.exitUrgency, 91);

console.log("privatePresenceSimulation:test passed", { intent: normalized.presenceIntent });
