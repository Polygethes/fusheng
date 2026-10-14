import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵和散修在同一座城里互相试探。",
});

state.ui.engineMode = "mock";
state.ui.timeGrain = "day";
state.ui.focusMode = "location";
state.ui.activeTab = "observe";
state.ui.selectedLocationId = state.locations.find((location) => /四方法契门/.test(location.name))?.id || state.locations[0]?.id;
state.ui.userDirective = "让停剑城运行一天；人物自己回应场内线索，不要由旁白替他们解释。";

const draft = playNext(state);
const ticks = draft.periodSimulation?.ticks || [];

function escapeRegExp(text = "") {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

assert.ok(ticks.length >= 5, "day playback should produce a sequence of period ticks");

for (const tick of ticks) {
  const signal = tick.conductorBeat?.signal;
  assert.ok(signal, `${tick.label} / ${tick.locationName} should receive a conductor signal before agents act`);
  assert.equal(signal.delivery, "in_world_clue", "conductor signal should be delivered as an in-world clue");
  assert.ok(signal.inWorldClue && signal.object, "conductor signal should contain a concrete clue and object");
  assert.ok(signal.pressureCue, "conductor signal should contain a pressure cue");
  assert.ok(
    tick.agentOutputs?.some((output) => output.conductorSignal?.beatId === tick.conductorBeat.id),
    "at least one agent output should record that it acted under the current beat signal",
  );
  const signaledOutput = tick.agentOutputs.find((output) => output.conductorSignal?.beatId === tick.conductorBeat.id);
  const actorName = state.characters.find((character) => character.id === signaledOutput?.characterId)?.name || "";
  const actionAfterClue = String(signaledOutput?.visibleAction || "").split(/[。！？]/).map((part) => part.trim())[1] || "";
  assert.ok(
    actorName && actionAfterClue.includes(actorName),
    "the first action after the signal clue should still name the acting character",
  );

  const visibleActions = (tick.agentOutputs || []).map((output) => output.visibleAction || "").join("\n");
  assert.ok(
    visibleActions.includes(signal.inWorldClue),
    `${tick.label} / ${tick.locationName} visible actions should absorb the in-world clue instead of ignoring the beat`,
  );
  assert.ok(
    !/conductor|BeatTracker|current_beat|completionCriteria|fallbackEscalation|targetTickRange|节拍|后台|低精度|私人模拟/i.test(visibleActions),
    "visible agent actions should not expose conductor internals",
  );

  const exchange = tick.sceneInteraction?.agentExchanges?.[0];
  assert.ok(exchange?.conductorSignal, `${tick.label} / ${tick.locationName} exchange should keep the in-world signal as causal context`);
  assert.equal(exchange.conductorSignal.inWorldClue, signal.inWorldClue, "agent exchange should trace the exact signal that shaped the action");
  assert.ok(
    (exchange.dialogueTurns || []).some((turn) => turn.triggeredBy === signal.inWorldClue && turn.line.includes(signal.object)),
    "at least one dialogue turn should answer the conductor signal through the scene object",
  );
  assert.ok(
    !(exchange.dialogueTurns || []).some((turn) => /灯已经动了|账页已经动了|笔已经动了|门槛已经动了|凭证已经动了|纸页已经动了|动静已经动了/.test(turn.line || "")),
    "dialogue should answer the clue in natural scene language, not generic 'already moved' phrasing",
  );
  assert.ok(
    !(exchange.dialogueTurns || []).some((turn) => /([\u4e00-\u9fa5A-Za-z0-9]{2,8})留在这里，\1也别走/.test(turn.line || "")),
    "dialogue should not mechanically repeat the same object in a follow-up line",
  );
  assert.ok(
    (exchange.relationshipDeltas || []).some((shift) => shift.triggeredBy === signal.inWorldClue && shift.sharedObject === signal.object),
    "relationship shifts from the exchange should remember the signal trigger",
  );
}

assert.ok(
  !/conductor|BeatTracker|current_beat|completionCriteria|fallbackEscalation|targetTickRange|节拍|后台|低精度|私人模拟/i.test(draft.sceneText || ""),
  "observer prose should still hide conductor internals",
);

const firstSignal = ticks[0]?.conductorBeat?.signal?.inWorldClue || "";
const firstSignalOccurrences = firstSignal
  ? (draft.sceneText.match(new RegExp(escapeRegExp(firstSignal), "g")) || []).length
  : 0;
assert.equal(firstSignalOccurrences, 1, "observer prose should not repeat the same conductor clue as both a label and an action");
assert.ok(
  !/([\u4e00-\u9fa5A-Za-z0-9]{2,12})旁的\1/.test(draft.sceneText || ""),
  "observer prose should not repeat the same object on both sides of a trace phrase",
);

console.log("nanaConductorSignalsShapeAgents:test passed", {
  ticks: ticks.length,
  firstSignal: ticks[0]?.conductorBeat?.signal?.inWorldClue,
  firstAction: ticks[0]?.agentOutputs?.[0]?.visibleAction,
});
