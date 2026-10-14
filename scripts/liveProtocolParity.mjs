import assert from "node:assert/strict";
import { liveProtocolFromTurns } from "../src/server/pipeline/liveTurnEngine.mjs";

const sims = [
  { characterId: "char_a", characterName: "梅拉", targetCharacterId: "char_b", targetCharacterName: "卡里姆", publicGoal: "逼表态", exitUrgency: 0.1 },
  { characterId: "char_b", characterName: "卡里姆", targetCharacterId: "char_a", targetCharacterName: "梅拉", publicGoal: "拖延", exitUrgency: 0.2 },
];
const loopResult = {
  turns: [
    { turnId: "t1", generatedBy: "character-agent-model", speakerId: "char_a", speakerName: "梅拉", targetId: "char_b", targetName: "卡里姆", act: "question", topic: "陶罐", proposition: "逼表态", line: "你打算什么时候说？", turnRole: "claim", observedTurnId: "", observedUtterance: "", respondsTo: "", action: "指着水位线", moveIntent: "stay", exitReason: "", destinationId: "", innerNote: "钉住他" },
    { turnId: "t2", generatedBy: "character-agent-model", speakerId: "char_b", speakerName: "卡里姆", targetId: "char_a", targetName: "梅拉", act: "refuse", topic: "陶罐", proposition: "拖延", line: "等勘探队回来。", turnRole: "response", observedTurnId: "t1", observedUtterance: "你打算什么时候说？", respondsTo: "你打算什么时候说？", action: "", moveIntent: "stay", exitReason: "", destinationId: "", innerNote: "" },
    { turnId: "t3", generatedBy: "character-agent-model", speakerId: "char_b", speakerName: "卡里姆", targetId: "char_a", targetName: "梅拉", act: "silence", topic: "陶罐", proposition: "拖延", line: "", turnRole: "response", observedTurnId: "t1", observedUtterance: "", respondsTo: "", action: "甩上帆布袋", moveIntent: "leave", exitReason: "去仓库清点", destinationId: "loc_storage", innerNote: "先走" },
  ],
  departures: ["char_b"],
};

const protocol = liveProtocolFromTurns({}, sims, loopResult);

// 1. 输出契约与 buildModelAgentDialogueProtocol 同构
assert.ok(Array.isArray(protocol.privateSimulations));
assert.ok(Array.isArray(protocol.agentExchanges));
const exchange = protocol.agentExchanges[0];
for (const key of ["sourceCharacterId", "sourceCharacterName", "responseCharacterId", "responseCharacterName", "sharedObject", "dialogueTurns"]) {
  assert.ok(key in exchange, `exchange 缺少契约字段 ${key}`);
}
assert.equal(exchange.sourceCharacterId, "char_a");
assert.equal(exchange.responseCharacterId, "char_b");
assert.equal(exchange.sharedObject, "陶罐");
// 2. 台词逐字保留（只收有 line 的回合）
assert.deepEqual(exchange.dialogueTurns.map((turn) => turn.line), ["你打算什么时候说？", "等勘探队回来。"]);
// 3. 私人模拟增强：dialogueExchangeTurns / dialogueDecision / cognitiveDecision
const simA = protocol.privateSimulations.find((sim) => sim.characterId === "char_a");
assert.equal(simA.dialogueExchangeTurns.length, 1);
assert.equal(simA.dialogueDecision.line, "你打算什么时候说？");
assert.equal(simA.cognitiveDecision.reaction, "talk");
assert.equal(simA.cognitiveDecision.reason, "钉住他");
// 4. 离场写回既有 exit 字段
const simB = protocol.privateSimulations.find((sim) => sim.characterId === "char_b");
assert.equal(simB.presenceIntent, "leave");
assert.equal(simB.exitReason, "去仓库清点");
assert.equal(simB.desiredDestinationId, "loc_storage");
assert.ok(Number(simB.exitUrgency) >= 0.8);
assert.equal(simB.cognitiveDecision.reaction, "leave");
// 5. innerNote 不进入任何公开结构
assert.ok(!JSON.stringify(protocol.agentExchanges).includes("钉住他"), "innerNote 泄漏进 agentExchanges");
assert.ok(!JSON.stringify(simA.dialogueExchangeTurns).includes("钉住他"), "innerNote 泄漏进 dialogueExchangeTurns");
// 6. 没有台词的对局不造 exchange
const silent = liveProtocolFromTurns({}, sims, { turns: [loopResult.turns[2]], departures: [] });
assert.equal(silent.agentExchanges.length, 0);

console.log("liveProtocolParity:test passed");
