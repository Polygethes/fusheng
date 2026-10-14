import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};

const {
  applySetupWorld,
  getState,
  recordObservedDraft,
  resetState,
  setUi,
} = await import("../src/state/store.js");
const { playNext } = await import("../src/engine/mockEngine.js");

resetState();
applySetupWorld({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});
setUi({ timeGrain: "day", focusMode: "ambient", activeTab: "observe", engineMode: "mock" });

const firstDraft = playNext(getState());
recordObservedDraft(firstDraft);
const secondDraft = playNext(getState());

const exchanges = (secondDraft.periodSimulation?.ticks || []).flatMap((tick) =>
  (tick.sceneInteraction?.agentExchanges || []).map((exchange) => ({
    tick,
    turns: exchange.dialogueTurns || [],
  }))
);

function openingPressure(line = "") {
  const text = String(line || "").trim();
  const prefix = text.split(/[；。]/)[0]?.trim() || "";
  return /^上一轮|^.+已经压了/.test(prefix) ? prefix : "";
}

const duplicatedOpenings = exchanges.filter(({ turns }) =>
  turns.some((turn, index) => {
    const previous = turns[index - 1];
    if (!previous || previous.speakerId === turn.speakerId) return false;
    const left = openingPressure(previous.line);
    const right = openingPressure(turn.line);
    return Boolean(left && right && left === right);
  })
);

assert.equal(
  duplicatedOpenings.length,
  0,
  `different characters should not use the same relationship-pressure opening in one exchange:\n${JSON.stringify(duplicatedOpenings.slice(0, 5).map(({ tick, turns }) => ({
    slot: tick.label,
    locationName: tick.locationName,
    turns: turns.map((turn) => `${turn.speakerName}: ${turn.line}`),
  })), null, 2)}`,
);

const agentTurns = exchanges.flatMap(({ turns }) => turns).filter((turn) => turn.generatedBy === "character-agent");
const propositionBySpeaker = new Map();
const wrongPropositions = agentTurns.filter((turn) => {
  if (!turn.proposition) return true;
  if (!propositionBySpeaker.has(turn.speakerId)) propositionBySpeaker.set(turn.speakerId, turn.proposition);
  return propositionBySpeaker.get(turn.speakerId) !== turn.proposition;
});

assert.equal(
  wrongPropositions.length,
  0,
  `each spoken decision should retain the current speaker's own objective instead of a named dialogue template:\n${JSON.stringify(wrongPropositions.slice(0, 6), null, 2)}`,
);
assert.ok(
  new Set(propositionBySpeaker.values()).size >= 2,
  "different character agents should bring different objective propositions into the exchange",
);

const linesBySpeaker = new Map();
for (const turn of agentTurns) {
  if (!linesBySpeaker.has(turn.speakerId)) linesBySpeaker.set(turn.speakerId, new Set());
  linesBySpeaker.get(turn.speakerId).add(turn.line);
}
const signatures = [...linesBySpeaker.entries()].map(([speakerId, lines]) => ({
  speakerId,
  signature: [...lines].sort().join("\n"),
}));
const duplicateSignatures = signatures.filter((item, index) => signatures.some((other, otherIndex) => (
  otherIndex < index && other.signature === item.signature
)));
assert.equal(
  duplicateSignatures.length,
  0,
  `different character agents should not share an identical completed dialogue repertoire:\n${JSON.stringify(duplicateSignatures, null, 2)}`,
);

const genericBargainTurns = exchanges.flatMap(({ tick, turns }) =>
  turns
    .filter((turn) => /价码先别改，[^。！？]+谁加条件谁先写名/.test(turn.line || ""))
    .map((turn) => ({
      slot: tick.label,
      locationName: tick.locationName,
      speakerName: turn.speakerName,
      line: turn.line,
    }))
);

assert.equal(
  genericBargainTurns.length,
  0,
  `bargain followups should not reuse a generic price template across speakers:\n${JSON.stringify(genericBargainTurns.slice(0, 6), null, 2)}`,
);

console.log("dialogueCharacterVoiceDiverges:test passed", {
  checked: exchanges.length,
});
