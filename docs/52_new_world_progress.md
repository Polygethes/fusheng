# Phase P1 Progress Summary

## 阶段目标
构建本地数据层与模型网关解耦、设置管理、观察台设置弹窗以及用户世界存储与库管理 API。

## 完成任务与交付物

### 1. P1.1: 本地数据主目录与设置隔离
- **文件**: `src/server/localData.mjs`, `scripts/localDataContracts.mjs`
- **特性**:
  - 支持 `CHARACTER_TOWN_HOME` 环境变量或默认 `~/.character-town`。
  - 严格权限 `0600` 保存 `settings.json`。
  - 支持数据校验、密钥掩码视图（如 `sk-...def`）以及向子进程注入 `modelEnv`。
  - 测试契约：`npm run local-data:test` 100% 通过。

### 2. P1.2: 模型调用解耦与网关适配
- **文件**: `src/server/model/modelClient.mjs`, `src/server/ecology/geminiCharacterStage.mjs`, `scripts/modelClientContracts.mjs`
- **特性**:
  - 实现通用 `callModelJson`，支持 Google Gemini 官方格式与 OpenAI 兼容网关。
  - 支持指数退避重试（针对 429、502、503、504、网关非 JSON 等异常）。
  - 自动剥离 Markdown 代码块和非 JSON 外壳。
  - 错误信息和异常中绝不泄露 API 密钥。
  - `geminiCharacterStage.mjs` 重构成委托给 `callModelJson`。
  - 测试契约：`npm run model-client:test` 100% 通过。

### 3. P1.3: 设置 API 与服务端启动环境联动
- **文件**: `src/server/observer/settingsApi.mjs`, `src/server/observer/runsApi.mjs`, `server.mjs`, `scripts/settingsApiContracts.mjs`
- **特性**:
  - 提供 `GET /api/settings`、`PUT /api/settings`、`POST /api/settings/test`。
  - 同源请求校验（防 CSRF）。
  - `createRunsApi` 支持动态/异步解析 `env`，自动取最新的保存设置启动运行，无需重启服务器。
  - 测试契约：`npm run settings-api:test` 100% 通过。

### 4. P1.4: 观察台设置弹窗
- **文件**: `stage.html`, `src/stage.css`, `src/stage/settings.js`, `src/stage/ui.js`, `src/stage/main.js`
- **特性**:
  - 观察台头部增加“设置”按钮与模态窗口。
  - 支持切换 Gemini 官方与 OpenAI 兼容网关，填入 Base URL、API 密钥、模型名称、输出格式。
  - 支持“测试连接”（先静默保存再请求测试）与连通性反馈。
  - 开新运行/继续运行面板实时联动设置状态；未配置 API 时禁用开始并提供设置跳转引导。

### 5. P1.5: 用户世界存储与世界库 API
- **文件**: `src/worlds/userWorldStore.mjs`, `src/worlds/registry.mjs`, `src/server/observer/worldsApi.mjs`, `scripts/userWorldStoreContracts.mjs`
- **特性**:
  - 用户世界保存在 `<dataHome>/worlds/<id>/`，支持 `pack.json`、`blueprint.json`、`report.json`。
  - `listWorldPackIds` / `loadWorldPack` 统一支持内置世界与用户世界，内置世界优先。
  - 禁止覆盖或删除内置世界（报 `WORLD_ID_RESERVED` / 403 `BUILTIN_WORLD_IMMUTABLE`）。
  - 删除用户世界支持软删除到 `.trash/<id>-<timestamp>`。
  - 支持打包导出 `character-town-world` 格式 bundle 与同源导入，导入遇 ID 冲突自动递增后缀（`-2`, `-3`）。
  - `worldsApi` 提供 `GET /api/library`、`POST /api/library/import`、`GET /api/library/:id/export`、`DELETE /api/library/:id`。
  - 测试契约：`npm run user-world-store:test` 100% 通过。

## 验证结论
- `npm run check` 语法检查全部通过。
- 全量契约套件：576 项契约全部通过，0 失败（包含所有已有回归测试与新增 P1 契约及安全修复契约）。
- 端口 8787 服务保持运行未重启，所有新开发与功能验证均在独立端口/单元测试中完成。

## P1 审核修正 (Review Fixes - 2026-10-10)

根据审核报告（`docs/superpowers/reviews/2026-10-10-p1-review.md`）中的 Group A / Group B 意见，完成了系统性排查与加固，均按 TDD 方式（先写失败契约，再修复验证）提交：

### A1: Gemini 切换与部分字段更新
- **Commit**: `b4f9948`
- 修复：切回官方 Gemini 时，清除旧网关的 `baseUrl`，并从子进程环境变量中彻底移除 `GEMINI_API_BASE_URL`。
- `validateSettingsPatch` 支持基于当前设置合并校验局部补丁。

### A2: 防范 DNS 重绑定攻击与地址变更防盗取密钥
- **Commit**: `49a5b3c`, `88c8f94`
- 契约：`scripts/localGuardContracts.mjs` (`npm run local-guard:test`)。
- 修复：在 `src/server/localGuard.mjs` 中实现 `isLocalHostHeader`，限制 `/api/*` 请求的 Host 必须为合法本地域名/IP (`localhost`, `127.0.0.1`, `[::1]`) 及端口。
- 防御性控制：当设置变更 Base URL（修改 Host）时，若已有 API Key 但补丁未重新提供 Key，拒绝并要求用户重新输入 Key (`KEY_REQUIRED_FOR_NEW_HOST`)，防止恶意篡改 Base URL 将已有密钥打往攻击者服务器。

### A3: 用户世界导入校验闭环
- **Commit**: `edce67b`
- 修复：在 `importUserWorld` 保存落盘之前，依次执行 `defineWorldPack`、`validateWorldPack`（校验 Schema 与规则），以及 `runWorldSmoke`（执行冒烟测试）；若有任何 issue 立即拒绝导入并返回 `WORLD_PACK_INVALID`，不写入磁盘。

### A4: 契约测试与真实 ~/.character-town 隔离
- **Commit**: `7f91594`
- 修复：修改 `scripts/runContracts.mjs`，在跑全量测试套件时，生成临时目录并注入 `CHARACTER_TOWN_HOME`，避免测试生成的草稿或世界污染用户的真实主目录。

### A5: 观察台开新面板模型同步优化
- **Commit**: `8137f0d`
- 修复：仅当用户已显式配置过设置时（`settingsRes.settings.configured === true`），观察台“开新运行”面板才自动覆盖模型名称；未配置时保留世界或默认推荐模型。


## Phase P2 阶段完成小结 (World Blueprint & Compiler)

### 阶段目标
构建从人类可编辑的世界蓝图（Blueprint）到完整 Town 级 WorldPack 的编译与验证系统，包含城市规划、拓扑编译、人物塑造、关系、物件、活计、时限、开场生成、占位地图生成以及零模型性能验证。

### 完成任务与交付物

#### 1. P2.1: 蓝图 Schema 与语义验证规则 (B1–B9)
- **文件**: `src/worlds/blueprint/schema.mjs`, `src/worlds/blueprint/validateBlueprint.mjs`, `scripts/blueprintContracts.mjs`
- **特性**:
  - 定义 `BLUEPRINT_VERSION = 1` 及其各节（`meta`, `town`, `households`, `residents`, `relationships`, `opening`）完整规范。
  - 实现验证器校验 B1–B9 全部规则（版本、地点引用、地点类型、连通性、户与家庭成员、开场位置、时限完备性、外貌发型/调色板、单次出现约束）。
  - 测试契约：`npm run blueprint:test` 100% 通过。

#### 2. P2.2: 基础资产目录 (Catalog)
- **文件**: `src/worlds/catalog/siteTypes.mjs`, `skills.mjs`, `appearance.mjs`, `edges.mjs`, `index.mjs`, `scripts/catalogContracts.mjs`
- **特性**:
  - 22 类地点规格：建筑 `home`、`smithy`、`inn`、`shop`、`herb_shop`、`clinic`、`temple`、`school`、`farmhouse`、`mill`、`post`；室外 `square`、`street`、`market`、`well`、`field`、`forest`、`river_bank`、`bridge`、`pond`、`hill`、`road_out`。（审核更正：原文写成 14 类，与代码不符。）
  - 技能等级、外貌调色板、拓扑边通行方式（通过省略不可达模态替代 `Infinity` 保持 JSON 兼容）。
  - 测试契约：`npm run catalog:test` 100% 通过。

#### 3. P2.3: 城镇规划器与拓扑编译器
- **文件**: `src/worlds/compiler/rng.mjs`, `simplePlanner.mjs`, `topology.mjs`
- **特性**:
  - `simplePlanner` 确定性街巷布设与门前路关联。
  - `compileTopology` 编译为标准 WorldPack 拓扑结构：室内/室外区划分、路段连通、门与出入口模态。

#### 4. P2.4: 角色塑造、关系、物件、活计与时限编译器
- **文件**: `src/worlds/compiler/castShapes.mjs`, `cast.mjs`, `relationships.mjs`, `objects.mjs`, `agenda.mjs`
- **特性**:
  - `castShapes.mjs` 抽出与借星同形的 `profile`、`desire`、`episode`、`belief`、`voice` 帮助函数。（审核更正：原文的“16 种生活形态”并不存在。）
  - 自动生成对称/非对称人际关系、工作活计（`work`）状态机、物件（`objects`）初始分配、家庭/商户边界规则（`social`）以及时限判定（`agenda`）。
  - 纯确定性随机数与索引生成，确保同一蓝图编译输出 digest 100% 一致。

#### 5. P2.5: 世界包组装、占位地图与脚本化 6 拍演绎
- **文件**: `src/worlds/compiler/placeholderLayout.mjs`, `src/worlds/compiler/index.mjs`, `scripts/worldCompilerContracts.mjs`
- **特性**:
  - `compileBlueprint` 完整组装为 WorldPack。
  - 支持 `scale: "town"`，`validateWorldPack` 适配小镇规模（放宽总人数限制为单区密度检查）。
  - 占位网格地图生成器（`placeholderLayout`）为所有地点、房间、门和物件生成合规坐标与站点。
  - 6 拍脚本化动作（李小禾离家到药铺、与王婶对话、取药、端详），直接向结算器提交，零模型调用。（审核更正：原文写成“王大夫”；这组测试绕过了人物运行时，按计划要求的演绎模式测试见下方“P2 审核修正”的 A10。）

#### 6. P2.6: 真实城镇夹具与编译命令行工具
- **文件**:
  - `scripts/fixtures/blueprints/river_town.json`: 5 户、14 人水乡渡口（青溪渡），涵盖客栈、铁匠铺、百草堂、渡口与桥下暗匣。
  - `scripts/fixtures/blueprints/forest_village.json`: 4 户、10 人山野村落（雾松岭），涵盖磨坊、猎户院、樵夫木舍与山间药舍。
  - `scripts/worldCompile.mjs` (`npm run world:compile`): 编译蓝图命令行，打印编译报告、验证与冒烟结果，支持 `--seed` 与 `--save` 保存至世界库。
- **特性**:
  - 全夹具通过 `validateBlueprint`、`compileBlueprint`、`validateWorldPack`、`runWorldSmoke` 与存储契约。

### 验证结论
- `npm run check` 语法检查全部通过。
- 全量契约套件：579 项契约全部通过，0 失败。
- 端口 8787 现有服务保持完好运行未触碰。

## P2 审核修正（2026-10-10）

修正单：`docs/superpowers/reviews/2026-10-10-p2-review.md`。A1–A7 由 Gemini 完成（`eec21f5..d17af11`）。A8 的条件写法、A11 和 B 组由 Claude 接手完成，A10 契约由 Claude 补齐并登记。

### 做了什么

- **数据结构与借星一致（A1–A4）。**
  - 拓扑区用 `label`。
  - 活计输出 `taskLabel`、`unitAction`、`durationSecondsPerUnit`、`requiredSkillLabel` 等引擎字段，只保留数值增减效果。
  - 社会规则输出 `facts` 和 `boundaries`（铺面不算私宅）。
  - 感知环境与报告的形状同借星。
  - `compiledPackShapeContracts` 逐节对照借星的键路径。Claude 补了社会规则和拓扑边两节；省略的感知模态写进白名单并注明原因。
- **人物（A5、A6）。**
  - 输出 `voiceBlueprint`，“为人处世”取蓝图 `speech.style` 原句，只写一次；节奏、披露、沉默三处留空，不重复。
  - `activeGoal` 取第一条欲望，不再重复处境。
  - 称呼规则用名字，比如“李小禾对李大山称‘爹’。”
  - 秘密只进本人记忆。
- **去掉夹具专用的写死规则（A7）。**
  - `resolve.mjs` 先找全名，再找本人对外关系里的称呼，最后找重合最长的名字（至少两个字）；同时看欲望的对象和“盼着”两段文字。
  - `compilerNoFixtureHardcodingContracts` 检查编译器、目录、蓝图三个目录，自动跳过目录自带的通用词（如“铁匠铺”）。
- **时限和“要做出来的东西”（A8，Claude 接手）。** Gemini 原本让编译结果写成 `object_ready`，再去改验证器和冒烟测试认这个写法，但引擎的 `worldTemporalAgenda` 不认识它，真实运行里这类时限永远完成不了。现改为：
  - 编译器直接输出引擎认识的写法：`object_ready` 编译为 `object_state`（`progress ≥ needed`），`actor_at` 编译为 `actor_zone`。未提交的验证器和冒烟测试改动已撤回。
  - 每件 `madeAt` 物件单独生成一个活计：同技能、同房间，份数等于 `needed`，带 `completionCondition`，做满即止。同一地点的其他活计不会推进它。蓝图可用 `madeWith` 指定活计种类（规格 §5 已补）。
  - 目录里“设成某值”的效果不再当成“加上某值”，否则茶壶会越加越多。
  - 药铺“配药”改为只要求“采药”。计划原意是“医术或采药”，引擎只支持“全部都要会”。
  - 新契约 `compiledDeadlineContracts` 检查四件事：只用引擎认识的条件；开场时都未达成；引擎自己的判定在条件达到后认可；冒烟测试能按时达成。
- **观察台能画出来（A9）。**
  - 占位布局输出 v1 格式（`grid`、`floors` 等），地面材质按地形选：木地板、土路、石板、草地、小径。
  - 浏览器走查（8798 端口，临时 `CHARACTER_TOWN_HOME`）：`world:compile river_town --save`、`world:new`，打开观察台能看到格子图和 14 个人。存档界面同时显示河镇存档和借星、逍遥游的旧存档，缩略图正常。截图在本次会话中，临时存档已删除。
- **演绎模式契约（A10）。** `compiledPromptCleanContracts`：
  - 李小禾一路走到药铺铺面，王婶被说话唤醒，回话对象是她，并称她“小禾”。
  - 三份夹具每个人的提示词里都没有 id，【你怎么说话】里能看到蓝图的说话风格原文。
  - 这一轮新写的 5 条契约原先都没有登记进 `package.json`，`npm test` 不会运行它们，现已登记。
- **蓝图校验（A11，Claude）。**
  - 新增 `schemaCheck.mjs`，按 `BLUEPRINT_SCHEMA` 检查类型、必填、多余字段、枚举、长度、条数、格式。问题按规则归类（B0 形状，B3、B7、B8、B9 归入各自规则）。
  - B2 检查地点类型是否在目录里、地点所属的户是否存在。
  - B4 检查欲望或作息是否落到实处。
  - B6 检查条件只有三种、所引用的物件存在、`object_ready` 必须对应 `madeAt` 物件、`madeAt`/`madeWith` 合法。
  - `blueprintContracts` 新增 B0/B2/B4/B6/B9 反例，并要求三份夹具都通过。
- **夹具。** 结构检查暴露出 `river_town`、`forest_village` 都不符合蓝图结构：缺 `premise`、`genre`、`tone`、`startDay`、`terrain`；户写成 `homeSiteId`/`members`；来客形状不对。户的问题导致河镇一条私宅规矩都没生成。现已按规格改写：
  - `tiny_hamlet` 与计划原文相比只多了两处 `madeAt`，时限条件改为“药包配好”加“在李大山手里”。
  - 河镇：重锚 `needed: 2`，“修好”加“交到渡口周渔夫手里”。药散截止改为巳时 10:30（原因见遗留问题 1）。宋大夫补上医术。方客本来就是居民，删掉了重复的来客条目。
  - 雾松岭：粮谷 `needed: 3`；油松木、松茯苓分别用砍柴、采药活计。
  - 6 条原本没落到实处的欲望，在“盼着”里写明了地点。三份夹具的暂定欲望现在都是 0。
- **B 组。**
  - B1：暂定说明改为中文。
  - B2：来客和定时事件不再悄悄丢掉，写进 `report.warnings`，说明会在 P6 出场。
  - B3：测试连接对 401/403 正确提示“密钥被拒绝。”（原来读错字段 `err.status`），并加了契约。
  - B4：新增 `serverLocalGuardContracts`，真的启动 `server.mjs`，用伪造的 Host 读设置、改设置、触发测试连接，都返回 403，设置没有被改动。

### 怎么验证的

- `npm run check` 通过；`npm test -- --concurrency 6`：585/585 全绿（227.2s）。比修正前多出的 6 项是这一轮新登记的契约：5 条编译产物契约和 1 条真实服务的 Host 检查。
- 编译出的青石坳在演绎模式下跑通（不调用模型），读出人物实际收到的提示词。地点、活计、技能、称呼都是中文，说话风格只出现一次。
- 浏览器走查见上文 A9。

### 遗留问题

1. **冒烟测试按截止时间依次处理时限。** 每完成一件就把时钟拨到它的截止时间，所以两件时限的工作量之和超过它们截止时间的间隔时，会误报“只能逾期”。真实运行中不同的人可以同时干活。目前在河镇夹具里错开截止时间绕过；P4 再把冒烟测试改成按人并行。
2. **占位布局只是格子图。** 区按网格排开，门画在两区中心连线的中点，不一定落在相邻的两格之间。没有墙，所以人物的走位动画不真实。P3 用正式的外景和室内图替换。
3. **日常活计没有物件效果。** 生火、添茶之类目录里的“设成某值”效果，引擎目前表达不了，干脆不输出，活计只表现为时间、体力和声音。如果以后需要，要在引擎里加“设值”效果，不在编译器里假装。
4. **暂定欲望统一指向自家门口。** 解析不到的欲望写进 `report.provisional` 的中文说明。P6 的审改页需要让玩家给它挑一个具体目标。
5. **`madeWith` 缺省取地点类型的第一种活计。** 对有多种活计的地点（林子有采药和砍柴），蓝图作者或 P5 的生成要写明用哪一种。

## Phase P3 执行进度与审核修正小结（2026-10-10）

**状态：Phase P3 已全部完成并通过审核修正（A1–A5 与 B1–B3 全部落实）。全套 590 项契约 100% 通过，走查截图完整存档，服务与临时目录清理完毕，P4 尚未开始。**

### 已完成的任务 (P3.1–P3.8)

| 任务 | 交付与验证 | 提交 |
| --- | --- | --- |
| P3.1 | 共享可走格几何、图集、指定 v2 验证分支；观察台使用共享几何，世界摘要带 `startClock`。原文提供的三个模块及契约逐字复制，v1 验证路径保持原样。通过 `layout-v2:test`、世界包核心／验证／运行等价与观察台 API 契约、`npm run check`。 | `5f3603e9` |
| P3.2 | 共用房间展开、拓扑边类型修正、正式外景规划器。通过原样 `town-planner:test`、`compiler:test`、`npm run check`。三夹具与 16 栋建筑大镇覆盖种子 1/2/3/7/42；额外检查房屋一格间距、四个方向的河与林共边、桥跨水及岸边通路。 | `3ae8a754` |
| P3.3 | 房间树室内图、墙与门、固定家具／可拿物件、灯光与站位。契约、房间树函数、两组家具常量逐字复制。通过 `interiors:test`、`compiler:test`、`npm run check`；240 次建筑／人数／模板／种子组合检查全部可走格可达、家具完整阻挡、非房间区域有墙。 | `b9eada34` |
| P3.4 | 编译城镇为外景与逐栋室内图；删除旧规划器与占位布局，生成 `layoutVersion: 2` 图集；迁移旧契约并保持干净提示词断言完整。通过 `compiled-town-map:test` 与全部编译契约。 | `dbea87a8` |
| P3.5 | 观察台图集挂载、多地图行走、跳图过渡与屋顶绘制；支持 opening 门画法与室内外跳转 `onJump`。通过观察台与编译地图契约。 | `3dad4bd2` |
| P3.6 | 观察台相机：视口平移、3 级缩放、跟随说话人、跨室内外平滑切图，滚轮缩放与拖拽抓取。 | `8896863d` |
| P3.7 | 观察台小地图：160px 外景等比微缩、屋顶勾边、室内人数角标、室外人物点与说话人闪烁；名册按户归组；屋顶说话气泡提示。 | `2e8283f3` |
| P3.8 | 按时辰天光与路灯着色：24 小时光照关键帧插值、室内/外独立阴影蒙版、相机视口局部渲染优化；暴露 60 帧平均帧率接口 `window.__stage.fps`。 | `9821b2ef` |

---

## P3 审核修正 (Review Fixes - 2026-10-10)

根据审核报告（`docs/superpowers/reviews/2026-10-10-p3-review.md`）要求，完成 Group A 与 Group B 全部修复，恪守“不削弱任何旧契约断言，只增加断言”原则：

### A 组（必须修）

#### A1: 借星人物名册坏了；河镇户名为空
- **Commit**: `8a31980`
- **修复**:
  - `runsApi.mjs` 中 `worldVisual` 限制只有 `pack.meta?.scale === "town"` 的世界才生成 `households` 分组；借星、逍遥游等世界固定返回空数组 `[]`，严格保持 P3 之前单列平铺布局。
  - 修复 fact 主键查询：从 `f.id` 改为 `f.factId`，正确解析 `household:` 前缀的户名。
  - `#roster` 容器在有分组户时才动态添加 `.grouped` class，保持 CSS `.roster.grouped { display: block; }` 样式隔离。
  - 契约 `observerRunsApiContracts.mjs` 增加断言验证：借星 households 为空、河镇包含“铁家”“林家”“宋家”“陈家”“周家”且成员非空、`startClock` 正确。

#### A2: 借星光照层变动与像素比对为 0
- **Commit**: `a9c8713`
- **修复**:
  - `src/stage/main.js` 中只对 v2 世界传递 `view` 和 `daylight`；v1 世界（如借星）保持调用与 P3 之前 100% 一致：`lighting.draw(ctx, t, { litSegments })`。
  - `lighting.js` 的 `view` 分支补齐视野内晨光斜线与暗边。
  - 实测像素比对（在借星页面控制台运行）：`diffPixels: 0`（0 个像素差异），借星画面完全一致。

#### A3: 外景未看到门：屋顶盖住外门
- **Commit**: `69f2167`
- **修复**:
  - 在 `src/worlds/layoutGeometry.mjs` 导出纯函数 `doorOnEdge(rect, doors)`，按格子而非 siteId 寻找门位于房屋的上下左右哪条边。
  - `src/stage/tiles.js` 支持四边开门：门在上下边留出一行画外墙与门洞，门在左右边留出一列画墙与门。
  - 在 `compiledTownMapContracts.mjs` 增加断言：每个屋顶四边中必须能找到对应 exterior door，且坐标与 portal 的 `exteriorDoorTile` 严格一致。

#### A4: 室内门洞被墙覆盖与隔墙样式
- **Commit**: `2b0747c`
- **修复**:
  - `src/worlds/compiler/interiors.mjs` 在生成隔墙时，排除所有门洞格子（`doorTiles`），并为门洞铺设子房间地面材质。
  - 隔墙根据尺寸合理化：横向单格为横梁，竖向单格为立柱，多格空白块使用 `top` 实心墙顶。
  - 在 `interiorsContracts.mjs` 增加断言：每个门洞格子不在任何墙体内，且必在某地面矩形内。

#### A5: 走查清理与截图补全
- 详见下文“走查验收与 7 组截图”。测试完成后彻底关闭临时端口（8798）服务进程，并清理所有临时存档目录。

---

### B 组（应该修）

#### B1: 撤回 `server.mjs` 中 `runsRoot` 的修改
- **Commit**: `9abd48a`
- **修复**: 撤回 `server.mjs` 针对 `runsRoot` 读环境变量的修改，保持 `runsRoot` 严格指向项目 `sim-runs/`，完全符合原有观察台运行契约。

#### B2: 屋顶说话提示改为 13×9 画布像素图标
- **Commit**: `ba6d280`
- **修复**: `src/stage/main.js` 在外景主画布渲染 pass 中，当说话角色身处室内建筑时，直接在世界坐标系下于对应屋顶上方居中绘制 13×9 像素对话气泡图标，每 1/3 秒闪烁，避免 DOM 标签层污染。

#### B3: 外景灯笼与商铺夜间光源
- **Commit**: `68be6e4`
- **修复**: `src/worlds/compiler/townPlanner.mjs` 在外景点缀灯笼时向 `map.lights` 添加 `{ at, r: 30, color: "#ffd890" }` 光源；所有商铺（非住宅）门前同样挂载光源。在 `townPlannerContracts.mjs` 增加外景光源断言。

---

### 走查验收与 7 组截图

在独立端口 **8798**（`CHARACTER_TOWN_HOME=/tmp/gtown-walkthrough-p3`）启动服务，生成测试存档，通过 `agent-browser` 捕获 7 组验证截图并归档至 `docs/screenshots/p3/`：

1. **`01_jiexing_v1_baseline.png`**：借星 v1 基线。右侧名单恢复 5 列平铺无分组、像素比对 `diffPixels: 0`、无任何光照漂移。
2. **`02_river_town_exterior.png`**：青溪渡整镇全景（缩放 0 档）。展示 5 栋建筑（门面清晰可见）、石桥、渡口、竹林与街道。
3. **`03_river_town_dusk_night.png`**：青溪渡夜景（20:00 戌时）。展示外景天光变暗、商铺与路口灯笼暖色光晕。
4. **`04_follow_step1_enter.png` / `04_follow_step2_speak.png` / `04_follow_step3_exit.png`**：跟随镜头三连走查（宋苓进出百草堂）：
   - 步 1：从外景跟随进入百草堂；
   - 步 2：在室内药铺说话；
   - 步 3：走出百草堂，镜头平滑切回外景街道。
5. **`05_forest_village_exterior_seed7.png`**：雾松岭种子 7 外景。展示 4 户小山村布局、山谷磨坊、林地与小地图。
6. **`06_river_town_interior_inn.png`**：青溪客栈室内房间图。大堂、后厨、客房之间的门洞畅通无横梁阻挡，家具陈列清晰。（原图是控制台直接切镜头截的，画布没跟着改尺寸；由 Claude 通过点屋顶进屋重截。）
7. **`07_river_town_interior_chen.png`**：陈家木屋室内房间图。堂屋与卧房门洞畅通，多格空白处为实心墙顶。（原图是控制台直接切镜头截的，画布没跟着改尺寸；由 Claude 通过点屋顶进屋重截。）

走查完成后，已确认杀死端口 8798 进程，删除了临时主目录 `/tmp/gtown-walkthrough-p3` 及 `sim-runs/temp-walkthrough-*` 临时数据。生产端口 **8787** 全程保持未受触碰。

---

### 实测帧率

- Claude 复核时实测：青溪渡外景、缩放最小一档、5 人同时走动，`window.__stage.fps` 为 120 fps（Apple 芯片，120Hz 屏，Chrome 内核预览窗口）。
- 视野分支只处理镜头矩形内的暗层，全镇图集不逐帧整张重绘。

---

### 测试统计与验证结论

- `npm run check` 语法检查全部通过。
- 全量契约套件：**590 项契约全部通过，0 失败**（`npm test`）；复核时全量 589/590，`tavern-v27-model-relay:test` 偶发失败（计时竞态，单独重跑通过，与 P3 无关）。
- 按照指令要求，Phase P3 全部收尾工作就绪，**停在 Phase P3，不启动 Phase P4**。

---

## Phase P4 小镇运行时（2026-10-10）

执行：Gemini 3.8 Flash（经 Claude 的执行器，逐个任务复制定稿文件、验证、提交）；规划与审核：Claude。审核记录见 `docs/superpowers/reviews/2026-10-10-p4-review.md`。

### 做了什么

- **感知距离（P4.1）**：小镇里看 2.5 段、听 3 段之外的人收不到证据；内置世界不设上限。
- **小镇规则（P4.4）**：
  - V10：作息地点存在且走得到；
  - V11：活计的工具拿得到；
  - V12：设了感知距离。
  - 小镇只能用演绎模式，请求 three-call 返回 `CALL_MODE_UNSUPPORTED`。
- **20 人夹具**：`scripts/fixtures/blueprints/big_town.json`。
- **提示词分层（P4.5）**：
  - 只列同区和相邻区的人、所在建筑的房间、他知道的地点（附“要走 N 段路”）；
  - 20 人小镇的提示词 ≤ 8000 字。
- **写日程（P4.2）**：开场和每天 05:00，每个居民写一份当天的日程，写进 `lifePlanState`。
- **照办日程（P4.3）**：
  - 没有新证据时，世界按居民自己的日程替他走路、开工、歇着、睡觉，每段路结算一次；
  - 有人说话或有新证据送达，下一拍交还给人物；
  - 观察台标“按自己的日程”；
  - 报告把这类步和人物的决定分开计数；
  - 运行器的 `--turns` 只数决定。
- **中继状态（P4.9）**：`/status` 停下时同时给出原因，消除全量测试里的偶发失败。
- **报告空转检查（P4.10）**：小镇里按日程走的步不再把真正的空转窗口挤掉。

### 怎么验证的

- `townDayContracts`：20 人走完一整天。turns 567，其中按日程走 486 步；写日程 40 次（开场 20 + 05:00 20）；真正的模型拍子 41 次。有人搭话时，下一拍由模型决定。
- 内置世界（借星、逍遥游）金样与等价性契约不变。
- 全量契约见下方“测试统计”。

### 测试统计

- `npm run check` 通过。
- `npm test`：596 项全部通过（P3 结束时 590 项，P4 新增 6 项契约）。

### 遗留

- 真实模型写出的日程质量还没看过，放到 P6 走查时的小规模授权运行。
- 观察台的“按自己的日程”标注只在契约里核对过，P6 走查时在浏览器里看。

---

## Phase P5 快速模式生成（2026-10-10）

审核记录见 `docs/superpowers/reviews/2026-10-10-p5-review.md`。

### 做了什么

- `src/worlds/generation/`：一句话想法（可附 ≤200KB 参考资料，截到 3 万字）分五段生成蓝图：
  1. 世界与小镇；
  2. 居民（每次 ≤4 人）；
  3. 关系；
  4. 开场；
  5. 修整（≤2 轮）。

  每段检查不过就带着问题清单重问，最多 2 次。仍不过就停下，交回已有部分。
- `rewriteSection`：只重写 meta、town、opening、某位居民或某条关系，其余逐字不变。
- 接口：`POST /api/create/generate`（SSE 进度）和 `POST /api/create/rewrite`。两个接口都要求同源、授权勾选、请求上限，不回显密钥。
- P5.1：发给模型的 schema 不含开放键对照表，`householdSizes`、`feelings`、`positions`、`state` 一律写成 `[{key, value}]` 列表，回答再还原成蓝图形状。

### 怎么验证的

- 假模型契约：`blueprint-generation`、`create-api`，外来 Host 的拒绝检查在 `server-local-guard` 里。
- 真实模型试运行（gemini-3.8-flash-high）：
  - 小镇 6 人，8 次请求，约 3 分钟，蓝图零问题，可以编译；
  - 两次重写各 1 次请求；
  - 一共 13 次请求。

### 测试统计

- `npm run check` 通过；`npm test` 598 项全部通过（比 P4 多 `blueprint-generation`、`create-api` 两项）。

---

## Phase P6 开始界面与创建向导（2026-10-11）

审核记录见 `docs/superpowers/reviews/2026-10-11-p6-review.md`。

### 做了什么

- **`play.html`：游戏自己的入口。**
  - 开始界面的背景是一座编译出来的像素小镇，镜头缓缓移动；
  - 菜单：新的世界 / 读取存档 / 世界库 / 设置；
  - 没配置 API 时提示先设置。
- **快速模式：**一句话或一段资料加规模，生成过程分段实时显示，结束后进审改页。
- **捏世界模式：**六步向导：类型 → 世界与小镇 → 地点与住户 → 居民 → 关系 → 开场。复用审改页的编辑器，每步有轻量检查，可以“让模型捏一个新居民”。
- **审改页：**
  - 五个页签：世界、地点、人物、关系、开场；
  - 右侧：编译检查（问题按页签计数，点问题跳到对应输入框）、地图预览（点屋顶看室内、换一张地图）、花费估算；
  - “开始”：存进世界库，建开场存档，打开观察台。
- **天意：**
  - 天气、东西出现、口信、小意外由世界结算，只有看得见、听得见或被点名的人知道；
  - 运行中的小镇可以从观察台的“天意”面板降下，标注“天意”。
- **小镇只用演绎模式：**开始运行的弹窗里，选小镇时不显示三段调用。

### 怎么验证的

- 每个任务的给定文件逐字节核对；契约全部通过。
- Claude 在浏览器里逐页走查（临时用户目录、真实模型），见审核记录。

### 测试统计

- `npm run check` 通过；`npm test` 613 项全部通过（P5 结束时 598 项）。

---

## Phase P7 分发（2026-10-11）

审核记录见 `docs/superpowers/reviews/2026-10-11-p7-review.md`。

### 做了什么

- `start.command`（macOS）和 `start.bat`（Windows）：检查 Node ≥ 24（不够就打开 nodejs.org），启动服务，2 秒后打开 `http://127.0.0.1:8787/play.html`。
- 存档写在 `<用户目录>/runs`（默认 `~/.character-town/runs`）。项目里旧的 `sim-runs/` 只读：照常列出、回放、接着跑，接着跑会在用户目录里开新的一段，存档槽把两边连起来。
- 首次打开没有配置 API 时，开始界面先弹出设置（每个浏览器会话一次）。
- README 开头改成给玩家看的“三步开始玩”，原来的内容收在“开发者说明”下面。

### 怎么验证的

- 新契约 `runs-roots`，以及 `observer-runs-api`、`world-events-api`、`build-api`、`server-local-guard`。
- 用一个空的用户目录按 README 走了一遍，见审核记录。

### 测试统计

- `npm run check` 通过；`npm test` 614 项全部通过。

## Phase P8 稳定、干预与混合模式（2026-10-11）

计划和审查由 Claude 负责，代码由 Gemini 执行器写。每项任务都先有契约，执行器不许改契约。

### 做了什么

- **P8.1 模型卡住不再拖住整场**（d87899b）：每次尝试按步骤设上限（演绎一拍 45 秒，日程 90 秒，深层心理 180 秒），超时就重试；报告里记下每次尝试的结果；观察台在等待超过 15 秒时显示“等模型回应 N 秒”。
- **P8.2 深层心理的短写输出**（46de1fd，默认关闭）：发给模型的结构换成短键、省掉固定值和空列表，回来后在本地还原成一字不差的完整对象。真实对比（12 次请求，用户批准）结果是**没有帮助**：可见输出少了约 21%，但模型思考量涨了 1–5 倍，中位耗时从 39 秒变成 46 秒，3 次里坏了 1 次；`json_schema` 格式被用户网关直接拒收（HTTP 400）。所以保持 `--wire canonical`。
- **P8.3 续跑沿用原模式**（c11e0a6）：从存档“继续”时默认用那一段原来的模式；没有记录模式的旧存档按深层心理处理。
- **P8.4 天意接到内置世界，加上授意**（85d96d9）：借星、逍遥游现在能放东西、捎口信、出小意外（天气仍只限小镇，因为内置世界没标出屋外）；新增“授意”，给一个人心里添一个念头，只有他自己从心里感到，做不做由他。两种模式下都验证过人物下一次思考真的看到了。
- **P8.5 出错原因**（7da6fe9）：出错停止时状态栏写出原因，并说明存档完好、可以继续。
- **P8.6 混合模式**（efa0c67、3590de1）：和演绎模式一样一拍一次调用，人物可以顺手记最多两笔心里的变化（看法的怀疑 / 认定 / 不再信、对某人的感觉、此刻最想做成的事），写进私人的“心理账本”，下一拍读回来；“停下来想一想”的那一拍最多三笔。观察台人物面板显示“心里的变化 · 私人”。内置世界和小镇都能用。

### 怎么验证的

- 新契约：`model-stall`、`compact-stage-wire`、`world-events-built-in`、`hybrid-mode`；`observer-runs-api` 增加续跑模式和出错原因的检查。
- 每项任务 Claude 先在副本里实现一遍，确认契约做得到，再交给执行器；执行器交回后逐行审查。
- 浏览器检查：借星的天意面板（天气隐藏、授意表单）、出错停止的原因、续跑时沿用演绎 / 深层心理、三种模式的选择、人物面板的新区块。

### 测试统计

- `npm run check` 通过；`npm test` 618 项全部通过。

### 还没做

- 混合模式还没有用真实模型跑过；三种模式的对比要用户批准后再跑。
- 混合模式里的“关键时刻深想一拍”（先列两三个打算再选）留到下一步。
