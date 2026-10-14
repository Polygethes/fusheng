import { objectVisibleToObserver } from "./objectLedger.mjs";

// These are directly inspectable physical properties, not arbitrary object
// state (identity, medical contents, contracts and hidden inventories).
const LABELS = Object.freeze({ fill: "装满比例", capacityBuckets: "容量（桶）", unprocessedBundles: "未加工柴束",
  processedBundles: "成柴束", contents: "容器内容", sheathed: "是否在鞘内", cleanEnough: "是否干净", lit: "是否点着",
  water: "水", capacity: "能装", meals: "做好的饭", tea: "茶" });

export function observeObjectPhysicalState(object = {}, observer = {}) {
  const owned = Boolean(observer.id) && object.holderCharacterId === observer.id;
  const nearby = Boolean(observer.placeId) && object.placeId === observer.placeId && object.zoneId === observer.zoneId;
  if ((!owned && !nearby) || !objectVisibleToObserver(object, observer.id, { defaultVisible: true })
    || object.custody?.storageMode === "packed") return {};
  return Object.fromEntries(Object.keys(LABELS).filter(key => Object.hasOwn(object.state || {}, key)
    && (key !== "contents" || Boolean(object.state.vesselType))
    && (!["contents", "fill", "water"].includes(key) || object.state.sealed !== true)
    && ["number", "boolean", "string"].includes(typeof object.state[key]))
    .map(key => [key, object.state[key]]));
}

export function describeObjectPhysicalState(state = {}) {
  // A vessel says how much water it holds out of how much it can hold.
  const vessel = Number.isFinite(Number(state.water)) && Number.isFinite(Number(state.capacity)) && Number(state.capacity) > 0;
  return Object.entries(state).filter(([key]) => Object.hasOwn(LABELS, key) && !(vessel && key === "capacity")).map(([key, value]) => {
    if (vessel && key === "water") {
      const water = Number(value), capacity = Number(state.capacity);
      return water > 0 ? `水：${water}/${capacity} 份${water >= capacity ? "（满了）" : ""}` : `水：空的（能装 ${capacity} 份）`;
    }
    if (key === "lit") return value === true ? "火：点着" : "火：没点";
    if (key === "meals") return Number(value) > 0 ? `做好的饭：${value} 份` : "锅里没有饭";
    if (key === "tea") return Number(value) > 0 ? `茶：还有 ${value} 碗` : "茶：喝完了";
    if (key === "capacity") return `能装 ${value} 份`;
    const text = key === "fill" ? `${Math.round(Number(value) * 100)}%`
      : value === "empty" ? "空" : value === true ? "是" : value === false ? "否" : String(value);
    return `${LABELS[key]}：${text}`;
  }).join("；");
}
