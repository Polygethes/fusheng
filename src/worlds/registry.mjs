import { listUserWorldIds, loadUserWorldPack } from "./userWorldStore.mjs";

// Known world packs. A static table (not a directory scan) keeps the set of
// loadable worlds explicit and makes ids from HTTP requests safe to resolve.
const IMPORTERS = Object.freeze({
  xiaoyaoyou: () => import("./xiaoyaoyou/pack.mjs"),
  jiexing: () => import("./jiexing/pack.mjs"),
  cangxinggu: () => import("./cangxinggu/pack.mjs"),
});

export const DEFAULT_WORLD_PACK_ID = "xiaoyaoyou";

function fault(code, message) {
  return Object.assign(new Error(message), { code });
}

export function isBuiltInWorld(id) {
  return Boolean(IMPORTERS[id]);
}

export function listWorldPackIds(env = process.env) {
  const userIds = listUserWorldIds(env).filter((id) => !IMPORTERS[id]);
  return [...Object.keys(IMPORTERS), ...userIds];
}

export async function loadWorldPack(id = DEFAULT_WORLD_PACK_ID, env = process.env) {
  const worldId = String(id || "");
  if (!/^[a-z0-9_-]+$/u.test(worldId)) throw fault("WORLD_PACK_ID_INVALID", "World pack id must be a lowercase identifier.");
  const importer = IMPORTERS[worldId];
  if (importer) return (await importer()).default;
  return loadUserWorldPack(worldId, env);
}
