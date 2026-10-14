// npm run world:smoke -- <worldId>   (zero model calls; nothing is saved)
import { listWorldPackIds, loadWorldPack } from "../src/worlds/registry.mjs";
import { runWorldSmoke } from "../src/worlds/worldSmoke.mjs";

const ids = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const verbose = process.argv.includes("--steps");
let failed = false;
for (const id of ids.length ? ids : listWorldPackIds()) {
  const pack = await loadWorldPack(id);
  const report = await runWorldSmoke(pack);
  console.log(`${report.ok ? "✓" : "✗"} ${id} · 冒烟（零模型调用；仅证明可达性，不代表人物行为）`);
  for (const row of report.stages) console.log(`  阶段  ${row.characterId}  ${row.phase}  输入 ${row.inputBytes}B  约束 ${row.schemaBytes}B`);
  for (const row of report.deadlines) console.log(`  时限  ${row.label}  期限 ${row.dueAtSeconds}s  条件达成于 ${row.conditionsMetAtSeconds ?? "—"}s  → ${row.status}`);
  for (const row of report.skillBoundaries) console.log(`  技能  ${row.actorId} 尝试 ${row.templateId} → ${row.held ? "WORK_SKILL_MISSING（边界成立）" : row.status}`);
  if (verbose) for (const row of report.steps) console.log(`    #${row.seq} t=${row.at} ${row.actorId} ${row.primitive} ${JSON.stringify(row.payload)} → ${row.status}${row.failed.length ? ` ${row.failed}` : ""}`);
  for (const row of report.issues) console.log(`  ✗ ${row.code}: ${row.message}`);
  failed ||= !report.ok;
}
process.exit(failed ? 1 : 0);
