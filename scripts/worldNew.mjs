// npm run world:new -- <worldId> --out <new directory>
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { loadWorldPack } from "../src/worlds/registry.mjs";
import { validateWorldPack } from "../src/worlds/validateWorldPack.mjs";
import { createFreshWorldSave } from "../src/worlds/freshWorld.mjs";

const args = process.argv.slice(2);
const id = args.find((arg) => !arg.startsWith("-") && args[args.indexOf(arg) - 1] !== "--out");
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : "";
if (!id || !out) throw new Error("Usage: npm run world:new -- <worldId> --out <new directory>");
const pack = await loadWorldPack(id);
const validation = validateWorldPack(pack);
if (!validation.ok) {
  for (const row of validation.issues) console.error(`[${row.check}] ${row.code}: ${row.message}`);
  throw Object.assign(new Error(`World pack ${id} fails validation; fix it before creating a world.`), { code: "WORLD_PACK_INVALID" });
}
const directory = path.resolve(out);
await mkdir(directory, { mode: 0o700 }); // refuses an existing directory
const { save, report } = await createFreshWorldSave(pack, { runId: path.basename(directory) });
await writeFile(path.join(directory, "world-save.json"), `${JSON.stringify(save, null, 2)}\n`, { mode: 0o600, flag: "wx" });
await writeFile(path.join(directory, "world-save.json.report.md"), report, { mode: 0o600, flag: "wx" });
console.log(JSON.stringify({ event: "world_created", worldPackId: id, digest: save.worldPackDigest, directory,
  cast: save.checkpoint.actors.map((row) => row.characterId) }));
