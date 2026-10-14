import assert from "node:assert/strict";

import { normalizeV27Observation } from "../src/engine/v27Service.js";

// Public seam: normalizeV27Observation is the browser boundary for an
// observer-safe runtime snapshot. A scene renderer needs the settled spatial
// state, while server/private character state must remain absent.
{
  const observation = normalizeV27Observation({
    runtime: {
      characters: [{
        id: "char_xyy_luozhao",
        name: "洛照",
        present: false,
        placeId: "loc_xyy_tavern",
        zoneId: "threshold",
        positionId: "position:tavern-hall-near-threshold-bench",
        orientationTargetId: "char_xyy_xiezenshi",
        listeningTargetId: "char_xyy_xiezenshi",
        listeningTargetKind: "character",
        privateState: { currentIntention: "不得进入公开场景" },
        memoryContext: { secret: "不得进入公开场景" },
      }],
      turns: [],
    },
  });

  assert.deepEqual(observation.characters, [{
    characterId: "char_xyy_luozhao",
    name: "洛照",
    present: false,
    placeId: "loc_xyy_tavern",
    zoneId: "threshold",
    positionId: "position:tavern-hall-near-threshold-bench",
    orientationTargetId: "char_xyy_xiezenshi",
    listeningTargetId: "char_xyy_xiezenshi",
    listeningTargetKind: "character",
  }]);
  assert.equal(JSON.stringify(observation.characters).includes("不得进入公开场景"), false);
}

// Visible objects are already selected by the server observer projection. The
// browser retains only their scene-facing identity, location, holder and public
// occupancy; custody internals and arbitrary object state do not cross the seam.
{
  const observation = normalizeV27Observation({
    runtime: {
      objects: [{
        id: "position:tavern-hall-center-table",
        kind: "position",
        label: "堂中空桌",
        placeId: "loc_xyy_tavern",
        zoneId: "hall",
        holderCharacterId: "",
        occupantCharacterIds: ["char_xyy_xiezenshi", "", "char_xyy_luozhao"],
        custody: { ownerSecret: "不得公开" },
        state: { hiddenContents: "不得公开" },
        presentation: { privateNote: "不得公开" },
      }],
      turns: [],
    },
  });

  assert.deepEqual(observation.objects, [{
    id: "position:tavern-hall-center-table",
    kind: "position",
    label: "堂中空桌",
    placeId: "loc_xyy_tavern",
    zoneId: "hall",
    holderCharacterId: "",
    occupantCharacterIds: ["char_xyy_xiezenshi", "char_xyy_luozhao"],
  }]);
  assert.equal(JSON.stringify(observation.objects).includes("不得公开"), false);
}

// A renderer receives only settled, observer-safe scene effects. It keeps the
// existing human-readable status copy, but may also animate from a deliberately
// narrow set of structured world facts. Arbitrary nested/private payloads are
// not trusted merely because they arrived inside an outcome.
{
  const observation = normalizeV27Observation({
    runtime: {
      turns: [{
        characterId: "char_xyy_luozhao",
        agentTurnId: "turn:luozhao:move:1",
        publicRealization: {
          actionType: "move",
          visibleAction: "洛照从堂前走向后院。",
        },
        outcome: {
          status: "success",
          primitive: "move",
          worldVersion: 7,
          durationSeconds: 3,
          resolvedEffects: [{
            kind: "actor_movement",
            actorId: "char_xyy_luozhao",
            fromZoneId: "hall",
            toZoneId: "courtyard",
            privateDecisionBasis: "不得公开",
            memoryContext: { recalledSecret: "不得公开" },
          }],
          committedFacts: [{
            kind: "movement_attempted",
            actorId: "char_xyy_luozhao",
            fromZoneId: "hall",
            toZoneId: "courtyard",
            visibleAction: "洛照从堂前走向后院。",
            hiddenIntent: "不得公开",
            provenance: { sourceThreadId: "不得公开" },
          }],
          deliveries: [{ privateInterpretation: "不得公开" }],
          privateState: { desire: "不得公开" },
        },
      }],
    },
  });

  const outcome = observation.turns[0].outcome;
  assert.equal(outcome.status, "settled");
  assert.equal(outcome.label, "世界已接住动作");
  assert.equal(outcome.detail, "世界版本 7 · 3 秒");
  assert.equal(outcome.primitive, "move");
  assert.equal(outcome.worldVersion, 7);
  assert.equal(outcome.durationSeconds, 3);
  assert.deepEqual(outcome.resolvedEffects, [{
    kind: "actor_movement",
    actorId: "char_xyy_luozhao",
    fromZoneId: "hall",
    toZoneId: "courtyard",
  }]);
  assert.deepEqual(outcome.committedFacts, [{
    kind: "movement_attempted",
    actorId: "char_xyy_luozhao",
    fromZoneId: "hall",
    toZoneId: "courtyard",
    visibleAction: "洛照从堂前走向后院。",
  }]);
  for (const forbidden of [
    "不得公开",
    "privateDecisionBasis",
    "memoryContext",
    "hiddenIntent",
    "provenance",
    "deliveries",
    "privateState",
  ]) assert.equal(JSON.stringify(outcome).includes(forbidden), false, `${forbidden} must stay private`);
}

console.log(JSON.stringify({
  status: "all-passed",
  checks: {
    publicCharacterSpatialSnapshotPreserved: true,
    publicObjectSceneSnapshotPreserved: true,
    minimalPublicOutcomeSceneEffectsPreserved: true,
  },
}, null, 2));
