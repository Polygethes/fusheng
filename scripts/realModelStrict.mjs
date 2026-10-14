await import("../src/server/env.mjs");

if (!process.env.OPENAI_API_KEY && !process.env.DEEPSEEK_API_KEY) {
  console.error("OPENAI_API_KEY or DEEPSEEK_API_KEY is required for real-model:strict.");
  process.exit(1);
}
await import("./realModelSmoke.mjs");
