import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { auditMemoryUse, buildMemoryAudit } from "../src/state/memoryAudit.js";
import { playNext } from "../src/engine/mockEngine.js";

const state = structuredClone(initialState);
state.ui.activeCharacterIds = ["char_gregor", "char_grete"];
state.characterMemories.push({
  id: "mem_audit_hot",
  projectId: state.project.id,
  branchId: state.ui.activeBranchId || state.project.activeBranchId,
  characterId: "char_gregor",
  targetCharacterId: "char_grete",
  type: "weaponized",
  stance: "revenge",
  content: "他把她上一次停顿记成对自己的审判。",
  publicVersion: "她不够稳定。",
  privateVersion: "她知道我在等她反应。",
  distortion: "把等待改写成标准，把标准改写成惩罚。",
  reliability: 38,
  heat: 88,
});

const shallowDraft = {
  id: "draft_memory_shallow",
  participantIds: ["char_gregor", "char_grete"],
  sceneText: "两个人正常交谈，事情体面解决。",
  agentOutputs: [
    { characterId: "char_gregor", targetCharacterId: "char_grete", tone: "保护", visibleAction: "他说明规则。", hiddenAction: "他保持距离。", defenseAction: "按原则。", shadowAction: "无。" },
    { characterId: "char_grete", targetCharacterId: "char_gregor", tone: "保护", visibleAction: "她接受安排。", hiddenAction: "她沉默。", defenseAction: "保持体面。", shadowAction: "无。" },
  ],
  subtextMatrix: [],
  relationshipShift: [],
  irreversibleTraces: [],
};
const shallowAudit = auditMemoryUse(shallowDraft, state);
assert.ok(shallowAudit.ignoredMemoryRisk > 40, "high heat memory should be penalized if ignored");
assert.ok(shallowAudit.requiredFixes.length, "memory audit should request repairs");

const draft = playNext(state);
const audit = auditMemoryUse(draft, state);
assert.ok(audit.memoryChangedActionScore >= 30, "mock engine should let memory influence action");
assert.ok(audit.usedMemories.length >= 1, "mock engine should report used memory");
const compatibility = buildMemoryAudit(state, draft);
assert.ok(Array.isArray(compatibility.perCharacter), "compat audit should include perCharacter rows");
assert.ok(typeof compatibility.memoryPressureScore === "number", "compat audit should expose new memory score");
console.log("memoryAudit:test passed", {
  ignoredMemoryRisk: shallowAudit.ignoredMemoryRisk,
  memoryChangedActionScore: audit.memoryChangedActionScore,
  usedMemories: audit.usedMemories.length,
});
