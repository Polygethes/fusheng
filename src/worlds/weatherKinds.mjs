// The world's weather, one table for the world (what people outdoors notice,
// how light and loud it is, how a person would put the weather right now),
// for 天意's buttons and for the stage.
export const WEATHER_KINDS = Object.freeze([
  { id: "clear", label: "放晴", content: "天放晴了。", now: "天晴着，没有雨", light: 0.8, ambientNoise: 0.2 },
  { id: "rain", label: "下雨", content: "下起雨来了，雨点打在身上。", now: "下着雨", light: 0.55, ambientNoise: 0.45 },
  { id: "storm", label: "暴雨", content: "暴雨倾盆，雷声从山那边滚过来。", now: "下着暴雨，雷声一阵阵", light: 0.35, ambientNoise: 0.75 },
  { id: "fog", label: "起雾", content: "起雾了，远处的东西看不清了。", now: "起着雾，没有雨", light: 0.45, ambientNoise: 0.2 },
  { id: "wind", label: "刮风", content: "起风了，吹得檐下的东西直响。", now: "刮着风，没有雨", light: 0.7, ambientNoise: 0.5 },
  { id: "heat", label: "烈日", content: "日头毒辣，晒得人发昏。", now: "日头毒辣", light: 0.95, ambientNoise: 0.2 },
  { id: "drought", label: "干旱", content: "好些天没下雨了，地上干得裂开了口子。", now: "天旱，好些天没下过雨", light: 0.9, ambientNoise: 0.15 },
  { id: "snow", label: "下雪", content: "下雪了，雪花落在身上。", now: "下着雪", light: 0.6, ambientNoise: 0.1 },
  { id: "blizzard", label: "暴雪", content: "刮起了暴风雪，雪粒打得人睁不开眼。", now: "刮着暴风雪", light: 0.3, ambientNoise: 0.6 },
].map((row) => Object.freeze(row)));
export const WEATHER_IDS = Object.freeze(WEATHER_KINDS.map((row) => row.id));
