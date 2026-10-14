import assert from "node:assert/strict";
import { characterAgent } from "../src/engine/mockEngine.js";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};

const {
  applySetupWorld,
  applyUpdateBundle,
  getState,
  resetState,
} = await import("../src/state/store.js");

resetState();
applySetupWorld({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});

let state = getState();
const actor = state.characters.find((item) => item.id === "char_xianxia_shenheng") || state.characters[0];
const target = state.characters.find((item) => item.id === "char_xianxia_yanwujie") || state.characters[1];
const location = state.locations.find((item) => item.id === "loc_xianxia_contract_gate") || state.locations[0];

applyUpdateBundle({
  relationships: [
    {
      fromCharacterId: actor.id,
      toCharacterId: target.id,
      deltas: { power: 5, wantsToBeSeen: 3, deception: 1 },
      misreading: `${actor.name}把${target.name}的追问记成解释权被夺。`,
      unspoken: "灵契还压在铜盘里，谁也不能替谁写名字。",
      generatedFrom: "agent-dialogue-relationship",
      relationshipSource: "agent-exchange",
      sharedObject: "灵契",
      locationId: location.id,
      locationName: location.name,
      eventOutcome: "灵契被留在铜盘，守门人没有盖印。",
      finalTurn: "我先答证据；灵契留在铜盘，谁碰过它谁站出来。",
      followupTurn: "我不答私账；灵契不能离开铜盘，除非你交代证据来源。",
      dialogueTurnCount: 5,
      relationshipDialogueAct: {
        kind: "control",
        reason: `${actor.name}用灵契和铜盘争夺解释权。`,
        deltas: { power: 3, wantsToBeSeen: 1 },
      },
      dialogueTurns: [
        { speakerId: actor.id, speakerName: actor.name, targetId: target.id, targetName: target.name, line: "灵契留在铜盘。", turnRole: "claim" },
        { speakerId: target.id, speakerName: target.name, targetId: actor.id, targetName: actor.name, line: "你要谁替你盖印？", turnRole: "response" },
        { speakerId: actor.id, speakerName: actor.name, targetId: target.id, targetName: target.name, line: "我先答证据；灵契留在铜盘，谁碰过它谁站出来。", turnRole: "counter" },
        { speakerId: target.id, speakerName: target.name, targetId: actor.id, targetName: actor.name, line: "灵契不进暗账。", turnRole: "turn" },
        { speakerId: actor.id, speakerName: actor.name, targetId: target.id, targetName: target.name, line: "我不答私账；灵契不能离开铜盘，除非你交代证据来源。", turnRole: "state_reply" },
      ],
    },
  ],
});

state = getState();
const rel = state.relationships.find((item) => item.fromCharacterId === actor.id && item.toCharacterId === target.id);

assert.ok(rel?.relationshipArc, "accepted dialogue should persist a relationshipArc on the relationship");
assert.equal(rel.relationshipArc.kind, "control", "relationshipArc should keep the dialogue act kind");
assert.match(rel.relationshipArc.label || "", /解释权|控制|命名|见证/, "relationshipArc should name the evolved relationship state");
assert.match(rel.relationshipArc.currentObligation || "", /灵契|铜盘|证据来源|交代/, "relationshipArc should preserve the concrete obligation created by the dialogue");

const output = characterAgent({
  state,
  character: actor,
  activeCharacters: [actor, target],
  location,
});

assert.ok(output.relationshipArcSummary, "agent output should expose relationshipArcSummary");
assert.match(
  `${output.relationshipArcSummary} ${output.desireReason} ${output.relationshipPressureSummary}`,
  /解释权|灵契|铜盘|证据来源|交代/,
  "persisted relationshipArc should shape the next agent decision in concrete dramatic terms",
);

console.log("relationshipArcPersistsAndShapesAgent:test passed", {
  arc: rel.relationshipArc,
  summary: output.relationshipArcSummary,
});
