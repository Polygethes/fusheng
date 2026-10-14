import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  TAVERN_NAVIGATION_MAP,
  doesTavernSegmentCrossObstacle,
  findTavernPath,
  parseTavernRoute,
  planTavernRoute,
  validateTavernNavigationMap,
} from "../src/ui/tavernNavigation.js";
import {
  INK_TAVERN_ASSETS,
  buildInkTavernActorStates,
  renderInkTavernStageMarkup,
} from "../src/ui/inkTavernStage.js";

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

function assertWalkableRoute(route, label) {
  assert.ok(route.length >= 1, `${label} must return a route`);
  for (let index = 1; index < route.length; index += 1) {
    assert.equal(
      doesTavernSegmentCrossObstacle(route[index - 1], route[index]),
      false,
      `${label} crosses an authored collision obstacle at segment ${index}`,
    );
  }
}

await contract("the environment declares one coherent top-down coordinate space", () => {
  assert.equal(TAVERN_NAVIGATION_MAP.projection, "three-quarter-top-down");
  assert.deepEqual(TAVERN_NAVIGATION_MAP.coordinateSpace, { width: 100, height: 100, origin: "top-left" });
  assert.equal(INK_TAVERN_ASSETS.background, "/assets/ink-tavern/tavern-topdown-v2.png");
  assert.ok(Object.keys(TAVERN_NAVIGATION_MAP.nodes).length >= 24);
  assert.ok(TAVERN_NAVIGATION_MAP.obstacles.length >= 5);
});

await contract("every authored navigation edge stays outside furniture collision", () => {
  const result = validateTavernNavigationMap();
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

await contract("every authoritative tavern zone is reachable through the walkable graph", () => {
  const zoneIds = ["threshold", "hall", "counter", "stove", "courtyard", "stairs", "guest_room"];
  for (const zoneId of zoneIds) {
    const route = planTavernRoute({
      fromZoneId: "hall",
      toZoneId: zoneId,
      actorId: "char_xyy_xiezenshi",
    });
    assertWalkableRoute(route, `hall -> ${zoneId}`);
    assert.equal(route.at(-1).zoneId, zoneId, `hall -> ${zoneId} must end in the requested zone`);
  }
});

await contract("pathfinding is deterministic and supports temporary node reservations", () => {
  const first = findTavernPath("threshold", "stove_front");
  const second = findTavernPath("threshold", "stove_front");
  assert.deepEqual(first, second);
  assertWalkableRoute(first, "threshold -> stove");
  const detour = findTavernPath("threshold", "stove_front", { reservedNodeIds: ["hall_south_center"] });
  assert.ok(detour.length, "a reserved central node must have a legal detour");
  assert.ok(detour.every((point) => point.nodeId !== "hall_south_center"));
  assertWalkableRoute(detour, "reserved detour");
});

await contract("same-zone position settlement walks to the selected table hotspot", () => {
  const positionId = "position:tavern-hall-center-table";
  const observation = {
    nowSeconds: 10 * 3600,
    worldVersion: 9,
    characters: [{
      characterId: "char_xyy_luozhao",
      name: "洛照",
      present: true,
      placeId: "loc_xyy_tavern",
      zoneId: "hall",
      positionId,
    }],
    turns: [{
      turnId: "turn:position:9",
      characterId: "char_xyy_luozhao",
      publicRealization: { actionType: "move", speech: "", visibleAction: "洛照走到堂中空桌旁。" },
      outcome: {
        status: "settled",
        durationSeconds: 12,
        resolvedEffects: [{ kind: "position_occupied", actorId: "char_xyy_luozhao", positionId }],
        committedFacts: [],
      },
    }],
  };
  const [actor] = buildInkTavernActorStates(observation);
  assert.equal(actor.zoneId, "hall");
  assert.equal(actor.positionId, positionId);
  assert.equal(actor.movementCommitted, false);
  assert.equal(actor.positionCommitted, true);
  assert.equal(actor.motionCommitted, true);

  const markup = renderInkTavernStageMarkup(observation, { activityRunning: true });
  const actorTag = markup.match(/<div class="[^"]*ink-tavern-actor[^"]*"[^>]*data-character="char_xyy_luozhao"[^>]*>/u)?.[0] || "";
  assert.match(actorTag, /data-position="position:tavern-hall-center-table"/u);
  assert.match(actorTag, /data-movement-source="observation"/u);
  const routeValue = actorTag.match(/data-route="([^"]+)"/u)?.[1] || "";
  const route = parseTavernRoute(routeValue);
  assert.ok(route.length > 1, "same-zone table settlement must have a visible path, not a teleport");
  assertWalkableRoute(route, "hall -> occupied table");
});

await contract("same-zone actors receive distinct standing anchors", () => {
  const markup = renderInkTavernStageMarkup(null, {
    initialCharacters: [
      { characterId: "char_xyy_xiezenshi", name: "谢真石", zoneId: "hall" },
      { characterId: "char_xyy_luozhao", name: "洛照", zoneId: "hall" },
    ],
  });
  const actorTags = [...markup.matchAll(/<div class="[^"]*ink-tavern-actor[^"]*"[^>]*data-character="[^"]+"[^>]*>/gu)]
    .map((match) => match[0]);
  assert.equal(actorTags.length, 2);
  const anchors = actorTags.map((tag) => tag.match(/style="([^"]+)"/u)?.[1] || "");
  assert.equal(new Set(anchors).size, 2, "two actors in the hall must not share the same visible anchor");
});

await contract("failed or prose-only movement cannot create a visual route", () => {
  const observation = {
    nowSeconds: 10 * 3600,
    worldVersion: 10,
    characters: [{ characterId: "char_xyy_xiezenshi", name: "谢真石", zoneId: "hall" }],
    turns: [{
      turnId: "turn:failed:10",
      characterId: "char_xyy_xiezenshi",
      publicRealization: { actionType: "move", speech: "", visibleAction: "谢真石想去灶边。" },
      outcome: { status: "failed", resolvedEffects: [], committedFacts: [] },
    }],
  };
  const [actor] = buildInkTavernActorStates(observation);
  assert.equal(actor.motionCommitted, false);
  const markup = renderInkTavernStageMarkup(observation, { activityRunning: false });
  const actorTag = markup.match(/<div class="[^"]*ink-tavern-actor[^"]*"[^>]*data-character="char_xyy_xiezenshi"[^>]*>/u)?.[0] || "";
  assert.doesNotMatch(actorTag, /data-movement-source=/u);
  assert.match(actorTag, /data-movement-key=""/u);
  assert.equal(parseTavernRoute(actorTag.match(/data-route="([^"]*)"/u)?.[1] || "").length, 1);
});

await contract("the game renderer exposes click inspection and route animation hooks", async () => {
  const markup = renderInkTavernStageMarkup(null, {
    initialCharacters: [{ characterId: "char_xyy_xiezenshi", name: "谢真石", zoneId: "hall" }],
  });
  assert.match(markup, /data-projection="three-quarter-top-down"/u);
  assert.match(markup, /data-navigation="walkable-graph"/u);
  assert.match(markup, /data-action="inspect-tavern-actor"/u);
  assert.match(markup, /data-actor-inspector/u);

  const stageSource = await readFile(new URL("../src/ui/inkTavernStage.js", import.meta.url), "utf8");
  const mainSource = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const observerSource = await readFile(new URL("../src/v27-test.js", import.meta.url), "utf8");
  assert.match(stageSource, /node\.animate\s*\(/u);
  assert.match(stageSource, /routeKeyframes/u);
  assert.match(stageSource, /previousMovementKey\s*!==\s*nextMovementKey/u);
  assert.match(mainSource, /action\s*===\s*["']inspect-tavern-actor["']/u);
  assert.match(observerSource, /data-action=\\?"inspect-tavern-actor/u);
});

await contract("responsive scene keeps the whole map visible and retires cutaway motion", async () => {
  const css = await readFile(new URL("../src/ink-tavern-stage.css", import.meta.url), "utf8");
  const observerCss = await readFile(new URL("../src/v27-test.css", import.meta.url), "utf8");
  assert.match(css, /aspect-ratio\s*:\s*1672\s*\/\s*941/u);
  assert.match(css, /object-fit\s*:\s*contain/u);
  assert.doesNotMatch(css, /ink-tavern-travel|ink-tavern-local-wander|npc-roam-distance/u);
  assert.match(css, /\.ink-tavern-figure[\s\S]*?width\s*:\s*5\.1%/u);
  assert.match(css, /\.ink-tavern-latest-line\s*\{[\s\S]*?pointer-events\s*:\s*none/u);
  assert.match(css, /\.ink-tavern-figure::after\s*\{[\s\S]*?44px/u);
  assert.match(css, /@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/u);
  assert.match(observerCss, /\.v27-body \.ink-tavern-actor\.is-acting \.ink-tavern-figure\s*\{?\s*animation\s*:\s*none/u);
});

console.log(JSON.stringify({
  status: failures.length ? "expected-red" : "all-passed",
  checks,
  failures,
}, null, 2));
if (failures.length) process.exitCode = 1;
