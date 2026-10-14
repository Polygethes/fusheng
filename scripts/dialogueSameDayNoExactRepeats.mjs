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
const { buildObservationEvents } = await import("../src/ui/render.js");

resetState();
applySetupWorld({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});
setUi({ timeGrain: "day", focusMode: "ambient", activeTab: "observe", engineMode: "mock" });

const firstDraft = playNext(getState());
recordObservedDraft(firstDraft);
const secondDraft = playNext(getState());

const periodEvents = buildObservationEvents(secondDraft, getState())
  .filter((event) => event.movementSource === "period-tick");

const spokenTurns = periodEvents.flatMap((event) =>
  [...String(event.text || "").matchAll(/([^。！？；\s]{2,8})说：“([^”]+)”/g)]
    .map((match) => ({
      speaker: match[1],
      line: normalizeSpokenLine(match[2]),
      time: event.time,
      location: event.location,
    }))
    .filter((turn) => turn.line.length >= 10),
);

const byLine = new Map();
for (const turn of spokenTurns) {
  const bucket = byLine.get(turn.line) || [];
  bucket.push(turn);
  byLine.set(turn.line, bucket);
}

const repeated = [...byLine.entries()]
  .filter(([, turns]) => turns.length > 1)
  .map(([line, turns]) => ({
    line,
    count: turns.length,
    speakers: [...new Set(turns.map((turn) => turn.speaker))],
    where: turns.map((turn) => `${turn.time}/${turn.location}`),
  }));

assert.equal(
  repeated.length,
  0,
  `same-day observation should not repeat exact dialogue lines across period events:\n${JSON.stringify(repeated, null, 2)}`,
);

console.log("dialogueSameDayNoExactRepeats:test passed", {
  spokenTurns: spokenTurns.length,
  uniqueTurns: byLine.size,
});

function normalizeSpokenLine(line = "") {
  return String(line || "")
    .replace(/\s+/g, "")
    .replace(/[。！？]+$/g, "")
    .trim();
}
