# 世界包基座 · 借星 · 像素观察台 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 运行时从世界包读取世界；逍遥游成为第一个世界包且行为不变；借星作为第二个世界包通过验证与冒烟；像素观察台可回放、实时观看并在授权后启停真实模型模拟。

**Architecture:** 世界包是纯数据模块（`src/worlds/<id>/pack.mjs`）。`buildPlayableWorldFromPack` 产出与现有 `buildPlayableWorldFromSetup` 相同形状的可玩状态；`createTavernWorldRuntimeV27` 增加 `worldPack` 选项，把地点、拓扑、社会事实/边界、时限、开场阵容、关系维度从常量改为查表，逍遥游世界包提供原值。观察台由纯函数 `observerFeed` 从存档推导帧，`server.mjs` 提供只读 + 授权启停接口，前端由像素原型模块化而来、按 `pack.layout` 渲染。

**Tech Stack:** Node ≥24 ESM、node:test / assert 契约脚本、`scripts/runContracts.mjs`、原生 Canvas 2D、SSE；无新增依赖。

**规格：** `docs/superpowers/specs/2026-10-09-world-pack-foundation-design.md`（世界包路径落为 `src/worlds/<id>/`，以便纳入 `npm run check` 与浏览器模块图）。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/worlds/worldPack.mjs` | `defineWorldPack(pack)`（必填段检查 + 深冻结）、`worldPackDigest(pack)` |
| `src/worlds/registry.mjs` | `loadWorldPack(id)`、`listWorldPackIds()`、`DEFAULT_WORLD_PACK_ID = "xiaoyaoyou"` |
| `src/worlds/xiaoyaoyou/pack.mjs` | 由现有常量组装的逍遥游世界包（引用，不复制） |
| `src/worlds/jiexing/pack.mjs`、`README.md`、`beacon/*.txt` | 借星世界包与信标抽取件 |
| `src/worlds/buildPlayableWorldFromPack.mjs` | 世界包 → 可玩状态（characters/relationships/tavernState 形状） |
| `src/worlds/validateWorldPack.mjs` | V1–V9 验证器 |
| `src/worlds/worldSmoke.mjs` | 零模型调用的可达性冒烟驾驶员 |
| `src/server/pipeline/tavernWorldRuntimeV27.mjs` | 新增 `worldPack` 选项；常量改查表 |
| `src/server/pipeline/tavernSceneConfiguration.mjs` | 逍遥游开场配置保留为数据源 |
| `src/server/simulation/worldTemporalAgenda.mjs` | 条件种类 + `knownByActorIds` |
| `src/server/simulation/workCapability.mjs` | `requiredSkillIds` → `WORK_SKILL_MISSING` |
| `src/server/pipeline/tavernCharacterVoice.mjs` | `character.voiceBlueprint` 优先 |
| `src/server/simulation/settledSimulationReport.mjs` | 客观指标来自 `worldState.worldPackMeta.report`，旧存档回退 |
| `src/server/observer/observerFeed.mjs` | 存档 → 观察帧（纯函数） |
| `src/server/observer/runsApi.mjs` | 运行列表、帧、SSE、授权启停 |
| `server.mjs` | 挂载 `/api/runs/*`；静态资源加入 `/stage.html` 模块图 |
| `src/server/staticAssets.mjs` | 允许 `/stage.html`、`/src/stage.css`、`/src/stage/*` |
| `stage.html`、`src/stage.css`、`src/stage/{main,tiles,sprites,scene,director,ui,feedClient}.js` | 像素观察台 |
| `scripts/worldValidate.mjs`、`scripts/worldSmoke.mjs`、`scripts/worldNew.mjs` | 命令入口 |
| `scripts/runV27GeminiSimulation.mjs`、`scripts/runV27ModelRelay.mjs` | `--world`、包摘要校验、优雅停止 |
| `scripts/*Contracts.mjs`（新增，见各任务） | 契约测试，注册到 `package.json` |
| `docs/51_world_foundation_lessons.md` | 经验基座文档 |

---

## Phase A · 世界包核心（行为不变）

### Task A1: 捕获改造前金样

**Files:** Create `scripts/fixtures/xiaoyaoyou-world-state-golden.json`, `scripts/captureWorldStateGolden.mjs`

- [ ] **Step 1:** 写捕获脚本：用 `buildPlayableWorldFromSetup(逍遥游提示)` 与 `buildTavernWorldStateV27(state, {characterIds: TAVERN_SCENE_CHARACTER_IDS, positions: TAVERN_SCENE_POSITIONS, worldId:"world:golden", pacingMode:"scene", openingAfterSeconds:900})`，以及 `pacingMode:"day"` 默认两人各一份，写入 JSON（`JSON.stringify` 排序键，去掉 `createdAt/updatedAt`）。
- [ ] **Step 2:** 运行 `node scripts/captureWorldStateGolden.mjs`，确认文件生成且含 `places.loc_xyy_tavern.topology`。
- [ ] **Step 3:** Commit `test: capture tavern world-state golden before world-pack refactor`。

### Task A2: 世界包定义与注册

**Files:** Create `src/worlds/worldPack.mjs`, `src/worlds/registry.mjs`; Test `scripts/worldPackCoreContracts.mjs`

接口：

```js
export const WORLD_PACK_SCHEMA_VERSION = 1;
export const REQUIRED_SECTIONS = ["meta","stage","clock","cast","relationships","relationshipMetrics","objects","positions","work","social","agenda","mysteries","report","layout"];
export function defineWorldPack(pack) // 缺段抛 WORLD_PACK_SECTION_MISSING；返回深冻结对象
export function worldPackDigest(pack) // sha256(稳定键序 JSON)
// registry.mjs
export const DEFAULT_WORLD_PACK_ID = "xiaoyaoyou";
export async function loadWorldPack(id) // 只允许 /^[a-z0-9_-]+$/；未知抛 WORLD_PACK_UNKNOWN
export function listWorldPackIds()
```

- [ ] **Step 1:** 写失败测试：缺 `stage` 抛 `WORLD_PACK_SECTION_MISSING`；冻结后修改抛 TypeError；同内容不同键序摘要相同；`loadWorldPack("../x")` 抛 `WORLD_PACK_ID_INVALID`。
- [ ] **Step 2:** `node scripts/worldPackCoreContracts.mjs` → FAIL（模块不存在）。
- [ ] **Step 3:** 实现两个模块。
- [ ] **Step 4:** 测试 PASS；在 `package.json` 注册 `"world-pack-core:test"`。
- [ ] **Step 5:** Commit。

### Task A3: 逍遥游世界包 + 可玩状态构建

**Files:** Create `src/worlds/xiaoyaoyou/pack.mjs`, `src/worlds/buildPlayableWorldFromPack.mjs`; Modify `src/worldbuilding/skills.js`（只新增导出）、`src/server/pipeline/tavernWorldRuntimeV27.mjs`（导出 `TAVERN_SOCIAL_FACTS_SOURCE` 所需数据）; Test `scripts/worldPackXiaoyaoyouContracts.mjs`

- `pack.legacySetup = { worldPrompt, peoplePrompt }`；`buildPlayableWorldFromPack` 对含 `legacySetup` 的包委托 `buildPlayableWorldFromSetup`（逐字相同，避免双份真相）；无 `legacySetup` 的包走通用构建（Task D2 用）。
- `stage`：`placeId:"loc_xyy_tavern"`、`name:"望梯酒馆"`、`topology: TAVERN_SCENE_TOPOLOGY`、`sceneCast: TAVERN_SCENE_CHARACTER_IDS`、`scenePositions: TAVERN_SCENE_POSITIONS`、`dayCast: TAVERN_V27_DEFAULT_CHARACTER_IDS`。
- `social.facts`、`social.boundaries`：把 `objectiveSocialFacts()`、`socialBoundaries()` 现有返回值搬成数据（`{{institutionName}}` 不需要：值固定）。
- `agenda.build(characterIds, {openingAfterSeconds})` 不放函数进包；改为数据 `agenda.items:[{...tavernOpeningAgenda 字段, dueAtSeconds:"opening", responsibleFrom:[谢真石、谢母、谢恒]}]`，由运行时按 `openingAfterSeconds` 实例化（与 `tavernOpeningAgenda` 结果逐字相同，含 `TAVERN_OPENING_TIME_INVALID` 校验）。
- `relationshipMetrics: TAVERN_RELATIONSHIP_METRICS`；`report.metrics` 为柴/水/药包/清单四项；`layout` 先放 Task F3 的酒馆布局占位对象 `{ grid:{cols:24, rows:13, tile:16}, zones:{} }`，F3 补全。

- [ ] **Step 1:** 失败测试：`buildPlayableWorldFromPack(xiaoyaoyou)` 与 `buildPlayableWorldFromSetup(逍遥游提示)` 去时间戳后 deepEqual；`defineWorldPack` 通过。
- [ ] **Step 2–4:** 实现、测试 PASS、注册 `world-pack-xiaoyaoyou:test`。
- [ ] **Step 5:** Commit。

### Task A4: 运行时查表化

**Files:** Modify `src/server/pipeline/tavernWorldRuntimeV27.mjs`; Test `scripts/worldPackRuntimeEquivalenceContracts.mjs`

改动点（行号为当前文件）：
- `:73 LOCATION_ID` → `placeIdOf(worldState)`/`pack.stage.placeId`；`privateStateForCharacter(state, character, zoneId, placeId)`、`publicCharacterEntity(character, zoneId, placeId)`、`worldObjectsFromTavern(state, placeId)`、`worldPositionsFromTavern(state, placeId)` 增加 `placeId` 参数。
- `:387 objectiveSocialFacts`、`:409 socialBoundaries` → 读 `pack.social`（替换 `entityId` 中的地点为 `placeId`）。
- `:433 buildTavernWorldStateV27(state, {worldPack = 默认包, ...})`：拓扑、名称、时限实例化、`worldPackMeta: {id, digest, report: pack.report}` 写入世界状态。**注意**：金样比较时忽略新增 `worldPackMeta` 字段。
- `:1560`、`:799`、`:617` 中 `"望梯酒馆"` 默认值 → `place.name`。
- `:1629`、`:2157 TAVERN_RELATIONSHIP_METRICS` → `worldState.worldPackMeta.relationshipMetrics`（构建时写入）。
- `:2301 createTavernWorldRuntimeV27(state, {worldPack, ...})`：阵容/站位默认取 `pack.stage.sceneCast/scenePositions` 或 `dayCast`；新增导出别名 `createWorldRuntimeV27 = createTavernWorldRuntimeV27`。
- 默认 `worldPack` 为同步导入的逍遥游包（运行时不能 await 动态加载）。

- [ ] **Step 1:** 失败测试：用默认包与显式 `worldPack: xiaoyaoyou` 构建的世界状态（去掉 `worldPackMeta`）分别与 A1 金样 deepEqual（scene 与 day 两份）；`worldPackMeta.id === "xiaoyaoyou"`。
- [ ] **Step 2:** 先跑确认金样测试在改造前就能通过（基线），再改代码。
- [ ] **Step 3:** 实施改动。
- [ ] **Step 4:** 等价测试 PASS；`npm test -- --concurrency 6` 全绿（559 + 新增）。
- [ ] **Step 5:** Commit `refactor: read tavern world from the xiaoyaoyou world pack`。

### Task A5: 时限条件种类与知情范围

**Files:** Modify `src/server/simulation/worldTemporalAgenda.mjs`; Test `scripts/worldTemporalAgendaKnowledgeContracts.mjs`

```js
function conditionMet(state, condition) {
  const kind = condition.kind || "object_state";
  if (kind === "object_holder") return clean(state.objects?.[condition.objectId]?.holderCharacterId) === condition.holderId;
  if (kind === "actor_zone") { const a = state.entities?.[condition.actorId]; return Boolean(a && a.present !== false && a.zoneId === condition.zoneId); }
  const value = state.objects?.[condition.objectId]?.state?.[condition.stateKey];
  if (typeof condition.maximum === "number") return typeof value === "number" && value <= condition.maximum;
  return typeof value === "number" && Number.isFinite(value) && value >= condition.minimum;
}
const knows = (row, actorId) => !Array.isArray(row.knownByActorIds) || row.knownByActorIds.includes(actorId);
```

- `projectWorldTemporalContext`：过滤 `knows(row, actor.id)`；`knownCompletion` 对 `actor_zone` 条件按同区可见、`object_holder` 按物件可见判断，否则 `null`。
- `temporalDeadlineDeliveries`：只投递给 `knows` 的在场人物。
- [ ] **Step 1:** 失败测试：(a) 无 kind 的旧条件行为不变；(b) `object_holder`/`actor_zone`/`maximum` 判定；(c) `knownByActorIds:["A"]` 时 B 的投影无该时限、警告只投给 A；(d) 未设置时与旧行为一致。
- [ ] **Step 2–4:** 实现、PASS、注册 `world-temporal-agenda-knowledge:test`、全量相关过滤 `npm test -- --filter agenda` 绿。
- [ ] **Step 5:** Commit。

### Task A6: 工作技能边界

**Files:** Modify `src/server/simulation/workCapability.mjs:356-410`、`tavernWorldRuntimeV27.mjs publicCharacterEntity`（写入 `skills: clone(character.skills || [])`）; Test `scripts/workSkillBoundaryContracts.mjs`

```js
const missingSkills = (state, actorId, definition) => (definition.requiredSkillIds || [])
  .filter(id => !(state.entities?.[actorId]?.skills || []).includes(id));
// 在 WORK_WRONG_ZONE 检查之后、工具检查之前：
const lacking = missingSkills(state, actor.id, definition);
if (lacking.length) { result.failedEffects.push({ code: "WORK_SKILL_MISSING", skillIds: lacking }); return result; }
```
同一检查也加在 complete/resume 分支；`buildWorkCapabilityStateFromTemplates` 保留 `requiredSkillIds`；`listWorkCapabilityAffordances` 对缺技能者仍列出（人物可以尝试并失败），但附 `skillRequirementKnown: true` 与所需技能列表。

- [ ] **Step 1:** 失败测试：无技能者开工返回 `failed` + `WORK_SKILL_MISSING` 且物件无变化；有技能者成功；无 `requiredSkillIds` 的模板对所有人开放（逍遥游不变）。
- [ ] **Step 2–5:** 实现、PASS、注册 `work-skill-boundary:test`、Commit。

### Task A7: 声音蓝图与报告指标

**Files:** Modify `tavernCharacterVoice.mjs:733`、`settledSimulationReport.mjs:50-100`; Test `scripts/worldPackReportVoiceContracts.mjs`

- `const localBlueprint = character.voiceBlueprint || CHARACTER_VOICE_BLUEPRINTS[character.id] || genericBlueprint(character);`
- 报告：若 `state.worldPackMeta?.report?.metrics` 存在，`summary.objectiveState.metrics = metrics.map(m => ({label, value: state.objects[m.objectId]?.state?.[m.stateKey] ?? null, unit}))`，渲染为 `label：value unit` 行；否则保留现有柴/水/药包/清单文字（旧存档与金样报告不变）。
- [ ] **Step 1:** 失败测试：自定义蓝图被采用；带 `worldPackMeta.report` 的状态渲染自定义指标行、不再出现“柴：”；旧状态渲染不变（用 `sim-runs/relay-43eee56c-…/world-save.json` 断言含“柴：未加工 2 束”）。
- [ ] **Step 2–5:** 实现、PASS、注册 `world-pack-report-voice:test`、Commit。

---

## Phase B · 经验基座

### Task B1: 经验文档

**Files:** Create `docs/51_world_foundation_lessons.md`

- [ ] **Step 1:** 写 12–16 条规则，每条四栏：证据（docs 38/39/41/44/45/47/48/49/50、PLAYBOOK 段落）→ 规则 → 代码位置 → 新世界验证项（V1–V9 或冒烟）。必须覆盖：说≠做（G1/G8）、interact 只是触碰、工作要真正完成那一回合才改资源、等待不得空耗调用、时限要有客观条件、私人安排不是全场公告、能力边界由世界结算、关系变化需第一手证据、悬念不得写成真相、来源如实标注、修复额度与授权恢复、重复循环保护、报告只列已结算事实。
- [ ] **Step 2:** Commit。

### Task B2: 世界包验证器

**Files:** Create `src/worlds/validateWorldPack.mjs`, `scripts/worldValidate.mjs`; Test `scripts/worldPackValidatorContracts.mjs`

接口：`validateWorldPack(pack) -> { ok, issues: [{check:"V2", code, path, message}] }`。

| 检查 | 实现要点 |
|---|---|
| V1 | 从 `defaultZoneId` BFS（move 边）覆盖全部 zone；边端点存在；`closed` zone 至少一条 `barrier` 边；`conversation` 边两端存在 |
| V2 | 对每个时限条件：`object_state` → 存在工作模板其 `completionEffects` 或物件初值可使该键达到阈值，且模板 `requiredSkillIds` ⊆ 某个 `knownByActorIds ∪ responsibleActorIds` 中人物的技能，且工具物件存在；`object_holder` → 物件 `portable` 且目标人物在阵容；`actor_zone` → 人物在阵容且 zone 存在 |
| V3 | 工作模板 `objectIds/toolIds`、`completionEffects` 路径存在于物件 `state`；物件声明 `operations` 含 draw/sheathe 时 `state.sheathed` 为布尔 |
| V4 | 每个 `cast[].ecologyProfile` 通过 `validateEcologyProfile`；至少一个欲望 `target.id` 是开场在场人物、物件或 zone |
| V5 | 存在至少一项涉及 ≥2 名人物的时限、交接物件（holder ≠ 欲望持有人）或关系种子 pressure |
| V6 | `cast.filter(active).length ≤ 5`；关系种子两端在阵容 |
| V7 | 人物 `agentMemory.beliefs[].mysteryId` 若存在，`status ∈ {unknown, suspected}` |
| V8 | `report.metrics[].objectId/stateKey` 存在 |
| V9 | `layout.zones` 覆盖每个 zone；每条边在布局中有 `doors` 项；物件 `layout.props` 落在所属 zone 矩形内 |

- [ ] **Step 1:** 失败测试：逍遥游包与（D 阶段后）借星包 `ok:true`；为 V1–V9 各构造一个最小坏包，断言对应 `check` 出现。
- [ ] **Step 2–4:** 实现；`scripts/worldValidate.mjs <id>` 打印逐项结果、非零退出码表示失败；注册 `world-pack-validator:test` 与 `"world:validate": "node scripts/worldValidate.mjs"`。
- [ ] **Step 5:** Commit。

### Task B3: 冒烟驾驶员

**Files:** Create `src/worlds/worldSmoke.mjs`, `scripts/worldSmoke.mjs`; Test `scripts/worldSmokeContracts.mjs`

- 流程：`buildPlayableWorldFromPack` → `createWorldRuntimeV27(state, {worldPack, pacingMode:"scene", runStage: 拒绝函数})` → 对每名人物调用阶段准备（`tavernCharacterAgentV2OutputSchemaForStage` + 输入构建）确认 schema 无不可满足数组界限 → 直接用 `coordinator` 提交确定性世界尝试（move / handle take / use_affordance start+complete / transfer），每个时限按 V2 找到的路径执行，断言 `resolveWorldTemporalAgenda` 后状态为 `fulfilled`。
- 驾驶员结果只返回报告，不写任何存档；报告注明 `authority: "reachability-smoke-not-character-behavior"`。
- [ ] **Step 1:** 失败测试：逍遥游冒烟通过（柴水时限可被满足）；把劈柴模板删掉的坏包冒烟报 `SMOKE_DEADLINE_UNREACHABLE`。
- [ ] **Step 2–5:** 实现、PASS、注册 `world-smoke:test` 与 `"world:smoke"`、Commit。

---

## Phase C · 运行入口

### Task C1: `world:new`

**Files:** Create `scripts/worldNew.mjs`; Test 并入 `scripts/worldSmokeContracts.mjs`

- `node scripts/worldNew.mjs <id> --out <新目录>`：拒绝已存在目录；写 `world-save.json`：`{schemaVersion:1, runId, worldPackId, worldPackDigest, provenance:{kind:"fresh-world", modelVerified:false}, settledTurns:[], halted:false, failure:null, checkpoint: instance.runtime.checkpoint()}` 与 `.report.md`。
- [ ] Steps：测试（输出可被 `gemini:simulate --dry-run --resume` 读取且首阶段准备成功）→ 实现 → 注册 `"world:new"` → Commit。

### Task C2: `gemini:simulate --world` 与包摘要

**Files:** Modify `scripts/runV27GeminiSimulation.mjs:11-100`

- `--world <id>`：无 `--resume` 时从世界包建新世界；有 `--resume` 时读取存档 `worldPackId`（缺省为 `xiaoyaoyou`），加载对应包，若存档摘要与当前包不同，输出警告并在报告记录 `worldPackDigestChanged:true`（不阻断：包可修订，但必须留痕）。
- 移除硬编码逍遥游种子，改为 `buildPlayableWorldFromPack(pack)`；`createWorldRuntimeV27(seed, {worldPack: pack, ...})`。
- SIGTERM/SIGINT：设置 `stopRequested`，当前回合结算后保存并以 `status:"stopped_by_operator"` 退出。
- [ ] Steps：`--dry-run --world xiaoyaoyou` 与 `--dry-run --resume <relay-43eee56c 存档>` 都产生 `first-stage.json`、0 请求 → 实现 → Commit。

### Task C3: 中继 `--world`

**Files:** Modify `scripts/runV27ModelRelay.mjs:10-160`

- 读 `RELAY_WORLD` 环境变量或 `--world`，替换种子与阵容；保存包 id/摘要。
- [ ] Steps：`tavern-v27-model-relay:test` 保持绿 → Commit。

---

## Phase D · 借星世界包

### Task D1: 信标入库与 README

**Files:** Create `src/worlds/jiexing/beacon/world-bible-v0.4.txt`、`episode-01-v1.2.txt`（textutil 抽取件）、`src/worlds/jiexing/README.md`

- README：选场理由、开场事实、暂定补设（何嫂、丫丫、时刻、物件数值）、受保护场景、悬念清单、与信标的对应段落。
- [ ] Commit。

### Task D2: 通用可玩状态构建

**Files:** Modify `src/worlds/buildPlayableWorldFromPack.mjs`; Test `scripts/worldPackJiexingContracts.mjs`

- 无 `legacySetup` 时：`characters = cast.map(c => ({ id, name, publicIdentity: c.title, skills, appearance, ecologyProfile, voiceBlueprint, agentMemory, lifeProfile:{ role: c.title, privatePursuit: 首个欲望 label, commitments: c.commitments||[] }, lifeState:{ currentActivity: c.currentActivity } }))`；`relationships` 按 `buildPlayableRelationships` 形状；`tavernState = { institution: { name: stage.name, objectTemplates: objects, guestPositions: positions, workOrderTemplates: work, offerings:{}, serviceZones:[] }, perceptionEnvironment: stage.perceptionEnvironment, stock:{}, servicePreparationEnvironment:{stations:{}} }`；`worldSetup.fixedStage = true`。
- [ ] Steps：测试（人物数、`getTavernEcologyProfile(character)` 返回嵌入档案、运行时可建且 5 名人物均在指定 zone）→ 实现 → Commit。

### Task D3: 借星世界包数据

**Files:** Create `src/worlds/jiexing/pack.mjs`

- 按规格 6.2/6.3 写全：stage（8 区拓扑）、clock、cast（5 人：appearance、skills、ecologyProfile 完整、voiceBlueprint、agentMemory 初始记忆与信念、startZoneId、currentActivity、commitments）、relationships（≥8 条有向种子）、relationshipMetrics（沿用逍遥游维度 id）、objects（≥16）、positions（药榻、桌凳）、work（修阵纹、换药、收拾行囊、熬粥）、social（顾家院落归属、药房病榻边界、阵眼边界）、agenda（出发、换药）、mysteries（5 项）、report（北侧阵纹、丫丫黑纹、行囊、粥）、layout（Task F3 格式）。
- [ ] **Step 1:** `npm run world:validate -- jiexing` 逐项修到全绿。
- [ ] **Step 2:** `npm run world:smoke -- jiexing` 通过（出发时限可被满足：小满到石桥、持接引符、陆青禾在石桥；换药时限可被陆青禾满足；小满修阵纹得到 `WORK_SKILL_MISSING`）。
- [ ] **Step 3:** `npm run world:new -- jiexing --out sim-runs/2026-10-09-jiexing-fresh` 后 `gemini:simulate --dry-run --resume` 首阶段成功；对 5 名人物逐一准备首阶段（冒烟已覆盖）。
- [ ] **Step 4:** Commit。

---

## Phase E · 观察台后端

### Task E1: 观察帧推导

**Files:** Create `src/server/observer/observerFeed.mjs`; Test `scripts/observerFeedContracts.mjs`

接口：`buildObserverFeed(worldSave, pack) -> { worldPackId, placeId, startSeconds, initial: {actors:{id:{zoneId}}, objects:{id:{holder, zoneId, state}}}, frames:[{seq, eventId, worldSeconds, actorId, kind, fromZone, toZone, utterance, audience, perceivedBy, objectChanges, status, failureCodes, intention, agentTurnId}], settledCount, status }`。

- 初始状态：存档有 `initial-checkpoint.json`（Gemini 运行）时用它；否则用世界包重新构建开场状态（同一包 → 同一开场）。
- 帧来源：`journal.events` 按 `worldVersion` 排序；`primitive` → kind 映射（move/speak/handle(take/pickup/take_out→handle, transfer→transfer)/use_affordance→work/observe/listen/rest/gesture）；`status==="failed"` → `kind:"fail"`；`utterance` 只取 `committedFacts` 中 `speech_emitted` 的文本；`perceivedBy` = `deliveries[].recipientCharacterId` 去重；`objectChanges` 从 `statePatch.operations` 中 `objects.*` 路径提取；`intention` 按 `agentTurnId` 关联 `settledTurns[].intention`。
- 时限事件（`world_deadline_*`）作为 `kind:"deadline"` 帧。
- [ ] **Step 1:** 失败测试（用 `sim-runs/2026-09-21-fresh-10/world-save.json`）：帧数 = 世界事件数；第一个 `speak` 帧的 `utterance` 等于 settledTurns 第 9 行对白；所有 `move` 帧 `toZone` 等于下一帧前实体 zone；失败帧保留 `failureCodes`；任何帧的 `utterance` 都能在 `speech_emitted` 中找到。
- [ ] **Step 2–5:** 实现、PASS、注册 `observer-feed:test`、Commit。

### Task E2: 运行接口

**Files:** Create `src/server/observer/runsApi.mjs`; Modify `server.mjs:420-445`; Test `scripts/observerRunsApiContracts.mjs`

- `createRunsApi({ runsRoot, spawnRunner, env })` 返回 `handle(req, res, url) -> boolean`。
- 运行 id 白名单 `/^[\w.-]{1,120}$/` 且解析后路径必须在 `runsRoot` 内；列表读取 `world-save.json` 头部字段与 `.report.md` 首行。
- `start`：校验 `authorized === true`、`turns 1–200`、`maxRequests 1–1200`、`world` 在注册表、模型名 `/^[\w.-]+$/`；缺 `GEMINI_API_KEY` 返回 412 `MODEL_KEY_MISSING`；`spawnRunner(args, env)` 注入便于测试；返回 `{runId}`；同时只允许一个运行中子进程。
- `stop`：向子进程发送 SIGTERM。
- `stream`：SSE，`fs.watch` + 500ms 轮询兜底，推送 `{type:"frames", frames}`、`{type:"status"}`，客户端断开时清理。
- [ ] **Step 1:** 失败测试：未授权 400；路径穿越 404；缺 key 412；成功启动时 `spawnRunner` 收到 `--world/--turns/--max-requests` 且 env 不出现在响应体；响应与错误文本中不含 key 值；第二个启动 409。
- [ ] **Step 2–5:** 实现、挂载、PASS、注册 `observer-runs-api:test`、Commit。

---

## Phase F · 像素观察台前端

### Task F1: 静态资源

**Files:** Modify `src/server/staticAssets.mjs`; Test 扩展现有 `server-static-asset` 相关契约（`npm test -- --filter static`）

- `files` 加入 `/stage.html`、`/src/stage.css`；`queue` 加入 `/src/stage/main.js`。
- [ ] Steps：测试 `/stage.html` 可解析、`/.env` 仍被拒 → 实现 → Commit。

### Task F2: 模块化原型

**Files:** Create `stage.html`、`src/stage.css`、`src/stage/{main,tiles,sprites,scene,director,ui,feedClient}.js`

- 从 `.superpowers/pixel-stage/index.html` 拆分：`tiles.js`（`R/D/circ/oval`、材质：木地板、石板、泥地、草地、灰泥墙、墙顶、瓦片、竹篱、溪水）、`sprites.js`（TPL/LEGS、`spriteRows(dir, leg, style)`、`spriteFor(appearance)`、`portrait()`）、`scene.js`（`buildStaticLayer(layout)`、`drawLights`、`ambient`）、`director.js`（帧 → 动画：寻路、气泡、飞物、做工、视线、失败、听见标记；`scrub(i)`、`advance(dt)`）、`ui.js`（对话框、时间轴、名册、检视、日志、启停面板）、`feedClient.js`（`/api/runs`、feed、SSE）。
- 像素字体：`@font-face` 指向 jsDelivr 上 OFL 的精品点阵体，失败回退等宽系统字体。
- [ ] Commit。

### Task F3: 布局格式与两个世界的布局

**Files:** Modify `src/worlds/xiaoyaoyou/pack.mjs`、`src/worlds/jiexing/pack.mjs`

布局格式：

```js
layout: {
  grid: { cols: 24, rows: 13, tile: 16 },
  theme: "dusk" | "dawn",
  zones: { hall: { rect: [1,3,9,9], floor: "wood", label: "堂前" }, ... },
  walls: [{ kind: "back", rect: [0,0,16,3], style: "plaster" }, { kind: "top", rect: [...] }],
  doors: [{ between: ["hall","courtyard"], tiles: [[15,9],[15,10]] }],
  props: [{ kind: "table", at: [4,6], w: 2 }, { kind: "stove", at: [12,3], w: 3, light: true }, ...],
  objects: { tavern_resource_water_vat: { drawer: "vat", at: [21,3] }, ... },
  lights: [{ at: [13.4,3.6], r: 40, color: "#ff8a30", flicker: true }],
  spots: { hall: [[5,7],[8,7],[4,8],[8,10],[5,10]], ... },
  blocked: [[11,6,14,6], ...]
}
```

- 逍遥游布局由原型数据转写；借星布局：左侧顾家屋内（小满房间、堂屋、药房、灶间）、中部院子（晾药架、柴堆、水缸、白鹅装饰）、右侧篱笆门外村道、溪流与石桥、右上谷口阵眼（阵旗、阵纹石、坡地）。
- [ ] Steps：`world:validate` V9 两个世界通过 → 浏览器截图检查 → Commit。

### Task F4: 页面联通

**Files:** Modify `src/stage/*.js`

- 页面启动：取 `/api/runs`，默认选最新运行；可切换运行；读取 feed（含 `layout`、`cast.appearance`）后渲染；运行中通过 SSE 追加帧并自动跟随（可关闭跟随）。
- 启停面板：世界选择（`/api/worlds`，Task E2 中加一个只读列表接口）、回合数、请求上限、模型、授权勾选；未勾选点击时内联提示“先勾选授权”；运行中显示停止按钮。
- 来源徽标：`provenance.kind` → “真实 API · 网关声明模型 X” / “外部中继 · 未验证” / “新世界 · 未运行”。
- [ ] Steps：浏览器验证（回放 9-21 运行、借星新世界、启动按钮在缺 key 时显示 412 提示）→ Commit。

---

## Phase G · 收尾

### Task G1: 全量验证与交付

- [ ] `npm run check`；`npm test -- --concurrency 6` 全绿。
- [ ] `npm run world:validate -- xiaoyaoyou`、`-- jiexing`；`npm run world:smoke -- jiexing`。
- [ ] 观察页截图：逍遥游回放、借星开场。
- [ ] 更新 README（世界包、命令、观察台）与 PRODUCT.md 的 Current Scope（第二个世界已能在同一运行时上运行；仍未做主界面通用化）。
- [ ] Commit，并向用户交付：如何在观察页授权首跑借星。
