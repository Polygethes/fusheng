# 新世界创建与小镇规模 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让别人下载后能玩：开始界面 → 填 API → 用两种模式之一设定世界与人物 → 编译成像素小镇（外景 + 室内）→ 演绎模式模拟 → 旁观并投放世界事件。

**Architecture:** 两种创建模式都只产出「世界蓝图」（人能读的 JSON）。确定性的编译器把蓝图编译成现有运行时认得的世界包（`REQUIRED_SECTIONS`）和 layout v2（外景 + 室内），再由验证器与零模型冒烟把关。用户世界存为 JSON 放在 `~/.character-town/worlds/`，注册表同时加载内置包与用户世界。小镇在运行时仍是“一个地点、多个区”，新增感知距离上限与“人物自己写的日程由世界照办”的调度，让 10–20 人的小镇花费可控。

**Tech Stack:** Node ≥ 24 ESM、无第三方依赖；契约测试脚本（`node:assert/strict`、`node:test`）由 `scripts/runContracts.mjs` 运行；原生 Canvas 2D 前端。

**规格：** `docs/superpowers/specs/2026-10-10-new-world-creation-and-town-design.md`（下称“规格”）。实施前通读规格 §1–§16。

---

## 执行规则（必读，每个任务都适用）

1. **不调用真实模型。** 所有测试用假 `fetchImpl` 或脚本化 `runStage`。只有用户明确授权时才发真实请求。
2. **密钥只在设置文件与进程环境里。** 不写进仓库文件、命令行参数、日志、存档、导出文件、HTTP 响应。每个涉及密钥的契约都断言“响应正文不含密钥”。
3. **程序不替人物做选择**（docs/51 第 10 条）。唯一的例外形态是 P4 的“照办人物自己写下的日程”，它必须带来源 `own_plan_step` 并在有新证据时立即交还人物。
4. **旧世界行为不变。** `xiaoyaoyou`、`jiexing` 的契约（含 `world-pack-runtime-equivalence:test` 金样）必须一直全绿。新行为一律由世界包字段开启（如 `meta.scale === "town"`、`perceptionEnvironment.maxVisualDistance`），缺省走旧路径。
5. **测试先行。** 每个任务先写契约脚本、跑一遍看它失败，再实现。契约放在 `scripts/<name>Contracts.mjs`，在 `package.json` 的 `scripts` 里注册为 `"<kebab-name>:test": "node scripts/<name>Contracts.mjs"`。单个契约超过 60 秒的，在 `contract-baseline.json` 的 `slowContracts` 里登记原因与超时。
6. **每个任务结束**：`npm run check` 通过，跑本任务的契约，提交一次（`git commit`，信息用英文祈使句，如 `Add local data directory and settings store`）。**每个阶段结束**：`npm test -- --concurrency 6` 全绿，写一段阶段小结到 `docs/52_new_world_progress.md`（做了什么、怎么验证的、遗留问题），然后停下等 Claude 审核。
7. 代码风格与周围一致：两空格缩进、双引号、`const clean = (v) => String(v ?? "").trim()` 这类小工具就地定义、注释只写“为什么”。界面文字用中文。
8. 不新增 npm 依赖。

## 文件结构总表

| 文件 | 阶段 | 职责 |
|---|---|---|
| `src/server/localData.mjs` | P1 | 数据目录、设置读写（0600）、掩码、模型环境变量 |
| `src/server/model/modelClient.mjs` | P1 | 通用“发提示词、收 JSON”客户端（Gemini 原生 / OpenAI 兼容），带重试 |
| `src/server/ecology/geminiCharacterStage.mjs` | P1 | 改为调用 `callModelJson` |
| `src/server/observer/settingsApi.mjs` | P1 | `GET/PUT /api/settings`、`POST /api/settings/test` |
| `src/server/observer/runsApi.mjs` | P1 | `env` 可为函数（取设置里的密钥） |
| `src/worlds/userWorldStore.mjs` | P1 | 用户世界的保存、列表、加载、软删除、导入导出 |
| `src/worlds/registry.mjs` | P1 | 内置包 ∪ 用户世界 |
| `src/server/observer/worldsApi.mjs` | P1 | `GET /api/library`、`DELETE`、导入导出 |
| `stage.html`、`src/stage/settings.js` | P1 | 设置弹窗 |
| `src/worlds/blueprint/schema.mjs`、`validateBlueprint.mjs` | P2 | 蓝图 JSON Schema 与 B1–B9 校验 |
| `src/worlds/catalog/{siteTypes,skills,appearance,edges}.mjs` | P2 | 目录 |
| `src/worlds/compiler/{index,topology,cast,objects,agenda,social,simplePlanner,placeholderLayout}.mjs` | P2 | 编译器 |
| `scripts/fixtures/blueprints/*.json` | P2 | 夹具蓝图 |
| `scripts/worldCompile.mjs` | P2 | `npm run world:compile` |
| `src/worlds/{layoutGeometry,layoutAtlas,validateLayoutV2}.mjs` | P3 | 共用的格子几何、图集与跨图寻路、v2 的 V9/V13 |
| `src/worlds/compiler/{rooms,townPlanner,interiors,layoutV2}.mjs` | P3 | 房间展开、外景规划、室内图、组装 layout v2 |
| `src/stage/{camera,minimap,daylight}.js` | P3 | 观察台镜头、小地图、昼夜 |
| `src/server/simulation/worldActionRegistry.mjs`、`characterWorldRuntime.mjs` | P4 | 感知距离、日程照办 |
| `src/server/pipeline/characterScheduleTurn.mjs` | P4 | “写日程”拍子 |
| `src/worlds/generation/*.mjs` | P5 | 快速模式分段生成 |
| `play.html`、`src/play/*.js` | P6 | 标题画面、创建向导、审改页 |
| `src/server/simulation/worldEvents.mjs` | P6 | 世界事件结算 |
| `start.command`、`start.bat`、`README.md` | P7 | 分发 |

---

# P1 · 设置与本地存储

**阶段目标：** 不再依赖启动时的环境变量；玩家在页面里填 API；用户世界能以 JSON 保存并被注册表加载。

### Task P1.1：数据目录与设置存储

**Files:** Create `src/server/localData.mjs`; Test `scripts/localDataContracts.mjs`; Modify `package.json`.

- [ ] **Step 1：写失败的契约** `scripts/localDataContracts.mjs`：

```js
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { dataHome, readSettings, writeSettings, validateSettingsPatch, publicSettings, maskKey, modelEnv } from "../src/server/localData.mjs";

const home = await mkdtemp(path.join(os.tmpdir(), "ct-home-"));
const env = { CHARACTER_TOWN_HOME: home };
try {
  assert.equal(dataHome(env), path.resolve(home));
  const empty = await readSettings(env);
  assert.equal(empty.apiKey, "");
  assert.equal(publicSettings(empty).configured, false);

  assert.ok(validateSettingsPatch({ provider: "openai-compatible", baseUrl: "http://x.example" }).some((row) => row.field === "baseUrl"), "http is refused");
  assert.ok(validateSettingsPatch({ provider: "openai-compatible", baseUrl: "" }).some((row) => row.field === "baseUrl"), "a gateway needs an address");
  assert.ok(validateSettingsPatch({ model: "bad model!" }).some((row) => row.field === "model"));
  assert.ok(validateSettingsPatch({ apiKey: "has space inside" }).some((row) => row.field === "apiKey"));
  assert.deepEqual(validateSettingsPatch({ provider: "openai-compatible", baseUrl: "https://gw.example:18081/v1", apiKey: "sk-test-0123456789", model: "gemini-3.8-flash-high" }), []);

  const KEY = "sk-test-0123456789abcd";
  const saved = await writeSettings({ provider: "openai-compatible", baseUrl: "https://gw.example/v1", apiKey: KEY, model: "gemini-3.8-flash-high" }, env);
  assert.equal(saved.apiKey, KEY);
  const file = path.join(home, "settings.json");
  assert.equal((await stat(file)).mode & 0o777, 0o600, "settings file is private to the user");
  assert.equal((await readSettings(env)).apiKey, KEY);

  const kept = await writeSettings({ model: "gemini-3.8-flash" }, env);
  assert.equal(kept.apiKey, KEY, "a patch without apiKey keeps the saved key");
  const pub = publicSettings(kept);
  assert.equal(pub.configured, true);
  assert.equal(pub.keyMask, maskKey(KEY));
  assert.ok(!JSON.stringify(pub).includes(KEY), "public settings never contain the key");
  assert.ok(!maskKey(KEY).includes(KEY.slice(4, -4)));

  const childEnv = modelEnv(kept, { PATH: "/bin", GEMINI_API_KEY: "old" });
  assert.equal(childEnv.GEMINI_API_KEY, KEY, "page settings win over the launch environment");
  assert.equal(childEnv.GEMINI_API_BASE_URL, "https://gw.example/v1");
  assert.equal(childEnv.PATH, "/bin");
  const nativeEnv = modelEnv({ ...kept, provider: "gemini", baseUrl: "" }, { GEMINI_API_BASE_URL: "https://stale.example" });
  assert.equal(nativeEnv.GEMINI_API_BASE_URL, undefined, "native Gemini drops a stale gateway address");
  assert.equal(modelEnv(empty, { GEMINI_API_KEY: "launch-key" }).GEMINI_API_KEY, "launch-key", "no saved key: the launch environment still works");

  await writeSettings({ apiKey: "" }, env);
  assert.equal((await readSettings(env)).apiKey, "", "an explicit empty key clears it");
  assert.ok(!(await readFile(file, "utf8")).includes(KEY));
} finally {
  await rm(home, { recursive: true, force: true });
}
console.log("Local data passed: private settings file, masked public view, launch-environment fallback, explicit clearing.");
```

- [ ] **Step 2：注册并运行，确认失败**：`package.json` 加 `"local-data:test": "node scripts/localDataContracts.mjs"`；`node scripts/localDataContracts.mjs` 应报模块不存在。

- [ ] **Step 3：实现** `src/server/localData.mjs`：

```js
// Per-user data that never lives in the project folder: model settings (with
// the API key) and the player's own worlds. The key is written only to a
// 0600 file and handed to model processes through their environment.
import os from "node:os";
import path from "node:path";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";

export const SETTINGS_SCHEMA_VERSION = 1;
export const PROVIDERS = Object.freeze(["gemini", "openai-compatible"]);
const MODEL = /^[\w.:-]{1,80}$/u;
const clean = (value) => String(value ?? "").trim();

export function dataHome(env = process.env) {
  return path.resolve(env.CHARACTER_TOWN_HOME || path.join(os.homedir(), ".character-town"));
}

export async function ensureDataHome(env = process.env) {
  const home = dataHome(env);
  await mkdir(path.join(home, "worlds"), { recursive: true, mode: 0o700 });
  return home;
}

const settingsFile = (env) => path.join(dataHome(env), "settings.json");

export function normalizeSettings(raw = {}) {
  const model = clean(raw.model);
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    provider: PROVIDERS.includes(raw.provider) ? raw.provider : "gemini",
    baseUrl: clean(raw.baseUrl),
    apiKey: clean(raw.apiKey),
    model: MODEL.test(model) ? model : "gemini-3.8-flash",
    responseFormat: raw.responseFormat === "json_schema" ? "json_schema" : "json_object",
  };
}

export function validateSettingsPatch(patch = {}) {
  const issues = [];
  const add = (field, message) => issues.push({ field, message });
  if (patch.provider !== undefined && !PROVIDERS.includes(patch.provider)) add("provider", "提供方只能是 gemini 或 openai-compatible。");
  const needsUrl = patch.provider === "openai-compatible";
  if (patch.baseUrl !== undefined || needsUrl) {
    const value = clean(patch.baseUrl);
    if (!value && needsUrl) add("baseUrl", "网关需要填写地址。");
    if (value) {
      try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) add("baseUrl", "地址必须是 https，且不能带账号、查询参数或 #。");
      } catch { add("baseUrl", "地址格式不对。"); }
    }
  }
  if (patch.model !== undefined && !MODEL.test(clean(patch.model))) add("model", "模型名只能包含字母、数字和 . _ : -。");
  if (patch.apiKey !== undefined && clean(patch.apiKey) && !/^\S{8,400}$/u.test(clean(patch.apiKey))) add("apiKey", "密钥长度应在 8–400 之间，且不能有空格。");
  if (patch.responseFormat !== undefined && !["json_object", "json_schema"].includes(patch.responseFormat)) add("responseFormat", "输出格式只能是 json_object 或 json_schema。");
  return issues;
}

export async function readSettings(env = process.env) {
  try { return normalizeSettings(JSON.parse(await readFile(settingsFile(env), "utf8"))); }
  catch { return normalizeSettings({}); }
}

export async function writeSettings(patch = {}, env = process.env) {
  const current = await readSettings(env);
  const next = normalizeSettings({ ...current, ...patch, apiKey: patch.apiKey === undefined ? current.apiKey : patch.apiKey });
  await ensureDataHome(env);
  const file = settingsFile(env);
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
  await chmod(file, 0o600);
  return next;
}

export function maskKey(key = "") {
  const value = clean(key);
  if (!value) return "";
  return value.length <= 10 ? "••••" : `${value.slice(0, 3)}…${value.slice(-4)}`;
}

export function publicSettings(settings = {}) {
  const { apiKey, ...rest } = normalizeSettings(settings);
  return { ...rest, configured: Boolean(apiKey), keyMask: maskKey(apiKey) };
}

// Saved settings win over the launch environment; without a saved key the
// launch environment keeps working, so terminal users are not broken.
export function modelEnv(settings = {}, baseEnv = process.env) {
  const env = { ...baseEnv };
  const saved = normalizeSettings(settings);
  if (!saved.apiKey) return env;
  env.GEMINI_API_KEY = saved.apiKey;
  if (saved.baseUrl) env.GEMINI_API_BASE_URL = saved.baseUrl;
  else delete env.GEMINI_API_BASE_URL;
  return env;
}
```

- [ ] **Step 4：运行契约至通过**；`npm run check`；提交 `Add local data directory and private settings store`。

### Task P1.2：通用模型 JSON 客户端

**Files:** Create `src/server/model/modelClient.mjs`; Modify `src/server/ecology/geminiCharacterStage.mjs`; Test `scripts/modelClientContracts.mjs`.

**接口：**

```js
/**
 * Send one system+user prompt and receive one JSON object.
 * @returns {Promise<{ output: object, stage: { provider, requestedModel, model, responseId, usage, outputEnvelope, elapsedMs } }>}
 * Errors keep the existing codes: GEMINI_API_KEY_REQUIRED, GEMINI_CONFIGURATION_INVALID,
 * GEMINI_RESPONSE_INVALID, GEMINI_API_ERROR, GEMINI_RESPONSE_INCOMPLETE, CHARACTER_STAGE_OUTPUT_INVALID (with rawOutput, issues).
 */
export async function callModelJson({ systemPrompt, userPrompt, schema }, {
  apiKey, model = "gemini-3.8-flash", thinkingLevel = "medium", apiBaseUrl = "https://generativelanguage.googleapis.com",
  responseFormat = "json_schema", fetchImpl = fetch, signal, onRequest, onResponse, maxTokens = 32768,
} = {})
```

- [ ] **Step 1：写失败的契约** `scripts/modelClientContracts.mjs`（`node:test`）：
  1. 原生地址：URL 为 `…/v1beta/models/<model>:generateContent`，头 `x-goog-api-key`，`redirect: "error"`，正文含 `systemInstruction` 与 `responseJsonSchema`，返回 `output` 等于模型 JSON；
  2. 网关地址：`…/v1/chat/completions`，`Authorization: Bearer`，`json_object` 时把 schema 附在 user 消息末尾；
  3. 502 两次后成功：共 3 次请求，结果正确（用假计时：把重试等待改为可注入的 `sleep` 选项，测试传 `async () => {}`）；
  4. 非 JSON 文本 → `CHARACTER_STAGE_OUTPUT_INVALID` 且 `rawOutput` 原样；
  5. 错误信息与 `onRequest`/`onResponse` 记录里都不含密钥。
- [ ] **Step 2：实现**：把 `callGeminiCharacterStage` 中从 `const base = new URL(apiBaseUrl)` 到函数结尾的逻辑整体移入 `callModelJson`（请求体构造、3 次重试、解析、信封剥离），新增可注入的 `sleep = (ms) => new Promise((r) => setTimeout(r, ms))` 选项；返回 `{ output, stage }`。`callGeminiCharacterStage` 保留原签名：构造 `request` 与修复提示后调用 `callModelJson`，再返回 `{ [definition.outputKey]: result.output, stage: result.stage }`。
- [ ] **Step 3：** 运行 `scripts/modelClientContracts.mjs`、`node --test scripts/geminiCharacterStageContracts.mjs`、`node scripts/characterPerformanceTurnContracts.mjs` 全绿；提交 `Extract a shared JSON model client`。

### Task P1.3：设置接口

**Files:** Create `src/server/observer/settingsApi.mjs`; Modify `src/server/observer/runsApi.mjs`, `server.mjs`; Test `scripts/settingsApiContracts.mjs`.

**接口：**

```js
export function createSettingsApi({ env = process.env, fetchImpl = fetch } = {}) {
  return { handle(req, res, url) /* → Promise<boolean> handled */ };
}
```

路由：
- `GET /api/settings` → `200 { ok: true, settings: publicSettings(...) }`。
- `PUT /api/settings`：要求 `content-type: application/json`（否则 415）、同源（`origin` 存在且 host 不同 → 403）、正文 ≤ 16KB；只接受 `provider, baseUrl, apiKey, model, responseFormat`；`validateSettingsPatch` 有问题 → `400 { code: "SETTINGS_INVALID", issues }`；成功 → `200 { ok: true, settings: publicSettings(saved) }`。
- `POST /api/settings/test`：同源 + JSON；未配置密钥 → `412 MODEL_KEY_MISSING`；否则用 `callModelJson({ systemPrompt: "Reply with JSON only.", userPrompt: 'Return {"ok":true}.', schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } }, { apiKey, apiBaseUrl, model, responseFormat, fetchImpl, thinkingLevel: "low", maxTokens: 256 })`，返回 `{ ok: true, model: stage.model, elapsedMs }`；失败返回 `{ ok: false, code, message }`（message 里替换掉密钥）。
- 每个响应都 `cache-control: no-store`。

`runsApi` 修改：`createRunsApi({ env })` 的 `env` 可以是对象或返回对象/Promise 的函数。新增 `const currentEnv = async () => (typeof env === "function" ? await env() : env);`，在 `start`、`/api/runs`、错误脱敏处改用 `await currentEnv()`。`server.mjs`：

```js
import { createSettingsApi } from "./src/server/observer/settingsApi.mjs";
import { modelEnv, readSettings } from "./src/server/localData.mjs";
const settingsApi = createSettingsApi();
const runsApi = createRunsApi({ runsRoot: path.join(__dirname, "sim-runs"), projectRoot: __dirname, env: async () => modelEnv(await readSettings(), process.env) });
// 路由处：
if (url.pathname.startsWith("/api/settings") && await settingsApi.handle(req, res, url)) return;
```

- [ ] **Step 1：写失败的契约** `scripts/settingsApiContracts.mjs`：临时 `CHARACTER_TOWN_HOME`；起 `http.createServer` 挂 settingsApi + runsApi（runsApi 的 `env` 用上面的函数形式，`spawnRunner` 用假的）；断言：
  1. 初始 GET → `configured: false`；
  2. PUT `text/plain` → 415；带 `origin: https://evil.example` → 403；`baseUrl: "http://…"` → 400 且 `issues[0].field === "baseUrl"`；
  3. PUT 合法（含 KEY）→ 200，正文不含 KEY，含 `keyMask`；
  4. 之后 `GET /api/runs` 的 `modelKeyConfigured === true`，`gateway` 是网关 host；
  5. `POST /api/runs/start`（授权、合法参数）→ 202，假 spawn 收到的 `env.GEMINI_API_KEY === KEY`，参数里不含 KEY；
  6. `POST /api/settings/test`（假 fetch 返回 `{"ok":true}`）→ `{ ok: true, model }`；假 fetch 返回 401 → `{ ok: false, code: "GEMINI_API_ERROR" }`；
  7. 以上所有响应正文都不含 KEY（封装 `call()` 时统一断言，与 `observerRunsApiContracts.mjs` 相同写法）。
- [ ] **Step 2：实现** settingsApi、runsApi 的 `env` 函数化、server 挂载。
- [ ] **Step 3：** 运行本契约 + `observerRunsApiContracts.mjs` 全绿；提交 `Serve model settings from the local data directory`。

### Task P1.4：设置弹窗

**Files:** Modify `stage.html`, `src/stage.css`, `src/stage/main.js`, `src/stage/ui.js`; Create `src/stage/settings.js`; Modify `src/server/staticAssets.mjs`（若模块图自动收集则无需改）。

- [ ] **Step 1：** 头部加按钮 `<button class="btn" id="settingsBtn">设置</button>`；新增 `#settingsModal`（复用 `.modal .panel` 样式）：提供方下拉（Google Gemini / OpenAI 兼容网关）、地址（选网关时显示）、密钥（`type="password"`，占位文字为 `已保存：<keyMask>，留空不改`）、模型、输出格式；按钮「测试连接」「保存」「取消」；状态行显示测试结果（模型名、耗时）或中文错误。
- [ ] **Step 2：** `settings.js` 导出 `createSettingsPanel({ onSaved })`：打开时 `GET /api/settings` 填表；保存时只发送改过的字段（密钥为空不发送）；测试连接先保存再 `POST /api/settings/test`。
- [ ] **Step 3：** 开新运行/继续面板：`fGateway` 说明文字改为读 `/api/settings`；未配置时“开始”按钮提示“先在设置里填 API”并提供打开设置的链接；模型输入框默认值取 `settings.model`。
- [ ] **Step 4：** 浏览器走查（另起端口 8797 的服务，不动用户 8787 的服务）：未配置 → 填假密钥保存 → 掩码显示 → 刷新后仍在。提交 `Add settings panel to the observer`。

### Task P1.5：用户世界库

**Files:** Create `src/worlds/userWorldStore.mjs`, `src/server/observer/worldsApi.mjs`; Modify `src/worlds/registry.mjs`, `server.mjs`; Test `scripts/userWorldStoreContracts.mjs`.

**接口：**

```js
export const USER_WORLD_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/u;
export function userWorldsRoot(env = process.env);                       // <dataHome>/worlds
export function listUserWorldIds(env = process.env);                     // 同步：含 pack.json 的子目录，按名排序，不含 .trash
export async function loadUserWorldPack(id, env = process.env);          // JSON → defineWorldPack；不存在 → WORLD_PACK_UNKNOWN
export async function saveUserWorld({ pack, blueprint = null, report = null }, env = process.env); // → id；内置 id 冲突 → WORLD_ID_RESERVED
export async function removeUserWorld(id, env = process.env);            // 移到 worlds/.trash/<id>-<时间戳>（软删除，可恢复）
export async function exportUserWorld(id, env = process.env);            // → { format: "character-town-world", formatVersion: 1, exportedAt, blueprint, pack }
export async function importUserWorld(bundle, env = process.env);        // 校验 format；id 冲突自动加 -2、-3；→ 新 id
```

注意：世界包里的 `Infinity`（边的不可传递模态）经 JSON 会变成 `null`；`edgeSupports` 把 `null` 与 `Infinity` 一样视为不支持，所以语义不变。编译器（P2）直接省略该键。

`registry.mjs`：

```js
export function listWorldPackIds() { return [...Object.keys(IMPORTERS), ...listUserWorldIds().filter((id) => !IMPORTERS[id])]; }
export async function loadWorldPack(id = DEFAULT_WORLD_PACK_ID) {
  // 原有 id 校验不变；内置优先，否则尝试用户世界
}
export function isBuiltInWorld(id) { return Boolean(IMPORTERS[id]); }
```

`worldsApi.mjs`：`GET /api/library` → `{ worlds: [{ id, title, builtIn, scale, residents, createdAt, hasBlueprint }] }`；`POST /api/library/import`（同源 JSON，正文 ≤ 5MB）；`GET /api/library/<id>/export`（`content-disposition: attachment; filename="<id>.world.json"`）；`DELETE /api/library/<id>`（同源；内置世界 → 403）。

- [ ] **Step 1：写失败的契约**：临时数据目录；把 `jiexing` 包深拷贝、改 `meta.id = "jx_copy"`、`meta.title = "借星副本"` 后 `saveUserWorld`；断言 `listWorldPackIds()` 含 `jx_copy`，`loadWorldPack("jx_copy")` 通过 `validateWorldPack` 且 `createFreshWorldSave` 成功；`saveUserWorld` 用 `jiexing` 原 id → `WORLD_ID_RESERVED`；导出 → 导入得到 `jx_copy-2`；`removeUserWorld` 后列表里没有、`.trash` 里有；`../evil` 之类 id 一律 `WORLD_PACK_ID_INVALID`；`worldsApi` 的 DELETE 内置世界 → 403。
- [ ] **Step 2：实现。** `listUserWorldIds` 用 `readdirSync`（目录很小，保持注册表同步接口不变）。所有写操作先写临时文件再 `rename`。
- [ ] **Step 3：** 运行本契约、`world-pack-core:test`、`observer-runs-api` 相关契约；提交 `Load player worlds from the local data directory`。

### P1 阶段收尾

- [ ] `npm run check`、`npm test -- --concurrency 6` 全绿。
- [ ] 写 `docs/52_new_world_progress.md` 的 “P1” 一节。停下等审核。

---

# P2 · 世界蓝图与编译器（不含正式地图）

**阶段目标：** 夹具蓝图 → 编译 → 验证与冒烟全绿 → 存入世界库 → 在现有观察台（单图占位布局）里能用脚本化人物跑起来。

### Task P2.1：蓝图 schema 与校验

**Files:** Create `src/worlds/blueprint/schema.mjs`, `src/worlds/blueprint/validateBlueprint.mjs`, `scripts/fixtures/blueprints/tiny_hamlet.json`; Test `scripts/blueprintContracts.mjs`.

`schema.mjs` 导出：
- `BLUEPRINT_VERSION = 1`
- `BLUEPRINT_SCHEMA`：规格 §5 的完整 JSON Schema（所有对象 `additionalProperties: false`；字符串字段给 `maxLength`：名字 24、一段话 400、台词 80、记忆 300；数组给 `maxItems`：residents 30、desires 4、memories 6、routine 12、samples 12、relationships 200、deadlines 6、mysteries 8、objects 30、events 10、visitors 6）。
- 分段子 schema：`SECTION_SCHEMAS = { world, sites, residents, relationships, opening }`，供 P5 分段生成复用。

`validateBlueprint(blueprint, { catalog }) → { ok, issues: [{ rule: "B1"…"B9", code, path, message }] }`，规则见规格 §5.1。`path` 用 JSON 路径（如 `residents[2].workSiteId`），P6 的审改页靠它跳到字段。

**夹具** `scripts/fixtures/blueprints/tiny_hamlet.json`（逐字使用；它也是 P2 其余任务的主夹具）：

```json
{
  "blueprintVersion": 1,
  "meta": { "id": "tiny_hamlet", "title": "青石坳", "premise": "山脚下只有两户人家和一间药铺的小村。入秋第一场寒潮前，李家的木匠老爹闪了腰，王婶的药铺缺了一味要去竹林里采的药。", "genre": "古风山村", "tone": "温情", "language": "zh-Hans", "startDay": "寒露前一日", "startClock": "07:00", "startLabel": "辰时初", "seed": 7 },
  "town": {
    "name": "青石坳",
    "terrain": { "river": null, "forest": "east", "hills": "north", "fields": "south" },
    "sites": [
      { "id": "li_home", "name": "李家", "type": "home", "householdId": "li" },
      { "id": "herb_shop", "name": "王记药铺", "type": "herb_shop", "householdId": "wang", "attachedHome": true },
      { "id": "square", "name": "晒谷场", "type": "square" },
      { "id": "well", "name": "老井", "type": "well" },
      { "id": "east_wood", "name": "东坡竹林", "type": "forest" }
    ]
  },
  "households": [
    { "id": "li", "name": "李家", "siteId": "li_home" },
    { "id": "wang", "name": "王家", "siteId": "herb_shop" }
  ],
  "residents": [
    { "id": "li_dashan", "name": "李大山", "age": 46, "role": "木匠，李家当家", "householdId": "li", "workSiteId": "li_home",
      "appearance": { "skin": "#d6a882", "hair": "#33292c", "robe": "#6e5c40", "sash": "#2a2420", "styles": ["bun", "beard"], "child": false },
      "personality": { "autonomy": 0.8, "introversion": 0.7, "persistence": 0.8, "conscientiousness": 0.7, "competitiveness": 0.4, "care": 0.6, "caution": 0.4, "impulsivity": 0.5 },
      "skills": ["carpentry", "woodcutting"],
      "speech": { "style": "话少，句子短，爱用活计打比方；疼也不喊，只说“没事”。", "samples": ["没事，扭了一下。", "木头不等人。"] },
      "situation": "昨天扛梁闪了腰，今天还答应给王婶修药柜的抽屉。",
      "desires": [ { "verb": "修好", "object": "王记药铺的药柜抽屉", "outcome": "药柜抽屉能顺顺当当拉开", "strength": 0.6 } ],
      "principles": ["答应了的活不能拖"], "boundaries": [ { "protects": "当家人的脸面", "trigger": "被人当着外人说他老了", "response": "板着脸不接话" } ],
      "routine": [ { "from": "06:00", "to": "07:00", "activity": "院里磨刨子", "siteId": "li_home" }, { "from": "08:00", "to": "12:00", "activity": "做木活", "siteId": "li_home" } ],
      "memories": [ { "when": "昨天傍晚", "content": "我扛梁时腰里咯噔一下，小禾看见了，我说没事。" } ], "secrets": [] },
    { "id": "li_xiaohe", "name": "李小禾", "age": 15, "role": "李家女儿", "householdId": "li", "workSiteId": "li_home",
      "appearance": { "skin": "#f0c6a4", "hair": "#2e2428", "robe": "#5a8a7a", "sash": "#c8b080", "styles": ["long"], "child": false },
      "personality": { "autonomy": 0.6, "introversion": 0.3, "persistence": 0.6, "conscientiousness": 0.5, "competitiveness": 0.5, "care": 0.8, "caution": 0.3, "impulsivity": 0.6 },
      "skills": ["cooking"],
      "speech": { "style": "嘴快，爱追问，着急时一句话里带好几个问号。", "samples": ["爹你又逞强！", "王婶，那味药长什么样？"] },
      "situation": "看出爹的腰伤不轻，想替他把药求来。",
      "desires": [ { "verb": "求到", "object": "给爹治腰的药", "outcome": "爹把药贴上了", "strength": 0.8 } ],
      "principles": ["不让爹一个人硬扛"], "boundaries": [],
      "routine": [ { "from": "06:00", "to": "07:30", "activity": "做早饭", "siteId": "li_home" }, { "from": "08:00", "to": "10:00", "activity": "去井边打水", "siteId": "well" } ],
      "memories": [ { "when": "昨天傍晚", "content": "爹扛梁时脸一下白了，他说没事，可晚饭只吃了半碗。" } ], "secrets": [] },
    { "id": "wang_shen", "name": "王婶", "age": 52, "role": "药铺掌柜，懂草药", "householdId": "wang", "workSiteId": "herb_shop",
      "appearance": { "skin": "#e4b896", "hair": "#3a2c28", "robe": "#7a6a8a", "sash": "#3a3040", "styles": ["bun", "apron"], "child": false },
      "personality": { "autonomy": 0.7, "introversion": 0.4, "persistence": 0.7, "conscientiousness": 0.8, "competitiveness": 0.3, "care": 0.8, "caution": 0.7, "impulsivity": 0.2 },
      "skills": ["medicine", "herbalism"],
      "speech": { "style": "慢条斯理，爱念叨，药名张口就来。", "samples": ["急什么，药得一样一样配。"] },
      "situation": "治腰伤的方子缺一味竹林里的伸筋草，儿子王二答应去采，还没动身。",
      "desires": [ { "verb": "配齐", "object": "治腰伤的药包", "outcome": "药包配好、交到李大山手里", "strength": 0.7 } ],
      "principles": ["药不对症不给人"], "boundaries": [],
      "routine": [ { "from": "07:00", "to": "18:00", "activity": "看铺子、配药", "siteId": "herb_shop" } ],
      "memories": [ { "when": "去年冬天", "content": "李大山给我修过一回门槛，没收钱。" } ], "secrets": [] },
    { "id": "wang_er", "name": "王二", "age": 20, "role": "王婶的儿子", "householdId": "wang", "workSiteId": "herb_shop",
      "appearance": { "skin": "#eab48c", "hair": "#3a2a20", "robe": "#b8743c", "sash": "#5a6a3a", "styles": [], "child": false },
      "personality": { "autonomy": 0.5, "introversion": 0.4, "persistence": 0.3, "conscientiousness": 0.3, "competitiveness": 0.6, "care": 0.5, "caution": 0.3, "impulsivity": 0.7 },
      "skills": ["herbalism", "woodcutting"],
      "speech": { "style": "懒洋洋，爱打岔，被说中了就嘿嘿笑。", "samples": ["急啥，竹林又不会跑。"] },
      "situation": "答应娘去竹林采伸筋草，心里惦记着去晒谷场看人下棋。",
      "desires": [ { "verb": "赢", "object": "晒谷场的那盘棋", "outcome": "在晒谷场赢下一盘", "strength": 0.5 } ],
      "principles": [], "boundaries": [ { "protects": "自己的闲工夫", "trigger": "被一遍遍催", "response": "嘴上应着，脚下不动" } ],
      "routine": [ { "from": "09:00", "to": "11:00", "activity": "去竹林采药", "siteId": "east_wood" } ],
      "memories": [ { "when": "前天", "content": "在晒谷场输了孙伯一盘棋，他笑我手臭。" } ], "secrets": [] }
  ],
  "relationships": [
    { "from": "li_xiaohe", "to": "li_dashan", "label": "父女 / 心疼又着急", "address": ["爹"], "feelings": { "love": 85, "protection": 60 }, "unspoken": "你别总说没事。", "misreading": "" },
    { "from": "li_dashan", "to": "li_xiaohe", "label": "父女 / 不想让她操心", "address": ["小禾"], "feelings": { "love": 85, "protection": 70, "power": 50 }, "unspoken": "腰是疼，可不能让孩子看出来。", "misreading": "" },
    { "from": "wang_shen", "to": "wang_er", "label": "母子 / 恨铁不成钢", "address": ["二子"], "feelings": { "love": 75, "power": 55 }, "unspoken": "", "misreading": "以为他又去偷懒。" },
    { "from": "wang_er", "to": "wang_shen", "label": "母子 / 怕念叨", "address": ["娘"], "feelings": { "love": 65, "wantsToEscape": 40 }, "unspoken": "", "misreading": "" },
    { "from": "li_xiaohe", "to": "wang_shen", "label": "邻里 / 求药", "address": ["王婶"], "feelings": { "dependence": 50 }, "unspoken": "", "misreading": "" },
    { "from": "wang_shen", "to": "li_dashan", "label": "邻里 / 欠着人情", "address": ["大山"], "feelings": { "love": 30, "protection": 40 }, "unspoken": "", "misreading": "" }
  ],
  "opening": {
    "situation": "天刚亮，寒潮要来了。李大山腰伤发作，王记药铺的药还差一味伸筋草。",
    "positions": { "li_dashan": "li_home", "li_xiaohe": "li_home", "wang_shen": "herb_shop", "wang_er": "herb_shop" },
    "objects": [
      { "name": "伸筋草", "siteId": "east_wood", "holder": null, "state": { "bundles": 0, "needed": 1 }, "known": "public" },
      { "name": "腰伤药包", "siteId": "herb_shop", "holder": null, "state": { "complete": false }, "known": "public" }
    ],
    "deadlines": [
      { "label": "午时前把腰伤药交到李大山手里", "dueClock": "12:00", "responsible": ["wang_shen"], "knownBy": ["wang_shen", "wang_er", "li_xiaohe"],
        "conditions": [ { "kind": "object_holder", "object": "腰伤药包", "holder": "li_dashan" } ],
        "consequence": "寒潮一到腰伤更重，李大山就得卧床好几天。" }
    ],
    "mysteries": ["晒谷场边上那棵老槐树下埋着什么"],
    "events": [],
    "visitors": []
  }
}
```

- [ ] **Step 1：写失败的契约** `scripts/blueprintContracts.mjs`：
  1. `tiny_hamlet` 通过（`ok === true`，`issues` 为空）；
  2. 对 B1–B9 各造一个反例（深拷贝夹具后改一处），断言出现对应 `rule` 与正确 `path`：重复 id（B1）、`workSiteId: "nowhere"`（B2）、31 个居民（B3）、删光某人欲望（B4）、关系指向自己（B5）、时限负责人不存在（B6）、作息 `from: "25:00"` 或两段重叠（B7）、颜色 `"red"`（B8）、`situation` 超长（B9）；
  3. `BLUEPRINT_SCHEMA` 本身是合法 JSON（`JSON.parse(JSON.stringify(...))` 往返相等），且 `unsatisfiableSchemaPaths(BLUEPRINT_SCHEMA)`（来自 `worldSmoke.mjs`）为空。
- [ ] **Step 2：实现** schema 与校验。
- [ ] **Step 3：** 契约全绿；提交 `Define the world blueprint and its checks`。

### Task P2.2：目录

**Files:** Create `src/worlds/catalog/siteTypes.mjs`, `skills.mjs`, `appearance.mjs`, `edges.mjs`, `index.mjs`; Test `scripts/catalogContracts.mjs`.

**形状**（每种类型一个对象，导出 `SITE_TYPES` 冻结表）：

```js
// 建筑
home: {
  kind: "building", label: "住宅", footprint: [6, 5],
  rooms: [ { suffix: "hall", label: "堂屋", entry: true }, { suffix: "bedroom", label: "卧房", perResidents: 2 /* 每 2 人一间，至少 1 间 */ }, { suffix: "kitchen", label: "灶间" } ],
  links: [["hall", "bedroom*"], ["hall", "kitchen"]],          // bedroom* = 所有卧房
  objects: [ { slug: "stove", label: "灶台", room: "kitchen", portable: false, state: { lit: false } },
             { slug: "water_jar", label: "水缸", room: "kitchen", portable: false, state: { water: 2, capacity: 4 } },
             { slug: "bucket", label: "木桶", room: "kitchen", state: { water: 0, capacity: 1 } } ],
  work: [ { templateId: "cook_meal", taskLabel: "做一顿饭", unitAction: "做好一顿饭", room: "kitchen", requiredUnits: 1, unitLabel: "顿饭",
            requiredSkillIds: [], objectSlugs: ["stove"], toolSlugs: [], durationSecondsPerUnit: 1200,
            effects: [ { slug: "stove", path: ["lit"], set: true } ], sound: "灶间传来锅铲声。" } ],
  interiorTemplates: ["home_a", "home_b"],
},
// 室外
forest: { kind: "outdoor", label: "林子", zones: [ { suffix: "edge", label: "林边" }, { suffix: "deep", label: "林子深处", moveFromEdge: 3 } ],
          work: [ { templateId: "cut_firewood", … , requiredSkillIds: ["woodcutting"], … } ], terrain: "forest" },
```

至少包含：建筑 `home, smithy, inn, shop, herb_shop, clinic, temple, school, farmhouse, mill, post`；室外 `square, street, market, well, field, forest, river_bank, bridge, pond, hill, road_out`。每种建筑至少 1 个活计；`herb_shop` 必须有“配药”（需 `medicine` 或 `herbalism`，状态写到 `opening.objects` 里同名物件时由编译器绑定，见 P2.4）；`forest` 有“采药/砍柴”。

`edges.mjs` 导出规格 §7.1 的边参数常量（`ROOM_ROOM`、`ROOM_DOOR`、`STREET_STREET(len)`、`TO_WILD(len)`），不可传递的模态**省略该键**（不要写 `Infinity`，保证 JSON 往返一致）。

- [ ] **Step 1：写失败的契约**：每种类型的房间 suffix 唯一、links 只引用存在的房间、活计的 `objectSlugs/toolSlugs` 都在本类型 `objects` 里、`requiredSkillIds` 都在 `SKILLS` 里、`interiorTemplates` 非空（P3 再校验模板存在）、所有表 `Object.isFrozen`、所有边常量 JSON 往返相等。
- [ ] **Step 2：实现**；**Step 3：** 提交 `Add the site, skill and appearance catalog`。

### Task P2.3：简易规划器与拓扑

**Files:** Create `src/worlds/compiler/simplePlanner.mjs`, `src/worlds/compiler/topology.mjs`; Test 并入 `scripts/worldCompilerContracts.mjs`（本任务先建文件，写拓扑部分的断言）。

**规划器接口（P3 的正式规划器实现同一接口）：**

```js
/** @returns {{ streets: [{ id, label, length }], streetLinks: [[streetIdA, streetIdB]], frontOf: { [siteId]: streetId }, outdoorEntry: { [siteId]: streetId }, map: null }} */
export function planTown(blueprint, { catalog, seed })
```

简易版：一个广场（若蓝图有 `square` 类 site 则用它的区作广场，否则生成 `street_plaza`），主街 `street_1…street_k`（k = ⌈建筑数/2⌉）首尾相连并连到广场；建筑两两分配到街段；室外地点按 terrain 方位接到最近的街段末端（林子、山接 `road_out` 方向的末端）。确定性：只依赖蓝图顺序与 `seed`（用 `src/stage/pixel.js` 同款的 `rng(seed)` 算法复制一份到 `compiler/rng.mjs`，服务端不得引用 `src/stage`）。

**拓扑编译：** `compileTopology(blueprint, plan, catalog) → { zones, edges, defaultZoneId, siteZones: { [siteId]: { entry, rooms: [zoneId] } } }`，规则见规格 §7.1；区 id 形如 `<siteId>__<suffix>`（卧房 `bedroom_1…`），街段 id 用规划器给的；`defaultZoneId` = 广场区。

- [ ] **Step 1：写断言**（`tiny_hamlet`）：`li_home__hall/bedroom_1/kitchen` 存在；`herb_shop__front`（铺面）与 `herb_shop` 附属住宅的房间存在；每个建筑的 entry 房间与其门前街段之间恰有一条边，且该边没有 `visual` 键、`sound` 为 2；从 `defaultZoneId` 能走到所有区；两次编译结果 `JSON.stringify` 完全相同。
- [ ] **Step 2：实现**；**Step 3：** 提交 `Compile blueprint sites into a town topology`。

### Task P2.4：人物、关系、物件、活计、时限、社会规则、报告

**Files:** Create `src/worlds/compiler/{cast,objects,agenda,social,report}.mjs`。

- `compileCast(blueprint, { worldId, topology }) → { cast, scenePositions }`：按规格 §7.2 表格；产物形状与 `src/worlds/jiexing/cast.mjs` 一致（参照其中的 `profile()`、`desire()`、`episode()`、`belief()`、`voice()` 帮助函数，抽成 `compiler/castShapes.mjs` 共用；**不要**改 `jiexing/cast.mjs`）。人物 id = `char_<worldId>_<residentId>`。`scenePositions` 来自 `opening.positions`，缺省时取作息中覆盖开场时刻的那段的 site entry 区，再缺省取住处 entry 区。欲望的 `target`：若 object 文本与某物件名匹配 → 指向该物件；与某居民名匹配 → 指向该人；与某 site 名匹配 → 指向其 entry 区；都不匹配 → 指向本人住处 entry 区并写入 `report.provisional`。`satisfactionCondition` 用 `outcome` 文本作 criteria（类型与借星相同的写法）。
- `compileRelationships(blueprint, ids)`：`feelings` 映射到 `TAVERN_RELATIONSHIP_METRICS` 13 维（缺省 0），`address` → `allowedAddresses` 与 `addressingRule`（“A 称 B 为 x”）。
- `compileObjects(blueprint, topology, catalog)`：目录默认物件按建筑实例化（id `<worldId>_<siteId>_<slug>`，`zoneId` = 对应房间区）+ `opening.objects`（id `<worldId>_obj_<序号>`，`known: "hidden"` → `presentation.exposure = "hidden"`）。
- `compileWork(...)`：目录活计按建筑实例化，输出与借星 `work[]` 同形的模板（见 `docs/superpowers/reviews/2026-10-10-p2-review.md` A3）；`effects` 中的 `slug` 换成物件 id，只输出数值增减。活计与开场物件的关联**只**走规格 §5 的 `madeAt` 规则（~~旧的“药包 / 草”名字匹配规则已作废~~）。
- `compileAgenda(blueprint, ids, startClock)`：`dueClock − startClock` → `due.atSeconds`；`warningLeadSeconds` = 到期前 1/4，夹在 300–1800；条件里的物件名/人物/地点解析成 id，解析不到 → 编译失败（抛 `{ code: "BLUEPRINT_REFERENCE_UNRESOLVED", path }`）。
- `compileSocial(...)`：每户对自家建筑 `ownership_claim`；室内区 `boundaries`（户内成员豁免）。铺子类建筑的铺面区加 `public_access_declaration`。
- `compileReport(...)`：时限条件涉及的数值状态与持有关系自动成为指标。
- 时间政策：`clock = { startLabel: meta.startLabel, defaultPacingMode: "scene", sceneTimePolicy: TOWN_TIME_POLICY }`，`TOWN_TIME_POLICY` 取规格 §9.5 的数值，放 `catalog/index.mjs`。

- [ ] **Step 1：写断言**（加到 `worldCompilerContracts.mjs`）：`tiny_hamlet` 编译后 4 名人物都有 `ecologyProfile` 且 `validateEcologyProfile` 通过；欲望 target 能解析（李小禾的“给爹治腰的药”→ 指向“腰伤药包”或李大山，任一皆可，断言不是 provisional）；关系 6 条、13 维齐全；时限 `due.atSeconds === 5 * 3600`；条件里的物件是“腰伤药包”的 id；李家室内区有 `boundaries` 且李家两人豁免。
- [ ] **Step 2：实现**；**Step 3：** 提交 `Compile residents, relationships, objects, work and deadlines`。

### Task P2.5：组装、占位布局、自检

**Files:** Create `src/worlds/compiler/index.mjs`, `src/worlds/compiler/placeholderLayout.mjs`; Modify `src/worlds/validateWorldPack.mjs`。

```js
/** @returns {{ pack, layout, report: { provisional: string[], warnings: [{ code, path, message }] } }} 失败抛 { code, path, message } */
export function compileBlueprint(blueprint, { catalog = CATALOG, seed = blueprint.meta.seed ?? 1, planner = planTown } = {})
```

- `pack.meta = { id, title, language, source: ["world-blueprint"], scale: "town", blueprintDigest, provisional }`；`stage = { placeId: "loc_<id>_town", name: town.name, householdName: "", sceneId, defaultWorldId, topology, perceptionEnvironment: { ...默认, maxVisualDistance: 2.5 }, sceneCast: 所有居民 id, scenePositions, dayCast: 所有居民 id }`；`relationshipMetrics: TAVERN_RELATIONSHIP_METRICS`；`positions: []`（P3 由室内模板提供座位）；`mysteries` 由 `opening.mysteries` 生成 id。
- `placeholderLayout(topology, objects, cast)`：v1 格式的“格子图”——每个区一个 5×4 的矩形按网格排开（每行 6 个），相邻（有边）的区之间画门洞，物件摆在所属区左上角起依次排列，`spots` 每区 6 个。目的只是让现有观察台能显示（P3 替换）。地面材质：室内 wood、街段 dirt、林子 meadow。
- `pack.layout = placeholderLayout(...)`（`REQUIRED_SECTIONS` 含 layout）；返回值里的 `layout` 与它是同一份。
- 输出前跑 `defineWorldPack(pack)`。
- `validateWorldPack` 增加：`pack.meta.scale === "town"` 时跳过“`sceneCast` ≤ 5”（V6 原规则），改查“`scenePositions` 中同一区 ≤ 6 人”（新代码 `TOWN_ZONE_CROWDED`）。

- [ ] **Step 1：写断言**：
  1. `compileBlueprint(tiny_hamlet)` 两次，`worldPackDigest(pack)` 相同；改 `seed` 后拓扑可不同但仍通过验证；
  2. `validateWorldPack(pack).issues` 为空；
  3. `await runWorldSmoke(pack)` 的 `issues` 为空；
  4. `saveUserWorld({ pack, blueprint, report })` 后 `loadWorldPack("tiny_hamlet")` 可用，`createFreshWorldSave` 成功；
  5. **脚本化人物跑 6 拍**（照抄 `scripts/characterPerformanceTurnContracts.mjs` 的 `createScriptedWorld` 写法，`characterAgentCallMode: "performance"`）：李小禾从家里走到 `herb_shop`（远距离 move 被逐段结算），对王婶说一句话，王婶被说话唤醒并回话；断言最终李小禾在 `herb_shop__front`、王婶的回合是 `speak` 且 `speechTargetCharacterId` 是李小禾；
  6. 旧世界：`validateWorldPack(jiexing)` 依旧无问题。
- [ ] **Step 2：实现**；**Step 3：** 提交 `Assemble compiled town worlds with a placeholder map`。

### Task P2.6：另外两份夹具与命令

**Files:** Create `scripts/fixtures/blueprints/river_town.json`（5 户、14 人、铁匠铺 + 客栈 + 药铺、河与石桥、2 个时限、1 个隐藏物件、1 个来客）、`forest_village.json`（4 户、10 人、林子深处、猎户与磨坊、1 个需要两人合作的时限）；`scripts/worldCompile.mjs`；Modify `package.json`（`"world:compile": "node scripts/worldCompile.mjs"`）。

`npm run world:compile -- <blueprint.json> [--seed N] [--save]`：打印编译报告（补设、警告）、验证结果、冒烟结果；`--save` 时写入世界库。

- [ ] **Step 1：** 两份夹具自己写，内容要像真的小镇故事（人物有心事、彼此有牵连），并满足：每人至少 1 条关系；至少一个时限需要 2 人以上；`validateBlueprint` 通过。
- [ ] **Step 2：** `worldCompilerContracts.mjs` 对三份夹具循环跑 P2.5 的 1–4 条断言。
- [ ] **Step 3：** `npm run world:compile -- scripts/fixtures/blueprints/river_town.json --save`，再 `npm run world:new -- river_town --out sim-runs/river-town-fresh`（若 `world:new` 不支持用户世界则顺手修好），在 8797 端口的观察台里能看到占位格子图与 14 个人物。提交 `Add town fixtures and the world:compile command`。

### P2 阶段收尾

- [ ] 全量测试全绿（重点：`world-pack-runtime-equivalence:test`、`world-pack-jiexing:test`、`character-performance-turn:test`）。
- [ ] 写进度小结；停下等审核。**P3 起的详细步骤会在 P2 审核后由 Claude 补全**，以下是确定的范围、接口与验收。

---

# P3 · 像素小镇地图

**阶段目标：** 编译出的小镇有一张真正的外景大地图（街巷、广场、房子、林子、河），每栋房子有自己的室内图。观察台能拖动、缩放、跟随说话的人，能进出屋子，有小地图，外景随时辰明暗变化。逍遥游、借星的画面一个像素都不变。

## 设计要点（先读）

1. **数据格式按规格 §8.1 用 layout v2**：`maps`（外景 `exterior` 加每栋房子一张 `interior:<siteId>`）、`zoneMap`（区在哪张图）、`portals`（屋门两侧的格子）。每张图内部和现在的 v1 格式完全一样。
2. **观察台把所有图拼成一张“图集”画布**：外景放在左上角，室内图依次排在它下方，格子坐标整体平移，不缩放。这样 `tiles.js`、`objects.js`、`director.js` 的绘制和寻路基本不用改。镜头每次只显示一张图对应的矩形。跨图走路的规则是：走到这一侧的门，“跳”到另一侧的门，再接着走。v1 布局就是只有一张图的图集，原样返回。
3. **“哪些格子能走”只有一份定义**：放在 `src/worlds/layoutGeometry.mjs`（纯函数，不依赖 node 也不依赖 DOM）。服务端的验证器和浏览器的观察台都 import 它，`tiles.js` 的 `buildScene` 也改为调用它，所以检查器和画面不可能在“能不能走到”这件事上意见不一。浏览器能拿到它，是因为 `staticAssets.mjs` 会顺着 `src/stage/main.js` 的 import 自动收集模块。
4. **规划器和室内图只产出数据，编译器负责组装**：`townPlanner.mjs` 出外景，`interiors.mjs` 出每栋房子的室内，`layoutV2.mjs` 把两者和拓扑、物件、站位拼成 v2 布局。`simplePlanner.mjs` 和 `placeholderLayout.mjs` 在 P3.4 删除。
5. **验证器只加规则，不放宽规则。** v2 布局走新的 V9（逐图检查）和 V13（小镇地图不变量），v1 布局走原来的 V9，代码路径不变。

## 本阶段特别规则（P2 的教训）

- **不许为了让编译结果通过而修改验证器或冒烟测试。** 编译结果不对就改编译器。本阶段对验证器唯一的改动，是 P3.1 给出的 v2 分支（代码已给出）。
- **每新建一个契约文件，同一个提交里就在 `package.json` 登记。** 阶段末尾用 `npm test` 的总数核对：本阶段新增 5 条契约。
- **对照真实的读取方。** 布局要能被 `buildScene` 画出来，被 `director` 走通，被验证器接受。浏览器走查是验收的一部分，不能用“契约通过”代替。
- **不改夹具。** 三份夹具和种子 1/2/3/7/42 都必须通过；规划器在某个种子上失败，就修规划器。
- 契约代码下面已经逐字给出。**照抄，不要削弱断言。** 如果你确信某条断言本身有错，停下来，写进进度文档等 Claude 判断，不要自己改。

## 文件表（P3）

| 文件 | 任务 | 职责 |
|---|---|---|
| `src/worlds/layoutGeometry.mjs` | P3.1 | 可走格子、矩形关系、寻路（服务端和浏览器共用） |
| `src/worlds/layoutAtlas.mjs` | P3.1 | v2 拼图集、跨图寻路（观察台和契约用） |
| `src/worlds/validateLayoutV2.mjs` | P3.1 | v2 的 V9 和 V13 |
| `src/worlds/validateWorldPack.mjs` | P3.1 | v2 布局走新分支 |
| `src/stage/tiles.js` | P3.1、P3.5 | `buildScene` 改用 `walkableTiles`；画屋顶 |
| `src/server/observer/runsApi.mjs` | P3.1 | `worldVisual` 带上 `startClock` |
| `src/worlds/compiler/rooms.mjs` | P3.2 | 房间展开与连通（拓扑和室内共用） |
| `src/worlds/compiler/topology.mjs` | P3.2 | 用 `rooms.mjs`；野外与镇内的边分开 |
| `src/worlds/compiler/townPlanner.mjs` | P3.2 | 外景规划 |
| `src/worlds/compiler/interiors.mjs` | P3.3 | 室内图 |
| `src/worlds/compiler/layoutV2.mjs` | P3.4 | 组装 v2 布局 |
| `src/worlds/compiler/index.mjs` | P3.4 | 改用 townPlanner 加 layoutV2；`clock.startClock` |
| `src/stage/main.js`、`director.js`、`saves.js`、`objects.js` | P3.5 | 图集、跨图走路、存档缩略图、`fixture` 画法 |
| `src/stage/camera.js` | P3.6 | 镜头 |
| `src/stage/minimap.js` | P3.7 | 小地图 |
| `src/stage/daylight.js`、`lighting.js` | P3.8 | 昼夜 |
| `stage.html`、`src/stage.css` | P3.6、P3.7 | 地图栏、小地图 |

---

### Task P3.1：共享几何、图集与 v2 检查

**Files:** Create `src/worlds/layoutGeometry.mjs`, `src/worlds/layoutAtlas.mjs`, `src/worlds/validateLayoutV2.mjs`, `scripts/layoutV2Contracts.mjs`; Modify `src/worlds/validateWorldPack.mjs`, `src/stage/tiles.js`, `src/server/observer/runsApi.mjs`, `package.json`.

- [ ] **Step 1：写契约** `scripts/layoutV2Contracts.mjs`，在 `package.json` 登记为 `"layout-v2:test"`。运行，确认因为模块不存在而失败。

```js
// Layout v2: one geometry for checker and stage, the atlas the observer draws,
// routes across portals, and the V9/V13 checks for maps.
import assert from "node:assert/strict";
import { walkableTiles, findPath, rectsTouch, rectsOverlap } from "../src/worlds/layoutGeometry.mjs";
import { flattenLayout, routeTiles, mapAtTile, EXTERIOR } from "../src/worlds/layoutAtlas.mjs";
import { validateLayoutV2 } from "../src/worlds/validateLayoutV2.mjs";
import { JIEXING_LAYOUT } from "../src/worlds/jiexing/layout.mjs";

// 1. Geometry: the walkable rule tiles.js has always used.
{
  const walkable = walkableTiles(JIEXING_LAYOUT);
  assert.ok(walkable.has("13,4"), "a door through a wall stays walkable");
  assert.ok(!walkable.has("0,5"), "walls are not walkable");
  assert.ok(!walkable.has("19,11"), "water is not walkable");
  assert.ok(walkable.has("21,10"), "a bridge door over water is walkable");
  assert.ok(!walkable.has("6,4"), "blocked furniture is not walkable");
  assert.equal(findPath(walkable, [2, 4], [21, 12]).length > 0, true, "the bedroom reaches the bridge");
  assert.equal(findPath(walkable, [2, 4], [0, 5]), null);
  assert.ok(rectsTouch([0, 0, 2, 2], [2, 1, 2, 2]) && !rectsTouch([0, 0, 2, 2], [2, 2, 2, 2]), "a shared edge touches, a corner does not");
  assert.ok(rectsOverlap([0, 0, 3, 3], [2, 2, 3, 3]) && !rectsOverlap([0, 0, 2, 2], [2, 0, 2, 2]));
}

// 2. A v1 layout is its own atlas, untouched.
{
  const atlas = flattenLayout(JIEXING_LAYOUT);
  assert.equal(atlas.layout, JIEXING_LAYOUT);
  assert.equal(atlas.version, 1);
  assert.deepEqual(atlas.maps, { [EXTERIOR]: { rect: [0, 0, 24, 13], label: "" } });
  assert.equal(atlas.mapOfZone.yard, EXTERIOR);
  assert.deepEqual(atlas.portals, []);
}

// A street, two houses; each house is its own interior map.
const tinyV2 = () => ({
  layoutVersion: 2, clockLabel: "辰时",
  maps: {
    exterior: { grid: { cols: 14, rows: 6, tile: 16 }, theme: "day",
      zones: { st: { label: "街", rects: [[0, 2, 14, 2]] } },
      doors: [{ between: ["st", "a_hall"], tiles: [[3, 1]], style: "door" }, { between: ["st", "b_hall"], tiles: [[10, 1]], style: "door" }],
      spots: { st: [[1, 2], [2, 2], [4, 3], [6, 2], [8, 3], [12, 2]] },
      roofs: [{ siteId: "a", rect: [1, 0, 5, 2], label: "甲家" }, { siteId: "b", rect: [8, 0, 5, 2], label: "乙家" }],
      props: [{ kind: "lantern", at: [6.5, 4.2] }], lights: [{ at: [6.5, 4.2], r: 20, color: "#ffc060" }],
      walls: [{ rect: [0, 5, 14, 1], style: "fence-wood", posts: [3] }], floors: [{ rect: [0, 2, 14, 2], material: "dirt" }],
      objects: {}, blocked: [[0, 0, 0, 1]], ambient: { birds: [[0, 0, 14, 2]] } },
    "interior:a": { grid: { cols: 6, rows: 5, tile: 16 }, zones: { a_hall: { label: "堂屋", rects: [[1, 1, 4, 3]] } },
      doors: [{ between: ["a_hall", "st"], tiles: [[3, 4]], style: "door" }], spots: { a_hall: [[1, 1], [2, 1], [3, 1], [1, 2], [2, 2], [4, 3]] },
      objects: { pot: { zoneId: "a_hall", at: [1.2, 3.1], drawer: "pot" } } },
    "interior:b": { grid: { cols: 6, rows: 5, tile: 16 }, zones: { b_hall: { label: "堂屋", rects: [[1, 1, 4, 3]] } },
      doors: [{ between: ["b_hall", "st"], tiles: [[3, 4]], style: "door" }], spots: { b_hall: [[1, 1], [2, 1], [3, 1], [1, 2], [2, 2], [4, 3]] } },
  },
  zoneMap: { st: "exterior", a_hall: "interior:a", b_hall: "interior:b" },
  portals: [
    { siteId: "a", exteriorZoneId: "st", exteriorDoorTile: [3, 1], interiorMapId: "interior:a", interiorZoneId: "a_hall", interiorDoorTile: [3, 4] },
    { siteId: "b", exteriorZoneId: "st", exteriorDoorTile: [10, 1], interiorMapId: "interior:b", interiorZoneId: "b_hall", interiorDoorTile: [3, 4] },
  ],
});

// 3. The atlas shifts every coordinate of a map by the same origin.
{
  const atlas = flattenLayout(tinyV2());
  assert.equal(atlas.version, 2);
  assert.deepEqual(atlas.maps.exterior.rect, [0, 0, 14, 6]);
  assert.deepEqual(atlas.maps["interior:a"].rect, [0, 8, 6, 5], "interiors are packed below the exterior with a 2-tile gap");
  assert.deepEqual(atlas.maps["interior:b"].rect, [8, 8, 6, 5]);
  assert.deepEqual(atlas.layout.grid, { cols: 14, rows: 13, tile: 16 });
  assert.deepEqual(atlas.layout.zones.b_hall.rects, [[9, 9, 4, 3]]);
  assert.deepEqual(atlas.layout.spots.b_hall[0], [9, 9]);
  assert.deepEqual(atlas.layout.objects.pot.at, [1.2, 11.1]);
  assert.deepEqual(atlas.layout.walls[0].posts, [3], "exterior wall posts keep their x");
  assert.deepEqual(atlas.layout.blocked[0], [0, 0, 0, 1]);
  assert.equal(atlas.layout.dayCycle, true);
  assert.equal(atlas.layout.clockLabel, "辰时");
  assert.deepEqual(atlas.portals[1], { siteId: "b", exterior: { mapId: "exterior", zoneId: "st", tile: [10, 1] }, interior: { mapId: "interior:b", zoneId: "b_hall", tile: [11, 12] } });
  assert.equal(mapAtTile(atlas, [10, 10]), "interior:b");
  assert.equal(mapAtTile(atlas, [7, 7]), null, "the gap belongs to no map");
}

// 4. Routes cross maps only through portals.
{
  const atlas = flattenLayout(tinyV2());
  const walkable = walkableTiles(atlas.layout);
  const into = routeTiles(atlas, walkable, [1, 2], atlas.layout.spots.a_hall[0]);
  const jump = into.findIndex((step) => step.jump);
  assert.ok(jump > 0, "walk to the door, then jump");
  assert.deepEqual(into[jump - 1].tile, [3, 1], "the last outdoor step is the street door");
  assert.deepEqual(into[jump].tile, [3, 12], "the first indoor step is the house door");
  assert.deepEqual(into.at(-1).tile, atlas.layout.spots.a_hall[0]);
  const across = routeTiles(atlas, walkable, atlas.layout.spots.a_hall[0], atlas.layout.spots.b_hall[0]);
  assert.equal(across.filter((step) => step.jump).length, 2, "house to house goes out through the street");
  assert.ok(across.every((step, i) => step.jump || i === 0 || Math.abs(step.tile[0] - across[i - 1].tile[0]) + Math.abs(step.tile[1] - across[i - 1].tile[1]) === 1), "between jumps every step is one tile");
  assert.equal(routeTiles(atlas, walkable, [1, 2], [7, 7]), null, "no route into the gap");
}

// 5. V9 (maps) and V13 (town) on a correct map and on broken ones.
{
  const pack = (layout) => ({ meta: { scale: "town" }, layout, objects: [{ id: "pot", label: "锅", zoneId: "a_hall" }],
    stage: { topology: { defaultZoneId: "st", zones: { st: {}, a_hall: {}, b_hall: {} }, edges: [{ from: "a_hall", to: "st" }, { from: "b_hall", to: "st" }] } } });
  const codes = (layout) => { const out = []; validateLayoutV2(pack(layout), (rule, code) => out.push(code)); return out; };
  assert.deepEqual(codes(tinyV2()), [], "the tiny town is clean");

  const lotOnStreet = tinyV2(); lotOnStreet.maps.exterior.roofs[0].rect = [1, 1, 5, 2];
  assert.ok(codes(lotOnStreet).includes("TOWN_LOT_ON_ZONE"));
  const detached = tinyV2(); detached.portals[0].exteriorDoorTile = [13, 5]; detached.maps.exterior.doors[0].tiles = [[13, 5]];
  assert.ok(codes(detached).includes("TOWN_PORTAL_DETACHED"));
  const noPortal = tinyV2(); noPortal.portals.pop();
  assert.ok(codes(noPortal).includes("LAYOUT_PORTAL_MISSING"));
  const fewSpots = tinyV2(); fewSpots.maps["interior:b"].spots.b_hall = [[1, 1], [2, 1]];
  assert.ok(codes(fewSpots).includes("TOWN_ZONE_FEW_SPOTS"));
  const twoMaps = tinyV2(); twoMaps.maps["interior:b"].zones.st = { rects: [[0, 0, 1, 1]] };
  assert.ok(codes(twoMaps).includes("LAYOUT_ZONE_MAP_MISMATCH"));
  const walled = tinyV2(); walled.maps["interior:a"].walls = [{ rect: [1, 2, 4, 1], style: "partition" }];
  assert.ok(codes(walled).includes("TOWN_PORTAL_UNREACHABLE"), "a wall between the room and its door is caught");
  const big = tinyV2(); big.maps["interior:a"].grid = { cols: 30, rows: 5, tile: 16 };
  assert.ok(codes(big).includes("TOWN_MAP_TOO_LARGE"));
  const misplaced = tinyV2(); misplaced.maps["interior:a"].objects.pot.at = [0.2, 0.2];
  assert.ok(codes(misplaced).includes("LAYOUT_OBJECT_OUTSIDE_ZONE"));
}

console.log("Layout v2 passed: shared walkable rule, v1 atlas identity, shifted v2 atlas, portal routes, V9/V13 on maps.");
```

- [ ] **Step 2：实现** 下面三个文件逐字照抄。它们已经在 Claude 那边用这份契约跑通过。

`src/worlds/layoutGeometry.mjs`：

```js
// Tile geometry shared by the world validator (server) and the pixel observer
// (browser). One definition of "walkable" keeps the checker and the stage
// from disagreeing about where people can stand and walk.
export const tileKey = ([x, y]) => `${x},${y}`;

export function rectTiles([c0, r0, w, h]) {
  const out = [];
  for (let x = c0; x < c0 + w; x += 1) for (let y = r0; y < r0 + h; y += 1) out.push([x, y]);
  return out;
}

export const inRect = ([x, y], [c0, r0, w, h]) => x >= c0 && x < c0 + w && y >= r0 && y < r0 + h;
export const rectsOverlap = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

/** Two rects share part of an edge (a corner alone does not count). */
export function rectsTouch(a, b) {
  const xs = a[0] < b[0] + b[2] && b[0] < a[0] + a[2];
  const ys = a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
  return (ys && (a[0] + a[2] === b[0] || b[0] + b[2] === a[0])) || (xs && (a[1] + a[3] === b[1] || b[1] + b[3] === a[1]));
}

/** Zone rects and door tiles, minus walls, water and blocked ranges; doors always stay walkable. */
export function walkableTiles(map = {}) {
  const walkable = new Set();
  const doorTiles = new Set((map.doors || []).flatMap((door) => (door.tiles || []).map(tileKey)));
  for (const zone of Object.values(map.zones || {})) for (const rect of zone.rects || []) for (const tile of rectTiles(rect)) walkable.add(tileKey(tile));
  for (const key of doorTiles) walkable.add(key);
  const remove = (c0, r0, c1, r1) => {
    for (let x = c0; x <= c1; x += 1) for (let y = r0; y <= r1; y += 1) if (!doorTiles.has(`${x},${y}`)) walkable.delete(`${x},${y}`);
  };
  for (const wall of map.walls || []) { const [c0, r0, w, h] = wall.rect; remove(c0, r0, c0 + w - 1, r0 + h - 1); }
  for (const floor of map.floors || []) if (floor.material === "water") { const [c0, r0, w, h] = floor.rect; remove(c0, r0, c0 + w - 1, r0 + h - 1); }
  for (const [c0, r0, c1, r1] of map.blocked || []) remove(c0, r0, c1, r1);
  return walkable;
}

/** Shortest 4-way path over walkable tiles; the start tile is not included. null when unreachable. */
export function findPath(walkable, from, to) {
  if (!walkable.has(tileKey(to))) return null;
  if (tileKey(from) === tileKey(to)) return [];
  const prev = new Map([[tileKey(from), null]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const cur = queue[head];
    if (cur[0] === to[0] && cur[1] === to[1]) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = [cur[0] + dx, cur[1] + dy];
      if (!walkable.has(tileKey(next)) || prev.has(tileKey(next))) continue;
      prev.set(tileKey(next), cur);
      queue.push(next);
    }
  }
  if (!prev.has(tileKey(to))) return null;
  const out = [];
  for (let cur = to; cur && tileKey(cur) !== tileKey(from); cur = prev.get(tileKey(cur))) out.unshift(cur);
  return out;
}
```

`src/worlds/layoutAtlas.mjs`：

```js
// The observer draws every map of a layout on one canvas: the exterior at the
// origin, each interior packed below it. Coordinates are shifted, never
// re-scaled, so tiles.js, objects.js and the director work unchanged; the
// camera shows one map's rectangle at a time. A v1 layout is its own atlas.
import { inRect, findPath } from "./layoutGeometry.mjs";

export const EXTERIOR = "exterior";
const GAP = 2;

export function flattenLayout(layout) {
  if (!layout || layout.layoutVersion !== 2) {
    const zones = Object.keys(layout?.zones || {});
    return { layout, version: 1, maps: { [EXTERIOR]: { rect: [0, 0, layout?.grid?.cols || 0, layout?.grid?.rows || 0], label: "" } },
      mapOfZone: Object.fromEntries(zones.map((id) => [id, EXTERIOR])), portals: [] };
  }
  const exterior = layout.maps[EXTERIOR];
  const width = exterior.grid.cols;
  const origins = { [EXTERIOR]: [0, 0] };
  let x = 0, y = exterior.grid.rows + GAP, rowHeight = 0;
  for (const id of Object.keys(layout.maps).filter((key) => key !== EXTERIOR).sort()) {
    const { cols, rows } = layout.maps[id].grid;
    if (x > 0 && x + cols > width) { x = 0; y += rowHeight + GAP; rowHeight = 0; }
    origins[id] = [x, y];
    x += cols + GAP;
    rowHeight = Math.max(rowHeight, rows);
  }
  const ids = Object.keys(origins);
  const out = {
    grid: { cols: Math.max(...ids.map((id) => origins[id][0] + layout.maps[id].grid.cols)), rows: Math.max(...ids.map((id) => origins[id][1] + layout.maps[id].grid.rows)), tile: exterior.grid.tile || 16 },
    theme: exterior.theme, clockLabel: layout.clockLabel || exterior.clockLabel || "", dayCycle: true,
    zones: {}, floors: [], walls: [], doors: [], props: [], objects: {}, lights: [], spots: {}, blocked: [], roofs: [], ambient: {},
  };
  const maps = {};
  for (const id of ids) {
    const map = layout.maps[id];
    const [ox, oy] = origins[id];
    const rect = ([c, r, w, h]) => [c + ox, r + oy, w, h];
    const point = ([a, b, ...rest]) => [a + ox, b + oy, ...rest];
    maps[id] = { rect: [ox, oy, map.grid.cols, map.grid.rows], label: map.label || "", siteId: map.siteId || null };
    for (const [zoneId, zone] of Object.entries(map.zones || {})) out.zones[zoneId] = { ...zone, rects: (zone.rects || []).map(rect) };
    for (const row of map.floors || []) out.floors.push({ ...row, rect: rect(row.rect) });
    for (const row of map.walls || []) out.walls.push({ ...row, rect: rect(row.rect), ...(row.posts ? { posts: row.posts.map((p) => p + ox) } : {}) });
    for (const row of map.doors || []) out.doors.push({ ...row, tiles: (row.tiles || []).map(point) });
    for (const row of map.props || []) out.props.push({ ...row, at: point(row.at) });
    for (const [objectId, spec] of Object.entries(map.objects || {})) out.objects[objectId] = { ...spec, ...(spec.at ? { at: point(spec.at) } : {}) };
    for (const row of map.lights || []) out.lights.push({ ...row, at: point(row.at) });
    for (const [zoneId, spots] of Object.entries(map.spots || {})) out.spots[zoneId] = spots.map(point);
    for (const [c0, r0, c1, r1] of map.blocked || []) out.blocked.push([c0 + ox, r0 + oy, c1 + ox, r1 + oy]);
    for (const row of map.roofs || []) out.roofs.push({ ...row, rect: rect(row.rect) });
    for (const [kind, rects] of Object.entries(map.ambient || {})) {
      if (Array.isArray(rects)) out.ambient[kind] = [...(out.ambient[kind] || []), ...rects.map(rect)];
      else if (id === EXTERIOR) out.ambient[kind] = rects;
    }
  }
  const at = (mapId, tile) => [tile[0] + origins[mapId][0], tile[1] + origins[mapId][1]];
  const portals = (layout.portals || []).map((row) => ({
    siteId: row.siteId,
    exterior: { mapId: EXTERIOR, zoneId: row.exteriorZoneId, tile: at(EXTERIOR, row.exteriorDoorTile) },
    interior: { mapId: row.interiorMapId, zoneId: row.interiorZoneId, tile: at(row.interiorMapId, row.interiorDoorTile) },
  }));
  return { layout: out, version: 2, maps, mapOfZone: { ...layout.zoneMap }, portals };
}

export function mapAtTile(atlas, tile) {
  return Object.entries(atlas.maps).find(([, map]) => inRect(tile, map.rect))?.[0] || null;
}

/**
 * Tiles to walk from one atlas tile to another. Crossing between maps goes
 * through a portal: walk to this side's door, then `{ jump: true }` marks the
 * first tile on the other map. null when no route exists.
 */
export function routeTiles(atlas, walkable, from, to) {
  const fromMap = mapAtTile(atlas, from), toMap = mapAtTile(atlas, to);
  if (fromMap === toMap) return findPath(walkable, from, to);
  const hops = [];
  let here = from, map = fromMap;
  const side = (portal, mapId) => (portal.exterior.mapId === mapId ? portal.exterior : portal.interior.mapId === mapId ? portal.interior : null);
  // At most two portals: interior → exterior → another interior.
  for (let guard = 0; guard < 3 && map !== toMap; guard += 1) {
    const portal = atlas.portals.find((row) => side(row, map) && (side(row, toMap) || map !== EXTERIOR))
      || atlas.portals.find((row) => side(row, map));
    if (!portal) return null;
    const exit = side(portal, map);
    const enter = exit === portal.exterior ? portal.interior : portal.exterior;
    const walk = findPath(walkable, here, exit.tile);
    if (!walk) return null;
    hops.push(...walk.map((tile) => ({ tile })), { tile: enter.tile, jump: true });
    here = enter.tile; map = enter.mapId;
  }
  if (map !== toMap) return null;
  const last = findPath(walkable, here, to);
  if (!last) return null;
  return [...hops, ...last.map((tile) => ({ tile }))];
}
```

`src/worlds/validateLayoutV2.mjs`：

```js
// Layout v2 checks (spec §8): V9 for maps, portals and objects, and V13 for
// town maps. Everything is decided with layoutGeometry, the same tile rules
// the observer walks by.
import { walkableTiles, findPath, inRect, rectsOverlap, rectsTouch, rectTiles, tileKey } from "./layoutGeometry.mjs";

const list = (value) => (Array.isArray(value) ? value : []);
const MAX_EXTERIOR = [128, 96], MAX_INTERIOR = [24, 16], MIN_TOWN_SPOTS = 6;

export function validateLayoutV2(pack, add) {
  const layout = pack.layout || {};
  const topology = pack.stage?.topology || {};
  const zoneIds = Object.keys(topology.zones || {});
  const edges = list(topology.edges);
  const maps = layout.maps || {};
  const town = pack.meta?.scale === "town";
  const mapOf = (zoneId) => layout.zoneMap?.[zoneId];
  const rectsOf = (zoneId) => list(maps[mapOf(zoneId)]?.zones?.[zoneId]?.rects);
  const walkable = Object.fromEntries(Object.entries(maps).map(([id, map]) => [id, walkableTiles(map)]));
  const spotsOf = (zoneId) => list(maps[mapOf(zoneId)]?.spots?.[zoneId]);

  if (!maps.exterior) add("V9", "LAYOUT_EXTERIOR_MISSING", "layout.maps.exterior", "v2 布局缺少外景图");

  // Every zone lives on exactly one map, has a rect there and somewhere to stand.
  for (const zoneId of zoneIds) {
    const mapId = mapOf(zoneId);
    const holders = Object.entries(maps).filter(([, map]) => map.zones?.[zoneId]).map(([id]) => id);
    if (!mapId || !maps[mapId]) { add("V9", "LAYOUT_ZONE_UNMAPPED", `layout.zoneMap.${zoneId}`, `区 ${zoneId} 没有指定所在的图`); continue; }
    if (holders.length !== 1 || holders[0] !== mapId) add("V9", "LAYOUT_ZONE_MAP_MISMATCH", `layout.zoneMap.${zoneId}`, `区 ${zoneId} 应只出现在 ${mapId} 上（现在：${holders.join("、") || "无"}）`);
    if (!rectsOf(zoneId).length) { add("V9", "LAYOUT_ZONE_MISSING", `layout.maps.${mapId}.zones.${zoneId}`, `布局缺少区 ${zoneId}`); continue; }
    const standing = spotsOf(zoneId).filter((spot) => rectsOf(zoneId).some((rect) => inRect(spot, rect)) && walkable[mapId].has(tileKey(spot)));
    if (!standing.length) add("V9", "LAYOUT_ZONE_WITHOUT_SPOT", `layout.maps.${mapId}.spots.${zoneId}`, `区 ${zoneId} 没有可站位置`);
    else if (town && new Set(standing.map(tileKey)).size < MIN_TOWN_SPOTS) add("V13", "TOWN_ZONE_FEW_SPOTS", `layout.maps.${mapId}.spots.${zoneId}`, `区 ${zoneId} 只有 ${standing.length} 个可站位置，小镇至少 ${MIN_TOWN_SPOTS} 个`);
  }

  // Every topology edge is walkable on the map: touching rects or a door on one map, a portal across maps.
  const portalFor = (a, b) => list(layout.portals).find((row) => (row.interiorZoneId === a && row.exteriorZoneId === b) || (row.interiorZoneId === b && row.exteriorZoneId === a));
  for (const edge of edges) {
    const [ma, mb] = [mapOf(edge.from), mapOf(edge.to)];
    if (!maps[ma] || !maps[mb]) continue;
    if (ma === mb) {
      const map = maps[ma];
      const linked = rectsOf(edge.from).some((a) => rectsOf(edge.to).some((b) => rectsTouch(a, b)))
        || list(map.doors).some((door) => door.between?.includes(edge.from) && door.between?.includes(edge.to));
      if (!linked) { add("V9", "LAYOUT_DOOR_MISSING", `layout.maps.${ma}.doors`, `布局缺少 ${edge.from}↔${edge.to} 的通道`); continue; }
      const [from, to] = [spotsOf(edge.from)[0], spotsOf(edge.to)[0]];
      if (town && from && to && !findPath(walkable[ma], from, to)) add("V13", "TOWN_EDGE_NOT_WALKABLE", `layout.maps.${ma}`, `${edge.from} 走不到 ${edge.to}`);
      continue;
    }
    const portal = portalFor(edge.from, edge.to);
    if (!portal) { add("V9", "LAYOUT_PORTAL_MISSING", "layout.portals", `${edge.from}↔${edge.to} 跨图却没有门`); continue; }
    const sides = [[portal.exteriorZoneId, "exterior", portal.exteriorDoorTile], [portal.interiorZoneId, portal.interiorMapId, portal.interiorDoorTile]];
    for (const [zoneId, mapId, tile] of sides) {
      if (mapOf(zoneId) !== mapId) { add("V9", "LAYOUT_PORTAL_MAP_MISMATCH", "layout.portals", `${portal.siteId} 的门所在的图与区 ${zoneId} 不符`); continue; }
      const spot = spotsOf(zoneId)[0];
      if (!tile || !walkable[mapId].has(tileKey(tile))) add("V9", "LAYOUT_PORTAL_TILE_BLOCKED", "layout.portals", `${portal.siteId} 在 ${mapId} 的门不在可走的格子上`);
      else if (town && spot && !findPath(walkable[mapId], spot, tile)) add("V13", "TOWN_PORTAL_UNREACHABLE", "layout.portals", `${zoneId} 走不到 ${portal.siteId} 的门`);
    }
    // The street door sits right next to its street (spec §8.2).
    const street = rectsOf(portal.exteriorZoneId);
    const [dx, dy] = portal.exteriorDoorTile || [];
    if (town && !street.some((rect) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => inRect([dx + ox, dy + oy], rect)))) {
      add("V13", "TOWN_PORTAL_DETACHED", "layout.portals", `${portal.siteId} 的门没有挨着 ${portal.exteriorZoneId}`);
    }
  }

  // Drawn objects are on the map of their zone, inside it.
  const objects = new Map(list(pack.objects).map((row) => [row.id, row]));
  for (const [mapId, map] of Object.entries(maps)) {
    for (const [id, drawn] of Object.entries(map.objects || {})) {
      const object = objects.get(id);
      if (!object) { add("V9", "LAYOUT_OBJECT_UNKNOWN", `layout.maps.${mapId}.objects.${id}`, `布局画了不存在的物件 ${id}`); continue; }
      const zoneId = object.zoneId || topology.defaultZoneId;
      if (drawn.zoneId !== zoneId || mapOf(zoneId) !== mapId) add("V9", "LAYOUT_OBJECT_ZONE_MISMATCH", `layout.maps.${mapId}.objects.${id}`, `${object.label} 画在 ${mapId}/${drawn.zoneId}，世界里在 ${zoneId}`);
      else if (drawn.at && !rectsOf(zoneId).some((rect) => inRect(drawn.at, rect))) add("V9", "LAYOUT_OBJECT_OUTSIDE_ZONE", `layout.maps.${mapId}.objects.${id}`, `${object.label} 的位置不在所属区内`);
    }
  }
  if (!town) return;

  // V13 — map size and nothing built on top of anything else.
  for (const [mapId, map] of Object.entries(maps)) {
    const [maxCols, maxRows] = mapId === "exterior" ? MAX_EXTERIOR : MAX_INTERIOR;
    if (!(map.grid?.cols <= maxCols && map.grid?.rows <= maxRows)) add("V13", "TOWN_MAP_TOO_LARGE", `layout.maps.${mapId}.grid`, `${mapId} 尺寸 ${map.grid?.cols}×${map.grid?.rows} 超过 ${maxCols}×${maxRows}`);
    const zoneRects = Object.entries(map.zones || {}).flatMap(([zoneId, zone]) => list(zone.rects).map((rect) => ({ zoneId, rect })));
    const outOfBounds = zoneRects.find(({ rect }) => rect[0] < 0 || rect[1] < 0 || rect[0] + rect[2] > map.grid.cols || rect[1] + rect[3] > map.grid.rows);
    if (outOfBounds) add("V13", "TOWN_ZONE_OUT_OF_MAP", `layout.maps.${mapId}.zones.${outOfBounds.zoneId}`, `区 ${outOfBounds.zoneId} 超出了 ${mapId}`);
    for (let i = 0; i < zoneRects.length; i += 1) for (let j = i + 1; j < zoneRects.length; j += 1) {
      if (zoneRects[i].zoneId !== zoneRects[j].zoneId && rectsOverlap(zoneRects[i].rect, zoneRects[j].rect)) {
        add("V13", "TOWN_ZONES_OVERLAP", `layout.maps.${mapId}.zones`, `${zoneRects[i].zoneId} 与 ${zoneRects[j].zoneId} 重叠`);
      }
    }
    const lots = list(map.roofs);
    for (let i = 0; i < lots.length; i += 1) {
      for (let j = i + 1; j < lots.length; j += 1) if (rectsOverlap(lots[i].rect, lots[j].rect)) add("V13", "TOWN_LOTS_OVERLAP", `layout.maps.${mapId}.roofs`, `${lots[i].siteId} 与 ${lots[j].siteId} 的房子重叠`);
      const hit = zoneRects.find(({ rect }) => rectsOverlap(rect, lots[i].rect));
      if (hit) add("V13", "TOWN_LOT_ON_ZONE", `layout.maps.${mapId}.roofs`, `${lots[i].siteId} 的房子压在 ${hit.zoneId} 上`);
    }
    const water = list(map.floors).filter((row) => row.material === "water").map((row) => row.rect);
    for (const { zoneId, rect } of zoneRects) {
      const wet = rectTiles(rect).filter((tile) => water.some((w) => inRect(tile, w)));
      if (wet.length === rectTiles(rect).length) add("V13", "TOWN_ZONE_UNDER_WATER", `layout.maps.${mapId}.zones.${zoneId}`, `区 ${zoneId} 整块在水里`);
    }
  }
}
```

- [ ] **Step 3：接线**
  - `validateWorldPack.mjs`：在 `// V9 — the observer can show…` 一节最前面加分支：`if (pack.layout?.layoutVersion === 2) { validateLayoutV2(pack, add); return { ok: issues.length === 0, issues }; }`。原来的 v1 代码一个字不改。`add` 是该文件里已有的 `(rule, code, path, message)` 函数。
  - `tiles.js`：`buildScene` 里从 `// Walkable tiles:` 到 `for (const [c0, r0, c1, r1] of layout.blocked …` 这一段，换成 `const walkable = walkableTiles(layout);`，并加上 `import { walkableTiles } from "../worlds/layoutGeometry.mjs";`。返回值不变。
  - `runsApi.mjs` 的 `worldVisual`：加一个字段 `startClock: pack.clock?.startClock || ""`。
- [ ] **Step 4：验证**
  - `npm run check`。
  - 跑 `layout-v2:test`、`world-pack-core:test`、`world-pack-validator:test`、`world-pack-runtime-equivalence:test`、`observer-runs-api:test`，全绿。
  - 浏览器（8798 端口，临时 `CHARACTER_TOWN_HOME`）打开一个借星存档，人物照常走动。确认 `tiles.js` 的改动没有改变画面和寻路。
- [ ] **Step 5：提交** `Share tile geometry and check v2 layouts`。

### Task P3.2：房间展开共用、拓扑修正、外景规划器

**Files:** Create `src/worlds/compiler/rooms.mjs`, `src/worlds/compiler/townPlanner.mjs`, `scripts/townPlannerContracts.mjs`; Modify `src/worlds/compiler/topology.mjs`, `package.json`.

- [ ] **Step 1：写契约** `scripts/townPlannerContracts.mjs`，登记为 `"town-planner:test"`。

```js
// The exterior planner: a real town map for any blueprint, the same map for
// the same seed, and nothing built on top of anything else.
import assert from "node:assert/strict";
import fs from "node:fs";
import { planTown } from "../src/worlds/compiler/townPlanner.mjs";
import { SITE_TYPES } from "../src/worlds/catalog/siteTypes.mjs";
import { walkableTiles, findPath, inRect, rectsOverlap, rectsTouch, rectTiles, tileKey } from "../src/worlds/layoutGeometry.mjs";

const SEEDS = [1, 2, 3, 7, 42];
const fixture = (name) => JSON.parse(fs.readFileSync(`scripts/fixtures/blueprints/${name}.json`, "utf8"));

// A crowded town that uses every outdoor type and the largest map tier.
function bigTown() {
  const homes = Array.from({ length: 16 }, (_, i) => ({ id: `home_${i + 1}`, name: `${i + 1}号院`, type: i % 4 === 0 ? "smithy" : i % 5 === 0 ? "inn" : "home", householdId: `hh_${i + 1}` }));
  const outdoors = ["square", "well", "market", "forest", "hill", "field", "river_bank", "bridge", "pond", "road_out"]
    .map((type) => ({ id: `${type}_site`, name: SITE_TYPES[type].label.split(/[/\s]/u)[0], type }));
  return {
    meta: { id: "big_town", seed: 5 },
    town: { name: "大镇", terrain: { river: "south", forest: "north", hills: "east", fields: "west" }, sites: [...homes, ...outdoors] },
    households: homes.map((site) => ({ id: site.householdId, name: site.name, siteId: site.id })),
    residents: homes.map((site, i) => ({ id: `r_${i + 1}`, householdId: site.householdId })),
  };
}

const tier = (buildings) => (buildings <= 6 ? [64, 48] : buildings <= 12 ? [96, 64] : [128, 96]);
const siteZoneIds = (site) => (SITE_TYPES[site.type].zones || SITE_TYPES[site.type].rooms).map((row) => `${site.id}__${row.suffix}`);

function checkPlan(blueprint, seed) {
  const label = `${blueprint.meta.id}#${seed}`;
  const plan = planTown(blueprint, { catalog: SITE_TYPES, seed });
  const { map } = plan;
  const sites = blueprint.town.sites;
  const buildings = sites.filter((site) => SITE_TYPES[site.type].kind === "building");
  const outdoors = sites.filter((site) => SITE_TYPES[site.type].kind === "outdoor");

  // Size tier and bounds.
  assert.deepEqual([map.grid.cols, map.grid.rows], tier(buildings.length), `${label}: map size follows the building count`);
  const inMap = ([c, r, w, h]) => c >= 0 && r >= 0 && c + w <= map.grid.cols && r + h <= map.grid.rows;

  // Every street, the plaza and every outdoor zone is drawn.
  const zoneIds = [...plan.streets.map((row) => row.id), plan.plazaZoneId, ...outdoors.flatMap(siteZoneIds)];
  for (const zoneId of new Set(zoneIds)) assert.ok(map.zones[zoneId]?.rects?.length, `${label}: ${zoneId} has a rect`);
  const zoneRects = Object.entries(map.zones).flatMap(([zoneId, zone]) => zone.rects.map((rect) => ({ zoneId, rect })));
  for (const { zoneId, rect } of zoneRects) assert.ok(inMap(rect), `${label}: ${zoneId} stays inside the map`);
  for (let i = 0; i < zoneRects.length; i += 1) for (let j = i + 1; j < zoneRects.length; j += 1) {
    if (zoneRects[i].zoneId !== zoneRects[j].zoneId) assert.ok(!rectsOverlap(zoneRects[i].rect, zoneRects[j].rect), `${label}: ${zoneRects[i].zoneId} and ${zoneRects[j].zoneId} do not overlap`);
  }

  // Lots: one per building, its catalog footprint, on nothing else, door facing its street.
  assert.deepEqual(Object.keys(plan.lots).sort(), buildings.map((site) => site.id).sort());
  const lots = Object.entries(plan.lots);
  for (const [siteId, lot] of lots) {
    const site = sites.find((row) => row.id === siteId);
    const [fw, fh] = SITE_TYPES[site.type].footprint;
    assert.ok((lot.rect[2] === fw && lot.rect[3] === fh) || (lot.rect[2] === fh && lot.rect[3] === fw), `${label}: ${siteId} uses its footprint`);
    assert.ok(inMap(lot.rect), `${label}: ${siteId} lot inside the map`);
    for (const { zoneId, rect } of zoneRects) assert.ok(!rectsOverlap(lot.rect, rect), `${label}: ${siteId} lot is not on ${zoneId}`);
    const [dx, dy] = lot.doorTile;
    const [c, r, w, h] = lot.rect;
    assert.ok(inRect(lot.doorTile, lot.rect) && (dx === c || dx === c + w - 1 || dy === r || dy === r + h - 1), `${label}: ${siteId} door is on the lot edge`);
    const street = map.zones[plan.frontOf[siteId]].rects;
    assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => street.some((rect) => inRect([dx + ox, dy + oy], rect))), `${label}: ${siteId} door opens onto ${plan.frontOf[siteId]}`);
    assert.ok(map.doors.some((door) => door.tiles.some((tile) => tileKey(tile) === tileKey(lot.doorTile))), `${label}: ${siteId} door is drawn`);
    assert.ok(map.roofs.some((roof) => roof.siteId === siteId && JSON.stringify(roof.rect) === JSON.stringify(lot.rect)), `${label}: ${siteId} has a roof`);
  }
  for (let i = 0; i < lots.length; i += 1) for (let j = i + 1; j < lots.length; j += 1) {
    assert.ok(!rectsOverlap(lots[i][1].rect, lots[j][1].rect), `${label}: ${lots[i][0]} and ${lots[j][0]} do not overlap`);
  }

  // The network: links touch, outdoor entries touch, and everything hangs together.
  const touch = (a, b) => map.zones[a].rects.some((x) => map.zones[b].rects.some((y) => rectsTouch(x, y)));
  for (const [a, b] of plan.streetLinks) assert.ok(touch(a, b), `${label}: linked ${a} and ${b} touch`);
  for (const site of outdoors) {
    const entry = siteZoneIds(site)[0];
    if (plan.outdoorEntry[site.id] !== entry) assert.ok(touch(entry, plan.outdoorEntry[site.id]), `${label}: ${entry} touches ${plan.outdoorEntry[site.id]}`);
    const ids = siteZoneIds(site);
    for (let k = 1; k < ids.length; k += 1) assert.ok(touch(ids[k - 1], ids[k]), `${label}: ${ids[k - 1]} touches ${ids[k]}`);
  }

  // Spots and walking: six places to stand per zone, and the plaza reaches every zone and door.
  const walkable = walkableTiles(map);
  for (const zoneId of Object.keys(map.zones)) {
    const spots = map.spots[zoneId] || [];
    assert.ok(new Set(spots.map(tileKey)).size >= 6, `${label}: ${zoneId} has six spots`);
    for (const spot of spots) assert.ok(walkable.has(tileKey(spot)) && map.zones[zoneId].rects.some((rect) => inRect(spot, rect)), `${label}: ${zoneId} spot ${spot} is walkable and inside`);
  }
  const start = map.spots[plan.plazaZoneId][0];
  for (const zoneId of Object.keys(map.zones)) assert.ok(findPath(walkable, start, map.spots[zoneId][0]), `${label}: the plaza reaches ${zoneId}`);
  for (const [siteId, lot] of lots) assert.ok(findPath(walkable, start, lot.doorTile), `${label}: the plaza reaches the door of ${siteId}`);

  // Water never covers a street, the plaza or a lot.
  const water = map.floors.filter((row) => row.material === "water").map((row) => row.rect);
  for (const id of [...plan.streets.map((row) => row.id), plan.plazaZoneId]) {
    for (const rect of map.zones[id].rects) assert.ok(!rectTiles(rect).some((tile) => water.some((w) => inRect(tile, w))), `${label}: ${id} is dry`);
  }
  for (const [siteId, lot] of lots) assert.ok(!water.some((w) => rectsOverlap(w, lot.rect)), `${label}: ${siteId} is dry`);

  // Wild places sit on the side the blueprint names.
  const side = { forest: "forest", hill: "hills", field: "fields", river_bank: "river" };
  for (const site of outdoors) {
    const direction = blueprint.town.terrain?.[side[site.type]];
    if (!direction) continue;
    const rects = siteZoneIds(site).flatMap((id) => map.zones[id].rects);
    const cx = rects.reduce((sum, [c, , w]) => sum + c + w / 2, 0) / rects.length;
    const cy = rects.reduce((sum, [, r, , h]) => sum + r + h / 2, 0) / rects.length;
    const ok = { north: cy < map.grid.rows / 2, south: cy > map.grid.rows / 2, west: cx < map.grid.cols / 2, east: cx > map.grid.cols / 2 }[direction];
    assert.ok(ok, `${label}: ${site.id} lies to the ${direction}`);
  }
  return plan;
}

for (const blueprint of [fixture("tiny_hamlet"), fixture("river_town"), fixture("forest_village"), bigTown()]) {
  const maps = new Set();
  for (const seed of SEEDS) {
    const plan = checkPlan(blueprint, seed);
    assert.equal(JSON.stringify(planTown(blueprint, { catalog: SITE_TYPES, seed })), JSON.stringify(plan), `${blueprint.meta.id}#${seed}: the same seed gives the same town`);
    maps.add(JSON.stringify(plan.map));
  }
  assert.ok(maps.size >= 2, `${blueprint.meta.id}: different seeds give different towns`);
}

console.log("Town planner passed: footprints, doors on streets, no overlaps, connected network, six spots per zone, wild places on their side, deterministic.");
```

- [ ] **Step 2：抽出房间展开** `src/worlds/compiler/rooms.mjs`。拓扑和室内图必须用同一份展开结果，否则房间对不上。

```js
// Rooms of a building as topology and interiors both see them: perResidents
// rooms repeat (bedroom_1, bedroom_2…), and links expand "bedroom*" patterns.
export function expandRooms(def, residentCount) {
  const rooms = [];
  for (const room of def.rooms || []) {
    if (room.perResidents) {
      const needed = Math.max(1, Math.ceil(Math.max(1, residentCount) / room.perResidents));
      for (let i = 1; i <= needed; i += 1) rooms.push({ suffix: `${room.suffix}_${i}`, baseSuffix: room.suffix, label: `${room.label}${needed > 1 ? i : ""}`, entry: Boolean(room.entry) });
    } else rooms.push({ suffix: room.suffix, baseSuffix: room.suffix, label: room.label, entry: Boolean(room.entry) });
  }
  return rooms;
}
const matches = (pattern, room) => (pattern.endsWith("*") ? room.baseSuffix === pattern.slice(0, -1) : room.suffix === pattern || room.baseSuffix === pattern);
export function expandLinks(def, rooms) {
  const out = [];
  for (const [a, b] of def.links || []) for (const x of rooms.filter((r) => matches(a, r))) for (const y of rooms.filter((r) => matches(b, r))) {
    if (x.suffix !== y.suffix && !out.some(([p, q]) => (p === x.suffix && q === y.suffix) || (p === y.suffix && q === x.suffix))) out.push([x.suffix, y.suffix]);
  }
  return out;
}
```

`topology.mjs` 删掉自己的 `expandedRooms` 循环和 `matchRooms`，改用 `expandRooms(def, residentCount)` 和 `expandLinks(def, rooms)`。

- [ ] **Step 3：拓扑的两处修正**（P2 遗留）
  1. `topology.mjs` 里写的是 `def.type === "square" || def.type === "well"`，但目录条目没有 `type` 字段，所以广场、井也被当成了野外（`TO_WILD`）。
  2. 改成按地形区分：`const WILD = new Set(["forest", "hills", "field"]);`。`def.terrain` 在其中的，室外地点内部的边和入口边用 `TO_WILD(2)`/`TO_WILD(3)`；其余（广场、集市、井、桥、河岸、池塘、官道）一律用 `STREET_STREET(1)`。
  3. `plan.outdoorEntry[siteId]` 现在可能是另一个室外地点的入口区（同一条地貌带上串起来的地点）。这种边用 `TO_WILD(3)`。

- [ ] **Step 4：实现 `townPlanner.mjs`**。导出与 `simplePlanner` 同名同参的 `planTown(blueprint, { catalog, seed })`，返回：

```js
{
  plazaZoneId,                       // 有 square 地点时为 `${squareId}__center`，否则 "street_plaza"
  streets: [{ id, label, length: 1 }],  // id 为 street_1、street_2…；label 如“西街一段”
  streetLinks: [[zoneA, zoneB]],     // 广场—各条街的第一段，以及同一条街上相邻的段
  frontOf: { [buildingSiteId]: streetId },
  outdoorEntry: { [outdoorSiteId]: zoneId },  // 街段、广场，或同一地貌带上前一个地点的入口区
  lots: { [buildingSiteId]: { rect: [x, y, w, h], doorTile: [x, y] } },
  map: { grid: { cols, rows, tile: 16 }, theme: "day", zones: { [zoneId]: { rects } }, floors, walls, doors, props, spots, blocked: [], roofs, ambient },
}
```

`map.zones` 包含所有街段、广场区和室外地点的全部区（`${siteId}__${suffix}`），不含建筑。建筑在外景上只出现为 `roofs: [{ siteId, rect, label }]` 和门 `doors: [{ between: [街段, siteId], tiles: [doorTile], style: "door" }]`。`between` 的第二项先写 siteId，P3.4 换成入口房间的区。

**常量：** `STREET = 2`（街宽）、`PLAZA = [10, 8]`、`SEGMENT = 10`（街段最长格数）、`BAND = 14`（地貌带厚度）、`GAP = 1`（房子之间的空隙）。尺寸档按建筑数：≤6 栋 64×48，≤12 栋 96×64，其余 128×96。

**步骤（全部用 `createRng(seed)`，不许用 `Math.random`）：**
1. **地貌带。**
   - 四种地貌：river（`terrain.river` 或有 river_bank/bridge/pond 地点）、forest（`terrain.forest` 或有 forest 地点）、hills（`terrain.hills` 或有 hill 地点）、fields（`terrain.fields` 或有 field 地点）。
   - 蓝图写了方向的用写的方向。没写的，按 north→east→south→west 取第一个空着的边；四边都占满就和第一个同边的地貌平分这条边。
   - 南北带横跨全宽，东西带只占南北带之间的部分。
   - 地图去掉地貌带后剩下的是“镇区”（core）。
2. **广场和十字街。**
   - 广场矩形放在镇区正中，用种子偏移 ±2 格。
   - 有 square 地点时，左边 `PLAZA[0]-3` 列是 `square__center`，右边 3 列是 `square__edge`，`plazaZoneId` 为 center；没有就整块是 `street_plaza`。
   - 从广场四边的中线伸出四条宽 2 的街，一直通到镇区边缘。
   - 每条街从广场往外切成长度不超过 `SEGMENT` 的段。按 西、东、北、南 的顺序编号 `street_1…`，label 为“西街一段”“西街二段”“东街一段”……
3. **镇内的室外小地点先占位（在摆房子之前）。**
   - well：3×3，贴着广场。
   - market：6×4，贴着广场另一边。
   - road_out：从某条街最外一段的尽头切下 3 格作为 `gate` 区；优先选没有地貌带的那一边；切过的街段相应缩短。
   - 都不能压在街和广场上。
4. **摆房子。**
   - 顺序：非住宅（铺子、客栈等）在前，住宅在后，住宅的先后顺序用种子打乱。
   - 候选位置是“某条街的某一侧”，共 8 个，按 西北、西南、东北、东南、北西、北东、南西、南东 轮转，起点由种子决定。
   - 每栋房子用目录的 `footprint`，横街两侧的房子门朝街开在房子靠街那条边的中点，竖街两侧同理。
   - 从靠近广场的一端往外排，房子之间隔 `GAP`。放不下就换下一个位置；8 个都放不下就抛 `PLANNER_NO_ROOM`。
   - `frontOf` 取门外那一格所在的街段。
5. **野外与河。**
   - 地貌带里的地点从这条边那条街的尽头开始，紧贴镇区边缘依次排。
   - 第一个地点的入口区（forest 的 edge、hill 的 slope、field 的 path、river_bank 的 bank，6×4）贴着街尽头，`outdoorEntry` 是那个街段。
   - 同一条带上后面的地点贴着前一个地点的入口区，`outdoorEntry` 写前一个地点的入口区 id。
   - 第二个区（deep、top、crop，8×5）贴着入口区，再往带里放。
   - 河带：离镇区边缘 3–5 格处是一条 3 格厚的水（`floors` 的 `water`）。bridge 的 deck 区是一个横跨水面的 3 格宽矩形，这几列不画水；pond 的 side 区旁边画一小块水，水不能压在区上。
6. **站位与装饰。**
   - 每个区取可走格子，按行列排序后等间隔取 8 个作为 `spots`（至少 6 个）。
   - 地面：全图 grass，街 dirt，广场 stone，林带 meadow，山带 hill，田里的 crop 区 herbs，河岸 path，桥 stone。
   - 装饰（tree、willow、lantern、篱笆墙 `fence-wood`）只放在“不属于任何区、不在房子上”的格子里：林带种树，河边种柳，田的四周围篱笆，广场四角挂灯笼，天上加几只 `ambient.birds`。

**实现建议：**
- 先写一个占用网格 `occupied = new Set()`，再写 `canPlace(rect)` 和 `occupy(rect, tag)`。所有区、房子、水都通过它登记，这样不重叠是天然成立的。
- 契约里的大镇（16 栋房子，10 种室外地点）先在本地用 1–2 个种子跑通，再跑全量。

- [ ] **Step 5：验证**
  - `town-planner:test` 全绿。
  - `compiler:test` 此时仍用旧的 `simplePlanner`，应该照常通过。规划器在 P3.4 才接进编译器。
- [ ] **Step 6：提交** `Plan town exteriors from the blueprint`。

### Task P3.3：室内图

**Files:** Create `src/worlds/compiler/interiors.mjs`, `scripts/interiorsContracts.mjs`; Modify `package.json`.

- [ ] **Step 1：写契约** `scripts/interiorsContracts.mjs`，登记为 `"interiors:test"`。

```js
// Interiors: every building type, any household size, both variants — rooms
// as topology expands them, a door in the wall for every link, a front door
// on the bottom wall, furniture and objects in their rooms, six spots a room.
import assert from "node:assert/strict";
import { SITE_TYPES } from "../src/worlds/catalog/siteTypes.mjs";
import { expandRooms, expandLinks } from "../src/worlds/compiler/rooms.mjs";
import { buildInterior, interiorVariant } from "../src/worlds/compiler/interiors.mjs";
import { walkableTiles, findPath, inRect, rectsOverlap, rectTiles, tileKey } from "../src/worlds/layoutGeometry.mjs";

const near = ([x, y], rect) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inRect([x + dx, y + dy], rect));

for (const [type, def] of Object.entries(SITE_TYPES).filter(([, row]) => row.kind === "building")) {
  assert.ok(def.interiorTemplates?.length, `${type} lists interior templates`);
  for (const residentCount of [1, 2, 4, 6]) {
    for (const templateId of def.interiorTemplates) {
      const label = `${type}/${templateId}/${residentCount}`;
      const site = { id: `t_${type}`, name: def.label, type };
      const objects = [
        ...(def.objects || []).map((row) => ({ id: `${site.id}_${row.slug}`, name: row.label, slug: row.slug, room: row.room, portable: Boolean(row.portable) })),
        { id: `${site.id}_extra`, name: "包袱", portable: true },
      ];
      const args = { site, def, residentCount, objects, variant: interiorVariant(templateId), seed: 3 };
      const built = buildInterior(args);
      assert.equal(JSON.stringify(buildInterior(args)), JSON.stringify(built), `${label}: deterministic`);
      const { map, frontDoorTile, entryZoneId, mapId } = built;
      assert.equal(mapId, `interior:${site.id}`);
      assert.ok(map.grid.cols <= 24 && map.grid.rows <= 16, `${label}: fits 24×16 (${map.grid.cols}×${map.grid.rows})`);

      // Rooms are exactly what topology expands, inside the map, apart.
      const rooms = expandRooms(def, residentCount);
      const zoneOf = (suffix) => `${site.id}__${suffix}`;
      assert.deepEqual(Object.keys(map.zones).sort(), rooms.map((room) => zoneOf(room.suffix)).sort(), `${label}: rooms match topology`);
      assert.equal(entryZoneId, zoneOf(rooms.find((room) => room.entry).suffix));
      const rect = (zoneId) => map.zones[zoneId].rects[0];
      for (const zoneId of Object.keys(map.zones)) {
        const [c, r, w, h] = rect(zoneId);
        assert.ok(c >= 1 && r >= 1 && c + w <= map.grid.cols - 1 && r + h <= map.grid.rows - 1, `${label}: ${zoneId} is inside the walls`);
        assert.ok(map.zones[zoneId].label, `${label}: ${zoneId} has a label`);
      }
      const ids = Object.keys(map.zones);
      for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) assert.ok(!rectsOverlap(rect(ids[i]), rect(ids[j])), `${label}: ${ids[i]} and ${ids[j]} do not overlap`);

      // A door for every link, in the wall between the two rooms.
      const walkable = walkableTiles(map);
      for (const [a, b] of expandLinks(def, rooms)) {
        const door = map.doors.find((row) => row.between.includes(zoneOf(a)) && row.between.includes(zoneOf(b)));
        assert.ok(door, `${label}: a door between ${a} and ${b}`);
        const [tile] = door.tiles;
        assert.ok(walkable.has(tileKey(tile)) && near(tile, rect(zoneOf(a))) && near(tile, rect(zoneOf(b))), `${label}: the ${a}/${b} door joins both rooms`);
      }

      // The front door is on the bottom wall of the entry room and reaches every room.
      assert.equal(frontDoorTile[1], map.grid.rows - 1, `${label}: the front door is on the bottom wall`);
      assert.ok(near(frontDoorTile, rect(entryZoneId)) && walkable.has(tileKey(frontDoorTile)), `${label}: the front door opens into ${entryZoneId}`);
      assert.ok(map.doors.some((row) => row.front && tileKey(row.tiles[0]) === tileKey(frontDoorTile)), `${label}: the front door is drawn and marked`);

      // Objects sit in their rooms; fixed ones are drawn by their furniture.
      for (const object of objects) {
        const drawn = map.objects[object.id];
        assert.ok(drawn, `${label}: ${object.id} is placed`);
        const room = object.room ? rooms.find((row) => row.baseSuffix === object.room) : rooms.find((row) => row.entry);
        assert.equal(drawn.zoneId, zoneOf(room.suffix), `${label}: ${object.id} is in ${room.suffix}`);
        assert.ok(inRect([Math.floor(drawn.at[0]), Math.floor(drawn.at[1])], rect(drawn.zoneId)), `${label}: ${object.id} is inside its room`);
        if (object.slug && !object.portable) assert.equal(drawn.drawer, "fixture", `${label}: ${object.id} is drawn as furniture`);
      }

      // Six places to stand in every room, all reachable from the front door.
      const objectTiles = new Set(Object.values(map.objects).map((row) => tileKey([Math.floor(row.at[0]), Math.floor(row.at[1])])));
      const doorTiles = new Set(map.doors.flatMap((row) => row.tiles.map(tileKey)));
      for (const zoneId of ids) {
        const spots = map.spots[zoneId] || [];
        assert.ok(new Set(spots.map(tileKey)).size >= 6, `${label}: ${zoneId} has six spots (${spots.length})`);
        for (const spot of spots) {
          assert.ok(walkable.has(tileKey(spot)) && inRect(spot, rect(zoneId)) && !doorTiles.has(tileKey(spot)) && !objectTiles.has(tileKey(spot)), `${label}: ${zoneId} spot ${spot} is free floor`);
        }
        assert.ok(findPath(walkable, frontDoorTile, spots[0]), `${label}: the front door reaches ${zoneId}`);
      }
      assert.ok(rectTiles([0, 0, map.grid.cols, 1]).every((tile) => !walkable.has(tileKey(tile))), `${label}: the back wall is solid`);
    }
  }
}

console.log("Interiors passed: every type and household size fits, links are doors, front door on the bottom wall, objects in their rooms, six spots per room.");
```

- [ ] **Step 2：实现** `interiors.mjs`，导出：

```js
export function interiorVariant(templateId) // "*_b" → "mirror"，其余 → "plain"
export function buildInterior({ site, def, residentCount, objects, variant, seed })
// → { mapId: `interior:${site.id}`, entryZoneId, frontDoorTile: [x, y], map }
```

`map` 与 v1 布局同形，另带 `label: site.name` 和 `siteId`。`zones[zoneId] = { label: room.label, rects: [rect] }`。

**房间排布：用“房间树”。** 下面的函数逐字使用（已对目录里所有建筑类型、1–6 口人验证过：最大 18×15，不超过 24×16）。`variant === "mirror"` 时传 `{ mirror: true }`。

```js
const MIN_WIDTH = { bedroom: 3 };
const minWidth = (room) => (room.entry ? 8 : MIN_WIDTH[room.baseSuffix] || 4);

// Rooms as a tree hung from the entry room: each room's children sit in the
// row above it, inside its span, so every link is a door in the wall between.
export function layoutRoomTree(rooms, links, { mirror = false } = {}) {
  const entry = rooms.find((room) => room.entry) || rooms[0];
  const children = new Map(rooms.map((room) => [room.suffix, []]));
  const depth = new Map([[entry.suffix, 0]]);
  const queue = [entry.suffix];
  while (queue.length) {
    const cur = queue.shift();
    for (const [a, b] of links) {
      const next = a === cur ? b : b === cur ? a : null;
      if (next && !depth.has(next)) { depth.set(next, depth.get(cur) + 1); children.get(cur).push(next); queue.push(next); }
    }
  }
  for (const room of rooms) if (!depth.has(room.suffix)) { depth.set(room.suffix, 1); children.get(entry.suffix).push(room.suffix); }
  if (mirror) for (const list of children.values()) list.reverse();
  const bySuffix = new Map(rooms.map((room) => [room.suffix, room]));
  const width = new Map();
  const measure = (suffix) => {
    const kids = children.get(suffix);
    const kidsWidth = kids.reduce((sum, kid) => sum + measure(kid), 0) + Math.max(0, kids.length - 1);
    const w = Math.max(minWidth(bySuffix.get(suffix)), kidsWidth);
    width.set(suffix, w);
    return w;
  };
  const inner = measure(entry.suffix);
  const levels = Math.max(...depth.values());
  const upperH = levels <= 1 ? 4 : 3;
  const entryH = 4;
  const rows = 2 + levels * (upperH + 1) + entryH + 1;
  const cols = inner + 2;
  const rects = new Map();
  const place = (suffix, x, w) => {
    const d = depth.get(suffix);
    const y = d === 0 ? rows - 1 - entryH : 2 + (levels - d) * (upperH + 1);
    const h = d === 0 ? entryH : upperH;
    rects.set(suffix, [x, y, w, h]);
    let cx = x;
    const kids = children.get(suffix);
    kids.forEach((kid, i) => {
      // The last child takes whatever is left of the parent's span.
      const kw = i === kids.length - 1 ? x + w - cx : width.get(kid);
      place(kid, cx, kw);
      cx += kw + 1;
    });
  };
  place(entry.suffix, 1, inner);
  return { cols, rows, rects, depth, children, entry: entry.suffix, levels, upperH };
}
```

**在树的基础上：**
- **墙。**
  - 第 0–1 行是后墙：`{ rect: [0, 0, cols, 2], style: "interior-back", posts: [房间分隔线的 x…] }`。
  - 左右两侧 `style: "top"`，`edge` 分别为 `"r"` 和 `"l"`；最后一行底墙 `style: "top", edge: "t"`。
  - 同一行相邻房间之间是 1 列宽的 `partition`；上下两行房间之间是 1 行高的 `partition`。外墙以内所有不属于任何房间的格子，包括房间之间的缝和没有子房间的上方空位（比如药铺药房的上方），都用 `partition` 墙填满，不能露出背景。
- **门。**
  - 每条连通 `[a, b]`：在子房间正下方那一行隔墙上、子房间中线处开一个门：`{ between: [区a, 区b], tiles: [tile], style: "opening" }`。
  - 入口房间底墙的中点是前门：`{ between: [entryZoneId, null], tiles: [frontDoorTile], style: "door", front: true }`。
- **地面。** 灶间、炉间、仓房、磨房用 `earth`，其余用 `wood`。
- **固定物件画成家具，可拿的画成图标。** 目录里 `portable: false` 的物件按下表画成 prop，`layout.objects` 里的 `drawer` 写 `"fixture"`（P3.5 给 `objects.js` 加一个什么都不画的 `fixture` 画法，因为家具已经画出来了）。可拿的物件不写 `drawer`（走 `iconForObject` 的通用图标）。开场物件（没有 `slug`）放进入口房间。

```js
// Furniture for fixed catalog objects; the object is drawn by this prop.
const FIXTURE_PROPS = Object.freeze({
  stove: { kind: "stove", w: 2, h: 1, fire: true }, large_stove: { kind: "stove", w: 2, h: 1, fire: true }, furnace: { kind: "stove", w: 2, h: 1, fire: true },
  water_jar: { kind: "water-jar", w: 1, h: 1 }, counter: { kind: "counter", w: 2, h: 1 }, medicine_cabinet: { kind: "cabinet", w: 1, h: 1, label: "药柜" },
  bed: { kind: "sickbed", w: 1, h: 2 }, lectern: { kind: "desk", w: 1, h: 1 }, bookshelf: { kind: "shelf", w: 2, h: 1 }, goods_shelf: { kind: "shelf", w: 2, h: 1 },
  grain_bin: { kind: "wine-jars", w: 1, h: 1 }, millstone: { kind: "chopping-block", w: 1, h: 1 }, anvil: { kind: "chopping-block", w: 1, h: 1 },
  mail_box: { kind: "cabinet", w: 1, h: 1 }, incense_burner: { kind: "shrine", w: 2, h: 1 },
});
// A little furniture by room kind so rooms read at a glance (only where it fits).
const ROOM_FURNITURE = Object.freeze({
  hall: [{ kind: "table", w: 2, h: 1 }, { kind: "bench", w: 2, h: 1 }], main_hall: [{ kind: "rug", w: 2, h: 1, walk: true }],
  bedroom: [{ kind: "bed", w: 1, h: 2 }], room_1: [{ kind: "bed", w: 1, h: 2 }], ward: [{ kind: "stool", w: 1, h: 1 }],
  classroom: [{ kind: "desk", w: 1, h: 1 }, { kind: "desk", w: 1, h: 1 }], study: [{ kind: "desk", w: 1, h: 1 }],
  barn: [{ kind: "woodpile", w: 1.5, h: 1 }], storage: [{ kind: "wine-jars", w: 1, h: 1 }], side_room: [{ kind: "bench", w: 2, h: 1 }],
});
```

- **摆放与站位。**
  - 每个房间从靠后墙的那一行开始，自左向右放：先固定物件的家具，再房间家具，再可拿物件和开场物件的图标（1×1）。家具之间空 1 格，放不下的房间家具就省掉；固定物件的家具和物件本身必须放下。
  - 家具占的格子写进 `blocked`（`walk: true` 的地毯除外）。物件 `at` 取格子坐标加 0.2。
  - 站位：房间里可走、不是门、不在家具和物件上的格子，按行列排序后等间隔取 8 个。
  - 契约要求每个房间至少 6 个站位；3×3 的卧房只放床（不放书桌）就刚好够。
- **灯光。** 有灶的房间在灶上放一盏 `#ff8a30` 的闪烁灯，堂屋类房间放一盏 `#ffe0a8` 的灯。

- [ ] **Step 3：验证。** `interiors:test` 全绿。
- [ ] **Step 4：提交** `Build interiors as a tree of rooms`。

### Task P3.4：组装 layout v2，编译器切换

**Files:** Create `src/worlds/compiler/layoutV2.mjs`, `scripts/compiledTownMapContracts.mjs`; Modify `src/worlds/compiler/index.mjs`, `scripts/worldCompilerContracts.mjs`, `scripts/compiledLayoutShapeContracts.mjs`, `scripts/compiledPackShapeContracts.mjs`, `package.json`; Delete `src/worlds/compiler/simplePlanner.mjs`, `src/worlds/compiler/placeholderLayout.mjs`.

- [ ] **Step 1：写契约** `scripts/compiledTownMapContracts.mjs`，登记为 `"compiled-town-map:test"`。

```js
// A compiled town is one exterior map plus an interior per building, and it
// passes the same checks the observer and the runtime rely on.
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileBlueprint } from "../src/worlds/compiler/index.mjs";
import { validateWorldPack } from "../src/worlds/validateWorldPack.mjs";
import { runWorldSmoke } from "../src/worlds/worldSmoke.mjs";
import { worldPackDigest } from "../src/worlds/worldPack.mjs";
import { SITE_TYPES } from "../src/worlds/catalog/siteTypes.mjs";
import { flattenLayout, routeTiles } from "../src/worlds/layoutAtlas.mjs";
import { walkableTiles } from "../src/worlds/layoutGeometry.mjs";

for (const name of ["tiny_hamlet", "river_town", "forest_village"]) {
  const blueprint = JSON.parse(fs.readFileSync(`scripts/fixtures/blueprints/${name}.json`, "utf8"));
  for (const seed of [1, 7, 42]) {
    const label = `${name}#${seed}`;
    const { pack } = compileBlueprint(blueprint, { seed });
    assert.equal(worldPackDigest(compileBlueprint(blueprint, { seed }).pack), worldPackDigest(pack), `${label}: deterministic`);
    const { layout, stage } = pack;
    assert.equal(layout.layoutVersion, 2, `${label}: a town has a v2 layout`);
    assert.deepEqual(validateWorldPack(pack).issues, [], `${label}: V1–V13 are clean`);
    const smoke = await runWorldSmoke(pack, { stages: false });
    assert.deepEqual(smoke.issues, [], `${label}: deadlines reachable on time`);

    // One interior and one portal per building; the portal is the door edge of the topology.
    const buildings = blueprint.town.sites.filter((site) => SITE_TYPES[site.type].kind === "building");
    assert.equal(layout.portals.length, buildings.length);
    for (const site of buildings) {
      assert.ok(layout.maps[`interior:${site.id}`], `${label}: ${site.id} has an interior`);
      const portal = layout.portals.find((row) => row.siteId === site.id);
      assert.ok(stage.topology.edges.some((edge) => [edge.from, edge.to].includes(portal.interiorZoneId) && [edge.from, edge.to].includes(portal.exteriorZoneId)), `${label}: ${site.id}'s portal is a topology edge`);
    }

    // Map labels are the topology's labels; every zone is on its map.
    for (const [zoneId, zone] of Object.entries(stage.topology.zones)) {
      const map = layout.maps[layout.zoneMap[zoneId]];
      assert.equal(map.zones[zoneId].label, zone.label, `${label}: ${zoneId} is labelled as in the topology`);
    }

    // Every resident can walk from where they start to the plaza, through doors where needed.
    const atlas = flattenLayout(layout);
    const walkable = walkableTiles(atlas.layout);
    const plaza = atlas.layout.spots[stage.topology.defaultZoneId][0];
    for (const [characterId, zoneId] of Object.entries(stage.scenePositions)) {
      assert.ok(routeTiles(atlas, walkable, atlas.layout.spots[zoneId][0], plaza), `${label}: ${characterId} can walk from ${zoneId} to the plaza`);
    }

    // Every object that lies somewhere is drawn on the map of its zone.
    for (const object of pack.objects.filter((row) => !row.initialHolderActorId)) {
      const map = layout.maps[layout.zoneMap[object.zoneId]];
      assert.equal(map.objects?.[object.id]?.zoneId, object.zoneId, `${label}: ${object.id} is drawn in ${object.zoneId}`);
    }
  }
}

console.log("Compiled town maps passed: v2 layout, V1–V13 clean, smoke on time, one interior and portal per building, everyone can walk to the plaza.");
```

- [ ] **Step 2：实现 `buildLayoutV2({ blueprint, plan, topology, objects, catalog, seed, clockLabel })`。**
  - **外景。** 拷贝 `plan.map`，`zones[id].label` 一律取 `topology` 中该区的 label（拓扑才是区名的唯一来源）。
  - **每栋房子。**
    - 调 `buildInterior`：`residentCount` 为该户人数（与拓扑展开卧房时用的同一个数）；`variant` 由 `interiorVariant(def.interiorTemplates[rng 选一个])` 决定；`objects` 为 `zoneId` 在这栋房子里的全部物件。编译后的物件只有 `slug` 没有 `room`：目录物件的 `room` 按 `slug` 从 `def.objects` 里查，开场物件不带 `slug` 和 `room`，会放进入口房间。
    - 外景门的 `between[1]` 和室内前门的 `between[1]` 分别改成入口房间区和门前街段。
    - 生成 portal：`{ siteId, exteriorZoneId: plan.frontOf[siteId], exteriorDoorTile: lot.doorTile, interiorMapId, interiorZoneId: entryZoneId, interiorDoorTile: frontDoorTile }`。
  - **`zoneMap`。** 街段、广场、室外区指向 `exterior`，房间指向各自的室内图。
  - **室外物件**（井绳、放在林子里的开场物件等）画在所属区里一个不是站位、可走的格子上，`at` 加 0.2。这个格子从该区的站位中拿掉，但要保证剩下的不少于 6 个，不够就换一个不是站位的格子。
  - 返回 `{ layoutVersion: 2, clockLabel, maps, zoneMap, portals }`。
- [ ] **Step 3：编译器切换。**
  - `compileBlueprint` 默认 `planner = planTown`（来自 `townPlanner.mjs`），`layout = buildLayoutV2(...)`。
  - `clock` 加 `startClock: meta.startClock`。
  - 删掉 `simplePlanner.mjs`、`placeholderLayout.mjs` 及其 import。
- [ ] **Step 4：更新 P2 的契约**（只按下面列的改，不放宽其他断言）。
  - `worldCompilerContracts.mjs`：
    - `planTown` 改从 `townPlanner.mjs` 导入。
    - 写死的 `"street_1"` 改为 `plan.frontOf.li_home`（拓扑断言里的门边、脚本化第 1 拍的目的地都改）。
    - 第 2 拍改为一路走到 `herb_shop__front`：按 `findPath` 在拓扑上逐跳提交。
  - `compiledLayoutShapeContracts.mjs`：
    - 改为断言 `layout.layoutVersion === 2`。
    - 每张图都有 `grid`、`zones`、`floors`、`walls`、`doors`、`props`、`objects`、`lights`、`spots`、`blocked`、`ambient`。
    - 每张图的 `floors[].material` 都在 `FLOORS` 里；`grid` 是正整数，`tile` 为 16。
  - `compiledPackShapeContracts.mjs` 第 10 节：
    - “布局顶层键与借星一致”改成“外景图的键 ⊇ 借星 layout 的键（白名单同原来）”。
    - 删除“不许有 layoutVersion”那一条，换成“`layoutVersion === 2`，且有 `maps`、`zoneMap`、`portals`”。
- [ ] **Step 5：验证。**
  - `npm test -- --concurrency 6` 全绿。
  - `compiled-town-map:test`、`compiled-deadlines:test`、`compiled-prompt-clean:test` 必须在其中。
- [ ] **Step 6：提交** `Compile towns into an exterior map and interiors`。

### Task P3.5：观察台 · 图集与跨图走路

**Files:** Modify `src/stage/main.js`, `src/stage/director.js`, `src/stage/saves.js`, `src/stage/objects.js`, `src/stage/tiles.js`.

- [ ] **Step 1：`main.js`。**
  - `mount` 一开始做 `const atlas = flattenLayout(world.layout); const layout = atlas.layout;`，之后所有用到 `world.layout` 的地方（`buildScene`、`createLighting`、`createDirector`、`drawObjects`、`lighting.draw` 前找 `segments` 的那行）都改用 `layout`。
  - `createDirector` 多传一个 `atlas`。
- [ ] **Step 2：`director.js` 跨图走路。**
  - `createDirector({ world, initial, layout, scene, atlas })`。
  - `move` 帧：用 `routeTiles(atlas, scene.walkable, actor.tile, targetTile)` 取代 `bfs`。
  - 把结果变成 `actor.path = (route || [{ tile: targetTile, jump: true }]).map(({ tile, jump }) => ({ at: tileCenter(tile), jump: Boolean(jump) }))`。没有路就直接“跳”到目标，不再斜穿空白。
  - `update` 里：
    ```js
    const next = a.path[0];
    if (next.jump) {
      [a.x, a.y] = next.at;
      a.path.shift();
      for (const fn of jumpListeners) fn(a.id);
      continue;
    }
    ```
    其余照旧（`next.at` 代替原来的 `[tx, ty]`）。
  - 新增 `onJump(fn)`，返回取消函数。
  - 删掉 `bfs`。
- [ ] **Step 3：`objects.js`。** `DRAWERS` 加 `fixture() {}`，即什么都不画，家具 prop 已经画了它。
- [ ] **Step 4：`tiles.js` 画屋顶。**
  - `buildScene` 在画完 props 之后，对 `layout.roofs` 逐个画屋顶，画在 `bg` 上。
  - 屋顶盖住房子矩形，但不盖住门所在的那一行（或一列，看门在哪条边），那一行画成带门的墙面（用已有的 `WALLS.top` 和 `DOORS.door`）。
  - 屋顶本身用两三种深浅的瓦色横条加一条屋脊，像素风即可。
  - 再在屋顶上方写名字：返回值加一个 `roofLabels: [{ x, y, text }]`，由 `main.js` 交给标签层，以 `name` 样式显示。
- [ ] **Step 5：`saves.js` 缩略图。**
  - `thumbnail` 对 v2 世界先 `flattenLayout`，画布只取外景那一块（`maps.exterior.rect`）。
  - 人物只画站在外景区里的；屋里的人在其屋顶上画一个 3×3 的小点。
  - v1 世界的缩略图逐像素不变。
- [ ] **Step 6：验证。**
  - 浏览器：借星存档照常播放。
  - 用临时世界库编译 `river_town` 并 `world:new`，打开它的存档：整张图集都画出来了（此时还没有镜头，画布很大）。
  - 在浏览器控制台里给导演追加一帧进门的移动，验证跨图走路：人物应先走到门口，出现在室内门口，再走到站位。帧的格式与 `observerFeed` 一致，例如：
    ```js
    const d = window.__stage.director;
    d.appendFrames([{ seq: 1, type: "action", kind: "move", primitive: "move", status: "success", worldSeconds: 30,
      actorId: "char_river_town_song_ling", fromZone: "baicao_hall__front", toZone: "<门前街段 id>",
      changes: { entities: { char_river_town_song_ling: { zoneId: "<门前街段 id>" } }, objects: {} } }]);
    ```
    再追加一帧走回 `baicao_hall__front`，看她穿门回到室内。
- [ ] **Step 7：提交** `Draw town atlases and walk people through doors`。

### Task P3.6：镜头

**Files:** Create `src/stage/camera.js`; Modify `src/stage/main.js`, `stage.html`, `src/stage.css`.

- [ ] **Step 1：`camera.js`。**

```js
// Which part of the atlas the stage shows: one map at a time, scrolled and
// zoomed in whole steps, easing toward whoever the story is about.
const VIEWS = [[48, 27], [36, 20], [24, 14]]; // tiles visible at zoom 0, 1, 2

export function createCamera(atlas, { tile = 16, zoom: startZoom = 1 } = {}) {
  let mapId = "exterior", zoom = startZoom, x = 0, y = 0, tx = 0, ty = 0;
  const rectPx = (id) => atlas.maps[id].rect.map((v) => v * tile);
  function size() {
    const [, , mw, mh] = rectPx(mapId);
    const [vc, vr] = VIEWS[zoom];
    return [Math.min(mw, vc * tile), Math.min(mh, vr * tile)];
  }
  function clamp(px, py) {
    const [mx, my, mw, mh] = rectPx(mapId);
    const [w, h] = size();
    return [Math.min(Math.max(px, mx), mx + mw - w), Math.min(Math.max(py, my), my + mh - h)];
  }
  const api = {
    get mapId() { return mapId; },
    get x() { return Math.round(x); },
    get y() { return Math.round(y); },
    get zoom() { return zoom; },
    size,
    view() { const [w, h] = size(); return [Math.round(x), Math.round(y), w, h]; },
    show(id, focus) {
      if (!atlas.maps[id]) return false;
      const changed = id !== mapId;
      mapId = id;
      const [mx, my, mw, mh] = rectPx(id);
      api.lookAt(...(focus || [mx + mw / 2, my + mh / 2]), { snap: true });
      return changed;
    },
    lookAt(px, py, { snap = false } = {}) {
      const [w, h] = size();
      [tx, ty] = clamp(px - w / 2, py - h / 2);
      if (snap) { x = tx; y = ty; }
    },
    panBy(dx, dy) { [tx, ty] = clamp(x + dx, y + dy); x = tx; y = ty; },
    setZoom(level) {
      const next = Math.max(0, Math.min(VIEWS.length - 1, level));
      if (next === zoom) return false;
      const [w, h] = size();
      const cx = x + w / 2, cy = y + h / 2;
      zoom = next;
      api.lookAt(cx, cy, { snap: true });
      return true;
    },
    update(dt) {
      const k = Math.min(1, dt * 5);
      x += (tx - x) * k; y += (ty - y) * k;
      if (Math.abs(tx - x) < 0.5) x = tx;
      if (Math.abs(ty - y) < 0.5) y = ty;
    },
    toScene(clientX, clientY, element) {
      const box = element.getBoundingClientRect();
      const [w, h] = size();
      return [Math.round(x) + ((clientX - box.left) / box.width) * w, Math.round(y) + ((clientY - box.top) / box.height) * h];
    },
    contains(px, py, margin = 0) {
      const [w, h] = size();
      return px >= x - margin && px < x + w + margin && py >= y - margin && py < y + h + margin;
    },
  };
  api.show("exterior");
  return api;
}
```

- [ ] **Step 2：`main.js` 接镜头。**
  - **画布尺寸。** `stage.width/height` 取 `camera.size()`；切图或缩放后尺寸变了，就重设尺寸、`imageSmoothingEnabled = false`，再 `fit()`。`fit()` 和 `labelLayer.fit()` 用镜头宽度代替 `scene.width`。
  - **每帧绘制。**
    - 先 `camera.update(step)`。
    - `ctx.setTransform(1, 0, 0, 1, -camera.x, -camera.y)` 之后照原顺序画；画完 `ctx.setTransform(1, 0, 0, 1, 0, 0)`。
    - 标签只保留 `camera.contains(label.x, label.y, 16)` 的，坐标减去 `camera.x/y` 再交给标签层；`avoid` 同理。
  - **点击。** `camera.toScene(...)` 换算成图集坐标，先查人物；在外景上点到屋顶矩形，就 `camera.show(\`interior:${siteId}\`)`。
  - **拖动与缩放。**
    - `pointerdown`/`pointermove`/`pointerup` 拖动画布：移动超过 4 个屏幕像素才算拖动，换算成场景像素后 `camera.panBy`。一旦拖动就关掉“跟随”。
    - `wheel` 每次 ±1 档，调用 `camera.setZoom`，并 `preventDefault`。
  - **跟随。**
    - `director.onChange(({ frame }) => …)`：有 `actorId` 的帧，若该人所在的图和镜头不同且“跟进屋”开着，就 `camera.show(该图, [a.x, a.y])`，否则 `camera.lookAt(a.x, a.y)`。
    - 动画进行中，每帧对当前帧的人物 `camera.lookAt`。
    - `director.onJump(id)`：若是正在跟随的人，切到他所在的图。
    - 人所在的图用 `mapAtTile(atlas, actor.tile)` 算。
  - **地图栏。** 在 `stage.html` 的画布上方加一行 `#mapBar`：
    - “外景”按钮（回到 `exterior`）；
    - 当前室内名（`atlas.maps[mapId].label`）；
    - “出门”按钮（在室内时显示）；
    - 一个“跟进屋”复选框，默认勾选，记进 `localStorage`，读写放在 try/catch 里。
  - **v1 世界。** 镜头的视野大于整张图时，`size()` 就是整张图，画面与以前完全一样。
- [ ] **Step 3：验证。**
  - 借星：画面、标签、点击选人与改动前一致，截图对比。
  - 河镇：能拖动、能缩放三档；“跟随”跟着说话的人走；有人进屋时镜头切进室内，下一件事在外面时切回外景；点屋顶能进屋，“出门”能回到外景。
- [ ] **Step 4：提交** `Add a camera that follows the story across the town`。

### Task P3.7：小地图与屋顶提示

**Files:** Create `src/stage/minimap.js`; Modify `src/stage/main.js`, `src/stage/ui.js`, `src/server/observer/runsApi.mjs`, `stage.html`, `src/stage.css`.

- [ ] **Step 1：`createMinimap(canvas, { atlas, scene, members })`**，返回 `{ draw({ actors, camera, speakerId, t }), onClick(handler) }`。
  - 外景的 `scene.bg` 按整数倍缩小（最近邻），画进 160 像素宽的小画布。屋顶画成深色块。
  - 站在外景上的人画成 2×2 的点，颜色取 `appearance.robe`；说话的人每 0.25 秒闪一次。
  - 在屋里的人不画点，改在其屋顶块上画一个数字（人数）。
  - 镜头在外景时，用 1 像素金色框画出视野。
  - 点击：在屋顶块里就 `handler({ enter: siteId })`，否则 `handler({ look: [px, py] })`（图集像素坐标）。
  - 只有 v2 世界显示小地图；v1 世界隐藏，并且不占位置。
- [ ] **Step 2：屋顶说话提示。** 镜头在外景、而当前说话的人在某栋房子里时，在那栋房子的屋顶上方画一个闪动的小对话框图标（像素画，13×9）。
- [ ] **Step 3：右侧人物名单按户分组**（规格 §8.4）。
  - `runsApi.mjs` 的 `worldVisual` 加 `households`：对 `pack.social.boundaries` 的每一条，`label` 取同一 `evidenceIds[0]` 对应 fact 的 `claimantId` 去掉 `household:` 前缀，`members` 取 `exemptActorIds`。没有 `social` 的旧世界给空数组。
  - `ui.js`：`world.households` 非空时，名单按户分组显示，每组一行小标题（户名）加头像格。不属于任何户的人归入“其他”。整块超过 10 人时可滚动（`max-height` 加 `overflow-y: auto`）。
  - `households` 为空时，名单与原来逐像素一致。
- [ ] **Step 4：验证。** 河镇：小地图上的点随人移动，屋里有人时屋顶显示人数，点小地图能跳转和进屋，屋里有人说话时外景屋顶闪对话框。
- [ ] **Step 5：提交** `Add a town minimap and indoor speech hints`。

### Task P3.8：昼夜

**Files:** Create `src/stage/daylight.js`, `scripts/daylightContracts.mjs`; Modify `src/stage/lighting.js`, `src/stage/main.js`, `package.json`.

- [ ] **Step 1：写契约** `scripts/daylightContracts.mjs`（`daylight.js` 是纯函数，可以在 node 里 import），登记为 `"daylight:test"`：

```js
import assert from "node:assert/strict";
import { daylightAt, clockSeconds } from "../src/stage/daylight.js";

assert.equal(clockSeconds("07:30"), 27000);
assert.equal(clockSeconds(""), null);
const alpha = (seconds) => daylightAt(seconds).shade[3];
assert.equal(alpha(12 * 3600), 0, "noon is not shaded");
assert.ok(alpha(0) >= 0.4 && alpha(23 * 3600) >= 0.4, "night is dark");
assert.ok(alpha(6 * 3600) > 0 && alpha(6 * 3600) < alpha(0), "dawn is in between");
assert.equal(daylightAt(12 * 3600).lamps, 0);
assert.equal(daylightAt(0).lamps, 1);
for (let s = 0; s < 86400; s += 600) {
  assert.ok(Math.abs(alpha(s) - alpha((s + 600) % 86400)) <= 0.1, `no jump at ${s}`);
}
assert.deepEqual(daylightAt(86400 + 3600), daylightAt(3600), "wraps around midnight");
console.log("Daylight passed.");
```

- [ ] **Step 2：实现 `daylight.js`。**
  - 导出 `clockSeconds("HH:MM")`：返回秒数，空串或格式不对时返回 `null`。
  - 导出 `daylightAt(seconds)`：返回 `{ shade: [r, g, b, a], lamps: 0..1 }`。
  - 关键点线性插值：0:00 `[14,20,52,.5]`/1，5:00 同 0:00，6:30 `[60,40,80,.22]`/.5，8:00 `[0,0,0,0]`/0，17:00 `[0,0,0,0]`/0，18:30 `[90,40,30,.25]`/.6，20:00 `[14,20,52,.5]`/1，24:00 同 0:00。
- [ ] **Step 3：`lighting.js`。**
  - `draw(c, t, { litSegments, view, daylight })`：
    - 有 `view` 时，暗层、遮罩的运算只在视野矩形内进行。用一张视野大小的暗层画布，按偏移取遮罩，否则全镇图集每帧要处理几百万像素。
    - `layout.dayCycle` 为真时，室外暗度用 `daylight.shade`，灯光的透明度乘以 `daylight.lamps`；室内暗度固定为 `rgba(30,22,46,.25)`。
    - v1 布局不传 `daylight`，行为与原来一致。
  - `main.js` 计算 `(clockSeconds(world.startClock) + director.clockSeconds) % 86400` 再取 `daylightAt`。
  - `world.startClock` 为空时（旧世界）不传 `daylight`。
- [ ] **Step 4：性能。**
  - `main.js` 每帧记录间隔，`window.__stage.fps` 给出最近 60 帧的平均帧率。
  - 验收：河镇在镜头跟随播放时不低于 30 fps，Gemini 在进度文档里写明实测值和机器。
- [ ] **Step 5：验证并提交** `Shade the town by the hour`。

### P3 阶段收尾

- [ ] `npm run check`、`npm test -- --concurrency 6` 全绿，总数比 P3 开始时正好多 5 条：`layout-v2`、`town-planner`、`interiors`、`compiled-town-map`、`daylight`。P2 的 `compiled-layout-shape` 只是改写，不增加条数。总数不对就查清楚原因，写进进度文档。
- [ ] **浏览器走查（必须做，截图保存到 `docs/screenshots/p3/`，进度文档里列出文件名）：**
  1. 借星存档：与 P3 之前的画面一致，存档界面正常。
  2. 河镇整镇（缩放到最小一档）。
  3. 河镇的一栋室内。
  4. 小地图。
  5. 黄昏或夜里的外景。
  6. 一段“走进屋—屋里说话—走出来”的跟随过程（连续 3 张）。
  7. 雾松岭任意一张，种子用 7。

  用临时 `CHARACTER_TOWN_HOME`，在 8798 端口验证，走查完删掉临时存档。
- [ ] 写 `docs/52_new_world_progress.md` 的 P3 一节：做了什么、怎么验证的、实测帧率、遗留问题。停下等 Claude 审核。

---

# P4 · 小镇运行时（范围与验收）

### Task P4.1：感知距离
- `observableCharacters` 与声音路由读取 `place.perceptionEnvironment.maxVisualDistance / maxSoundDistance`（经世界状态从世界包带入）；缺省不截断。
- 契约：jiexing/xiaoyaoyou 金样不变；`river_town` 里街东头的人拿东西，街西头的人收不到视觉证据。

### Task P4.2：写日程拍子 `characterScheduleTurn.mjs`
- 新阶段 `awaiting_day_schedule`（演绎式一次调用）：提示词含作息习惯、心事、关系里的今日要事、可去的地点（site 名）；输出 `{ blocks: [{ from, to, siteId, activity: "work:<templateKey>" | "rest" | "sleep" | "wander" | "visit:<personKey>", note }] }`；校验后写入 `lifePlanState.steps`（现有结构，新增 `autopilot: true`、`siteZoneId`、`activity`）。
- 小镇世界在开场与每天 05:00 给每人一个 `day_schedule_due` 唤醒。

### Task P4.3：照办日程
- `characterWorldRuntime`：日程步到点时，若此人 mailbox 无新证据、无临近时限、不在等待中 → 由世界按其日程生成**本人的**尝试（`authorship: { kind: "own_plan_step", planStepId, authoredInTurnId }`）：不在目标区则沿路线移动一段（每段一次结算），到达后按 activity 开工/歇着/睡（睡 = 等到下一段日程或被吵醒）。有任何新证据送达 → 立即交还完整拍子。
- `simulationIntegrity` 接受 `own_plan_step` 来源；观察台日志标“按自己的日程”；报告单列这类回合数。
- 契约：20 人夹具（由 P2 夹具扩写或新建 `big_town.json`）零模型、脚本化人物模拟 1 天：模型调用次数 ≤ 居民数 × 1（日程）+ 实际对话拍子；有人对正在照日程走路的人说话时，下一拍由模型决定；旧世界不受影响。

### Task P4.4：小镇规则与调用模式
- `validateWorldPack` 在 `scale === "town"` 时增加 V10（作息/日程地点存在且可达）、V11（每个活计的工具在开场时有人能拿到或就在活计所在建筑）、V12（`maxVisualDistance` 已设置）。
- 小镇世界只用演绎模式：`runV27GeminiSimulation.mjs` 与 `runsApi` 遇到 `meta.scale === "town"` 时忽略/拒绝 `three-call`（返回中文说明）。
- 契约：三份夹具全过 V10–V12；对小镇世界请求 `callMode: "three-call"` → 400 `CALL_MODE_UNSUPPORTED`。

### Task P4.5：提示词分层
- 演绎提示词的“走到别处”只列当前建筑的房间 + 他知道的 site（显示 site 名，target 填 site key），远处由世界逐段结算；“此刻”只列同区与相邻区。
- 契约：20 人小镇的提示词 ≤ 8000 字；能去的地点列表 ≤ 20 项。

---

# P5 · 快速模式生成（范围与验收）

- `src/worlds/generation/`：`generateBlueprint({ idea, sourceText, sizeHint }, { callModel, onProgress })` 分 5 段调用：世界与小镇（world + sites + households）→ 居民（每次 ≤ 4 人，带已生成的世界与户别）→ 关系 → 开场（时限、物件、悬念、事件、来客）→ 修整（只修 `validateBlueprint` 报出的问题，最多 2 轮）。每段用 `SECTION_SCHEMAS` 结构化输出，校验失败带问题清单重问同一段（最多 2 次），仍失败则停下并把已得部分交给审改页。
- `rewriteSection(blueprint, sectionPath, instruction, { callModel })`：只改指定段（一个人、一条关系、开场），其余逐字不变。
- 上传：`.txt`、`.md`，≤ 200KB；在服务端截断到 30k 字作为参考资料。
- 接口：`POST /api/create/generate`（同源 JSON，需授权勾选与请求上限，SSE 推进度）、`POST /api/create/rewrite`。
- 契约：假模型返回固定段落 → 得到通过校验的蓝图；第一段返回非法 JSON → 修复回路生效；`rewriteSection` 前后其他段 JSON 相同；请求数不超过授权上限；任何响应与日志不含密钥。

---

# P6 · 开始界面与创建向导（范围与验收）

- 新页面 `play.html` + `src/play/`（加入静态资源模块图），像素风，复用 `pixel.js / sprites.js / labels.js` 与点阵字体。
- 标题画面：动态像素小镇背景（用一份内置示例蓝图编译出的外景图，镜头缓慢平移）、标题字、菜单「新的世界 / 读取存档 / 世界库 / 设置」。
- 新的世界 → 选模式。**快速模式**：大文本框（一句话或粘贴）+ 上传 + 规模选择（小 6 人 / 中 12 人 / 大 20 人）+ 预计调用次数 + 授权勾选 → 生成进度（分段）→ 审改页。**捏世界模式**：类型（古风/现代/奇幻/自定义）→ 小镇（名字、地形方位、建筑清单增删，按目录选类型）→ 住户与居民 → **捏人页**（左侧 4 向像素预览实时刷新；发色/肤色/衣服/腰带调色板、styles 开关、年龄（<14 自动矮一号）、8 条性格滑条（两端写中文含义，如“话少 ↔ 外向”）、技能芯片、说话方式与示例台词、心事、心愿、作息时间轴、记忆；按钮「让模型补全这个人」）→ 关系（人物两两卡片，预设标签 + 情感滑条）→ 开场（局势、时限构建器、物件、悬念、定时事件）。
- 花费估算（规格 §12）：`src/play/costEstimate.js` 纯函数，输入居民数、计划游戏时长、最近运行的平均每次调用 token（`/api/saves` 补充该统计；没有历史时用 4k 输入 / 300 输出），输出“约 N 次调用、约 M 万 token”；单测覆盖。
- 审改页（两模式汇合）：五个标签页；每页「让模型重写本页」；底部常驻「编译并检查」→ 问题清单（点击跳到字段）→ 地图预览（外景 + 点建筑看室内、重掷种子）→ 花费估算 →「开始」（存入世界库、建 0 回合存档、打开观察台并提示授权运行）。
- 世界事件面板（观察台底部）：天气 / 来客 / 东西出现 / 消息 / 小意外；立即或定时；`src/server/simulation/worldEvents.mjs` 把事件变成世界结算（`world_event`，来源 `player`），送达能感知到的人；观察台标“天意”。
- 契约：向导纯函数（蓝图增删改、滑条 ↔ personality 数值、调色板 ↔ appearance）单测；世界事件结算单测（下雨后室外人物收到天气证据、室内不收；来客出现在出镇路口并成为可被唤醒的人物）。
- 验收：Claude 浏览器走查两种模式各一遍，从零到观察台开始播放（模型用假网关或用户授权的真实调用）。

---

# P7 · 分发（范围与验收）

- `start.command`（macOS，`chmod +x`）与 `start.bat`：检查 `node -v` ≥ 24（否则打开 nodejs.org 并退出）、`npm start`、2 秒后打开 `http://127.0.0.1:8787/play.html`。
- 运行存档迁到 `<dataHome>/runs`（旧 `sim-runs/` 只读并入存档列表）。
- `README.md` 顶部“三步开始玩”：安装 Node → 双击 start → 在设置里填 API。
- 首次启动引导：未配置 API 时标题画面先弹设置。
- 验收：在一个全新用户目录（`CHARACTER_TOWN_HOME` 指向空目录）按 README 走通。

---

## 审核清单（Claude 每阶段使用）

1. 契约是否真的测到了规格要求（不是只测“函数存在”）；夹具是否被测试“迁就”。
2. 旧世界金样、`characterPerformanceTurn`、`observerRunsApi` 等关键契约是否全绿。
3. 密钥：grep 新代码里的日志、响应、存档写入点。
4. 人物自主：有没有任何路径在没有 `own_plan_step` 来源的情况下替人物生成动作或台词。
5. 浏览器走查（8797 端口），截图对照规格。
6. 进度文档是否如实（失败与遗留问题写清楚）。
