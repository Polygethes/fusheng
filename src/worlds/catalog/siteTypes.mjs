// Standard site types catalog for Character Town
// Every building defines rooms, links, objects, work templates, and interior template references.

function deepFreeze(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    deepFreeze(obj[key]);
  }
  return obj;
}

const RAW_SITE_TYPES = {
  // --- 建筑 ---
  home: {
    kind: "building",
    label: "住宅",
    footprint: [6, 5],
    rooms: [
      { suffix: "hall", label: "堂屋", entry: true },
      { suffix: "bedroom", label: "卧房", perResidents: 2 },
      { suffix: "kitchen", label: "灶间" },
    ],
    links: [
      ["hall", "bedroom*"],
      ["hall", "kitchen"],
    ],
    objects: [
      { slug: "stove", label: "灶台", room: "kitchen", portable: false, state: { lit: false, meals: 0 } },
      { slug: "water_jar", label: "水缸", room: "kitchen", portable: false, state: { water: 2, capacity: 4 } },
      { slug: "bucket", label: "木桶", room: "kitchen", portable: true, state: { water: 0, capacity: 1 } },
    ],
    work: [
      {
        templateId: "cook_meal",
        taskLabel: "做一顿饭",
        unitAction: "做好一顿饭",
        room: "kitchen",
        requiredUnits: 1,
        unitLabel: "顿饭",
        requiredSkillIds: ["cooking"],
        objectSlugs: ["stove", "water_jar"],
        toolSlugs: [],
        durationSecondsPerUnit: 1200,
        effects: [{ slug: "stove", path: ["lit"], set: true }, { slug: "stove", path: ["meals"], increment: 4 }],
        sound: "灶间传来锅铲声。",
      },
      {
        templateId: "light_stove",
        taskLabel: "生火",
        unitAction: "把灶火生起来",
        room: "kitchen",
        requiredUnits: 1,
        unitLabel: "灶火",
        requiredSkillIds: [],
        objectSlugs: ["stove"],
        toolSlugs: [],
        durationSecondsPerUnit: 600,
        effects: [{ slug: "stove", path: ["lit"], set: true }],
        until: { slug: "stove", path: ["lit"] },
        sound: "灶膛里噼啪一声，火苗窜了起来。",
      },
    ],
    interiorTemplates: ["home_a", "home_b"],
  },

  smithy: {
    kind: "building",
    label: "铁匠铺",
    footprint: [7, 5],
    rooms: [
      { suffix: "shop", label: "铺面", entry: true },
      { suffix: "forge", label: "炉间" },
    ],
    links: [["shop", "forge"]],
    objects: [
      { slug: "anvil", label: "铁砧", room: "forge", portable: false, state: { ready: true } },
      { slug: "furnace", label: "风箱熔炉", room: "forge", portable: false, state: { fire: false } },
    ],
    work: [
      {
        templateId: "forge_tool",
        taskLabel: "打制铁具",
        unitAction: "打好一把铁具",
        room: "forge",
        requiredUnits: 1,
        unitLabel: "件",
        requiredSkillIds: ["smithing"],
        objectSlugs: ["anvil", "furnace"],
        toolSlugs: [],
        durationSecondsPerUnit: 1800,
        effects: [{ slug: "furnace", path: ["fire"], set: true }],
        sound: "炉间传来叮当的打铁声。",
      },
    ],
    interiorTemplates: ["smithy_a"],
  },

  inn: {
    kind: "building",
    label: "客栈",
    footprint: [9, 7],
    rooms: [
      { suffix: "lobby", label: "大堂", entry: true },
      { suffix: "kitchen", label: "后厨" },
      { suffix: "room_1", label: "东客房" },
    ],
    links: [
      ["lobby", "kitchen"],
      ["lobby", "room_1"],
    ],
    objects: [
      { slug: "counter", label: "柜台", room: "lobby", portable: false, state: {} },
      { slug: "tea_pot", label: "茶壶", room: "lobby", portable: true, state: { tea: 4 } },
      { slug: "large_stove", label: "大灶", room: "kitchen", portable: false, state: { lit: false } },
    ],
    work: [
      {
        templateId: "brew_tea_serve",
        taskLabel: "沏茶迎客",
        unitAction: "备好茶水",
        room: "lobby",
        requiredUnits: 1,
        unitLabel: "壶",
        requiredSkillIds: [],
        objectSlugs: ["counter", "tea_pot"],
        toolSlugs: [],
        durationSecondsPerUnit: 600,
        effects: [{ slug: "tea_pot", path: ["tea"], set: 4 }],
        sound: "大堂里传来碗碟茶盏的清脆响声。",
      },
    ],
    interiorTemplates: ["inn_a"],
  },

  shop: {
    kind: "building",
    label: "杂货铺",
    footprint: [6, 5],
    rooms: [
      { suffix: "front", label: "店面", entry: true },
      { suffix: "storage", label: "货仓" },
    ],
    links: [["front", "storage"]],
    objects: [
      { slug: "counter", label: "柜台", room: "front", portable: false, state: {} },
      { slug: "goods_shelf", label: "货架", room: "storage", portable: false, state: {} },
    ],
    work: [
      {
        templateId: "tidy_goods",
        taskLabel: "打理货物",
        unitAction: "理好一排货架",
        room: "front",
        requiredUnits: 1,
        unitLabel: "次",
        requiredSkillIds: [],
        objectSlugs: ["counter"],
        toolSlugs: [],
        durationSecondsPerUnit: 900,
        effects: [],
        sound: "店里传来翻动货架的轻响。",
      },
    ],
    interiorTemplates: ["shop_a"],
  },

  herb_shop: {
    kind: "building",
    label: "药铺",
    footprint: [7, 5],
    rooms: [
      { suffix: "front", label: "铺面", entry: true },
      { suffix: "dispensary", label: "药房" },
      { suffix: "hall", label: "后进堂屋" },
      { suffix: "bedroom", label: "后进卧房", perResidents: 2 },
    ],
    links: [
      ["front", "dispensary"],
      ["front", "hall"],
      ["hall", "bedroom*"],
    ],
    objects: [
      { slug: "medicine_cabinet", label: "百味药柜", room: "dispensary", portable: false, state: { stocked: true } },
      { slug: "mortar", label: "药碾与石臼", room: "dispensary", portable: true, state: {} },
    ],
    work: [
      {
        templateId: "dispense_medicine",
        taskLabel: "配药",
        unitAction: "包好一副药",
        room: "dispensary",
        requiredUnits: 1,
        unitLabel: "包",
        requiredSkillIds: ["herbalism"],
        objectSlugs: ["medicine_cabinet", "mortar"],
        toolSlugs: [],
        durationSecondsPerUnit: 1200,
        effects: [{ slug: "medicine_cabinet", path: ["stocked"], set: true }],
        sound: "药房里传来药碾滚动的细细沙沙声。",
      },
    ],
    interiorTemplates: ["herb_shop_a"],
  },

  clinic: {
    kind: "building",
    label: "医馆",
    footprint: [7, 6],
    rooms: [
      { suffix: "hall", label: "诊堂", entry: true },
      { suffix: "ward", label: "静室病榻" },
    ],
    links: [["hall", "ward"]],
    objects: [
      { slug: "pulse_pillow", label: "脉枕", room: "hall", portable: true, state: {} },
      { slug: "bed", label: "病榻", room: "ward", portable: false, state: {} },
    ],
    work: [
      {
        templateId: "consult_patient",
        taskLabel: "切脉看诊",
        unitAction: "看好一名病患",
        room: "hall",
        requiredUnits: 1,
        unitLabel: "次",
        requiredSkillIds: ["medicine"],
        objectSlugs: ["pulse_pillow"],
        toolSlugs: [],
        durationSecondsPerUnit: 1200,
        effects: [],
        sound: "诊堂里传来温和的询问切脉声。",
      },
    ],
    interiorTemplates: ["clinic_a"],
  },

  temple: {
    kind: "building",
    label: "土地庙 / 寺庙",
    footprint: [6, 6],
    rooms: [
      { suffix: "main_hall", label: "正殿", entry: true },
      { suffix: "side_room", label: "配房" },
    ],
    links: [["main_hall", "side_room"]],
    objects: [
      { slug: "incense_burner", label: "香炉", room: "main_hall", portable: false, state: { lit: true } },
    ],
    work: [
      {
        templateId: "light_incense",
        taskLabel: "敬香祈福",
        unitAction: "点上一炷香",
        room: "main_hall",
        requiredUnits: 1,
        unitLabel: "炷",
        requiredSkillIds: [],
        objectSlugs: ["incense_burner"],
        toolSlugs: [],
        durationSecondsPerUnit: 600,
        effects: [{ slug: "incense_burner", path: ["lit"], set: true }],
        sound: "庙里传来悠远的铜馨声。",
      },
    ],
    interiorTemplates: ["temple_a"],
  },

  school: {
    kind: "building",
    label: "私塾 / 学堂",
    footprint: [7, 5],
    rooms: [
      { suffix: "classroom", label: "讲堂", entry: true },
      { suffix: "study", label: "书房" },
    ],
    links: [["classroom", "study"]],
    objects: [
      { slug: "lectern", label: "讲台桌案", room: "classroom", portable: false, state: {} },
      { slug: "bookshelf", label: "书架", room: "study", portable: false, state: {} },
    ],
    work: [
      {
        templateId: "teach_recite",
        taskLabel: "授课领读",
        unitAction: "讲完一节书",
        room: "classroom",
        requiredUnits: 1,
        unitLabel: "节",
        requiredSkillIds: ["reading"],
        objectSlugs: ["lectern"],
        toolSlugs: [],
        durationSecondsPerUnit: 1800,
        effects: [],
        sound: "讲堂里传来朗朗的读书声。",
      },
    ],
    interiorTemplates: ["school_a"],
  },

  farmhouse: {
    kind: "building",
    label: "农家院",
    footprint: [6, 5],
    rooms: [
      { suffix: "hall", label: "堂屋", entry: true },
      { suffix: "bedroom", label: "卧房", perResidents: 2 },
      { suffix: "barn", label: "柴料谷仓" },
    ],
    links: [
      ["hall", "bedroom*"],
      ["hall", "barn"],
    ],
    objects: [
      { slug: "grain_bin", label: "粮囤", room: "barn", portable: false, state: { full: true } },
      { slug: "hoe", label: "铁锄", room: "barn", portable: true, state: {} },
    ],
    work: [
      {
        templateId: "sort_grain",
        taskLabel: "晾晒筛粮",
        unitAction: "筛好一筐谷子",
        room: "barn",
        requiredUnits: 1,
        unitLabel: "筐",
        requiredSkillIds: ["farming"],
        objectSlugs: ["grain_bin"],
        toolSlugs: ["hoe"],
        durationSecondsPerUnit: 1200,
        effects: [],
        sound: "柴谷房里传来竹簸箕筛粮的扑棱响声。",
      },
    ],
    interiorTemplates: ["farmhouse_a"],
  },

  mill: {
    kind: "building",
    label: "磨坊",
    footprint: [6, 6],
    rooms: [
      { suffix: "mill_room", label: "磨房", entry: true },
    ],
    links: [],
    objects: [
      { slug: "millstone", label: "石磨", room: "mill_room", portable: false, state: { ready: true } },
    ],
    work: [
      {
        templateId: "grind_flour",
        taskLabel: "磨面磨谷",
        unitAction: "磨好一袋面",
        room: "mill_room",
        requiredUnits: 1,
        unitLabel: "袋",
        requiredSkillIds: ["farming"],
        objectSlugs: ["millstone"],
        toolSlugs: [],
        durationSecondsPerUnit: 1800,
        effects: [],
        sound: "磨房里石磨隆隆转动。",
      },
    ],
    interiorTemplates: ["mill_a"],
  },

  post: {
    kind: "building",
    label: "驿站 / 邮亭",
    footprint: [6, 5],
    rooms: [
      { suffix: "hall", label: "正厅", entry: true },
      { suffix: "mail_room", label: "信件房" },
    ],
    links: [["hall", "mail_room"]],
    objects: [
      { slug: "mail_box", label: "信匣柜", room: "mail_room", portable: false, state: {} },
    ],
    work: [
      {
        templateId: "sort_letters",
        taskLabel: "分拣书信",
        unitAction: "点验一批口信文书",
        room: "mail_room",
        requiredUnits: 1,
        unitLabel: "批",
        requiredSkillIds: ["reading"],
        objectSlugs: ["mail_box"],
        toolSlugs: [],
        durationSecondsPerUnit: 900,
        effects: [],
        sound: "信件房传来纸封翻动的声音。",
      },
    ],
    interiorTemplates: ["post_a"],
  },

  // --- 室外地点 ---
  square: {
    kind: "outdoor",
    label: "晒谷场 / 广场",
    zones: [
      { suffix: "center", label: "广场中央" },
      { suffix: "edge", label: "场边槐树下" },
    ],
    objects: [],
    work: [
      {
        templateId: "watch_chess",
        taskLabel: "下棋闲坐",
        unitAction: "看完一盘棋",
        room: "edge",
        requiredUnits: 1,
        unitLabel: "盘",
        requiredSkillIds: [],
        objectSlugs: [],
        toolSlugs: [],
        durationSecondsPerUnit: 1200,
        effects: [],
        sound: "树下传来落子的嗒声与闲谈声。",
      },
    ],
    terrain: "square",
  },

  street: {
    kind: "outdoor",
    label: "街巷",
    zones: [
      { suffix: "main", label: "街心" },
    ],
    objects: [],
    work: [],
    terrain: "street",
  },

  market: {
    kind: "outdoor",
    label: "集市",
    zones: [
      { suffix: "stands", label: "摊位集市" },
    ],
    objects: [],
    work: [],
    terrain: "market",
  },

  well: {
    kind: "outdoor",
    label: "水井",
    zones: [
      { suffix: "rim", label: "井台" },
    ],
    objects: [
      { slug: "well_rope", label: "井绳吊桶", room: "rim", portable: false, state: { intact: true, source: "well" } },
    ],
    work: [
      {
        templateId: "draw_water",
        taskLabel: "井边打水",
        unitAction: "打上一担清水",
        room: "rim",
        requiredUnits: 1,
        unitLabel: "担",
        requiredSkillIds: [],
        objectSlugs: ["well_rope"],
        toolSlugs: [],
        durationSecondsPerUnit: 600,
        effects: [],
        sound: "井口传来辘轳转动和水桶出井的晃水声。",
      },
    ],
    terrain: "well",
  },

  field: {
    kind: "outdoor",
    label: "农田",
    zones: [
      { suffix: "path", label: "田埂" },
      { suffix: "crop", label: "地垄" },
    ],
    objects: [],
    work: [
      {
        templateId: "tend_field",
        taskLabel: "田间打理",
        unitAction: "锄完一段垄",
        room: "crop",
        requiredUnits: 1,
        unitLabel: "垄",
        requiredSkillIds: ["farming"],
        objectSlugs: [],
        toolSlugs: [],
        durationSecondsPerUnit: 1800,
        effects: [],
        sound: "田埂传来锄头翻泥的声音。",
      },
    ],
    terrain: "field",
  },

  forest: {
    kind: "outdoor",
    label: "林子",
    zones: [
      { suffix: "edge", label: "林边" },
      { suffix: "deep", label: "林子深处", moveFromEdge: 3 },
    ],
    objects: [],
    work: [
      {
        templateId: "forage_herbs",
        taskLabel: "进林采药",
        unitAction: "寻得一包鲜草",
        room: "edge",
        requiredUnits: 1,
        unitLabel: "株",
        requiredSkillIds: ["herbalism"],
        objectSlugs: [],
        toolSlugs: [],
        durationSecondsPerUnit: 1500,
        effects: [],
        sound: "竹林树丛里传来踩过枯枝落叶的沙沙声。",
      },
      {
        templateId: "cut_firewood",
        taskLabel: "砍柴劈枝",
        unitAction: "砍下一捆干柴",
        room: "deep",
        requiredUnits: 1,
        unitLabel: "捆",
        requiredSkillIds: ["woodcutting"],
        objectSlugs: [],
        toolSlugs: [],
        durationSecondsPerUnit: 1800,
        effects: [],
        sound: "林子深处传来笃笃的砍柴声。",
      },
    ],
    terrain: "forest",
  },

  river_bank: {
    kind: "outdoor",
    label: "河岸",
    zones: [
      { suffix: "bank", label: "岸边" },
    ],
    objects: [],
    work: [
      {
        templateId: "fishing_task",
        taskLabel: "水边垂钓",
        unitAction: "钓上一尾鲜鱼",
        room: "bank",
        requiredUnits: 1,
        unitLabel: "尾",
        requiredSkillIds: ["fishing"],
        objectSlugs: [],
        toolSlugs: [],
        durationSecondsPerUnit: 1800,
        effects: [],
        sound: "河滩传来水波荡漾与浮标轻拍水面的响动。",
      },
    ],
    terrain: "river",
  },

  bridge: {
    kind: "outdoor",
    label: "石桥",
    zones: [
      { suffix: "deck", label: "桥面" },
    ],
    objects: [],
    work: [],
    terrain: "bridge",
  },

  pond: {
    kind: "outdoor",
    label: "池塘",
    zones: [
      { suffix: "side", label: "塘畔" },
    ],
    objects: [],
    work: [],
    terrain: "pond",
  },

  hill: {
    kind: "outdoor",
    label: "山坡 / 高地",
    zones: [
      { suffix: "slope", label: "半山坡" },
      { suffix: "top", label: "山顶望台" },
    ],
    objects: [],
    work: [],
    terrain: "hills",
  },

  // A hillside array eye: the stones that keep a hidden valley hidden.
  array_eye: {
    kind: "outdoor",
    label: "阵眼",
    zones: [
      { suffix: "slope", label: "阵石坡" },
      { suffix: "eye", label: "阵眼石台", moveFromEdge: 2 },
    ],
    objects: [
      { slug: "eye_stone", label: "阵眼石", room: "eye", portable: false, state: { glow: 1 } },
    ],
    work: [
      {
        templateId: "mend_array_eye",
        taskLabel: "补阵眼",
        unitAction: "重刻一道熄灭的阵纹",
        room: "eye",
        requiredUnits: 1,
        unitLabel: "道阵纹",
        requiredSkillIds: ["arrays"],
        objectSlugs: ["eye_stone"],
        toolSlugs: [],
        durationSecondsPerUnit: 1500,
        effects: [],
        sound: "坡上传来刻刀刮过阵石的细响。",
      },
    ],
    terrain: "hills",
  },

  road_out: {
    kind: "outdoor",
    label: "出镇官道",
    zones: [
      { suffix: "gate", label: "镇口岔道" },
    ],
    objects: [],
    work: [],
    terrain: "road",
  },
};

export const SITE_TYPES = deepFreeze(RAW_SITE_TYPES);
