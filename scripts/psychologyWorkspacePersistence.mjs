import assert from "node:assert/strict";
import {
  exportState,
  getState,
  importState,
  resetState,
  saveDraft,
} from "../src/state/store.js";

resetState();
saveDraft({
  id: "draft_psychology_persistence",
  createdAt: "2026-07-09T12:00:00.000Z",
  locationId: "loc_gregor_room",
  participantIds: ["char_gregor", "char_grete"],
  sceneText: "格里高尔没有开门。",
  novelText: "门板轻轻响了一下，格里高尔仍然没有开门。",
  dialoguePsychology: [{
    characterId: "char_gregor",
    characterName: "格里高尔",
    heardLine: "你还好吗？",
    speakerName: "格蕾特",
    interpretation: "她还没有厌弃我。",
    feeling: "羞耻里冒出一点希望",
    bodyResponse: "额头贴住门板。",
    privateThought: "再叫一次我的名字。",
    selfLie: "我只需要再睡一会儿。",
    nextImpulse: "隔着门回答她。",
  }],
  privateSimulations: [{
    id: "private_gregor",
    characterId: "char_gregor",
    targetCharacterId: "char_grete",
    privateDesire: "想听见妹妹仍然叫他的名字。",
    defensiveMask: "我只是误了车。",
    shadowImpulse: "让门外的人继续等。",
    whatTheyRefuseToAdmit: "他不想再去上班。",
    mistakenBelief: "只要还能解释，一切就没有改变。",
  }],
});

const exported = exportState();
importState(exported);
const restored = getState().draftScenes.find((draft) => draft.id === "draft_psychology_persistence");
const privateState = restored?.privateSimulations?.[0];

assert.equal(privateState?.privateDesire, "想听见妹妹仍然叫他的名字。", "private desire should survive export/import");
assert.equal(privateState?.mistakenBelief, "只要还能解释，一切就没有改变。", "mistaken belief should survive export/import");
assert.equal(privateState?.whatTheyRefuseToAdmit, "他不想再去上班。", "refused admission should survive export/import");
assert.equal(restored?.novelText, "门板轻轻响了一下，格里高尔仍然没有开门。", "canonical novel prose should survive export/import");
assert.equal(restored?.dialoguePsychology?.[0]?.privateThought, "再叫一次我的名字。", "dialogue-aware psychology should survive export/import");

console.log("psychologyWorkspacePersistence:test passed", { draftId: restored.id });
