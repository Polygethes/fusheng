import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { applyGeneratedSetupWorld, applyUpdateBundle, exportState, getState, importState, saveDraft } from "../src/state/store.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const generated = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
applyGeneratedSetupWorld(generated, generated.worldSetup.sourcePrompts);
const before = getState();
const hungerBefore = before.characters.find((character) => character.name === "谢真石").lifeState.needs.hunger;
const draft = playNext({ ...before, ui: { ...before.ui, timeGrain: "day" } });
draft.updateBundle.tavernState.eventThreads = [{
  id: "thread_persistence_probe",
  topic: "今晚是否需要进米",
  stake: "晚饭存量可能不足",
  participantIds: ["char_xyy_xieheng", "char_xyy_xiemu"],
  status: "open",
  nextObligationCharacterId: "char_xyy_xieheng",
  turns: [],
}];
const sourceTurnId = "turn_persistence_question";
const answerTurn = {
  turnId: "turn_persistence_answer",
  speakerId: "char_xyy_xiemu",
  speakerName: "谢母",
  targetId: "char_xyy_xieheng",
  targetName: "谢恒",
  line: "锅里还剩四碗，住店客人要留一碗。",
  turnRole: "response",
  respondsTo: sourceTurnId,
  responseSourceLine: "晚饭还剩几碗？",
  responseSourceSpeakerId: "char_xyy_xieheng",
  responseSourceSlotId: "dusk",
  responseSourceSlotLabel: "黄昏",
  responseThreadId: "thread_persistence_probe",
  responseTopic: "今晚是否需要进米",
  interactionKind: "event-thread",
};
draft.sceneInteraction = { agentExchanges: [{ sharedObject: "晚饭库存", dialogueTurns: [answerTurn], eventOutcome: "具体库存已经公开。" }] };
draft.agentDecisionMeta = { decisions: 2, dialogueTurns: 2, failures: [] };
draft.agentParticipation = [{
  day: 1,
  slotId: "dusk",
  slotLabel: "黄昏",
  presentCharacterIds: ["char_xyy_xieheng", "char_xyy_xiemu", "char_xyy_luozhao"],
  presentCharacterNames: ["谢恒", "谢母", "洛照"],
  activatedAgentIds: ["char_xyy_xieheng", "char_xyy_xiemu"],
  activatedAgentNames: ["谢恒", "谢母"],
  completedAgentIds: ["char_xyy_xieheng", "char_xyy_xiemu"],
  failedAgentIds: [],
  ruleOnlyCharacterIds: ["char_xyy_luozhao"],
  ruleOnlyCharacterNames: ["洛照"],
  witness: { scheduled: true, ran: true, provider: "test", stage: "ActivityWitness:黄昏", degraded: false },
}];
if (draft.periodSimulation?.ticks?.[0]) {
  draft.periodSimulation.ticks[0].sceneInteraction = draft.sceneInteraction;
  draft.periodSimulation.ticks[0].canonicalDialogueTurns = [answerTurn];
  draft.periodSimulation.ticks[0].agentParticipation = draft.agentParticipation[0];
}
saveDraft(draft);
applyUpdateBundle(draft.updateBundle);
const after = getState();

assert.equal(after.tavernState.day, 1);
assert.equal(after.tavernState.eventThreads?.[0]?.topic, "今晚是否需要进米");
assert.notEqual(after.characters.find((character) => character.name === "谢真石").lifeState.needs.hunger, hungerBefore);
assert.ok(after.characterMemories.every((memory) => memory.type === "interpreted-event"));

const serialized = exportState();
importState(serialized);
const restored = getState();
assert.equal(restored.tavernState.day, 1);
assert.equal(restored.tavernState.eventThreads?.[0]?.nextObligationCharacterId, "char_xyy_xieheng");
assert.equal(restored.branches[0].snapshot.tavernState.day, 1);
assert.ok(restored.characters.every((character) => character.lifeState?.needs));
const restoredDraft = restored.draftScenes.find((item) => item.id === draft.id);
assert.equal(restoredDraft.agentDecisionMeta?.decisions, 2, "Agent decision metadata must survive reload");
assert.equal(restoredDraft.agentParticipation?.[0]?.activatedAgentNames?.join("、"), "谢恒、谢母", "activated Agent names must survive reload");
assert.equal(restoredDraft.agentParticipation?.[0]?.ruleOnlyCharacterNames?.[0], "洛照", "rule-only presence must survive reload");
assert.equal(restoredDraft.agentParticipation?.[0]?.witness?.ran, true, "Activity Witness participation must survive reload");
const restoredAnswer = restoredDraft.sceneInteraction?.agentExchanges?.[0]?.dialogueTurns?.[0];
assert.equal(restoredAnswer?.respondsTo, sourceTurnId, "response linkage must survive reload");
assert.equal(restoredAnswer?.responseSourceLine, "晚饭还剩几碗？", "response source line must survive reload");
assert.equal(restoredAnswer?.responseTopic, "今晚是否需要进米", "cross-slot response topic must survive reload");

console.log("tavernStatePersistence:test passed", { day: restored.tavernState.day, memories: restored.characterMemories.length, agents: restoredDraft.agentParticipation[0].activatedAgentNames });
