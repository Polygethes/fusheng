import assert from "node:assert/strict";
import { normalizeSceneInteraction } from "../src/server/pipeline/sceneInteractionSimulator.mjs";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";
import { buildObservationEvents } from "../src/ui/render.js";

const dialogueHistory = [
  {
    sharedObject: "灵契",
    followupTurn: "名字先不写，灵契留给界石。",
    finalTurn: "名字先不写，灵契留给界石。",
    eventOutcome: "灵契留在铜盘边，盖印的人没有进来。",
    dialogueTurns: [
      { speakerId: "char_shen", speakerName: "沈珩", targetId: "char_yan", targetName: "阎无咎", line: "谁替你盖印？", turnRole: "claim" },
      { speakerId: "char_yan", speakerName: "阎无咎", targetId: "char_shen", targetName: "沈珩", line: "名字先不写。", turnRole: "response" },
    ],
  },
  {
    sharedObject: "灵契",
    followupTurn: "谁改口谁先认。",
    finalTurn: "谁改口谁先认。",
    eventOutcome: "灵契被推回界石下，铜盘没有盖印。",
    dialogueTurns: [
      { speakerId: "char_shen", speakerName: "沈珩", targetId: "char_yan", targetName: "阎无咎", line: "界石照着灵契。", turnRole: "claim" },
      { speakerId: "char_yan", speakerName: "阎无咎", targetId: "char_shen", targetName: "沈珩", line: "谁改口谁先认。", turnRole: "turn" },
    ],
  },
  {
    sharedObject: "灵契",
    followupTurn: "你要的是名字，不是证据。",
    finalTurn: "你要的是名字，不是证据。",
    eventOutcome: "阎无咎把灵契压回铜盘边，沈珩没有让守门人盖印。",
    dialogueTurns: [
      { speakerId: "char_shen", speakerName: "沈珩", targetId: "char_yan", targetName: "阎无咎", line: "证据不能走。", turnRole: "claim" },
      { speakerId: "char_yan", speakerName: "阎无咎", targetId: "char_shen", targetName: "沈珩", line: "你要的是名字，不是证据。", turnRole: "turn" },
    ],
  },
];

const source = {
  characterId: "char_shen",
  characterName: "沈珩",
  targetCharacterId: "char_yan",
  targetCharacterName: "阎无咎",
  tone: "惩罚",
  agentProfile: {
    leverageObject: "灵契",
    dialogueMoves: ["按城法扣契，不按宗门私仇。", "剑可以停，证据不能走。"],
  },
  defensiveMask: "按城法扣契，不按宗门私仇。",
  memorySource: "agent_dialogue_relationship",
  memorySharedObject: "灵契",
  relationshipDialogueHistory: dialogueHistory,
  relationshipHistoryCount: dialogueHistory.length,
  relationshipDialogueMemory: dialogueHistory.at(-1),
};

const target = {
  characterId: "char_yan",
  characterName: "阎无咎",
  targetCharacterId: "char_shen",
  targetCharacterName: "沈珩",
  tone: "伪装",
  agentProfile: {
    leverageObject: "魔印",
    dialogueMoves: ["我押的是灵契，不是命。", "价码到了，旧案自然开口。"],
  },
  defensiveMask: "我押的是灵契，不是命。",
  memorySource: "agent_dialogue_relationship",
  memorySharedObject: "灵契",
  relationshipDialogueHistory: dialogueHistory,
  relationshipHistoryCount: dialogueHistory.length,
  relationshipDialogueMemory: dialogueHistory.at(-1),
};

const normalized = normalizeSceneInteraction({}, [source, target], { perCharacter: [] });
const modelFallbackExchange = normalized.agentExchanges[0] || {};
const modelFallbackTurns = modelFallbackExchange.dialogueTurns || [];
const modelFifthTurn = modelFallbackTurns[4]?.line || "";

assert.ok(
  modelFallbackTurns.length >= 5,
  `high relationship history should extend model fallback dialogue beyond four turns, got ${modelFallbackTurns.length}:\n${modelFallbackTurns.map((turn) => turn.line).join("\n")}`,
);
assert.equal(modelFallbackTurns[4].speakerId, "char_shen", "fifth fallback turn should let the initiator answer the responder's fourth turn");
assert.equal(modelFallbackTurns[4].respondsTo, modelFallbackTurns[3].line, "fifth fallback turn should answer the immediately previous turn");
assert.match(modelFifthTurn, /灵契|界石|盖印|名字|证据/, `fifth fallback turn should stay inside the same concrete stakes, got: ${modelFifthTurn}`);
assert.ok(
  normalized.relationshipShift.some((shift) => shift.dialogueTurnCount >= 5 && shift.finalTurn === modelFifthTurn),
  "relationship shift should remember the fifth turn as the latest final turn",
);
assert.ok(
  normalized.relationshipShift.some((shift) => (
    shift.fromCharacterId === "char_yan"
    && shift.toCharacterId === "char_shen"
    && Number(shift.deltas?.wantsToEscape || 0) >= 4
    && /退路/.test(shift.misreading || "")
  )),
  `model relationship shift should turn the fifth line into blocked-retreat pressure, got:\n${JSON.stringify(normalized.relationshipShift, null, 2)}`,
);
assert.match(
  modelFallbackExchange.eventOutcome || "",
  /退路|名字不能替你写|证据也不能被你改成退路/,
  `event outcome should be changed by the fifth free turn, got:\n${modelFallbackExchange.eventOutcome}`,
);

const localScene = runSceneInteractionSimulation({
  state: { characters: [] },
  simulationTick: {
    id: "tick_pressure_dialogue",
    locationId: "loc_gate",
    locationName: "四方法契门",
    visiblePressure: "界石照着灵契，守门人的印停在铜盘外。",
    privateSimulations: [source, target],
  },
  agentOutputs: [
    {
      outputId: "out_shen",
      characterId: "char_shen",
      targetCharacterId: "char_yan",
      visibleAction: "沈珩扣住阎无咎面前的灵契，另一只手拦住守门人的印。",
    },
    {
      outputId: "out_yan",
      characterId: "char_yan",
      targetCharacterId: "char_shen",
      visibleAction: "阎无咎没有接沈珩推来的灵契，把魔印压到铜盘边。",
      interactionInput: {
        sourceCharacterId: "char_shen",
        sourceOutputId: "out_shen",
        observedVisibleAction: "沈珩扣住阎无咎面前的灵契，另一只手拦住守门人的印。",
        sharedObject: "灵契",
      },
    },
  ],
});

const localExchange = localScene.agentExchanges[0] || {};
const localTurns = localExchange.dialogueTurns || [];
const localFifthTurn = localTurns[4]?.line || "";

assert.ok(
  localTurns.length >= 5,
  `high relationship history should extend local dialogue beyond four turns, got ${localTurns.length}:\n${localTurns.map((turn) => turn.line).join("\n")}`,
);
assert.equal(localTurns[4].speakerId, "char_shen", "local fifth turn should let the initiator answer again");
assert.equal(localTurns[4].respondsTo, localTurns[3].line, "local fifth turn should answer the fourth turn");
assert.match(localFifthTurn, /灵契|界石|盖印|名字|证据/, `local fifth turn should stay inside the same stakes, got: ${localFifthTurn}`);
assert.match(
  localExchange.eventOutcome || "",
  /退路|名字不能替你写|证据也不能被你改成退路/,
  `local event outcome should be changed by the fifth free turn, got:\n${localExchange.eventOutcome}`,
);
assert.ok(
  (localScene.agentRelationshipShifts || []).some((shift) => (
    shift.dialogueTurnCount >= 5
    && shift.finalTurn === localFifthTurn
    && shift.followupTurn === localFifthTurn
  )),
  `local relationship shifts should remember the fifth turn as both finalTurn and followupTurn, got:\n${JSON.stringify(localScene.agentRelationshipShifts, null, 2)}`,
);
assert.ok(
  (localScene.agentRelationshipShifts || []).some((shift) => (
    shift.fromCharacterId === "char_yan"
    && shift.toCharacterId === "char_shen"
    && Number(shift.deltas?.wantsToEscape || 0) >= 4
    && /退路/.test(shift.misreading || "")
  )),
  `local relationship shifts should make the blocked retreat available to the next agent step, got:\n${JSON.stringify(localScene.agentRelationshipShifts, null, 2)}`,
);

const state = {
  project: { title: "测试", activeBranchId: "branch_main" },
  town: { name: "停剑城" },
  worldSetup: { generatedBySkills: true },
  characters: [
    { id: "char_shen", name: "沈珩", publicIdentity: "执律剑修" },
    { id: "char_yan", name: "阎无咎", publicIdentity: "血河楼使者" },
  ],
  locations: [
    { id: "loc_gate", name: "四方法契门", likelyEvents: ["界石亮起"], subtext: "灵契压在铜盘边。" },
  ],
  relationships: [],
  ui: { selectedLocationId: "loc_gate" },
};

const draft = {
  id: "draft_pressure_dialogue",
  locationId: "loc_gate",
  periodSimulation: {
    ticks: [
      {
        id: "tick_pressure_dialogue",
        label: "上午",
        locationId: "loc_gate",
        locationName: "四方法契门",
        participantIds: ["char_shen", "char_yan"],
        resolution: "focused_scene",
        sceneInteraction: {
          agentExchanges: [modelFallbackExchange],
        },
        agentOutputs: [],
      },
    ],
  },
};

const observedText = buildObservationEvents(draft, state).map((event) => event.text).join("\n");

assert.match(
  observedText,
  new RegExp(modelFifthTurn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  `observation prose should include the fifth free dialogue turn instead of truncating at four, got:\n${observedText}`,
);

console.log("relationshipPressureExtendsDialogue:test passed", {
  modelTurns: modelFallbackTurns.map((turn) => turn.line),
  localTurns: localTurns.map((turn) => turn.line),
  observedText,
});
