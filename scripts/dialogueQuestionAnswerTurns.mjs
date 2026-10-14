import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};

const originalRandom = Math.random;
let randomSeed = 0x1badb002;
Math.random = () => {
  randomSeed = (1664525 * randomSeed + 1013904223) >>> 0;
  return randomSeed / 0x100000000;
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
  setupPeoplePrompt: "正道修士、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});
setUi({ timeGrain: "day", focusMode: "ambient", activeTab: "observe", engineMode: "mock" });

const firstDraft = playNext(getState());
recordObservedDraft(firstDraft);
const secondDraft = playNext(getState());

const exchanges = (secondDraft.periodSimulation?.ticks || [])
  .flatMap((tick) => (tick.sceneInteraction?.agentExchanges || []).map((exchange) => ({
    tick,
    turns: exchange.dialogueTurns || [],
  })));
const checkedDrafts = [firstDraft, secondDraft];

function hasQuestionAnswer(turns = []) {
  return turns.some((turn, index) => {
    const next = turns[index + 1];
    if (!next || next.speakerId === turn.speakerId) return false;
    if (!/[？?]$/.test(String(turn.line || "").trim())) return false;
    if (next.respondsTo !== turn.line) return false;
    return /不|没|是|因为|要|能|可以|先|别|会|知道|说|看|听|答|问|谁|哪/.test(next.line || "");
  });
}

const withQuestionAnswer = exchanges.filter(({ turns }) => hasQuestionAnswer(turns));
const allDialogueLines = checkedDrafts.flatMap((draft) =>
  (draft.periodSimulation?.ticks || []).flatMap((tick) =>
    (tick.sceneInteraction?.agentExchanges || []).flatMap((exchange) =>
      (exchange.dialogueTurns || []).map((turn) => turn.line || "").filter(Boolean)
    )
  )
);
const flattenedDialogue = allDialogueLines.join("\n");

assert.ok(
  withQuestionAnswer.length >= Math.ceil(exchanges.length * 0.2),
  `the day should include explicit questions followed by answers or refusals without turning every exchange into an interrogation, got ${withQuestionAnswer.length}/${exchanges.length}:\n${JSON.stringify(exchanges.slice(0, 5).map(({ tick, turns }) => ({
    slot: tick.label,
    locationName: tick.locationName,
    turns: turns.map((turn) => `${turn.speakerName}: ${turn.line} -> ${turn.respondsTo || ""}`),
  })), null, 2)}`,
);
assert.ok(
  withQuestionAnswer.length <= Math.floor(exchanges.length * 0.8),
  `questions should be one available speech act rather than the shape of nearly every exchange, got ${withQuestionAnswer.length}/${exchanges.length}`,
);
assert.doesNotMatch(
  flattenedDialogue,
  /(?:吗|呢)。/,
  `question-shaped dialogue should keep a question mark instead of becoming a flat statement:\n${flattenedDialogue}`,
);

console.log("dialogueQuestionAnswerTurns:test passed", {
  checked: exchanges.length,
  withQuestionAnswer: withQuestionAnswer.length,
});

Math.random = originalRandom;
