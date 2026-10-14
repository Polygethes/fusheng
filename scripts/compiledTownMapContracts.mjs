// A compiled town is one exterior map plus an interior per building, and it
// passes the same checks the observer and the runtime rely on.
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileBlueprint } from "../src/worlds/compiler/index.mjs";
import { validateWorldPack } from "../src/worlds/validateWorldPack.mjs";
import { runWorldSmoke } from "../src/worlds/worldSmoke.mjs";
import { worldPackDigest } from "../src/worlds/worldPack.mjs";
import { SITE_TYPES } from "../src/worlds/catalog/siteTypes.mjs";
import { flattenLayout, routeTiles } from "../src/worlds/layoutAtlas.mjs";
import { walkableTiles } from "../src/worlds/layoutGeometry.mjs";

for (const name of ["tiny_hamlet", "river_town", "forest_village"]) {
  const blueprint = JSON.parse(fs.readFileSync(`scripts/fixtures/blueprints/${name}.json`, "utf8"));
  for (const seed of [1, 7, 42]) {
    const label = `${name}#${seed}`;
    const { pack } = compileBlueprint(blueprint, { seed });
    assert.equal(worldPackDigest(compileBlueprint(blueprint, { seed }).pack), worldPackDigest(pack), `${label}: deterministic`);
    const { layout, stage } = pack;
    assert.equal(layout.layoutVersion, 2, `${label}: a town has a v2 layout`);
    assert.deepEqual(validateWorldPack(pack).issues, [], `${label}: V1–V13 are clean`);
    const smoke = await runWorldSmoke(pack, { stages: false });
    assert.deepEqual(smoke.issues, [], `${label}: deadlines reachable on time`);

    // One interior and one portal per building; the portal is the door edge of the topology.
    const buildings = blueprint.town.sites.filter((site) => SITE_TYPES[site.type].kind === "building");
    assert.equal(layout.portals.length, buildings.length);
    for (const site of buildings) {
      assert.ok(layout.maps[`interior:${site.id}`], `${label}: ${site.id} has an interior`);
      const portal = layout.portals.find((row) => row.siteId === site.id);
      assert.ok(stage.topology.edges.some((edge) => [edge.from, edge.to].includes(portal.interiorZoneId) && [edge.from, edge.to].includes(portal.exteriorZoneId)), `${label}: ${site.id}'s portal is a topology edge`);
    }

    // Map labels are the topology's labels; every zone is on its map.
    for (const [zoneId, zone] of Object.entries(stage.topology.zones)) {
      const map = layout.maps[layout.zoneMap[zoneId]];
      assert.equal(map.zones[zoneId].label, zone.label, `${label}: ${zoneId} is labelled as in the topology`);
    }

    // Every resident can walk from where they start to the plaza, through doors where needed.
    const atlas = flattenLayout(layout);
    const walkable = walkableTiles(atlas.layout);
    const plaza = atlas.layout.spots[stage.topology.defaultZoneId][0];
    for (const [characterId, zoneId] of Object.entries(stage.scenePositions)) {
      assert.ok(routeTiles(atlas, walkable, atlas.layout.spots[zoneId][0], plaza), `${label}: ${characterId} can walk from ${zoneId} to the plaza`);
    }

    // Every object that lies somewhere is drawn on the map of its zone.
    for (const object of pack.objects.filter((row) => !row.initialHolderActorId)) {
      const map = layout.maps[layout.zoneMap[object.zoneId]];
      assert.equal(map.objects?.[object.id]?.zoneId, object.zoneId, `${label}: ${object.id} is drawn in ${object.zoneId}`);
    }

    // A3 contract assertions: every roof on exterior must find its door on edge matching portal exteriorDoorTile
    const { doorOnEdge } = await import("../src/worlds/layoutGeometry.mjs");
    const exterior = layout.maps.exterior;
    const portalsBySite = new Map(layout.portals.map((p) => [p.siteId, p]));
    for (const roof of exterior.roofs || []) {
      const found = doorOnEdge(roof.rect, exterior.doors);
      assert.ok(found, `${label}: doorOnEdge found for roof ${roof.siteId}`);
      const portal = portalsBySite.get(roof.siteId);
      assert.ok(portal, `${label}: portal exists for site ${roof.siteId}`);
      assert.deepEqual(found.tile, portal.exteriorDoorTile, `${label}: door tile equals portal exteriorDoorTile for ${roof.siteId}`);
    }
  }
}

console.log("Compiled town maps passed: v2 layout, V1–V13 clean, smoke on time, one interior and portal per building, everyone can walk to the plaza.");
