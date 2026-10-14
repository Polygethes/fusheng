import assert from "node:assert/strict";
import {
  compileEcologyProfile,
  getTavernEcologyProfile,
  validateEcologyProfile,
  validateTavernEcologyProfiles,
} from "../src/server/ecology/tavernEcologyProfile.mjs";
import {
  appraiseTavernAgentEcology,
  bindTavernAgentEcologyChoice,
  ensureTavernEcology,
} from "../src/server/pipeline/tavernEcologyRuntime.mjs";
import { applyTavernEcologyOutcome } from "../src/server/pipeline/tavernEcologyOutcome.mjs";
import { deriveDesireSatisfactionEffects } from "../src/server/simulation/desireSatisfaction.mjs";

const ferryman = {
  id: "agent_river_ferryman",
  name: "沈渡",
  desire: "在暴雨前亲手补好渡船破帆，让等候的人能够过河",
  visible: "检查帆绳、缝补裂口、试拉主帆",
  currentLocationId: "scene_river_ferry",
  traits: { persistence: 0.82, conscientiousness: 0.78, caution: 0.64 },
  lifeState: { present: true, zoneId: "ferry_deck" },
  sceneAgency: { standing: "ferrymaster" },
};

assert.equal(getTavernEcologyProfile(ferryman.id), null, "an id alone must not fabricate unknowable character data");
const profile = compileEcologyProfile(ferryman, {
  observationStageId: "scene_river_ferry",
  defaultZoneId: "ferry_deck",
});
assert.ok(profile, "an ordinary character record must compile into the shared ecology schema");
assert.equal(profile.characterId, ferryman.id);
assert.equal(profile.standing, "ferrymaster");
assert.equal(profile.observationStageId, "scene_river_ferry", "the compiler must retain the adapter observation stage");
assert.equal(profile.initialConditions.locationId, "scene_river_ferry");
assert.equal(profile.desires[0].polarity, "positive");
assert.match(profile.desires[0].desiredState.object, /补好渡船破帆/);
assert.deepEqual(profile.desires[0].actionOptions.map((option) => option.label), ["检查帆绳", "缝补裂口", "试拉主帆"]);
assert.deepEqual(validateEcologyProfile(profile), { valid: true, errors: [] });
assert.deepEqual(validateTavernEcologyProfiles({ [ferryman.id]: profile }), { valid: true, errors: [] },
  "custom worlds must not be rejected for lacking the authored tavern cast");

const ensured = ensureTavernEcology(ferryman, {
  present: true,
  zoneId: "ferry_deck",
  elapsedSeconds: 15,
});
assert.ok(ensured.profile && ensured.state, "an unregistered character must enter the runtime");

const runtime = {
  id: "scene_river_ferry",
  locationId: "scene_river_ferry",
  elapsedSeconds: 15,
  macroDay: 1,
  macroTick: 0,
  step: 0,
  slotContext: { slotId: "storm-watch", slotLabel: "暴雨前" },
  requestLocks: [],
  actions: [],
  agents: {
    [ferryman.id]: {
      characterId: ferryman.id,
      standing: "ferrymaster",
      present: true,
      zoneId: "ferry_deck",
    },
  },
};
const appraisal = appraiseTavernAgentEcology({
  character: ferryman,
  runtime,
  actor: runtime.agents[ferryman.id],
  pendingImpacts: [],
  visibleCharacterIds: [],
  availableAffordances: [],
  recentOwnActions: [],
  relationships: [],
});
assert.equal(appraisal?.selectedIntent, null, "the mathematical appraisal must not select the ferryman's action");
const repairCandidate = appraisal.candidates.find((candidate) => candidate.actionKind === "pursue_desired_state");
assert.ok(repairCandidate, "the generic profile must produce a real action candidate");
const chosenAppraisal = bindTavernAgentEcologyChoice(appraisal, repairCandidate.id);
assert.ok(chosenAppraisal?.selectedIntent, "the Character Agent must be able to bind its own chosen candidate");
assert.notEqual(chosenAppraisal.selectedIntent.actionKind, "advance_personal_goal");
assert.equal(chosenAppraisal.selectedIntent.actionKind, "pursue_desired_state");
assert.ok(chosenAppraisal.selectedIntent.realization.visibleActionHint, "the selected action must retain a concrete visible realization hint");
assert.deepEqual(
  chosenAppraisal.selectedIntent.satisfactionEvidence?.tags,
  [`goal:${ferryman.id}:primary`],
  "a generic selected action must carry explicit evidence for its own desired state",
);

const committedAction = {
  id: "action:ferry:repair-sail",
  committed: true,
  actorId: ferryman.id,
  actionKind: chosenAppraisal.selectedIntent.actionKind,
  satisfactionEvidence: structuredClone(chosenAppraisal.selectedIntent.satisfactionEvidence),
};
const desireEffects = deriveDesireSatisfactionEffects({
  desires: profile.desires,
  action: committedAction,
  ownerActorId: ferryman.id,
});
assert.equal(desireEffects.length, 1, "committed evidence must match the generic desire condition");
const afterAction = applyTavernEcologyOutcome({
  ecologyState: ensured.state,
  selectedCandidate: {
    ...chosenAppraisal.selectedIntent,
    driveId: profile.desires[0].id,
    desireId: profile.desires[0].id,
  },
  action: {
    ...committedAction,
    driveId: profile.desires[0].id,
    candidateId: chosenAppraisal.selectedIntent.id,
  },
  materialConsequence: {
    id: committedAction.id,
    status: "committed",
    desireEffects,
  },
  elapsedSeconds: 12,
});
assert.equal(afterAction.desires[profile.desires[0].id].satisfaction, 1,
  "generic action evidence must close the loop by satisfying the selected desire");
assert.equal(afterAction.currentIntention.sourceId, null,
  "verified satisfaction must close the completed intention instead of repeating it");

console.log("tavernPhase59GenericCharacterProfile:test passed", {
  characterId: profile.characterId,
  selectedAction: chosenAppraisal.selectedIntent.label,
  satisfaction: afterAction.desires[profile.desires[0].id].satisfaction,
  formulaVersion: appraisal.appraisal.actionUtilityFormulaVersion,
});
