import assert from "node:assert/strict";

import {
  buildTavernV27RemoteRunPolicy,
  projectTavernV27RemoteFailure,
} from "../src/server/pipeline/tavernV27RemoteRunPolicy.mjs";

assert.deepEqual(buildTavernV27RemoteRunPolicy({ maxTurns: 2 }), {
  schemaVersion: "tavern-v27-remote-run-policy-v1",
  maxTurns: 2,
  baseStageRequests: 6,
  maxProtocolRepairRequests: 4,
  maxProviderRequests: 10,
  maxProtocolRepairsPerTurn: 2,
});

const error = new Error("Character Agent subjective appraisal failed authority or evidence validation.");
error.code = "CHARACTER_AGENT_APPRAISAL_REJECTED";
error.failedPhase = "awaiting_subjective_appraisal";
error.failedStage = "subjective_appraisal";
error.characterId = "char_xyy_xiezenshi";
error.agentTurnId = "agent-turn:char_xyy_xiezenshi:1";
error.protocolRepairAttempts = 1;
error.issues = [{
  code: "SUBJECTIVE_APPRAISAL_SOURCE_UNKNOWN",
  path: "relevanceLinks[0].sourceId",
  message: "Unknown private source invented-source.",
  prompt: "must-not-leak",
}];
error.privateContext = { secret: "must-not-leak" };
error.apiKey = "must-not-leak";

const projected = projectTavernV27RemoteFailure(error, {
  model: "deepseek-v4-flash",
  stageInvocations: 2,
  requestBudget: {
    schemaVersion: "model-provider-request-budget-v1",
    authorizationId: "authorization:test",
    maxProviderRequests: 6,
    usedProviderRequests: 2,
    remainingProviderRequests: 4,
    rejectedProviderRequests: 0,
    attempts: [],
  },
});

assert.equal(projected.code, "CHARACTER_AGENT_APPRAISAL_REJECTED");
assert.equal(projected.failedPhase, "awaiting_subjective_appraisal");
assert.equal(projected.failedStage, "subjective_appraisal");
assert.equal(projected.characterId, "char_xyy_xiezenshi");
assert.equal(projected.agentTurnId, "agent-turn:char_xyy_xiezenshi:1");
assert.equal(projected.protocolRepairAttempts, 1);
assert.equal(projected.stageInvocations, 2);
assert.equal(projected.providerRequestBudget.usedProviderRequests, 2);
assert.deepEqual(projected.issues, [{
  code: "SUBJECTIVE_APPRAISAL_SOURCE_UNKNOWN",
  path: "relevanceLinks[0].sourceId",
  message: "Unknown private source invented-source.",
}]);
assert.equal(JSON.stringify(projected).includes("must-not-leak"), false);

console.log(JSON.stringify({
  status: "all-passed",
  checks: {
    twoTurnsAdvertiseTenRealRequests: true,
    failurePhaseAndIssuesRemainVisible: true,
    privatePayloadAndCredentialsStayHidden: true,
  },
}, null, 2));
