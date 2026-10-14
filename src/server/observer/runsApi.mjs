// Run browser and operator controls for the pixel stage observer.
//
//   GET  /api/worlds                  registered world packs
//   GET  /api/runs                    saved runs, the active run, whether a model key is configured
//   GET  /api/saves                   runs grouped into save slots (a run and the runs that continued it)
//   GET  /api/runs/:id/feed?after=N   stage frames after seq N, plus the world's layout and cast
//   GET  /api/runs/:id/stream         server-sent events with new frames as the run's save changes
//   POST /api/runs/start              start a real-model run (explicit authorization and caps required)
//   POST /api/runs/:id/stop           stop the active run after its current turn
//   POST /api/runs/:id/events         queue a player world event (天意) for the active run
//   GET  /api/runs/:id/events         the run's queued world events and what became of them
//
// The model key stays in this process's environment; it is never returned,
// logged or written by these routes.
import path from "node:path";
import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { WORLD_EVENT_KINDS } from "../simulation/worldEvents.mjs";
import { listWorldEvents, WORLD_EVENT_QUEUE_FILE } from "../simulation/worldEventQueue.mjs";
import { existsSync, watch } from "node:fs";
import { listWorldPackIds, loadWorldPack } from "../../worlds/registry.mjs";
import { resolveCallMode } from "../../worlds/callMode.mjs";
import { buildObserverFeed } from "./observerFeed.mjs";

const RUN_ID = /^[\w][\w.-]{0,119}$/u;
const MODEL = /^[\w.:-]{1,80}$/u;

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 16 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request body too large."), { status: 413, code: "BODY_TOO_LARGE" });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw Object.assign(new Error("Request body must be JSON."), { status: 400, code: "BODY_NOT_JSON" }); }
}

export function worldVisual(pack) {
  const facts = new Map((pack.social?.facts || []).map((fact) => [fact.factId, fact]));
  const households = pack.meta?.scale !== "town" ? [] : (pack.social?.boundaries || []).flatMap((boundary) => {
    const claimant = facts.get(boundary.evidenceIds?.[0])?.claimantId || "";
    if (!claimant.startsWith("household:")) return [];
    return [{ label: claimant.slice("household:".length), members: boundary.exemptActorIds || [] }];
  });
  return {
    id: pack.meta.id, title: pack.meta.title, clockLabel: pack.layout?.clockLabel || pack.clock?.startLabel || "",
    startClock: pack.clock?.startClock || "",
    placeName: pack.stage.name, layout: pack.layout, scale: pack.meta?.scale || "",
    zones: Object.fromEntries(Object.entries(pack.stage.topology.zones).map(([id, zone]) => [id, zone.label || id])),
    cast: pack.cast.map((member) => ({ id: member.id, name: member.name, title: member.title, appearance: member.appearance || {} })),
    sceneCast: [...pack.stage.sceneCast],
    report: pack.report?.metrics || [],
    agenda: (pack.agenda?.items || []).map((item) => ({ id: item.id, label: item.label })),
    work: (pack.work || []).map((row) => ({ templateId: row.templateId, taskLabel: row.taskLabel, unitAction: row.unitAction, unitLabel: row.unitLabel, objectIds: [...(row.objectIds || [])] })),
    households,
  };
}

function defaultSpawnRunner({ args, cwd, env }) {
  return spawn(process.execPath, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
}

// Older reports predate the field; every run then used three calls.
const effectiveCallMode = (report) => report?.callMode || (report ? "three-call" : null);

// Why a run stopped with an error, in the runner's own words (it never contains the key).
const failureOf = (entry) => (entry?.report?.status === "failed" ? String(entry.report.error?.message || entry.report.error?.code || "").slice(0, 160) || null : null);

// New runs are written under runsRoot (the player's data home). Older run
// folders (legacyRunsRoots, e.g. the project's sim-runs/) are listed, replayed
// and continued from, but never written to: a continuation is a new run.
export function createRunsApi({ runsRoot, legacyRunsRoots = [], projectRoot, env = process.env, spawnRunner = defaultSpawnRunner, clock = () => new Date() } = {}) {
  const currentEnv = async () => (typeof env === "function" ? await env() : env);
  const root = path.resolve(runsRoot);
  const roots = [root, ...legacyRunsRoots.map((dir) => path.resolve(dir)).filter((dir) => dir !== root)];
  const saves = new Map();
  let active = null;

  function runDirectory(id) {
    if (!RUN_ID.test(String(id || ""))) return null;
    for (const base of roots) {
      const directory = path.resolve(base, id);
      if (path.dirname(directory) !== base) return null;
      if (existsSync(directory)) return directory;
    }
    return path.resolve(root, id);
  }

  /** Run folder names across all roots; a name in runsRoot hides the same name in an older root. */
  async function runNames() {
    const names = new Set();
    for (const base of roots) {
      try { for (const row of await readdir(base, { withFileTypes: true })) if (row.isDirectory() && RUN_ID.test(row.name)) names.add(row.name); } catch { /* no runs there */ }
    }
    return [...names];
  }

  async function loadSave(id) {
    const directory = runDirectory(id);
    if (!directory) return null;
    const file = path.join(directory, "world-save.json");
    let info;
    try { info = await stat(file); } catch { return null; }
    const cached = saves.get(id);
    if (cached && cached.mtimeMs === info.mtimeMs) return cached;
    let save;
    try { save = JSON.parse(await readFile(file, "utf8")); } catch { return cached || null; }
    let report = null;
    try { report = JSON.parse(await readFile(path.join(directory, "report.json"), "utf8")); } catch { /* relay and fresh saves have none */ }
    const entry = { mtimeMs: info.mtimeMs, save, report, feed: null };
    saves.set(id, entry);
    return entry;
  }

  function runStatus(id, entry) {
    if (active?.runId === id && !active.exited) return active.stopRequested ? "stopping" : "running";
    const status = entry?.report?.status || entry?.save?.summary?.stopReason || "waiting";
    return status === "running" ? "interrupted" : status;
  }

  function runMeta(id, entry) {
    const save = entry.save;
    return {
      id, worldPackId: save.worldPackId || "xiaoyaoyou", settled: (save.settledTurns || []).length,
      status: runStatus(id, entry), provenance: save.provenance?.continuation?.kind || save.provenance?.kind || "unknown",
      model: entry.report?.requestedModel || null, calls: entry.report?.calls?.length ?? null, callMode: effectiveCallMode(entry.report), updatedAt: new Date(entry.mtimeMs).toISOString(),
      error: failureOf(entry),
    };
  }

  async function feedFor(id) {
    const entry = await loadSave(id);
    if (!entry) return null;
    if (!entry.feed) {
      const pack = await loadWorldPack(entry.save.worldPackId || "xiaoyaoyou");
      entry.feed = { pack, feed: buildObserverFeed(entry.save, pack) };
    }
    return { entry, ...entry.feed };
  }

  // A continued run records the save it resumed from; following those links
  // turns the flat run directories into save slots, newest segment first.
  function parentRunId(entry) {
    const source = String(entry?.report?.source || "");
    if (!source || source.startsWith("fresh-world:")) return null;
    const directory = path.dirname(path.resolve(source));
    return roots.includes(path.dirname(directory)) ? path.basename(directory) : null;
  }

  async function listSaves() {
    const names = await runNames();
    const nodes = new Map();
    for (const name of names) {
      const entry = await loadSave(name);
      if (entry?.save?.checkpoint?.coordinator) nodes.set(name, { id: name, entry, parent: parentRunId(entry) });
    }
    const children = new Map();
    for (const node of nodes.values()) if (node.parent && nodes.has(node.parent)) children.set(node.parent, [...(children.get(node.parent) || []), node.id]);
    const packs = new Map();
    const packFor = async (id) => {
      if (!packs.has(id)) { try { packs.set(id, await loadWorldPack(id)); } catch { packs.set(id, null); } }
      return packs.get(id);
    };
    const slots = [];
    for (const leaf of nodes.values()) {
      if (children.has(leaf.id)) continue;
      const chain = [leaf];
      const seen = new Set([leaf.id]);
      while (chain[0].parent && nodes.has(chain[0].parent) && !seen.has(chain[0].parent)) {
        seen.add(chain[0].parent);
        chain.unshift(nodes.get(chain[0].parent));
      }
      const { save, report } = leaf.entry;
      const worldPackId = save.worldPackId || "xiaoyaoyou";
      const pack = await packFor(worldPackId);
      const worldState = save.checkpoint.coordinator.worldState || {};
      const zoneLabel = (id) => pack?.stage?.topology?.zones?.[id]?.label || id || "";
      const castIds = pack?.stage?.sceneCast || Object.keys(worldState.entities || {});
      const spoken = [...(save.settledTurns || [])].reverse().find((row) => String(row?.speech || "").trim());
      const fork = chain.slice(0, -1).find((node) => (children.get(node.id) || []).length > 1);
      const root = chain[0].entry;
      slots.push({
        id: leaf.id, worldPackId, worldTitle: pack?.meta?.title || worldPackId, placeName: pack?.stage?.name || "",
        clockLabel: pack?.clock?.startLabel || pack?.layout?.clockLabel || "",
        storySeconds: Math.max(0, Number(worldState.nowSeconds || 0)), settled: (save.settledTurns || []).length,
        segments: chain.map((node) => node.id), branchedFrom: fork?.id || null,
        status: runStatus(leaf.id, leaf.entry), calls: active?.runId === leaf.id && !active.exited ? active.calls : report?.calls?.length ?? null,
        model: report?.requestedModel || null, callMode: effectiveCallMode(report),
        createdAt: root.report?.startedAt || new Date(root.mtimeMs).toISOString(), updatedAt: new Date(leaf.entry.mtimeMs).toISOString(),
        lastLine: spoken ? { speaker: spoken.characterName || spoken.characterId, text: String(spoken.speech).trim().slice(0, 80) } : null,
        cast: castIds.map((id) => worldState.entities?.[id]).filter((row) => row?.kind === "character" || row?.name)
          .map((row) => ({ id: row.id, name: row.name || row.id, zoneId: row.zoneId || "", zone: zoneLabel(row.zoneId) })),
      });
    }
    // Slot numbers follow creation order within each world, like save files.
    const byWorld = new Map();
    for (const slot of [...slots].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.updatedAt.localeCompare(b.updatedAt))) {
      const number = (byWorld.get(slot.worldPackId) || 0) + 1;
      byWorld.set(slot.worldPackId, number);
      slot.slotNumber = number;
    }
    return slots.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async function listRuns() {
    const names = await runNames();
    const runs = [];
    for (const name of names) {
      const entry = await loadSave(name);
      if (entry?.save?.checkpoint?.coordinator) runs.push(runMeta(name, entry));
    }
    return runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
  }

  async function start(req, res) {
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) return json(res, 415, { ok: false, code: "JSON_REQUIRED" });
    if (!sameOrigin(req)) return json(res, 403, { ok: false, code: "CROSS_ORIGIN_FORBIDDEN" });
    const body = await readBody(req);
    if (body.authorized !== true) return json(res, 400, { ok: false, code: "AUTHORIZATION_REQUIRED", message: "勾选授权后才能发起真实模型调用。" });
    const turns = Number(body.turns), maxRequests = Number(body.maxRequests), repairs = Number(body.repairs ?? 4);
    const model = String(body.model || ""), responseFormat = body.responseFormat === "json_schema" ? "json_schema" : "json_object";
    const resumeFrom = body.resumeFrom ? String(body.resumeFrom) : null;
    let resumeSavePath = null;
    let worldId = body.world;

    if (resumeFrom) {
      const resumeDir = runDirectory(resumeFrom);
      if (!resumeDir) return json(res, 400, { ok: false, code: "RESUME_RUN_INVALID", message: "指定的继续运行标识不合法。" });
      const saveFile = path.join(resumeDir, "world-save.json");
      try {
        await stat(saveFile);
        resumeSavePath = saveFile;
      } catch {
        return json(res, 404, { ok: false, code: "RESUME_SAVE_NOT_FOUND", message: "指定的运行不存在可用的世界存档 (world-save.json)。" });
      }
      try {
        const existingSave = JSON.parse(await readFile(saveFile, "utf8"));
        if (!worldId) worldId = existingSave.worldPackId;
        else if (existingSave.worldPackId && existingSave.worldPackId !== worldId) {
          return json(res, 400, { ok: false, code: "WORLD_PACK_MISMATCH", message: `该存档属于世界 ${existingSave.worldPackId}，与选择的世界 ${worldId} 不一致。` });
        }
      } catch {
        return json(res, 400, { ok: false, code: "RESUME_SAVE_INVALID", message: "无法读取存档文件内容。" });
      }
    }

    if (!listWorldPackIds().includes(worldId)) return json(res, 400, { ok: false, code: "WORLD_UNKNOWN" });
    let callMode;
    try {
      const worldPack = await loadWorldPack(worldId);
      const fallback = resumeFrom ? (effectiveCallMode((await loadSave(resumeFrom))?.report) || "performance") : "performance";
      callMode = resolveCallMode({ scale: worldPack.meta?.scale, requested: body.callMode, fallback });
    } catch (error) {
      if (["CALL_MODE_UNSUPPORTED", "CALL_MODE_INVALID"].includes(error.code)) return json(res, 400, { ok: false, code: error.code, message: error.message });
      throw error;
    }
    if (!Number.isInteger(turns) || turns < 1 || turns > 1000) return json(res, 400, { ok: false, code: "TURNS_OUT_OF_RANGE", message: "回合数须在 1–1000。" });
    if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 6000) return json(res, 400, { ok: false, code: "REQUESTS_OUT_OF_RANGE", message: "请求上限须在 1–6000。" });
    if (!Number.isInteger(repairs) || repairs < 0 || repairs > 10) return json(res, 400, { ok: false, code: "REPAIRS_OUT_OF_RANGE" });
    if (!MODEL.test(model)) return json(res, 400, { ok: false, code: "MODEL_INVALID" });
    const resolvedEnv = await currentEnv();
    if (!resolvedEnv.GEMINI_API_KEY) return json(res, 412, { ok: false, code: "MODEL_KEY_MISSING", message: "先在设置里填 API 密钥。" });
    if (active && !active.exited) return json(res, 409, { ok: false, code: "RUN_ALREADY_ACTIVE", runId: active.runId });
    const stamp = clock().toISOString().replace(/[-:]/gu, "").replace(/\..*$/u, "").replace("T", "-");
    const prefix = resumeFrom ? `${stamp}-${worldId}-cont` : `${stamp}-${worldId}-${model}`;
    const runId = prefix.replace(/[^\w.-]/gu, "-");
    await mkdir(root, { recursive: true, mode: 0o700 });
    const out = path.join(root, runId);
    const args = [path.join(projectRoot, "scripts/runV27GeminiSimulation.mjs"),
      ...(resumeSavePath ? ["--resume", resumeSavePath, "--retry-authorization", `operator-resume-${stamp}`] : ["--world", worldId]),
      "--out", out,
      "--turns", String(turns), "--max-requests", String(maxRequests), "--repairs", String(repairs),
      "--model", model, "--response-format", responseFormat, "--call-mode", callMode];
    const child = spawnRunner({ args, cwd: projectRoot, env: resolvedEnv });
    const key = resolvedEnv.GEMINI_API_KEY;
    active = { runId, child, exited: false, stopRequested: false, calls: 0, waitingSince: null, gatewayWait: null, lastEvent: null, log: [], startedAt: clock().toISOString(), world: worldId, resumeFrom, turns, maxRequests, model };
    const record = (chunk) => {
      for (const line of String(chunk).replaceAll(key, "<REDACTED>").split("\n").filter(Boolean)) {
        active.log.push(line);
        if (active.log.length > 200) active.log.shift();
        try {
          const event = JSON.parse(line);
          active.lastEvent = event.event || active.lastEvent;
          if (event.event === "request_started") {
            active.calls += 1;
            active.waitingSince = event.startedAt || null;
            active.gatewayWait = null;
          } else if (event.event === "gateway_wait") {
            active.waitingSince = null;
            active.gatewayWait = { until: event.until || null, round: event.round ?? null, rounds: event.rounds ?? null };
          } else if (event.event === "request_finished" || event.event === "turn_settled" || event.event === "run_finished") {
            active.waitingSince = null;
            if (event.event !== "request_finished") active.gatewayWait = null;
          }
        } catch { /* not a JSON event line */ }
      }
    };
    const current = active;
    child.stdout?.on("data", record);
    child.stderr?.on("data", record);
    child.on?.("exit", (code, signal) => { current.exited = true; current.exitCode = code; current.signal = signal; });
    return json(res, 202, { ok: true, runId, world: body.world, turns, maxRequests, model });
  }

  function stop(id, req, res) {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, code: "CROSS_ORIGIN_FORBIDDEN" });
    if (!active || active.runId !== id || active.exited) return json(res, 404, { ok: false, code: "RUN_NOT_ACTIVE" });
    active.stopRequested = true;
    active.child.kill("SIGTERM");
    return json(res, 202, { ok: true, runId: id, status: "stopping" });
  }

  // 天意: the runner settles queued events before its next turn (worldEventQueue.mjs).
  const WORLD_EVENT_FIELDS = ["kind", "weather", "label", "zoneId", "description", "toCharacterId", "text", "from", "objectId", "stateKey", "value"];
  let worldEventCount = 0;
  async function queueWorldEvent(id, req, res) {
    if (!sameOrigin(req)) return json(res, 403, { ok: false, code: "CROSS_ORIGIN_FORBIDDEN" });
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) return json(res, 415, { ok: false, code: "JSON_REQUIRED" });
    if (!active || active.runId !== id || active.exited || active.stopRequested) {
      return json(res, 409, { ok: false, code: "RUN_NOT_ACTIVE", message: "天意要在运行中的世界里结算：先开始或继续运行。" });
    }
    let body;
    try { body = await readBody(req, 4 * 1024); } catch (error) { return json(res, error.status || 400, { ok: false, code: error.code || "BODY_INVALID" }); }
    if (!WORLD_EVENT_KINDS.includes(String(body.kind || ""))) {
      return json(res, 400, { ok: false, code: "WORLD_EVENT_KIND_INVALID", message: "只能是天气、东西出现、口信、小意外或授意。" });
    }
    const event = Object.fromEntries(WORLD_EVENT_FIELDS.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));
    const receivedAt = clock().toISOString();
    worldEventCount += 1;
    const eventId = `world-event:${receivedAt}:${worldEventCount}`;
    try {
      await appendFile(path.join(runDirectory(id), WORLD_EVENT_QUEUE_FILE), `${JSON.stringify({ eventId, receivedAt, event })}\n`, { mode: 0o600, flag: "a" });
    } catch (error) {
      if (error.code === "ENOENT") return json(res, 409, { ok: false, code: "RUN_STARTING", message: "运行还在准备，稍等再试。" });
      throw error;
    }
    return json(res, 202, { ok: true, eventId, status: "queued" });
  }

  async function stream(id, req, res) {
    if (!runDirectory(id)) return json(res, 404, { ok: false, code: "RUN_UNKNOWN" });
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" });
    let lastSeq = Number(new URL(req.url, "http://x").searchParams.get("after") || 0);
    let closed = false, busy = false;
    const send = (event, data) => { if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    const push = async () => {
      if (busy || closed) return;
      busy = true;
      try {
        const result = await feedFor(id);
        const status = { status: runStatus(id, result?.entry), calls: active?.runId === id ? active.calls : null, lastEvent: active?.runId === id ? active.lastEvent : null, waitingSince: active?.runId === id ? active.waitingSince : null, gatewayWait: active?.runId === id ? active.gatewayWait : null, error: failureOf(result?.entry) };
        if (result) {
          const fresh = result.feed.frames.filter((row) => row.seq > lastSeq);
          if (fresh.length) { lastSeq = fresh.at(-1).seq; send("frames", { frames: fresh, settledCount: result.feed.settledCount }); }
        }
        send("status", status);
      } finally { busy = false; }
    };
    let watcher = null;
    try { watcher = watch(runDirectory(id), () => { push(); }); } catch { /* the run directory may not exist yet */ }
    const poll = setInterval(push, 1500);
    const heartbeat = setInterval(() => { if (!closed) res.write(": keep-alive\n\n"); }, 15000);
    req.on("close", () => { closed = true; clearInterval(poll); clearInterval(heartbeat); watcher?.close(); });
    await push();
  }

  async function handle(req, res, url) {
    try {
      if (url.pathname === "/api/worlds" && req.method === "GET") {
        const worlds = [];
        for (const id of listWorldPackIds()) {
          const pack = await loadWorldPack(id);
          const visual = worldVisual(pack);
          worlds.push({ id, title: pack.meta.title, scale: pack.meta?.scale || "", sceneCast: pack.cast.filter((row) => pack.stage.sceneCast.includes(row.id)).map((row) => row.name),
            placeName: visual.placeName, clockLabel: visual.clockLabel, layout: visual.layout, cast: visual.cast, zones: visual.zones });
        }
        json(res, 200, { ok: true, worlds });
        return true;
      }
      if (url.pathname === "/api/saves" && req.method === "GET") {
        const saves = await listSaves();
        const starting = active && !active.exited && !saves.some((row) => row.segments.includes(active.runId))
          ? { runId: active.runId, world: active.world, resumeFrom: active.resumeFrom || null } : null;
        json(res, 200, { ok: true, saves, starting, active: active && !active.exited ? { runId: active.runId, calls: active.calls, waitingSince: active.waitingSince, gatewayWait: active.gatewayWait } : null });
        return true;
      }
      if (url.pathname === "/api/runs" && req.method === "GET") {
        const resolvedEnv = await currentEnv();
        let gateway = "Google Gemini API";
        try { if (resolvedEnv.GEMINI_API_BASE_URL) gateway = new URL(resolvedEnv.GEMINI_API_BASE_URL).host; } catch { gateway = "已配置的网关"; }
        json(res, 200, { ok: true, runs: await listRuns(), modelKeyConfigured: Boolean(resolvedEnv.GEMINI_API_KEY), gateway,
          active: active && !active.exited ? { runId: active.runId, calls: active.calls, waitingSince: active.waitingSince, gatewayWait: active.gatewayWait, lastEvent: active.lastEvent, stopRequested: active.stopRequested } : null });
        return true;
      }
      if (url.pathname === "/api/runs/start" && req.method === "POST") { await start(req, res); return true; }
      const match = /^\/api\/runs\/([^/]+)\/(feed|stream|stop|events)$/u.exec(url.pathname);
      if (!match) return false;
      const id = decodeURIComponent(match[1]);
      if (!runDirectory(id)) { json(res, 404, { ok: false, code: "RUN_UNKNOWN" }); return true; }
      if (match[2] === "stop" && req.method === "POST") { stop(id, req, res); return true; }
      if (match[2] === "events" && req.method === "POST") { await queueWorldEvent(id, req, res); return true; }
      if (match[2] === "events" && req.method === "GET") { json(res, 200, { ok: true, events: await listWorldEvents(runDirectory(id)) }); return true; }
      if (match[2] === "stream" && req.method === "GET") { await stream(id, req, res); return true; }
      if (match[2] === "feed" && req.method === "GET") {
        const result = await feedFor(id);
        if (!result) {
          const starting = active?.runId === id && !active.exited;
          // Before the first turn is saved, the page still needs to know what
          // the run is waiting for (the model, or a gateway that is down).
          json(res, starting ? 202 : 404, { ok: false, code: starting ? "RUN_STARTING" : "RUN_UNKNOWN",
            ...(starting ? { calls: active.calls, waitingSince: active.waitingSince, gatewayWait: active.gatewayWait } : {}) });
          return true;
        }
        const after = Number(url.searchParams.get("after") || 0);
        json(res, 200, { ok: true, run: runMeta(id, result.entry), world: worldVisual(result.pack), initial: result.feed.initial,
          frames: result.feed.frames.filter((row) => row.seq > after), settledCount: result.feed.settledCount,
          replayConsistent: result.feed.replayConsistent, finalSeconds: result.feed.finalSeconds });
        return true;
      }
      return false;
    } catch (error) {
      const resolvedEnv = await currentEnv();
      json(res, error.status || 500, { ok: false, code: error.code || "OBSERVER_ERROR", message: String(error.message || error).replaceAll(resolvedEnv?.GEMINI_API_KEY || "\0", "<REDACTED>") });
      return true;
    }
  }

  return { handle, get active() { return active; } };
}
