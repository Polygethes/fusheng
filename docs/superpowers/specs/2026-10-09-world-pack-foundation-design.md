# 世界包基座、借星新世界与像素观察台 · 设计规格

日期：2026-10-09。状态：设计已获用户确认（对话中逐项选择 + 像素原型认可），按本规格实施。

## 1. 目标

1. 把《逍遥游·望梯酒馆》跑出来的经验落成**与世界无关的基座**：运行时从“世界包”读取世界，而不是从酒馆常量读取。
2. 用户给出的**信标**（自然语言/原作材料）由 Claude 展开成世界包；基座的验证器按逍遥游经验逐项把关，零模型调用的冒烟测试证明世界能被真实结算。
3. 提供一个**像素游戏质感的网页观察台**：像素场地、人物精灵、对白气泡、JRPG 对话框；可观看实时运行、回放历史运行、并在授权后启停真实模型模拟。
4. 第一个新世界：**借星**（信标：`借星_世界观设定集_v0.4.docx`、`借星_第一集_v1.2.docx`）。

## 2. 已确认的决策

| 问题 | 决定 |
|---|---|
| 信标形态 | 自然语言/原作材料，由 Claude 展开成世界包，验证器把关，用户审阅后开跑 |
| 观察页控制权 | 观看 + 启停模拟（勾选授权、回合与请求上限）；可回放历史运行；不做操盘干预 |
| 美术来源 | 程序生成为主（精灵、瓦片、道具），世界包可选挂素材覆盖 |
| 视觉方向 | 原型 `.superpowers/pixel-stage/index.html`：16px 瓦片、3/4 俯视、手绘模板精灵、分级光照、像素字体（精品点阵体 9×9，OFL，随项目分发） |
| 基座做法 | 方案一：世界包 + 适配层。保留 v2.7 运行时，常量改为世界包查表；逍遥游抽取为第一个世界包，用金样测试证明等价 |

## 3. 架构总览

```text
信标(docx/文本) ──Claude 展开──▶ worlds/<id>/pack.mjs ──world:validate──▶ 通过/逐项报错
                                              │
                                              ├─ world:smoke（零模型调用，真实结算证明可完成）
                                              ▼
                          buildWorldStateFromPack(pack) ──▶ createWorldRuntimeV27(pack, …)
                                              │                       │
                    world:new → 0 回合存档 ◀──┘                       │（原 tavernWorldRuntimeV27，常量改为查表）
                                              ▼                       ▼
                      gemini:simulate --world/--resume ──写──▶ sim-runs/<run>/world-save.json
                                                                      │
                      server.mjs /api/runs/* ──读/SSE──▶ observerFeed(worldSave, pack) ──▶ /stage.html（像素观察台）
```

运行时、人物协议、世界结算、提交接口、完整性保护全部沿用；改动集中在“世界从哪里来”和“观察页怎么看”。

## 4. 世界包（World Pack）

位置：`worlds/<worldId>/`

- `beacon/`：信标原文（文本抽取件，原 docx 不入库）。
- `pack.mjs`：纯数据，`export default deepFreeze({...})`。
- `README.md`：该世界的选场理由、暂定设定、受保护场景与悬念清单。

### 4.1 字段

| 段 | 内容 | 消费方 |
|---|---|---|
| `meta` | id、标题、来源、版本、语言、`provisional`（世界包自行补的暂定设定清单） | 报告、观察页 |
| `stage` | 主地点 `placeId/name`；`topology`（zones、edges：move/sound/visual/conversation/barrier、defaultZoneId）；`offstagePlaces` | 世界状态、感知、寻路 |
| `clock` | 开场时刻标签（如“卯时三刻”）、场景时间政策（pacingMode、等待跳过） | HUD、时间 |
| `cast` | 每人：`id/name/title`、`appearance`（精灵生成用：发型、发色、衣色、配饰）、`skills`、`ecologyProfile`（复用现有 schema 与 `validateEcologyProfile`）、`agentMemory` 初始记忆、`startZoneId`、`active`（是否本场全分辨率） | 运行时、精灵 |
| `relationships` | 关系种子（from/to/label/pressure/metrics 初值） | 关系上下文 |
| `relationshipMetrics` | 关系维度 id 列表（替代 `TAVERN_RELATIONSHIP_METRICS`） | 私有状态归约 |
| `objects` | 物件模板：id、label、zoneId、holder、`state`（数值/布尔）、portable、presentation（含隐藏/仅持有人知） | 世界结算 |
| `positions` | 可占用位置（座位、榻） | 世界结算 |
| `work` | 工作模板（沿用现有 workOrderTemplates 格式）+ 新增 `requiredSkillIds` | 工作结算 |
| `social` | 社会事实、社会边界（区域、豁免者、主张者） | 社会许可 |
| `agenda` | 时限：label、dueAtSeconds、warningAtSeconds、`conditions`（见 4.2）、`responsibleActorIds`、新增 `knownByActorIds`、delayConsequence | 时间与截止 |
| `mysteries` | 保留悬念 id 与说明；人物信念只能以 unknown/suspected 引用 | 验证器、提示 |
| `report` | 报告要汇总的客观指标（objectId+stateKey+label+单位） | 结算报告、HUD |
| `layout` | 像素布局：网格尺寸、每个 zone 的矩形、门洞、地面材质、静态道具摆放、光源、物件绘制方式、调色板主题；可选 `assets` 覆盖 | 观察页 |

### 4.2 运行时需要的通用扩展（从借星需求倒推，均与具体世界无关）

1. **时限条件种类**：现仅支持 `objectId.stateKey ≥ minimum`。新增 `{kind:"object_holder", objectId, holderId}`、`{kind:"actor_zone", actorId, zoneId}`；无 kind 时按原数值条件处理，旧存档不变。
2. **时限知情范围**：新增 `knownByActorIds`。设置后只有这些人物在投影中看到该时限、收到警告/到期投递；未设置保持原行为（地点内所有人可见）。经验依据：私人安排不是全场公告。
3. **工作能力边界**：工作模板可声明 `requiredSkillIds`；人物缺少技能时结算为失败 `WORK_SKILL_MISSING`，不替人物换动作。经验依据：能力边界由世界结算，不由剧情决定（借星：父母不是剑修，小满不会修阵）。
4. **查表替代常量**：`LOCATION_ID`、`TAVERN_SCENE_TOPOLOGY`、`socialBoundaries()`、`objectiveSocialFacts()`、`tavernOpeningAgenda()`、`TAVERN_SCENE_CHARACTER_IDS/POSITIONS`、`TAVERN_RELATIONSHIP_METRICS`、报告中的柴/水/药包，全部改为从世界包读取。逍遥游世界包提供与现值相同的数据。

### 4.3 逍遥游抽取

`worlds/xiaoyaoyou/pack.mjs` 由现有常量组装（引用而非复制大段数据，避免双份真相）。金样测试：`buildWorldStateFromPack(xiaoyaoyou)` 与改造前 `buildTavernWorldStateV27(...)` 的输出逐字段相等；现有 559 项契约保持全绿。

## 5. 经验基座

### 5.1 经验文档

`docs/51_world_foundation_lessons.md`：把 docs 38–50 与运行 PLAYBOOK 的教训写成与世界无关的规则。每条规则包含：发生了什么（证据文档）→ 规则 → 执行它的代码 → 对新世界生效的验证项。

### 5.2 `npm run world:validate -- <id>`

| 检查 | 对应教训 |
|---|---|
| V1 拓扑连通；默认区存在；封闭区有屏障；说话/声音路由可解析 | 倾听越距、谁能听见 |
| V2 每个时限的条件都能通过某个工作模板/物件操作由“知情且负责”的人物达成（含技能与工具可得性） | 柴水从未完成：说了不等于做了 |
| V3 物件操作引用的状态键存在；可拔可收的物件有 `sheathed`；工具在场或可取得 | 拔剑成功但状态不变 |
| V4 每个人物 ecologyProfile 通过 `validateEcologyProfile`；至少一个欲望落地到开场可感知的人或物 | 欲望悬空导致等待均衡 |
| V5 至少一项跨人物事务（两人以上的交接、请求或时限） | 41–50、100 回合“稳住继续等” |
| V6 活跃人物 ≤5；关系种子引用存在的人物 | 场景时间修复的参与者上限 |
| V7 人物初始信念对 `mysteries` 只能是 unknown/suspected | 借星编写警戒：悬念不得写成已确认真相 |
| V8 报告指标、HUD 指标引用真实物件与状态键 | 报告失真 |
| V9 布局覆盖每个 zone、每条边有门洞、物件落在所属 zone 矩形内 | 观察页如实呈现 |

### 5.3 `npm run world:smoke -- <id>`

零模型调用：构建世界 → 为每个人物准备首个阶段（证明提示与 schema 可生成）→ 用确定性“验证驾驶员”通过**真实世界结算**依次执行每个工作模板与时限所需操作（移动、取物、做工、交接），断言时限可被满足、资源真实变化。驾驶员只用于证明可达性，结果不写入任何模拟存档，也不能作为人物行为证据。

## 6. 借星世界包

### 6.1 选场

**藏星谷 · 顾家，十二岁离家那天的清晨**（第一集场景九至十一之间）。理由：家庭内部压力最密集（修阵失败、父亲灼伤、病中小女孩、被续用的接引符、母亲要送行、阿宝送别）；结构接近已被长测锤炼过的“家计 + 劳作 + 时限”形态，风险最低；受保护场景“主动求学”由人物自己决定，世界不替他决定。

备选（不做）：青岚渡接引舟（需大量新增陌生人物，且高潮是人物无法左右的袭击）；八岁夜游（独角戏，缺少互动）。

### 6.2 开场事实（世界层）

- 地点 `loc_jx_gu_home`“藏星谷 · 顾家”，区：小满房间、堂屋、药房、灶间、院子、篱笆外村道、石桥村口、谷口阵眼（远，声视不达）。
- 人物（5 名活跃）：顾小满（12）、顾怀山、陆青禾、阿宝、何嫂（暂定：病中小女孩“丫丫”的母亲；信标只写“被大人牵着的小女孩”，名字与身份为世界包补设，列入 `meta.provisional`）。
- 物件：旧剑（小满持，`sheathed`）、接引符（顾怀山袖中，隐藏，`sectSealRenewed: true`）、裂开的阵盘、阵旗、刻刀、药箱、药布、丫丫（药榻上昏睡，作为不可行动的病患对象，`blackMarks`）、包袱（`packedItems`）、新外衣、丹瓶匣、红纸鸢（墙上）、粥锅、水壶、干粮、北侧阵纹（`litSegments`）。
- 工作：修补北侧阵纹（阵眼，需 `array_craft`）、给丫丫换药（药房，需 `medicine`）、收拾行囊（小满房间）、熬粥（灶间）。
- 时限：
  - “辰时前从石桥出发去归云岭”：条件 = 小满在石桥 + 小满持接引符 + 陆青禾在石桥；`knownByActorIds` = 顾怀山、陆青禾；误时后果：赶不上青岚渡午时接引舟，须再传讯另约。小满开场不知道这件事。
  - “丫丫的药一刻钟后要换”：条件 = 丫丫 `blackMarks` 降到阈值；知情者：陆青禾、何嫂。
- 技能：小满 `sword_affinity`、`flight`；顾怀山 `array_craft`；陆青禾 `medicine`、`alchemy`。父母都没有剑术技能（信标“已确立”）。
- 悬念（V7）：失星真相、梦的性质、旧剑来历、父母当年所知、山谷暴露是否被察觉。人物初始信念只能是 unknown/suspected。

### 6.3 人物底座要点（ecologyProfile 摘要，完整数据写入世界包）

- **顾小满**：欲望＝学会真正收得住的剑、补上家里不亮的阵、让爹的手不再因自己受伤；敏感＝被当成闯祸的小孩、听见“送出去”；边界＝不愿被强迫离家；原则＝答应的事要做到。
- **顾怀山**：欲望＝谷口阵纹重新亮起、孩子学到自己教不了的剑；义务＝守谷口；敏感＝孩子碰阵盘；习惯＝嘴上数落、手上不停。
- **陆青禾**：欲望＝丫丫的黑纹退下去、亲眼送小满到归云岭；义务＝救治病人；原则＝务实，先办能办的。
- **阿宝**：欲望＝在小满走之前见他一面、拿到那只纸鸢（若对方给）；敏感＝白鹅、被落下。
- **何嫂（暂定）**：欲望＝女儿醒来、弄清昨夜阵眼为何崩开；敏感＝有人瞒她；边界＝不在病榻边吵。

## 7. 运行入口

- `npm run world:new -- <id> --out <新目录>`：从世界包建 0 回合存档（含 provenance）。
- `npm run gemini:simulate -- --world <id> --out …` 或 `--resume <存档>`；存档记录 `worldPackId` 与 `worldPackDigest`，续跑时校验一致。移除硬编码的逍遥游种子。
- 中继 `relay:start` 同样接受 `--world`。
- 结算报告的客观状态段落由 `pack.report` 生成。

## 8. 像素观察台

### 8.1 服务端（server.mjs 新路由，仅本机）

- `GET /api/runs`：列出 `sim-runs/*` 中含 `world-save.json` 的运行（世界、回合数、状态、来源、更新时间）。
- `GET /api/runs/:id/feed?after=<seq>`：返回观察帧（见 8.2）与世界包布局。
- `GET /api/runs/:id/stream`：SSE，监视存档变化推送新帧。
- `POST /api/runs/start`：参数 world、turns、maxRequests、model、responseFormat，必须带 `authorized:true`；服务端从自身环境读取 `GEMINI_API_KEY`，从不返回或记录密钥；以子进程启动 `runV27GeminiSimulation`，输出到新目录。
- `POST /api/runs/:id/stop`：发送停止信号；运行器在当前回合结算后停止（新增 SIGTERM 优雅停止）。
- 路由只接受 `sim-runs` 下的运行 id（白名单字符集），不暴露任意路径。

### 8.2 观察帧推导 `observerFeed(worldSave, pack)`（纯函数）

从 `checkpoint.coordinator.journal.events` 与 `settledTurns` 推导有序帧：`{seq, worldSeconds, actorId, kind: move|speak|handle|transfer|work|observe|listen|rest|gesture|fail|deadline, fromZone, toZone, utterance, audience, perceivedBy, objectChanges, status, failureCodes, intention(私人)}`。公开层只来自已结算事实（说出的话、谁实际收到、物件真实变化、失败码）；意图只出现在人物面板并标注“私人·未发生”。同时输出每帧后的物件快照，供场景道具与 HUD 指标显示。

### 8.3 前端 `/stage.html`

- 原型代码模块化：`stage/tiles.js`（材质与道具绘制）、`stage/sprites.js`（模板精灵、外观上色、配饰）、`stage/scene.js`（布局→静态层、光照、环境粒子）、`stage/director.js`（帧→动画：寻路行走、气泡、物件飞行、做工、视线、失败）、`stage/ui.js`（对话框、时间轴、名册、检视、日志、启停面板）。
- 布局完全来自 `pack.layout`；人物外观来自 `cast[].appearance`；道具绘制按物件 `kind` 选择通用绘制器（容器、工具、文书、包裹、植物、灶、桌椅、阵旗……），世界包可覆盖。
- 启停面板：选世界包、回合数、请求上限、模型、勾选“我授权本次真实模型调用”后才启用开始按钮；显示运行中的请求数与费用无关的计数；停止按钮。
- 来源徽标如实显示：真实 API / 外部中继未验证 / 回放。

## 9. 验证

- 金样等价：逍遥游世界包构建结果 = 改造前常量构建结果。
- 全量契约 559/559 + 新增契约全绿。
- 验证器：每个检查至少一个应失败的夹具。
- 冒烟：借星、逍遥游两个世界 `world:smoke` 通过。
- 观察帧：用 2026-09-21 的真实存档推导帧，断言位置与日志一致、对白只来自 `speech_emitted`、失败码保留。
- API：未授权启动被拒；响应与日志不含密钥；路径穿越被拒。
- 浏览器：观察页回放 9-21 运行与借星 dry-run 的截图验收。
- 真实模型首跑由用户在观察页授权启动。

## 10. 不做

- 操盘干预（投放外部事件）。
- 主界面与旧场景流水线的通用化。
- AI 生成美术（保留覆盖接口）。
- 多地点长途旅行动画（场外地点只作为出口显示）。

## 11. 风险与对策

| 风险 | 对策 |
|---|---|
| 运行时其他模块仍隐含酒馆假设（服务、客位、价目、生理、经济） | 抽取时以“缺省为空”处理；借星冒烟测试会暴露残留假设，逐个改为查表或可选 |
| 借星人物底座质量决定模拟质量 | 复用现有 profile 验证器；欲望必须落地到开场可感知对象；用户审阅世界包 README |
| 观察帧推导与日志字段漂移 | 用真实存档做契约测试 |
| 启动接口被误用产生费用 | 必须显式授权 + 回合与请求上限 + 仅本机绑定 |
