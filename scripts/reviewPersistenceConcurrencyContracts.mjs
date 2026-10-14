import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createFileWorldRuntimeSessionRepository, worldRuntimeSessionStorageId } from "../src/server/simulation/worldRuntimeSessionRepository.mjs";

const key = { projectId: "review", branchId: "main", runtimeId: "world" };
if (process.argv[2] === "--hold") {
  const database = new DatabaseSync(path.join(process.argv[3], worldRuntimeSessionStorageId(key), ".session-lock.sqlite"));
  database.exec("BEGIN IMMEDIATE");
  process.send("locked");
  setInterval(() => { assert.equal(database.isTransaction, true); }, 1000);
} else if (process.argv[2] === "--race") {
  const repository = createFileWorldRuntimeSessionRepository({ rootDir: process.argv[3] });
  const initial = await repository.load(key);
  process.send("ready");
  await once(process, "message");
  try {
    const committed = await repository.compareAndSwap(key, { expectedSessionRevision: 0, nextRecord: { ...initial, checkpoint: { winner: process.pid } } });
    process.send({ revision: committed.sessionRevision });
  } catch (error) { process.send({ code: error.code }); }
  process.disconnect();
} else {
  const rootDir = await mkdtemp(path.join(tmpdir(), "gtown-review-lock-"));
  const children = [];
  const child = (mode) => {
    const result = fork(new URL(import.meta.url), [mode, rootDir], { silent: true });
    children.push(result);
    return result;
  };
  try {
    const repository = createFileWorldRuntimeSessionRepository({ rootDir });
    await repository.createIfAbsent(key, { sessionId: "review-session", checkpoint: {} });
    const owner = child("--hold");
    assert.equal((await once(owner, "message"))[0], "locked");
    const blocked = createFileWorldRuntimeSessionRepository({ rootDir, lockTimeoutMs: 30, lockRetryMs: 2 });
    await assert.rejects(() => blocked.compareAndSwap(key, { expectedSessionRevision: 0, nextRecord: {} }),
      (error) => error.code === "WORLD_RUNTIME_SESSION_LOCK_TIMEOUT");
    const stopped = once(owner, "exit");
    owner.kill("SIGKILL");
    await stopped;
    const writers = [child("--race"), child("--race"), child("--race")];
    await Promise.all(writers.map((writer) => once(writer, "message")));
    const replies = writers.map((writer) => once(writer, "message"));
    writers.forEach((writer) => writer.send("commit"));
    const results = (await Promise.all(replies)).map(([result]) => result);
    assert.equal(results.filter((result) => result.revision === 1).length, 1, "only one process may win revision 1 after a lock owner crashes");
    assert.equal(results.filter((result) => result.code === "WORLD_RUNTIME_SESSION_REVISION_CONFLICT").length, 2);
    const initial = await repository.load(key);
    const concurrent = await Promise.allSettled(Array.from({ length: 4 }, () => repository.compareAndSwap(key, {
      expectedSessionRevision: 1, nextRecord: initial,
    })));
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((await repository.load(key)).sessionRevision, 2);
    console.log("review cross-process lock and crash recovery contracts passed");
  } finally {
    children.forEach((process) => process.kill());
    await rm(rootDir, { recursive: true, force: true });
  }
}
