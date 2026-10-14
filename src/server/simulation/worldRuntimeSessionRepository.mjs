import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  link,
  open,
  readFile,
  readdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Durable storage for one branch-owned world runtime session.
 *
 * Every generation is immutable and becomes visible through a same-directory
 * atomic, non-overwriting link. The repository knows nothing about characters, actions or world
 * rules; it only isolates keys, performs CAS and preserves complete records.
 */
export const WORLD_RUNTIME_SESSION_RECORD_VERSION = "world-runtime-session-record-v1";
export const WORLD_RUNTIME_SESSION_REPOSITORY_VERSION = "world-runtime-session-file-repository-v1";
const SPECIAL_NUMBER_KEY = "__gtown_world_runtime_number_v1__";

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").trim();
}

function fail(code, message, evidence = {}) {
  const error = new Error(message);
  error.code = code;
  error.evidence = clone(evidence);
  return error;
}

function storageReplacer(_key, value) {
  if (typeof value !== "number" || Number.isFinite(value)) return value;
  return {
    [SPECIAL_NUMBER_KEY]: Number.isNaN(value)
      ? "NaN"
      : value === Number.POSITIVE_INFINITY ? "+Infinity" : "-Infinity",
  };
}

function storageReviver(_key, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (Object.keys(value).length !== 1 || !Object.hasOwn(value, SPECIAL_NUMBER_KEY)) return value;
  if (value[SPECIAL_NUMBER_KEY] === "+Infinity") return Number.POSITIVE_INFINITY;
  if (value[SPECIAL_NUMBER_KEY] === "-Infinity") return Number.NEGATIVE_INFINITY;
  if (value[SPECIAL_NUMBER_KEY] === "NaN") return Number.NaN;
  return value;
}

function sameSessionKey(left = {}, right = {}) {
  return clean(left.projectId) === clean(right.projectId)
    && clean(left.branchId) === clean(right.branchId)
    && clean(left.runtimeId) === clean(right.runtimeId);
}

export function normalizeWorldRuntimeSessionKey(input = {}) {
  const key = {
    projectId: clean(input.projectId),
    branchId: clean(input.branchId),
    runtimeId: clean(input.runtimeId || "world-main"),
  };
  for (const field of ["projectId", "branchId", "runtimeId"]) {
    if (!key[field]) {
      throw fail(
        "WORLD_RUNTIME_SESSION_KEY_INCOMPLETE",
        "World runtime sessions require projectId, branchId and runtimeId.",
        { field },
      );
    }
  }
  return key;
}

export function worldRuntimeSessionStorageId(input = {}) {
  const key = normalizeWorldRuntimeSessionKey(input);
  return createHash("sha256")
    .update(`${key.projectId}\0${key.branchId}\0${key.runtimeId}`)
    .digest("hex");
}

function generationFileName(revision) {
  return `generation-${String(revision).padStart(16, "0")}.json`;
}

function generationRevision(fileName = "") {
  const match = /^generation-(\d{16})\.json$/u.exec(fileName);
  return match ? Number(match[1]) : null;
}

function normalizeRecord(raw = {}, key, revision) {
  const record = clone(raw || {});
  const recordKey = normalizeWorldRuntimeSessionKey(record.key || key);
  if (!sameSessionKey(recordKey, key)) {
    throw fail("WORLD_RUNTIME_SESSION_KEY_MISMATCH", "Persisted session belongs to another project, branch or runtime.", {
      expected: key,
      actual: recordKey,
    });
  }
  const suppliedRevision = Number(record.sessionRevision);
  if (!Number.isInteger(suppliedRevision) || suppliedRevision < 0 || suppliedRevision !== revision) {
    throw fail("WORLD_RUNTIME_SESSION_REVISION_INVALID", "Persisted session revision does not match its generation.", {
      expected: revision,
      actual: record.sessionRevision,
    });
  }
  if (clean(record.schemaVersion) !== WORLD_RUNTIME_SESSION_RECORD_VERSION) {
    throw fail("WORLD_RUNTIME_SESSION_SCHEMA_UNSUPPORTED", "Unsupported world runtime session record schema.", {
      schemaVersion: record.schemaVersion,
    });
  }
  return { ...record, key: recordKey };
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    // Some filesystems do not support fsync on directories. The generation
    // itself is still written and linked atomically on the same volume.
    if (!["EINVAL", "ENOTSUP", "EISDIR", "EPERM"].includes(error?.code)) throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function latestRecordInDirectory(directory, key) {
  // Loads do not take the writer lock. Retention can remove the generation a
  // reader just listed after a newer one becomes authoritative, so retry that
  // narrow ENOENT race instead of misreporting healthy storage as corruption.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let names;
    try {
      names = await readdir(directory);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    const generations = names
      .map((name) => ({ name, revision: generationRevision(name) }))
      .filter((row) => Number.isInteger(row.revision))
      .sort((left, right) => right.revision - left.revision);
    if (!generations.length) return null;
    const latest = generations[0];
    let serialized;
    try {
      serialized = await readFile(path.join(directory, latest.name), "utf8");
    } catch (cause) {
      if (cause?.code === "ENOENT") continue;
      throw cause;
    }
    let parsed;
    try {
      parsed = JSON.parse(serialized, storageReviver);
    } catch (cause) {
      throw fail("WORLD_RUNTIME_SESSION_GENERATION_CORRUPT", "Latest session generation is not valid JSON.", {
        generation: latest.name,
        cause: cause?.message || String(cause),
      });
    }
    return normalizeRecord(parsed, key, latest.revision);
  }
  throw fail("WORLD_RUNTIME_SESSION_GENERATION_MOVED", "Session generations changed repeatedly while being loaded.", { key });
}

async function writeGeneration(directory, record) {
  return writeImmutableJson(directory, generationFileName(Number(record.sessionRevision)), record);
}

async function writeImmutableJson(directory, fileName, value) {
  const finalPath = path.join(directory, fileName);
  const temporaryPath = path.join(
    directory,
    `.${fileName}.${process.pid}.${randomUUID()}.tmp`,
  );
  const serialized = `${JSON.stringify(value, storageReplacer, 2)}\n`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await link(temporaryPath, finalPath);
    await unlink(temporaryPath);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function pruneFinalizedGenerations(directory, retainCount) {
  const names = await readdir(directory);
  const generations = names
    .map((name) => ({ name, revision: generationRevision(name) }))
    .filter((row) => Number.isInteger(row.revision))
    .sort((left, right) => right.revision - left.revision);
  const obsolete = generations.slice(Math.max(1, Number(retainCount || 1)));
  if (!obsolete.length) return;
  await Promise.all(obsolete.map(({ name }) => (
    unlink(path.join(directory, name)).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    })
  )));
  await syncDirectory(directory);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireFileLock(directory, {
  retryMs,
  timeoutMs,
} = {}) {
  // SQLite supplies an OS-backed writer lock, released even on process death.
  // The database contains no session data; generations remain readable JSON.
  // Never delete/recreate this file: all writers must lock the same inode.
  const lockPath = path.join(directory, ".session-lock.sqlite");
  const startedAt = Date.now();
  while (true) {
    let database;
    try {
      database = new DatabaseSync(lockPath);
      // A synchronous busy wait would block another writer's awaited I/O in
      // this process. Poll asynchronously instead, across separate connections.
      database.exec("PRAGMA busy_timeout = 0; CREATE TABLE IF NOT EXISTS mutex (id INTEGER PRIMARY KEY); BEGIN IMMEDIATE;");
      return () => {
        try { database.exec("ROLLBACK"); } finally { database.close(); }
      };
    } catch (error) {
      database?.close();
      const sqliteCode = Number(error?.errcode) & 255;
      if (![5, 6].includes(sqliteCode)) throw error;
      if (Date.now() - startedAt >= timeoutMs) {
        throw fail("WORLD_RUNTIME_SESSION_LOCK_TIMEOUT", "Timed out waiting for the durable session lock.", {
          timeoutMs,
        });
      }
      await wait(retryMs);
    }
  }
}

function initialRecord(input = {}, key) {
  return {
    ...clone(input),
    schemaVersion: WORLD_RUNTIME_SESSION_RECORD_VERSION,
    key: clone(key),
    sessionRevision: 0,
  };
}

export function createFileWorldRuntimeSessionRepository({
  rootDir,
  lockRetryMs = 10,
  lockTimeoutMs = 5_000,
  generationRetention = 4,
} = {}) {
  const resolvedRoot = path.resolve(clean(rootDir));
  const retainedGenerationCount = Math.max(1, Number.isInteger(Number(generationRetention))
    ? Number(generationRetention)
    : 4);
  if (!clean(rootDir)) {
    throw fail("WORLD_RUNTIME_SESSION_ROOT_REQUIRED", "File session repository requires a root directory.");
  }

  function sessionDirectory(key) {
    return path.join(resolvedRoot, worldRuntimeSessionStorageId(key));
  }

  async function prepareDirectory(key) {
    await mkdir(resolvedRoot, { recursive: true, mode: 0o700 });
    const directory = sessionDirectory(key);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return directory;
  }

  async function withLock(key, callback) {
    const directory = await prepareDirectory(key);
    const release = await acquireFileLock(directory, {
      retryMs: Math.max(1, Number(lockRetryMs || 10)),
      timeoutMs: Math.max(1, Number(lockTimeoutMs || 5_000)),
    });
    try {
      return await callback(directory);
    } finally {
      await release();
    }
  }

  return {
    schemaVersion: WORLD_RUNTIME_SESSION_REPOSITORY_VERSION,
    rootDir: resolvedRoot,
    async load(inputKey = {}) {
      const key = normalizeWorldRuntimeSessionKey(inputKey);
      return clone(await latestRecordInDirectory(sessionDirectory(key), key));
    },
    async appendExecutionRecord(inputKey = {}, { sessionId, expectedSessionRevision, record } = {}) {
      const key = normalizeWorldRuntimeSessionKey(inputKey);
      return withLock(key, async directory => {
        const current = await latestRecordInDirectory(directory, key);
        if (current?.sessionId !== sessionId || current?.sessionRevision !== expectedSessionRevision) {
          throw fail("WORLD_RUNTIME_SESSION_REVISION_CONFLICT", "A stale command cannot append execution records.");
        }
        const auditDirectory = path.join(directory, "execution-audit");
        await mkdir(auditDirectory, { recursive: true, mode: 0o700 });
        const digest = createHash("sha256").update(JSON.stringify(record, storageReplacer)).digest("hex");
        const fileName = `${digest}.json`;
        try { await writeImmutableJson(auditDirectory, fileName, { sessionId, record }); }
        catch (error) { if (error.code !== "EEXIST") throw error; }
        return { digest };
      });
    },
    async saveSnapshot(inputKey = {}, { sessionId, sessionRevision } = {}) {
      const key = normalizeWorldRuntimeSessionKey(inputKey);
      const revision = Number(sessionRevision);
      if (!Number.isInteger(revision) || revision < 0) {
        throw fail("WORLD_RUNTIME_SESSION_EXPECTED_REVISION_INVALID", "Snapshot requires an exact session revision.");
      }
      // Hold the writer lock while reading an old generation so retention
      // cannot prune it before the immutable save has been made durable.
      return withLock(key, async (directory) => {
        let record;
        try {
          record = normalizeRecord(JSON.parse(await readFile(path.join(directory, generationFileName(revision)), "utf8"), storageReviver), key, revision);
        } catch (error) {
          if (error?.code === "ENOENT") throw fail("WORLD_RUNTIME_SNAPSHOT_UNAVAILABLE", "该存档的服务端版本已不可用，无法恢复到当时的进度。");
          throw error;
        }
        if (!clean(sessionId) || clean(record.sessionId) !== clean(sessionId)) {
          throw fail("TAVERN_V27_SESSION_ID_MISMATCH", "Snapshot does not belong to the supplied session.");
        }
        if (record.commands?.some(row => row.status === "prepared")) {
          throw fail("WORLD_RUNTIME_COMMAND_IN_PROGRESS", "请等待当前回合结算后再保存。");
        }
        const snapshotId = randomUUID();
        const snapshotDirectory = path.join(resolvedRoot, "snapshots");
        await mkdir(snapshotDirectory, { recursive: true, mode: 0o700 });
        await writeImmutableJson(snapshotDirectory, `${snapshotId}.json`, {
          schemaVersion: "world-runtime-session-snapshot-v1", snapshotId, record,
        });
        return { snapshotId, record: clone(record) };
      });
    },
    async loadSnapshot(snapshotId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(clean(snapshotId))) {
        throw fail("WORLD_RUNTIME_SNAPSHOT_ID_INVALID", "Snapshot requires an opaque server-issued id.");
      }
      let snapshot;
      try {
        snapshot = JSON.parse(await readFile(path.join(resolvedRoot, "snapshots", `${snapshotId}.json`), "utf8"), storageReviver);
      } catch (error) {
        if (error?.code === "ENOENT") throw fail("WORLD_RUNTIME_SNAPSHOT_UNAVAILABLE", "服务端存档已不存在，无法恢复到当时的进度。");
        throw error;
      }
      if (snapshot.schemaVersion !== "world-runtime-session-snapshot-v1" || snapshot.snapshotId !== snapshotId) {
        throw fail("WORLD_RUNTIME_SNAPSHOT_INVALID", "Unsupported snapshot record.");
      }
      return normalizeRecord(snapshot.record, normalizeWorldRuntimeSessionKey(snapshot.record?.key), snapshot.record?.sessionRevision);
    },
    async createIfAbsent(inputKey = {}, inputRecord = {}) {
      const key = normalizeWorldRuntimeSessionKey(inputKey);
      return withLock(key, async (directory) => {
        const existing = await latestRecordInDirectory(directory, key);
        if (existing) return { created: false, record: clone(existing) };
        const record = initialRecord(inputRecord, key);
        await writeGeneration(directory, record);
        // Retention is maintenance after the new generation is already
        // authoritative. A cleanup failure must not turn a committed CAS into
        // an apparent command failure; the next successful write retries it.
        await pruneFinalizedGenerations(directory, retainedGenerationCount).catch(() => undefined);
        return { created: true, record: clone(record) };
      });
    },
    async compareAndSwap(inputKey = {}, {
      expectedSessionRevision,
      nextRecord = {},
    } = {}) {
      const key = normalizeWorldRuntimeSessionKey(inputKey);
      const expected = Number(expectedSessionRevision);
      if (!Number.isInteger(expected) || expected < 0) {
        throw fail("WORLD_RUNTIME_SESSION_EXPECTED_REVISION_INVALID", "CAS requires a non-negative expectedSessionRevision.");
      }
      return withLock(key, async (directory) => {
        const current = await latestRecordInDirectory(directory, key);
        if (!current) throw fail("WORLD_RUNTIME_SESSION_NOT_FOUND", "World runtime session does not exist.", { key });
        if (current.sessionRevision !== expected) {
          throw fail("WORLD_RUNTIME_SESSION_REVISION_CONFLICT", "World runtime session changed before this command could commit.", {
            expectedSessionRevision: expected,
            actualSessionRevision: current.sessionRevision,
            key,
          });
        }
        const record = {
          ...clone(nextRecord),
          schemaVersion: WORLD_RUNTIME_SESSION_RECORD_VERSION,
          key: clone(key),
          sessionRevision: expected + 1,
        };
        await writeGeneration(directory, record);
        await pruneFinalizedGenerations(directory, retainedGenerationCount).catch(() => undefined);
        return clone(record);
      });
    },
  };
}
