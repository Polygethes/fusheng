import assert from "node:assert/strict";

import {
  compileResponsibilityTags,
  responsibilityRelevance,
} from "../src/server/simulation/responsibilityMatcher.mjs";

const observatoryRules = [
  {
    id: "meteor-bell",
    tag: "secure_instrument",
    sourceActorPrefixes: ["environment:"],
    modalities: ["sound"],
    anyTokens: ["three-bell alarm", "meteor siren"],
  },
];

const ferryRules = [
  {
    id: "boarding-event",
    tag: "receive_passenger",
    eventKinds: ["boarding"],
  },
];

const alarmTags = compileResponsibilityTags({
  impact: {
    sourceActorId: "environment:storm-array",
    modality: "sound",
    content: "The three-bell alarm sounds above the dome.",
  },
  rules: observatoryRules,
});
assert.deepEqual(alarmTags, ["secure_instrument"]);

const boardingTags = compileResponsibilityTags({
  impact: {
    sourceActorId: "agent_unknown_traveller",
    publicEventKind: "boarding",
    modality: "visual",
  },
  rules: ferryRules,
});
assert.deepEqual(boardingTags, ["receive_passenger"]);

assert.deepEqual(compileResponsibilityTags({
  impact: {
    sourceActorId: "environment:storm-array",
    modality: "visual",
    content: "The three-bell alarm is written in an old log.",
  },
  rules: observatoryRules,
}), [], "A text token must not bypass the declared modality.");

const keeper = responsibilityRelevance({
  responsibilityTags: alarmTags,
  capabilities: { secure_instrument: true },
  priority: 90,
});
const visitor = responsibilityRelevance({
  responsibilityTags: alarmTags,
  capabilities: { receive_passenger: true },
  priority: 100,
});
assert.equal(keeper.matched, true);
assert.equal(keeper.matchedTags[0], "secure_instrument");
assert.ok(keeper.score > 0.8);
assert.equal(visitor.matched, false, "Standing alone must never create responsibility.");

console.log(JSON.stringify({
  status: "all-passed",
  contracts: 5,
  scenes: ["mountain-observatory", "river-ferry"],
  tags: { alarmTags, boardingTags },
}, null, 2));
