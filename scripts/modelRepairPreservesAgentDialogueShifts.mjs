import assert from "node:assert/strict";
import * as pipeline from "../src/server/pipeline/openaiPipeline.mjs";

assert.equal(
  typeof pipeline.applyRepairedFields,
  "function",
  "model pipeline should expose repair merging for regression testing without API calls",
);

const dialogueShift = {
  fromCharacterId: "char_shen",
  toCharacterId: "char_yan",
  deltas: { resentment: 2, wantsToBeSeen: 3 },
  misreading: "沈珩把阎无咎的追问记成对自己判断权的挑战。",
  unspoken: "证据不能走。",
  generatedFrom: "model-agent-dialogue",
  dialogueTurnCount: 4,
  eventOutcome: "沈珩把灵契留在铜盘边，阎无咎没有把符拿走。",
  sharedObject: "灵契",
  finalTurn: "你要谁替你盖印？",
  followupTurn: "你要谁替你盖印？",
  relationshipSource: "model-agent-exchange",
};

const draft = {
  surfaceEvent: "旧场景",
  sceneText: "旧文本",
  agentOutputs: [{ characterId: "char_shen", targetCharacterId: "char_yan", visibleAction: "旧动作" }],
  subtextMatrix: [],
  relationshipShift: [
    dialogueShift,
    {
      fromCharacterId: "char_yan",
      toCharacterId: "char_shen",
      deltas: { fear: 2 },
      misreading: "阎无咎把沈珩的扣契听成逼近。",
      unspoken: "我押的是灵契，不是命。",
      generatedFrom: "model-agent-dialogue",
      dialogueTurnCount: 4,
      eventOutcome: "沈珩把灵契留在铜盘边，阎无咎没有把符拿走。",
      sharedObject: "灵契",
      finalTurn: "你要谁替你盖印？",
      followupTurn: "你要谁替你盖印？",
      relationshipSource: "model-agent-exchange",
    },
  ],
  irreversibleTraces: ["旧痕迹"],
};

const repaired = {
  surfaceEvent: "修复场景",
  sceneText: "修复文本",
  agentOutputs: [{ characterId: "char_shen", targetCharacterId: "char_yan", visibleAction: "修复动作" }],
  subtextMatrix: [],
  relationshipShift: [
    {
      fromCharacterId: "char_shen",
      toCharacterId: "char_yan",
      deltas: { shame: 2 },
      misreading: "修复后的额外误读。",
      unspoken: "修复后的未说出口。",
    },
  ],
  irreversibleTraces: ["修复痕迹"],
  repairNotes: "修复了记忆压力。",
};

const next = pipeline.applyRepairedFields(draft, repaired);

assert.ok(
  next.relationshipShift.some((shift) =>
    shift.generatedFrom === "model-agent-dialogue"
    && shift.followupTurn === "你要谁替你盖印？"
    && shift.sharedObject === "灵契"
  ),
  "repair should preserve dialogue-derived relationship shifts for memory persistence",
);
assert.ok(
  next.relationshipShift.some((shift) => shift.misreading === "修复后的额外误读。"),
  "repair should still keep repaired relationship shifts",
);
assert.equal(
  next.relationshipShift.filter((shift) => shift.generatedFrom === "model-agent-dialogue").length,
  2,
  "repair should preserve both directions of model agent dialogue shifts",
);

console.log("modelRepairPreservesAgentDialogueShifts:test passed", {
  relationshipShift: next.relationshipShift,
});
