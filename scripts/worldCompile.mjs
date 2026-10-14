#!/usr/bin/env node
// CLI command to compile a world blueprint into a validated WorldPack
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateBlueprint } from "../src/worlds/blueprint/validateBlueprint.mjs";
import { compileBlueprint } from "../src/worlds/compiler/index.mjs";
import { validateWorldPack } from "../src/worlds/validateWorldPack.mjs";
import { runWorldSmoke } from "../src/worlds/worldSmoke.mjs";
import { saveUserWorld } from "../src/worlds/userWorldStore.mjs";

function usage() {
  console.log("用法: node scripts/worldCompile.mjs <blueprint.json> [--seed N] [--save]");
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0) usage();

let blueprintPath = null;
let seed = undefined;
let shouldSave = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--save") {
    shouldSave = true;
  } else if (arg === "--seed") {
    i++;
    if (i >= args.length) usage();
    seed = parseInt(args[i], 10);
  } else if (!blueprintPath) {
    blueprintPath = arg;
  } else {
    usage();
  }
}

if (!blueprintPath) usage();

const resolvedPath = path.resolve(process.cwd(), blueprintPath);
if (!fs.existsSync(resolvedPath)) {
  console.error(`错误: 找不到蓝图文件 ${resolvedPath}`);
  process.exit(1);
}

let blueprintRaw;
try {
  blueprintRaw = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
} catch (err) {
  console.error(`错误: 蓝图 JSON 解析失败: ${err.message}`);
  process.exit(1);
}

console.log(`=== 1. 蓝图校验: ${blueprintRaw.meta?.title || blueprintRaw.meta?.id} ===`);
const bpVal = validateBlueprint(blueprintRaw);
if (!bpVal.ok) {
  console.error(`蓝图校验未通过 (${bpVal.issues.length} 处问题):`);
  for (const issue of bpVal.issues) {
    console.error(`  [${issue.rule || issue.code}] ${issue.path}: ${issue.message}`);
  }
  process.exit(1);
}
console.log("  ✓ 蓝图格式与完整性校验通过");

console.log(`=== 2. 编译蓝图 ===`);
let compileResult;
try {
  compileResult = compileBlueprint(blueprintRaw, { seed });
} catch (err) {
  console.error(`编译失败: ${err.message} (${err.code || "UNKNOWN"} at ${err.path || "root"})`);
  process.exit(1);
}

const { pack, report } = compileResult;
console.log(`  ✓ 编译完成: 世界 ID "${pack.meta.id}" (${pack.meta.title})`);
console.log(`  • 居民数: ${pack.cast.length}`);
console.log(`  • 拓扑区数: ${Object.keys(pack.stage.topology.zones).length}`);
console.log(`  • 边数: ${pack.stage.topology.edges.length}`);
console.log(`  • 物件数: ${pack.objects.length}`);
console.log(`  • 活计模板: ${pack.work.length}`);
console.log(`  • 临时判定 (provisional): ${report.provisional?.length ? report.provisional.join(", ") : "无"}`);
if (report.warnings?.length) {
  for (const w of report.warnings) {
    console.warn(`  ! [警告] ${w.path}: ${w.message}`);
  }
}

console.log(`=== 3. 世界包规格验证 (WorldPack Validator) ===`);
const packVal = validateWorldPack(pack);
if (!packVal.ok) {
  console.error(`世界包验证失败 (${packVal.issues.length} 处问题):`);
  for (const issue of packVal.issues) {
    console.error(`  [${issue.check || issue.code}] ${issue.path}: ${issue.message}`);
  }
  process.exit(1);
}
console.log("  ✓ 世界包契约与规则验证全部通过");

console.log(`=== 4. 零模型可达性冒烟测试 (World Smoke) ===`);
const smokeResult = await runWorldSmoke(pack);
if (smokeResult.issues?.length) {
  console.error(`冒烟测试发现问题 (${smokeResult.issues.length} 项):`);
  for (const issue of smokeResult.issues) {
    console.error(`  [${issue.code}] ${issue.message}`);
  }
  process.exit(1);
}
console.log(`  ✓ 阶段生成、时限可达与技能边界检验全部通过 (${smokeResult.stages.length} 阶段, ${smokeResult.steps.length} 步骤)`);

if (shouldSave) {
  console.log(`=== 5. 写入用户世界库 ===`);
  try {
    const savedId = await saveUserWorld({ pack, blueprint: blueprintRaw, report });
    console.log(`  ✓ 已成功保存到世界库: ${savedId}`);
  } catch (err) {
    console.error(`保存到世界库失败: ${err.message}`);
    process.exit(1);
  }
}

console.log(`\n编译流程顺利结束！`);
