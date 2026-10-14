// npm run world:validate -- <worldId>
import { listWorldPackIds, loadWorldPack } from "../src/worlds/registry.mjs";
import { validateWorldPack } from "../src/worlds/validateWorldPack.mjs";

const ids = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const targets = ids.length ? ids : listWorldPackIds();
let failed = false;
for (const id of targets) {
  const pack = await loadWorldPack(id);
  const { ok, issues } = validateWorldPack(pack);
  console.log(`${ok ? "✓" : "✗"} ${id} · ${pack.meta.title}${ok ? " — V1–V9 全部通过" : ` — ${issues.length} 项问题`}`);
  for (const row of issues) console.log(`  [${row.check}] ${row.code} @ ${row.path}\n      ${row.message}`);
  failed ||= !ok;
}
process.exit(failed ? 1 : 0);
