import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getState, freezeCharacterPlan } from "../src/state/store.js";
import { createV27PersistentModelSessionClient } from "../src/engine/v27PersistentModelSessionClient.js";

// Exercise the actual event dispatch, not just the store's toggle function.
const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const marker = 'app.addEventListener("click", async (event) => {';
const start = source.indexOf(marker) + marker.length;
const end = source.indexOf("\n});", start);
const handler = new (async () => {}).constructor("event", "freezeCharacterPlan", "toast", "saveOperationInFlight", source.slice(start, end));
const before = getState().characterPlans[0];
let calls = 0;
await handler({ target: { closest: () => ({ dataset: { action: "plan-freeze", id: before.characterId } }) } },
  (...args) => { calls += 1; freezeCharacterPlan(...args); }, () => {}, false);
assert.equal(calls, 1, "one freeze click must toggle exactly once");
assert.equal(getState().characterPlans.find((row) => row.id === before.id).status, "frozen");

const values = new Map();
const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
const requests = [];
let sequence = 0;
let interruptReset = true;
const request = async (url, body) => {
  requests.push({ url, body });
  if (url.endsWith("/reset") && interruptReset) return new Promise(() => {});
  return {
    sessionRef: { ...body, sessionId: "synthetic-session" },
    sessionRevision: url.endsWith("/reset") ? 4 : 2,
    worldVersion: url.endsWith("/reset") ? 0 : 1,
    observation: { worldVersion: url.endsWith("/reset") ? 0 : 1, turns: [] },
  };
};
const options = { storage, request, idFactory: () => `synthetic-${++sequence}` };
const first = createV27PersistentModelSessionClient(options);
await first.runAuthorizedTurn({ authorizationAcknowledged: true });
void first.reset();
const pendingId = first.snapshot().pendingCommand.commandId;
interruptReset = false;
const reloaded = createV27PersistentModelSessionClient(options);
await reloaded.reset();
assert.equal(requests.at(-1).body.commandId, pendingId, "refresh must replay the same reset");
assert.equal(Object.hasOwn(requests.at(-1).body, "authorizationAcknowledged"), false);
assert.equal(reloaded.snapshot().pendingCommand, null);
assert.equal(reloaded.snapshot().sessionRef.worldVersion, 0);

let loseResponse = true;
const lostResponseClient = createV27PersistentModelSessionClient({ ...options, request: async (url, body) => {
  if (loseResponse) throw new TypeError("network lost");
  return request(url, body);
} });
await assert.rejects(() => lostResponseClient.reset(), /network lost/);
const lostId = lostResponseClient.snapshot().pendingCommand.commandId;
loseResponse = false;
await lostResponseClient.reset();
assert.equal(requests.at(-1).body.commandId, lostId);
console.log("review UI and reset recovery contracts passed");
