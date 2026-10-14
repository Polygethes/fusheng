// Static checks that carry the 逍遥游 lessons into any new world. Each check
// names the lesson it encodes in docs/51_world_foundation_lessons.md.
import { buildPlayableWorldFromPack } from "./buildPlayableWorldFromPack.mjs";
import { validateLayoutV2 } from "./validateLayoutV2.mjs";
import { validateTownRules } from "./validateTownRules.mjs";
import { getTavernEcologyProfile, validateEcologyProfile } from "../server/ecology/tavernEcologyProfile.mjs";
import { TAVERN_RELATIONSHIP_METRICS } from "../server/ecology/tavernRelationshipDynamics.mjs";

const MAX_ACTIVE_CAST = 5;
const MYSTERY_STATUSES = new Set(["unknown", "suspected"]);

const list = (value) => (Array.isArray(value) ? value : []);
const inRect = ([x, y], [rx, ry, rw, rh]) => x >= rx && y >= ry && x < rx + rw && y < ry + rh;

function collectStrings(value, out = new Set()) {
  if (typeof value === "string") out.add(value);
  else if (Array.isArray(value)) value.forEach((row) => collectStrings(row, out));
  else if (value && typeof value === "object") Object.values(value).forEach((row) => collectStrings(row, out));
  return out;
}

export function validateWorldPack(pack = {}) {
  const issues = [];
  const add = (check, code, path, message) => issues.push({ check, code, path, message });
  const topology = pack.stage?.topology || {};
  const zones = topology.zones || {};
  const zoneIds = new Set(Object.keys(zones));
  const edges = list(topology.edges);
  const objects = new Map(list(pack.objects).map((row) => [row.id, row]));
  const positions = new Map(list(pack.positions).map((row) => [row.id, row]));
  const sceneCast = list(pack.stage?.sceneCast);
  const castIds = new Set(list(pack.cast).map((row) => row.id));
  const castById = new Map(list(pack.cast).map((row) => [row.id, row]));

  // V1 — topology: who can move, hear and see is settled from it.
  if (!zoneIds.has(topology.defaultZoneId)) add("V1", "TOPOLOGY_DEFAULT_ZONE_MISSING", "stage.topology.defaultZoneId", "默认区不存在");
  for (const [index, edge] of edges.entries()) {
    if (!zoneIds.has(edge.from) || !zoneIds.has(edge.to)) add("V1", "TOPOLOGY_EDGE_ENDPOINT_UNKNOWN", `stage.topology.edges[${index}]`, `边引用了不存在的区：${edge.from}→${edge.to}`);
  }
  const reached = new Set([topology.defaultZoneId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const edge of edges) {
      if (!(Number(edge.move) > 0 && Number.isFinite(Number(edge.move)))) continue;
      for (const [a, b] of [[edge.from, edge.to], [edge.to, edge.from]]) if (reached.has(a) && !reached.has(b)) { reached.add(b); grew = true; }
    }
  }
  for (const zoneId of zoneIds) if (!reached.has(zoneId)) add("V1", "TOPOLOGY_ZONE_UNREACHABLE", `stage.topology.zones.${zoneId}`, `从默认区无法走到 ${zoneId}`);
  for (const [zoneId, zone] of Object.entries(zones)) {
    if (zone.closed && !edges.some((edge) => (edge.from === zoneId || edge.to === zoneId) && edge.barrier)) {
      add("V1", "TOPOLOGY_CLOSED_ZONE_WITHOUT_BARRIER", `stage.topology.zones.${zoneId}`, `封闭区 ${zoneId} 没有屏障边`);
    }
  }

  // Characters as the runtime will build them.
  let characters = [];
  try {
    characters = buildPlayableWorldFromPack(pack).characters || [];
  } catch (error) {
    add("V4", "PLAYABLE_WORLD_BUILD_FAILED", "cast", error.message);
  }
  const characterById = new Map(characters.map((row) => [row.id, row]));
  const skillsOf = (id) => new Set(list(characterById.get(id)?.skills || castById.get(id)?.skills));

  // V2 — every deadline has an objective path to completion by someone who knows it.
  const work = list(pack.work);
  const writes = (template, objectId, stateKey, direction) => {
    const effects = template.completionEffects || {};
    return list(effects.objectNumericDeltas).some((row) => row.objectId === objectId && row.path?.[0] === stateKey && Math.sign(row.delta) === direction)
      || (direction > 0 && list(effects.objectNumericTransfers).some((row) => row.to?.objectId === objectId && row.to?.path?.[0] === stateKey))
      || (direction < 0 && list(effects.objectNumericTransfers).some((row) => row.from?.objectId === objectId && row.from?.path?.[0] === stateKey));
  };
  for (const [index, item] of list(pack.agenda?.items).entries()) {
    const path = `agenda.items[${index}]`;
    const able = [...new Set([...list(item.responsibleActorIds), ...list(item.knownByActorIds)])].filter((id) => sceneCast.includes(id));
    if (!able.length) add("V2", "AGENDA_NOBODY_RESPONSIBLE", path, `${item.label} 没有在场的负责人或知情者`);
    if (!list(item.conditions).length) add("V2", "AGENDA_WITHOUT_OBJECTIVE_CONDITION", path, `${item.label} 没有客观完成条件`);
    for (const [conditionIndex, condition] of list(item.conditions).entries()) {
      const cpath = `${path}.conditions[${conditionIndex}]`;
      const kind = condition.kind || "object_state";
      if (kind === "actor_zone") {
        if (!castIds.has(condition.actorId) || !zoneIds.has(condition.zoneId)) add("V2", "AGENDA_ZONE_CONDITION_UNKNOWN", cpath, "人物或区不存在");
        continue;
      }
      const object = objects.get(condition.objectId);
      if (!object) { add("V2", "AGENDA_OBJECT_UNKNOWN", cpath, `物件 ${condition.objectId} 不存在`); continue; }
      if (kind === "object_holder") {
        if (object.portable === false) add("V2", "AGENDA_HOLDER_OBJECT_NOT_PORTABLE", cpath, `${object.label} 不能被拿起`);
        if (!castIds.has(condition.holderId)) add("V2", "AGENDA_HOLDER_UNKNOWN", cpath, `持有人 ${condition.holderId} 不在阵容`);
        continue;
      }
      const direction = typeof condition.maximum === "number" ? -1 : 1;
      const current = object.state?.[condition.stateKey];
      const alreadyMet = typeof current === "number" && (direction > 0 ? current >= condition.minimum : current <= condition.maximum);
      const routes = work.filter((template) => writes(template, condition.objectId, condition.stateKey, direction));
      const doable = routes.filter((template) => list(template.requiredSkillIds).every((skill) => able.some((id) => skillsOf(id).has(skill)))
        && list(template.toolIds).every((toolId) => objects.has(toolId)) && zoneIds.has(template.zoneId));
      if (!alreadyMet && !doable.length) {
        add("V2", "AGENDA_CONDITION_UNREACHABLE", cpath,
          `${item.label}：没有知情者能做到的工作能改变 ${condition.objectId}.${condition.stateKey}${routes.length ? "（有工作但缺技能、工具或区）" : ""}`);
      }
    }
  }

  // V3 — work and object operations refer to real state.
  for (const [index, template] of work.entries()) {
    const path = `work[${index}]`;
    if (!zoneIds.has(template.zoneId)) add("V3", "WORK_ZONE_UNKNOWN", path, `${template.templateId} 的区不存在`);
    for (const id of [...list(template.objectIds), ...list(template.toolIds)]) if (!objects.has(id)) add("V3", "WORK_OBJECT_UNKNOWN", path, `${template.templateId} 引用了不存在的物件 ${id}`);
    const effects = template.completionEffects || {};
    for (const row of [...list(effects.objectNumericDeltas), ...list(effects.objectNumericTransfers).flatMap((t) => [t.from, t.to])]) {
      const target = objects.get(row?.objectId);
      if (!target || typeof target.state?.[row.path?.[0]] !== "number") add("V3", "WORK_EFFECT_STATE_UNKNOWN", path, `${template.templateId} 写入的 ${row?.objectId}.${row?.path?.[0]} 不是数值状态`);
    }
    for (const row of list(effects.objectStateSets)) {
      if (!objects.has(row?.objectId)) add("V3", "WORK_EFFECT_STATE_UNKNOWN", path, `${template.templateId} 设置的物件 ${row?.objectId} 不存在`);
    }
  }
  for (const [id, object] of objects) {
    if (list(object.operations).some((op) => op === "draw" || op === "sheathe") && typeof object.state?.sheathed !== "boolean") {
      add("V3", "OBJECT_SHEATHE_STATE_MISSING", `objects.${id}`, `${object.label} 可拔可收但没有 sheathed 状态`);
    }
  }

  // V4 — profiles are valid and every character wants something on this stage.
  const presentIds = new Set([...sceneCast, ...objects.keys(), ...positions.keys(), ...zoneIds]);
  for (const id of sceneCast) {
    const character = characterById.get(id);
    if (!character) { add("V4", "CAST_CHARACTER_MISSING", `stage.sceneCast.${id}`, `人物 ${id} 没有构建出来`); continue; }
    // An authored pack must carry its own valid profile: the runtime would otherwise
    // fall back silently to a generic compiled one.
    const embedded = pack.legacySetup ? null : castById.get(id)?.ecologyProfile;
    if (!pack.legacySetup && !embedded) add("V4", "ECOLOGY_PROFILE_MISSING", `cast.${id}`, `${character.name} 没有人物底座`);
    const profile = embedded || getTavernEcologyProfile(character);
    const validation = profile ? validateEcologyProfile(profile) : { valid: false, errors: [] };
    if (!validation.valid) add("V4", "ECOLOGY_PROFILE_INVALID", `cast.${id}`, `人物底座无效：${list(validation.errors).map((row) => row.code).join("、")}`);
    const grounded = list(profile?.desires).some((desire) => {
      const refs = collectStrings([desire.target, desire.satisfactionCondition?.criteria]);
      refs.delete(id);
      return [...refs].some((ref) => presentIds.has(ref));
    }) || [...objects.values()].some((object) => object.initialHolderActorId === id
      && sceneCast.includes(object.state?.intendedRecipientActorId) && object.state.intendedRecipientActorId !== id);
    if (!grounded) add("V4", "DESIRE_NOT_GROUNDED_ON_STAGE", `cast.${id}`, `${character.name} 的欲望没有落到开场在场的人、物或地方`);
  }

  // V5 — at least one matter that needs two or more people.
  const agendaPeople = list(pack.agenda?.items).some((item) => new Set([...list(item.responsibleActorIds), ...list(item.knownByActorIds),
    ...list(item.conditions).map((row) => row.actorId || row.holderId).filter(Boolean)].filter((id) => sceneCast.includes(id))).size >= 2);
  const handover = [...objects.values()].some((object) => sceneCast.includes(object.initialHolderActorId)
    && sceneCast.includes(object.state?.intendedRecipientActorId) && object.initialHolderActorId !== object.state.intendedRecipientActorId);
  if (!agendaPeople && !handover) add("V5", "NO_CROSS_CHARACTER_MATTER", "agenda", "没有任何需要两人以上共同处理的事务，场面容易退化为各自等待");

  // V6 — scene size and relationship endpoints.
  if (pack.meta?.scale === "town") {
    // For town scale, allow more total characters, but ensure initial positions aren't overly crowded
    const zoneCounts = new Map();
    for (const [charId, zoneId] of Object.entries(pack.stage?.scenePositions || {})) {
      zoneCounts.set(zoneId, (zoneCounts.get(zoneId) || 0) + 1);
    }
    for (const [zoneId, count] of zoneCounts.entries()) {
      if (count > 6) {
        add("V6", "TOWN_ZONE_CROWDED", `stage.scenePositions`, `小镇区 ${zoneId} 开场人数 ${count} 人超过上限 6 人`);
      }
    }
  } else {
    if (sceneCast.length > MAX_ACTIVE_CAST) add("V6", "TOO_MANY_ACTIVE_CHARACTERS", "stage.sceneCast", `本场活跃人物 ${sceneCast.length} 名，上限 ${MAX_ACTIVE_CAST}`);
  }
  for (const [index, row] of list(pack.relationships).entries()) {
    if (!castIds.has(row.fromCharacterId) || !castIds.has(row.toCharacterId)) add("V6", "RELATIONSHIP_ENDPOINT_UNKNOWN", `relationships[${index}]`, "关系种子引用了不在阵容中的人物");
  }
  const metrics = list(pack.relationshipMetrics);
  if (metrics.length !== TAVERN_RELATIONSHIP_METRICS.length || metrics.some((id, i) => id !== TAVERN_RELATIONSHIP_METRICS[i])) {
    add("V6", "RELATIONSHIP_METRICS_UNSUPPORTED", "relationshipMetrics", "运行时目前只支持既有关系维度");
  }

  // V7 — unresolved mysteries stay unresolved in every mind.
  const mysteryIds = new Set(list(pack.mysteries).map((row) => row.id));
  for (const member of list(pack.cast)) {
    for (const [index, belief] of list(member.agentMemory?.beliefs).entries()) {
      if (!belief.mysteryId) continue;
      if (!mysteryIds.has(belief.mysteryId)) add("V7", "MYSTERY_UNKNOWN", `cast.${member.id}.agentMemory.beliefs[${index}]`, `未登记的悬念 ${belief.mysteryId}`);
      else if (!MYSTERY_STATUSES.has(belief.status)) add("V7", "MYSTERY_SETTLED_IN_BELIEF", `cast.${member.id}.agentMemory.beliefs[${index}]`, `${member.name} 把悬念当成了已确认的事实`);
    }
  }

  // V8 — report metrics point at real state.
  for (const [index, metric] of list(pack.report?.metrics).entries()) {
    const object = objects.get(metric.objectId);
    if (!object || (metric.kind !== "holder" && !(metric.stateKey in (object.state || {})))) {
      add("V8", "REPORT_METRIC_UNKNOWN", `report.metrics[${index}]`, `报告指标 ${metric.label} 指向不存在的状态`);
    }
  }

  // V10–V12 — town-scale rules (spec §9.6). Before V9, which returns early for v2 layouts.
  if (pack.meta?.scale === "town") validateTownRules(pack, add);

  // V9 — the observer can show every place, door and drawn object truthfully.
  if (pack.layout?.layoutVersion === 2) { validateLayoutV2(pack, add); return { ok: issues.length === 0, issues }; }
  const layout = pack.layout || {};
  const rectsOf = (zoneId) => list(layout.zones?.[zoneId]?.rects);
  for (const zoneId of zoneIds) {
    if (!rectsOf(zoneId).length) add("V9", "LAYOUT_ZONE_MISSING", `layout.zones.${zoneId}`, `布局缺少区 ${zoneId}`);
    else if (!layout.zones[zoneId].offstage && !list(layout.spots?.[zoneId]).some((spot) => rectsOf(zoneId).some((rect) => inRect(spot, rect)))) {
      add("V9", "LAYOUT_ZONE_WITHOUT_SPOT", `layout.spots.${zoneId}`, `区 ${zoneId} 没有可站位置`);
    }
  }
  for (const edge of edges) {
    if (!list(layout.doors).some((door) => door.between?.includes(edge.from) && door.between?.includes(edge.to))) {
      add("V9", "LAYOUT_DOOR_MISSING", "layout.doors", `布局缺少 ${edge.from}↔${edge.to} 的通道`);
    }
  }
  for (const [id, drawn] of Object.entries(layout.objects || {})) {
    const object = objects.get(id);
    if (!object) { add("V9", "LAYOUT_OBJECT_UNKNOWN", `layout.objects.${id}`, `布局画了不存在的物件 ${id}`); continue; }
    if (drawn.zoneId !== (object.zoneId || topology.defaultZoneId)) add("V9", "LAYOUT_OBJECT_ZONE_MISMATCH", `layout.objects.${id}`, `${object.label} 画在 ${drawn.zoneId}，世界里在 ${object.zoneId}`);
    if (drawn.at && !rectsOf(drawn.zoneId).some((rect) => inRect(drawn.at, rect))) add("V9", "LAYOUT_OBJECT_OUTSIDE_ZONE", `layout.objects.${id}`, `${object.label} 的位置不在所属区内`);
  }

  return { ok: issues.length === 0, issues };
}
