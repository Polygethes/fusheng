import assert from "node:assert/strict";
import { compactState } from "../src/server/pipeline/context.mjs";
import { runPrivateSimulators } from "../src/server/pipeline/privateSimulator.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

process.env.DEEPSEEK_API_KEY = "test-key";
process.env.OPENAI_API_KEY = "";
process.env.OPENAI_BASE_URL = "https://api.deepseek.com";
process.env.CHARACTER_TOWN_MODEL = "deepseek-v4-flash";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派与各种物种汇集的中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族医者在同一地点相遇。",
});
state.ui.activeCharacterIds = state.characters.slice(0, 3).map((character) => character.id);
state.ui.selectedLocationId = state.locations[0].id;
state.characters.forEach((character, index) => {
  character.internalSituation = {
    ...(character.internalSituation || {}),
    privateConcurrencyMarker: `PRIVATE_ONLY_${index}`,
  };
});
const compact = compactState(state);
const prompts = [];
const progress = [];
let activeCalls = 0;
let maxActiveCalls = 0;

globalThis.fetch = async (_url, options) => {
  const body = JSON.parse(options.body);
  const prompt = body.messages?.[1]?.content || "";
  prompts.push(prompt);
  activeCalls += 1;
  maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
  await new Promise((resolve) => setTimeout(resolve, 45));
  activeCalls -= 1;
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: `private_${prompts.length}`,
      choices: [{
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            tone: "试探",
            publicGoal: "把手边物件留在场中",
            privateDesire: "迫使对方回应",
            defensiveMask: "声称自己只是在遵守规矩",
            shadowImpulse: "夺回解释权",
            nobleImpulse: "不让旁人受伤",
            selfLie: "我没有私心",
            actionCandidate: "把物件推到两人之间",
          }),
        },
      }],
    }),
  };
};

try {
  const result = await runPrivateSimulators(compact, {
    onProgress: (event) => progress.push(event),
    context: { slotLabel: "上午", locationName: compact.selectedLocation.name },
  });

  assert.equal(maxActiveCalls, 3, "all isolated character psychology requests should be in flight concurrently");
  assert.deepEqual(
    result.privateSimulations.map((simulation) => simulation.characterId),
    compact.activeCharacters.map((character) => character.id),
    "concurrent results should be merged in stable character order",
  );
  assert.equal(prompts.length, 3);
  prompts.forEach((prompt, index) => {
    assert.match(prompt, new RegExp(`PRIVATE_ONLY_${index}`), "an agent should receive its own private marker");
    compact.activeCharacters.forEach((_character, otherIndex) => {
      if (otherIndex === index) return;
      assert.doesNotMatch(prompt, new RegExp(`PRIVATE_ONLY_${otherIndex}`), "an agent must not receive another character's private marker");
    });
  });
  assert.equal(progress.filter((event) => event.type === "agent_thinking").length, 3);
  assert.equal(progress.filter((event) => event.type === "agent_ready").length, 3);
  console.log("privateAgentConcurrency:test passed", { maxActiveCalls, prompts: prompts.length });
} finally {
  globalThis.fetch = originalFetch;
  process.env = originalEnv;
}
