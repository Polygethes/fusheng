// Cast compilation for Town scale
import { profile, desire, episode, belief, voice } from "./castShapes.mjs";
import { resolveReference } from "./resolve.mjs";

const VISIBLE_STYLES = {
  beard: "留着胡子",
  bandaged: "身上缠着布条",
  sword: "佩着剑",
  hat: "戴着斗笠",
  apron: "系着围裙",
  bald: "剃着光头",
  braid: "梳着辫子",
  bun: "挽着发髻",
  long: "披着长发",
  ponytail: "扎着马尾",
};

export function publicLookOf(resident = {}) {
  if (resident.look) return resident.look;
  const age = resident.age ?? 18;
  let base = "";
  if (resident.appearance?.child === true || age < 14) {
    base = "一个孩子";
  } else if (age < 30) {
    base = "一个年轻人";
  } else if (age < 50) {
    base = "一个中年人";
  } else {
    base = "一个上了年纪的人";
  }
  const styles = resident.appearance?.styles || [];
  const matched = [];
  for (const s of styles) {
    if (VISIBLE_STYLES[s]) {
      matched.push(VISIBLE_STYLES[s]);
      if (matched.length === 2) break;
    }
  }
  if (matched.length > 0) {
    return `${base}，${matched.join("，")}`;
  }
  return base;
}

export function compileCast(blueprint, { worldId, topology, placeId = `loc_${worldId}_town`, sceneId = `scene:${worldId}:main`, catalog }) {
  const residents = blueprint.residents || [];
  const opening = blueprint.opening || {};
  const report = { provisional: [] };

  const idMap = new Map(); // residentId -> charId
  residents.forEach((r) => {
    idMap.set(r.id, `char_${worldId}_${r.id}`);
  });

  // Collect object candidate names
  const objectCandidates = (opening.objects || []).map((o, idx) => ({
    id: `${worldId}_obj_${idx + 1}`,
    name: o.name,
  }));

  const scenePositions = {};
  const cast = {};

  residents.forEach((r) => {
    const charId = idMap.get(r.id);

    // Initial zone resolution
    let zoneId = null;
    if (opening.positions && opening.positions[r.id]) {
      const siteId = opening.positions[r.id];
      zoneId = topology.siteZones[siteId]?.entry || `${siteId}__entry`;
    }
    if (!zoneId && Array.isArray(r.routine) && r.routine.length > 0) {
      // Find routine at startClock
      const startMinutes = parseClock(blueprint.meta?.startClock || "08:00");
      const matched = r.routine.find((rt) => {
        const f = parseClock(rt.from);
        const t = parseClock(rt.to);
        return startMinutes >= f && startMinutes < t;
      });
      if (matched) {
        zoneId = topology.siteZones[matched.siteId]?.entry;
      }
    }
    if (!zoneId && r.householdId) {
      const hh = (blueprint.households || []).find((h) => h.id === r.householdId);
      if (hh?.siteId) {
        zoneId = topology.siteZones[hh.siteId]?.entry;
      }
    }
    if (!zoneId) {
      zoneId = topology.defaultZoneId;
    }

    scenePositions[charId] = zoneId;

    // Desires resolution using universal resolveReference (A7)
    const compiledDesires = (r.desires || []).map((d, dIdx) => {
      let target = null;
      const resolved = resolveReference(d.object, {
        alsoText: d.outcome,
        residents,
        sites: blueprint.town?.sites || [],
        objects: objectCandidates,
        owner: r,
        relationships: blueprint.relationships || [],
        catalog,
      });

      if (resolved) {
        if (resolved.type === "object") {
          target = { type: "object", id: resolved.id, label: resolved.label };
        } else if (resolved.type === "character") {
          target = { type: "character", id: idMap.get(resolved.id), label: resolved.label };
        } else if (resolved.type === "site") {
          target = { type: "zone", id: topology.siteZones[resolved.id]?.entry || `${resolved.id}__entry`, label: resolved.label };
        }
      }

      // Fallback: resident home entry zone + report provisional
      if (!target) {
        const hh = (blueprint.households || []).find((h) => h.id === r.householdId);
        const homeEntry = topology.siteZones[hh?.siteId]?.entry || topology.defaultZoneId;
        target = { type: "zone", id: homeEntry, label: "家门" };
        report.provisional.push(`desire_${charId}_${dIdx + 1}：${r.name}的欲望“${d.verb}${d.object}”没有落到具体的人、地点或物件，暂时指向自家门口。`);
      }

      return desire(
        charId,
        `desire_${charId}_${dIdx + 1}`,
        d.verb,
        d.object,
        d.outcome,
        target,
        d.strength ?? 0.7,
        0.05,
        "observed_state",
        { criteria: d.outcome }
      );
    });

    // Boundaries
    const compiledBoundaries = (r.boundaries || []).map((b, bIdx) => ({
      kind: "boundary",
      id: `boundary_${charId}_${bIdx + 1}`,
      ownerCharacterId: charId,
      protectedInterest: b.protects,
      trigger: b.trigger,
      responseBias: b.response,
    }));

    // Principles
    const compiledPrinciples = (r.principles || []).map((p, pIdx) => ({
      kind: "principle",
      id: `principle_${charId}_${pIdx + 1}`,
      ownerCharacterId: charId,
      statement: p,
      decisionRule: `依${p}行事`,
    }));

    // Backstory / Episodes
    const episodes = (r.memories || []).map((m, mIdx) =>
      episode(charId, m.content, {
        when: m.when,
        importance: 0.75,
        cues: [r.name],
        index: mIdx + 1,
      })
    );

    // Secrets into agentMemory episodes (firsthand, personal only)
    (r.secrets || []).forEach((sec, sIdx) => {
      episodes.push(
        episode(charId, sec, {
          when: "一直以来",
          importance: 0.9,
          cues: [r.name, "私事"],
          index: episodes.length + 1,
        })
      );
    });

    // Beliefs
    const beliefs = [
      belief(charId, "role", `${r.name}在镇上的身份是${r.role}`),
      belief(charId, "situation", r.situation || ""),
    ];

    // title: identity only, without name (A5)
    const title = `${r.role} · ${r.age}岁`;
    const standing = `${r.name} · ${r.role} · ${r.age}岁`;
    const body = {
      energy: 0.8,
      hunger: 0.3,
      thirst: 0.3,
      pain: 0.1,
      exertion: 0.2,
    };
    const affect = {
      valence: 0.1,
      arousal: 0.2,
      dominance: 0.5,
    };

    const personality = {
      autonomy: r.personality?.autonomy ?? 0.5,
      introversion: r.personality?.introversion ?? 0.5,
      persistence: r.personality?.persistence ?? 0.5,
      conscientiousness: r.personality?.conscientiousness ?? 0.5,
      competitiveness: r.personality?.competitiveness ?? 0.5,
      care: r.personality?.care ?? 0.5,
      caution: r.personality?.caution ?? 0.5,
      impulsivity: r.personality?.impulsivity ?? 0.3,
    };

    const ecoProfile = profile(charId, r.name, standing, zoneId, body, affect, personality, {
      placeId,
      sceneId,
      desires: compiledDesires,
      boundaries: compiledBoundaries,
      principles: compiledPrinciples,
    });

    // voiceBlueprint derived from speech.style & personality (A5)
    const styleText = r.speech?.style || "";
    const desireObjects = (r.desires || []).map((d) => d.object).filter(Boolean);
    const relatedNames = (blueprint.relationships || [])
      .filter((rel) => rel.from === r.id)
      .map((rel) => {
        const otherRes = residents.find((res) => res.id === rel.to);
        return otherRes ? otherRes.name : rel.to;
      })
      .filter(Boolean);
    const attentionPriorities = Array.from(new Set([...desireObjects, ...relatedNames])).slice(0, 3);
    if (attentionPriorities.length === 0) {
      attentionPriorities.push("眼前手头的活计", "身边相熟的人");
    }

    const surfaceDynamics = {
      directness: Math.round((1 - (r.personality?.introversion ?? 0.5)) * 100) / 100,
      warmth: Math.round((r.personality?.care ?? 0.5) * 100) / 100,
      reserve: Math.round((r.personality?.caution ?? 0.5) * 100) / 100,
      compression: Math.round((r.personality?.introversion ?? 0.5) * 100) / 100,
      formality: 0.3,
      emotionalLeakage: Math.round((r.personality?.impulsivity ?? 0.3) * 100) / 100,
    };

    // The author's own words carry the voice once; repeating them under
    // rhythm/disclosure/silence only bloats the prompt.
    const voiceProfile = voice(
      styleText,
      attentionPriorities,
      ["先看眼前实在的，再想别的", "该开口时才开口"],
      "",
      "",
      [],
      "",
      surfaceDynamics,
      {
        family: { distance: "亲近自然", adjustment: "随常称呼" },
        friend: { distance: "熟稔热络", adjustment: "直呼名字或外号" },
        elder: { distance: "尊敬知礼", adjustment: "依辈分称呼" },
      },
      []
    );

    // appearance: child = age < 14 (A5)
    const appearance = {
      ...(r.appearance || {}),
      child: (r.age ?? 18) < 14,
    };

    const validSiteIds = new Set((blueprint.town?.sites || []).map((s) => s.id));
    const candidateSiteIds = [];
    if (r.householdId) {
      const hh = (blueprint.households || []).find((h) => h.id === r.householdId);
      if (hh?.siteId) candidateSiteIds.push(hh.siteId);
    }
    if (r.workSiteId) {
      candidateSiteIds.push(r.workSiteId);
    }
    for (const rt of r.routine || []) {
      if (rt.siteId) candidateSiteIds.push(rt.siteId);
    }
    const ties = new Set(
      (blueprint.relationships || [])
        .filter((rel) => rel.from === r.id || rel.to === r.id)
        .map((rel) => (rel.from === r.id ? rel.to : rel.from))
    );

    let knownActorIds;
    if (r.newcomer === true) {
      knownActorIds = residents
        .filter((o) => o.id !== r.id && ties.has(o.id))
        .map((o) => idMap.get(o.id));
    } else {
      knownActorIds = residents
        .filter((o) => o.id !== r.id && (o.newcomer !== true || ties.has(o.id)))
        .map((o) => idMap.get(o.id));
    }

    if (r.newcomer === true) {
      for (const tieId of ties) {
        const otherRes = residents.find((res) => res.id === tieId);
        if (otherRes?.householdId) {
          const otherHh = (blueprint.households || []).find((h) => h.id === otherRes.householdId);
          if (otherHh?.siteId) candidateSiteIds.push(otherHh.siteId);
        }
      }
      for (const site of blueprint.town?.sites || []) {
        if (site.type === "road_out") {
          candidateSiteIds.push(site.id);
        }
      }
    } else {
      for (const rel of blueprint.relationships || []) {
        if (rel.from === r.id) {
          const otherRes = residents.find((res) => res.id === rel.to);
          if (otherRes?.householdId) {
            const otherHh = (blueprint.households || []).find((h) => h.id === otherRes.householdId);
            if (otherHh?.siteId) candidateSiteIds.push(otherHh.siteId);
          }
        }
      }
      for (const site of blueprint.town?.sites || []) {
        if (catalog?.[site.type]?.kind === "outdoor") {
          candidateSiteIds.push(site.id);
        }
      }
      for (const site of blueprint.town?.sites || []) {
        if (site.type !== "home" && site.type !== "farmhouse") {
          candidateSiteIds.push(site.id);
        }
      }
    }

    const knownSiteIds = [];
    const seenSites = new Set();
    for (const sid of candidateSiteIds) {
      if (validSiteIds.has(sid) && !seenSites.has(sid)) {
        seenSites.add(sid);
        knownSiteIds.push(sid);
        if (knownSiteIds.length >= 20) break;
      }
    }

    cast[charId] = {
      id: charId,
      name: r.name,
      title,
      skills: r.skills || [],
      appearance,
      age: r.age,
      ...(r.sex ? { sex: r.sex } : {}),
      ...(r.pregnancyWeeks ? { pregnancyWeeks: r.pregnancyWeeks } : {}),
      publicSignalFeatures: [{ featureId: "look", modality: "visual", physicalFeature: publicLookOf(r), domainTags: [], intensity: 0.8 }],
      startZoneId: zoneId,
      knownActorIds,
      knownSiteIds,
      currentActivity: {
        id: `activity:${charId}:morning`,
        type: "routine",
        description: r.routine?.[0]?.activity || "晨起整理",
        status: "active",
        progress: 0,
      },
      activeGoal: r.desires?.[0] ? `${r.desires[0].verb}${r.desires[0].object}` : "",
      privatePursuit: r.desires?.[1] ? `${r.desires[1].verb}${r.desires[1].object}` : (r.desires?.[0]?.outcome || ""),
      internalSituation: r.situation || "",
      ecologyProfile: ecoProfile,
      voiceBlueprint: voiceProfile,
      voiceSamples: r.speech?.samples || [],
      commitments: [],
      routineHabits: r.routine || [],
      agentMemory: {
        episodes,
        beliefs,
      },
    };
  });

  return { cast, scenePositions, report, idMap };
}

function parseClock(clockStr) {
  const [h, m] = clockStr.split(":").map(Number);
  return h * 60 + m;
}
