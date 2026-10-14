// Objects and Work compilation for Town scale (Task P2.4)
import { SKILLS } from "../catalog/skills.mjs";

export function compileObjects(blueprint, topology, catalog, worldId) {
  const objects = [];
  const sites = blueprint.town?.sites || [];

  // 1. Catalog default objects instantiated per building or outdoor site
  for (const site of sites) {
    const def = catalog[site.type];
    if (def && Array.isArray(def.objects)) {
      for (const obj of def.objects) {
        const id = `${worldId}_${site.id}_${obj.slug}`;
        const zoneId = `${site.id}__${obj.room}`;
        objects.push({
          id,
          name: obj.label,
          slug: obj.slug,
          siteId: site.id,
          zoneId,
          portable: !!obj.portable,
          state: obj.state ? { ...obj.state } : {},
          perception: {
            publicLabel: obj.label,
          },
          presentation: {
            exposure: "public",
          },
        });
      }
    }
  }

  // 2. Blueprint opening.objects
  const openingObjects = blueprint.opening?.objects || [];
  openingObjects.forEach((obj, idx) => {
    const id = `${worldId}_obj_${idx + 1}`;
    let zoneId = null;
    if (obj.siteId) {
      zoneId = topology.siteZones[obj.siteId]?.entry || `${obj.siteId}__entry`;
    }
    const state = obj.state ? { ...obj.state } : {};
    if (obj.madeAt) {
      state.progress = 0;
      state.needed = typeof obj.needed === "number" ? obj.needed : 1;
    }
    objects.push({
      id,
      name: obj.name,
      siteId: obj.siteId || null,
      holderCharacterId: obj.holder ? `char_${worldId}_${obj.holder}` : null,
      zoneId,
      state,
      madeAt: obj.madeAt || null,
      madeWith: obj.madeWith || null,
      needed: typeof obj.needed === "number" ? obj.needed : 1,
      perception: {
        publicLabel: obj.name,
      },
      presentation: {
        exposure: obj.known === "public" ? "public" : "hidden",
      },
    });
  });

  return objects;
}

export function compileWork(blueprint, topology, catalog, objects, worldId) {
  const sites = blueprint.town?.sites || [];
  const workTemplates = [];
  const objectIdAt = (siteId, slug) => objects.find((o) => o.siteId === siteId && o.slug === slug)?.id || slug;
  const skillLabel = (ids) => ids.map((id) => SKILLS[id]?.name || id).join("、");

  // One catalog work row in the runtime's work-template shape (same fields as 借星 work[]).
  // Catalog "set" effects leave a thing in a state when a step is done.
  const setsOf = (site, w) => (w.effects || [])
    .filter((eff) => ["boolean", "number", "string"].includes(typeof eff.set))
    .map((eff) => ({ objectId: objectIdAt(site.id, eff.slug), path: eff.path, value: eff.set }));
  const template = (site, w, { templateId, taskLabel, unitAction, requiredUnits, criteria, deltas, completionCondition = null }) => {
    const skillIds = w.requiredSkillIds || [];
    return {
      templateId,
      taskKind: w.templateId || "general_work",
      zoneId: `${site.id}__${w.room}`,
      taskLabel,
      description: w.description || taskLabel,
      unitAction,
      requiredUnits,
      unitLabel: w.unitLabel || "次",
      requiredSkillIds: skillIds,
      requiredSkillLabel: skillLabel(skillIds),
      completionCriteria: criteria,
      objectIds: (w.objectSlugs || []).map((slug) => objectIdAt(site.id, slug)),
      toolIds: (w.toolSlugs || []).map((slug) => objectIdAt(site.id, slug)),
      durationSecondsPerUnit: w.durationSecondsPerUnit || 120,
      bodyLoadPerUnit: w.bodyLoadPerUnit || { exertionDelta: 0.03, fatigueDelta: 0.02, staminaDelta: -0.02, energyDelta: -0.02 },
      completionEffects: { objectNumericDeltas: deltas, ...(setsOf(site, w).length ? { objectStateSets: setsOf(site, w) } : {}) },
      completionSound: { content: w.sound || `${w.taskLabel}的声音。`, maxDistance: 2 },
      ...(completionCondition ? { completionCondition } : {}),
    };
  };

  for (const site of sites) {
    const def = catalog[site.type];
    if (!def || !Array.isArray(def.work)) continue;

    // The site's everyday work. Increments add to numbers; "set" effects (a
    // stove being lit, a pot refilled) leave the thing in that state. Work
    // that only puts something in a state stops once it is in it.
    for (const w of def.work) {
      const deltas = (w.effects || [])
        .filter((eff) => typeof eff.increment === "number")
        .map((eff) => ({ objectId: objectIdAt(site.id, eff.slug), path: eff.path, delta: eff.increment }));
      workTemplates.push(template(site, w, {
        templateId: `work_${worldId}_${site.id}_${w.templateId}`,
        taskLabel: w.taskLabel,
        unitAction: w.unitAction || w.taskLabel,
        requiredUnits: w.requiredUnits || 1,
        criteria: w.completionCriteria || [w.taskLabel],
        deltas,
        completionCondition: w.until ? { objectId: objectIdAt(site.id, w.until.slug), path: w.until.path, minimum: 1 } : null,
      }));
    }

    // Things the blueprint says must be made here get their own work, so other
    // work at the same site never advances them and it stops once they are done.
    for (const made of objects.filter((o) => o.madeAt === site.id)) {
      const w = def.work.find((row) => row.templateId === made.madeWith) || def.work[0];
      if (!w) continue;
      const needed = made.needed || 1;
      workTemplates.push(template(site, w, {
        templateId: `work_${made.id}`,
        taskLabel: `${w.taskLabel}：${made.name}`,
        unitAction: `${w.unitAction || w.taskLabel}（${made.name}）`,
        requiredUnits: needed,
        criteria: [`${made.name}做成（共 ${needed} ${w.unitLabel || "份"}）`],
        deltas: [{ objectId: made.id, path: ["progress"], delta: 1 }],
        completionCondition: { objectId: made.id, path: ["progress"], minimum: needed },
      }));
    }
  }

  return workTemplates;
}
