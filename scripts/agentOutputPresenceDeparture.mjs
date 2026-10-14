import assert from "node:assert/strict";
import { attachInteractionCausalityToAgentOutputs } from "../src/server/pipeline/openaiPipeline.mjs";

const outputs = attachInteractionCausalityToAgentOutputs([{
  characterId: "yan",
  targetCharacterId: "shen",
  visibleAction: "阎无咎把魔印压在铜盘边。",
  realtimeActionCandidate: "阎无咎把魔印压在铜盘边。",
}], {
  agentExchanges: [],
  interactionBeats: [],
  presenceChanges: [{
    characterId: "yan",
    decision: "leave",
    destinationId: "alley",
    destinationName: "后巷",
    visibleDeparture: "阎无咎撞开侧门，退进后巷。",
  }],
}, { activeCharacters: [{ id: "yan", name: "阎无咎" }, { id: "shen", name: "沈珩" }] });

assert.equal(outputs[0].presenceDecision, "leave");
assert.equal(outputs[0].currentLocationId, "alley");
assert.match(outputs[0].visibleAction, /撞开侧门/);

console.log("agentOutputPresenceDeparture:test passed", { action: outputs[0].visibleAction });
