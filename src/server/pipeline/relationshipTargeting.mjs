function number(value) {
  return Number(value || 0);
}

export function relationshipPressureProfile(rel = null) {
  if (!rel) return { dominant: "none", score: 0 };
  const hostility = number(rel.resentment) + number(rel.revenge) + number(rel.jealousy);
  const protection = number(rel.protection) + number(rel.dependence) + number(rel.love);
  const avoidance = number(rel.fear) + number(rel.wantsToEscape) + number(rel.deception);
  const approach = number(rel.attraction) + number(rel.wantsToBeSeen) + number(rel.dependence);
  const ranked = [
    ["hostility", hostility],
    ["protection", protection],
    ["avoidance", avoidance],
    ["approach", approach],
  ].sort((a, b) => b[1] - a[1]);
  return { dominant: ranked[0]?.[0] || "none", score: ranked[0]?.[1] || 0, hostility, protection, avoidance, approach };
}

export function relationshipIntensityScore(rel = null) {
  if (!rel) return 0;
  const profile = relationshipPressureProfile(rel);
  return number(profile.score)
    + number(rel.resentment) * 0.4
    + number(rel.fear) * 0.35
    + number(rel.dependence) * 0.3
    + number(rel.wantsToBeSeen) * 0.25;
}

export function targetFor(character, compact = {}) {
  const activeIds = compact.activeCharacterIds || [];
  const relationships = (compact.relationships || [])
    .filter((rel) => rel.fromCharacterId === character.id && activeIds.includes(rel.toCharacterId))
    .sort((a, b) => relationshipIntensityScore(b) - relationshipIntensityScore(a));
  if (relationships[0]) return relationships[0].toCharacterId;
  return (compact.activeCharacters || []).find((item) => item.id !== character.id)?.id || character.id;
}

export function forbiddenTargetNames(compact = {}, characterId = "", targetId = "") {
  return (compact.activeCharacters || [])
    .filter((item) => item.id && item.id !== characterId && item.id !== targetId)
    .flatMap((item) => [item.name, item.id])
    .filter(Boolean);
}

export function retargetTextToLockedTarget(text = "", { targetName = "", forbiddenNames = [] } = {}) {
  const raw = String(text || "");
  if (!raw || !targetName) return raw;
  const staleName = (forbiddenNames || []).find((name) => name && raw.includes(name));
  if (!staleName) return raw;
  return raw.split(staleName).join(targetName);
}
