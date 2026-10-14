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
const actor = state.characters[0];
const target = state.characters[1];
const location = state.locations[0];

applyUpdateBundle({
  relationships: [
    {
      fromCharacterId: actor.id,
      toCharacterId: target.id,
      deltas: { resentment: 8, fear: 4, wantsToBeSeen: 5 },
      misreading: `${actor.name}把${target.name}的回应记成对自己判断权的挑战。`,
      unspoken: "证据不能走。",
      generatedFrom: "model-agent-dialogue",
      relationshipSource: "model-agent-exchange",
      sharedObject: "灵契",
      eventOutcome: `${actor.name}把灵契推向${target.name}，没有人立刻盖印。`,
      finalTurn: "证据不能走。",
      followupTurn: "你要谁替你盖印？",
      dialogueTurnCount: 4,
    },
  ],
});

state = getState();
const rel = state.relationships.find((item) => item.fromCharacterId === actor.id && item.toCharacterId === target.id);

assert.equal(rel?.lastDialogue?.sharedObject, "灵契", "accepted relationship should remember the contested object");
assert.equal(rel?.lastDialogue?.finalTurn, "证据不能走。", "accepted relationship should remember the final spoken turn");
assert.equal(rel?.lastDialogue?.eventOutcome, `${actor.name}把灵契推向${target.name}，没有人立刻盖印。`, "accepted relationship should remember the event outcome");
assert.equal(rel?.lastDialogue?.dialogueTurnCount, 4, "accepted relationship should remember dialogue depth");

const output = characterAgent({
  state,
  character: actor,
  activeCharacters: [actor, target],
  location,
});

assert.equal(output.relationshipDialogueMemory?.sharedObject, "灵契", "agent output should expose the relationship's last dialogue object");
assert.match(
  `${output.relationshipPressureSummary} ${output.desireReason}`,
  /灵契|证据不能走|盖印/,
  "agent output should let the previous dialogue scene shape the next hidden action",
);

console.log("relationshipDialogueStateCarriesScene:test passed", {
  lastDialogue: rel.lastDialogue,
  relationshipPressureSummary: output.relationshipPressureSummary,
});
