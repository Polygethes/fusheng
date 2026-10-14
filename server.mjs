import http from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./src/server/env.mjs";
import { setSessionIdSalt } from "./src/data/seed.js";
import { modelStatus, playFromServer } from "./src/server/modelRouter.mjs";
import { generatePlayableWorldFromModelSetup } from "./src/server/pipeline/setupGenerator.mjs";
import { buildPlayableWorldFromSetup } from "./src/worldbuilding/skills.js";
import { createTavernV27FixtureStageRunner } from "./src/server/pipeline/tavernV27FixtureStage.mjs";
import {
  TAVERN_WORLD_RUNTIME_V27_VERSION,
  createTavernWorldRuntimeV27,
  projectTavernWorldRuntimeV27ForObserver,
} from "./src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { createTavernV27SessionAdapter } from "./src/server/pipeline/tavernV27SessionAdapter.mjs";
import { createTavernV27SessionHttpHandler } from "./src/server/pipeline/tavernV27SessionHttp.mjs";
import {
  createTavernV27PersistentModelSessionHttpHandler,
  createTavernV27CharacterModelSessionStageFactory,
  projectTavernV27PersistentModelExecution,
} from "./src/server/pipeline/tavernV27PersistentModelSession.mjs";
import {
  createV27CharacterModelProvider,
  resolveV27CharacterAgentCallMode,
  resolveV27CharacterModelProviderConfig,
} from "./src/server/v27CharacterModelProvider.mjs";
import { createFileWorldRuntimeSessionRepository } from "./src/server/simulation/worldRuntimeSessionRepository.mjs";
import { createPublicAssetResolver } from "./src/server/staticAssets.mjs";
import { createRunsApi } from "./src/server/observer/runsApi.mjs";
import { createSettingsApi } from "./src/server/observer/settingsApi.mjs";
import { createWorldsApi } from "./src/server/observer/worldsApi.mjs";
import { createCreateApi } from "./src/server/observer/createApi.mjs";
import { createBuildApi } from "./src/server/observer/buildApi.mjs";
import { dataHome, modelEnv, readSettings } from "./src/server/localData.mjs";
import { isLocalHostHeader } from "./src/server/localGuard.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Persisted world-runtime sessions survive restarts; salted ids keep new
// sessions from colliding with ids stored by a previous server process.
setSessionIdSalt(`${process.pid.toString(36)}${Date.now().toString(36)}`);
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const PLAY_RUN_RETENTION_MS = 10 * 60 * 1000;
const activePlayRuns = new Map();

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".ttf", "font/ttf"],
  [".woff2", "font/woff2"],
  [".md", "text/markdown; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
]);

// Runs live in the player's data home; the project's old sim-runs/ is read-only history.
const runsRoot = path.join(dataHome(process.env), "runs");
const legacyRunsRoots = [path.join(__dirname, "sim-runs")];

const resolvePublicAsset = createPublicAssetResolver(__dirname);
const settingsApi = createSettingsApi();
const worldsApi = createWorldsApi();
const createApi = createCreateApi();
const buildApi = createBuildApi({ runsRoot, titleBlueprintPath: path.join(__dirname, "src/worlds/samples/title_town.json") });
// Pixel stage observer: run browser, live frames and authorized start/stop.
const runsApi = createRunsApi({
  runsRoot,
  legacyRunsRoots,
  projectRoot: __dirname,
  env: async () => modelEnv(await readSettings(), process.env),
});

function json(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function streamEvent(res, event) {
  if (res.writableEnded || res.destroyed) return false;
  res.write(`${JSON.stringify(event)}\n`);
  return true;
}

function generatedRunId() {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizedRunId(value) {
  const candidate = String(value || "").trim();
  return /^[A-Za-z0-9_-]{8,96}$/.test(candidate) ? candidate : generatedRunId();
}

function detachRunSubscriber(run, subscriber, { end = false } = {}) {
  if (!subscriber || subscriber.closed) return;
  subscriber.closed = true;
  clearInterval(subscriber.heartbeat);
  run.subscribers.delete(subscriber);
  if (end && !subscriber.res.writableEnded && !subscriber.res.destroyed) subscriber.res.end();
}

function scheduleRunCleanup(run) {
  const timer = setTimeout(() => {
    if (activePlayRuns.get(run.id) === run) activePlayRuns.delete(run.id);
  }, PLAY_RUN_RETENTION_MS);
  timer.unref?.();
}

function publishRunEvent(run, event) {
  const payload = {
    ...event,
    runId: run.id,
    seq: run.events.length + 1,
    at: event.at || new Date().toISOString(),
  };
  run.events.push(payload);
  for (const subscriber of [...run.subscribers]) {
    if (!streamEvent(subscriber.res, payload)) detachRunSubscriber(run, subscriber);
  }
  if (payload.type === "complete" || payload.type === "error") {
    run.finished = true;
    run.finishedAt = Date.now();
    for (const subscriber of [...run.subscribers]) detachRunSubscriber(run, subscriber, { end: true });
    scheduleRunCleanup(run);
  }
  return payload;
}

function attachRunSubscriber(run, res, afterSeq = 0) {
  res.socket?.setNoDelay?.(true);
  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "connection": "keep-alive",
    "x-accel-buffering": "no",
    "x-character-town-run-id": run.id,
  });
  res.flushHeaders?.();

  const floor = Math.max(0, Number(afterSeq) || 0);
  for (const event of run.events) {
    if (event.seq > floor) streamEvent(res, event);
  }
  if (run.finished) {
    res.end();
    return;
  }

  const subscriber = { res, heartbeat: null, closed: false };
  run.subscribers.add(subscriber);
  subscriber.heartbeat = setInterval(() => {
    streamEvent(res, {
      type: "heartbeat",
      runId: run.id,
      afterSeq: run.events.length,
      at: new Date().toISOString(),
    });
  }, 10_000);
  res.once("close", () => detachRunSubscriber(run, subscriber));
}

async function executePlayRun(run, body) {
  try {
    const status = modelStatus(body.mode);
    publishRunEvent(run, {
      type: "run_started",
      model: status.openaiModel,
      provider: status.provider,
      grain: body.state.ui?.timeGrain || "scene",
      locationName: (body.state.locations || []).find((location) => location.id === body.state.ui?.selectedLocationId)?.name || "",
    });
    const draft = await playFromServer(body.state, {
      mode: body.mode,
      allowFallback: body.allowFallback !== false,
      onProgress: async (event) => publishRunEvent(run, event),
    });
    publishRunEvent(run, { type: "complete", status, draft });
  } catch (error) {
    publishRunEvent(run, {
      type: "error",
      kind: error?.kind || "run_error",
      stage: error?.stage || "",
      error: error?.message || String(error),
    });
  } finally {
    run.requestBody = null;
  }
}

function getOrCreatePlayRun(body) {
  const runId = normalizedRunId(body.runId);
  const existing = activePlayRuns.get(runId);
  if (existing) return existing;
  const run = {
    id: runId,
    createdAt: Date.now(),
    finishedAt: null,
    finished: false,
    events: [],
    subscribers: new Set(),
    requestBody: body,
  };
  activePlayRuns.set(runId, run);
  queueMicrotask(() => executePlayRun(run, body));
  return run;
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return null;
  const raw = Buffer.concat(chunks).toString("utf-8");
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function handlePlay(req, res) {
  const body = await parseBody(req);
  if (!body?.state) return json(res, 400, { ok: false, error: "Missing state" });
  const draft = await playFromServer(body.state, { mode: body.mode, allowFallback: body.allowFallback !== false });
  return json(res, 200, { ok: true, status: modelStatus(body.mode), draft });
}

async function handlePlayStream(req, res) {
  const body = await parseBody(req);
  if (!body?.state) return json(res, 400, { ok: false, error: "Missing state" });
  const run = getOrCreatePlayRun(body);
  attachRunSubscriber(run, res, body.afterSeq);
}

async function handleWorldSetup(req, res) {
  const body = await parseBody(req);
  const generated = await generatePlayableWorldFromModelSetup({
    setupWorldPrompt: body?.setupWorldPrompt || "",
    setupPeoplePrompt: body?.setupPeoplePrompt || "",
    allowFallback: body?.allowFallback !== false,
  });
  return json(res, 200, { ok: true, status: modelStatus(body?.mode), generated });
}

function tavernV27SeedState() {
  return buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
}

const tavernV27SessionRoot = process.env.GTOWN_RUNTIME_SESSION_DIR
  || path.join(process.env.XDG_STATE_HOME || path.join(homedir(), ".local", "state"), "character-town-v12", "world-runtime-sessions");
const tavernV27SessionRepository = createFileWorldRuntimeSessionRepository({ rootDir: tavernV27SessionRoot });
const tavernV27SessionAdapter = createTavernV27SessionAdapter({
  repository: tavernV27SessionRepository,
  enableDayPlanning: true,
  stateFactory: async () => ({
    state: tavernV27SeedState(),
    pacingMode: process.env.GTOWN_V27_PACING_MODE || "scene",
    openingAfterSeconds: Number(process.env.GTOWN_V27_OPENING_SECONDS || 900),
    positions: {
      char_xyy_xiezenshi: "hall",
      char_xyy_luozhao: "hall",
    },
    initialWake: {
      characterId: "char_xyy_xiezenshi",
      kind: "opportunity_window",
    },
  }),
});
const handleTavernV27SessionHttp = createTavernV27SessionHttpHandler({ adapter: tavernV27SessionAdapter });
const tavernV27CharacterModelProviderConfig = resolveV27CharacterModelProviderConfig(process.env, {
  apiModel: modelStatus().openaiModel,
});
// The browser product preserves the three-call regulation/expression boundary.
// Historical call modes require an explicit diagnostic configuration.
const tavernV27CharacterAgentCallMode = resolveV27CharacterAgentCallMode(process.env);
const tavernV27ActionStageCount = tavernV27CharacterAgentCallMode === "three-call" ? 3
  : tavernV27CharacterAgentCallMode === "two-call" ? 2 : 4;
const tavernV27PersistentModelStageFactory = createTavernV27CharacterModelSessionStageFactory({
  model: tavernV27CharacterModelProviderConfig.model,
  maxProviderRequestsPerCommand: tavernV27CharacterAgentCallMode === "two-call" ? 3 : 5,
  providerPortFactory: ({ model }) => createV27CharacterModelProvider({
    ...tavernV27CharacterModelProviderConfig,
    model,
  }),
});
const tavernV27ModelSessionAdapter = createTavernV27SessionAdapter({
  repository: tavernV27SessionRepository,
  enableDayPlanning: true,
  stateFactory: async () => ({
    state: tavernV27SeedState(),
    pacingMode: process.env.GTOWN_V27_PACING_MODE || "scene",
    openingAfterSeconds: Number(process.env.GTOWN_V27_OPENING_SECONDS || 900),
    positions: {
      char_xyy_xiezenshi: "hall",
      char_xyy_luozhao: "threshold",
    },
    initialWake: {
      characterId: "char_xyy_luozhao",
      kind: "opportunity_window",
    },
  }),
  stageRunnerFactory: tavernV27PersistentModelStageFactory,
  maxStageProtocolRepairs: 1,
  characterAgentCallMode: tavernV27CharacterAgentCallMode,
  projectExecutionMetadata: projectTavernV27PersistentModelExecution,
});
const handleTavernV27ModelSessionHttp = createTavernV27PersistentModelSessionHttpHandler({
  adapter: tavernV27ModelSessionAdapter,
  model: tavernV27CharacterModelProviderConfig.model,
});

async function handleTavernV27PersistentSession(req, res, operation) {
  const body = await parseBody(req);
  const response = await handleTavernV27SessionHttp({ operation, body });
  return json(res, response.status, response.body);
}

async function handleTavernV27PersistentModelSession(req, res, operation) {
  const body = await parseBody(req);
  const response = await handleTavernV27ModelSessionHttp({ operation, body });
  if (process.env.GTOWN_V27_SAFE_DIAGNOSTICS === "1" && response.status >= 400) {
    // The HTTP projector has already removed private Character state, prompts,
    // provider payloads and credentials.  Logging only that public projection
    // keeps long-running quality tests diagnosable even if their client socket
    // closes before the response is read.
    console.error(JSON.stringify({
      type: "tavern-v27-model-session-failure",
      operation,
      status: response.status,
      response: response.body,
    }, null, 2));
  }
  return json(res, response.status, response.body);
}

async function runTavernV27({
  runStage,
  maxTurns = 8,
  onStageRejected,
  maxStageProtocolRepairs = 0,
} = {}) {
  const instance = createTavernWorldRuntimeV27(tavernV27SeedState(), {
    positions: {
      char_xyy_xiezenshi: "hall",
      char_xyy_luozhao: "threshold",
    },
    runStage,
    onStageRejected,
    maxStageProtocolRepairs,
  });
  await instance.runtime.enqueueWake("char_xyy_luozhao", {
    wakeId: `wake:tavern-v27:http:${Date.now()}`,
    kind: "opportunity_window",
    evidenceIds: [],
    evidence: [],
  });
  const turns = await instance.runtime.runUntilIdle({ maxTurns });
  return {
    instance,
    turns,
    observer: projectTavernWorldRuntimeV27ForObserver(instance, turns),
  };
}

async function handleTavernV27Demo(_req, res) {
  const result = await runTavernV27({
    runStage: createTavernV27FixtureStageRunner(),
    maxTurns: 12,
  });
  return json(res, 200, {
    ok: true,
    mode: "local-character-agent-fixture",
    externalModelCalled: false,
    authorQualityVerdict: "not_evaluated",
    explanation: "本地夹具只验证人物 Actor 的四阶段原子回合、世界结算、感知传播、回执和静止条件；它不评价台词或人物质量。",
    runtime: result.observer,
  });
}

async function handleDeprecatedTavernV27ModelRun(_req, res) {
  return json(res, 410, {
    ok: false,
    code: "TAVERN_V27_STATELESS_MODEL_RUN_RETIRED",
    error: "无状态人物模型入口已停用；请使用持久人物会话入口。",
    replacement: "/api/v27/tavern/model-session/{start|continue|reset}",
    externalModelCalled: false,
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const hostHeader = req.headers.host;
    const currentPort = server.address()?.port || PORT;
    if (req.url?.startsWith("/api/") && !isLocalHostHeader(hostHeader, currentPort)) {
      return json(res, 403, { ok: false, code: "HOST_FORBIDDEN", message: "非法的 Host 请求头。" });
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

    if (url.pathname.startsWith("/api/settings") && await settingsApi.handle(req, res, url)) return;
    if (url.pathname.startsWith("/api/library") && await worldsApi.handle(req, res, url)) return;
    if (url.pathname.startsWith("/api/create/") && await createApi.handle(req, res, url)) return;
    if (url.pathname.startsWith("/api/create/") && await buildApi.handle(req, res, url)) return;
    if ((url.pathname === "/api/worlds" || url.pathname === "/api/saves" || url.pathname.startsWith("/api/runs")) && await runsApi.handle(req, res, url)) return;

    if (url.pathname === "/api/health" || url.pathname === "/api/model/status") {
      return json(res, 200, modelStatus());
    }

    if ((url.pathname === "/api/engine/play" || url.pathname === "/api/play" || url.pathname === "/api/model") && req.method === "POST") {
      return await handlePlay(req, res);
    }

    if (url.pathname === "/api/engine/play/stream" && req.method === "POST") {
      return await handlePlayStream(req, res);
    }

    if (url.pathname === "/api/world/setup" && req.method === "POST") {
      return await handleWorldSetup(req, res);
    }

    if (url.pathname === "/api/v27/tavern/status" && req.method === "GET") {
      return json(res, 200, {
        ok: true,
        version: TAVERN_WORLD_RUNTIME_V27_VERSION,
        localFixtureAvailable: true,
        configuredModelAvailable: true,
        model: tavernV27CharacterModelProviderConfig.model,
        modelTransport: tavernV27CharacterModelProviderConfig.transport,
        modelAuthentication: tavernV27CharacterModelProviderConfig.authentication,
        modelDisplayLabel: tavernV27CharacterModelProviderConfig.displayLabel,
        characterAgentCallMode: tavernV27CharacterAgentCallMode,
        providerCallsPerActionTurn: tavernV27ActionStageCount,
        usesApiKey: tavernV27CharacterModelProviderConfig.usesApiKey,
        baseStageRequestsPerActorTurn: tavernV27ActionStageCount,
        actionStageRequestsPerActorTurn: tavernV27ActionStageCount,
        dayPlanningStageRequestsPerActorTurn: 1,
        maxProtocolRepairRequestsPerActorTurn: 1,
        maxProviderRequestsPerActorTurn: tavernV27CharacterAgentCallMode === "two-call" ? 3 : 5,
        dayPlanningEnabledForPersistentSessions: true,
        defaultPacingMode: process.env.GTOWN_V27_PACING_MODE || "scene",
        defaultOpeningAfterSeconds: Number(process.env.GTOWN_V27_OPENING_SECONDS || 900),
        characterAgentProtocol: "phase92-epistemic-affective-continuity",
        browserSessionProtocol: "v27-persistent-model-session-client-v2",
        persistentFixtureSessionAvailable: true,
        persistentFixtureSessionOperations: ["start", "continue", "reset", "snapshot", "restore"],
        persistentModelSessionAvailable: true,
        persistentModelSessionOperations: ["start", "continue", "reset", "snapshot", "restore"],
        persistentModelSessionAuthorization: "one-command",
      });
    }

    const persistentV27SessionRoute = /^\/api\/v27\/tavern\/session\/(start|continue|reset|snapshot|restore)$/u.exec(url.pathname);
    if (persistentV27SessionRoute && req.method === "POST") {
      return await handleTavernV27PersistentSession(req, res, persistentV27SessionRoute[1]);
    }

    const persistentV27ModelSessionRoute = /^\/api\/v27\/tavern\/model-session\/(start|continue|reset|snapshot|restore)$/u.exec(url.pathname);
    if (persistentV27ModelSessionRoute && req.method === "POST") {
      return await handleTavernV27PersistentModelSession(req, res, persistentV27ModelSessionRoute[1]);
    }

    if (url.pathname === "/api/v27/tavern/demo" && req.method === "POST") {
      return await handleTavernV27Demo(req, res);
    }

    if (url.pathname === "/api/v27/tavern/model-run" && req.method === "POST") {
      return handleDeprecatedTavernV27ModelRun(req, res);
    }

    const filePath = ["GET", "HEAD"].includes(req.method) ? resolvePublicAsset(url.pathname) : null;
    if (!filePath || !existsSync(filePath)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const statPath = filePath;
    if (!existsSync(statPath)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(statPath);
    res.writeHead(200, {
      "content-type": mimeTypes.get(ext) || "application/octet-stream",
      "cache-control": "no-store",
    });
    if (req.method === "HEAD") return res.end();
    createReadStream(statPath).pipe(res);
  } catch (error) {
    json(res, 500, { ok: false, error: error?.message || String(error) });
  }
});

server.listen(PORT, HOST, () => {
  const status = modelStatus();
  console.log(`浮生镇 running at http://${HOST}:${server.address().port}`);
  console.log(`Engine provider: ${status.provider}; mode: ${status.defaultMode}`);
  console.log(`Model: ${status.openaiModel}`);
  console.log(`v2.7 CharacterModel: ${tavernV27CharacterModelProviderConfig.displayLabel} · ${tavernV27CharacterModelProviderConfig.model}`);
  console.log(`v2.7 Character Agent calls: ${tavernV27CharacterAgentCallMode}`);
});
