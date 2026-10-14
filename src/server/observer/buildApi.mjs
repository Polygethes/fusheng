// Turning a reviewed blueprint into a playable world (P6). POST
// /api/create/compile checks and compiles a blueprint and returns every
// problem — each tagged with the review tab it belongs to — plus a map preview;
// no model is called. POST /api/create/start compiles again, saves the world
// to the library and creates its opening save, ready for the observer.
import path from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { validateBlueprint } from "../../worlds/blueprint/validateBlueprint.mjs";
import { compileBlueprint } from "../../worlds/compiler/index.mjs";
import { validateWorldPack } from "../../worlds/validateWorldPack.mjs";
import { runWorldSmoke } from "../../worlds/worldSmoke.mjs";
import { worldPackDigest } from "../../worlds/worldPack.mjs";
import { createFreshWorldSave } from "../../worlds/freshWorld.mjs";
import { saveUserWorld, listUserWorldIds } from "../../worlds/userWorldStore.mjs";
import { isBuiltInWorld, listWorldPackIds, loadWorldPack } from "../../worlds/registry.mjs";

const SECTION_OF = { meta: "world", town: "places", households: "places", residents: "people", relationships: "relationships", opening: "opening" };
export const sectionOf = (issuePath = "") => SECTION_OF[String(issuePath).split(/[.[]/u)[0]] || "world";

function json(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}
async function readBody(req, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("请求内容太大。"), { status: 413, code: "BODY_TOO_LARGE" });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw Object.assign(new Error("请求内容必须是 JSON。"), { status: 400, code: "BODY_NOT_JSON" }); }
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

/**
 * Check and compile a blueprint. Never throws for a bad blueprint: problems
 * come back as { ok: false, stage, issues }.
 */
export async function checkBlueprint(blueprint, { seed } = {}) {
  const checked = validateBlueprint(blueprint);
  if (!checked.ok) {
    return { ok: false, stage: "blueprint", issues: checked.issues.map((row) => ({ rule: row.rule, code: row.code, path: row.path, message: row.message, section: sectionOf(row.path) })) };
  }
  let compiled;
  try {
    compiled = compileBlueprint(blueprint, seed === undefined || seed === null ? {} : { seed: Number(seed) });
  } catch (error) {
    return { ok: false, stage: "compile", issues: [{ rule: "compile", code: error.code || "COMPILE_FAILED", path: error.path || "", message: error.message, section: sectionOf(error.path) }] };
  }
  const { pack, report } = compiled;
  const issues = validateWorldPack(pack).issues.map((row) => ({ rule: row.check, code: row.code, path: row.path, message: row.message, section: "world" }));
  const smoke = await runWorldSmoke(pack, { stages: false });
  issues.push(...smoke.issues.map((row) => ({ rule: "smoke", code: row.code, path: "", message: row.message, section: "opening" })));
  return {
    ok: issues.length === 0,
    stage: issues.length ? "world" : "ready",
    issues,
    pack,
    report,
    seed: seed === undefined || seed === null ? (blueprint.meta?.seed ?? 1) : Number(seed),
    digest: worldPackDigest(pack),
    preview: {
      id: pack.meta.id,
      title: pack.meta.title,
      layout: pack.layout,
      sites: pack.stage.sites || [],
      cast: pack.cast.map((row) => ({ id: row.id, name: row.name, title: row.title, appearance: row.appearance || {} })),
      scenePositions: pack.stage.scenePositions,
      provisional: pack.meta.provisional || [],
      warnings: report?.warnings || [],
    },
  };
}

export function createBuildApi({ runsRoot, env = process.env, clock = () => new Date(), titleBlueprintPath = "" } = {}) {
  if (!runsRoot) throw new Error("createBuildApi needs a runsRoot.");
  let starting = false;
  let titleMap = null;
  const resolveEnv = async () => (typeof env === "function" ? env() : env);

  // A new directory every time; an existing save is never reused.
  async function createOpeningSave(pack) {
    const stamp = clock().toISOString().replace(/[-:]/gu, "").replace(/\..*$/u, "").replace("T", "-");
    let runId = "", directory = "";
    for (let attempt = 1; !directory; attempt += 1) {
      runId = `${stamp}-${pack.meta.id}-new${attempt > 1 ? `-${attempt}` : ""}`.replace(/[^\w.-]/gu, "-");
      await mkdir(path.resolve(runsRoot), { recursive: true, mode: 0o700 });
      try { await mkdir(path.join(path.resolve(runsRoot), runId), { recursive: false, mode: 0o700 }); directory = path.join(path.resolve(runsRoot), runId); }
      catch (error) { if (error.code !== "EEXIST" || attempt >= 50) throw error; }
    }
    const fresh = await createFreshWorldSave(pack, { runId });
    await writeFile(path.join(directory, "world-save.json"), `${JSON.stringify(fresh.save, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await writeFile(path.join(directory, "world-save.json.report.md"), fresh.report, { mode: 0o600, flag: "wx" });
    return { runId, observerUrl: `/stage.html?run=${encodeURIComponent(runId)}` };
  }

  async function compile(req, res) {
    const body = await readBody(req);
    if (!body.blueprint || typeof body.blueprint !== "object") return json(res, 400, { ok: false, code: "BLUEPRINT_REQUIRED" });
    const { pack, report, ...result } = await checkBlueprint(body.blueprint, { seed: body.seed });
    return json(res, 200, result);
  }

  async function start(req, res) {
    const body = await readBody(req);
    if (!body.blueprint || typeof body.blueprint !== "object") return json(res, 400, { ok: false, code: "BLUEPRINT_REQUIRED" });
    if (starting) return json(res, 409, { ok: false, code: "START_ACTIVE", message: "上一个世界还在建立。" });
    starting = true;
    try {
      const checked = await checkBlueprint(body.blueprint, { seed: body.seed });
      if (!checked.ok) return json(res, 422, { ok: false, code: "WORLD_NOT_READY", stage: checked.stage, issues: checked.issues });
      const { pack, report } = checked;
      const id = pack.meta.id;
      if (isBuiltInWorld(id)) return json(res, 409, { ok: false, code: "WORLD_ID_RESERVED", message: `世界 id ${id} 是内置世界的名字，换一个。` });
      const worldEnv = await resolveEnv();
      if (listUserWorldIds(worldEnv).includes(id) && body.replace !== true) {
        return json(res, 409, { ok: false, code: "WORLD_EXISTS", message: `世界库里已经有 ${id}。要覆盖它，请确认后再试。` });
      }
      // The library keeps the blueprint with the seed that drew this map, so a recompile gives the same town.
      const savedBlueprint = { ...body.blueprint, meta: { ...body.blueprint.meta, seed: checked.seed } };
      await saveUserWorld({ pack, blueprint: savedBlueprint, report }, worldEnv);
      const { runId, observerUrl } = await createOpeningSave(pack);
      return json(res, 201, { ok: true, worldId: id, runId, digest: checked.digest, observerUrl });
    } finally {
      starting = false;
    }
  }

  /** A fresh opening save for a world already in the library (or a built-in one). */
  async function newSave(req, res) {
    const body = await readBody(req);
    const worldEnv = await resolveEnv();
    const id = String(body.worldId || "");
    if (!listWorldPackIds(worldEnv).includes(id)) return json(res, 404, { ok: false, code: "WORLD_UNKNOWN", message: "世界库里没有这个世界。" });
    const pack = await loadWorldPack(id, worldEnv);
    const issues = validateWorldPack(pack).issues;
    if (issues.length) return json(res, 422, { ok: false, code: "WORLD_NOT_READY", issues });
    return json(res, 201, { ok: true, worldId: id, ...(await createOpeningSave(pack)) });
  }

  /** The town drawn behind the title screen: a real compiled exterior, compiled once. */
  async function title(req, res) {
    if (!titleBlueprintPath) return json(res, 404, { ok: false, code: "TITLE_MAP_MISSING" });
    titleMap ||= readFile(titleBlueprintPath, "utf8").then((text) => {
      const { pack } = compileBlueprint(JSON.parse(text), { seed: 3 });
      return { title: pack.meta.title, layout: pack.layout };
    });
    return json(res, 200, { ok: true, ...(await titleMap) });
  }

  const ROUTES = { "POST /api/create/compile": compile, "POST /api/create/start": start, "POST /api/create/new-save": newSave };
  return {
    async handle(req, res, url) {
      if (req.method === "GET" && url.pathname === "/api/create/title-map") {
        try { await title(req, res); } catch { if (!res.headersSent) json(res, 500, { ok: false, code: "TITLE_MAP_FAILED" }); }
        return true;
      }
      const route = ROUTES[`${req.method} ${url.pathname}`];
      if (!route) return false;
      try {
        if (!String(req.headers["content-type"] || "").startsWith("application/json")) { json(res, 415, { ok: false, code: "JSON_REQUIRED" }); return true; }
        if (!sameOrigin(req)) { json(res, 403, { ok: false, code: "CROSS_ORIGIN_FORBIDDEN" }); return true; }
        await route(req, res);
      } catch (error) {
        if (!res.headersSent) json(res, error.status || 500, { ok: false, code: error.code || "BUILD_API_ERROR", message: error.status ? error.message : "服务出错了。" });
      }
      return true;
    },
  };
}
