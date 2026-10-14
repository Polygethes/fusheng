import {
  buildPlayableWorldFromBlueprint,
  buildPlayableWorldFromSetup,
  dramaticCharacterSkill,
  worldBuildingSkill,
} from "../../worldbuilding/skills.js";
import { callOpenAIJson } from "./responseClient.mjs";

const MODEL_SETUP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    world: {
      type: "object",
      additionalProperties: true,
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        townName: { type: "string" },
        genre: { type: "string" },
        summary: { type: "string" },
        timepoint: { type: "string" },
        era: { type: "string" },
        location: { type: "string" },
        background: { type: "string" },
        darknessLevel: { type: "number" },
        nobilityLevel: { type: "number" },
        publicRules: { type: "array", items: { type: "string" } },
        hiddenRules: { type: "array", items: { type: "string" } },
        powerCenters: { type: "array", items: { type: "string" } },
        recurringObjects: { type: "array", items: { type: "string" } },
        pressureClock: { type: "string" },
      },
    },
    characters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          publicIdentity: { type: "string" },
          desire: { type: "string" },
          shame: { type: "string" },
          visible: { type: "string" },
          defenseLanguage: { type: "array", minItems: 3, items: { type: "string" } },
        },
        required: ["name", "publicIdentity", "desire", "shame", "visible", "defenseLanguage"],
      },
    },
    locations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          visibleUse: { type: "string" },
          likelyEvents: { type: "array", items: { type: "string" } },
          subtext: { type: "string" },
        },
      },
    },
    relationships: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          fromName: { type: "string" },
          toName: { type: "string" },
          label: { type: "string" },
          pressure: { type: "string" },
        },
      },
    },
  },
  required: ["world", "characters", "locations", "relationships"],
};

function text(value = "", fallback = "") {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

function list(value = [], fallback = []) {
  const source = Array.isArray(value) ? value : [];
  const cleaned = source.map((item) => text(item)).filter(Boolean);
  return cleaned.length ? cleaned : fallback;
}

function clamp(value, fallback = 50) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function slug(value = "", fallback = "model_world") {
  const source = text(value, fallback);
  const ascii = source
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return ascii || fallback;
}

function stableId(prefix, value, index) {
  const id = slug(value, `${prefix}_${index + 1}`);
  return id.startsWith(`${prefix}_`) ? id : `${prefix}_${id}`;
}

function normalizeModelCharacter(character = {}, index = 0, world = {}) {
  const name = text(character.name, `人物${index + 1}`);
  const publicIdentity = text(character.publicIdentity, `${name}生活在${world.townName || world.title || "这个世界"}里，必须借公开身份行动。`);
  const desire = text(character.desire, `让别人承认自己在${world.townName || "这个世界"}里的位置。`);
  const shame = text(character.shame, "害怕自己只是被身份和资源支撑。");
  const visible = text(character.visible, "靠近、询问、扣住物件、改口、停下");
  const defenseLanguage = list(character.defenseLanguage, synthesizeDefenseLanguage({
    name,
    publicIdentity,
    desire,
    shame,
    visible,
    world,
    index,
  }));
  return {
    id: stableId("char", character.id || name, index),
    name,
    publicIdentity,
    desire,
    shame,
    visible,
    defenseLanguage,
  };
}

function synthesizeDefenseLanguage({ name = "人物", publicIdentity = "", desire = "", shame = "", world = {}, index = 0 } = {}) {
  const textBlock = `${name} ${publicIdentity} ${desire} ${shame}`;
  const objects = world.recurringObjects || [];
  const object = objects[index % Math.max(objects.length, 1)] || objects[0] || "凭证";
  const secondObject = objects[(index + 1) % Math.max(objects.length, 1)] || object;
  if (/走私|潜水|出闸|逃|欠债/.test(textBlock)) {
    return [
      `${object}可以留下，人先过闸。`,
      "我卖的是一条路，不是他们的命。",
      `${secondObject}别交给公司。`,
    ];
  }
  if (/圣女|祈祷|信徒|庇护|神圣/.test(textBlock)) {
    return [
      "祈祷舱里先给人留一口气。",
      `${object}不能替公司关门。`,
      "编号可以亮，人不能被拖走。",
    ];
  }
  if (/监察|税|公司|账本|配额|盖章|通行/.test(textBlock)) {
    return [
      `${object}先验章，再谈庇护。`,
      "欠税名单不能离开税务所。",
      `${secondObject}不是人情，是通行手续。`,
    ];
  }
  if (/工程|修理|闸|水压|阀/.test(textBlock)) {
    return [
      `${object}响之前，谁也别碰阀。`,
      "水压还没稳，通行章先放下。",
      "这不是故障，是有人把警铃提前接上了。",
    ];
  }
  if (/医生|医|血样|鱼人|诊|药/.test(textBlock)) {
    return [
      `诊床前先救人，再查${object}。`,
      `${secondObject}不是证物，还在流血。`,
      "灯关上之前，谁也别碰病人的袖口。",
    ];
  }
  return [
    `${object}先留在这里。`,
    `${secondObject}没有归属前，谁也别改口。`,
    `${world.powerCenters?.[index % Math.max(world.powerCenters.length, 1)] || world.townName || "这里"}还没盖下最后一道章。`,
  ];
}

function normalizeModelLocation(location = {}, index = 0, objects = []) {
  const name = text(location.name, `地点${index + 1}`);
  const object = objects[index % Math.max(objects.length, 1)] || "核心物件";
  return {
    id: stableId("loc", location.id || name, index),
    name,
    visibleUse: text(location.visibleUse, `${object}在这里登记、换手、被扣住或被拒绝。`),
    likelyEvents: list(location.likelyEvents, [
      `${object}被推到明处`,
      `${name}的记录被改动`,
      `有人在${name}被拦下`,
    ]),
    subtext: text(location.subtext, `${name}会把私人欲望变成公开手续。`),
  };
}

function normalizeModelRelationships(relationships = [], characters = [], world = {}, objects = []) {
  const byId = new Map(characters.map((character) => [character.id, character]));
  const byName = new Map(characters.map((character) => [character.name, character]));
  const resolve = (value, name, fallbackIndex) =>
    byId.get(value) || byName.get(value) || byName.get(name) || characters[fallbackIndex % Math.max(characters.length, 1)];
  const object = objects[0] || "核心物件";
  const source = Array.isArray(relationships) && relationships.length
    ? relationships
    : characters.map((character, index) => ({
      from: character.id,
      to: characters[(index + 1) % characters.length]?.id,
      label: "资源 / 误读",
      pressure: `${character.name}和${characters[(index + 1) % characters.length]?.name || "对方"}都被${object}逼到同一处。`,
    }));
  return source
    .map((relationship, index) => {
      const from = resolve(relationship.from, relationship.fromName, index);
      const to = resolve(relationship.to, relationship.toName, index + 1);
      if (!from?.id || !to?.id || from.id === to.id) return null;
      return {
        from: from.id,
        to: to.id,
        label: text(relationship.label, "关系压力"),
        pressure: text(
          relationship.pressure,
          `${from.name}和${to.name}围绕${object}有一件不能公开说清的旧事。`,
        ),
      };
    })
    .filter(Boolean);
}

export function normalizeModelSetupBlueprint(parsed = {}, { worldPrompt = "", peoplePrompt = "" } = {}) {
  const rawWorld = parsed.world || parsed.blueprint || {};
  const title = text(rawWorld.title, text(rawWorld.townName, text(worldPrompt).split(/[，,。；;\n]/)[0] || "模型生成世界"));
  const townName = text(rawWorld.townName, title);
  const world = {
    id: slug(rawWorld.id || townName, "model_world"),
    title,
    townName,
    genre: text(rawWorld.genre, "模型生成戏剧沙盘 / 关系压力 / 实时观察"),
    summary: text(rawWorld.summary, worldPrompt || `${townName}里，每个人都被资源、身份和旧关系推到场上。`),
    timepoint: text(rawWorld.timepoint, "故事开始的第一天"),
    era: text(rawWorld.era, "由模型根据用户输入生成的时代"),
    location: text(rawWorld.location, townName),
    background: text(rawWorld.background, worldPrompt || rawWorld.summary || ""),
    darknessLevel: clamp(rawWorld.darknessLevel, 62),
    nobilityLevel: clamp(rawWorld.nobilityLevel, 52),
    publicRules: list(rawWorld.publicRules, ["公开交换必须留下凭证。", "身份决定一个人能进入哪里。", "弱者的庇护请求会迫使强者表态。"]),
    hiddenRules: list(rawWorld.hiddenRules, ["真正被争夺的是解释权。", "中立制度会私下挑选受益者。", "旧关系会改变当下选择。"]),
    powerCenters: list(rawWorld.powerCenters, ["入口", "交易处", "档案室", "避难处"]),
    recurringObjects: list(rawWorld.recurringObjects, ["凭证", "账本", "钥匙", "灯"]),
    pressureClock: text(rawWorld.pressureClock, "一天内必须有物件换手，有人改口，有关系失衡。"),
  };
  const characters = (Array.isArray(parsed.characters) ? parsed.characters : [])
    .map((character, index) => normalizeModelCharacter(character, index, world));
  const safeCharacters = characters.length >= 2
    ? characters
    : [
      normalizeModelCharacter({ name: "守门人", publicIdentity: "守着世界入口的人。", desire: "让秩序继续。", shame: "害怕秩序只是自己的借口。", visible: "登记、拦住、询问、盖章" }, 0, world),
      normalizeModelCharacter({ name: "逃离者", publicIdentity: "想从既有安排里离开的人。", desire: "拿回选择。", shame: "害怕离开会暴露亏欠。", visible: "等待、试探、改口、离开" }, 1, world),
    ];
  const locations = (Array.isArray(parsed.locations) ? parsed.locations : [])
    .map((location, index) => normalizeModelLocation(location, index, world.recurringObjects));
  const safeLocations = locations.length >= 3
    ? locations
    : world.powerCenters.slice(0, 3).map((name, index) => normalizeModelLocation({ name }, index, world.recurringObjects));
  return {
    ...world,
    characters: safeCharacters,
    locations: safeLocations,
    relationships: normalizeModelRelationships(parsed.relationships, safeCharacters, world, world.recurringObjects),
  };
}

function buildSetupSystemPrompt() {
  return [
    `你是${worldBuildingSkill.name}和${dramaticCharacterSkill.name}的运行时。`,
    worldBuildingSkill.purpose,
    dramaticCharacterSkill.purpose,
    "只生成当前时间点以前的事实；不要预知后续剧情。",
    "世界规则只提供外壳，不能替人物决定结果。",
    "人物必须能行动、误读、隐藏、越界和改变关系；不要只给身份标签。",
    "每个人物必须有三句只属于自己的 defenseLanguage：必须从他的身份、羞耻、欲望、世界物件里说话，禁止通用句。",
    "地点必须能制造相遇、扣押、交易、庇护、审讯、误会或物件换手。",
  ].join("\n");
}

function buildSetupUserPrompt({ setupWorldPrompt = "", setupPeoplePrompt = "" } = {}) {
  return [
    "用户想建立的世界：",
    setupWorldPrompt || "用户没有输入世界，请生成一个可运行的小镇戏剧沙盘。",
    "",
    "用户想放进世界的人：",
    setupPeoplePrompt || "用户没有输入人物，请生成一组彼此有旧债、误读和行动边界的人。",
    "",
    "输出 JSON：world、characters、locations、relationships。characters 每人必须有 name/publicIdentity/desire/shame/visible/defenseLanguage；defenseLanguage 恰好三句，像角色在场上保护自己时会说的话；relationships 必须让人物能在场上互相改变。",
  ].join("\n");
}

export async function generatePlayableWorldFromModelSetup({
  setupWorldPrompt = "",
  setupPeoplePrompt = "",
  callModel = callOpenAIJson,
  allowFallback = true,
} = {}) {
  const worldPrompt = text(setupWorldPrompt);
  const peoplePrompt = text(setupPeoplePrompt);
  try {
    const response = await callModel({
      system: buildSetupSystemPrompt(),
      user: buildSetupUserPrompt({ setupWorldPrompt: worldPrompt, setupPeoplePrompt: peoplePrompt }),
      schema: MODEL_SETUP_SCHEMA,
      schemaName: "character_town_setup_blueprint",
    });
    const blueprint = normalizeModelSetupBlueprint(response.parsed, { worldPrompt, peoplePrompt });
    return buildPlayableWorldFromBlueprint(blueprint, {
      worldPrompt,
      peoplePrompt,
      generation: {
        worldSource: "model-world-skill",
        characterSource: "model-character-skill",
        modelGeneration: {
          ...(response.meta || {}),
          schemaName: "character_town_setup_blueprint",
        },
      },
    });
  } catch (error) {
    if (!allowFallback) throw error;
    const generated = buildPlayableWorldFromSetup({ setupWorldPrompt: worldPrompt, setupPeoplePrompt: peoplePrompt });
    generated.worldSetup = {
      ...(generated.worldSetup || {}),
      generatedByModel: false,
      modelGeneration: {
        provider: "local-fallback",
        error: error?.message || String(error),
      },
    };
    return generated;
  }
}
