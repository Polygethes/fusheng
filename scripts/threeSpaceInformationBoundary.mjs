import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { renderApp } from "../src/ui/render.js";

const state = structuredClone(initialState);
state.ui.setupCompleted = true;
state.ui.selectedCharacterId = "char_gregor";
state.ui.lastDraftId = "draft_space_boundary";
state.draftScenes = [{
  id: "draft_space_boundary",
  createdAt: "2026-07-09T12:00:00.000Z",
  locationId: "loc_gregor_room",
  participantIds: ["char_gregor", "char_grete"],
  surfaceEvent: "门外的人没有继续催促。",
  sceneText: "格里高尔贴着门说：“我马上就好。”格蕾特没有推门。",
  periodSimulation: {
    ticks: [{
      id: "tick_space_boundary",
      label: "上午",
      resolution: "focused_scene",
      locationId: "loc_gregor_room",
      locationName: "格里高尔房间",
      participantIds: ["char_gregor", "char_grete"],
      surfaceEvent: "门外的人没有继续催促。",
      agentOutputs: [{
        characterId: "char_gregor",
        targetCharacterId: "char_grete",
        visibleAction: "格里高尔贴着门说：“我马上就好。”",
      }, {
        characterId: "char_grete",
        targetCharacterId: "char_gregor",
        visibleAction: "格蕾特把手放在门板上，没有推门。",
      }],
    }],
  },
  privateSimulations: [{
    characterId: "char_gregor",
    characterName: "格里高尔",
    targetCharacterId: "char_grete",
    privateDesire: "他想确认妹妹仍然会叫他的名字。",
    whatTheyRefuseToAdmit: "他其实不想再去上班。",
    selfLie: "我只是误了车。",
  }],
}];

state.ui.activeTab = "psychology";
const psychologyHtml = renderApp(state);
assert.match(psychologyHtml, /他其实不想再去上班/, "psychology should expose private state");

state.ui.activeTab = "reality";
const realityHtml = renderApp(state);
assert.match(realityHtml, /我马上就好/, "reality should expose visible speech");
assert.ok(!realityHtml.includes("他其实不想再去上班"), "reality must not leak private state");

state.ui.activeTab = "story";
const storyHtml = renderApp(state);
assert.match(storyHtml, /心理与现实材料/, "story should receive both upstream layers as read-only material");
assert.match(storyHtml, /他其实不想再去上班/, "story should receive psychology material");
assert.match(storyHtml, /我马上就好/, "story should receive reality material");

console.log("threeSpaceInformationBoundary:test passed");
