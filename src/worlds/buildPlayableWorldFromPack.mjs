import { buildPlayableWorldFromSetup } from "../worldbuilding/skills.js";
import { normalizeCharacterAgentMemoryState } from "../engine/characterAgentMemory.js";
import { TAVERN_RELATIONSHIP_METRICS } from "../server/ecology/tavernRelationshipDynamics.mjs";

const clone = (value) => (value === undefined ? undefined : structuredClone(value));
const DEFAULT_PERCEPTION = Object.freeze({
  schemaVersion: 1, authority: "world-state", light: 0.82, ambientNoise: 0.18,
  modalityTransmission: { visual: 1, sound: 1, smell: 1, touch: 1, vibration: 1, proprioception: 1 },
});

function genericCharacter(pack, member) {
  const firstDesire = member.ecologyProfile?.desires?.[0];
  const activity = member.currentActivity || {};
  return {
    id: member.id,
    projectId: `proj_${pack.meta.id}`,
    name: member.name,
    ...(Number.isFinite(member.age) ? { age: member.age } : {}),
    publicIdentity: { role: member.title, label: member.title },
    externalSituation: member.title,
    internalSituation: member.internalSituation || "",
    skills: [...(member.skills || [])],
    appearance: clone(member.appearance || {}),
    ...(member.voiceBlueprint ? { voiceBlueprint: clone(member.voiceBlueprint) } : {}),
    ...(member.voiceSamples ? { voiceSamples: [...member.voiceSamples] } : {}),
    title: member.title,
    ...(member.knownSiteIds ? { knownSiteIds: [...member.knownSiteIds] } : {}),
    ...(member.routineHabits ? { routineHabits: clone(member.routineHabits) } : {}),
    ...(member.languageUse ? { languageUse: clone(member.languageUse) } : {}),
    ecologyProfile: clone(member.ecologyProfile),
    ecologyProfileId: member.ecologyProfile?.characterId || member.id,
    psychologyAnchor: clone(member.psychologyAnchor || null),
    agentMemory: normalizeCharacterAgentMemoryState(clone(member.agentMemory || {}), member.id),
    lifeProfile: {
      simulationTier: pack.stage.sceneCast.includes(member.id) ? "core" : "visitor",
      role: member.title,
      privatePursuit: member.privatePursuit || firstDesire?.target?.label || "",
      commitments: clone(member.commitments || []),
      activities: { routine: activity.description || "" },
      knownActorIds: [...(member.knownActorIds || [])],
    },
    lifeState: {
      schemaVersion: 1,
      present: true,
      activeGoal: member.activeGoal || "",
      currentActivity: clone(activity),
      publicSignalFeatures: clone(member.publicSignalFeatures || []),
      knownActorIds: [...(member.knownActorIds || [])],
    },
    currentLocationId: pack.stage.placeId,
  };
}

function genericRelationship(pack, row, names) {
  const metrics = Object.fromEntries(TAVERN_RELATIONSHIP_METRICS.map((id) => [id, Number(row.metrics?.[id] ?? 0)]));
  return {
    id: `rel_${pack.meta.id}_${row.fromCharacterId}_to_${row.toCharacterId}`,
    projectId: `proj_${pack.meta.id}`,
    schemaVersion: 1,
    generatedFrom: "world-pack-directional-seed",
    fromCharacterId: row.fromCharacterId,
    toCharacterId: row.toCharacterId,
    fromCharacterName: names.get(row.fromCharacterId) || row.fromCharacterId,
    toCharacterName: names.get(row.toCharacterId) || row.toCharacterId,
    label: row.label,
    addressingRule: row.addressingRule || "",
    allowedAddresses: [...(row.allowedAddresses || [])],
    ...metrics,
    misreading: row.misreading || "",
    unspoken: row.unspoken || "",
    sourceSeedLabel: row.label,
    sourceSeedPressure: row.pressure || "",
    evidenceIds: [],
  };
}

/**
 * World pack → the playable state the v2.7 runtime consumes (characters,
 * relationships and the stage institution under `tavernState`). Packs that
 * carry `legacySetup` delegate to the authored blueprint builder so their
 * characters stay byte-identical.
 */
export function buildPlayableWorldFromPack(pack = {}) {
  if (pack.legacySetup) {
    return buildPlayableWorldFromSetup({
      setupWorldPrompt: pack.legacySetup.worldPrompt,
      setupPeoplePrompt: pack.legacySetup.peoplePrompt,
    });
  }
  const names = new Map(pack.cast.map((member) => [member.id, member.name]));
  const placeId = pack.stage.placeId;
  return {
    project: { id: `proj_${pack.meta.id}`, title: pack.meta.title, characterIds: pack.cast.map((member) => member.id) },
    worldSetup: { schemaVersion: 2, fixedStage: true, worldPackId: pack.meta.id, generatedBySkills: false },
    characters: pack.cast.map((member) => genericCharacter(pack, member)),
    locations: [{ id: placeId, name: pack.stage.name }],
    relationships: pack.relationships.map((row) => genericRelationship(pack, row, names)),
    tavernState: {
      schemaVersion: 9,
      locationId: placeId,
      perceptionEnvironment: clone(pack.stage.perceptionEnvironment || DEFAULT_PERCEPTION),
      stock: {},
      servicePreparationEnvironment: { stations: {} },
      institution: {
        name: pack.stage.name,
        householdName: pack.stage.householdName || "",
        offerings: {},
        serviceZones: [],
        guestPositions: clone(pack.positions),
        objectTemplates: clone(pack.objects),
        workOrderTemplates: clone(pack.work),
      },
    },
    characterMemories: [],
    characterPlans: [],
  };
}
