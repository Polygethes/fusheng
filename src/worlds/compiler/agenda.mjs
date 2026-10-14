// Agenda, Deadlines, Social Rules & Report compiler (Task P2.4)

export function compileAgenda(blueprint, idMap, objects, topology, worldId) {
  const opening = blueprint.opening || {};
  const deadlines = opening.deadlines || [];
  const startClock = blueprint.meta?.startClock || "08:00";
  const startMinutes = parseClock(startClock);

  const compiled = [];

  deadlines.forEach((dl, dlIdx) => {
    const dueMinutes = parseClock(dl.dueClock);
    let deltaMinutes = dueMinutes - startMinutes;
    if (deltaMinutes <= 0) deltaMinutes += 24 * 60; // Next day
    const atSeconds = deltaMinutes * 60;

    const warningLeadSeconds = Math.max(300, Math.min(1800, Math.floor(atSeconds / 4)));

    const responsible = (dl.responsible || []).map((rId) => {
      const charId = idMap.get(rId);
      if (!charId) {
        const err = new Error(`Deadlines responsible unresolved: ${rId}`);
        err.code = "BLUEPRINT_REFERENCE_UNRESOLVED";
        err.path = `opening.deadlines[${dlIdx}].responsible`;
        throw err;
      }
      return charId;
    });

    const knownBy = (dl.knownBy || []).map((rId) => {
      const charId = idMap.get(rId);
      if (!charId) {
        const err = new Error(`Deadlines knownBy unresolved: ${rId}`);
        err.code = "BLUEPRINT_REFERENCE_UNRESOLVED";
        err.path = `opening.deadlines[${dlIdx}].knownBy`;
        throw err;
      }
      return charId;
    });

    // Conditions are written in the exact shapes worldTemporalAgenda settles,
    // so the checker and the running world can never disagree about them.
    const unresolved = (field, value, cIdx) => Object.assign(new Error(`Condition ${field} unresolved: ${value}`), {
      code: "BLUEPRINT_REFERENCE_UNRESOLVED", path: `opening.deadlines[${dlIdx}].conditions[${cIdx}].${field}`,
    });
    const conditions = (dl.conditions || []).map((c, cIdx) => {
      const objectOf = () => {
        const obj = objects.find((o) => o.name === c.object && !o.slug);
        if (!obj) throw unresolved("object", c.object, cIdx);
        return obj;
      };
      const actorOf = (field) => {
        const charId = idMap.get(c[field]);
        if (!charId) throw unresolved(field, c[field], cIdx);
        return charId;
      };
      if (c.kind === "object_ready") {
        const obj = objectOf();
        if (!obj.madeAt) throw Object.assign(new Error(`${obj.name} has no madeAt`), {
          code: "BLUEPRINT_OBJECT_NOT_MADE", path: `opening.deadlines[${dlIdx}].conditions[${cIdx}].object`,
        });
        return { kind: "object_state", objectId: obj.id, stateKey: "progress", minimum: obj.needed || 1 };
      }
      if (c.kind === "object_holder") return { kind: "object_holder", objectId: objectOf().id, holderId: actorOf("holder") };
      if (c.kind === "actor_at") {
        const zoneId = topology.siteZones[c.siteId]?.entry;
        if (!zoneId) throw unresolved("siteId", c.siteId, cIdx);
        return { kind: "actor_zone", actorId: actorOf("actor"), zoneId };
      }
      throw Object.assign(new Error(`Unknown condition kind: ${c.kind}`), {
        code: "BLUEPRINT_CONDITION_KIND_UNKNOWN", path: `opening.deadlines[${dlIdx}].conditions[${cIdx}].kind`,
      });
    });

    compiled.push({
      id: `deadline_${worldId}_${dlIdx + 1}`,
      label: dl.label,
      due: {
        clock: dl.dueClock,
        atSeconds,
      },
      warningLeadSeconds,
      responsible,
      knownBy,
      conditions,
      consequence: dl.consequence,
    });
  });

  return compiled;
}

export function compileSocial(blueprint, idMap, topology, catalog, worldId) {
  const households = blueprint.households || [];
  const residents = blueprint.residents || [];
  const sites = blueprint.town?.sites || [];

  const facts = [];
  const boundaries = [];

  for (const hh of households) {
    const hhSite = sites.find((s) => s.id === hh.siteId);
    if (!hhSite) continue;

    const factId = `social-fact:${worldId}:${hh.id}`;
    facts.push({
      factId,
      kind: "ownership_claim",
      claimantId: `household:${hh.name}`,
      entityId: `site:${worldId}:${hhSite.id}`,
      topic: `${hhSite.name}是${hh.name}的`,
      sourceEvidenceIds: [],
    });

    // Household members and adults
    const memberResidents = residents.filter((r) => r.householdId === hh.id);
    const exemptActorIds = memberResidents.map((r) => idMap.get(r.id));
    const claimantIds = memberResidents
      .filter((r) => (r.age ?? 18) >= 16)
      .map((r) => idMap.get(r.id));

    // Residential zones: exclude shopfronts (e.g. front, lobby, shop, clinic)
    const allRooms = topology.siteZones[hhSite.id]?.rooms || [];
    const residentialRooms = allRooms.filter((rZoneId) => {
      return !rZoneId.endsWith("__front") &&
             !rZoneId.endsWith("__lobby") &&
             !rZoneId.endsWith("__shop");
    });

    if (residentialRooms.length > 0) {
      boundaries.push({
        id: `social-boundary:${worldId}:${hh.id}`,
        zoneIds: residentialRooms,
        exemptActorIds,
        claimantIds: claimantIds.length > 0 ? claimantIds : exemptActorIds,
        permissionRequiredByNorm: true,
        possibleResponseTags: ["owner_may_notice", "owner_may_object"],
        evidenceIds: [factId],
      });
    }
  }

  return { facts, boundaries };
}

export function compileReport(deadlines, provisionalList, rawObjects) {
  const metrics = [];
  for (const obj of rawObjects || []) {
    if (obj.madeAt) {
      metrics.push({
        label: obj.name,
        objectId: obj.id,
        stateKey: "progress",
        target: obj.needed || 1,
        unit: "份",
      });
    }
  }

  for (const dl of deadlines || []) {
    for (const c of dl.conditions || []) {
      if (c.kind === "object_holder" && c.objectId) {
        const obj = (rawObjects || []).find((o) => o.id === c.objectId);
        const label = obj ? `${obj.name}在谁手里` : "物件在谁手里";
        if (!metrics.some((m) => m.objectId === c.objectId && m.kind === "holder")) {
          metrics.push({
            label,
            objectId: c.objectId,
            kind: "holder",
          });
        }
      }
    }
  }

  return {
    renderer: "pack-metrics",
    metrics,
    provisional: provisionalList || [],
    warnings: [],
  };
}

function parseClock(clockStr) {
  const [h, m] = clockStr.split(":").map(Number);
  return h * 60 + m;
}
