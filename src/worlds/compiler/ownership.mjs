// Who things belong to when the town is built: what someone carries in at the
// start is theirs; a portable thing in a household's home belongs to that
// household, and that room is where it belongs. Fixed things (a stove, an
// anvil) and things in common places (the shrine, the square, the well)
// belong to no one in particular.
const clean = (value) => String(value ?? "").trim();

/** { ownerIds, homeZoneId? } for a compiled object, or {} when it is no one's. */
export function objectOwnership(blueprint = {}, idMap = new Map(), { zoneId = "", holderCharacterId = "", portable = true } = {}) {
  if (portable === false) return {};
  if (clean(holderCharacterId)) return { ownerIds: [clean(holderCharacterId)] };
  const siteId = clean(zoneId).split("__")[0];
  const household = (blueprint.households || []).find((row) => clean(row.siteId) === siteId);
  if (!household) return {};
  const ownerIds = (blueprint.residents || []).filter((row) => clean(row.householdId) === clean(household.id))
    .map((row) => clean(idMap.get(row.id))).filter(Boolean);
  return ownerIds.length ? { ownerIds, homeZoneId: clean(zoneId) } : {};
}
