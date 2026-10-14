// The conditions around a person, as they can tell them right now: the
// weather (stood in out of doors, seen and heard through the walls indoors),
// water underfoot, mud, snow, dry earth, how the stream runs if it is in
// sight, the roar of a flood heard from inside. One place turns the world's
// standing state into what each person perceives; nothing here is a change
// (changes arrive as events), only how things are.
import { WEATHER_KINDS } from "../../worlds/weatherKinds.mjs";
import { zoneFlooded } from "./worldEnvironment.mjs";

const clean = (value) => String(value ?? "").trim();
const outdoorsIn = (place = {}, zoneId = "") => {
  const id = clean(zoneId);
  if (!id.includes("__")) return true;
  return clean((place.sites || []).find((row) => clean(row.id) === id.split("__")[0])?.kind) !== "building";
};
// How far from open water (in tiles) a person out of doors can see the stream.
const STREAM_IN_SIGHT = 12;
const SNOW = { dusting: "薄薄一层", ankle: "没过脚面", deep: "没过小腿" };
const GROUND = { muddy: "地上泥泞", puddles: "到处是水洼", waterlogged: "低处积满了水" };
const DRYNESS = { dry: "干得发白，起了浮土", parched: "干裂了口子，草都蔫了" };
const STREAM = { low: "浅得见了底", high: "涨得很高，哗哗作响", flood: "漫过了岸，岸边一片汪洋", deluge: "山洪滚滚，浑水冲上了路" };

/** [{ kind, text, deep? }] in a fixed order: weather, water here, the ground, the earth, the stream, a flood heard. */
export function perceivedConditions({ place = {}, zoneId = "" } = {}) {
  const lines = [];
  const add = (kind, text) => lines.push({ kind, text });
  const outdoors = outdoorsIn(place, zoneId);
  const now = WEATHER_KINDS.find((row) => row.id === clean(place.perceptionEnvironment?.weather))?.now;
  if (now && Array.isArray(place.sites)) add("weather", outdoors ? `天色：${now}。` : `屋外${now}。`);
  const environment = place.environment;
  if (!environment?.stages) return lines;
  const { stream, ground, snow, dryness } = environment.stages;
  const zone = place.topology?.zones?.[clean(zoneId)] || {};
  // Knee-deep in a deluge is deep enough to drown someone lying in it.
  if (zoneFlooded(environment, zone)) lines.push({ kind: "flood_here", text: `这里进了水，积水${stream === "deluge" ? "没过了膝盖" : "没过了脚踝"}。`, ...(stream === "deluge" ? { deep: true } : {}) });
  if (outdoors) {
    if (SNOW[snow]) add("snow", `地上积雪：${SNOW[snow]}。`);
    else if (GROUND[ground]) add("ground", `脚下：${GROUND[ground]}。`);
    if (DRYNESS[dryness]) add("dryness", `土地：${DRYNESS[dryness]}。`);
    if (STREAM[stream] && Number(zone.waterDistance) <= STREAM_IN_SIGHT) add("stream", `溪水：${STREAM[stream]}。`);
  } else if (stream === "deluge") add("flood_heard", "屋外传来山洪的轰响。");
  return lines;
}
