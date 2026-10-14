import assert from "node:assert/strict";
import { executeCodexTrustedBlindProbeInvocation } from "../src/server/ecology/codexTrustedBlindProbeChannel.mjs";

const progress = [];
const execution = await executeCodexTrustedBlindProbeInvocation({
  command: process.execPath,
  args: ["-e", `
    process.stdin.resume();
    process.stdout.write('{"type":"thread.started"}\\n{"type":"item.');
    setTimeout(() => {
      process.stdout.write('completed","item":{"type":"reasoning","text":"PRIVATE_REASONING"}}\\n');
      process.stdout.write(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"PRIVATE_OUTPUT"}})+"\\n");
      process.stdout.write(JSON.stringify({type:"turn.completed",usage:{input_tokens:42,output_tokens:7,unknown:"PRIVATE_USAGE"}}));
    }, 20);
  `],
  environment: process.env, stdin: "", cwd: process.cwd(),
}, { onProgress: event => { progress.push(event); } });
assert.equal(execution.exitCode, 0);
assert.ok(progress.some(event => event.type === "thread.started"));
assert.ok(progress.some(event => event.itemType === "agent_message"));
assert.equal(progress.find(event => event.type === "turn.completed").usage.input_tokens, 42);
assert.ok(progress.every(event => event.elapsedMs >= 0));
assert.ok(!JSON.stringify(progress).includes("PRIVATE_"), "timing observations must never carry reasoning or message text");
assert.ok(execution.stdout.includes("PRIVATE_OUTPUT"), "existing final-output handling remains available to the provider");
console.log("codex invocation progress contracts passed");
