import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { resetState, getState, saveDraft, acceptDraft, undoCanonEvent, replayCanonEvent } from "../src/state/store.js";
import { buildRelationshipTimeline, buildInnerCourtReplay, buildUndoPreview } from "../src/state/relationshipTimeline.js";

resetState();
let state = getState();
state.ui.engineMode = "mock";
const draft = playNext(state);
saveDraft(draft);
const canon = acceptDraft(draft.id, draft.updateBundle);
assert.ok(canon?.preAcceptSnapshot, "canon event should keep pre-accept snapshot");
assert.ok(canon?.postAcceptSnapshot, "canon event should keep post-accept snapshot");
assert.ok(canon?.replay?.agentOutputs?.length >= 1, "canon event should keep agent replay payload");

state = getState();
const relationshipShift = draft.relationshipShift?.find((shift) => shift.fromCharacterId && shift.toCharacterId);
const pairFromId = relationshipShift?.fromCharacterId || draft.participantIds?.[0];
const pairToId = relationshipShift?.toCharacterId || draft.participantIds?.[1];
const replayCharacterId = draft.agentOutputs?.[0]?.characterId || pairFromId;
assert.ok(pairFromId && pairToId && replayCharacterId, "timeline fixture requires a generated relationship pair and acting character");
const pair = buildRelationshipTimeline(state, pairFromId, pairToId);
assert.ok(pair.items.length >= 1, "relationship timeline should include accepted event");
const court = buildInnerCourtReplay(state, replayCharacterId);
assert.ok(court.items.length >= 1, "inner court replay should include character action");
const preview = buildUndoPreview(state, canon.id);
assert.ok(preview?.canRewind, "undo preview should be available");

const marker = undoCanonEvent(canon.id);
assert.ok(marker?.sourceCanonEventId === canon.id, "undo should create replay marker");
state = getState();
assert.equal(state.canonEvents.length, 0, "undo should restore snapshot before accepted canon");
assert.equal(state.replayMarkers.length, 1, "undo should leave replay marker");
const replayEvent = replayCanonEvent(marker.id);
assert.ok(replayEvent?.id === canon.id, "replay marker should recover source canon event");
console.log("timeline replay test passed", draft.id, canon.id, marker.id);
