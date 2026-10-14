// Town topology compilation from blueprint, plan, and catalog (Task P2.3)
import { EDGES } from "../catalog/edges.mjs";
import { expandRooms, expandLinks } from "./rooms.mjs";

const WILD = new Set(["forest", "hills", "field"]);
const BAND_TERRAIN = new Set(["forest", "hills", "field", "river", "bridge", "pond", "road"]);

/**
 * @param {object} blueprint
 * @param {object} plan
 * @param {object} catalog
 * @returns {{
 *   zones: Array<object>,
 *   edges: Array<object>,
 *   defaultZoneId: string,
 *   siteZones: Record<string, { entry: string, rooms: string[] }>
 * }}
 */
export function compileTopology(blueprint, plan, catalog) {
  const zones = [];
  const edges = [];
  const siteZones = {};

  const residents = blueprint.residents || [];
  const sites = blueprint.town?.sites || [];
  // The plaza and other town sites retain ordinary edges. A previous band
  // entry (including a gate at its street end) is a terrain-chain edge.
  const bandEntryZoneIds = new Set(sites
    .filter((site) => BAND_TERRAIN.has(catalog[site.type]?.terrain))
    .map((site) => `${site.id}__${catalog[site.type].zones?.[0]?.suffix}`));

  // Helper to count residents per household
  const householdResCount = new Map();
  for (const r of residents) {
    if (r.householdId) {
      householdResCount.set(r.householdId, (householdResCount.get(r.householdId) || 0) + 1);
    }
  }

  // 1. Add Street Zones (if not already represented as a site zone)
  const streetZoneIds = new Set();
  for (const st of plan.streets) {
    zones.push({
      id: st.id,
      name: st.label,
      presentation: {
        terrain: "street",
        label: st.label,
      },
    });
    streetZoneIds.add(st.id);
  }

  // If plazaZoneId is not a site zone (e.g. street_plaza), add it
  if (plan.plazaZoneId === "street_plaza") {
    zones.push({
      id: "street_plaza",
      name: "镇中心广场",
      presentation: {
        terrain: "square",
        label: "中心广场",
      },
    });
    streetZoneIds.add("street_plaza");
  }

  // 2. Add Site Zones and internal links
  for (const site of sites) {
    const def = catalog[site.type];
    if (!def) continue;

    const siteRooms = [];
    let entryZoneId = null;

    if (def.kind === "building") {
      // Calculate number of bedrooms needed
      const resCount = householdResCount.get(site.householdId) || 1;

      const expandedRooms = expandRooms(def, resCount);

      for (const room of expandedRooms) {
        const zoneId = `${site.id}__${room.suffix}`;
        siteRooms.push(zoneId);
        if (room.entry) {
          entryZoneId = zoneId;
        }

        zones.push({
          id: zoneId,
          name: `${site.name}·${room.label}`,
          presentation: {
            terrain: "wood",
            label: room.label,
            siteId: site.id,
          },
        });
      }

      // Interior compilation uses these same expanded rooms and links.
      for (const [from, to] of expandLinks(def, expandedRooms)) {
        addEdgeIfNotExists(edges, {
          from: `${site.id}__${from}`,
          to: `${site.id}__${to}`,
          ...EDGES.ROOM_ROOM,
        });
      }

      // Door connection: entry room <-> frontOf street
      const streetId = plan.frontOf[site.id];
      if (streetId && entryZoneId) {
        addEdgeIfNotExists(edges, {
          from: entryZoneId,
          to: streetId,
          ...EDGES.ROOM_DOOR,
        });
      }
    } else if (def.kind === "outdoor") {
      const outdoorZones = def.zones || [{ suffix: "main", label: site.name }];
      outdoorZones.forEach((oz, oIdx) => {
        const zoneId = `${site.id}__${oz.suffix}`;
        siteRooms.push(zoneId);
        if (oIdx === 0) {
          entryZoneId = zoneId;
        }

        zones.push({
          id: zoneId,
          name: `${site.name}·${oz.label}`,
          presentation: {
            terrain: def.terrain || "dirt",
            label: oz.label,
            siteId: site.id,
          },
        });
      });

      // Outdoor internal zones links
      for (let i = 0; i < siteRooms.length - 1; i++) {
        addEdgeIfNotExists(edges, {
          from: siteRooms[i],
          to: siteRooms[i + 1],
          ...(WILD.has(def.terrain) ? EDGES.TO_WILD(2) : EDGES.STREET_STREET(1)),
        });
      }

      // Connection from entryZoneId to town network
      const connStreet = plan.outdoorEntry[site.id];
      if (connStreet && entryZoneId && connStreet !== entryZoneId) {
        addEdgeIfNotExists(edges, {
          from: entryZoneId,
          to: connStreet,
          ...(WILD.has(def.terrain) || bandEntryZoneIds.has(connStreet)
            ? EDGES.TO_WILD(3) : EDGES.STREET_STREET(1)),
        });
      }
    }

    siteZones[site.id] = {
      entry: entryZoneId || siteRooms[0],
      rooms: siteRooms,
    };
  }

  // 3. Connect Streets in the network according to plan.streetLinks
  for (const [stA, stB] of plan.streetLinks) {
    if (stA !== stB) {
      addEdgeIfNotExists(edges, {
        from: stA,
        to: stB,
        ...EDGES.STREET_STREET(1),
      });
    }
  }

  const defaultZoneId = plan.plazaZoneId;

  return {
    zones,
    edges,
    defaultZoneId,
    siteZones,
  };
}

function addEdgeIfNotExists(edges, edge) {
  const exists = edges.some(
    (e) => (e.from === edge.from && e.to === edge.to) || (e.from === edge.to && e.to === edge.from)
  );
  if (!exists) {
    edges.push(edge);
  }
}
