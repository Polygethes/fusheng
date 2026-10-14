import assert from "node:assert/strict";

import { unitTexts } from "./tavernNarrativeOneWayValve.mjs";

assert.ok(unitTexts.length > 1, "the fixture must emit more than one unit from the same work order");
for (let index = 1; index < unitTexts.length; index += 1) {
  assert.notEqual(
    unitTexts[index],
    unitTexts[index - 1],
    "consecutive units from one work order must not repeat identical visible prose",
  );
}

console.log("tavernWorkUnitNarrativeDedup:test passed", { unitTexts });
