function clamp(value, min = 0, max = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function score(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(numeric) : fallback;
}

function relationshipsForCharacter(relationships = [], characterId = "") {
  return relationships.filter((relationship) => (
    relationship?.fromCharacterId === characterId
    || relationship?.toCharacterId === characterId
  ));
}

function maxRelationshipScore(relationships = [], keys = []) {
  return relationships.reduce((highest, relationship) => Math.max(
    highest,
    ...keys.map((key) => score(relationship?.[key], 0)),
  ), 0);
}

function textValues(value) {
  if (Array.isArray(value)) return value.flatMap(textValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(textValues);
  return value === undefined || value === null ? [] : [String(value)];
}

function characterPressureBias(character = {}) {
  const text = [
    character.internalSituation?.inadmissibleDesire,
    character.internalSituation?.deepFear,
    character.actionLines?.desire,
    character.actionLines?.shadow,
    ...textValues(character.actionVerbs),
  ].filter(Boolean).join(" ");
  return /逃|离开|撤|躲|避|脱身|退路/.test(text) ? 8 : 0;
}

function characterDutyBias(character = {}) {
  const text = [
    character.publicIdentity,
    character.externalSituation?.currentDuty,
    character.actionLines?.visible,
    character.selfMyth,
    ...textValues(character.irreversibleBoundaries),
  ].filter(Boolean).join(" ");
  return /守|护|职责|必须|不能离|留住|看守|承担/.test(text) ? 10 : 0;
}

function destinationFor(simulation = {}, currentLocation = {}, availableLocations = []) {
  const alternatives = availableLocations.filter((location) => location?.id && location.id !== currentLocation?.id);
  return alternatives.find((location) => location.id === simulation.desiredDestinationId)
    || alternatives[0]
    || null;
}

export function resolvePresenceDecision({
  simulation = {},
  character = {},
  relationships = [],
  currentLocation = {},
  availableLocations = [],
} = {}) {
  const related = relationshipsForCharacter(relationships, simulation.characterId || character.id);
  const escapePressure = maxRelationshipScore(related, ["wantsToEscape", "fear"]);
  const attachment = maxRelationshipScore(related, ["dependence", "protection", "love"]);
  const urgency = score(simulation.exitUrgency, simulation.tone === "撤退" ? 68 : 20);
  const pressure = score(simulation.pressure, 50);
  const statedResistance = score(simulation.exitResistance, 50);
  const drive = clamp(
    urgency * 0.5
    + pressure * 0.25
    + escapePressure * 0.2
    + characterPressureBias(character),
  );
  const resistance = clamp(
    statedResistance * 0.65
    + attachment * 0.25
    + characterDutyBias(character),
  );
  const intendsToLeave = simulation.presenceIntent === "leave" || drive >= 68;
  const decision = intendsToLeave
    ? (drive >= resistance + 8 ? "leave" : "blocked")
    : "stay";
  const destination = decision === "leave"
    ? destinationFor(simulation, currentLocation, availableLocations)
    : null;

  return {
    characterId: simulation.characterId || character.id || "",
    characterName: simulation.characterName || character.name || simulation.characterId || character.id || "人物",
    decision: decision === "leave" && !destination ? "blocked" : decision,
    drive,
    resistance,
    trigger: String(simulation.exitTrigger || "").trim(),
    reason: String(simulation.exitReason || "").trim(),
    destinationId: destination?.id || "",
    destinationName: destination?.name || "",
    departureMethod: String(simulation.departureMethod || "").trim(),
  };
}

export function charactersAvailableAtLocation(characters = [], locationId = "") {
  return characters.filter((character) => (
    !character?.currentLocationId
    || character.currentLocationId === locationId
  ));
}
