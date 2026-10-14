import assert from "node:assert/strict";

import { createV27PersistentModelSessionClient } from "../src/engine/v27PersistentModelSessionClient.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    dump() { return Object.fromEntries(values); },
  };
}

function rawResponse(body, index, characterId) {
  const sessionId = body.sessionId || "runtime-session:model-page";
  const revision = Number(body.expectedRevision || 0) + 2;
  return {
    sessionRef: {
      projectId: body.projectId,
      branchId: body.branchId,
      runtimeId: body.runtimeId,
      sessionId,
    },
    sessionRevision: revision,
    worldVersion: index,
    mode: "persistent-character-model-session",
    externalModelCalled: true,
    model: "test-model-medium",
    stageInvocations: 4,
    providerRequestBudget: {
      maxProviderRequests: 5,
      usedProviderRequests: 4,
      remainingProviderRequests: 1,
    },
    protocolRepairEvents: [],
    authorQualityVerdict: "pending",
    observation: {
      schemaVersion: "tavern-world-runtime-v2.7",
      worldVersion: index,
      nowSeconds: index * 2,
      eventCount: index,
      characters: [],
      readyQueue: [],
      turns: [{
        characterId,
        characterName: characterId.includes("xie") ? "谢真石" : "洛照",
        agentTurnId: `agent-turn:${characterId}:${Math.ceil(index / 2)}`,
        submissionMode: "atomic",
        characterAgentCompleted: true,
        acceptedStageCount: 4,
        expectedAcceptedStageCount: 4,
        fiveStageAgentCompleted: false,
        publicRealization: {
          actionType: "speak",
          speech: index === 1 ? "客官，要些什么？" : "来壶好茶。",
          visibleAction: "",
          observableAffectiveTexture: [],
        },
        observerOnlyPsychology: {
          visibility: "observer-only-never-returned-to-character-context",
          selectedIntention: index === 1 ? "先接住来客的当面询问。" : "直接说明自己的来意。",
          privateDecisionBasis: index === 1 ? "招呼可逆，也能继续确认来意。" : "回答能推进目的，不必先清空所有不确定性。",
          automaticCommunicationImpulse: {
            feltTendency: index === 1 ? "先简短招呼。" : "直接回答。",
            urgency: 0.7,
            disclosurePressure: 0.5,
            inhibitionPressure: 0.3,
            conflict: {
              present: true,
              description: "想推进目标，同时保留没有亲见的判断。",
            },
          },
        },
        outcome: {
          status: "success",
          worldVersion: index,
          durationSeconds: 2,
          failedEffects: [],
        },
      }],
    },
  };
}

const storage = memoryStorage();
const storageKey = "test:v27:model-session";
let idCounter = 0;
const calls = [];
let requestMode = "success";

async function request(path, body) {
  calls.push({ path, body: structuredClone(body) });
  const storedDuringRequest = storage.getItem(storageKey);
  assert.ok(storedDuringRequest, "pending command must be stored before network execution");
  assert.equal(storedDuringRequest.includes(body.commandId), true);
  assert.equal(storedDuringRequest.includes("authorizationAcknowledged"), false);
  if (requestMode === "network-loss") throw new Error("response lost");
  const reset = path.endsWith("/reset");
  const index = reset ? 0 : path.endsWith("/start") ? 1 : Number(body.expectedRevision || 0) / 2 + 1;
  const response = rawResponse(body, index, index % 2 === 1 ? "char_xyy_xiezenshi" : "char_xyy_luozhao");
  if (reset) response.observation.turns = [];
  return response;
}

const createClient = () => createV27PersistentModelSessionClient({
  storage,
  storageKey,
  request,
  idFactory: () => `id-${idCounter += 1}`,
});

const firstClient = createClient();
await assert.rejects(
  () => firstClient.runAuthorizedTurn({ authorizationAcknowledged: false }),
  (error) => error?.code === "V27_MODEL_SESSION_AUTHORIZATION_REQUIRED",
);
assert.equal(calls.length, 0);

const first = await firstClient.runAuthorizedTurn({ authorizationAcknowledged: true });
assert.equal(calls[0].path, "/api/v27/tavern/model-session/start");
assert.equal(calls[0].body.authorizationAcknowledged, true);
assert.match(calls[0].body.runtimeId, /^tavern-v27-model:/);
assert.equal(first.displayedObservation.turns.length, 1);
assert.equal(first.sessionRef.sessionRevision, 2);
assert.equal(first.displayedObservation.nowSeconds, 2);
assert.equal(first.displayedObservation.turns[0].observerOnlyPsychology.privateDecisionBasis, "招呼可逆，也能继续确认来意。");
assert.equal(first.displayedObservation.turns[0].observerOnlyPsychology.automaticCommunicationImpulse.feltTendency, "先简短招呼。");

const restoredClient = createClient();
assert.equal(restoredClient.snapshot().sessionRef.sessionId, first.sessionRef.sessionId);
assert.equal(restoredClient.snapshot().observation.turns[0].observerOnlyPsychology.selectedIntention, "先接住来客的当面询问。");
await assert.rejects(
  () => restoredClient.runAuthorizedTurn({ authorizationAcknowledged: false }),
  (error) => error?.code === "V27_MODEL_SESSION_AUTHORIZATION_REQUIRED",
);
assert.equal(calls.length, 1, "reload may not inherit consent or automatically contact the model route");

const second = await restoredClient.runAuthorizedTurn({ authorizationAcknowledged: true });
assert.equal(calls[1].path, "/api/v27/tavern/model-session/continue");
assert.equal(calls[1].body.sessionId, first.sessionRef.sessionId);
assert.equal(calls[1].body.expectedRevision, 2);
assert.equal(second.displayedObservation.turns.length, 2);
assert.equal(second.displayedObservation.nowSeconds, 4);
assert.equal(second.displayedObservation.turns[1].observerOnlyPsychology.privateDecisionBasis, "回答能推进目的，不必先清空所有不确定性。");

requestMode = "network-loss";
await assert.rejects(
  () => restoredClient.runAuthorizedTurn({ authorizationAcknowledged: true }),
  /response lost/,
);
const afterLoss = restoredClient.snapshot();
assert.ok(afterLoss.pendingCommand?.commandId);
const lostCommandId = afterLoss.pendingCommand.commandId;

requestMode = "success";
const afterRefresh = createClient();
await assert.rejects(
  () => afterRefresh.runAuthorizedTurn({ authorizationAcknowledged: false }),
  (error) => error?.code === "V27_MODEL_SESSION_AUTHORIZATION_REQUIRED",
);
const recovered = await afterRefresh.runAuthorizedTurn({ authorizationAcknowledged: true });
assert.equal(calls.at(-1).body.commandId, lostCommandId, "response-loss recovery must replay the same durable command id");
assert.equal(recovered.displayedObservation.turns.length, 3);

const beforeResetCalls = calls.length;
const reset = await afterRefresh.reset();
assert.equal(calls.length, beforeResetCalls + 1);
assert.equal(calls.at(-1).path, "/api/v27/tavern/model-session/reset");
assert.equal(Object.hasOwn(calls.at(-1).body, "authorizationAcknowledged"), false);
assert.equal(reset.sessionRef.worldVersion, 0);

const persistedJson = JSON.stringify(storage.dump());
for (const forbidden of [
  "authorizationAcknowledged",
  "authorization:",
  "checkpoint",
  "privateState",
  "privateContext",
  "prompt",
  "apiKey",
]) assert.equal(persistedJson.includes(forbidden), false, `${forbidden} must not enter browser session storage`);

console.log(JSON.stringify({
  status: "all-passed",
  checks: {
    authorizationRequiredForEveryTurn: true,
    pendingCommandStoredBeforeNetworkWithoutConsent: true,
    refreshRestoresCursorButNotAuthorization: true,
    responseLossReplaysSameCommandAfterFreshAuthorization: true,
    observationHistoryContinuesAcrossRefresh: true,
    resetUsesNoProviderAuthorization: true,
    browserStorageContainsNoPrivateRuntimeOrAuthorization: true,
  },
}, null, 2));
