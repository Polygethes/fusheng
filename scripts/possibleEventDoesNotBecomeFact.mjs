import assert from "node:assert/strict";
import * as pipeline from "../src/server/pipeline/openaiPipeline.mjs";

assert.equal(typeof pipeline.buildBalancedBackgroundNovel, "function", "background compression should be independently testable");

const location = {
  id: "loc_xyy_sword_tower",
  name: "梯云宗剑阁",
  visibleUse: "九重关隘以剑痕验证弟子走到哪一步。",
  likelyEvents: ["第九重传出剑鸣", "闯关弟子在门内力竭"],
};
const actualAction = "陈砚收起练功册，从剑阁门前让开。";
const novel = pipeline.buildBalancedBackgroundNovel({
  location,
  slot: { label: "上午" },
  sceneDraft: {
    agentOutputs: [{ characterId: "char_chen", visibleAction: actualAction }],
  },
  slotIndex: 0,
  usedDetails: new Set(),
  usedActions: new Set(),
  activeCharacters: [{ id: "char_chen", name: "陈砚" }],
});

assert.match(novel, /陈砚收起练功册/, "far view should report an action the agent actually executed");
for (const possibility of location.likelyEvents) {
  assert.ok(!novel.includes(possibility), `a possible event cannot be asserted without an agent cause: ${possibility}`);
}

console.log("possibleEventDoesNotBecomeFact:test passed", { novel });
