// Zero-model reachability smoke for a world pack.
//
// 1. Prepares each character's first stages (day planning and action) and
//    checks the generated output schemas are satisfiable.
// 2. Drives the real world settlement with deterministic attempts to show
//    every deadline can actually be completed by people who know it, and
//    that skill boundaries hold.
//
// The driver is not a character: nothing here is written to a save, and the
// result is evidence of reachability only, never of character behaviour.
import { buildPlayableWorldFromPack } from "./buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../server/pipeline/tavernWorldRuntimeV27.mjs";
import { tavernCharacterAgentV2OutputSchemaForStage } from "../server/pipeline/tavernCharacterAgentV2.mjs";

const AUTHORITY = "reachability-smoke-not-character-behavior";
const list = (value) => (Array.isArray(value) ? value : []);

export function unsatisfiableSchemaPaths(node, path = "schema", out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((child, index) => unsatisfiableSchemaPaths(child, `${path}[${index}]`, out)); return out; }
  if (node.type === "array" && Number(node.minItems) > Number(node.maxItems)) out.push(`${path} (minItems ${node.minItems} > maxItems ${node.maxItems})`);
  if (Array.isArray(node.enum) && node.enum.length === 0 && node.minLength !== 0) out.push(`${path} (empty enum)`);
  for (const [key, child] of Object.entries(node)) if (child && typeof child === "object") unsatisfiableSchemaPaths(child, `${path}.${key}`, out);
  return out;
}

export async function captureFirstStage(pack, state, characterId, enableDayPlanning) {
  let captured = null;
  const instance = createWorldRuntimeV27(state, {
    worldPack: pack, pacingMode: "scene", characterIds: [characterId, ...pack.stage.sceneCast.filter((id) => id !== characterId)],
    enableDayPlanning, characterAgentCallMode: "three-call", maxStageProtocolRepairs: 0,
    async runStage(input) {
      captured ||= { input, schema: tavernCharacterAgentV2OutputSchemaForStage(input) };
      throw Object.assign(new Error("Stage captured by the reachability smoke."), { code: "SMOKE_STAGE_CAPTURED" });
    },
  });
  // Without a day plan, a person with no deadline has nothing to wake them yet;
  // the probe wakes the target directly. This never leaves the smoke.
  if (!enableDayPlanning) {
    await instance.runtime.enqueueWake(characterId, { wakeId: `wake:smoke:${characterId}`, kind: "continuation_due", evidenceIds: [], evidence: [] });
  }
  let error = null;
  let timer;
  try {
    await Promise.race([instance.runtime.runNext(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "SMOKE_STAGE_TIMEOUT" })), 20000);
    })]);
  } catch (caught) { error = caught; } finally { clearTimeout(timer); }
  for (const actor of instance.runtime.actors.values()) await actor.close?.();
  return { captured, error };
}

function zonePath(topology, from, to) {
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const zone = queue.shift();
    if (zone === to) break;
    for (const edge of list(topology.edges)) {
      if (!(Number(edge.move) > 0 && Number.isFinite(Number(edge.move)))) continue;
      for (const [a, b] of [[edge.from, edge.to], [edge.to, edge.from]]) {
        if (a === zone && !prev.has(b)) { prev.set(b, zone); queue.push(b); }
      }
    }
  }
  if (!prev.has(to)) return null;
  const steps = [];
  for (let zone = to; zone !== from; zone = prev.get(zone)) steps.unshift(zone);
  return steps;
}

function writes(template, objectId, stateKey, direction) {
  const effects = template.completionEffects || {};
  return list(effects.objectNumericDeltas).some((row) => row.objectId === objectId && row.path?.[0] === stateKey && Math.sign(row.delta) === direction)
    || (direction > 0 && list(effects.objectNumericTransfers).some((row) => row.to?.objectId === objectId && row.to?.path?.[0] === stateKey))
    || (direction < 0 && list(effects.objectNumericTransfers).some((row) => row.from?.objectId === objectId && row.from?.path?.[0] === stateKey));
}

function conditionMet(world, condition) {
  const kind = condition.kind || "object_state";
  if (kind === "object_holder") return world.objects?.[condition.objectId]?.holderCharacterId === condition.holderId;
  if (kind === "actor_zone") return world.entities?.[condition.actorId]?.zoneId === condition.zoneId;
  const value = world.objects?.[condition.objectId]?.state?.[condition.stateKey];
  if (typeof value !== "number") return false;
  return typeof condition.maximum === "number" ? value <= condition.maximum : value >= condition.minimum;
}

export async function runWorldSmoke(pack, { stages = true } = {}) {
  const report = { worldPackId: pack.meta.id, authority: AUTHORITY, stages: [], deadlines: [], skillBoundaries: [], steps: [], issues: [] };
  const issue = (code, message, evidence = {}) => report.issues.push({ code, message, ...evidence });
  const state = buildPlayableWorldFromPack(pack);
  const skillsOf = (id) => new Set(list(state.characters.find((row) => row.id === id)?.skills));

  // 1. Stage preparation for every character.
  for (const characterId of stages ? pack.stage.sceneCast : []) {
    for (const enableDayPlanning of [true, false]) {
      const { captured, error } = await captureFirstStage(pack, state, characterId, enableDayPlanning);
      if (!captured || captured.input.characterId !== characterId) {
        issue("SMOKE_STAGE_NOT_PREPARED", `${characterId} 的首个阶段没有生成`, { characterId, enableDayPlanning, error: error?.code || error?.message || null });
        continue;
      }
      const bad = unsatisfiableSchemaPaths(captured.schema);
      if (bad.length) issue("SMOKE_STAGE_SCHEMA_UNSATISFIABLE", `${characterId} 的 ${captured.input.phase} 输出约束不可满足`, { characterId, paths: bad.slice(0, 5) });
      report.stages.push({ characterId, phase: captured.input.phase, inputBytes: JSON.stringify(captured.input).length, schemaBytes: JSON.stringify(captured.schema).length });
    }
  }

  // 2. Deadlines through real settlement.
  const instance = createWorldRuntimeV27(state, { worldPack: pack, pacingMode: "scene", runStage: async () => { throw new Error("smoke never calls a model"); } });
  const coordinator = instance.coordinator;
  const topology = pack.stage.topology;
  let sequence = 0;
  const world = () => coordinator.worldState;
  async function submit(actorId, primitive, payload) {
    const outcome = await coordinator.submitActionAttempt({ attemptId: `smoke:${pack.meta.id}:${++sequence}`, actorId, primitive,
      expectedWorldVersion: coordinator.journal.worldVersion, payload });
    report.steps.push({ seq: sequence, at: world().nowSeconds, actorId, primitive, payload: { ...payload, capabilityBinding: payload.capabilityBinding?.operation },
      status: outcome.status, failed: list(outcome.failedEffects).map((row) => row.code) });
    return outcome;
  }
  async function moveTo(actorId, zoneId) {
    const from = world().entities[actorId]?.zoneId;
    if (from === zoneId) return true;
    const steps = zonePath(topology, from, zoneId);
    if (!steps) { issue("SMOKE_NO_ROUTE", `${actorId} 无法从 ${from} 走到 ${zoneId}`); return false; }
    for (const step of steps) {
      const outcome = await submit(actorId, "move", { destinationId: step });
      if (outcome.status === "failed") { issue("SMOKE_MOVE_FAILED", `${actorId} 移动到 ${step} 失败`, { failed: outcome.failedEffects }); return false; }
    }
    return world().entities[actorId]?.zoneId === zoneId;
  }
  async function ensureHeld(actorId, objectId) {
    const object = world().objects[objectId];
    if (!object) { issue("SMOKE_OBJECT_MISSING", `物件 ${objectId} 不存在`); return false; }
    if (object.holderCharacterId === actorId) return true;
    if (object.holderCharacterId) {
      const holder = object.holderCharacterId;
      if (!(await moveTo(holder, world().entities[actorId].zoneId))) return false;
      // Carried is not in hand: take it out first, then hand it over.
      await submit(holder, "handle", { objectId, operation: "take_out" });
      const outcome = await submit(holder, "handle", { objectId, operation: "transfer", targetCharacterId: actorId });
      return outcome.status !== "failed" && world().objects[objectId]?.holderCharacterId === actorId;
    }
    if (!(await moveTo(actorId, object.zoneId))) return false;
    const outcome = await submit(actorId, "handle", { objectId, operation: "take" });
    return outcome.status !== "failed" && world().objects[objectId]?.holderCharacterId === actorId;
  }
  async function advanceUntilReady(processId) {
    for (let i = 0; i < 6; i += 1) {
      if (list(world().processes).find((row) => row.id === processId)?.status === "ready") return true;
      await coordinator.advanceWorldProcesses({ allowTimeAdvance: true });
      await coordinator.advanceWorldTemporalAgenda();
    }
    return list(world().processes).find((row) => row.id === processId)?.status === "ready";
  }
  async function doWorkUnit(actorId, template, depth) {
    for (const toolId of list(template.toolIds)) if (!(await ensureHeld(actorId, toolId))) return false;
    for (const transfer of list(template.completionEffects?.objectNumericTransfers)) {
      const source = world().objects[transfer.from.objectId]?.state?.[transfer.from.path[0]];
      if (!(source > 1e-9) && depth < 3) await satisfyNumeric(transfer.from.objectId, transfer.from.path[0], 1e-6, 1, [actorId], depth + 1);
    }
    if (!(await moveTo(actorId, template.zoneId))) return false;
    const started = await submit(actorId, "use_affordance", { capabilityBinding: { capability: "work", operation: "start_work_unit", workTemplateId: template.templateId } });
    const processId = list(started.resolvedEffects).find((row) => row.kind === "work_unit_started")?.processId;
    if (!processId) { issue("SMOKE_WORK_NOT_STARTED", `${actorId} 无法开始 ${template.templateId}`, { failed: started.failedEffects }); return false; }
    if (!(await advanceUntilReady(processId))) { issue("SMOKE_WORK_NOT_READY", `${template.templateId} 没有做到可收尾`); return false; }
    const finished = await submit(actorId, "use_affordance", { capabilityBinding: { capability: "work", operation: "finish_work_unit", processId } });
    return finished.status !== "failed";
  }
  async function satisfyNumeric(objectId, stateKey, threshold, direction, ableActors, depth = 0) {
    const met = () => {
      const value = world().objects[objectId]?.state?.[stateKey];
      return typeof value === "number" && (direction > 0 ? value >= threshold : value <= threshold);
    };
    for (let guard = 0; guard < 12 && !met(); guard += 1) {
      const template = list(pack.work).find((row) => writes(row, objectId, stateKey, direction));
      if (!template) { issue("SMOKE_NO_WORK_ROUTE", `没有工作能改变 ${objectId}.${stateKey}`); return false; }
      const actorId = ableActors.find((id) => list(template.requiredSkillIds).every((skill) => skillsOf(id).has(skill)));
      if (!actorId) { issue("SMOKE_NO_SKILLED_ACTOR", `没有具备技能的人能做 ${template.templateId}`); return false; }
      if (!(await doWorkUnit(actorId, template, depth))) return false;
    }
    return met();
  }

  const agenda = [...list(world().temporalAgenda)].sort((a, b) => a.dueAtSeconds - b.dueAtSeconds);
  for (const deadline of agenda) {
    const able = [...new Set([...list(deadline.responsibleActorIds), ...list(deadline.knownByActorIds)])];
    let reachable = true;
    for (const condition of list(deadline.conditions)) {
      const kind = condition.kind || "object_state";
      if (kind === "actor_zone") reachable = (await moveTo(condition.actorId, condition.zoneId)) && reachable;
      else if (kind === "object_holder") reachable = (await ensureHeld(condition.holderId, condition.objectId)) && reachable;
      else reachable = (await satisfyNumeric(condition.objectId, condition.stateKey,
        typeof condition.maximum === "number" ? condition.maximum : condition.minimum, typeof condition.maximum === "number" ? -1 : 1, able)) && reachable;
    }
    const allMet = list(deadline.conditions).every((condition) => conditionMet(world(), condition));
    const metAt = world().nowSeconds;
    // The clock stops at every intermediate boundary (readiness, warning), so keep advancing.
    for (let guard = 0; allMet && guard < 12 && world().nowSeconds < deadline.dueAtSeconds; guard += 1) {
      await coordinator.advanceWorldClockTo({ targetSeconds: deadline.dueAtSeconds });
    }
    await coordinator.advanceWorldTemporalAgenda();
    const row = list(world().temporalAgenda).find((item) => item.id === deadline.id);
    report.deadlines.push({ id: deadline.id, label: deadline.label, dueAtSeconds: deadline.dueAtSeconds, conditionsMetAtSeconds: allMet ? metAt : null, status: row?.status });
    if (!reachable || !allMet) issue("SMOKE_DEADLINE_UNREACHABLE", `${deadline.label} 无法通过真实结算达成`, { deadlineId: deadline.id });
    else if (row?.status !== "fulfilled") issue("SMOKE_DEADLINE_ONLY_LATE", `${deadline.label} 只能逾期达成`, { deadlineId: deadline.id, status: row?.status });
  }

  // 3. Skill boundaries hold in both directions.
  for (const template of list(pack.work).filter((row) => list(row.requiredSkillIds).length)) {
    const lacking = pack.stage.sceneCast.find((id) => !list(template.requiredSkillIds).every((skill) => skillsOf(id).has(skill)));
    if (!lacking) continue;
    const probe = createWorldRuntimeV27(state, { worldPack: pack, pacingMode: "scene", runStage: async () => { throw new Error("no model"); } });
    const actorWorld = probe.coordinator.worldState;
    const route = zonePath(topology, actorWorld.entities[lacking].zoneId, template.zoneId) || [];
    let version = probe.coordinator.journal.worldVersion;
    for (const step of route) {
      await probe.coordinator.submitActionAttempt({ attemptId: `smoke:skill:${template.templateId}:${step}`, actorId: lacking, primitive: "move", expectedWorldVersion: version, payload: { destinationId: step } });
      version = probe.coordinator.journal.worldVersion;
    }
    for (const toolId of list(template.toolIds)) {
      const tool = probe.coordinator.worldState.objects[toolId];
      if (tool && !tool.holderCharacterId && tool.zoneId === probe.coordinator.worldState.entities[lacking].zoneId) {
        await probe.coordinator.submitActionAttempt({ attemptId: `smoke:skill:take:${toolId}`, actorId: lacking, primitive: "handle", expectedWorldVersion: version, payload: { objectId: toolId, operation: "take" } });
        version = probe.coordinator.journal.worldVersion;
      }
    }
    const outcome = await probe.coordinator.submitActionAttempt({ attemptId: `smoke:skill:${template.templateId}`, actorId: lacking, primitive: "use_affordance", expectedWorldVersion: version,
      payload: { capabilityBinding: { capability: "work", operation: "start_work_unit", workTemplateId: template.templateId } } });
    const held = list(outcome.failedEffects).some((row) => row.code === "WORK_SKILL_MISSING");
    report.skillBoundaries.push({ templateId: template.templateId, actorId: lacking, status: outcome.status, held });
    if (!held) issue("SMOKE_SKILL_BOUNDARY_NOT_HELD", `${lacking} 不具备技能却能开始 ${template.templateId}`);
    for (const actor of probe.runtime.actors.values()) await actor.close?.();
  }
  for (const actor of instance.runtime.actors.values()) await actor.close?.();
  report.ok = report.issues.length === 0;
  return report;
}
