// Turns a world pack's deadline definitions into the world state's temporal
// agenda. A deadline is a host-authored obligation with objective conditions;
// it never decides who acts on it.
function fault(code, message) {
  return Object.assign(new Error(message), { code });
}

export function instantiateWorldAgenda(items = [], characterIds = [], { openingAfterSeconds = 900, placeId = "" } = {}) {
  const present = new Set(characterIds);
  return items.map((item) => {
    const fromOpening = !Number.isFinite(item.due?.atSeconds);
    if (fromOpening && (!Number.isFinite(openingAfterSeconds) || openingAfterSeconds < 60 || openingAfterSeconds > 86400)) {
      throw fault("TAVERN_OPENING_TIME_INVALID", "Opening preparation time must be between 60 and 86400 seconds.");
    }
    const dueAtSeconds = fromOpening ? openingAfterSeconds : item.due.atSeconds;
    const row = {
      id: item.id,
      kind: item.kind,
      placeId: item.placeId || placeId,
      label: item.label,
      dueAtSeconds,
      warningAtSeconds: Math.max(0, dueAtSeconds - (item.warningLeadSeconds ?? 300)),
      status: "pending",
      warned: false,
      source: item.source,
      responsibleActorIds: characterIds.filter((id) => (item.responsibleActorIds || []).includes(id)),
      delayConsequence: item.delayConsequence,
      conditions: structuredClone(item.conditions || []),
    };
    if (Array.isArray(item.knownByActorIds)) row.knownByActorIds = item.knownByActorIds.filter((id) => present.has(id));
    return row;
  });
}
