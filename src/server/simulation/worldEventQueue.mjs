// 天意 for a running world (P6.6b). The observer's server cannot reach into
// the runner process, so it appends each player world event as one JSON line
// to <run>/world-events.jsonl. Before every turn the runner takes the lines it
// has not seen, lets the world settle each one (runtime.applyWorldEvent), and
// writes what happened to <run>/world-events-results.jsonl. A rejected event
// changes nothing; its problems are recorded for the page to show.
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";

export const WORLD_EVENT_QUEUE_FILE = "world-events.jsonl";
export const WORLD_EVENT_RESULTS_FILE = "world-events-results.jsonl";

const clean = (value) => String(value ?? "").trim();

/** Complete lines only: a line still being written (no newline yet) waits for the next look. */
export async function readQueuedLines(file) {
  let text = "";
  try { text = await readFile(file, "utf8"); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  return text.slice(0, text.lastIndexOf("\n") + 1).split("\n").filter((line) => line.trim());
}

export function parseQueued(line) {
  try {
    const row = JSON.parse(line);
    return row && typeof row === "object" && clean(row.eventId) && row.event && typeof row.event === "object" ? row : null;
  } catch { return null; }
}

export function createWorldEventQueue({ dir, runtime, log = () => {} } = {}) {
  const queueFile = path.join(dir, WORLD_EVENT_QUEUE_FILE);
  const resultsFile = path.join(dir, WORLD_EVENT_RESULTS_FILE);
  let seen = 0;
  const record = (row) => appendFile(resultsFile, `${JSON.stringify(row)}\n`, { mode: 0o600 });
  return {
    /** Settles every event queued since the last look. Returns how many were applied. */
    async applyQueued() {
      const lines = await readQueuedLines(queueFile);
      const fresh = lines.slice(seen);
      seen = lines.length;
      let applied = 0;
      for (const line of fresh) {
        const row = parseQueued(line);
        if (!row) { await record({ eventId: "", status: "rejected", code: "WORLD_EVENT_UNREADABLE", message: "这条天意读不出来。" }); continue; }
        try {
          const outcome = await runtime.applyWorldEvent(row.event);
          applied += 1;
          await record({ eventId: row.eventId, status: "applied", worldVersion: outcome.worldVersion, nowSeconds: outcome.nowSeconds,
            delivered: (outcome.deliveries || []).length });
          log({ event: "world_event_applied", eventId: row.eventId, kind: clean(row.event.kind), delivered: (outcome.deliveries || []).length });
        } catch (error) {
          if (!["WORLD_EVENT_INVALID", "WORLD_EVENT_UNSUPPORTED"].includes(error.code)) throw error;
          const issues = error.evidence?.issues || error.issues || [];
          await record({ eventId: row.eventId, status: "rejected", code: error.code, message: issues.map((issue) => issue.message).join("；") || error.message, issues });
          log({ event: "world_event_rejected", eventId: row.eventId, code: error.code });
        }
      }
      return applied;
    },
  };
}

/** The queue as the page sees it: every queued event with its result, if any. */
export async function listWorldEvents(dir) {
  const results = new Map((await readQueuedLines(path.join(dir, WORLD_EVENT_RESULTS_FILE)))
    .map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter((row) => row?.eventId).map((row) => [row.eventId, row]));
  return (await readQueuedLines(path.join(dir, WORLD_EVENT_QUEUE_FILE))).map(parseQueued).filter(Boolean).map((row) => {
    const result = results.get(row.eventId);
    return { eventId: row.eventId, receivedAt: row.receivedAt || "", kind: clean(row.event.kind), status: result?.status || "queued",
      ...(result?.message ? { message: result.message } : {}), ...(result?.delivered != null ? { delivered: result.delivered } : {}) };
  });
}
