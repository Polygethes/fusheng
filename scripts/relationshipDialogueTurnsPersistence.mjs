import assert from "node:assert/strict";

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
const conductorSignal = {
  beatId: "beat_contract_gate_1",
  delivery: "object",
  object: "灵契",
  inWorldClue: "界石忽然照出两道相互缠住的灵痕。",
  pressureCue: "铜盘下方的旧印先亮了一下",
  target: actor.id,
};
const relationshipDialogueAct = {
  kind: "control",
  deltas: { power: 3, wantsToBeSeen: 1 },
  reason: `${actor.name}用灵契争夺城规、名字或解释权。`,
};

const dialogueTurns = [
  {
    speakerId: actor.id,
    speakerName: actor.name,
    targetId: target.id,
    targetName: target.name,
    line: "按城法扣契，不按宗门私仇。",
    turnRole: "claim",
    triggeredBy: conductorSignal.inWorldClue,
  },
  {
    speakerId: target.id,
    speakerName: target.name,
    targetId: actor.id,
    targetName: actor.name,
    line: "我押的是灵契，不是命。",
    turnRole: "response",
    triggeredBy: conductorSignal.inWorldClue,
  },
  {
    speakerId: actor.id,
    speakerName: actor.name,
    targetId: target.id,
    targetName: target.name,
    line: "剑可以停，证据不能走。",
    turnRole: "counter",
    triggeredBy: conductorSignal.inWorldClue,
  },
  {
    speakerId: target.id,
    speakerName: target.name,
    targetId: actor.id,
    targetName: actor.name,
    line: "那你要谁替你盖印？",
    turnRole: "turn",
    triggeredBy: conductorSignal.inWorldClue,
  },
];

applyUpdateBundle({
  relationships: [
    {
      fromCharacterId: actor.id,
      toCharacterId: target.id,
      deltas: { resentment: 8, fear: 4, wantsToBeSeen: 5 },
      misreading: `${actor.name}把${target.name}的追问记成逼自己让步。`,
      unspoken: "证据不能走。",
      generatedFrom: "model-agent-dialogue",
      relationshipSource: "model-agent-exchange",
      sharedObject: "灵契",
      triggeredBy: conductorSignal.inWorldClue,
      conductorSignal,
      relationshipDialogueAct,
      eventOutcome: `${actor.name}把灵契推向${target.name}，守门人没有盖印。`,
      finalTurn: dialogueTurns.at(-1).line,
      followupTurn: dialogueTurns.at(-1).line,
      dialogueTurnCount: dialogueTurns.length,
      dialogueTurns,
    },
  ],
});

state = getState();
const rel = state.relationships.find((item) => item.fromCharacterId === actor.id && item.toCharacterId === target.id);

assert.equal(rel?.lastDialogue?.dialogueTurnCount, 4, "relationship should keep dialogue depth");
assert.deepEqual(
  rel?.lastDialogue?.dialogueTurns?.map((turn) => turn.line),
  dialogueTurns.map((turn) => turn.line),
  "lastDialogue should preserve the complete exchange in order",
);
assert.deepEqual(
  rel?.dialogueHistory?.at(-1)?.dialogueTurns?.map((turn) => turn.line),
  dialogueTurns.map((turn) => turn.line),
  "dialogueHistory should preserve the same complete exchange",
);
assert.equal(
  rel?.lastDialogue?.triggeredBy,
  conductorSignal.inWorldClue,
  "lastDialogue should remember the in-world clue that caused the dialogue",
);
assert.equal(
  rel?.lastDialogue?.conductorSignal?.object,
  conductorSignal.object,
  "lastDialogue should keep the conductor signal object for later retrieval",
);
assert.equal(
  rel?.lastDialogue?.relationshipDialogueAct?.kind,
  relationshipDialogueAct.kind,
  "lastDialogue should keep the dialogue act that changed the relationship",
);
assert.match(
  rel?.lastDialogue?.relationshipDialogueAct?.reason || "",
  /灵契|城规|解释权/,
  "lastDialogue should explain why dialogue changed the relationship",
);
assert.ok(
  rel?.lastDialogue?.dialogueTurns?.every((turn) => turn.triggeredBy === conductorSignal.inWorldClue),
  "each dialogue turn should keep the in-world trigger",
);
assert.equal(
  rel?.dialogueHistory?.at(-1)?.triggeredBy,
  conductorSignal.inWorldClue,
  "dialogueHistory should also preserve the trigger",
);
assert.equal(
  rel?.dialogueHistory?.at(-1)?.relationshipDialogueAct?.kind,
  relationshipDialogueAct.kind,
  "dialogueHistory should preserve the dialogue act for future relationship evolution",
);

console.log("relationshipDialogueTurnsPersistence:test passed", {
  turns: rel.lastDialogue.dialogueTurns.map((turn) => turn.line),
});
