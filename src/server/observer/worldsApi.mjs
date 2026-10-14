import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { listWorldPackIds, loadWorldPack, isBuiltInWorld } from "../../worlds/registry.mjs";
import { userWorldsRoot, exportUserWorld, importUserWorld, removeUserWorld } from "../../worlds/userWorldStore.mjs";

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

function json(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
  return true;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    const reqHost = req.headers.host;
    return originHost === reqHost;
  } catch {
    return false;
  }
}

async function readBody(req, limit = MAX_IMPORT_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Request body too large"), { code: "BODY_TOO_LARGE" }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

export function createWorldsApi({ env = process.env } = {}) {
  const currentEnv = typeof env === "function" ? env : () => env;

  async function handle(req, res, url) {
    const resolvedEnv = await currentEnv();

    // GET /api/library
    if (url.pathname === "/api/library" && req.method === "GET") {
      const ids = listWorldPackIds(resolvedEnv);
      const worlds = [];
      for (const id of ids) {
        try {
          const pack = await loadWorldPack(id, resolvedEnv);
          const builtIn = isBuiltInWorld(id);
          let hasBlueprint = false;
          let createdAt = null;
          if (!builtIn) {
            const worldDir = path.join(userWorldsRoot(resolvedEnv), id);
            try {
              const stat = await fsp.stat(path.join(worldDir, "blueprint.json"));
              hasBlueprint = stat.isFile();
            } catch {}
            try {
              const stat = await fsp.stat(path.join(worldDir, "pack.json"));
              createdAt = stat.birthtime?.toISOString?.() || stat.mtime?.toISOString?.() || null;
            } catch {}
          }
          worlds.push({
            id,
            title: pack.meta.title,
            builtIn,
            scale: pack.meta?.scale || "scene",
            residents: (pack.cast || []).length,
            createdAt,
            hasBlueprint,
          });
        } catch {
          // ignore broken worlds in summary listing
        }
      }
      return json(res, 200, { ok: true, worlds });
    }

    // POST /api/library/import
    if (url.pathname === "/api/library/import" && req.method === "POST") {
      if (!sameOrigin(req)) {
        return json(res, 403, { ok: false, code: "ORIGIN_FORBIDDEN", message: "跨域请求被拒绝。" });
      }
      if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
        return json(res, 415, { ok: false, code: "JSON_REQUIRED", message: "Content-Type 必须是 application/json。" });
      }
      let raw;
      try {
        raw = await readBody(req);
      } catch (err) {
        if (err.code === "BODY_TOO_LARGE") {
          json(res, 413, { ok: false, code: "BODY_TOO_LARGE", message: "导入文件超过 5MB 限制。" });
          req.destroy();
          return true;
        }
        return json(res, 400, { ok: false, code: "BODY_READ_ERROR" });
      }

      let bundle;
      try {
        bundle = JSON.parse(raw);
      } catch {
        return json(res, 400, { ok: false, code: "JSON_INVALID", message: "导入内容不是合法的 JSON。" });
      }

      try {
        const id = await importUserWorld(bundle, resolvedEnv);
        return json(res, 200, { ok: true, id });
      } catch (err) {
        return json(res, 400, { ok: false, code: err.code || "IMPORT_FAILED", message: err.message, issues: err.issues });
      }
    }

    // GET /api/library/:id/export
    const exportMatch = url.pathname.match(/^\/api\/library\/([a-z0-9_-]+)\/export$/u);
    if (exportMatch && req.method === "GET") {
      const id = exportMatch[1];
      try {
        const bundle = await exportUserWorld(id, resolvedEnv);
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${id}.world.json"`,
        });
        res.end(JSON.stringify(bundle, null, 2));
        return true;
      } catch (err) {
        const status = err.code === "WORLD_PACK_UNKNOWN" ? 404 : 400;
        return json(res, status, { ok: false, code: err.code, message: err.message });
      }
    }

    // DELETE /api/library/:id
    const deleteMatch = url.pathname.match(/^\/api\/library\/([a-z0-9_-]+)$/u);
    if (deleteMatch && req.method === "DELETE") {
      if (!sameOrigin(req)) {
        return json(res, 403, { ok: false, code: "ORIGIN_FORBIDDEN", message: "跨域请求被拒绝。" });
      }
      const id = deleteMatch[1];
      if (isBuiltInWorld(id)) {
        return json(res, 403, { ok: false, code: "BUILTIN_WORLD_IMMUTABLE", message: "内置世界不可删除。" });
      }
      try {
        await removeUserWorld(id, resolvedEnv);
        return json(res, 200, { ok: true, id });
      } catch (err) {
        const status = err.code === "WORLD_PACK_UNKNOWN" ? 404 : 400;
        return json(res, status, { ok: false, code: err.code, message: err.message });
      }
    }

    return false;
  }

  return { handle };
}
