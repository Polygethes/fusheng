import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { renderApp } from "../src/ui/render.js";

const state = structuredClone(initialState);
state.town.name = "梯云城";
state.project.title = "逍遥游 · 梯云城";
state.ui.setupCompleted = true;
state.ui.activeTab = "saves";
state.ui.saveSlotsStatus = "ready";
state.ui.saveSlots = [{
  id: "save_xiaoyaoyou_1",
  name: "剑阁清晨",
  worldName: "梯云城",
  branchTitle: "主线",
  updatedAt: "2026-07-10T18:00:00.000Z",
  characterCount: 7,
  canonCount: 2,
  draftCount: 1,
  payload: "PRIVATE_PAYLOAD_MUST_NOT_RENDER",
}];

const html = renderApp(state);
assert.match(html, /data-tab="saves"[^>]*>存档</, "the More menu should open the save library");
assert.match(html, /id="save-world-form"/, "the save library should provide a named save command");
assert.match(html, /data-save-library="true"/, "the active save library should have a stable UI contract");
assert.match(html, /剑阁清晨/, "a saved world's chosen name should be visible");
assert.match(html, /梯云城/, "the world identity should be visible");
assert.match(html, /7 位人物/, "the save summary should show cast size");
assert.match(html, /data-action="load-save"[^>]*data-id="save_xiaoyaoyou_1"/, "each save should be loadable");
assert.match(html, /data-action="overwrite-save"[^>]*data-id="save_xiaoyaoyou_1"/, "each save should be overwritable");
assert.match(html, /data-action="delete-save"[^>]*data-id="save_xiaoyaoyou_1"/, "each save should be deletable");
assert.doesNotMatch(html, /PRIVATE_PAYLOAD_MUST_NOT_RENDER/, "full save payloads and private psychology must never render in the library");

state.ui.saveSlots = [];
const emptyHtml = renderApp(state);
assert.match(emptyHtml, /还没有手动存档/, "an empty save library should be explicit");

console.log("saveLibraryUi:test passed");
