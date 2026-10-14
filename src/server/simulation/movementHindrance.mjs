// What water and snow do to a walk: a person cannot get through a flood
// right at the stream in a deluge; wading through floodwater or deep snow
// takes longer. Only the place being walked into counts.
import { zoneFlooded } from "./worldEnvironment.mjs";

const clean = (value) => String(value ?? "").trim();
const outdoorsIn = (place = {}, zoneId = "") => {
  const id = clean(zoneId);
  if (!id.includes("__")) return true;
  return clean((place.sites || []).find((row) => clean(row.id) === id.split("__")[0])?.kind) !== "building";
};

export const MOVE_BLOCKED_BY_FLOOD = "MOVE_BLOCKED_BY_FLOOD";

/** { blocked, slowdown, reason, note }: note is how the destination looks from here ("淹了水，过不去"). */
export function movementHindrance(place = {}, toZoneId = "") {
  const environment = place.environment;
  const zone = place.topology?.zones?.[clean(toZoneId)] || {};
  const none = { blocked: false, slowdown: 1, reason: "", note: "" };
  if (!environment?.stages) return none;
  if (zoneFlooded(environment, zone)) {
    if (environment.stages.stream === "deluge" && Number(zone.waterDistance) <= 1) return { blocked: true, slowdown: 1, reason: "floodwater", note: "淹了水，过不去" };
    return { blocked: false, slowdown: 3, reason: "floodwater", note: "积着水，得趟过去" };
  }
  if (outdoorsIn(place, toZoneId) && environment.stages.snow === "deep") return { blocked: false, slowdown: 2, reason: "snow", note: "雪深难走" };
  if (outdoorsIn(place, toZoneId) && environment.stages.snow === "ankle") return { blocked: false, slowdown: 1.5, reason: "snow", note: "" };
  return none;
}
