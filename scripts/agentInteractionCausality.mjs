import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildObservationEvents } from "../src/ui/render.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

state.ui.timeGrain = "day";
state.ui.focusMode = "location";
state.ui.selectedLocationId = "loc_xianxia_contract_gate";
state.ui.activeTab = "observe";

const draft = playNext(state);
const ticks = draft.periodSimulation?.ticks || [];
const firstTick = ticks.find((tick) => tick.locationId === state.ui.selectedLocationId);
const outputs = firstTick?.agentOutputs || [];
const first = outputs[0];
const second = outputs[1];

assert.ok(firstTick, "period simulation should produce a first tick");
assert.ok(outputs.length >= 2, "the first tick should include at least two agent outputs");
assert.ok(first.outputId, "initiating output should have a stable output id");
assert.equal(first.interactionRole, "initiator", "first output should be marked as the initiator of an exchange");
assert.equal(second.interactionRole, "responder", "second output should be generated as a responder, not as an independent parallel output");
assert.equal(second.interactionInput?.sourceOutputId, first.outputId, "second output should receive the first output as interaction input");
assert.equal(second.interactionInput?.sourceCharacterId, first.characterId, "interaction input should identify the source character");
assert.equal(second.reactsToOutputId, first.outputId, "second output should preserve the exact output it responds to");
assert.equal(second.responseToCharacterId, first.characterId, "second output should identify the character it is answering on stage");
assert.equal(second.interactionInput?.observedVisibleAction, first.visibleAction, "second output should observe the first output's visible action");
assert.notEqual(second.visibleAction, second.interactionInput?.ownCandidateBeforeResponse, "responder action should be rewritten by the observed action");

const realBeat = (firstTick.sceneInteraction?.interactionBeats || []).find((beat) =>
  beat.sourceOutputId === first.outputId && beat.responseOutputId === second.outputId
);
assert.ok(realBeat, "scene interaction should carry a causal beat between agent outputs");
assert.equal(realBeat.generatedFrom, "agent-interaction-loop", "causal beat should come from the agent interaction loop");

const events = buildObservationEvents(draft, state);
const firstText = events.find((event) => event.movementSource === "period-tick" && event.locationId === state.ui.selectedLocationId)?.text || "";
const secondActionClause = second.visibleAction.split(/[。！？]/)[0];

assert.ok(secondActionClause && firstText.includes(secondActionClause), "observer prose should use the responder's actual generated action");
assert.ok(!/同一件事里|不会完全按这个意图|私人意图进入场景/.test(firstText), "observer prose should not replace real interaction with abstract simulator wording");

console.log("agentInteractionCausality:test passed", {
  initiator: first.visibleAction,
  responder: second.visibleAction,
  observation: firstText,
});
