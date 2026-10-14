import assert from "node:assert/strict";
import { runLiveTurnLoop } from "../src/server/pipeline/liveTurnEngine.mjs";

const compact = { selectedLocation: { id: "loc_a", name: "储水区" }, ui: {}, visibleFacts: [] };
const sims = [
  { characterId: "char_a", characterName: "梅拉", targetCharacterId: "char_b", targetCharacterName: "卡里姆", pressure: 0.9, publicGoal: "逼表态", agentProfile: { leverageObject: "陶罐" } },
  { characterId: "char_b", characterName: "卡里姆", targetCharacterId: "char_a", targetCharacterName: "梅拉", pressure: 0.4, publicGoal: "拖延" },
  { characterId: "char_c", characterName: "莉莉", targetCharacterId: "char_a", targetCharacterName: "梅拉", pressure: 0.2, publicGoal: "劝和" },
];

// 剧本化的假 runTurn：验证调度、串联、离场、终止
const script = [
  { speech: "水位又低了一指，你打算什么时候说？", action: "指着水位线", moveIntent: "stay", innerNote: "先把他钉住" },
  { speech: "等勘探队回来再说。", action: "", moveIntent: "stay", innerNote: "不能现在认" },
  { speech: "勘探队三天前就该回来了。", action: "举起沙漏", moveIntent: "stay", innerNote: "" },
  { speech: "水位又低了一指，你打算什么时候说？", action: "", moveIntent: "stay", innerNote: "" }, // 重复台词→应被清空
  { speech: "", action: "把帆布袋甩上肩", moveIntent: "leave", exitReason: "去仓库清点", destinationId: "loc_storage", innerNote: "先走" },
  { speech: "", action: "", moveIntent: "pass", innerNote: "" },
  { speech: "", action: "", moveIntent: "pass", innerNote: "" },
];
let calls = 0;
const seenPrompts = [];
const fakeRunTurn = async ({ user }) => {
  seenPrompts.push(user);
  const parsed = script[Math.min(calls, script.length - 1)];
  calls += 1;
  return { parsed, meta: { model: "fake-live" } };
};

const result = await runLiveTurnLoop(compact, sims, { runTurn: fakeRunTurn, maxTurns: 12 });

// 1. 首发是压力最高者，之后轮转
assert.equal(result.turns[0].speakerId, "char_a");
assert.equal(result.turns[1].speakerId, "char_b");
assert.equal(result.turns[2].speakerId, "char_c");
// 2. observedTurnId/respondsTo 串联到最近一个他人回合
assert.equal(result.turns[1].observedTurnId, result.turns[0].turnId);
assert.equal(result.turns[1].respondsTo, result.turns[0].line);
// 3. 逐字重复的台词被清空（去重护栏）
assert.equal(result.turns[3].line, "");
// 4. 离场被记录，之后该角色不再获得回合
const leaveTurn = result.turns.find((turn) => turn.moveIntent === "leave");
assert.ok(leaveTurn, "剧本中的离场必须发生");
assert.ok(result.departures.includes(leaveTurn.speakerId));
const leaveIndex = result.turns.indexOf(leaveTurn);
assert.ok(!result.turns.slice(leaveIndex + 1).some((turn) => turn.speakerId === leaveTurn.speakerId), "离场者不得再获得回合");
// 5. 剩余在场者全部 pass 后循环终止（不打满 maxTurns）
assert.ok(result.turns.length < 12, `应提前终止，实际 ${result.turns.length} 回合`);
// 6. turn 形状与既有协议同形
const turn = result.turns[0];
for (const key of ["turnId", "generatedBy", "speakerId", "speakerName", "targetId", "targetName", "act", "topic", "proposition", "line", "turnRole", "observedTurnId", "observedUtterance", "respondsTo"]) {
  assert.ok(key in turn, `turn 缺少契约字段 ${key}`);
}
assert.equal(turn.generatedBy, "character-agent-model");
assert.equal(turn.act, "question");
assert.equal(turn.turnRole, "claim");
assert.equal(result.turns[1].turnRole, "response");
// 7. 后续回合的 prompt 里带着之前的公开转录
assert.ok(seenPrompts[1].includes("水位又低了一指"));
assert.ok(seenPrompts[1].includes("指着水位线"));
// 8. innerNote 不进入转录 prompt
assert.ok(!seenPrompts.slice(1).some((prompt) => prompt.includes("先把他钉住")), "innerNote 绝不进入他人 prompt");
// 9. stage 计量
assert.equal(result.stage.name, "AgentDialogue:LiveTurnLoop");
assert.equal(result.stage.turnCount, result.turns.length);
assert.equal(result.stage.model, "fake-live");

console.log("liveTurnLoopProtocol:test passed", { turns: result.turns.length, departures: result.departures });
