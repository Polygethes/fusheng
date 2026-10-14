import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});

const shen = state.characters.find((item) => item.id === "char_xianxia_shenheng");
const lu = state.characters.find((item) => item.id === "char_xianxia_luqingluo");
const gate = state.locations.find((item) => item.name === "四方法契门");
const market = state.locations.find((item) => item.name === "无咎市");
assert.ok(shen && lu && gate && market, "fixture should expose xianxia characters and locations");

const oldDialogue = {
  source: "agent-dialogue-relationship",
  relationshipSource: "agent-exchange",
  sharedObject: "灵契",
  eventOutcome: "灵契被留在四方法契门的铜盘里。",
  finalTurn: "灵契先留在铜盘里。",
  followupTurn: "你扣的是灵契，还是血河楼的翻案证物？",
  dialogueTurnCount: 4,
  dialogueTurns: [
    { speakerId: shen.id, speakerName: shen.name, targetId: lu.id, targetName: lu.name, line: "灵契先别离开。", turnRole: "claim" },
    { speakerId: lu.id, speakerName: lu.name, targetId: shen.id, targetName: shen.name, line: "药炉前不问正邪。", turnRole: "response" },
  ],
  locationId: gate.id,
  locationName: gate.name,
};

state.relationships = [{
  fromCharacterId: shen.id,
  toCharacterId: lu.id,
  deltas: { resentment: 20, wantsToBeSeen: 12, power: 8 },
  misreading: "沈珩把鹿青萝的庇护听成对城规的回避。",
  unspoken: "沈珩还想把旧案压回铜盘。",
  lastDialogue: oldDialogue,
}, {
  fromCharacterId: lu.id,
  toCharacterId: shen.id,
  deltas: { protection: 18, wantsToEscape: 8, fear: 4 },
  misreading: "鹿青萝把沈珩的扣留听成会伤到病人。",
  unspoken: "鹿青萝不愿让医坊庇护权被旧案拖走。",
  lastDialogue: oldDialogue,
}];
state.characterMemories = [];
state.ui.timeGrain = "scene";
state.ui.focusMode = "location";
state.ui.activeTab = "observe";
state.ui.activeCharacterIds = [shen.id, lu.id];
state.ui.selectedLocationId = market.id;

const draft = playNext(state);
const pairShift = (draft.relationshipShift || []).find((shift) =>
  shift.generatedFrom === "agent-dialogue-relationship"
  && shift.fromCharacterId === shen.id
  && shift.toCharacterId === lu.id
);
assert.ok(pairShift, "scene should produce a dialogue relationship shift for the active pair");

const visibleText = (draft.agentOutputs || []).map((output) => output.visibleAction).join("\n");
assert.doesNotMatch(
  visibleText,
  /铜盘/,
  `market scene should not visibly stay at the old gate surface, got:\n${visibleText}`,
);
assert.match(
  visibleText,
  /妖丹盒|案台|庇护牌|药炉/,
  `market scene should visibly use current market or healer objects, got:\n${visibleText}`,
);
assert.notEqual(pairShift.sharedObject, "灵契", "new relationship event should not reuse the old gate object as its primary shared object");
assert.match(
  `${pairShift.sharedObject} ${pairShift.eventOutcome}`,
  /妖丹盒|案台|庇护牌|药炉/,
  `relationship event should be anchored to current scene objects, got:\n${JSON.stringify(pairShift, null, 2)}`,
);
assert.doesNotMatch(
  `${pairShift.eventOutcome} ${(pairShift.dialogueTurns || []).map((turn) => turn.line).join(" ")}`,
  /贴着界石|留给界石|盖印|铜盘/,
  `market dialogue should not keep using contract-gate procedural language, got:\n${JSON.stringify(pairShift, null, 2)}`,
);

console.log("relationshipMemoryKeepsCurrentSceneObject:test passed", {
  sharedObject: pairShift.sharedObject,
  eventOutcome: pairShift.eventOutcome,
});

const yanState = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});
const yanShen = yanState.characters.find((item) => item.id === "char_xianxia_shenheng");
const yan = yanState.characters.find((item) => item.id === "char_xianxia_yanwujie");
const yanGate = yanState.locations.find((item) => item.name === "四方法契门");
const yanMarket = yanState.locations.find((item) => item.name === "无咎市");
assert.ok(yanShen && yan && yanGate && yanMarket, "yan fixture should expose xianxia characters and locations");

const oldYanDialogue = {
  ...oldDialogue,
  sharedObject: "灵契",
  locationId: yanGate.id,
  locationName: yanGate.name,
  dialogueTurns: [
    { speakerId: yanShen.id, speakerName: yanShen.name, targetId: yan.id, targetName: yan.name, line: "灵契先别离开。", turnRole: "claim" },
    { speakerId: yan.id, speakerName: yan.name, targetId: yanShen.id, targetName: yanShen.name, line: "我押的是灵契，不是命。", turnRole: "response" },
  ],
};
yanState.relationships = [{
  fromCharacterId: yanShen.id,
  toCharacterId: yan.id,
  deltas: { resentment: 22, wantsToBeSeen: 12, power: 8 },
  misreading: "沈珩把阎无咎的符听成旧案还在躲。",
  unspoken: "沈珩想把旧案压回契门。",
  lastDialogue: oldYanDialogue,
}, {
  fromCharacterId: yan.id,
  toCharacterId: yanShen.id,
  deltas: { deception: 18, wantsToEscape: 8, fear: 4 },
  misreading: "阎无咎把沈珩的扣留听成正道还要夺证。",
  unspoken: "阎无咎不愿让市集交易被旧案拖回契门。",
  lastDialogue: oldYanDialogue,
}];
yanState.characterMemories = [];
yanState.ui.timeGrain = "scene";
yanState.ui.focusMode = "location";
yanState.ui.activeTab = "observe";
yanState.ui.activeCharacterIds = [yanShen.id, yan.id];
yanState.ui.selectedLocationId = yanMarket.id;

const yanDraft = playNext(yanState);
const yanShift = (yanDraft.relationshipShift || []).find((shift) =>
  shift.generatedFrom === "agent-dialogue-relationship"
  && shift.fromCharacterId === yanShen.id
  && shift.toCharacterId === yan.id
);
assert.ok(yanShift, "market scene should produce a dialogue relationship shift for the xianxia envoy pair");
assert.equal(yanShift.sharedObject, "妖丹盒", "envoy market event should use the market object as its shared object");
assert.doesNotMatch(
  `${yanShift.eventOutcome} ${(yanShift.dialogueTurns || []).map((turn) => turn.line).join(" ")}`,
  /妖丹盒贴着界石|符留给界石|魔印留给界石|盖印|铜盘/,
  `envoy market dialogue should not turn symbol handling into contract-gate procedure, got:\n${JSON.stringify(yanShift, null, 2)}`,
);
