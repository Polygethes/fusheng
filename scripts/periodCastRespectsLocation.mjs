import assert from "node:assert/strict";
import { chooseModelCharactersForSlot } from "../src/server/pipeline/openaiPipeline.mjs";

const state = {
  characters: [
    { id: "shen", name: "沈珩", currentLocationId: "hall" },
    { id: "yan", name: "阎无咎", currentLocationId: "alley" },
    { id: "lu", name: "鹿青萝", currentLocationId: "hall" },
    { id: "ao", name: "敖霁" },
  ],
  relationships: [],
  ui: { activeCharacterIds: ["shen", "yan", "lu"] },
};

const hallCast = chooseModelCharactersForSlot(state, { id: "hall", frequentCharacters: ["yan", "lu"] }, 0);
assert.ok(hallCast.some((character) => character.id === "shen"));
assert.ok(!hallCast.some((character) => character.id === "yan"), "a character who left for another location cannot be restored to the old scene");

const alleyCast = chooseModelCharactersForSlot(state, { id: "alley", frequentCharacters: ["yan"] }, 1);
assert.ok(alleyCast.some((character) => character.id === "yan"), "the character should become eligible at their destination");

console.log("periodCastRespectsLocation:test passed", { hall: hallCast.map((item) => item.id), alley: alleyCast.map((item) => item.id) });
