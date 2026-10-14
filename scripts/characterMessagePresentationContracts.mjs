import assert from "node:assert/strict";
import { buildCharacterPerceptionFrame } from "../src/server/simulation/characterPerception.mjs";
import { createCharacterSessionActor } from "../src/server/simulation/characterSessionActor.mjs";
import { createLocalCharacterRuntimePort } from "../src/server/simulation/characterRuntimePort.mjs";
const direct = (id, content) => ({ signalId: id, sourceEntityHandle: id, modality: "sound", featureId: "speech", physicalFeature: content,
  domainTags: ["speech", "directed"], intensity: 0.96, transmissionFactor: 1 });
const signals = [direct("zhou", "真石，起手那半步该怎么改？"), direct("luo", "让我看看你的招式。"),
  ...Array.from({ length: 20 }, (_, i) => ({ signalId: `sword:${i}`, modality: "visual", physicalFeature: "一柄佩剑", domainTags: ["martial"], intensity: 1 }))];
const options = { signals, profile: { attention: { baselineBudget: 1, orientingBiases: { martial: 10 } } },
  bodyState: { fatigue: 0.8, cognitiveLoad: 0.8 }, maxEvidence: 1 };
const frame = buildCharacterPerceptionFrame(options);
assert.ok(frame.noticedEvidence.some(row => row.noticedFeature.includes("半步")), "a fresh directed question must survive competing sword/background salience");
assert.ok(frame.noticedEvidence.some(row => row.noticedFeature.includes("招式")), "both incoming people must be presented, without selecting a reply target");
const deaf = buildCharacterPerceptionFrame({ ...options, profile: { ...options.profile, sensoryChannels: { sound: { availability: 0 } } } });
assert.ok(!deaf.noticedEvidence.some(row => row.modality === "sound"), "presentation protection must not bypass hearing loss");

const actor = createCharacterSessionActor({ characterId: "reader", runtimePort: createLocalCharacterRuntimePort({
  runTurn: async context => ({ characterId: context.characterId, agentTurnId: context.agentTurnId, actionAttempt: null,
    privateResult: { evidencePresentation: { presentedEvidenceIds: ["message:one"], expiredEvidenceIds: [] } } }),
}) });
await actor.enqueueWake({ wakeId: "bundled", kind: "world_evidence", evidenceIds: ["message:one", "message:two"],
  evidence: [{ evidenceId: "message:one", content: "first" }, { evidenceId: "message:two", content: "second", occurredAtSeconds: 7 }] });
await actor.runNextTurn({ situationProjection: { authority: "recipient-specific-world-projection", recipientCharacterId: "reader", evidence: actor.mailbox[0].evidence } });
assert.deepEqual(actor.mailbox[0]?.evidenceIds, ["message:two"], "an unpresented message stays pending instead of disappearing with its batch");
assert.equal(actor.mailbox[0].evidence[0].occurredAtSeconds, 7, "deferred evidence keeps its original time");
assert.ok(!actor.seenWakeIds.has("bundled"), "a partially consumed bundle is not marked fully handled");
await actor.close();
console.log("Message presentation contracts passed: both direct speakers, sensory limits, partial bundle retention and original timestamps.");
