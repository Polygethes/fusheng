// Contract: the deterministic local theatre does not stage speech.
//
// A voice is a constraint on a generator — sentence length, hedging, how a
// character takes the floor, what they attend to.  `characterVoiceHabits.mjs`
// models exactly that, and forbids habits from storing literal wording.  The
// deterministic path has no generator to constrain: it can only concatenate
// canned strings, so every character came out speaking in one clipped register
// built from the same three-line fallback bank.
//
// Rather than keep faking it, the local path reports what happened and what it
// cost.  Dialogue belongs to the paths that can actually generate it (the
// configured model pipeline and the v2.7 character runtime).

import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};

const { applySetupWorld, getState, resetState, setUi } = await import("../src/state/store.js");
const { playNext } = await import("../src/engine/mockEngine.js");

resetState();
applySetupWorld({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});
setUi({ engineMode: "local", timeGrain: "day" });

const draft = await playNext(getState(), {});

// 1. No staged dialogue turns are produced.
{
  const outputs = draft.agentOutputs || [];
  const exchangeTurns = outputs.flatMap((output) => output.dialogueExchangeTurns || []);
  assert.equal(
    exchangeTurns.length,
    0,
    `the deterministic path must not stage dialogue turns, got ${exchangeTurns.length}`,
  );
  const decisions = outputs.filter((output) => output.dialogueDecision).length;
  assert.equal(decisions, 0, "the deterministic path must not build dialogue decisions");
}

// 2. No quoted speech is smuggled into the prose either.  Concatenated slogans
//    in quotation marks are the same failure wearing narration.
{
  const prose = [
    String(draft.sceneText || ""),
    String(draft.novelText || ""),
    ...(draft.agentOutputs || []).map((output) => String(output.visibleAction || "")),
    ...(draft.periodSimulation?.slots || []).map((slot) => String(slot.slotText || "")),
  ].join("\n");
  assert.doesNotMatch(
    prose,
    /说：\s*[“"]/,
    "the deterministic path must not narrate quoted speech",
  );
}

// 3. It still has to report something. Silence about the world is not the goal —
//    the point is to show action and consequence instead of invented lines.
{
  const outputs = draft.agentOutputs || [];
  assert.ok(outputs.length > 0, "the deterministic path must still produce agent outputs");
  const withVisibleAction = outputs.filter((output) => String(output.visibleAction || "").trim()).length;
  assert.ok(
    withVisibleAction > 0,
    "the deterministic path must still report visible action",
  );
}

// 4. Consequence still lands: relationships and state must move even though
//    nobody was made to speak.
{
  const relationshipShifts = (draft.updateBundle?.relationships || []).length
    + (draft.relationshipShift || []).length;
  assert.ok(
    relationshipShifts > 0,
    "consequence must still propagate without staged dialogue",
  );
}

console.log("local theatre emits no staged speech contract passed");
