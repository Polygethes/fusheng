// Contract: the deterministic local path never leaks simulation bookkeeping to
// the reader.
//
// This contract used to judge whether locally generated dialogue sounded human:
// no private character-sheet vocabulary, no recited objective propositions, no
// spoken action inventories, no looped sentences, and causal provenance on every
// reply. Those checks assumed the deterministic path stages speech.
//
// It no longer does. A voice is a constraint on a generator — sentence length,
// hedging, how a character takes the floor (`characterVoiceHabits.mjs`, which
// forbids habits from storing literal wording). The deterministic path has no
// generator to constrain, only fixed string banks, so every character spoke in
// one clipped register assembled from a shared three-line fallback array.
// Dialogue moved to the paths that can generate it; see
// `local-theater-emits-no-staged-speech:test`.
//
// The surviving requirement is stronger, not weaker: the same vocabulary must
// stay out of everything this path *does* still emit — visible action, scene
// text and period slots. Bookkeeping leaking as narration is the same defect
// that used to leak as dialogue.

import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};

const originalRandom = Math.random;
let randomSeed = 0x5f3759df;
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

try {
  resetState();
  applySetupWorld({
    setupWorldPrompt: "一支旅行队在边城停留两天，城门、市场、寺院与荒路同时运转。",
    setupPeoplePrompt: "带队者、侦察者、搬运者、守夜人和一名身份不明的旅客，各自有不同目标。",
  });
  setUi({ timeGrain: "day", focusMode: "ambient", activeTab: "observe", engineMode: "mock" });

  const drafts = [];
  for (let day = 0; day < 2; day += 1) {
    const draft = playNext(getState());
    drafts.push(draft);
    recordObservedDraft(draft);
  }

  const surfaces = drafts.flatMap((draft, dayIndex) => {
    const rows = [];
    for (const tick of draft.periodSimulation?.ticks || []) {
      const where = `D${dayIndex + 1}/${tick.locationName || tick.locationId || "?"}`;
      if (tick.slotText) rows.push({ where, kind: "slot", text: String(tick.slotText) });
      if (tick.sceneText) rows.push({ where, kind: "scene", text: String(tick.sceneText) });
      for (const action of tick.agentOutputs || []) {
        if (action.visibleAction) rows.push({ where, kind: "action", text: String(action.visibleAction) });
      }
    }
    if (draft.sceneText) rows.push({ where: `D${dayIndex + 1}`, kind: "scene", text: String(draft.sceneText) });
    return rows;
  });

  assert.ok(surfaces.length >= 6, `the local path should still emit enough surface to evaluate, got ${surfaces.length}`);
  const text = surfaces.map((row) => row.text).join("\n");

  // 1. No staged speech at all — the guarantee that replaced "dialogue should
  //    sound human".
  assert.doesNotMatch(
    text,
    /说：[“"]/,
    `the deterministic path must not stage speech:\n${text}`,
  );

  // 2. Simulation bookkeeping and private character-sheet vocabulary stay out of
  //    the reader's view. Unchanged from the original contract.
  assert.doesNotMatch(
    text,
    /压到明处|没有完成交割|按刚才的记录|先说它和.+的关系|上次.+留在(?:场中|原处)|我记得.+还没离场|名字先别写死|把(?:欲望|私欲)改名为|私人后台|关系状态|行动候选/,
    `narration must not expose simulation bookkeeping or private character-sheet language:\n${text}`,
  );

  // 3. Action inventories stay in the private plan instead of being narrated as
  //    a list the character announces.
  assert.doesNotMatch(
    text,
    /我要[^。！？]{0,40}(?:、[^。！？]{1,16}){2,}/,
    `action inventories must stay in the private plan:\n${text}`,
  );

  // 4. The path must not loop one finished sentence across the run. This was the
  //    template-fatigue check and it applies to narration exactly as it did to
  //    dialogue.
  const sentences = surfaces
    .filter((row) => row.kind !== "slot")
    .map((row) => row.text.trim())
    .filter(Boolean);
  const counts = new Map();
  for (const sentence of sentences) counts.set(sentence, (counts.get(sentence) || 0) + 1);
  const repeated = [...counts.entries()].filter(([, count]) => count > 1);
  const excess = repeated.reduce((sum, [, count]) => sum + count - 1, 0);
  assert.ok(
    excess <= Math.floor(sentences.length * 0.12),
    `the local path should not loop the same finished sentence across the run:\n${repeated.map(([line, count]) => `${count}x ${line}`).join("\n")}`,
  );

  console.log("localDialogueSoundsHuman:test passed", {
    surfaces: surfaces.length,
    stagedSpeech: 0,
    repeatedExcess: excess,
  });
} finally {
  Math.random = originalRandom;
}
