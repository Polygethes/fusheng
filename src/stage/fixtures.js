// A stove drawn on the map is a world object that is lit or not. This ties
// each stove prop, and the glow around it, to that object, so the fire and
// its light show only while the world says the stove is lit.
export function createFixtureFire(layout = {}) {
  const inside = ([x, y], [px, py, pw, ph], pad = 0) => x >= px - pad && x <= px + pw + pad && y >= py - pad && y <= py + ph + pad;
  const stoves = (layout.props || []).filter((row) => row.kind === "stove").map((prop) => {
    const rect = [prop.at[0], prop.at[1], prop.w || 2, prop.h || 1];
    const objectId = Object.entries(layout.objects || {}).find(([, spec]) => spec.zoneId === prop.zoneId && spec.at && inside(spec.at, rect))?.[0] || "";
    return { prop, rect, objectId };
  });
  const litOf = (stove, objects) => {
    const lit = objects?.[stove?.objectId]?.state?.lit;
    return typeof lit === "boolean" ? lit : true;
  };
  return {
    propLit: (objects) => (prop) => litOf(stoves.find((row) => row.prop === prop), objects),
    lightOn: (objects) => (light) => {
      const stove = light.flicker ? stoves.find((row) => inside(light.at, row.rect, 1)) : null;
      return stove ? litOf(stove, objects) : true;
    },
  };
}
