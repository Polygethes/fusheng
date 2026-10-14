import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import {
  buildSaveMetadata,
  createMemorySaveDriver,
  createSaveRepository,
  prepareSavePayload,
} from "../src/state/saveSlots.js";

let nowValue = Date.parse("2026-07-10T18:00:00.000Z");
let idValue = 0;
const repository = createSaveRepository({
  driver: createMemorySaveDriver(),
  now: () => new Date(nowValue).toISOString(),
  idFactory: () => `save_${++idValue}`,
});

const state = structuredClone(initialState);
state.town.name = "梯云城";
state.project.title = "逍遥游 · 梯云城";
state.ui.activeTab = "saves";
state.ui.saveReturnTab = "reality";
state.ui.livePerformance = { status: "running", novelText: "不应保存的半句" };
state.ui.lastPlayError = "fetch failed";
state.ui.saveSlots = [{ id: "transient" }];
state.ui.saveSlotsStatus = "ready";
state.ui.observerPlayback = { draftId: "draft_1", visibleCount: 2, totalCount: 8, status: "playing" };
state.characters[0].internalSituation.inadmissibleDesire = "PRIVATE_SNAPSHOT_ONLY";

const payload = prepareSavePayload(state);
const parsed = JSON.parse(payload);
assert.equal(parsed.ui.activeTab, "reality", "loading a save should return to the space open before the save library");
assert.equal(parsed.ui.livePerformance, null, "an in-flight model connection must not be restored");
assert.equal(parsed.ui.lastPlayError, "", "transient connection errors must not be restored");
assert.equal(parsed.ui.observerPlayback.status, "complete", "an in-progress reading cursor should become a stable completed view");
assert.ok(!("saveSlots" in parsed.ui), "save-library summaries must not recursively enter payloads");
assert.match(payload, /PRIVATE_SNAPSHOT_ONLY/, "the complete private character state should remain inside the saved snapshot");

const metadata = buildSaveMetadata(state);
assert.equal(metadata.worldName, "梯云城");
assert.equal(metadata.characterCount, state.characters.length);

const first = await repository.save({ name: "入城之前", payload, metadata });
assert.equal(first.id, "save_1");
assert.equal(first.name, "入城之前");

nowValue += 60_000;
const second = await repository.save({ name: "剑阁清晨", payload: prepareSavePayload({ ...state, town: { ...state.town, name: "第二座城" } }), metadata: { ...metadata, worldName: "第二座城" } });
assert.equal(second.id, "save_2");

const listed = await repository.list();
assert.deepEqual(listed.map((save) => save.id), ["save_2", "save_1"], "newest saves should appear first");
assert.ok(listed.every((save) => !("payload" in save)), "save lists must never expose full private payloads");

const loaded = await repository.load(first.id);
assert.equal(loaded.name, "入城之前");
assert.match(loaded.payload, /PRIVATE_SNAPSHOT_ONLY/, "loading should return the complete snapshot only on demand");

nowValue += 60_000;
const overwritten = await repository.save({ id: first.id, name: first.name, payload: prepareSavePayload({ ...state, town: { ...state.town, name: "覆盖后的梯云城" } }), metadata: { ...metadata, worldName: "覆盖后的梯云城" } });
assert.equal(overwritten.id, first.id, "overwrite should keep the save identity");
assert.equal(overwritten.createdAt, first.createdAt, "overwrite should preserve original creation time");
assert.equal(JSON.parse((await repository.load(first.id)).payload).town.name, "覆盖后的梯云城");

await repository.delete(second.id);
assert.deepEqual((await repository.list()).map((save) => save.id), [first.id], "delete should remove only the selected save");
await assert.rejects(() => repository.load("missing"), /不存在/, "missing saves should fail clearly");

console.log("saveSlotsRepository:test passed");
