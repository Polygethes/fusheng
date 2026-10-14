import assert from "node:assert/strict";
import { attachInteractionCausalityToAgentOutputs } from "../src/server/pipeline/openaiPipeline.mjs";

const compact = {
  activeCharacters: [
    { id: "char_a", name: "沈珩" },
    { id: "char_b", name: "阎无咎" },
  ],
};

const agentOutputs = [
  {
    characterId: "char_a",
    targetCharacterId: "char_b",
    tone: "求证",
    visibleAction: "沈珩把契牌扣进铜盘。",
    hiddenAction: "要逼出旧案证词。",
    defenseAction: "按城法扣契。",
  },
  {
    characterId: "char_b",
    targetCharacterId: "char_a",
    tone: "试探",
    visibleAction: "阎无咎准备递毒誓符。",
    hiddenAction: "要换回出城令。",
    defenseAction: "押的是灵契。",
  },
];

const sceneInteraction = {
  interactionBeats: [
    {
      actorId: "char_a",
      actorName: "沈珩",
      targetId: "char_b",
      targetName: "阎无咎",
      beat: "沈珩把契牌扣进铜盘，阎无咎没有接剑匣，先把毒誓符压到铜盘边。",
      privateIntent: "逼问旧案证词。",
      defensiveMask: "按城法扣契。",
      shadowLeak: "借城法留下人。",
    },
  ],
};

const attached = attachInteractionCausalityToAgentOutputs(agentOutputs, sceneInteraction, compact);
const first = attached[0];
const second = attached[1];

assert.ok(first.outputId, "model output should get a stable output id");
assert.equal(first.interactionRole, "initiator", "first model output should be initiator");
assert.equal(second.interactionRole, "responder", "second model output should be responder");
assert.equal(second.interactionInput.sourceOutputId, first.outputId, "model responder should receive prior output id");
assert.equal(second.interactionInput.observedVisibleAction, first.visibleAction, "model responder should observe prior visible action");
assert.equal(second.reactsToOutputId, first.outputId, "model responder should preserve causal link");
assert.match(second.visibleAction, /毒誓符压到铜盘边/, "model responder action should prefer sceneInteraction's concrete beat");

console.log("modelInteractionCausality:test passed", {
  initiator: first.visibleAction,
  responder: second.visibleAction,
});
