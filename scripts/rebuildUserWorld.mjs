#!/usr/bin/env node
import { rebuildUserWorld } from "../src/worlds/userWorldStore.mjs";

const args = process.argv.slice(2);
let id = null;
let dryRun = false;
let force = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--dry-run") {
    dryRun = true;
  } else if (arg === "--force") {
    force = true;
  } else if (!arg.startsWith("-") && !id) {
    id = arg;
  }
}

if (!id) {
  console.log(JSON.stringify({
    event: "world_rebuild_refused",
    code: "USAGE_ERROR",
    message: "用法: npm run world:rebuild -- <worldId> [--dry-run] [--force]",
  }));
  process.exitCode = 1;
} else {
  try {
    const result = await rebuildUserWorld(id, { dryRun, force });
    const event = result.saved ? "world_rebuilt" : "world_rebuild_preview";
    console.log(JSON.stringify({
      event,
      id: result.id,
      saved: result.saved,
      backupDir: result.backupDir,
      issuesBefore: result.before.issues.length,
      issuesAfter: result.after.issues.length,
      sites: result.sites,
    }));
  } catch (err) {
    console.log(JSON.stringify({
      event: "world_rebuild_refused",
      code: err.code || "UNKNOWN_ERROR",
      message: err.message,
    }));
    process.exitCode = 1;
  }
}
