import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { dataHome } from "../server/localData.mjs";
import { defineWorldPack } from "./worldPack.mjs";
import { validateWorldPack } from "./validateWorldPack.mjs";
import { runWorldSmoke } from "./worldSmoke.mjs";
import { isBuiltInWorld } from "./registry.mjs";
import { compileBlueprint } from "./compiler/index.mjs";

export const USER_WORLD_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/u;

function fault(code, message) {
  return Object.assign(new Error(message), { code });
}

export function userWorldsRoot(env = process.env) {
  return path.join(dataHome(env), "worlds");
}

export function listUserWorldIds(env = process.env) {
  const root = userWorldsRoot(env);
  if (!fs.existsSync(root)) return [];
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const ids = [];
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
      if (!USER_WORLD_ID.test(ent.name)) continue;
      const packFile = path.join(root, ent.name, "pack.json");
      if (fs.existsSync(packFile)) {
        ids.push(ent.name);
      }
    }
    return ids.sort();
  } catch {
    return [];
  }
}

export async function loadUserWorldPack(id, env = process.env) {
  const worldId = String(id || "");
  if (!USER_WORLD_ID.test(worldId)) {
    throw fault("WORLD_PACK_ID_INVALID", `Invalid user world id: ${worldId}`);
  }
  const packFile = path.join(userWorldsRoot(env), worldId, "pack.json");
  let content;
  try {
    content = await fsp.readFile(packFile, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw fault("WORLD_PACK_UNKNOWN", `User world pack not found: ${worldId}`);
    }
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw fault("WORLD_PACK_CORRUPT", `Failed to parse pack.json for ${worldId}`);
  }
  return defineWorldPack(parsed);
}

export async function saveUserWorld({ pack, blueprint = null, report = null }, env = process.env) {
  if (!pack || typeof pack !== "object" || !pack.meta) {
    throw fault("WORLD_PACK_INVALID", "Missing or invalid pack definition.");
  }
  const id = String(pack.meta.id || "");
  if (!USER_WORLD_ID.test(id)) {
    throw fault("WORLD_PACK_ID_INVALID", `Invalid world id: ${id}`);
  }
  if (isBuiltInWorld(id)) {
    throw fault("WORLD_ID_RESERVED", `World id '${id}' is reserved for a built-in world.`);
  }

  let definedPack;
  try {
    definedPack = defineWorldPack(pack);
  } catch (err) {
    throw fault("WORLD_PACK_INVALID", err.message);
  }
  const validation = validateWorldPack(definedPack);
  if (!validation.ok) {
    const err = fault("WORLD_PACK_INVALID", "World pack validation failed.");
    err.issues = validation.issues;
    throw err;
  }

  const root = userWorldsRoot(env);
  const targetDir = path.join(root, id);
  const tempDir = path.join(root, `.tmp_${id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);

  await fsp.mkdir(tempDir, { recursive: true, mode: 0o700 });

  try {
    await fsp.writeFile(path.join(tempDir, "pack.json"), JSON.stringify(pack, null, 2), "utf8");
    if (blueprint !== null && blueprint !== undefined) {
      await fsp.writeFile(path.join(tempDir, "blueprint.json"), JSON.stringify(blueprint, null, 2), "utf8");
    }
    if (report !== null && report !== undefined) {
      await fsp.writeFile(path.join(tempDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
    }

    // Atomic replacement if target already exists:
    // On POSIX, rename over existing directory might fail if target is non-empty, so remove target if present
    if (fs.existsSync(targetDir)) {
      const backupDir = path.join(root, `.old_${id}_${Date.now()}`);
      await fsp.rename(targetDir, backupDir);
      await fsp.rename(tempDir, targetDir);
      await fsp.rm(backupDir, { recursive: true, force: true });
    } else {
      await fsp.rename(tempDir, targetDir);
    }
    return id;
  } catch (err) {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

export async function removeUserWorld(id, env = process.env) {
  const worldId = String(id || "");
  if (!USER_WORLD_ID.test(worldId)) {
    throw fault("WORLD_PACK_ID_INVALID", `Invalid user world id: ${worldId}`);
  }
  if (isBuiltInWorld(worldId)) {
    throw fault("WORLD_ID_RESERVED", `Cannot remove built-in world: ${worldId}`);
  }
  const root = userWorldsRoot(env);
  const targetDir = path.join(root, worldId);
  if (!fs.existsSync(targetDir)) {
    throw fault("WORLD_PACK_UNKNOWN", `User world not found: ${worldId}`);
  }

  const trashRoot = path.join(root, ".trash");
  await fsp.mkdir(trashRoot, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:]/gu, "").replace(/\..*$/u, "").replace("T", "-");
  const trashDest = path.join(trashRoot, `${worldId}-${stamp}`);
  await fsp.rename(targetDir, trashDest);
  return { ok: true, removed: worldId };
}

export async function exportUserWorld(id, env = process.env) {
  const worldId = String(id || "");
  if (!USER_WORLD_ID.test(worldId)) {
    throw fault("WORLD_PACK_ID_INVALID", `Invalid user world id: ${worldId}`);
  }
  const root = userWorldsRoot(env);
  const targetDir = path.join(root, worldId);
  const packFile = path.join(targetDir, "pack.json");
  const blueprintFile = path.join(targetDir, "blueprint.json");

  let pack;
  try {
    pack = JSON.parse(await fsp.readFile(packFile, "utf8"));
  } catch {
    throw fault("WORLD_PACK_UNKNOWN", `User world pack not found: ${worldId}`);
  }

  let blueprint = null;
  try {
    blueprint = JSON.parse(await fsp.readFile(blueprintFile, "utf8"));
  } catch {
    // optional
  }

  return {
    format: "character-town-world",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    blueprint,
    pack,
  };
}

function nextAvailableId(baseId, env = process.env) {
  const existing = new Set([...listUserWorldIds(env), (isBuiltInWorld(baseId) ? baseId : null)].filter(Boolean));
  if (!existing.has(baseId)) return baseId;
  let counter = 2;
  while (existing.has(`${baseId}-${counter}`)) {
    counter++;
  }
  return `${baseId}-${counter}`;
}

export async function importUserWorld(bundle, env = process.env) {
  if (!bundle || bundle.format !== "character-town-world" || bundle.formatVersion !== 1 || !bundle.pack) {
    throw fault("WORLD_BUNDLE_INVALID", "Invalid world export bundle.");
  }

  let definedPack;
  try {
    definedPack = defineWorldPack(bundle.pack);
  } catch (err) {
    throw fault("WORLD_PACK_INVALID", err.message);
  }

  const validation = validateWorldPack(definedPack);
  if (!validation.ok) {
    const err = fault("WORLD_PACK_INVALID", "World pack validation failed.");
    err.issues = validation.issues;
    throw err;
  }

  const smoke = await runWorldSmoke(definedPack);
  if (smoke.issues && smoke.issues.length > 0) {
    const err = fault("WORLD_PACK_INVALID", "World pack smoke test failed.");
    err.issues = smoke.issues;
    throw err;
  }

  const rawId = String(bundle.pack.meta?.id || "world");
  const safeBase = rawId.replace(/[^a-z0-9_-]/giu, "_").toLowerCase().slice(0, 40) || "world";
  const newId = nextAvailableId(safeBase, env);

  const packCopy = JSON.parse(JSON.stringify(bundle.pack));
  packCopy.meta.id = newId;

  let blueprintCopy = bundle.blueprint ? JSON.parse(JSON.stringify(bundle.blueprint)) : null;
  if (blueprintCopy?.meta) {
    blueprintCopy.meta.id = newId;
  }

  await saveUserWorld({ pack: packCopy, blueprint: blueprintCopy }, env);
  return newId;
}

export async function rebuildUserWorld(id, { env = process.env, dryRun = false, force = false, now = () => new Date() } = {}) {
  const worldId = String(id || "");
  if (!USER_WORLD_ID.test(worldId)) {
    throw fault("WORLD_PACK_ID_INVALID", `Invalid user world id: ${worldId}`);
  }
  if (isBuiltInWorld(worldId)) {
    throw fault("WORLD_ID_RESERVED", `World id '${worldId}' is reserved for a built-in world.`);
  }

  const root = userWorldsRoot(env);
  const targetDir = path.join(root, worldId);
  const packPath = path.join(targetDir, "pack.json");
  const blueprintPath = path.join(targetDir, "blueprint.json");

  if (!fs.existsSync(packPath)) {
    throw fault("WORLD_PACK_UNKNOWN", `User world pack not found: ${worldId}`);
  }
  if (!fs.existsSync(blueprintPath)) {
    throw fault("WORLD_BLUEPRINT_MISSING", "这个小镇没有保存蓝图，无法重建。");
  }

  let old;
  try {
    old = JSON.parse(await fsp.readFile(packPath, "utf8"));
  } catch (err) {
    throw fault("WORLD_PACK_CORRUPT", `Failed to parse pack.json for ${worldId}`);
  }

  let blueprint;
  try {
    blueprint = JSON.parse(await fsp.readFile(blueprintPath, "utf8"));
  } catch (err) {
    throw fault("WORLD_BLUEPRINT_CORRUPT", `Failed to parse blueprint.json for ${worldId}`);
  }

  const { pack, report } = compileBlueprint(blueprint);

  const before = { issues: validateWorldPack(old).issues };
  const after = { issues: validateWorldPack(pack).issues };

  if (after.issues && after.issues.length > 0) {
    const err = fault("WORLD_PACK_INVALID", "Rebuilt world pack failed validation.");
    err.issues = after.issues;
    throw err;
  }

  const sitesCount = pack.stage?.sites?.length ?? 0;

  if (dryRun) {
    return {
      id: worldId,
      saved: false,
      backupDir: null,
      before,
      after,
      sites: sitesCount,
    };
  }

  const runsRoot = path.join(dataHome(env), "runs");
  let saveCount = 0;
  if (fs.existsSync(runsRoot)) {
    try {
      const entries = fs.readdirSync(runsRoot, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory() && ent.name.includes(`-${worldId}-`)) {
          saveCount++;
        }
      }
    } catch {
      // ignore
    }
  }

  if (saveCount > 0 && !force) {
    throw fault("WORLD_HAS_SAVES", `这个小镇已经有 ${saveCount} 个存档，它们是用旧版本跑的；确定要重建就加 --force。`);
  }

  const d = now();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  const backupDir = path.join(root, `.backup_${worldId}_${stamp}`);

  await fsp.cp(targetDir, backupDir, { recursive: true });

  await saveUserWorld({ pack, blueprint, report }, env);

  return {
    id: worldId,
    saved: true,
    backupDir,
    before,
    after,
    sites: sitesCount,
  };
}
