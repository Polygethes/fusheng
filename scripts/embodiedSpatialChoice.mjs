import assert from "node:assert/strict";
import {
  auditEmbodiedSpatialChoiceInput,
  buildEmbodiedSpatialChoiceTool,
  compileEmbodiedPositionAffordances,
} from "../src/server/simulation/embodiedSpatialChoice.mjs";
import {
  applyObjectOperations,
  normalizeObjectLedger,
  relocateHeldObjects,
  validateObjectOperations,
} from "../src/server/simulation/objectLedger.mjs";

const ACTOR = "char_probe_sword_disciple";
const SWORD = "object_probe_worn_sword";
const OTHER = "char_probe_other";

function spatialInput() {
  return {
    actorId: ACTOR,
    currentPosition: { id: "position:threshold", zoneId: "threshold" },
    positionOptions: [
      {
        id: "position:side-wall-table",
        label: "侧墙空桌",
        zoneId: "hall",
        available: true,
        metrics: {
          informationAccess: [0.72, 0.88],
          visualCoverage: [0.7, 0.86],
          socialExposure: [0.25, 0.42],
          approachability: [0.2, 0.38],
          trafficInterference: [0.08, 0.22],
          movementClearance: [0.7, 0.88],
          exitAccess: [0.5, 0.68],
          comfort: [0.38, 0.58],
        },
        objectClearance: [{ objectId: SWORD, range: [0.74, 0.9] }],
        observableFeatures: ["侧墙在背后", "能看见门槛和柜台", "不在传菜动线上"],
      },
      {
        id: "position:center-table",
        label: "堂中空桌",
        zoneId: "hall",
        available: true,
        metrics: {
          informationAccess: [0.82, 0.94],
          visualCoverage: [0.76, 0.9],
          socialExposure: [0.76, 0.9],
          approachability: [0.72, 0.88],
          trafficInterference: [0.62, 0.8],
          movementClearance: [0.5, 0.68],
          exitAccess: [0.42, 0.58],
          comfort: [0.55, 0.7],
        },
        objectClearance: [{ objectId: SWORD, range: [0.45, 0.62] }],
        observableFeatures: ["堂中谈话最清楚", "四面都可能有人经过", "容易被在座客人注意"],
      },
      {
        id: "position:near-counter",
        label: "近柜台空位",
        zoneId: "hall",
        available: true,
        metrics: {
          informationAccess: [0.78, 0.92],
          visualCoverage: [0.62, 0.78],
          socialExposure: [0.58, 0.74],
          approachability: [0.62, 0.8],
          trafficInterference: [0.52, 0.7],
          movementClearance: [0.46, 0.64],
          exitAccess: [0.34, 0.5],
          comfort: [0.42, 0.6],
        },
        objectClearance: [{ objectId: SWORD, range: [0.48, 0.66] }],
        observableFeatures: ["容易听见柜台交谈", "经营者容易主动询问", "取送物品的人会经过"],
      },
      {
        id: "position:household-work-area",
        label: "家用工作区内侧",
        zoneId: "household-work-area",
        available: true,
        metrics: {
          informationAccess: [0.82, 0.94],
          visualCoverage: [0.82, 0.94],
          socialExposure: [0.84, 0.96],
          approachability: [0.64, 0.82],
          trafficInterference: [0.3, 0.48],
          movementClearance: [0.64, 0.82],
          exitAccess: [0.48, 0.66],
          comfort: [0.08, 0.24],
        },
        objectClearance: [{ objectId: SWORD, range: [0.68, 0.84] }],
        observableFeatures: ["通道没有上锁", "这是经营者的家用工作区"],
        socialAccess: {
          physicallyAttemptable: true,
          permissionRequiredByNorm: true,
          permissionCurrentlyGranted: false,
          violationPhysicallyPossible: true,
          evidenceIds: ["fact:household-work-area-access-norm"],
          possibleResponseTags: ["ignore", "question", "warn", "intervene"],
        },
      },
    ],
    carriedObjects: [{
      id: SWORD,
      holderActorId: ACTOR,
      portable: true,
      attachment: {
        active: true,
        actorId: ACTOR,
        mode: "worn_on_body",
        transitionRequiresExplicitOperation: true,
      },
      state: { sheathed: true },
    }],
  };
}

const validAudit = auditEmbodiedSpatialChoiceInput(spatialInput());
assert.equal(validAudit.valid, true, JSON.stringify(validAudit.errors));

const affordances = compileEmbodiedPositionAffordances(spatialInput());
assert.equal(affordances.length, 4);
assert.ok(affordances.every((row) => row.type === "move" && row.destinationPositionId));
assert.ok(affordances.every((row) => row.targetCharacterId === ""));
assert.ok(affordances.every((row) => row.effects.includes("人物的贴身附着物保持附着并随人物一起移动")));
assert.doesNotMatch(JSON.stringify(affordances), /preferred|recommend|expected|chosen|score|rank/iu);

const householdEntry = affordances.find((row) => row.destinationPositionId === "position:household-work-area");
assert.equal(householdEntry.socialAccess.physicallyAttemptable, true);
assert.equal(householdEntry.socialAccess.permissionCurrentlyGranted, false);
assert.equal(householdEntry.socialAccess.violationPhysicallyPossible, true);
assert.ok(householdEntry.preconditions.some((row) => row.includes("不等于已经得到进入许可")));
assert.ok(householdEntry.effects.some((row) => row.includes("他人是否回应仍由其本人决定")));

const contradictorySocialAccess = structuredClone(spatialInput());
contradictorySocialAccess.positionOptions[3].socialAccess.violationPhysicallyPossible = false;
const contradictoryAccessAudit = auditEmbodiedSpatialChoiceInput(contradictorySocialAccess);
assert.equal(contradictoryAccessAudit.valid, false);
assert.ok(contradictoryAccessAudit.errors.some((row) => row.code === "SPATIAL_SOCIAL_ACCESS_CONTRADICTION"));

const poisoned = structuredClone(spatialInput());
poisoned.positionOptions[0].preferredByCharacterId = ACTOR;
poisoned.positionOptions[0].expectedChoice = true;
const poisonedAudit = auditEmbodiedSpatialChoiceInput(poisoned);
assert.equal(poisonedAudit.valid, false);
assert.ok(poisonedAudit.errors.some((row) => row.code === "SPATIAL_CHOICE_AUTHOR_ANSWER_LEAK"));

const mismatchedAttachment = structuredClone(spatialInput());
mismatchedAttachment.carriedObjects[0].attachment.actorId = OTHER;
const mismatchedAudit = auditEmbodiedSpatialChoiceInput(mismatchedAttachment);
assert.equal(mismatchedAudit.valid, false);
assert.ok(mismatchedAudit.errors.some((row) => row.code === "SPATIAL_ATTACHMENT_ACTOR_MISMATCH"));

const tool = buildEmbodiedSpatialChoiceTool();
assert.equal(tool.choiceAuthority, "character-agent");
assert.match(tool.qualitativeFormula, /competenceFit/u);
assert.match(tool.qualitativeFormula, /trafficInterference/u);
assert.doesNotMatch(JSON.stringify(tool), /preferredPosition|chosenPosition|expectedChoice/iu);

const topology = {
  zones: [
    { id: "threshold", sceneId: "scene_probe" },
    { id: "hall", sceneId: "scene_probe" },
  ],
};
const actors = [
  { characterId: ACTOR, present: true, sceneId: "scene_probe", zoneId: "threshold" },
  { characterId: OTHER, present: true, sceneId: "scene_probe", zoneId: "threshold" },
];
const ledger = normalizeObjectLedger({ schemaVersion: 1, objects: spatialInput().carriedObjects });
assert.equal(ledger.objects[SWORD].attachment.active, true);
assert.equal(ledger.objects[SWORD].attachment.actorId, ACTOR);

for (const operation of [
  { type: "place", objectId: SWORD, actorId: ACTOR, zoneId: "threshold" },
  { type: "transfer", objectId: SWORD, actorId: ACTOR, toHolderActorId: OTHER },
]) {
  const result = validateObjectOperations({ ledger, operations: [operation], actors, topology });
  assert.equal(result.valid, false);
  assert.equal(result.violations[0]?.code, "OBJECT_ATTACHED_TO_ACTOR");
}

const implicitDetach = validateObjectOperations({
  ledger,
  operations: [{ type: "detach", objectId: SWORD, actorId: ACTOR }],
  actors,
  topology,
});
assert.equal(implicitDetach.valid, false);
assert.equal(implicitDetach.violations[0]?.code, "OBJECT_ATTACHMENT_TRANSITION_NOT_EXPLICIT");

const detachedAndPlaced = applyObjectOperations({
  ledger,
  operations: [
    {
      type: "detach",
      objectId: SWORD,
      actorId: ACTOR,
      affordanceId: "affordance:explicitly-detach-worn-object",
    },
    { type: "place", objectId: SWORD, actorId: ACTOR, zoneId: "threshold" },
  ],
  actors,
  topology,
});
assert.equal(detachedAndPlaced.applied, true, JSON.stringify(detachedAndPlaced.violations));
assert.equal(detachedAndPlaced.ledger.objects[SWORD].attachment.active, false);
assert.equal(detachedAndPlaced.ledger.objects[SWORD].holderActorId, "");

const relocated = relocateHeldObjects({
  ledger,
  actorId: ACTOR,
  sceneId: "scene_probe",
  zoneId: "hall",
});
assert.equal(relocated.objects[SWORD].zoneId, "hall");
assert.equal(relocated.objects[SWORD].attachment.active, true);
assert.equal(relocated.objects[SWORD].attachment.actorId, ACTOR);

console.log("embodiedSpatialChoice:test passed", {
  positionOptions: spatialInput().positionOptions.length,
  noPreselectedPosition: true,
  explicitAttachmentTransitions: true,
  socialPermissionDoesNotReplacePhysicalAttemptability: true,
});
