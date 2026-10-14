// Compatibility entry point. Never implicitly overwrite this run's evidence.
if (!process.env.RELAY_SAVE_PATH) {
  throw new Error("RELAY_SAVE_PATH_REQUIRED: choose a new output file; use RELAY_RESUME_PATH explicitly to read an existing save.");
}
await import("../../scripts/runV27ModelRelay.mjs");
