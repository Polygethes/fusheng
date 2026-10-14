import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});

state.ui.timeGrain = "day";
state.ui.focusMode = "ambient";
state.ui.activeTab = "observe";

const draft = playNext(state);
const exchanges = (draft.periodSimulation?.ticks || [])
  .flatMap((tick) => (tick.sceneInteraction?.agentExchanges || []).map((exchange) => ({
    tick,
    exchange,
  })));

const normalize = (line = "") => String(line || "")
  .replace(/[“”"「」『』，,。！？；;：:\s]/g, "")
  .trim();

const mirrored = [];
for (const { tick, exchange } of exchanges) {
  const turns = Array.isArray(exchange.dialogueTurns) ? exchange.dialogueTurns : [];
  for (let index = 1; index < turns.length; index += 1) {
    const previous = turns[index - 1];
    const current = turns[index];
    const prevLine = normalize(previous.line || previous.text || "");
    const currentLine = normalize(current.line || current.text || "");
    if (prevLine && currentLine && prevLine === currentLine && previous.speakerId !== current.speakerId) {
      mirrored.push({
        slot: tick.label,
        locationName: tick.locationName,
        previous: `${previous.speakerName}: ${previous.line}`,
        current: `${current.speakerName}: ${current.line}`,
      });
    }
  }
}

assert.equal(
  mirrored.length,
  0,
  `period dialogue should not mirror the same line across speakers, got:\n${JSON.stringify(mirrored.slice(0, 6), null, 2)}`,
);

console.log("periodDialogueNoMirroredTurns:test passed", {
  exchangeCount: exchanges.length,
});
