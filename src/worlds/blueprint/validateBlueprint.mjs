// Blueprint validation function implementing rules B0-B9
import { BLUEPRINT_VERSION, BLUEPRINT_SCHEMA } from "./schema.mjs";
import { checkAgainstSchema } from "./schemaCheck.mjs";
import { SITE_TYPES } from "../catalog/siteTypes.mjs";
import { SKILLS } from "../catalog/skills.mjs";
import { resolveReference } from "../compiler/resolve.mjs";

const CONDITION_FIELDS = Object.freeze({
  object_ready: ["object"],
  object_holder: ["object", "holder"],
  actor_at: ["actor", "siteId"],
});

const ID_REGEX = /^[a-z0-9][a-z0-9_-]{0,47}$/u;
const CLOCK_REGEX = /^(?:0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/u;
const HEX_REGEX = /^#[0-9a-fA-F]{6}$/u;

const KNOWN_APPEARANCE_STYLES = new Set([
  "bun", "beard", "long", "apron", "sword", "bandaged", "short", "braid", "hat", "bald", "ponytail", "clean_shaven",
]);

export function validateBlueprint(blueprint, { catalog = SITE_TYPES } = {}) {
  const issues = [];

  function add(rule, code, path, message) {
    issues.push({ rule, code, path, message });
  }

  if (!blueprint || typeof blueprint !== "object") {
    add("B1", "BLUEPRINT_INVALID", "", "蓝图必须是一个对象。");
    return { ok: false, issues };
  }

  // B0: the shape itself. Model drafts and player edits arrive here first;
  // anything missing or extra is reported before the semantic rules run.
  // Schema findings that belong to a named rule keep that rule, so the review
  // page groups them with the semantic checks below.
  for (const row of checkAgainstSchema(blueprint, BLUEPRINT_SCHEMA)) {
    const [rule, code] = /residents\[\d+\]\.newcomer$/u.test(row.path) ? ["B3", "RESIDENT_NEWCOMER_INVALID"]
      : /residents\[\d+\]\.look$/u.test(row.path) ? ["B8", "RESIDENT_LOOK_TOO_LONG"]
        : /字（现在/u.test(row.message) ? ["B9", "TEXT_TOO_LONG"]
          : /appearance\.(skin|hair|robe|sash)$/u.test(row.path) ? ["B8", "APPEARANCE_COLOR_INVALID"]
            : /routine\[\d+\]\.(from|to)$/u.test(row.path) ? ["B7", "ROUTINE_CLOCK_INVALID"]
              : row.path === "residents" ? ["B3", "RESIDENTS_COUNT_EXCEEDED"]
                : /conditions\[\d+\]\.kind$/u.test(row.path) ? ["B6", "CONDITION_KIND_UNKNOWN"]
                : ["B0", "BLUEPRINT_SHAPE_INVALID"];
    add(rule, code, row.path, row.message);
  }
  if (issues.some((row) => row.rule === "B0")) return { ok: false, issues };

  if (blueprint.blueprintVersion !== BLUEPRINT_VERSION) {
    add("B1", "BLUEPRINT_VERSION_INVALID", "blueprintVersion", `不支持的蓝图版本: ${blueprint.blueprintVersion}`);
  }

  // 1. Collect and check Sites
  const sites = Array.isArray(blueprint.town?.sites) ? blueprint.town.sites : [];
  const siteIds = new Set();
  let outdoorCount = 0;

  sites.forEach((site, index) => {
    const p = `town.sites[${index}]`;
    if (!site.id || !ID_REGEX.test(site.id)) {
      add("B1", "SITE_ID_INVALID", `${p}.id`, `地点 ID 格式不合法: ${site.id}`);
    } else if (siteIds.has(site.id)) {
      add("B1", "SITE_ID_DUPLICATE", `${p}.id`, `地点 ID 重复: ${site.id}`);
    } else {
      siteIds.add(site.id);
    }
    const siteType = catalog?.[site.type];
    if (!siteType) add("B2", "SITE_TYPE_UNKNOWN", `${p}.type`, `地点类型不在目录里: ${site.type}`);
    else if (siteType.kind === "outdoor") outdoorCount++;
  });

  // 2. Collect and check Households
  const households = Array.isArray(blueprint.households) ? blueprint.households : [];
  const householdIds = new Set();
  households.forEach((hh, index) => {
    const p = `households[${index}]`;
    if (!hh.id || !ID_REGEX.test(hh.id)) {
      add("B1", "HOUSEHOLD_ID_INVALID", `${p}.id`, `户 ID 格式不合法: ${hh.id}`);
    } else if (householdIds.has(hh.id)) {
      add("B1", "HOUSEHOLD_ID_DUPLICATE", `${p}.id`, `户 ID 重复: ${hh.id}`);
    } else {
      householdIds.add(hh.id);
    }
    if (hh.siteId && !siteIds.has(hh.siteId)) {
      add("B2", "HOUSEHOLD_SITE_UNKNOWN", `${p}.siteId`, `户所在地点不存在: ${hh.siteId}`);
    }
  });
  sites.forEach((site, index) => {
    if (site.householdId && !householdIds.has(site.householdId)) {
      add("B2", "SITE_HOUSEHOLD_UNKNOWN", `town.sites[${index}].householdId`, `地点所属的户不存在: ${site.householdId}`);
    }
  });

  // 3. Collect and check Residents
  const residents = Array.isArray(blueprint.residents) ? blueprint.residents : [];
  if (residents.length > 30) {
    add("B3", "RESIDENTS_COUNT_EXCEEDED", "residents", `居民人数超过上限 30（当前 ${residents.length} 人）。`);
  }
  if (outdoorCount < 1) {
    add("B3", "OUTDOOR_SITE_MISSING", "town.sites", "小镇至少需要 1 处室外地点。");
  }

  const residentIds = new Set();
  const householdResidentCount = new Map();

  residents.forEach((res, index) => {
    const p = `residents[${index}]`;

    // B1: ID uniqueness and format
    if (!res.id || !ID_REGEX.test(res.id)) {
      add("B1", "RESIDENT_ID_INVALID", `${p}.id`, `居民 ID 格式不合法: ${res.id}`);
    } else if (residentIds.has(res.id)) {
      add("B1", "RESIDENT_ID_DUPLICATE", `${p}.id`, `居民 ID 重复: ${res.id}`);
    } else {
      residentIds.add(res.id);
    }

    if (res.newcomer !== undefined && typeof res.newcomer !== "boolean") {
      add("B3", "RESIDENT_NEWCOMER_INVALID", `${p}.newcomer`, `居民 newcomer 必须是布尔值。`);
    }
    if (res.look !== undefined && (typeof res.look !== "string" || [...res.look].length > 60)) {
      add("B8", "RESIDENT_LOOK_TOO_LONG", `${p}.look`, `居民 look 不能超过 60 字。`);
    }

    // Only a grown woman can be expecting.
    if (res.pregnancyWeeks !== undefined && (res.sex === "male" || res.appearance?.child === true || !(Number(res.age) >= 16 && Number(res.age) <= 45))) {
      add("B3", "RESIDENT_PREGNANCY_INVALID", `${p}.pregnancyWeeks`, "只有 16–45 岁的女子可以写 pregnancyWeeks。");
    }

    // B2: Household & Site pointers
    if (res.householdId) {
      if (!householdIds.has(res.householdId)) {
        add("B2", "RESIDENT_HOUSEHOLD_UNKNOWN", `${p}.householdId`, `居民所属户不存在: ${res.householdId}`);
      } else {
        householdResidentCount.set(res.householdId, (householdResidentCount.get(res.householdId) || 0) + 1);
      }
    }
    if (res.workSiteId && !siteIds.has(res.workSiteId)) {
      add("B2", "RESIDENT_WORKSITE_UNKNOWN", `${p}.workSiteId`, `居民工作地点不存在: ${res.workSiteId}`);
    }
    // Skills come from the catalog: an unknown one compiles into a skill no work ever asks for.
    (Array.isArray(res.skills) ? res.skills : []).forEach((skill, k) => {
      if (!SKILLS[skill]) add("B2", "RESIDENT_SKILL_UNKNOWN", `${p}.skills[${k}]`, `技能 ${skill} 不在目录里，只能用：${Object.keys(SKILLS).join("、")}。`);
    });

    // B4: Desires
    if (!Array.isArray(res.desires) || res.desires.length === 0) {
      add("B4", "RESIDENT_DESIRES_EMPTY", `${p}.desires`, `居民 ${res.name || res.id} 至少需要有 1 项欲望。`);
    } else {
      const grounded = res.desires.some((d) => resolveReference(d.object, {
        alsoText: d.outcome, residents, sites, objects: blueprint.opening?.objects || [], owner: res,
        relationships: blueprint.relationships || [], catalog,
      })) || (res.routine || []).some((row) => siteIds.has(row.siteId));
      if (!grounded) add("B4", "RESIDENT_DESIRES_UNGROUNDED", `${p}.desires`, `居民 ${res.name || res.id} 的欲望和作息都没有落到镇上真实的人、地点或物件。`);
    }

    // B7: Routine check (time and overlap)
    if (Array.isArray(res.routine)) {
      const routineIntervals = [];
      res.routine.forEach((entry, rIdx) => {
        const rp = `${p}.routine[${rIdx}]`;
        if (entry.siteId && !siteIds.has(entry.siteId)) {
          add("B2", "ROUTINE_SITE_UNKNOWN", `${rp}.siteId`, `作息活动地点不存在: ${entry.siteId}`);
        }
        const validFrom = entry.from && CLOCK_REGEX.test(entry.from);
        const validTo = entry.to && CLOCK_REGEX.test(entry.to);
        if (!validFrom) {
          add("B7", "ROUTINE_CLOCK_INVALID", `${rp}.from`, `作息开始时间不合法: ${entry.from}`);
        }
        if (!validTo) {
          add("B7", "ROUTINE_CLOCK_INVALID", `${rp}.to`, `作息结束时间不合法: ${entry.to}`);
        }
        if (validFrom && validTo) {
          const fromMinutes = parseClock(entry.from);
          const toMinutes = parseClock(entry.to);
          routineIntervals.push({ from: fromMinutes, to: toMinutes, index: rIdx });
        }
      });

      // Check overlap
      routineIntervals.sort((a, b) => a.from - b.from);
      for (let i = 0; i < routineIntervals.length - 1; i++) {
        const cur = routineIntervals[i];
        const next = routineIntervals[i + 1];
        if (cur.to > next.from) {
          add("B7", "ROUTINE_TIME_OVERLAP", `${p}.routine[${next.index}]`, `作息时间段存在重叠。`);
        }
      }
    }

    // B8: Appearance hex colors & styles
    if (res.appearance) {
      const app = res.appearance;
      for (const colorKey of ["skin", "hair", "robe", "sash"]) {
        if (app[colorKey] && !HEX_REGEX.test(app[colorKey])) {
          add("B8", "APPEARANCE_COLOR_INVALID", `${p}.appearance.${colorKey}`, `外貌颜色必须为 #rrggbb 格式: ${app[colorKey]}`);
        }
      }
      if (Array.isArray(app.styles)) {
        app.styles.forEach((st, sIdx) => {
          if (!KNOWN_APPEARANCE_STYLES.has(st)) {
            add("B8", "APPEARANCE_STYLE_UNKNOWN", `${p}.appearance.styles[${sIdx}]`, `未知的发型/装束风格: ${st}`);
          }
        });
      }
    }

  });

  // Check each household has >= 1 resident (B3)
  for (const hh of households) {
    if ((householdResidentCount.get(hh.id) || 0) < 1) {
      add("B3", "HOUSEHOLD_EMPTY", `households[${households.indexOf(hh)}]`, `每户至少需要 1 名居民: ${hh.name || hh.id}`);
    }
  }

  // 4. Relationships (B5)
  const relationships = Array.isArray(blueprint.relationships) ? blueprint.relationships : [];
  relationships.forEach((rel, index) => {
    const p = `relationships[${index}]`;
    if (!residentIds.has(rel.from)) {
      add("B5", "RELATIONSHIP_FROM_UNKNOWN", `${p}.from`, `关系发起方居民不存在: ${rel.from}`);
    }
    if (!residentIds.has(rel.to)) {
      add("B5", "RELATIONSHIP_TO_UNKNOWN", `${p}.to`, `关系接收方居民不存在: ${rel.to}`);
    }
    if (rel.from && rel.to && rel.from === rel.to) {
      add("B5", "RELATIONSHIP_SELF_REFERENTIAL", `${p}.to`, `关系不能指向自己: ${rel.from}`);
    }
  });

  // 5. Opening (B6: Deadlines, Positions, Objects)
  if (blueprint.opening) {
    const op = blueprint.opening;
    if (op.positions && typeof op.positions === "object") {
      for (const [rId, sId] of Object.entries(op.positions)) {
        if (!residentIds.has(rId)) {
          add("B6", "POSITION_RESIDENT_UNKNOWN", `opening.positions.${rId}`, `开场位置人物不存在: ${rId}`);
        }
        if (!siteIds.has(sId)) {
          add("B6", "POSITION_SITE_UNKNOWN", `opening.positions.${rId}`, `开场位置地点不存在: ${sId}`);
        }
      }
    }

    const objectNames = new Set();
    if (Array.isArray(op.objects)) {
      op.objects.forEach((obj, oIdx) => {
        const obp = `opening.objects[${oIdx}]`;
        if (obj.name) objectNames.add(obj.name);
        if (obj.siteId && !siteIds.has(obj.siteId)) {
          add("B6", "OBJECT_SITE_UNKNOWN", `${obp}.siteId`, `物件所在地点不存在: ${obj.siteId}`);
        }
        if (obj.holder && !residentIds.has(obj.holder)) {
          add("B6", "OBJECT_HOLDER_UNKNOWN", `${obp}.holder`, `物件持有者不存在: ${obj.holder}`);
        }
        if (obj.madeAt !== undefined) {
          const madeSite = sites.find((site) => site.id === obj.madeAt);
          const work = catalog?.[madeSite?.type]?.work || [];
          if (!madeSite) add("B6", "OBJECT_MADE_AT_UNKNOWN", `${obp}.madeAt`, `物件的制作地点不存在: ${obj.madeAt}`);
          else if (!work.length) add("B6", "OBJECT_MADE_AT_WITHOUT_WORK", `${obp}.madeAt`, `${madeSite.name}没有能做出东西的活计`);
          else if (obj.madeWith && !work.some((row) => row.templateId === obj.madeWith)) {
            add("B6", "OBJECT_MADE_WITH_UNKNOWN", `${obp}.madeWith`, `${madeSite.name}没有这种活计: ${obj.madeWith}（可选：${work.map((row) => row.templateId).join("、")}）`);
          }
        }
      });
    }

    if (Array.isArray(op.deadlines)) {
      op.deadlines.forEach((dl, dlIdx) => {
        const dlp = `opening.deadlines[${dlIdx}]`;
        if (Array.isArray(dl.responsible)) {
          dl.responsible.forEach((resp, rIdx) => {
            if (!residentIds.has(resp)) {
              add("B6", "DEADLINE_RESPONSIBLE_UNKNOWN", `${dlp}.responsible[${rIdx}]`, `时限责任人不存在: ${resp}`);
            }
          });
        }
        if (Array.isArray(dl.knownBy)) {
          dl.knownBy.forEach((kb, kIdx) => {
            if (!residentIds.has(kb)) {
              add("B6", "DEADLINE_KNOWN_BY_UNKNOWN", `${dlp}.knownBy[${kIdx}]`, `时限知情人不存在: ${kb}`);
            }
          });
        }
        if (Array.isArray(dl.conditions)) {
          dl.conditions.forEach((cond, cIdx) => {
            const cp = `${dlp}.conditions[${cIdx}]`;
            const fields = CONDITION_FIELDS[cond.kind];
            if (!fields) {
              add("B6", "CONDITION_KIND_UNKNOWN", `${cp}.kind`, `条件类型只能是 object_ready / object_holder / actor_at: ${cond.kind}`);
              return;
            }
            for (const field of fields) if (!cond[field]) add("B6", "CONDITION_FIELD_MISSING", `${cp}.${field}`, `${cond.kind} 条件缺少 ${field}`);
            if (cond.object && !objectNames.has(cond.object)) {
              add("B6", "CONDITION_OBJECT_UNKNOWN", `${cp}.object`, `条件里的物件不在开场物件里: ${cond.object}`);
            }
            if (cond.kind === "object_ready" && cond.object && objectNames.has(cond.object)
              && !(op.objects || []).some((obj) => obj.name === cond.object && obj.madeAt)) {
              add("B6", "CONDITION_OBJECT_NOT_MADE", `${cp}.object`, `${cond.object} 没有写 madeAt，无法判断“做好了没有”`);
            }
            if (cond.holder && !residentIds.has(cond.holder)) {
              add("B6", "CONDITION_HOLDER_UNKNOWN", `${cp}.holder`, `条件持有者不存在: ${cond.holder}`);
            }
            if (cond.actor && !residentIds.has(cond.actor)) {
              add("B6", "CONDITION_ACTOR_UNKNOWN", `${cp}.actor`, `条件里的人物不存在: ${cond.actor}`);
            }
            if (cond.siteId && !siteIds.has(cond.siteId)) {
              add("B6", "CONDITION_SITE_UNKNOWN", `${cp}.siteId`, `条件地点不存在: ${cond.siteId}`);
            }
          });
        }
      });
    }
  }

  const seen = new Set();
  const unique = issues.filter((row) => !seen.has(`${row.rule}|${row.path}`) && seen.add(`${row.rule}|${row.path}`));
  return { ok: unique.length === 0, issues: unique };
}

function parseClock(clockStr) {
  const [h, m] = clockStr.split(":").map(Number);
  return h * 60 + m;
}
