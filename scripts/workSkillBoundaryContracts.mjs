import assert from "node:assert/strict";
import {
  buildWorkCapabilityStateFromTemplates,
  listWorkCapabilityAffordances,
  settleWorkCapabilityAffordance,
} from "../src/server/simulation/workCapability.mjs";

const templates = [
  { templateId: "repair_array", taskKind: "repair", zoneId: "array_eye", taskLabel: "补北侧阵纹", unitAction: "刻补一段阵纹",
    requiredUnits: 3, unitLabel: "段", requiredSkillIds: ["array_craft"], requiredSkillLabel: "阵法",
    objectIds: ["array_line"], toolIds: [], durationSecondsPerUnit: 60,
    completionEffects: { objectNumericDeltas: [{ objectId: "array_line", path: ["litSegments"], delta: 1, maximum: 3 }] } },
  { templateId: "cook_porridge", taskKind: "cooking", zoneId: "array_eye", taskLabel: "熬粥", unitAction: "熬一锅粥",
    requiredUnits: 1, objectIds: [], toolIds: [], durationSecondsPerUnit: 60 },
];
const work = buildWorkCapabilityStateFromTemplates(templates);
assert.deepEqual(work.definitions.repair_array.requiredSkillIds, ["array_craft"]);
assert.equal(Object.hasOwn(work.definitions.cook_porridge, "requiredSkillIds"), false, "templates without a skill keep their old shape");

const person = (id, skills) => ({ id, kind: "character", name: id, present: true, placeId: "p", zoneId: "array_eye", ...(skills ? { skills } : {}) });
const state = {
  nowSeconds: 0,
  entities: { child: person("child", ["sword_affinity"]), father: person("father", ["array_craft"]) },
  objects: { array_line: { id: "array_line", placeId: "p", zoneId: "array_eye", state: { litSegments: 0 } } },
  processes: [],
  places: { p: { id: "p", topology: { zones: { array_eye: { id: "array_eye" } }, edges: [] }, workCapability: work } },
};
const attempt = (actorId, workTemplateId) => ({ attemptId: `attempt:${actorId}:${workTemplateId}`, actorId, primitive: "use_affordance",
  payload: { capabilityBinding: { capability: "work", operation: "start_work_unit", workTemplateId } } });

const childTry = settleWorkCapabilityAffordance({ state, attempt: attempt("child", "repair_array") });
assert.equal(childTry.status, "failed");
assert.deepEqual(childTry.failedEffects, [{ code: "WORK_SKILL_MISSING", skillIds: ["array_craft"] }]);
assert.equal(childTry.statePatch.operations.length, 0, "a failed attempt changes nothing in the world");

const fatherTry = settleWorkCapabilityAffordance({ state, attempt: attempt("father", "repair_array") });
assert.equal(fatherTry.status, "success");
assert.equal(settleWorkCapabilityAffordance({ state, attempt: attempt("child", "cook_porridge") }).status, "success",
  "work without a declared skill stays open to everyone");

const listed = listWorkCapabilityAffordances({ state, actorId: "child" }).affordances.find((row) => row.workTemplateId === "repair_array");
assert.ok(listed, "a person may still see and attempt work beyond their skill");
assert.equal(listed.public.currentlyExecutable, false);
assert.ok(listed.public.physicalPrerequisites.some((line) => line.includes("阵法")), "the person knows they lack the skill");

console.log("Work skill boundary passed: work beyond a person's skill fails in settlement without changing the world.");
