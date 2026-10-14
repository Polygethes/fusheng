// Prompts for the quick-mode draft. The model writes people and story; the
// compiler builds the map, rooms, objects and work, so prompts only name the
// catalog's place types and skills and ask for ids that later stages can use.
import { catalogBrief } from "./stages.mjs";

const JSON_RULE = "严格按要求的 JSON 结构回答，只输出 JSON。凡是“名字 → 值”的对照（householdSizes、feelings、positions、物件的 state），在回答里写成 [{\"key\": 名字, \"value\": 值}] 这样的列表。";
const SYSTEM = `你是一位擅长写小镇群像的作者，正在为一个像素小镇模拟游戏起草世界设定。人物要有真实的生活、心事和彼此的牵连；不写奇遇和大场面，写日常里的事。${JSON_RULE}`;
// An imported script or story is the canon to adapt, not loose material: its
// people, places and ties come first, and its big events become background.
const ADAPT_SYSTEM = `你是一位擅长改编的作者，正在把玩家导入的剧本或小说改编成一个像素小镇模拟游戏的世界设定。人物、关系、地方和处境以原作为准：名字、身份、性格和说话方式照原作写，原作没写到的再按原作的味道补齐。写的是开场这一天里的日常和人物心事；原作里的大事件当作背景、心事和悬念，不要直接演出来。${JSON_RULE}`;
const list = (value) => (Array.isArray(value) ? value : []);
const adapting = (sourceText, sourceMode) => Boolean(sourceText) && sourceMode === "adapt";
const source = (sourceText, sourceMode) => {
  if (!sourceText) return "";
  return adapting(sourceText, sourceMode)
    ? `\n\n【原作（玩家导入的剧本或文本，以它为准）】\n${sourceText}`
    : `\n\n【参考资料（玩家提供，可以取材，不必照抄）】\n${sourceText}`;
};
const repairNote = (issues = []) => (issues.length ? `\n\n【上一次的回答没有通过检查，改正这些问题后完整地重新回答】\n${issues.map((row) => `- ${row.path ? `${row.path}：` : ""}${row.message}`).join("\n")}` : "");
const ID_RULE = "所有 id 用小写拼音或英文加下划线（如 li_home、wang_shen），不超过 48 个字符，互不重复。";

export function worldPrompt({ idea, sourceText, sourceMode, plan, issues = [] }) {
  const brief = catalogBrief();
  const adapt = adapting(sourceText, sourceMode);
  const ask = adapt
    ? `【玩家的改编要求】\n${idea || "（玩家没有另外写要求，照原作来）"}`
    : `【玩家的想法】\n${idea || "（玩家没有写，自己构思一个）"}`;
  const adaptRules = adapt ? `- 照原作改编：标题、前提、类型、基调跟原作走；开场时辰取原作开场的那一场（玩家指定了哪一场就用哪一场）。
- 镇名和地点用原作里出现的地方，类型从目录里挑最接近的；原作里的家庭、门户、师门就是这里的“户”。
- 人数先排原作的主要人物，再排原作提到的次要人物，仍不够才新编贴合原作的人；householdSizes 按这样排出来的人数分。
` : "";
  return { system: adapt ? ADAPT_SYSTEM : SYSTEM, user: `${ask}${source(sourceText, sourceMode)}

【要写的】
小镇本身：标题、前提、类型、基调、开场时辰；镇名、地形方位、地点清单；各户人家及其住处；每户几口人。
${adaptRules}- 规模：${plan.label}。一共 ${plan.residents} 位居民，分成 ${plan.households[0]}–${plan.households[1]} 户；householdSizes 每户一项：key 是户 id，value 是这户几口人（1–6），加起来正好 ${plan.residents}。
- 地点从下面的目录里选类型（town.sites[].type 只能填目录里的键）。每户要有自己的住处（home、farmhouse，或带住处的铺子），households[].siteId 指向它；铺子、客栈、药铺等让各户有生计；再加广场、井、集市、林子、河岸等室外地方。建筑 4–12 栋。
- terrain 四个方向（river / forest / hills / fields）各填 "north" / "south" / "east" / "west" 或 null，用到的方向不要重复。
- meta.id 用小写拼音；meta.language 填 "zh-Hans"；startClock 用 "HH:MM"，startLabel 是对应的时辰说法（如“清晨辰时”）；seed 填一个整数。
- ${ID_RULE}

【地点目录】
${brief.sites}${repairNote(issues)}` };
}

export function residentsPrompt({ idea, sourceText, sourceMode, world, batch, earlier = [], issues = [] }) {
  const brief = catalogBrief();
  const adapt = adapting(sourceText, sourceMode);
  const sites = world.town.sites.map((row) => `- ${row.id}：${row.name}（${row.type}）`).join("\n");
  const known = earlier.map((row) => `- ${row.id}：${row.name}，${row.age} 岁，${row.role}（${row.householdId}）`).join("\n");
  return { system: adapt ? ADAPT_SYSTEM : SYSTEM, user: `【这个小镇】
${world.meta.title}：${world.meta.premise}
基调：${world.meta.tone}；开场：${world.meta.startDay} ${world.meta.startClock}（${world.meta.startLabel}）
${idea ? `${adapt ? "玩家的改编要求" : "玩家的想法"}：${idea}` : ""}${source(sourceText, sourceMode)}

【地点】
${sites}

【已经写好的居民】
${known || "（还没有）"}

【这一次要写的】
${batch.householdName}（householdId: ${batch.householdId}）的 ${batch.count} 位家人。和已经写好的人要有牵连（亲戚、邻里、生意、旧怨），但别重复他们的身份。
${adapt ? "这一户优先用原作里的人物：名字、年龄、身份照原作，不要改名；说话方式和示例台词贴着原作里他们的口气写；欲望、记忆和秘密从原作的情节里来。\n" : ""}每个人：
- 年龄、身份（role）、在哪干活（workSiteId，填地点 id）。
- 外貌：skin/hair/robe/sash 从下面的颜色里挑；styles 从「${brief.styles}」里挑 0–3 个；孩子 child 为 true。
- 性格 personality 八项 0–1。
- 技能 skills 只能用这些 id：${brief.skills}。
- 说话方式和 1–3 句示例台词；孩子说孩子话。
- 眼下的处境（situation）。
- 1–3 个欲望（desires）。object 要落到具体的人、地点或物件上，写出名字，比如“百草堂的腰伤药包”。outcome 写清盼着的结果。
- 原则、底线（boundaries）、记忆、秘密。
- 作息（routine）：3–4 段，覆盖早上到傍晚，siteId 填地点 id，至少用到两个不同地点。
- ${ID_RULE}

【颜色】
${brief.colors}${repairNote(issues)}` };
}

export function relationshipsPrompt({ world, residents, sourceText, sourceMode, issues = [] }) {
  const people = residents.map((row) => `- ${row.id}：${row.name}，${row.age} 岁，${row.role}，${row.householdId}；${row.situation}`).join("\n");
  // Only an adaptation reads the original here; loose reference material stays with the world and residents.
  const adapt = adapting(sourceText, sourceMode);
  return { system: adapt ? ADAPT_SYSTEM : SYSTEM, user: `【小镇】${world.meta.title}：${world.meta.premise}${adapt ? source(sourceText, sourceMode) : ""}

【居民】
${people}

【要写的】
居民之间的关系（有方向：from 怎么看 to）。每个人至少有一条，家人之间互相都要有。
${adapt ? "原作里写到的关系照原作写，称呼用原作里的叫法；原作里藏着没说的话、看错的人，写进 unspoken 和 misreading。\n" : ""}- label：一句话说清是什么关系、什么心情（如“父子 / 敬重与担当”）。
- address：from 当面怎么称呼 to（如“爹”“王婶”）。
- feelings：每项 {key: 维度, value: 0–100}，只从这些维度里挑 2–5 项：love（爱）、attraction（吸引）、resentment（怨）、fear（怕）、dependence（依赖）、power（压着对方）、shame（羞愧）、jealousy（嫉妒）、protection（想护着）、revenge（想报复）、deception（瞒着对方）、wantsToBeSeen（想被看见）、wantsToPossess（想占有）、wantsToEscape（想躲开）、wantsToDestroy（想毁掉）。
- unspoken：没说出口的话；misreading：from 可能看错 to 的地方（可以留空字符串）。${repairNote(issues)}` };
}

export function openingPrompt({ world, residents, relationships, idea, sourceText, sourceMode, issues = [] }) {
  const adapt = adapting(sourceText, sourceMode);
  const people = residents.map((row) => `- ${row.id}：${row.name}，${row.role}；想${list(row.desires).map((d) => `${d.verb}${d.object}`).join("、")}`).join("\n");
  const sites = world.town.sites.map((row) => `- ${row.id}：${row.name}（${row.type}）`).join("\n");
  return { system: adapt ? ADAPT_SYSTEM : SYSTEM, user: `【小镇】${world.meta.title}：${world.meta.premise}
开场：${world.meta.startDay} ${world.meta.startClock}${adapt && idea ? `\n玩家的改编要求：${idea}` : ""}${adapt ? source(sourceText, sourceMode) : ""}

【地点】
${sites}

【居民】
${people}

【要写的】
开场的局面：
${adapt ? "- 照原作开场的那一场（玩家指定了哪一场就用哪一场）来摆：谁在哪、谁手里有什么、今天要赶在什么时辰前办成什么，尽量照原作；原作里没揭开的事写进 mysteries。\n" : ""}- situation：一两句话，开场时镇上正在发生什么。
- positions：开场时每个居民在哪个地点，每人一项 {key: 居民 id, value: 地点 id}。同一个地点不要超过 6 人。
- objects：开场时就有的东西，3–8 件，有的在人手里（holder 填居民 id），有的放在某处（siteId）；state 没有就写 []。要在铺子里“做出来”的东西，写 madeAt（地点 id）和 needed（做几份，1–10）。
- deadlines：2–4 个今天的时限，dueClock 用 "HH:MM"，晚于开场时辰。
  - 至少一个要两个以上的人合作，responsible 写两人以上。
  - conditions 只能用三种：
    - {"kind":"object_ready","object":"物件名"}：东西做好了，物件必须带 madeAt；
    - {"kind":"object_holder","object":"物件名","holder":"居民 id"}：东西到了某人手里；
    - {"kind":"actor_at","actor":"居民 id","siteId":"地点 id"}：某人到了某处。
  - knownBy：谁知道这个时限。consequence：误了会怎样。
- mysteries：悬而未决的事 1–3 条（谁都不知道真相）。
- events：可以为空数组；visitors：可以为空数组。${repairNote(issues)}` };
}

export function repairPrompt({ blueprint, issues = [] }) {
  const sections = [...new Set(issues.map((row) => String(row.path || "").split(/[.[]/u)[0]).filter(Boolean))];
  return { system: SYSTEM, user: `【当前的世界草稿】
${JSON.stringify(blueprint)}

【检查发现的问题】
${issues.map((row) => `- ${row.path ? `${row.path}：` : ""}${row.message}`).join("\n")}

【要做的】
只改有问题的部分，其余一个字不动。把需要改动的整段（${sections.join("、") || "相关的段"}）完整地放进 sections 里返回；没有问题的段不要放进去。` };
}

/** What a rewritten part may choose from, so it holds together with the catalog and the draft. */
export function rewriteReference(kind, blueprint = {}) {
  const brief = catalogBrief();
  const sites = (blueprint.town?.sites || []).map((row) => `${row.id}（${row.name}）`).join("、");
  if (kind === "resident") {
    return `- 技能 skills 只能用这些 id：${brief.skills}
- 造型 styles 从「${brief.styles}」里挑 0–3 个
- workSiteId 和作息的 siteId 只能用这些地点 id：${sites}
- 颜色：
${brief.colors}`;
  }
  if (kind === "relationship") {
    return "- feelings 的 key 只能用：love、attraction、resentment、fear、dependence、power、shame、jealousy、protection、revenge、deception、wantsToBeSeen、wantsToPossess、wantsToEscape、wantsToDestroy";
  }
  if (kind === "town") return `- 地点类型 town.sites[].type 只能用：\n${brief.sites}`;
  if (kind === "opening") return `- 地点 id：${sites}\n- 时限条件只能是 object_ready、object_holder、actor_at 三种`;
  return "";
}

export function rewritePrompt({ blueprint, target, current, instruction, reference = "" }) {
  return { system: SYSTEM, user: `【当前的世界草稿】
${JSON.stringify(blueprint)}

【要重写的部分】${target}
${JSON.stringify(current)}
${reference ? `\n【只能从这些里选】\n${reference}\n` : ""}
【玩家的要求】
${instruction || "写得更好、更具体一些"}

【要做的】
只重写这一部分，返回它的新内容（结构和原来相同，id 不变）。别的部分不要改。` };
}
