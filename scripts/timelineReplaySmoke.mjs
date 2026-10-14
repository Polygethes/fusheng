import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { playNext } from "../src/engine/mockEngine.js";
import { buildRelationshipTimeline, buildInnerCourtReplay } from "../src/state/relationshipTimeline.js";

function deepClone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

const state = deepClone(initialState);
const draft = playNext(state);
const canon = {
  id: "canon_smoke",
  projectId: state.project.id,
  branchId: state.ui.activeBranchId,
  acceptedAt: new Date().toISOString(),
  title: `正史：${draft.surfaceEvent}`,
  locationId: draft.locationId,
  participantIds: draft.participantIds,
  summary: draft.sceneText,
  sourceDraftId: draft.id,
  relationshipShift: draft.relationshipShift,
  irreversibleTraces: draft.irreversibleTraces,
  replay: {
    agentOutputs: draft.agentOutputs,
    stateChangeReasons: draft.updateBundle?.stateChangeReasons || [],
  },
  preAcceptSnapshot: { canonEvents: [], draftScenes: [], characters: state.characters, relationships: state.relationships },
};
state.draftScenes = [draft];
state.canonEvents = [canon];
const relationshipShift = draft.relationshipShift?.find((shift) => shift.fromCharacterId && shift.toCharacterId);
const pairFromId = relationshipShift?.fromCharacterId || draft.participantIds?.[0];
const pairToId = relationshipShift?.toCharacterId || draft.participantIds?.[1];
const replayCharacterId = draft.agentOutputs?.[0]?.characterId || pairFromId;
assert.ok(pairFromId && pairToId && replayCharacterId, "timeline smoke requires a generated relationship pair and acting character");
const timeline = buildRelationshipTimeline(state, pairFromId, pairToId);
const court = buildInnerCourtReplay(state, replayCharacterId);
assert.ok(timeline.items.length >= 1, "timeline smoke should see one event");
assert.ok(court.items.length >= 1, "court smoke should see one event");
console.log("timeline replay smoke passed", timeline.items.length, court.items.length);
