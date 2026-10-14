// Read the exact production model input, including its complete owned context.
// RELAY_BASE_URL=http://127.0.0.1:8791 node scripts/readV27ModelRelay.mjs
const base = process.env.RELAY_BASE_URL || "http://127.0.0.1:8791";
const response = await fetch(new URL("/pending?format=model", base), { signal: AbortSignal.timeout(10_000) });
if (!response.ok) throw new Error(`RELAY_READ_FAILED:${response.status}`);
const { pending } = await response.json();
if (pending && !pending.systemPrompt) throw new Error("RELAY_RESTART_REQUIRED_FOR_MODEL_FORMAT");
process.stdout.write(`${JSON.stringify({ pending }, null, 2)}\n`);
