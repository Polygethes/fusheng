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

const initialCharacters = getState().characters.map((character) => ({ id: character.id, name: character.name }));
const participation = new Map(initialCharacters.map((character) => [character.id, { ...character, ticks: 0, turns: 0, shifts: 0 }]));
const visitedLocations = new Set();

for (let day = 0; day < 4; day += 1) {
  const draft = playNext(getState());
  for (const tick of draft.periodSimulation?.ticks || []) {
    if (tick.locationName) visitedLocations.add(tick.locationName);
    for (const id of tick.participantIds || []) {
      const item = participation.get(id);
      if (item) item.ticks += 1;
    }
    for (const exchange of tick.sceneInteraction?.agentExchanges || []) {
      for (const turn of exchange.dialogueTurns || []) {
        const item = participation.get(turn.speakerId);
        if (item) item.turns += 1;
      }
    }
  }
  for (const shift of draft.relationshipShift || []) {
    const item = participation.get(shift.fromCharacterId);
    if (item) item.shifts += 1;
  }
  recordObservedDraft(draft);
}

const missingTick = [...participation.values()].filter((item) => item.ticks === 0);
const missingSpeech = [...participation.values()].filter((item) => item.turns === 0);
const missingRelationship = [...participation.values()].filter((item) => item.shifts === 0);

assert.equal(
  missingTick.length,
  0,
  `multi-day town playback should bring every character onto the stage, missing: ${missingTick.map((item) => item.name).join("、")}`,
);
assert.equal(
  missingSpeech.length,
  0,
  `multi-day town playback should let every character speak at least once, missing: ${missingSpeech.map((item) => item.name).join("、")}`,
);
assert.equal(
  missingRelationship.length,
  0,
  `multi-day town playback should evolve every character's relationships, missing: ${missingRelationship.map((item) => item.name).join("、")}`,
);
assert.ok(
  visitedLocations.size >= Math.min(5, getState().locations.length),
  `multi-day town playback should rotate through city districts, got ${[...visitedLocations].join("、")}`,
);

console.log("periodTownCoverageAcrossDays:test passed", {
  characters: [...participation.values()],
  locations: [...visitedLocations],
});
