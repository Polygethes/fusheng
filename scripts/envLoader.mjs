import assert from "node:assert/strict";
import { parseEnvText } from "../src/server/env.mjs";

const parsed = parseEnvText(`
# comment
DEEPSEEK_API_KEY="secret-value"
OPENAI_BASE_URL=https://api.deepseek.com
CHARACTER_TOWN_MODEL='deepseek-chat'
EMPTY=
BAD LINE
`);

assert.deepEqual(parsed, {
  DEEPSEEK_API_KEY: "secret-value",
  OPENAI_BASE_URL: "https://api.deepseek.com",
  CHARACTER_TOWN_MODEL: "deepseek-chat",
  EMPTY: "",
});

console.log("envLoader:test passed", Object.keys(parsed));
