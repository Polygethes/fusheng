import assert from "node:assert/strict";

import { auditCharacterAgentWorldContinuity } from "../src/server/simulation/characterQualityAudit.mjs";

const broken = auditCharacterAgentWorldContinuity({
  actions: [{
    id: "action:broken-counter-response",
    actorId: "char:a",
    sharedActivity: { operation: "respond" },
    worldResolution: {
      status: "partial",
      failureCodes: ["SHARED_ACTIVITY_RESPONSE_NOT_OWNED"],
    },
  }],
});
assert.equal(broken.valid, false);
assert.equal(broken.issues[0].code, "SHARED_ACTIVITY_RESPONSE_NOT_OWNED");

const ordinaryRefusal = auditCharacterAgentWorldContinuity({
  actions: [{
    id: "action:door-locked",
    actorId: "char:a",
    worldResolution: {
      status: "failed",
      failureCodes: ["ACTION_ATTEMPT_DESTINATION_UNREACHABLE"],
    },
  }],
});
assert.equal(ordinaryRefusal.valid, true, "an ordinary failed attempt remains valid story evidence");

const clean = auditCharacterAgentWorldContinuity({
  actions: [{
    id: "action:coordinate",
    actorId: "char:a",
    sharedActivity: { operation: "coordinate" },
    worldResolution: { status: "success", failureCodes: [] },
  }],
});
assert.equal(clean.valid, true);

console.log("characterAgentQualityWorldAuditContracts:test passed");
