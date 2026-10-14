// Town-scale checks (spec §9.6). V10: every habit names a place the resident
// can walk to from where they start. V11: every tool a job needs is in
// someone's hands or in the job's own building at the opening. V12: sight
// and hearing have a range, so a town does not wake everyone at once.
const list = (value) => (Array.isArray(value) ? value : []);
const siteOf = (zoneId) => String(zoneId || "").split("__")[0];

function reachableFrom(edges, start) {
  const seen = new Set([start]);
  const queue = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    for (const edge of edges) {
      if (!(Number(edge.move) > 0)) continue;
      const next = edge.from === current ? edge.to : edge.to === current ? edge.from : null;
      if (next && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen;
}

export function validateTownRules(pack = {}, add) {
  const topology = pack.stage?.topology || {};
  const zoneIds = Object.keys(topology.zones || {});
  const edges = list(topology.edges);

  // V10 — habits.
  for (const member of list(pack.cast)) {
    const start = pack.stage?.scenePositions?.[member.id];
    const reachable = start ? reachableFrom(edges, start) : new Set();
    list(member.routineHabits).forEach((habit, index) => {
      const at = `cast.${member.id}.routineHabits[${index}]`;
      const siteZones = zoneIds.filter((id) => id.includes("__") && siteOf(id) === habit.siteId);
      if (!siteZones.length) {
        add("V10", "TOWN_ROUTINE_SITE_UNKNOWN", at, `${member.name || member.id}的作息“${habit.activity || ""}”要去的地点 ${habit.siteId} 不存在`);
        return;
      }
      if (!siteZones.some((id) => reachable.has(id))) {
        add("V10", "TOWN_ROUTINE_SITE_UNREACHABLE", at, `${member.name || member.id}从开场位置走不到作息地点 ${habit.siteId}`);
      }
    });
  }

  // V11 — tools.
  const objects = new Map(list(pack.objects).map((row) => [row.id, row]));
  for (const work of list(pack.work)) {
    for (const toolId of list(work.toolIds)) {
      const at = `work.${work.templateId}.toolIds`;
      const tool = objects.get(toolId);
      if (!tool) {
        add("V11", "TOWN_WORK_TOOL_UNKNOWN", at, `活计“${work.taskLabel || work.templateId}”要用的工具 ${toolId} 不存在`);
        continue;
      }
      if (!tool.initialHolderActorId && siteOf(tool.zoneId) !== siteOf(work.zoneId)) {
        add("V11", "TOWN_WORK_TOOL_UNREACHABLE", at, `活计“${work.taskLabel || work.templateId}”要用的${tool.label || toolId}开场时既没人拿着，也不在活计所在的建筑里`);
      }
    }
  }

  // V12 — perception range.
  const environment = pack.stage?.perceptionEnvironment || {};
  for (const key of ["maxVisualDistance", "maxSoundDistance"]) {
    const value = Number(environment[key]);
    if (!(Number.isFinite(value) && value > 0)) {
      add("V12", "TOWN_PERCEPTION_RANGE_MISSING", `stage.perceptionEnvironment.${key}`, `小镇世界必须设置 ${key}，否则一个人的动静会传遍全镇`);
    }
  }
}
