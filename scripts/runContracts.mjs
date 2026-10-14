// Aggregate contract runner.
//
// The project carries 450+ standalone contract scripts but had no single entry
// point, so "is the suite red or green right now" was not answerable without
// running every script by hand.  This runner executes them all, then compares
// the result against a recorded baseline so a known-red contract does not hide
// a newly broken one.
//
//   node scripts/runContracts.mjs                  run every contract
//   node scripts/runContracts.mjs --filter tavern  run matching contracts only
//   node scripts/runContracts.mjs --update-baseline
//   node scripts/runContracts.mjs --concurrency 4 --timeout 120000
//
// Exit code is 0 only when no contract regressed against the baseline.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASELINE_PATH = path.join(ROOT, "contract-baseline.json");

function parseArgs(argv) {
  const args = { filter: "", updateBaseline: false, concurrency: 8, timeout: 90_000, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--update-baseline") args.updateBaseline = true;
    else if (token === "--quiet") args.quiet = true;
    else if (token === "--filter") args.filter = String(argv[++i] || "");
    else if (token === "--concurrency") args.concurrency = Math.max(1, Number(argv[++i]) || 8);
    else if (token === "--timeout") args.timeout = Math.max(1000, Number(argv[++i]) || 90_000);
  }
  return args;
}

function contractNames(scripts, filter) {
  return Object.keys(scripts)
    .filter((name) => name.endsWith(":test"))
    .filter((name) => (filter ? name.includes(filter) : true))
    .sort();
}

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) {
    return { knownFailing: [], neverGreen: [], retiredCurrentProductScope: [], flaky: {}, slowContracts: {}, recordedAt: "", note: "" };
  }
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf-8"));
    return {
      knownFailing: Array.isArray(parsed.knownFailing) ? parsed.knownFailing : [],
      neverGreen: Array.isArray(parsed.neverGreen) ? parsed.neverGreen : [],
      retiredCurrentProductScope: Array.isArray(parsed.retiredCurrentProductScope)
        ? parsed.retiredCurrentProductScope
        : [],
      flaky: parsed.flaky && typeof parsed.flaky === "object" ? parsed.flaky : {},
      slowContracts: parsed.slowContracts && typeof parsed.slowContracts === "object" ? parsed.slowContracts : {},
      recordedAt: String(parsed.recordedAt || ""),
      note: String(parsed.note || ""),
    };
  } catch {
    return { knownFailing: [], neverGreen: [], retiredCurrentProductScope: [], flaky: {}, slowContracts: {}, recordedAt: "", note: "" };
  }
}

// A contract that cannot reach a provider is reported separately: it is an
// environment gap, not a broken contract, and it must never be mistaken for a
// passing run either.
function classifyFailure(output) {
  if (/OPENAI_API_KEY|DEEPSEEK_API_KEY/.test(output)) return "needs_provider_key";
  return "failed";
}

function runContract(name, command, timeout, testHome) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn("sh", ["-c", command], {
      cwd: ROOT,
      env: { ...process.env, CHARACTER_TOWN_HOME: testHome },
    });
    let out = "";
    let err = "";
    const capture = (buffer, chunk) => (buffer + chunk).slice(-16_000);
    child.stdout.on("data", (chunk) => { out = capture(out, chunk); });
    child.stderr.on("data", (chunk) => { err = capture(err, chunk); });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ name, status: "timeout", elapsedMs: Date.now() - startedAt, output: `${out}${err}` });
    }, timeout);
    child.on("close", (code) => {
      clearTimeout(timer);
      const output = `${out}${err}`;
      resolve({
        name,
        status: code === 0 ? "passed" : classifyFailure(output),
        elapsedMs: Date.now() - startedAt,
        output: code === 0 ? "" : output,
      });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ name, status: "failed", elapsedMs: Date.now() - startedAt, output: String(error) });
    });
  });
}

// Soak contracts (multi-day simulations) declare their own budget in the
// baseline; the global timeout still applies when it is the larger one.
function timeoutFor(name, timeout, slowContracts = {}) {
  return Math.max(timeout, Number(slowContracts[name]?.timeoutMs) || 0);
}

async function runAll(names, scripts, { concurrency, timeout, quiet, slowContracts, testHome }) {
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < names.length) {
      const name = names[cursor++];
      const result = await runContract(name, scripts[name], timeoutFor(name, timeout, slowContracts), testHome);
      results.push(result);
      if (!quiet) {
        const mark = result.status === "passed" ? "pass" : result.status;
        process.stderr.write(`[${results.length}/${names.length}] ${mark.padEnd(18)} ${name}\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, names.length) }, worker));
  return results.sort((left, right) => left.name.localeCompare(right.name));
}

function reportSection(title, rows) {
  if (!rows.length) return;
  console.log(`\n${title}`);
  for (const row of rows) console.log(`  ${row}`);
}

const args = parseArgs(process.argv.slice(2));
const scripts = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf-8")).scripts || {};
const names = contractNames(scripts, args.filter);

if (!names.length) {
  console.error(`No contracts matched filter "${args.filter}".`);
  process.exit(1);
}

const startedAt = Date.now();
const testHome = mkdtempSync(path.join(os.tmpdir(), "ct-test-home-"));
let results;
try {
  results = await runAll(names, scripts, { ...args, slowContracts: readBaseline().slowContracts, testHome });
} finally {
  rmSync(testHome, { recursive: true, force: true });
}
const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);

const passed = results.filter((row) => row.status === "passed");
const needsKey = results.filter((row) => row.status === "needs_provider_key");
const broken = results.filter((row) => row.status !== "passed" && row.status !== "needs_provider_key");

if (args.updateBaseline) {
  const knownFailing = [...broken, ...needsKey].map((row) => row.name).sort();
  const existingBaseline = readBaseline();
  writeFileSync(BASELINE_PATH, `${JSON.stringify({
    note: "Contracts known to be red at the time of recording. New entries mean a regression; removed entries mean a fix worth locking in.",
    recordedAt: new Date().toISOString().slice(0, 10),
    knownFailing,
    ...(existingBaseline.neverGreen.length ? { neverGreen: existingBaseline.neverGreen } : {}),
    ...(Object.keys(existingBaseline.flaky).length ? { flaky: existingBaseline.flaky } : {}),
    ...(Object.keys(existingBaseline.slowContracts).length ? { slowContracts: existingBaseline.slowContracts } : {}),
    ...(existingBaseline.retiredCurrentProductScope.length
      ? { retiredCurrentProductScope: existingBaseline.retiredCurrentProductScope }
      : {}),
  }, null, 2)}\n`);
  console.log(`\nBaseline updated: ${knownFailing.length} known-failing contracts recorded.`);
  process.exit(0);
}

const baseline = readBaseline();
const knownFailing = new Set(baseline.knownFailing);
const stillRed = [...broken, ...needsKey].filter((row) => knownFailing.has(row.name));
const regressions = [...broken, ...needsKey].filter((row) => !knownFailing.has(row.name));
// A contract recorded as flaky passing once is not evidence it is fixed, so it
// must not be advertised as ready to drop from the baseline.
const flakyNames = new Set(Object.keys(baseline.flaky || {}));
const fixed = [...knownFailing]
  .filter((name) => !flakyNames.has(name))
  .filter((name) => passed.some((row) => row.name === name));
const flakyGreen = [...knownFailing]
  .filter((name) => flakyNames.has(name))
  .filter((name) => passed.some((row) => row.name === name));

console.log(`\n${"=".repeat(64)}`);
console.log(`contracts ${results.length} · passed ${passed.length} · red ${broken.length + needsKey.length} · ${elapsedSeconds}s`);
if (baseline.recordedAt) console.log(`baseline recorded ${baseline.recordedAt}: ${knownFailing.size} known-failing`);
if (baseline.retiredCurrentProductScope.length) {
  console.log(`retired from current product scope: ${baseline.retiredCurrentProductScope.length}`);
}
console.log("=".repeat(64));

reportSection(`REGRESSIONS (${regressions.length}) — red and not in the baseline`, regressions.map((row) => `${row.status.padEnd(18)} ${row.name}`));
reportSection(`FIXED (${fixed.length}) — green but still listed in the baseline; rerun with --update-baseline to lock in`, fixed);
reportSection(`FLAKY, GREEN THIS RUN (${flakyGreen.length}) — stays in the baseline; one green run is not a fix`, flakyGreen);
// Red means two different things here, and conflating them hides the real
// backlog: a regression is work that was undone, an unimplemented contract is
// work that was never done.
const neverGreenNames = new Set(baseline.neverGreen || []);
const redRegressions = stillRed.filter((row) => !neverGreenNames.has(row.name));
const redUnimplemented = stillRed.filter((row) => neverGreenNames.has(row.name));
reportSection(
  `KNOWN RED — REGRESSIONS (${redRegressions.length}) — passed once, broken since`,
  redRegressions.map((row) => `${row.status.padEnd(18)} ${row.name}`),
);
reportSection(
  `KNOWN RED — NEVER GREEN (${redUnimplemented.length}) — specifications, not regressions`,
  redUnimplemented.map((row) => `${row.status.padEnd(18)} ${row.name}`),
);

if (regressions.length) {
  console.log(`\nFirst regression output — ${regressions[0].name}:`);
  console.log(regressions[0].output.split("\n").slice(-20).join("\n"));
}

process.exit(regressions.length ? 1 : 0);
