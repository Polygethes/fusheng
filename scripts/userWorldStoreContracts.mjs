import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import {
  USER_WORLD_ID,
  userWorldsRoot,
  listUserWorldIds,
  loadUserWorldPack,
  saveUserWorld,
  removeUserWorld,
  exportUserWorld,
  importUserWorld,
} from "../src/worlds/userWorldStore.mjs";
import { listWorldPackIds, loadWorldPack, isBuiltInWorld } from "../src/worlds/registry.mjs";
import { validateWorldPack } from "../src/worlds/validateWorldPack.mjs";
import { createFreshWorldSave } from "../src/worlds/freshWorld.mjs";
import { createWorldsApi } from "../src/server/observer/worldsApi.mjs";

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gtown-user-worlds-test-"));
const testEnv = { CHARACTER_TOWN_HOME: tmpDir };

try {
  // 1. Built-in checks
  assert.equal(isBuiltInWorld("jiexing"), true);
  assert.equal(isBuiltInWorld("xiaoyaoyou"), true);
  assert.equal(isBuiltInWorld("non_existent"), false);

  // 2. Initial state: no user worlds
  assert.deepEqual(listUserWorldIds(testEnv), []);
  const initialPackIds = listWorldPackIds(testEnv);
  assert.ok(initialPackIds.includes("jiexing"));
  assert.ok(initialPackIds.includes("xiaoyaoyou"));

  // 3. Clone jiexing pack and save as jx_copy
  const jxPack = await loadWorldPack("jiexing");
  const copyPack = JSON.parse(JSON.stringify(jxPack));
  copyPack.meta.id = "jx_copy";
  copyPack.meta.title = "借星副本";

  const savedId = await saveUserWorld({ pack: copyPack }, testEnv);
  assert.equal(savedId, "jx_copy");

  // Verify list & registry integration
  assert.deepEqual(listUserWorldIds(testEnv), ["jx_copy"]);
  const packIdsWithCopy = listWorldPackIds(testEnv);
  assert.ok(packIdsWithCopy.includes("jx_copy"));
  assert.equal(isBuiltInWorld("jx_copy"), false);

  // Load from registry
  const loadedUserPack = await loadWorldPack("jx_copy", testEnv);
  assert.equal(loadedUserPack.meta.id, "jx_copy");
  assert.equal(loadedUserPack.meta.title, "借星副本");
  assert.equal(validateWorldPack(loadedUserPack).ok, true);

  // Fresh world save works on user world
  const freshSaveResult = await createFreshWorldSave(loadedUserPack, { runId: "test_run_01" });
  assert.equal(freshSaveResult.save.worldPackId, "jx_copy");

  // 4. Overwriting built-in id fails with WORLD_ID_RESERVED
  await assert.rejects(
    async () => {
      const invalidClone = JSON.parse(JSON.stringify(copyPack));
      invalidClone.meta.id = "jiexing";
      await saveUserWorld({ pack: invalidClone }, testEnv);
    },
    (err) => err.code === "WORLD_ID_RESERVED"
  );

  // 5. Invalid id check
  await assert.rejects(
    async () => {
      const badId = JSON.parse(JSON.stringify(copyPack));
      badId.meta.id = "../evil";
      await saveUserWorld({ pack: badId }, testEnv);
    },
    (err) => err.code === "WORLD_PACK_ID_INVALID"
  );

  await assert.rejects(
    async () => {
      await loadUserWorldPack("../evil", testEnv);
    },
    (err) => err.code === "WORLD_PACK_ID_INVALID"
  );

  // 6. Export and import
  const bundle = await exportUserWorld("jx_copy", testEnv);
  assert.equal(bundle.format, "character-town-world");
  assert.equal(bundle.formatVersion, 1);
  assert.equal(bundle.pack.meta.id, "jx_copy");

  // Import without collision should increment suffix if id exists
  const importedId = await importUserWorld(bundle, testEnv);
  assert.equal(importedId, "jx_copy-2");
  assert.ok(listUserWorldIds(testEnv).includes("jx_copy-2"));

  // Import again should get -3
  const importedId3 = await importUserWorld(bundle, testEnv);
  assert.equal(importedId3, "jx_copy-3");

  // 7. Remove user world (soft delete to .trash)
  await removeUserWorld("jx_copy", testEnv);
  assert.ok(!listUserWorldIds(testEnv).includes("jx_copy"));
  const trashItems = await fs.readdir(path.join(userWorldsRoot(testEnv), ".trash"));
  assert.ok(trashItems.some((f) => f.startsWith("jx_copy-")));

  // 8. Test worldsApi HTTP endpoints
  const api = createWorldsApi({ env: testEnv });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const handled = await api.handle(req, res, url);
    if (!handled) {
      res.writeHead(404);
      res.end("Not Found");
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function call(pathname, { method = "GET", headers = {}, body = null } = {}) {
    const opts = { method, headers: { ...headers } };
    if (body !== null) {
      opts.headers["content-type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${baseUrl}${pathname}`, opts);
    let parsed = null;
    const text = await res.text();
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: res.status, headers: res.headers, body: parsed };
  }

  // GET /api/library
  const lib = await call("/api/library");
  assert.equal(lib.status, 200);
  assert.ok(Array.isArray(lib.body.worlds));
  const builtInItem = lib.body.worlds.find((w) => w.id === "jiexing");
  assert.ok(builtInItem);
  assert.equal(builtInItem.builtIn, true);
  const copy2Item = lib.body.worlds.find((w) => w.id === "jx_copy-2");
  assert.ok(copy2Item);
  assert.equal(copy2Item.builtIn, false);

  // DELETE /api/library/jiexing -> 403 (built-in protected)
  const delBuiltIn = await call("/api/library/jiexing", {
    method: "DELETE",
    headers: { host: "127.0.0.1", origin: baseUrl },
  });
  assert.equal(delBuiltIn.status, 403);

  // Cross-origin DELETE -> 403
  const crossDel = await call("/api/library/jx_copy-2", {
    method: "DELETE",
    headers: { origin: "http://attacker.example" },
  });
  assert.equal(crossDel.status, 403);

  // GET /api/library/jx_copy-2/export
  const exportRes = await call("/api/library/jx_copy-2/export");
  assert.equal(exportRes.status, 200);
  assert.equal(exportRes.headers.get("content-disposition"), 'attachment; filename="jx_copy-2.world.json"');
  assert.equal(exportRes.body.format, "character-town-world");

  // POST /api/library/import (bundle.pack.meta.id is "jx_copy", which was removed, so it takes "jx_copy")
  const postImport = await call("/api/library/import", {
    method: "POST",
    headers: { host: "127.0.0.1", origin: baseUrl, "content-type": "application/json" },
    body: bundle,
  });
  assert.equal(postImport.status, 200);
  assert.equal(postImport.body.ok, true);
  assert.equal(postImport.body.id, "jx_copy");

  // A3 contract: Importing a broken pack is rejected with WORLD_PACK_INVALID and not saved
  const brokenBundle = {
    format: "character-town-world",
    formatVersion: 1,
    pack: { meta: { id: "broken" }, cast: "nope" },
  };
  await assert.rejects(
    async () => {
      await importUserWorld(brokenBundle, testEnv);
    },
    (err) => err.code === "WORLD_PACK_INVALID"
  );
  assert.ok(!listUserWorldIds(testEnv).includes("broken"));

  const postImportBroken = await call("/api/library/import", {
    method: "POST",
    headers: { host: "127.0.0.1", origin: baseUrl, "content-type": "application/json" },
    body: brokenBundle,
  });
  assert.equal(postImportBroken.status, 400);
  assert.equal(postImportBroken.body.code, "WORLD_PACK_INVALID");
  assert.ok(!listUserWorldIds(testEnv).includes("broken"));

  // DELETE /api/library/jx_copy-2 -> 200
  const delUser = await call("/api/library/jx_copy-2", {
    method: "DELETE",
    headers: { host: "127.0.0.1", origin: baseUrl },
  });
  assert.equal(delUser.status, 200);
  assert.equal(delUser.body.ok, true);

  server.close();
  console.log("User world store and library API contracts passed.");
} finally {
  await fs.rm(tmpDir, { recursive: true, force: true });
}
