import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { buildEvidenceGraph, getCharacterMemories, buildMemoryConflictSummary } from "../src/state/memoryGraph.js";

const state = structuredClone(initialState);
state.canonEvents = [
  {
    id: "canon_test",
    title: "测试正史：走廊里的停顿",
    sourceDraftId: "draft_test",
    participantIds: ["char_gregor", "char_grete"],
    summary: "两个人在走廊里把同一个停顿记成两件不同的事。",
  },
];
state.evidence = [
  {
    id: "ev_test",
    type: "document",
    content: "一份被删改过的批注记录",
    ownerCharacterId: "char_grete",
    sourceDraftId: "draft_test",
    canBeMisreadAs: "特殊关注或证据保全",
  },
];
state.characterMemories.push({
  id: "mem_test",
  characterId: "char_grete",
  targetCharacterId: "char_gregor",
  type: "weaponized",
  stance: "revenge",
  content: "她记得他删掉的那句话，也记得自己想把它留下来。",
  publicVersion: "保存证据。",
  privateVersion: "保留他看见过自己的痕迹。",
  distortion: "把被看见和报复捆在同一份证据里。",
  reliability: 41,
  heat: 82,
});

const memories = getCharacterMemories(state, "char_grete");
assert.ok(memories.length >= 2, "格蕾特应当至少有种子记忆与测试记忆");

const summary = buildMemoryConflictSummary(state, "char_grete");
assert.equal(summary.revenge >= 1, true, "记忆冲突摘要应识别报复立场");
assert.equal(summary.distorted >= 1, true, "记忆冲突摘要应识别扭曲记忆");

const graph = buildEvidenceGraph(state, { focusCharacterId: "char_grete" });
assert.equal(graph.nodes.some((node) => node.id === "mem_test"), true, "证据图谱应包含记忆节点");
assert.equal(graph.nodes.some((node) => node.id === "ev_test"), true, "证据图谱应包含证据节点");
assert.equal(graph.edges.some((edge) => edge.type === "remembered_by"), true, "证据图谱应包含人物记忆边");
assert.equal(graph.edges.some((edge) => edge.type === "points_to"), true, "证据应指向正史");

console.log("memoryGraph:test passed", graph.stats);
