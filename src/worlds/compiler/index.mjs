// Complete world blueprint compiler (Task P2.5)
import crypto from "node:crypto";
import { SITE_TYPES, TOWN_TIME_POLICY } from "../catalog/index.mjs";
import { TAVERN_RELATIONSHIP_METRICS } from "../../server/ecology/tavernRelationshipDynamics.mjs";
import { defineWorldPack } from "../worldPack.mjs";
import { validateBlueprint } from "../blueprint/validateBlueprint.mjs";
import { planTown } from "./townPlanner.mjs";
import { compileTopology } from "./topology.mjs";
import { compileCast } from "./cast.mjs";
import { compileRelationships } from "./relationships.mjs";
import { compileObjects, compileWork } from "./objects.mjs";
import { compileAgenda, compileSocial, compileReport } from "./agenda.mjs";
import { buildLayoutV2 } from "./layoutV2.mjs";
import { waterDistances } from "./waterDistance.mjs";
import { objectOwnership } from "./ownership.mjs";

/**
 * @param {object} blueprint
 * @param {{ catalog?: object, seed?: number, planner?: Function }} options
 * @returns {{
 *   pack: object,
 *   layout: object,
 *   report: { provisional: string[], warnings: Array<object>, metrics: string[] }
 * }}
 */
export function compileBlueprint(blueprint, {
  catalog = SITE_TYPES,
  seed = blueprint?.meta?.seed ?? 1,
  planner = planTown,
} = {}) {
  // 1. Validate blueprint
  const bpValidation = validateBlueprint(blueprint, { catalog });
  if (!bpValidation.ok) {
    const first = bpValidation.issues[0];
    const err = new Error(first.message);
    err.code = first.code || "BLUEPRINT_INVALID";
    err.path = first.path;
    throw err;
  }

  const meta = blueprint.meta;
  const worldId = meta.id;
  const town = blueprint.town;
  const sceneId = `scene:${worldId}:main`;
  const placeId = `loc_${worldId}_town`;

  // 2. Planning & Topology
  const plan = planner(blueprint, { catalog, seed });
  const topology = compileTopology(blueprint, plan, catalog);

  // Convert topology.zones array to an object map for WorldPack schema
  const topologyZonesMap = {};
  for (const z of topology.zones) {
    const zoneObj = {
      id: z.id,
      label: z.name || z.label || z.id,
      closed: false,
    };
    if (z.id === topology.defaultZoneId) {
      zoneObj.entry = true;
    }
    if (z.offstage) {
      zoneObj.offstage = true;
    }
    topologyZonesMap[z.id] = zoneObj;
  }
  const packTopology = {
    defaultZoneId: topology.defaultZoneId,
    zones: topologyZonesMap,
    edges: topology.edges,
  };

  // 3. Cast & Positions
  const { cast, scenePositions, report: castReport, idMap } = compileCast(blueprint, {
    worldId,
    topology,
    placeId,
    sceneId,
    catalog,
  });

  const castArray = Object.values(cast);
  const sceneCast = Object.keys(cast);

  // 4. Relationships
  const relationships = compileRelationships(blueprint, idMap);

  // 5. Objects & Work
  const rawObjects = compileObjects(blueprint, topology, catalog, worldId);
  const rawWork = compileWork(blueprint, topology, catalog, rawObjects, worldId);

  // Adapt objects to WorldPack schema
  const packObjects = rawObjects.map((o) => ({
    id: o.id,
    label: o.name || o.slug,
    zoneId: o.zoneId || topology.defaultZoneId,
    initialHolderActorId: o.holderCharacterId || null,
    portable: o.portable ?? true, // opening objects default to portable unless specified
    state: o.state || {},
    presentation: o.presentation || { exposure: "public" },
    ...(o.perception ? { perception: o.perception } : {}),
    ...objectOwnership(blueprint, idMap, { zoneId: o.zoneId || topology.defaultZoneId, holderCharacterId: o.holderCharacterId, portable: o.portable ?? true }),
  }));

  // Work is already compiled to WorldPack shape in compileWork
  const packWork = rawWork;

  // 6. Agenda & Deadlines
  const agendaList = compileAgenda(blueprint, idMap, rawObjects, topology, worldId);
  const packAgenda = {
    items: agendaList.map((a) => ({
      id: a.id,
      kind: a.kind || "deadline",
      placeId,
      label: a.label,
      due: a.due,
      warningLeadSeconds: a.warningLeadSeconds,
      responsibleActorIds: a.responsible,
      knownByActorIds: a.knownBy,
      conditions: a.conditions,
      delayConsequence: a.consequence || "",
    })),
  };

  // 7. Social rules
  const social = compileSocial(blueprint, idMap, topology, catalog, worldId);

  // 8. Mysteries
  const mysteries = (blueprint.opening?.mysteries || []).map((m, mIdx) => ({
    id: `mystery_${worldId}_${mIdx + 1}`,
    label: m,
    status: "unknown",
  }));

  // 9. Report
  const report = compileReport(agendaList, castReport.provisional, rawObjects);
  // Visitors and timed events are settled by world events (P6); say so instead
  // of silently dropping what the author wrote.
  if ((blueprint.opening?.visitors || []).length) {
    report.warnings.push({ code: "VISITORS_DEFERRED", path: "opening.visitors", message: `${blueprint.opening.visitors.length} 位来客将在世界事件（P6）里出场，这次编译没有放进小镇。` });
  }
  if ((blueprint.opening?.events || []).length) {
    report.warnings.push({ code: "EVENTS_DEFERRED", path: "opening.events", message: `${blueprint.opening.events.length} 个定时事件将在世界事件（P6）里结算，这次编译没有放进小镇。` });
  }
  const packReport = {
    renderer: report.renderer,
    metrics: report.metrics,
  };

  // 10. Layout
  const layout = buildLayoutV2({ blueprint, plan, topology, objects: rawObjects, catalog, seed, clockLabel: meta.startLabel });
  for (const [zoneId, distance] of Object.entries(waterDistances(layout))) {
    if (packTopology.zones[zoneId]) packTopology.zones[zoneId].waterDistance = distance;
  }

  // 11. Meta & Stage
  const blueprintDigest = crypto
    .createHash("sha256")
    .update(JSON.stringify(blueprint))
    .digest("hex")
    .slice(0, 16);

  const packMeta = {
    id: worldId,
    title: meta.title,
    language: meta.language || "zh-CN",
    source: ["world-blueprint"],
    scale: "town",
    blueprintDigest,
    provisional: report.provisional,
  };

  const packStage = {
    placeId,
    name: town.name,
    householdName: "",
    sceneId,
    defaultWorldId: worldId,
    topology: packTopology,
    sites: (town.sites || []).map((site) => ({
      id: site.id,
      name: site.name,
      type: site.type,
      kind: catalog[site.type]?.kind || "building",
      entryZoneId: topology.siteZones[site.id]?.entry || "",
    })),
    perceptionEnvironment: {
      schemaVersion: 1,
      authority: "town-perception-environment",
      light: 0.7,
      ambientNoise: 0.2,
      modalityPriorities: ["visual", "sound"],
      modalityTransmission: {
        visual: 1,
        sound: 1,
        smell: 1,
        touch: 1,
        vibration: 1,
        proprioception: 1,
      },
      maxVisualDistance: 2.5,
      maxSoundDistance: 3,
    },
    sceneCast,
    scenePositions,
    dayCast: sceneCast,
  };

  const clock = {
    startLabel: meta.startLabel,
    startClock: meta.startClock,
    defaultPacingMode: "scene",
    sceneTimePolicy: TOWN_TIME_POLICY,
  };

  const pack = defineWorldPack({
    meta: packMeta,
    clock,
    stage: packStage,
    cast: castArray,
    relationships,
    relationshipMetrics: [...TAVERN_RELATIONSHIP_METRICS],
    positions: [],
    objects: packObjects,
    work: packWork,
    social,
    agenda: packAgenda,
    mysteries,
    report: packReport,
    layout,
  });

  return { pack, layout, report };
}
