// Phase 110 — NPC movement lifecycle contracts.
//
// Public seams agreed for this slice:
//   1. renderInkTavernStageMarkup(observation, options) exposes stable movement
//      identity, persistent actor endpoints, occupancy, and local-motion intent.
//   2. buildInkTavernPlaybackFrames(observation) reconstructs past public poses
//      without leaking a later authoritative position into an earlier frame.
//   3. planTavernRoute(input) respects the authoritative tavern adjacency graph
//      and does not visually route a direct move through a third semantic zone.

import assert from "node:assert/strict";

import {
  buildInkTavernPlaybackFrames,
  renderInkTavernStageMarkup,
} from "../src/ui/inkTavernStage.js";
import { planTavernRoute } from "../src/ui/tavernNavigation.js";

const checks = {};
const failures = [];

async function contract(name, assertion) {
  try {
    await assertion();
    checks[name] = "passed";
  } catch (error) {
    checks[name] = "failed";
    failures.push({ name, reason: error?.message || String(error) });
  }
}

function actorTag(markup, characterId) {
  const token = `data-character="${characterId}"`;
  const tokenIndex = markup.indexOf(token);
  assert.ok(tokenIndex >= 0, `missing stage actor ${characterId}`);
  const start = markup.lastIndexOf("<", tokenIndex);
  const end = markup.indexOf(">", tokenIndex);
  assert.ok(start >= 0 && end > tokenIndex, `cannot isolate stage actor ${characterId}`);
  return markup.slice(start, end + 1);
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`, "u"));
  assert.ok(match, `missing ${name} on actor tag`);
  return match[1];
}

function stageObservation({ worldVersion = 0, characters = [], turns = [] } = {}) {
  return {
    nowSeconds: 9 * 3600,
    worldVersion,
    readyQueue: [],
    characters,
    turns,
  };
}

function hallCharacter(characterId, { present = true, positionId = "" } = {}) {
  return {
    characterId,
    name: characterId,
    present,
    placeId: "loc_xyy_tavern",
    zoneId: "hall",
    positionId,
  };
}

function endpointFor(markup, characterId) {
  const route = attribute(actorTag(markup, characterId), "data-route");
  const points = route.split(";").filter(Boolean);
  assert.ok(points.length, `actor ${characterId} needs a rendered endpoint`);
  return points.at(-1);
}

const STABLE_ACTOR_ID = "char_phase110_stable";
const STABLE_AGENT_TURN_ID = "agent-turn:phase110:stable:1";
const stableMovementTurn = {
  agentTurnId: STABLE_AGENT_TURN_ID,
  characterId: STABLE_ACTOR_ID,
  publicRealization: {
    actionType: "move",
    speech: "",
    visibleAction: "人物从堂前走到柜台。",
  },
  outcome: {
    status: "settled",
    durationSeconds: 12,
    resolvedEffects: [{
      kind: "actor_movement",
      actorId: STABLE_ACTOR_ID,
      fromZoneId: "hall",
      toZoneId: "counter",
    }],
    committedFacts: [],
  },
};

await contract("agentTurnId keeps one movement key stable across world-version changes", () => {
  const character = {
    ...hallCharacter(STABLE_ACTOR_ID),
    zoneId: "counter",
  };
  const firstMarkup = renderInkTavernStageMarkup(stageObservation({
    worldVersion: 31,
    characters: [character],
    turns: [stableMovementTurn],
  }));
  const secondMarkup = renderInkTavernStageMarkup(stageObservation({
    worldVersion: 32,
    characters: [character],
    turns: [stableMovementTurn],
  }));
  const firstKey = attribute(actorTag(firstMarkup, STABLE_ACTOR_ID), "data-movement-key");
  const secondKey = attribute(actorTag(secondMarkup, STABLE_ACTOR_ID), "data-movement-key");

  assert.equal(firstKey, STABLE_AGENT_TURN_ID, "movement identity must come from the immutable agent turn");
  assert.equal(secondKey, firstKey, "an unrelated world-version change must not mint a new movement key");
});

const VISIBLE_ACTOR_IDS = ["char_phase110_a", "char_phase110_b", "char_phase110_c"];

function renderHallOrder(characterIds, { hiddenFirst = false } = {}) {
  const characters = characterIds.map((characterId) => hallCharacter(characterId));
  if (hiddenFirst) characters.unshift(hallCharacter("char_phase110_hidden", { present: false }));
  return renderInkTavernStageMarkup(stageObservation({ characters }));
}

await contract("reordering character rows preserves every surviving actor endpoint", () => {
  const firstMarkup = renderHallOrder(VISIBLE_ACTOR_IDS);
  const reorderedMarkup = renderHallOrder([
    VISIBLE_ACTOR_IDS[2],
    VISIBLE_ACTOR_IDS[0],
    VISIBLE_ACTOR_IDS[1],
  ]);

  for (const characterId of VISIBLE_ACTOR_IDS) {
    assert.equal(
      endpointFor(reorderedMarkup, characterId),
      endpointFor(firstMarkup, characterId),
      `${characterId} must not teleport when observation rows are reordered`,
    );
  }
});

await contract("a hidden character does not displace visible actor endpoints", () => {
  const visibleOnlyMarkup = renderHallOrder(VISIBLE_ACTOR_IDS);
  const withHiddenMarkup = renderHallOrder(VISIBLE_ACTOR_IDS, { hiddenFirst: true });

  for (const characterId of VISIBLE_ACTOR_IDS) {
    assert.equal(
      endpointFor(withHiddenMarkup, characterId),
      endpointFor(visibleOnlyMarkup, characterId),
      `${characterId} must keep its endpoint when a hidden row is present`,
    );
  }
});

const CENTER_TABLE_POSITION_ID = "position:tavern-hall-center-table";

await contract("the four-seat center table gives four occupants unique hotspots", () => {
  const occupantIds = [
    "char_phase110_seat_a",
    "char_phase110_seat_b",
    "char_phase110_seat_c",
    "char_phase110_seat_d",
  ];
  const markup = renderInkTavernStageMarkup(stageObservation({
    characters: occupantIds.map((characterId) => hallCharacter(characterId, {
      positionId: CENTER_TABLE_POSITION_ID,
    })),
  }));
  const endpoints = occupantIds.map((characterId) => endpointFor(markup, characterId));

  assert.equal(
    new Set(endpoints).size,
    occupantIds.length,
    `a capacity-four table needs four distinct endpoints; received ${endpoints.join(" | ")}`,
  );
});

await contract("an actor occupying a table remains anchored while activity is running", () => {
  const characterId = "char_phase110_occupied";
  const markup = renderInkTavernStageMarkup(stageObservation({
    characters: [hallCharacter(characterId, { positionId: CENTER_TABLE_POSITION_ID })],
  }), { activityRunning: true });
  const tag = actorTag(markup, characterId);

  assert.equal(attribute(tag, "data-position"), CENTER_TABLE_POSITION_ID);
  assert.equal(attribute(tag, "data-local-motion"), "anchored");
  assert.equal(attribute(tag, "data-idle-route"), "");
  assert.doesNotMatch(tag, /\bis-patrolling\b/u);
});

await contract("reverse playback preserves an explicit empty pre-occupancy position", () => {
  const characterId = "char_phase110_playback";
  const observation = stageObservation({
    worldVersion: 41,
    characters: [hallCharacter(characterId, { positionId: CENTER_TABLE_POSITION_ID })],
    turns: [{
      agentTurnId: "agent-turn:phase110:occupy:1",
      characterId,
      publicRealization: {
        actionType: "move",
        speech: "",
        visibleAction: "人物在堂中桌旁落座。",
      },
      outcome: {
        status: "settled",
        durationSeconds: 5,
        resolvedEffects: [{
          kind: "position_occupied",
          actorId: characterId,
          positionId: CENTER_TABLE_POSITION_ID,
        }],
        committedFacts: [],
      },
    }],
  });
  const frames = buildInkTavernPlaybackFrames(observation);

  assert.equal(frames[0].actors[0].positionId, "", "the initial frame must not inherit a future seat");
  assert.equal(frames.at(-1).actors[0].positionId, CENTER_TABLE_POSITION_ID);
});

const AUTHORITATIVE_ZONE_IDS = new Set([
  "threshold",
  "hall",
  "counter",
  "stove",
  "courtyard",
  "stairs",
  "guest_room",
]);
const AUTHORITATIVE_ADJACENCIES = [
  ["threshold", "hall"],
  ["hall", "counter"],
  ["counter", "stove"],
  ["hall", "courtyard"],
  ["hall", "stairs"],
  ["stairs", "guest_room"],
];

for (const [leftZoneId, rightZoneId] of AUTHORITATIVE_ADJACENCIES) {
  for (const [fromZoneId, toZoneId] of [
    [leftZoneId, rightZoneId],
    [rightZoneId, leftZoneId],
  ]) {
    await contract(`authoritative ${fromZoneId} -> ${toZoneId} route avoids a third semantic zone`, () => {
      const route = planTavernRoute({
        fromZoneId,
        toZoneId,
        actorId: `char_phase110_route_${fromZoneId}_${toZoneId}`,
        slot: 0,
      });
      assert.ok(route.length >= 2, `${fromZoneId} -> ${toZoneId} needs a visible route`);
      assert.equal(route[0].zoneId, fromZoneId);
      assert.equal(route.at(-1).zoneId, toZoneId);
      const allowedSemanticZones = new Set([fromZoneId, toZoneId]);
      const thirdZoneNodes = route.filter((node) => (
        AUTHORITATIVE_ZONE_IDS.has(node.zoneId) && !allowedSemanticZones.has(node.zoneId)
      ));
      assert.deepEqual(
        thirdZoneNodes.map((node) => `${node.nodeId}:${node.zoneId}`),
        [],
        `${fromZoneId} -> ${toZoneId} must not pass through another authoritative zone`,
      );
    });
  }
}

console.log(JSON.stringify({
  status: failures.length ? "expected-red" : "all-passed",
  checks,
  failures,
}, null, 2));
if (failures.length) process.exitCode = 1;
