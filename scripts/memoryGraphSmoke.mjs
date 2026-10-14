import assert from "node:assert/strict";
import {
  getState,
  resetState,
  addCharacterMemory,
  updateCharacterMemory,
  deleteCharacterMemory,
} from "../src/state/store.js";
import { buildEvidenceGraph, getCharacterMemories } from "../src/state/memoryGraph.js";

resetState();
const memory = addCharacterMemory({
  characterId: "char_shen",
  targetCharacterId: "char_lin",
  type: "selective",
  stance: "self_defense",
  content: "他把她的沉默记成审判，又把自己的等待记成教学敏感。",
  publicVersion: "这只是课堂判断。",
  privateVersion: "他在等待她知道自己被等待。",
  distortion: "把欲望写成标准，把标准写成清白。",
  reliability: 48,
  heat: 70,
});
assert.ok(memory.id, "memory should be created");
updateCharacterMemory(memory.id, { type: "weaponized", stance: "revenge", reliability: 32, heat: 82 });
let state = getState();
let updated = getCharacterMemories(state, "char_shen").find((item) => item.id === memory.id);
assert.equal(updated.type, "weaponized", "memory should become weaponized");
assert.equal(updated.stance, "revenge", "memory stance should become revenge");
const graph = buildEvidenceGraph(state);
assert.ok(graph.nodes.some((node) => node.id === memory.id && node.type === "memory"), "memory node should appear");
assert.ok(graph.edges.some((edge) => edge.from === memory.id && edge.to === "char_shen"), "memory should link to remembering character");
deleteCharacterMemory(memory.id);
state = getState();
assert.ok(!state.characterMemories.some((item) => item.id === memory.id), "memory should be deleted");
console.log("memoryGraph:smoke ok", { nodes: graph.nodes.length, edges: graph.edges.length });
