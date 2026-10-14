# 新世界创建与小镇规模 · 设计规格

日期：2026-10-10。状态：需求已由用户逐项确认（见 §2），本文为实施依据；实施由 Gemini 按 `docs/superpowers/plans/2026-10-10-new-world-creation-and-town.md` 执行，每阶段完成后由 Claude 审核。

## 1. 目标

把现在的“观察台 + 手写世界包”变成**别人下载后就能玩的单机像素游戏**：

1. 开始界面：标题画面 → 新的世界 / 读取存档 / 设置。
2. 玩家自己设定世界和人物（两种模式），程序把设定**编译**成可运行的世界和**像素小镇地图**。
3. 玩家在设置里填自己的模型 API，随后生成和模拟都用它。
4. 世界最大到一个小镇：4–6 户、10–20 位居民、街巷、铺子、森林野外；外景大地图 + 进屋看室内。
5. 玩家在模拟中是旁观者，可以投放“世界事件”（天意）；为以后“扮演其中一人”留好接口。

不变的底线（docs/51 经验基座全部继续生效）：说了不等于做了；世界只结算原语；程序不替人物做选择；来源如实标注；悬念不写成真相；观察只呈现已结算事实。

## 2. 已确认的决策

| 问题 | 决定 |
|---|---|
| 分发方式 | 下载到自己电脑上玩（本机启动服务、浏览器里玩）。API 密钥与存档只在本机。网站版以后再说 |
| 创建方式 | **两种并列模式**，玩家任选：①**快速模式**：一句话或上传文本 → 模型出初稿 → 按「世界 → 地点 → 人物 → 关系 → 开场」逐页审改，每页可手改或让模型重写本页；②**捏世界模式**：像游戏创建角色一样一步步选（世界类型、小镇布局、逐个捏人：像素外貌预览、性格滑条、技能、说话方式、关系选项），模型只帮忙补细节。两种模式产出同一份「世界蓝图」 |
| 地图形式 | 外景大地图（小镇、森林、野外，可拖动镜头，有小地图）+ 进屋切到室内图（星露谷式） |
| 玩家角色 | 第一版：旁观 + 世界事件；结构上预留“玩家化身”，第二版再做扮演 |
| 规模 | 典型 10–20 人、4–6 户；硬上限 30 人 |
| 生成做法 | **A：蓝图 + 编译器**。模型只写人物与故事；拓扑、物件、活计、像素地图由确定性编译器生成并自检 |
| 美术 | 沿用现有像素风（16px 瓦片、3/4 俯视、程序生成精灵、点阵字体） |
| API | 首次打开在设置里填；世界生成与模拟共用。生成世界本身也要调用模型 |

## 3. 玩家流程

```text
启动 start.command / start.bat（检查 Node ≥ 24，npm start，自动打开 http://127.0.0.1:8787）
   │
   ▼
标题画面 ── 设置（模型提供方 / 地址 / 密钥 / 模型名 / 测试连接）
   │            未配置时：新的世界、继续模拟 按钮提示先去设置
   ├─ 读取存档（现有存档界面，按世界分组）
   └─ 新的世界
         ├─ 快速模式：一句话/粘贴/上传 .txt .md → 生成初稿（显示进度与调用次数）
         └─ 捏世界模式：类型 → 小镇 → 住户与建筑 → 居民（捏人）→ 关系 → 开场
                        ▼（两种模式汇合）
                  审改页（世界 / 地点 / 人物 / 关系 / 开场；每页可手改、可“让模型重写本页”）
                        ▼
                  编译：世界包 + 像素地图 → 自检（验证器 + 零模型冒烟）→ 问题清单（可一键回到对应页）
                        ▼
                  地图预览（外景 + 室内，可重掷布局种子）+ 预计花费
                        ▼
                  开始：建立 0 回合存档 → 观察台（演绎模式）→ 运行 / 暂停 / 继续 / 世界事件
```

世界库：已编译的世界保存在本机，可以再开新存档、复制改名、导出/导入（一个 `.world.json` 文件，内含蓝图，不含密钥）。

## 4. 架构总览

```text
                ┌──── 快速模式（模型分段生成）────┐
玩家输入 ──────▶│                               ├──▶ WorldBlueprint (JSON, blueprintVersion 1)
                └──── 捏世界模式（表单 + 模型补全）┘           │ validateBlueprint
                                                              ▼
                                  compileBlueprint(blueprint, { catalog, seed })
                                     │                │                 │
                                     ▼                ▼                 ▼
                              world pack (JSON)   layout v2         compile report
                              （现有 REQUIRED_SECTIONS）（外景 + 室内地图）（自动补设、警告）
                                     │
                       validateWorldPack（增加 town 规则）+ worldSmoke（零模型）
                                     ▼
                     userWorldStore：~/.character-town/worlds/<id>/{blueprint,pack,layout,report}.json
                                     ▼
                  registry.loadWorldPack(id)：内置包 ∪ 用户世界（JSON，经 defineWorldPack 冻结）
                                     ▼
       createFreshWorldSave → runV27GeminiSimulation（演绎模式 + 小镇调度）→ sim-runs → 观察台 v2
```

## 5. 世界蓝图（WorldBlueprint v1）

蓝图是**人能读、能改**的设定，不含坐标和引擎内部结构。两种创建模式、模型生成、导入导出都只操作蓝图。完整 JSON Schema 放在 `src/worlds/blueprint/schema.mjs`（同时用于模型结构化输出与校验）。

```jsonc
{
  "blueprintVersion": 1,
  "meta": {
    "id": "willow_ford",              // 小写标识，生成时自动由标题转写
    "title": "柳渡镇",
    "premise": "一段话：这是个什么样的世界、故事从哪里开始",
    "genre": "古风仙侠 | 现代小镇 | 西式奇幻 | 自定义文字",
    "tone": "温情 | 悬疑 | 轻喜剧 | 自定义",
    "language": "zh-Hans",
    "startDay": "春分后第三天", "startClock": "07:00", "startLabel": "辰时初",
    "seed": 12345                      // 布局种子；地图预览可重掷
  },
  "town": {
    "name": "柳渡镇",
    "terrain": { "river": "south", "forest": "north", "hills": "east", "fields": "west" }, // 方位或 null
    "sites": [                          // 建筑与室外地点
      { "id": "chen_home", "name": "陈家", "type": "home", "householdId": "chen" },
      { "id": "forge", "name": "老周铁匠铺", "type": "smithy", "householdId": "zhou", "attachedHome": true },
      { "id": "square", "name": "镇口广场", "type": "square" },
      { "id": "north_wood", "name": "北山林子", "type": "forest" }
    ]
  },
  "households": [ { "id": "chen", "name": "陈家", "siteId": "chen_home" } ],
  "residents": [
    {
      "id": "chen_yu", "name": "陈雨", "age": 17, "role": "陈家长女，在药铺帮工",
      "householdId": "chen", "workSiteId": "herb_shop",
      "appearance": { "skin": "#f0c6a0", "hair": "#2b2230", "robe": "#4f86b0", "sash": "#c9a25a", "styles": ["long"], "child": false },
      "personality": { "autonomy": 0.7, "introversion": 0.6, "persistence": 0.8, "conscientiousness": 0.6,
                       "competitiveness": 0.3, "care": 0.8, "caution": 0.5, "impulsivity": 0.3 },
      "skills": ["medicine", "cooking"],
      "speech": { "style": "一段话：怎么说话、口头禅、什么时候沉默", "samples": ["示例台词（可空）"] },
      "situation": "一段话：她此刻的处境与心事",
      "desires": [ { "verb": "攒够", "object": "去城里学医的路费", "outcome": "看得见的结果：钱匣里有十两银子", "strength": 0.7 } ],
      "principles": ["答应病人的事一定做到"],
      "boundaries": [ { "protects": "自己的去留", "trigger": "被家里替她做决定", "response": "先沉默，再顶回去" } ],
      "routine": [ { "from": "06:00", "to": "07:00", "activity": "生火做早饭", "siteId": "chen_home" },
                   { "from": "08:00", "to": "17:00", "activity": "在药铺抓药", "siteId": "herb_shop" } ],
      "memories": [ { "when": "去年冬天", "content": "第一人称的一段往事" } ],
      "secrets": ["只有她自己知道的事（可空）"]
    }
  ],
  "relationships": [
    { "from": "chen_yu", "to": "zhou_shan", "label": "青梅竹马 / 嘴硬心软", "address": ["阿山"],
      "feelings": { "love": 60, "wantsToBeSeen": 50 }, "unspoken": "没说出口的话", "misreading": "她可能看错的地方" }
  ],
  "opening": {
    "situation": "开场时镇上正在发生什么（一段话）",
    "positions": { "chen_yu": "chen_home" },           // 省略则按作息推算
    "objects": [ { "name": "一封没拆的信", "siteId": "post", "holder": null, "state": { "sealed": true }, "known": "public|hidden" },
                 { "name": "给周家的药包", "siteId": "herb_shop", "holder": null, "known": "public", "madeAt": "herb_shop", "needed": 1 } ],
    "deadlines": [ { "label": "午时前把药送到周家", "dueClock": "12:00", "responsible": ["chen_yu"], "knownBy": ["chen_yu"],
                     "conditions": [ { "kind": "object_ready", "object": "给周家的药包" },
                                     { "kind": "object_holder", "object": "给周家的药包", "holder": "zhou_shan" } ],
                     "consequence": "过了时辰的后果" } ],
    "mysteries": ["悬而未决、任何人都不能当成已确认事实的事"],
    "events": [ { "atClock": "15:00", "kind": "visitor", "visitorId": "peddler_li" } ],
    "visitors": [ /* 与 residents 同形状，开场不在镇上；世界事件“来客”从这里取 */ ]
  }
}
```

**要“做出来”的东西（P2 审核补充）。** 物件可带 `madeAt`（地点 id）与 `needed`（1–10，缺省 1），表示它要在该地点干活才能做成、修好或备齐；`madeWith`（可选）指定用该地点类型目录里的哪种活计，缺省取第一种。编译器给物件加数值状态 `progress: 0`、`needed: n`，并为它单独生成一个活计（与目录活计同技能、同房间、同耗时，名字带上物件名，份数为 n，做满即止），每完成一份给它的 `progress` 加 1。地点原有的日常活计不受影响。

时限条件只有三种 `kind`：
- `object_ready`：`object` 的 `progress` 达到 `needed`；
- `object_holder`：`object` 在 `holder` 手里；
- `actor_at`：`actor` 在 `siteId`。

“修好、配齐、磨好”这类事用 `object_ready` 表达，“送到某人手里”用 `object_holder` 表达，两者可以并列。程序只结算这些条件，不替人物决定去做。

### 5.1 蓝图校验（`validateBlueprint`，纯函数，中文问题清单）

B1 id 唯一且合法；B2 每个居民的 householdId / workSiteId / routine.siteId 指向存在的 site；B3 人数 ≤ 30、每户 ≥ 1 人、至少 1 处室外地点；B4 每个居民至少 1 个欲望，且欲望或作息落到小镇里真实存在的人、地点或物件；B5 关系两端存在、不自指；B6 时限的负责人与知情者存在、条件引用的人物/地点/物件存在；B7 作息时间段合法、不重叠；B8 外貌颜色是 `#rrggbb`、styles 属于已知集合；B9 文本长度上限（防止模型灌水撑爆提示词）。

## 6. 目录（Catalog）

`src/worlds/catalog/`，纯数据，可扩展。编译器只认目录里的类型；目录外的东西走“自定义”。

- `siteTypes.mjs`：每种建筑/室外地点的定义：
  - 建筑：`home`（堂屋、卧房×n、灶间）、`smithy`（铺面、炉间）、`inn`（大堂、灶间、客房×n）、`shop`、`herb_shop`、`clinic`、`temple`、`school`、`farmhouse`、`mill`、`post` 等。每种给出：房间列表（id 后缀、标签、大小档位）、房间之间的连通、默认物件（含状态）、默认活计模板（含所需技能、单位时长、状态效果、完成声响）、室内布局模板 id。
  - 室外：`square`、`street`、`market`、`well`、`field`、`forest`、`river_bank`、`bridge`、`pond`、`hill`、`graveyard`、`road_out`（出镇的路）等。每种给出：区标签、可做的活计（砍柴、采药、钓鱼、耕地……）、地貌瓦片风格。
- `skills.mjs`：技能 id ↔ 中文名（medicine、cooking、smithing、carpentry、farming、hunting、fishing、herbalism、reading、sword……），活计按它校验能力边界。
- `appearance.mjs`：可选发型/装束 styles（已有 bun、long、beard、apron、sword、bandaged，新增若干），调色板预设。
- `events.mjs`：世界事件类型（§10）。

## 7. 编译器（`compileBlueprint`）

`src/worlds/compiler/`。**纯函数、确定性**：同一蓝图 + 同一种子 → 同一世界包与地图（测试锁定摘要）。输出 `{ pack, layout, report }`，`report` 列出所有自动补设（provisional）和警告，展示在审改页。

编译结果的 `meta.scale = "town"`，`meta.blueprintDigest` 记录蓝图摘要，`meta.provisional` 列出编译器补设的内容。

### 7.1 拓扑（小镇 = 一个地点、多个区）

运行时已有“一个地点 + 区图”的完整结算，小镇沿用它，不引入跨地点移动：

- 每个建筑展开为若干**室内区**：`<siteId>__<roomSuffix>`（例 `chen_home__kitchen`）。
- 每个建筑有一个**门前区**：属于街巷网络（例 `street_3`），室内的“正屋/铺面”与门前区之间一条门边。
- 室外地点各是一个或多个区（森林可分 `north_wood__edge`、`north_wood__deep`）。
- 街巷网络由布局规划器（§8）决定，编译器把规划结果写回拓扑：相邻街段、广场、出镇路。
- 边参数（统一常量，放 `compiler/edges.mjs`）：
  - 室内房间之间：`move 1, sound 1.25, visual 1.5, conversation: true`
  - 室内 ↔ 门前区：`move 1, sound 2, visual: Infinity`（屋里屋外互相看不见，能听见喊声）
  - 街段之间：`move = 街段长度档位 (1–3), sound 1.5, visual 1`
  - 进林子/上山：`move 3–6, sound Infinity, visual 2.5`
- **感知距离上限**：`stage.perceptionEnvironment.maxVisualDistance`（小镇默认 2.5）和 `maxSoundDistance`（已有 conversational 1、call_out 3）。见 §9.2。

### 7.2 人物（居民卡 → cast 成员）

编译成与 `src/worlds/jiexing/cast.mjs` 相同的形状（`buildPlayableWorldFromPack` 不改）：

| 蓝图字段 | 编译结果 |
|---|---|
| name / role / age / appearance / skills | `name`、`title`、`appearance`（child = age < 14）、`skills` |
| personality | `ecologyProfile.personality`（8 维，0–1） |
| situation | `internalSituation` |
| speech.style / samples | `voiceBlueprint`（interactionStance、rhythmTendency、disclosureStrategy、silenceStyle 由 style 填入；surfaceDynamics 取由性格推出的默认值）、`voiceSamples` |
| desires | `ecologyProfile.desires`（verb/object/outcome → desiredState；strength → baseStrength；`target` 指向蓝图里点名的人/地点/物件，解析不到则放进 report 警告） |
| principles / boundaries | `ecologyProfile.principles` / `boundaries` |
| memories / secrets | `agentMemory.episodes`（backstory，来源 firsthand）与 `beliefs`；secrets 只进本人记忆 |
| routine | 人物的**作息习惯**（`lifeProfile.activities.routine` + 新字段 `routineHabits`），供人物自己每日写日程时参考（§9.3） |
| relationships | `relationships`（feelings → 13 维 metrics，address → addressingRule/allowedAddresses） |

体能与饮食档案（sustenanceProfile）等引擎字段取统一默认值（与借星相同的普通人档）。

### 7.3 物件、活计、时限、社会规则、报告

- 物件：目录默认物件（按建筑类型）+ 蓝图 `opening.objects`。id 规则 `<worldId>_<siteId>_<slug>`。
- 活计：目录模板按建筑实例化（区、物件、工具 id 替换）。
- 时限：`opening.deadlines` → `agenda.items`（dueClock 换算为开场后秒数；条件里的物件名/地点名解析为 id，解析失败进 report 并阻止编译）。
- 社会规则：每户对自家建筑的 `ownership_claim` + 室内区的 `boundaries`（户内成员豁免）；铺子营业时段内铺面为 `public_access_declaration`。
- 报告指标：每个时限条件涉及的数值状态与持有关系自动列为指标。
- 悬念：`opening.mysteries` → `mysteries`。

### 7.4 自检

编译后自动运行：`validateWorldPack`（含 §9.6 的小镇规则）与 `worldSmoke`（零模型调用的可达性冒烟）。任何 error 阻止“开始”；warning 只提示。每条问题带回 `blueprintPath`，审改页可跳到对应字段。

## 8. 像素地图（layout v2）

### 8.1 格式

```jsonc
{
  "layoutVersion": 2,
  "maps": {
    "exterior": { "grid": { "cols": 96, "rows": 64, "tile": 16 }, "theme": "day", "zones": { ... }, "floors": [...], "walls": [...],
                  "doors": [...], "props": [...], "objects": { ... }, "spots": { ... }, "blocked": [...], "roofs": [ { "siteId": "chen_home", "rect": [..] } ] },
    "interior:chen_home": { "grid": { "cols": 14, "rows": 10, "tile": 16 }, "zones": { ... }, ... }
  },
  "zoneMap": { "chen_home__kitchen": "interior:chen_home", "street_3": "exterior" },
  "portals": [ { "siteId": "chen_home", "exteriorZoneId": "street_3", "exteriorDoorTile": [40, 22],
                 "interiorMapId": "interior:chen_home", "interiorZoneId": "chen_home__hall", "interiorDoorTile": [6, 9] } ]
}
```

每张图的内部格式与现有 layout v1 相同（`tiles.js` 的 `buildScene` 原样可用）。v1 布局视为只有 `exterior` 一张图，旧世界不改。

观察台把所有图按格子平移拼成一张“图集”（外景在左上，室内依次排在下方），镜头每次只显示一张图的矩形。跨图走路是“走到这一侧的门 → 跳到另一侧的门 → 继续走”。“哪些格子能走”只在 `src/worlds/layoutGeometry.mjs` 定义一次，验证器和观察台共用（P3 计划的设计要点）。

### 8.2 外景规划器（`compiler/townPlanner.mjs`）

确定性（种子）、分步：

1. 按 terrain 方位划出地貌带：河（带桥）、林、山、田；镇区在中间。
2. 镇区放一个广场 + 主街，再按建筑数量长出支巷（网格骨架，街宽 2 格）。
3. 建筑按类型占地（home 6×5、smithy 7×5、inn 9×7…，目录给出），沿街摆放，门朝街；铺子靠近广场，住户靠外；同户的住宅与铺子相邻。
4. 室外地点落在对应地貌带（forest → 林带边缘与深处），用小路连到镇区。
5. 把占地与街段写成区（zones.rects）、门（doors）、阻挡（blocked）、点位（spots：每区 ≥ 居民上限个站位）。
6. 装饰：树、草丛、篱笆、水井、灯笼、摊位，按种子散布但不压在路和门上。

不变量（契约测试检查）：所有区在地图上有矩形；所有拓扑边对应地图上相邻或有门的两块；从任一街段能走到任一门；建筑、街道、水面互不重叠；地图尺寸 ≤ 128×96。

### 8.3 室内模板（`compiler/interiors.mjs`）

每种建筑类型 1–3 个手工设计的室内模板（房间矩形、墙、门、家具道具、物件摆位、站位），编译时按种子选一个并按房间数（卧房×n）拼接。物件按类型放到模板给定的位置。

### 8.4 观察台 v2

- 镜头：外景大地图可拖动/滚轮缩放（整数倍），“跟随”时镜头平滑跟着当前说话的人。
- 小地图（右上角）：显示全镇、每个人的位置点（颜色同衣服），说话的人闪烁；点击跳转。
- 进屋：点击屋顶或小地图上的建筑 → 切到该建筑的室内图；室内有人说话时，外景屋顶上冒一个小对话图标；跟随模式下，当前事件发生在室内时自动切进去、结束后切回外景（可关闭）。
- 现有对话框、头顶标签层、时间轴、右侧面板保留；右侧人物名单变为可滚动的户别分组。
- 昼夜：按世界时钟给外景加色调（清晨、正午、黄昏、夜晚），室内灯火。

## 9. 小镇规模运行时

### 9.1 人物调用模式

小镇世界默认且只用**演绎模式**（一次调用一拍，~3–5k 字提示词）。三段调用模式保留给内置世界。

### 9.2 感知范围

- `maxVisualDistance`、`maxSoundDistance` 来自世界包 `stage.perceptionEnvironment`；`observableCharacters` 与声音路由按距离截断。缺省（旧世界）= 不截断，保持旧行为与金样等价。
- 外围事件规则（已实现：别处房间的小动作、一瞥、歇下只被看见、不唤醒）继续生效。

### 9.3 日程与作息（人物自己的计划，世界照办）

经验基座第 10 条“程序不替人物选择”仍是硬约束。做法：

1. 每天开始（或开场）时，每个居民有一次**写日程**的拍子（一次演绎式调用，输入：作息习惯、心事、今天已知的事），由人物自己写出今天的日程：若干时段，每段 = 去哪（site）+ 做什么（活计 id 或“歇着/睡觉/闲逛”）。
2. 到点时，如果这个人**没有待处理的新证据**（没人对他说话、没出事、没有临近时限），世界就**按他自己写下的日程**执行这一步：沿最短路走过去（每段路正常结算，路上会被别人看见），到了开工或歇着。记录来源 `own_plan_step`，观察台标“按自己的日程”。
3. 任何时候有新证据送达，人物立刻得到完整的一拍，可以改变或放弃日程；日程只是他自己的承诺，不是指令。
4. 走到有人的地方不算新证据；有人跟他说话、递东西、发生与他相关的事才算（沿用现有唤醒规则 + 外围规则）。
5. 睡觉是长等待：夜里只有被吵醒、到点起床或时限才会唤醒。

结果：大部分时间里，只有“身边正在发生事情的人”在调用模型，其他人按自己写的日程活动。花费近似 = 居民数 × 每天 1 次日程 + 实际发生的互动拍子。

### 9.4 提示词随规模的约束

演绎提示词里的“你能去哪”按层级列出：当前建筑的房间 + 镇上**他知道的**地点（site 名，不列街段 id），走远路由世界按路线逐段结算。“此刻”只列同区和相邻区的人与物；“你知道的人”来自关系与记忆。提示词上限 8k 字（契约测试检查 20 人小镇）。

### 9.5 世界时钟与节奏

小镇默认 `sceneTimePolicy`：move 20s/段、look 30s、listen 30s、speech 4 字/秒 + 6s 停顿、rest 300s、reflection 间隔 1800s。观察台时间显示为“第 N 天 HH:MM”与开场时辰标签。

### 9.6 验证器的小镇规则

`validateWorldPack` 增加（`pack.meta.scale === "town"` 时启用）：

- V6 改为：`sceneCast` 不再限 5 人；改查“开场时同一区 ≤ 6 人”。
- V10 每个居民的作息习惯里的地点存在且可达；V11 每个活计的工具在开场时有人能拿到；V12 感知距离已设置；V13 布局 v2 不变量（§8.2）。

### 9.7 玩家化身预留

拓扑、调度与提示词构建都以“人物 id”为单位；玩家化身将来是一个 `controller: "player"` 的居民，他的拍子由界面输入而不是模型。第一版只在数据结构上保留 `controller` 字段（默认 `"model"`），不做界面。

## 10. 世界事件（天意）

观察台底部“世界事件”按钮，打开事件面板；事件**立即**或**定时**发生，由世界结算，结果像其他事实一样送达看见/听见的人，人物自己决定怎么反应。

| 事件 | 结算 |
|---|---|
| 天气（下雨/起雾/放晴/大风） | 改 `perceptionEnvironment`（能见度、噪声）与室外活计效率；室外的人收到天气证据 |
| 来客 | 从世界的“可能来客”名单（蓝图里可写，模型可补）加入一个居民，出现在出镇路口 |
| 东西出现 | 在某处放一件物件（如一封信、一只受伤的小狗），附带可观察描述 |
| 消息 | 一个人收到一条口信/信件（物件或直接送达的证据） |
| 小意外 | 物件状态改变（井绳断了、炉火熄了） |

所有事件在存档里记为 `world_event`（来源 `player`），观察台标注“天意”。不允许直接改人物心理或替人物说话。

## 11. 设置、存储与分发

- 数据目录：`~/.character-town/`（可用环境变量 `CHARACTER_TOWN_HOME` 覆盖）：`settings.json`（权限 0600）、`worlds/<id>/`。运行存档 P1–P6 沿用项目内 `sim-runs/`；P7 再迁到数据目录的 `runs/`（旧目录继续可读），避免玩家更新游戏时丢档。
- 设置：提供方（Google Gemini 原生 / OpenAI 兼容网关）、地址、密钥、模型名、输出格式。接口 `GET /api/settings` 只返回是否已配置与掩码（`sk-…a1b2`），`PUT /api/settings` 只接受同源 JSON；密钥只存在设置文件与服务进程内存，传给子进程用环境变量，不写进任何存档、日志、导出文件。
- 测试连接：发一次最小请求（同 `--probe`），显示返回的模型名与耗时。
- 运行和生成都需要“我授权本次调用真实模型，最多 N 次请求”的确认（沿用现有授权）。
- 服务只绑定 127.0.0.1。
- 分发：仓库根目录 `start.command`（macOS）与 `start.bat`（Windows）：检查 Node ≥ 24（缺少时提示去 nodejs.org）、首次 `npm ci`（目前无依赖则跳过）、`npm start`、打开浏览器。README 增加“三步开始玩”。以后再考虑 Electron 打包。

## 12. 花费估算

审改页与开始前显示：生成世界约 `6 + ⌈居民数/4⌉` 次调用；模拟每个游戏小时约 `居民数 × 日程(每天1次)/24 + 互动拍子估计`，按最近运行的平均输入/输出长度给出 token 估算（只说“约”，不承诺）。

## 13. 测试策略

- 蓝图：`validateBlueprint` 契约（每条 B 规则正反例）。
- 编译器：3 份夹具蓝图（`scripts/fixtures/blueprints/{tiny_hamlet,river_town,forest_village}.json`），断言编译确定性（摘要固定）、`validateWorldPack` 全绿、`worldSmoke` 全绿、布局不变量全绿。
- 运行时：感知距离截断（旧世界不变 + 金样等价）、日程照办与新证据打断、20 人小镇提示词 ≤ 8k 字、空闲时只有日程到点的人被调度。
- 模型生成：用假模型（脚本化返回）测分段生成、校验失败的修复回路、“重写本页”只改本页。
- 接口：设置读写不泄露密钥、同源与 JSON 要求、世界库增删导入导出。
- 前端：静态资源契约 + 关键纯函数（镜头、小地图坐标换算、门户切换）单测；每阶段在浏览器里人工走查一遍主流程。
- 每阶段收尾：`npm run check` 与 `npm test -- --concurrency 6` 全绿。

## 14. 分阶段

| 阶段 | 内容 | 验收 |
|---|---|---|
| P1 设置与本地存储 | 数据目录、设置接口与页面、测试连接、用户世界库（JSON 世界包加载、导入导出）、通用模型 JSON 调用 | 不填环境变量也能在页面里配好密钥并跑现有世界；密钥不外泄契约全绿 |
| P2 蓝图与编译器（不含地图） | 蓝图 schema 与校验、目录、编译器（拓扑/人物/物件/活计/时限/社会/报告）、v1 简易地图占位（按区排成格子） | 3 份夹具编译后验证与冒烟全绿；能在现有观察台跑起来 |
| P3 像素小镇地图 | 外景规划器、室内模板、layout v2、观察台镜头/小地图/进屋/昼夜 | 3 份夹具的地图不变量全绿；浏览器走查能看清全镇与室内 |
| P4 小镇运行时 | 感知距离、日程照办、提示词分层、小镇节奏、验证器小镇规则 | 20 人夹具零模型 1 天模拟：调度次数在预算内、无全镇惊醒、旧世界金样不变 |
| P5 快速模式生成 | 模型分段生成蓝图、修复回路、重写本页、上传文本 | 假模型契约全绿；真模型试一次（用户授权） |
| P6 开始界面与创建向导 | 标题画面、捏世界模式（捏人、关系、开场）、审改页、编译预览、开始；世界事件面板 | 两种模式都能从零走到观察台；事件被世界结算并出现在观察台 |
| P7 分发 | start 脚本、README、首次启动引导 | 新机器按 README 三步能玩 |

每阶段结束：Gemini 提交 → Claude 审核（代码 + 契约 + 浏览器走查）→ 通过后进入下一阶段；审核可能修订后续阶段的计划。

## 15. 这一版不做

玩家扮演（只留字段）、网站多人版、跨地点（多个小镇/远行）、自定义美术素材导入、手动画地图编辑器（只能重掷种子与改蓝图）、.docx 解析（先支持粘贴、.txt、.md）。

## 16. 风险

| 风险 | 应对 |
|---|---|
| 模型生成的居民卡空洞、雷同 | 分段生成 + 每人单独一次补全调用；B9 文本上限与“欲望落地”校验；审改页可重写单人 |
| 小镇地图难看 | 先做好 3 个室内模板与街巷骨架，装饰按种子；预览可重掷；P3 走查后再调 |
| 日程照办被理解为“程序替人选择” | 日程由人物自己写；有新证据即交还；记录来源 `own_plan_step`；观察台如实标注 |
| 人多导致花费失控 | 感知截断 + 外围规则 + 日程照办；开始前花费估算；请求上限授权 |
| 演绎提示词随规模膨胀 | §9.4 分层与 8k 上限契约 |
