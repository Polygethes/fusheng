import { escapeHtml } from "./dom.js";
import { pixelPortraitMarkup } from "./pixelPortrait.js";
import {
  assignDialogueSides,
  buildLiveEventTimelineEntries,
  buildLocalNewsBriefs,
  buildManuscriptTimelineEntries,
  buildObserverPsychologyMap,
  buildSpeakerThoughtMap,
  collectDraftDialogueTurns,
  speakerThoughtForEntry,
} from "./realityTimeline.js";
import { buildRelationshipTimeline, buildInnerCourtReplay, buildUndoPreview, metricLabel } from "../state/relationshipTimeline.js";
import { buildEvidenceGraph, getCharacterMemories, buildMemoryConflictSummary, memoryTypeOptions, memoryStanceOptions, memoryTypeLabel, memoryStanceLabel, memoryReliabilityLabel } from "../state/memoryGraph.js";
import { buildMemoryAudit } from "../state/memoryAudit.js";
import { auditIntentPlans, PLAN_MODES, ensureCharacterPlans, planStatusOptions, planTactics, planStatusLabel, tacticLabel, summarizePlan, auditPlans } from "../state/intentPlanner.js";
import { containsForbiddenObservationLanguage } from "../worldbuilding/skills.js";
import { privateV27MaintenancePresentation } from "../engine/v27TurnPresentation.js";
import { renderInkTavernStageMarkup } from "./inkTavernStage.js";

const primarySpaces = [
  ["psychology", "心理空间", "角色心里正在发生什么"],
  ["reality", "现实空间", "人物实际做了什么"],
  ["story", "故事空间", "这件事将如何被讲述"],
];

const XIAOYA_YOU_TAVERN_WORLD_PROMPT = "来源于《逍遥游》，从第一集《璞玉》开场前开始。唯一可见舞台是梯云城坡口的望梯酒馆；剑阁、云梯榜、坊市与谢家的变化只通过天气、送货、消息、到访、离场和缺席进入酒馆。";
const XIAOYA_YOU_TAVERN_PEOPLE_PROMPT = "谢真石、谢恒、谢母是高精度常驻人物；周珉、洛照、严执中、陈砚按各自时辰来访。每个人都保留开场前的关系、秘密、日常职责、不肯越过的底线和私下目标，不预知后续剧情。";
const INK_TAVERN_INITIAL_CHARACTER_IDS = Object.freeze([
  "char_xyy_xiezenshi",
  "char_xyy_luozhao",
]);

function initialInkTavernCharacters(state) {
  return INK_TAVERN_INITIAL_CHARACTER_IDS.map((characterId) => {
    const character = state.characters.find((item) => item.id === characterId) || null;
    return {
      characterId,
      name: character?.name || (characterId === "char_xyy_xiezenshi" ? "谢真石" : "洛照"),
      present: true,
      placeId: "loc_xyy_tavern",
      zoneId: "hall",
    };
  });
}

function workspaceForTab(tab) {
  if (["psychology", "simulation", "memory", "memoryAudit", "plans", "timeline"].includes(tab)) return "psychology";
  if (["story", "archive", "diff"].includes(tab)) return "story";
  return "reality";
}

function formatSaveTime(value = "") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function renderApp(state) {
  if (state.ui.activeTab === "setup") {
    return renderWorldSetup(state);
  }
  return `
    <div class="app-shell">
      ${renderTopbar(state)}
      <main class="main">
        ${renderActiveTab(state)}
      </main>
    </div>
  `;
}

function engineModeLabel(engineMode) {
  if (engineMode === "local" || engineMode === "mock") return "本地沙盘";
  if (engineMode === "openai") return "真实模型";
  if (engineMode === "v27") return "人物自决";
  return "自动";
}

function renderTopbar(state) {
  const activeSpace = workspaceForTab(state.ui.activeTab);
  return `
    <header class="workspace-header">
      <div class="brand-lockup">
        <div class="brand">
          <div class="brand-title">${escapeHtml(state.town?.name || "人物小镇")}</div>
          <div class="brand-status">
            <span>${escapeHtml(getBranchTitle(state, state.ui.activeBranchId))}</span>
            <span>${engineModeLabel(state.ui.engineMode)}</span>
          </div>
        </div>
      </div>
      <nav class="workspace-nav" aria-label="三个空间">
        ${primarySpaces.map(([id, label, description]) => `
          <button
            class="workspace-tab ${activeSpace === id ? "active" : ""}"
            data-action="tab"
            data-tab="${id}"
            data-primary-space="${id}"
            ${activeSpace === id ? 'aria-current="page"' : ""}
            title="${escapeHtml(description)}"
          >${label}</button>
        `).join("")}
      </nav>
      <details class="utility-menu">
        <summary class="utility-trigger" aria-label="打开项目与档案菜单">更多</summary>
        <div class="utility-popover">
          <div class="utility-group-label">世界</div>
          <button data-action="open-world-setup">重开酒馆</button>
          <button data-action="tab" data-tab="characters">人物设定</button>
          <button data-action="tab" data-tab="town">酒馆设定</button>
          <div class="utility-group-label">记录</div>
          <button data-action="tab" data-tab="saves">存档</button>
          <button data-action="tab" data-tab="archive">档案</button>
          <button data-action="tab" data-tab="timeline">关系回放</button>
          <button data-action="tab" data-tab="interventions">干预</button>
          <div class="utility-divider"></div>
          <button data-action="export-state">导出</button>
          <label for="import-state-input">导入</label>
          <input id="import-state-input" class="hidden" type="file" accept="application/json" data-action="import-state" />
          <button class="danger-text" data-action="reset-state">重置世界</button>
        </div>
      </details>
    </header>
  `;
}

function renderActiveTab(state) {
  if (state.ui.activeTab === "setup") return renderWorldSetup(state);
  if (state.ui.activeTab === "psychology") return renderPsychologySpace(state);
  if (state.ui.activeTab === "reality" || state.ui.activeTab === "observe") return renderObservationDeck(state);
  if (state.ui.activeTab === "story") return renderStorySpace(state);
  if (state.ui.activeTab === "characters") return renderCharacterWorkshop(state);
  if (state.ui.activeTab === "town") return renderTownWorkshop(state);
  if (state.ui.activeTab === "archive") return renderArchive(state);
  if (state.ui.activeTab === "saves") return renderSaveLibrary(state);
  if (state.ui.activeTab === "timeline") return renderTimelineReplay(state);
  if (state.ui.activeTab === "memory") return renderMemoryAndEvidence(state);
  if (state.ui.activeTab === "memoryAudit") return renderMemoryAuditView(state);
  if (state.ui.activeTab === "plans") return renderIntentPlannerView(state);
  if (state.ui.activeTab === "simulation") return renderSimulationView(state);
  if (state.ui.activeTab === "diff") return renderBranchDiffView(state);
  if (state.ui.activeTab === "interventions") return renderInterventionLab(state);
  return renderControlDeck(state);
}

function renderSaveLibrary(state) {
  const saves = Array.isArray(state.ui?.saveSlots) ? state.ui.saveSlots : [];
  const status = state.ui?.saveSlotsStatus || "idle";
  const inProgress = state.ui?.livePerformance?.status === "running";
  const suggestedName = state.ui?.saveNameDraft
    || `${state.town?.name || "未命名世界"} · ${(state.canonEvents || []).length || (state.draftScenes || []).length ? "当前进度" : "初始"}`;
  return `
    <section class="workspace-space save-library" data-save-library="true">
      <header class="save-library-header">
        <div>
          <div class="space-kicker story-tone">世界存档</div>
          <h1>保存进度</h1>
        </div>
        <form class="save-world-form" id="save-world-form">
          <input class="save-name-input" name="name" aria-label="存档名称" maxlength="60" value="${escapeHtml(suggestedName)}" />
          <button class="btn primary" type="submit" ${inProgress ? "disabled" : ""}>保存当前世界</button>
        </form>
      </header>
      <div class="save-current-strip">
        <strong>${escapeHtml(state.town?.name || state.project?.title || "未命名世界")}</strong>
        <span>${(state.characters || []).length} 位人物</span>
        <span>${(state.canonEvents || []).length} 条正史</span>
        <span>${(state.draftScenes || []).length} 份草稿</span>
      </div>
      <div class="save-list" aria-live="polite">
        ${status === "loading" ? `<div class="save-empty">正在读取存档…</div>` : saves.length ? saves.map((save) => `
          <article class="save-row" data-save-id="${escapeHtml(save.id)}">
            <div class="save-row-main">
              <div class="save-row-title"><strong>${escapeHtml(save.name || "未命名存档")}</strong><time>${escapeHtml(formatSaveTime(save.updatedAt))}</time></div>
              <p>${escapeHtml(save.worldName || "未命名世界")} · ${escapeHtml(save.branchTitle || "主线")}</p>
              <div class="save-row-stats">
                <span>${Number(save.characterCount || 0)} 位人物</span>
                <span>${Number(save.canonCount || 0)} 条正史</span>
                <span>${Number(save.draftCount || 0)} 份草稿</span>
              </div>
            </div>
            <div class="save-row-actions">
              <button class="btn small" type="button" data-action="load-save" data-id="${escapeHtml(save.id)}">读取</button>
              <button class="btn small ghost" type="button" data-action="overwrite-save" data-id="${escapeHtml(save.id)}">覆盖</button>
              <button class="btn small ghost danger-text" type="button" data-action="delete-save" data-id="${escapeHtml(save.id)}" aria-label="删除${escapeHtml(save.name || "存档")}">删除</button>
            </div>
          </article>
        `).join("") : `<div class="save-empty"><strong>还没有手动存档</strong><span>当前世界仍在自动恢复点中。</span></div>`}
      </div>
    </section>
  `;
}

function renderWorldSetup(state) {
  const step = ["world", "characters", "launch"].includes(state.ui.setupStep) ? state.ui.setupStep : "world";
  return `
    <section class="setup-book-shell setup-atlas-shell" data-world-setup="true" data-setup-dialog="true" data-immersive-setup="true" data-setup-step="${escapeHtml(step)}">
      <div class="setup-book setup-atlas" data-book-setup="true" role="dialog" aria-modal="true" aria-labelledby="setup-dialog-title">
        <section class="book-page book-page-input atlas-panel atlas-panel-input" data-book-page="input">
          <div class="setup-dialog-head">
            <h1 id="setup-dialog-title" class="setup-title">${escapeHtml(setupStepTitle(step))}</h1>
            ${state.ui.setupCompleted ? `<button class="btn ghost setup-return-current" type="button" data-action="cancel-world-setup">← 返回当前小镇</button>` : ""}
          </div>

          ${step === "world" ? renderSetupWorldStep(state) : ""}
          ${step === "characters" ? renderSetupCharacterStep(state) : ""}
          ${step === "launch" ? renderSetupLaunchStep(state) : ""}
        </section>
        <div class="book-spine" aria-hidden="true"></div>
        <section class="book-page book-page-preview atlas-panel atlas-panel-map" data-book-page="preview">
          ${renderPixelPreview(state)}
        </section>
      </div>
    </section>
  `;
}

export function inferPixelPreview(source = {}) {
  const text = `${source.setupWorldPrompt || XIAOYA_YOU_TAVERN_WORLD_PROMPT} ${source.setupPeoplePrompt || XIAOYA_YOU_TAVERN_PEOPLE_PROMPT}`;
  if (/逍遥游|璞玉|谢真石|梯云宗|云梯榜/.test(text)) {
    return {
      theme: "xiaoyaoyou",
      view: "top-down",
      title: "望梯酒馆像素预演",
      town: "镜头固定在一间酒馆；灶火、客桌、临街窗和后门承接梯云城不断变化的压力。",
      actors: ["谢真石", "谢恒", "谢母", "周珉", "陈砚"],
      objects: ["热饭", "账板", "湿柴", "拜帖", "练功册"],
      locations: ["望梯酒馆"],
      districts: ["灶台", "临街窗", "中央客桌", "后门账板"],
      paths: ["门口-客桌", "客桌-灶台", "灶台-后门"],
    };
  }
  if (/仙侠|修真|修仙|正邪|中立城|中立城市|灵契|妖族|鬼修|龙裔|器灵/.test(text)) {
    return {
      theme: "xianxia-neutral-city",
      view: "top-down",
      title: "停剑城像素预演",
      town: "四方法契门、无咎市、照骨司和归墟渡压成一张正邪共处的中立城图。",
      actors: ["沈珩", "阎无咎", "鹿青萝", "阿照", "敖霁"],
      objects: ["灵契", "界石", "妖丹盒", "照骨镜", "渡令"],
      locations: ["四方法契门", "无咎市", "照骨司"],
      districts: ["四方法契门", "无咎市", "照骨司", "归墟渡"],
      paths: ["四方法契门-无咎市", "无咎市-照骨司", "照骨司-归墟渡"],
    };
  }
  if (/西游|取经|唐僧|悟空|妖怪|神佛/.test(text)) {
    return {
      theme: "journey-west",
      view: "top-down",
      title: "取经路像素预演",
      town: "山门、密林、妖洞和破寺院被压成一张可俯看的行路图。",
      actors: ["唐僧", "孙悟空", "猪八戒", "沙悟净", "白骨夫人"],
      objects: ["通关文牒", "金箍棒", "行李担", "山门"],
      locations: ["山门前", "密林小路", "妖洞厅"],
      districts: ["山门前", "密林小路", "妖洞厅", "破寺院"],
      paths: ["山门前-密林小路", "密林小路-妖洞厅", "密林小路-破寺院"],
    };
  }
  if (/三国|乱世|城池|粮草|盟约|谋士|武将|曹操|刘备|孙权/.test(text)) {
    return {
      theme: "three-kingdoms",
      view: "top-down",
      title: "乱世城池像素预演",
      town: "军帐、城门、粮仓和渡口成为一张临战边城地图。",
      actors: ["君主", "谋士", "武将", "旧臣"],
      objects: ["虎符", "地图", "粮袋", "酒盏"],
      locations: ["中军帐", "城门下", "粮仓"],
      districts: ["中军帐", "城门下", "粮仓", "渡口"],
      paths: ["中军帐-城门下", "城门下-渡口", "中军帐-粮仓"],
    };
  }
  if (/教父|家族|黑手党|地下权力|移民|继承/.test(text)) {
    return {
      theme: "godfather",
      view: "top-down",
      title: "家族城市像素预演",
      town: "书房、餐桌、街角和法庭走廊围成一张权力街区图。",
      actors: ["首领", "继承人", "兄长", "顾问"],
      objects: ["戒指", "电话", "酒杯", "车钥匙"],
      locations: ["书房", "家族餐桌", "街角"],
      districts: ["书房", "家族餐桌", "街角", "法庭走廊"],
      paths: ["书房-家族餐桌", "家族餐桌-街角", "街角-法庭走廊"],
    };
  }
  if (/变形记|格里高尔|布拉格|公寓|债务|闹钟|萨姆沙/.test(text)) {
    return {
      theme: "metamorphosis",
      view: "top-down",
      title: "公寓前夜像素预演",
      town: "房门、餐桌、楼梯间和公司柜台被摆成一张室内镇图。",
      actors: ["格里高尔", "格蕾特", "父亲", "母亲"],
      objects: ["闹钟", "账本", "样品箱", "钥匙"],
      locations: ["房门", "家庭餐桌", "公司柜台"],
      districts: ["房门", "家庭餐桌", "楼梯间", "公司柜台"],
      paths: ["房门-家庭餐桌", "家庭餐桌-楼梯间", "楼梯间-公司柜台"],
    };
  }
  return {
    theme: "blank-stage",
    view: "top-down",
    title: "未命名小镇像素预演",
    town: "输入会在这里变成可俯看的像素街道、房间、人物和物件。",
    actors: ["人物一", "人物二", "旁观者"],
    objects: ["门", "桌子", "纸条", "灯"],
    locations: ["门口", "桌边", "街口"],
    districts: ["门口", "桌边", "街口", "暗处"],
    paths: ["门口-桌边", "桌边-街口", "街口-暗处"],
  };
}

function renderPixelPreview(state) {
  const preview = inferPixelPreview(state.ui || {});
  const districts = preview.districts || preview.locations || [];
  const paths = preview.paths || [];
  const fixtures = preview.objects || [];
  return `
    <div class="pixel-preview" aria-label="像素小镇实时预演">
      <div class="pixel-preview-head">
        <div class="pixel-preview-title" data-pixel-preview-title="true">${escapeHtml(preview.title)}</div>
        <div class="pixel-preview-copy">${escapeHtml(preview.town)}</div>
      </div>
      <div class="pixel-viewport" data-pixel-viewport="true" data-pixel-map-view="${escapeHtml(preview.view || "top-down")}" data-pixel-theme="${escapeHtml(preview.theme)}">
        <div class="pixel-town pixel-topdown-town" data-pixel-town="true" aria-hidden="true">
          ${Array.from({ length: 4 }, (_, index) => {
            const district = districts[index % districts.length] || "";
            return `
            <span class="pixel-district plan-block district-${index + 1}" data-pixel-district="${escapeHtml(district)}" data-plan-block="${escapeHtml(district)}"></span>
          `;
          }).join("")}
          ${Array.from({ length: 3 }, (_, index) => {
            const path = paths[index % paths.length] || "";
            return `
            <span class="pixel-path plan-road path-${index + 1}" data-pixel-path="${escapeHtml(path)}" data-plan-road="${escapeHtml(path)}"></span>
          `;
          }).join("")}
          ${Array.from({ length: 4 }, (_, index) => {
            const fixture = fixtures[index % fixtures.length] || "";
            return `
            <span class="plan-fixture fixture-${index + 1}" data-plan-fixture="${escapeHtml(fixture)}"></span>
          `;
          }).join("")}
          ${Array.from({ length: 5 }, (_, index) => {
            const actor = preview.actors[index] || "";
            return `
            <span class="pixel-actor pixel-person setup-person actor-${index + 1}" data-pixel-person="true" data-pixel-actor="${escapeHtml(actor)}" data-movement-source="setup-preview">
              <span class="pixel-person-shadow"></span>
              <span class="pixel-person-head"></span>
              <span class="pixel-person-body"></span>
              <span class="pixel-person-feet"></span>
              <span class="pixel-person-label">${escapeHtml(actor)}</span>
            </span>
          `;
          }).join("")}
        </div>
      </div>
      <div class="pixel-ledger">
        <div>
          <span>人物</span>
          <p data-pixel-preview-actors="true">${escapeHtml(preview.actors.join("、"))}</p>
        </div>
        <div>
          <span>物件</span>
          <p data-pixel-preview-objects="true">${escapeHtml(preview.objects.join("、"))}</p>
        </div>
        <div>
          <span>地点</span>
          <p data-pixel-preview-locations="true">${escapeHtml(preview.locations.join("、"))}</p>
        </div>
      </div>
    </div>
  `;
}

function setupStepTitle(step) {
  return ({
    world: "望梯酒馆今天承受什么外界压力？",
    characters: "哪些人会在这里过自己的日子？",
    launch: "准备打开望梯酒馆",
  })[step] || "望梯酒馆今天承受什么外界压力？";
}

function renderSetupWorldStep(state) {
  const value = state.ui.setupWorldPrompt || XIAOYA_YOU_TAVERN_WORLD_PROMPT;
  return `
    <div class="setup-step-panel setup-world-step creator-step">
      <textarea
        id="setup-world-prompt"
        class="textarea setup-creator-input"
        data-action="ui-input"
        data-key="setupWorldPrompt"
        aria-labelledby="setup-dialog-title"
        placeholder="例如：送来的米比账上少一截，细雨打湿了新柴，剑阁钟声提前响起。"
      >${escapeHtml(value)}</textarea>
      ${state.ui.setupCompleted ? "" : renderWorldPresetButtons(state.ui.setupWorldPrompt)}
      <div class="setup-dialog-actions">
        <button class="btn primary setup-next" data-action="setup-step" data-step="characters">继续</button>
      </div>
    </div>
  `;
}

function renderSetupCharacterStep(state) {
  const value = state.ui.setupPeoplePrompt || XIAOYA_YOU_TAVERN_PEOPLE_PROMPT;
  return `
    <div class="setup-step-panel setup-character-step creator-step">
      <textarea
        id="setup-people-prompt"
        class="textarea setup-creator-input"
        data-action="ui-input"
        data-key="setupPeoplePrompt"
        aria-labelledby="setup-dialog-title"
        placeholder="写下人物今天必须做的事、拒绝做的事，以及不愿让别人知道的私事。"
      >${escapeHtml(value)}</textarea>
      ${state.ui.setupCompleted ? "" : renderPeoplePresetButtons(state.ui.setupPeoplePrompt)}
      <div class="setup-dialog-actions">
        <button class="btn ghost" data-action="setup-step" data-step="world">返回</button>
        <button class="btn primary setup-next" data-action="setup-step" data-step="launch">继续</button>
      </div>
    </div>
  `;
}

function renderSetupLaunchStep(state) {
  const world = state.ui.setupWorldPrompt || XIAOYA_YOU_TAVERN_WORLD_PROMPT;
  const people = state.ui.setupPeoplePrompt || XIAOYA_YOU_TAVERN_PEOPLE_PROMPT;
  return `
    <div class="setup-step-panel setup-launch-step creator-step">
      <div class="setup-launch-summary">
        <div>
          <span>世界</span>
          <p>${escapeHtml(world)}</p>
        </div>
        <div>
          <span>人物</span>
          <p>${escapeHtml(people)}</p>
        </div>
      </div>
      <div class="setup-dialog-actions">
        <button class="btn ghost" data-action="setup-step" data-step="characters">返回</button>
        <button class="btn primary setup-enter" data-action="enter-simulation">进入世界</button>
      </div>
    </div>
  `;
}

function renderWorldPresetButtons(currentValue = "") {
  if (String(currentValue).trim()) return "";
  const presets = [
    {
      label: "《逍遥游 · 望梯酒馆》",
      world: XIAOYA_YOU_TAVERN_WORLD_PROMPT,
      people: XIAOYA_YOU_TAVERN_PEOPLE_PROMPT,
    },
  ];
  return `
    <div class="setup-preset-wrap">
      <div class="setup-preset-note">没有想好时，可以先选一个原型。</div>
      <div class="setup-preset-row">
        ${presets.map((preset) => `
          <button class="setup-preset-button" data-action="setup-preset" data-world-prompt="${escapeHtml(preset.world)}" data-people-prompt="${escapeHtml(preset.people)}">
            ${escapeHtml(preset.label)}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function renderPeoplePresetButtons(currentValue = "") {
  if (String(currentValue).trim()) return "";
  const presets = [
    XIAOYA_YOU_TAVERN_PEOPLE_PROMPT,
  ];
  return `
    <div class="setup-preset-wrap">
      <div class="setup-preset-note">也可以从一种人物结构开始。</div>
      <div class="setup-preset-row">
        ${presets.map((preset) => `
          <button class="setup-preset-button" data-action="setup-preset" data-people-prompt="${escapeHtml(preset)}">
            ${escapeHtml(preset)}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function getSetupOption(options = [], selectedId) {
  return (options || []).find((option) => option.id === selectedId) || options?.[0] || null;
}

function renderSetupOptionGroup(label, options = [], key, selectedId) {
  return `
    <div class="setup-option-group">
      <div class="setup-option-label">${escapeHtml(label)}</div>
      <div class="setup-options">
        ${(options || []).map((option) => `
          <button class="setup-option ${option.id === selectedId ? "active" : ""}" data-action="world-option" data-key="${key}" data-value="${escapeHtml(option.id)}">
            <span>${escapeHtml(option.label)}</span>
            <small>${escapeHtml(option.summary || option.detail || "")}</small>
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function renderRelationshipSetupGraph(state, setup) {
  const nodes = new Set();
  for (const edge of setup.relationshipGraph || []) {
    nodes.add(edge.from);
    nodes.add(edge.to);
  }
  const orderedNodes = [...nodes].map((id) => state.characters.find((character) => character.id === id)).filter(Boolean);
  return `
    <div class="relationship-net" data-relationship-graph="true">
      <div class="relationship-net-title">关系网</div>
      <div class="relationship-node-grid">
        ${orderedNodes.map((character) => `
          <div class="relationship-node ${character.id === "char_gregor" ? "core" : ""}">
            <strong>${escapeHtml(character.name)}</strong>
            <span>${escapeHtml(getSetupCharacterIdentity(character))}</span>
          </div>
        `).join("")}
      </div>
      <div class="relationship-edge-list">
        ${(setup.relationshipGraph || []).map((edge) => `
          <div class="relationship-edge">
            <span>${escapeHtml(getName(state, edge.from))}</span>
            <b>${escapeHtml(edge.label)}</b>
            <span>${escapeHtml(getName(state, edge.to))}</span>
            <small>${escapeHtml(edge.pressure)}</small>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function getSetupCharacterIdentity(character = {}) {
  const setupIdentity = {
    char_gregor: "旅行推销员，家庭债务的主要偿还者，仍准备按车次出门。",
    char_grete: "年轻妹妹，音乐愿望被家庭账本不断推迟。",
    char_father: "父亲，旧债和失去工作后的沉默压在餐桌旁。",
    char_mother: "母亲，试图把经济依赖说成家人之间的体谅。",
    char_clerk: "公司书记员，把迟到和缺勤写进可上报的秩序。",
    char_lodger: "未来可能出现的租客，代表家庭对体面和租金的担忧。",
  };
  return setupIdentity[character.id]
    || character.externalSituation?.pressure
    || character.publicIdentity
    || "前史尚未填写。";
}

function renderSkillRules(skill = {}) {
  const title = skill.name || "Skill";
  const rules = skill.checkpoints || skill.rules || [];
  const fields = skill.requiredFields || skill.minimumFields || [];
  const ruleSets = skill.ruleSets || [];
  if (!rules.length && !fields.length && !ruleSets.length) return "";
  return `
    <div class="setup-rule-block">
      <div class="setup-rule-title">${escapeHtml(title)}</div>
      ${skill.purpose ? `<div class="setup-rule">${escapeHtml(skill.purpose)}</div>` : ""}
      ${fields.length ? `<div class="badge-row">${fields.map((field) => `<span class="badge">${escapeHtml(skillFieldLabel(field))}</span>`).join("")}</div>` : ""}
      ${ruleSets.length ? `<div class="badge-row">${ruleSets.map((field) => `<span class="badge">${escapeHtml(skillFieldLabel(field))}</span>`).join("")}</div>` : ""}
      ${rules.map((rule) => `<div class="setup-rule">${escapeHtml(rule)}</div>`).join("")}
    </div>
  `;
}

function skillFieldLabel(field) {
  return ({
    timepoint: "时间点",
    era: "时代",
    location: "地点",
    background: "背景",
    baseRules: "底层规则",
    ruleSets: "规则组",
    boundaries: "边界",
    simulationClock: "运行方式",
    visibilityPolicy: "观察精度",
    forbiddenKnowledge: "禁止预知",
    publicIdentity: "公开身份",
    externalSituation: "外部处境",
    internalSituation: "内部矛盾",
    selfMyth: "自我神话",
    actionLines: "戏剧行动",
    prehistory: "前史",
    distinctionAxis: "区分轴",
    relationshipPressure: "关系压力",
    publicRules: "公开规则",
    hiddenRules: "隐藏规则",
    punishmentRules: "惩罚规则",
    exceptionRules: "例外规则",
    visibilityRules: "可见性规则",
  })[field] || field;
}

function getPrivateSimulationForCharacter(draft, characterId) {
  if (!draft || !characterId) return null;
  const direct = draft.privateSimulations || draft.simulationTick?.privateSimulations || [];
  const tickSimulations = (draft.periodSimulation?.ticks || [])
    .slice()
    .reverse()
    .flatMap((tick) => tick.privateSimulations || []);
  return [...direct, ...tickSimulations].find((simulation) => simulation.characterId === characterId) || null;
}

function getDialoguePsychologyForCharacter(draft, characterId) {
  if (!draft || !characterId) return null;
  const direct = draft.dialoguePsychology || draft.simulationTick?.dialoguePsychology || [];
  const tickReactions = (draft.periodSimulation?.ticks || [])
    .slice()
    .reverse()
    .flatMap((tick) => tick.dialoguePsychology || tick.simulationTick?.dialoguePsychology || []);
  return [...direct].reverse().find((reaction) => reaction.characterId === characterId)
    || tickReactions.find((reaction) => reaction.characterId === characterId)
    || null;
}

function describeCharacterState(character = {}) {
  const labels = {
    desire: "欲望",
    shame: "羞耻",
    rage: "愤怒",
    love: "依恋",
    disgust: "厌恶",
    selfDeception: "自欺",
    selfDestruction: "自毁",
    protectionImpulse: "保护",
    revengeImpulse: "报复",
  };
  const strongest = Object.entries(character.currentState || {})
    .filter(([key, value]) => labels[key] && Number.isFinite(Number(value)))
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 3);
  return strongest.length
    ? strongest.map(([key, value]) => `${labels[key]} ${Math.round(Number(value))}`).join(" · ")
    : "状态尚未显影";
}

function psychologyDesiredResponse(simulation = null, character = {}) {
  const simulated = String(simulation?.whatTheyWantFromOthers || "").trim();
  const invalidLegacyValue = /^(recognition|being_seen|被看见。?|希望被看见。?|得到认可。?|希望得到认可。?|最能看穿自己的人。?|一个能维持自我神话的反应。?|得到一个能支撑自我神话的回应。?)$/;
  if (simulated && !invalidLegacyValue.test(simulated)) return simulated;
  return character.agentProfile?.desiredResponse
    || character.internalSituation?.desiredResponse
    || character.innerCourt?.desiredResponse
    || "希望关键的人听完自己的要求，再作出明确回应。";
}

function renderPsychologySpace(state) {
  const draft = getLastDraft(state);
  const selected = state.characters.find((character) => character.id === state.ui.selectedCharacterId) || state.characters[0];
  if (!selected) return `<section class="space-empty"><p>这个世界还没有人物。</p></section>`;
  const simulation = getPrivateSimulationForCharacter(draft, selected.id);
  const liveReactionValue = state.ui?.livePerformance?.psychologyByCharacter?.[selected.id] || null;
  const liveReaction = Array.isArray(liveReactionValue) ? liveReactionValue.at(-1) || null : liveReactionValue;
  const dialogueReaction = liveReaction || getDialoguePsychologyForCharacter(draft, selected.id);
  const inner = selected.internalSituation || {};
  const myth = selected.selfMyth || {};
  const thoughts = dialogueReaction ? [
    ["没有说出口", dialogueReaction.privateThought],
    [dialogueReaction.speakerName ? `听见${dialogueReaction.speakerName}` : "刚刚听见", dialogueReaction.heardLine],
    ["他以为", dialogueReaction.interpretation],
    ["下一刻想做", dialogueReaction.nextImpulse],
  ].filter(([, value]) => String(value || "").trim()) : [
    ["此刻想要", simulation?.privateDesire || inner.inadmissibleDesire || selected.actionLines?.desire],
    ["不肯承认", simulation?.whatTheyRefuseToAdmit || inner.deepestShame || myth.fearsActuallyBeing],
    ["正在欺骗自己", simulation?.mistakenBelief || simulation?.selfLie || inner.repeatedSelfLie || selected.currentState?.currentSelfLie],
    ["想从别人那里得到", psychologyDesiredResponse(simulation, selected)],
    ["可能做出的事", simulation?.riskTheyWillCreate || simulation?.shadowImpulse || selected.actionLines?.shadow],
  ].filter(([, value]) => String(value || "").trim());
  const targetName = simulation?.targetCharacterId ? getName(state, simulation.targetCharacterId) : "";

  return `
    <section class="workspace-space psychology-space" data-psychology-space="true">
      <aside class="character-rail" aria-label="人物">
        <div class="rail-heading">人物</div>
        <div class="character-list">
          ${state.characters.map((character) => `
            <button class="character-row ${character.id === selected.id ? "active" : ""}" data-action="select-character" data-id="${character.id}" ${character.id === selected.id ? 'aria-current="true"' : ""}>
              ${pixelPortraitMarkup(character, "small")}
              <span><strong>${escapeHtml(character.name)}</strong><small>${escapeHtml((character.publicIdentity || "").split("，")[0])}</small></span>
            </button>
          `).join("")}
        </div>
      </aside>
      <article class="psychology-reading">
        <header class="space-title-row">
          <div class="space-title-identity">
            ${pixelPortraitMarkup(selected, "large")}
            <div>
              <div class="space-kicker psyche-tone">私密视角${targetName ? ` · 面对${escapeHtml(targetName)}` : ""}</div>
              <h1>${escapeHtml(selected.name)}</h1>
              <p class="state-line">${escapeHtml(dialogueReaction
                ? [dialogueReaction.feeling, dialogueReaction.bodyResponse].filter(Boolean).join(" · ")
                : describeCharacterState(selected))}</p>
            </div>
          </div>
          <span class="space-status">${liveReaction ? "正在发生" : draft ? "此刻" : "前史"}</span>
        </header>
        <div class="inner-monologue">
          ${thoughts.map(([label, value], index) => `
            <section class="thought-passage ${index === 0 ? "lead" : ""}">
              <h2>${escapeHtml(label)}</h2>
              <p>${index === 0 ? "“" : ""}${escapeHtml(value)}${index === 0 ? "”" : ""}</p>
            </section>
          `).join("")}
        </div>
      </article>
      <aside class="psychology-margin">
        <div class="margin-note-label">外在身份</div>
        <p>${escapeHtml(selected.publicIdentity || "")}</p>
        <div class="margin-note-label">维持的说法</div>
        <p>${escapeHtml(dialogueReaction?.selfLie || simulation?.defensiveMask || selected.actionLines?.defense || inner.selfMyth || "")}</p>
      </aside>
    </section>
  `;
}

function storySourceText(draft, state) {
  if (!draft) return "";
  if (String(draft.novelText || "").trim()) return String(draft.novelText).trim();
  const events = buildObservationEvents(draft, state).map((event) => event.text).filter(Boolean);
  if (events.length) return events.join("\n\n");
  return String(draft.sceneText || draft.surfaceEvent || "").trim();
}

function storyPsychologyMaterials(draft, state) {
  if (!draft) return [];
  const direct = draft.privateSimulations || draft.simulationTick?.privateSimulations || [];
  const tickSimulations = (draft.periodSimulation?.ticks || []).flatMap((tick) => tick.privateSimulations || []);
  const latestByCharacter = new Map();
  for (const simulation of [...direct, ...tickSimulations]) {
    if (simulation?.characterId && !latestByCharacter.has(simulation.characterId)) {
      latestByCharacter.set(simulation.characterId, simulation);
    }
  }
  const firstFocusedTick = (draft.periodSimulation?.ticks || []).find((tick) => tick.resolution === "focused_scene")
    || draft.periodSimulation?.ticks?.[0];
  const participantIds = [
    ...(firstFocusedTick?.participantIds || []),
    ...(draft.participantIds || []),
    ...(draft.periodSimulation?.ticks || []).flatMap((tick) => tick.participantIds || []),
  ];
  for (const characterId of [...new Set(participantIds)]) {
    if (latestByCharacter.has(characterId)) continue;
    const character = state.characters.find((item) => item.id === characterId);
    if (!character) continue;
    latestByCharacter.set(characterId, {
      characterId,
      characterName: character.name,
      privateDesire: character.actionLines?.desire || character.internalSituation?.inadmissibleDesire || "",
      whatTheyRefuseToAdmit: character.internalSituation?.deepestShame || character.selfMyth?.fearsActuallyBeing || "",
      selfLie: character.currentState?.currentSelfLie || character.internalSituation?.repeatedSelfLie || "",
    });
  }
  const orderedIds = [...new Set(participantIds)];
  const orderedSimulations = [
    ...orderedIds.map((characterId) => latestByCharacter.get(characterId)).filter(Boolean),
    ...[...latestByCharacter.values()].filter((simulation) => !orderedIds.includes(simulation.characterId)),
  ];
  return orderedSimulations.slice(0, 3).map((simulation) => ({
    name: simulation.characterName || getName(state, simulation.characterId),
    desire: simulation.privateDesire || "",
    refusal: simulation.whatTheyRefuseToAdmit || "",
    lie: simulation.mistakenBelief || simulation.selfLie || "",
  })).filter((material) => material.desire || material.refusal || material.lie);
}

function renderStoryParagraphs(text = "") {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("");
}

function renderStorySpace(state) {
  const workspace = state.ui.storyWorkspace || {};
  const sourceDraft = state.draftScenes.find((draft) => draft.id === workspace.sourceDraftId) || getLastDraft(state);
  const sourceText = storySourceText(sourceDraft, state);
  const psychologyMaterials = storyPsychologyMaterials(sourceDraft, state);
  const sourceBundleText = [
    psychologyMaterials.length
      ? `心理材料\n${psychologyMaterials.map((material) => `${material.name}：${[material.desire, material.refusal, material.lie].filter(Boolean).join("；")}`).join("\n")}`
      : "",
    sourceText ? `现实材料\n${sourceText}` : "",
  ].filter(Boolean).join("\n\n");
  const activeRevision = (state.storyRevisions || []).find((revision) => revision.id === workspace.activeRevisionId)
    || (state.storyRevisions || []).find((revision) => revision.sourceDraftId === sourceDraft?.id);
  const workspaceMatchesSource = workspace.sourceDraftId === sourceDraft?.id;
  const rewriteText = workspaceMatchesSource && workspace.rewriteText ? workspace.rewriteText : activeRevision?.text || sourceText;
  const title = workspaceMatchesSource && workspace.title ? workspace.title : activeRevision?.title || sourceDraft?.surfaceEvent || "";
  const savedLabel = workspace.status === "saved" && activeRevision ? "已保存" : "未保存";

  if (!sourceDraft) {
    return `
      <section class="workspace-space story-space" data-story-space="true">
        <div class="story-empty">
          <span class="space-kicker story-tone">故事空间</span>
          <h1>现实尚未留下素材</h1>
          <p>先到现实空间运行一段时间。</p>
          <button class="btn primary" data-action="tab" data-tab="reality">进入现实空间</button>
        </div>
      </section>
    `;
  }

  return `
    <section class="workspace-space story-space" data-story-space="true">
      <header class="story-toolbar">
        <div>
          <div class="space-kicker story-tone">故事空间</div>
          <h1>把已经发生的事写下来</h1>
        </div>
        <div class="story-source-select">
          <label for="story-source">素材</label>
          <select id="story-source" class="select" data-action="story-source">
            ${state.draftScenes.map((draft) => `<option value="${draft.id}" ${draft.id === sourceDraft.id ? "selected" : ""}>${escapeHtml(draft.surfaceEvent || formatDraftTime(draft.createdAt) || "未命名场景")}</option>`).join("")}
          </select>
        </div>
      </header>
      <div class="story-workbench">
        <article class="source-manuscript" aria-label="心理与现实素材">
          <div class="manuscript-head"><span>心理与现实材料</span><span>只读</span></div>
          ${psychologyMaterials.length ? `
            <section class="psychology-materials">
              <div class="manuscript-section-label psyche-tone">人物内里</div>
              ${psychologyMaterials.map((material) => `
                <div class="psychology-material">
                  <strong>${escapeHtml(material.name)}</strong>
                  <p>${escapeHtml([material.desire, material.refusal, material.lie].filter(Boolean).join("；"))}</p>
                </div>
              `).join("")}
            </section>
          ` : ""}
          <div class="manuscript-section-label reality-tone">已经发生</div>
          <div class="manuscript-prose">${renderStoryParagraphs(sourceText)}</div>
        </article>
        <form class="story-editor" id="story-editor-form">
          <div class="editor-head">
            <input class="story-title-input" name="title" aria-label="故事标题" placeholder="未命名故事" value="${escapeHtml(title)}" />
            <select class="story-mode-select" name="mode" aria-label="叙述方式">
              ${[["close-third", "贴近人物"], ["first-person", "第一人称"], ["distant", "远距离"], ["dramatic", "纯场景"]].map(([value, label]) => `<option value="${value}" ${(workspace.mode || activeRevision?.mode || "close-third") === value ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </div>
          <textarea class="story-editor-text" name="rewriteText" aria-label="故事正文">${escapeHtml(rewriteText)}</textarea>
          <input type="hidden" name="sourceDraftId" value="${sourceDraft.id}" />
          <textarea class="hidden" name="sourceText">${escapeHtml(sourceBundleText)}</textarea>
          <div class="editor-footer">
            <span class="save-status ${workspace.status === "saved" ? "saved" : ""}">${savedLabel}</span>
            <div class="editor-actions">
              <button class="btn ghost" type="button" data-action="story-reset" data-id="${sourceDraft.id}">恢复现实原文</button>
              <button class="btn story-save" type="submit">保存故事稿</button>
            </div>
          </div>
        </form>
      </div>
    </section>
  `;
}

function renderObservationDeck(state) {
  const draft = getLastDraft(state);
  const allEvents = buildObservationEvents(draft, state);
  const playback = getObservationPlayback(state, draft, allEvents.length);
  const events = allEvents.slice(0, playback.visibleCount);
  const livePerformance = state.ui?.livePerformance || null;
  const isLive = livePerformance?.status === "running";
  const isInterrupted = livePerformance?.status === "interrupted";
  const isModelError = livePerformance?.status === "error" && livePerformance?.errorKind === "model_stage";
  const isRunError = livePerformance?.status === "error" && !isModelError;
  const showLivePerformance = isLive || isInterrupted || isModelError || isRunError;
  const focusLocation = state.locations.find((location) => location.id === state.ui.selectedLocationId) || state.locations[0];
  const fixedStage = Boolean(state.worldSetup?.fixedStage);
  const focusLabel = fixedStage ? `固定舞台 · ${focusLocation?.name || "望梯酒馆"}` : state.ui.focusMode === "location" ? `聚焦 ${focusLocation?.name || "未知地点"}` : "全镇背景";
  const tavern = draft?.updateBundle?.tavernState || state.tavernState || {};
  const stock = tavern.stock || {};
  const institution = tavern.institution || {};
  const ownerNames = (institution.ownerIds || []).map((id) => state.characters.find((character) => character.id === id)?.name).filter(Boolean);
  const operatorName = state.characters.find((character) => character.id === institution.operatorId)?.name || "";
  const activeVisitCount = (tavern.activeVisits || []).filter((visit) => !["completed", "abandoned", "refused"].includes(visit.stage)).length;
  const openEventThreads = (tavern.eventThreads || []).filter((thread) => thread.status === "open");
  const latestThreadTopic = openEventThreads.at(-1)?.topic || "暂无未完话头";
  const relationshipProgressCount = (draft?.updateBundle?.relationships || [])
    .filter((shift) => ["causal-perceived-relationship-outcome", "character-agent-owned-appraisal", "agent-dialogue-relationship", "model-agent-dialogue"].includes(shift.generatedFrom)).length;
  const tavernDayLabel = `第${Math.max(1, Number(tavern.day || 0) + (draft ? 0 : 1))}日`;
  // v2.7 runs produce committed world facts and character turns, not a narrated
  // scene draft, so there is nothing for "写入正史" to accept.
  const isV27Mode = fixedStage && state.ui.engineMode === "v27";
  const v27Observation = state.ui?.v27Observation || null;
  const v27Running = state.ui?.v27Running === true;
  const npcActivityRunning = isV27Mode && (
    state.ui?.npcActivityRunning === true || state.ui?.npcActivityStatus === "running"
  );
  const inkTavernInitialCharacters = fixedStage ? initialInkTavernCharacters(state) : [];
  const inkTavernObservation = v27Observation
    ? {
      ...v27Observation,
      characters: Array.isArray(v27Observation.characters) && v27Observation.characters.length
        ? v27Observation.characters
        : inkTavernInitialCharacters,
    }
    : null;
  const inkTavernStageState = npcActivityRunning || v27Running ? "running" : v27Observation ? "settled" : "idle";
  const inkTavernIdleCaption = isV27Mode
    ? "人物已站在正式世界的初始位置。开始活动后，他们会在客栈里走动、停留和做事。"
    : "客栈已经就位。切换到「人物自决」，人物将按正式世界结算在这里生活。";
  const playLabel = isV27Mode
    ? (npcActivityRunning ? "停止活动" : "开始活动")
    : isLive ? "演出中" : showLivePerformance ? "重新观察" : playback.isPlaying ? "观察中" : draft ? "继续观察" : "开始观察";
  const playDisabled = isV27Mode ? "" : isLive || playback.isPlaying ? "disabled" : "";
  const acceptDisabled = isV27Mode ? "disabled" : draft && !showLivePerformance && !playback.isPlaying ? "" : "disabled";
  const tavernAgentFailures = Number(draft?.agentDecisionMeta?.failures?.length || 0);
  const tavernAgentFullyDegraded = fixedStage && draft && state.ui.engineMode === "openai" && Number(draft.agentDecisionMeta?.decisions || 0) === 0;
  const providerLabel = isV27Mode
    ? (v27Observation
      ? (v27Observation.externalModelCalled ? `v2.7 人物自决 · ${v27Observation.model || "远程人物模型"}` : "v2.7 人物自决 · 本地原子回合夹具")
      : "v2.7 人物自决 · 未运行")
    : tavernAgentFullyDegraded
    ? "远程人物未完成 · 已用规则降级"
    : fixedStage && tavernAgentFailures
      ? `DeepSeek V4 Flash · ${tavernAgentFailures}个人物已规则降级`
    : draft?.provider === "openai-realtime-simulation" || draft?.provider === "openai-pipeline"
    ? "DeepSeek V4 Flash 实际返回"
    : /fallback/.test(draft?.provider || "")
      ? "已回退规则预演"
      : state.ui.engineMode === "openai" ? "DeepSeek V4 Flash" : fixedStage ? "规则预演 · 无人物模型" : "本地沙盘";
  return `
    <section class="workspace-space reality-space observe-page ${fixedStage ? "ink-tavern-game-page" : ""}" data-observer-window="true" data-reality-space="true">
      <header class="reality-header">
        <div class="observe-title-block">
          <div class="space-kicker reality-tone">实时观察窗</div>
          <h1>${escapeHtml(state.town?.name || state.project.title)}</h1>
          <div class="observe-meta">
            <span>${escapeHtml(focusLabel)}</span>
            <span>${escapeHtml(timeGrainLabel(state.ui.timeGrain))}</span>
            <span>${escapeHtml(providerLabel)}</span>
          </div>
        </div>
        <div class="observe-actions">
          ${isV27Mode ? `<a class="btn ghost" href="/v27.html">真实人物观察页</a>` : ""}
          <button
            class="btn primary ${npcActivityRunning ? "npc-activity-active" : ""}"
            data-action="${isV27Mode ? "toggle-npc-activity" : "play"}"
            ${isV27Mode ? `data-npc-activity-control="true" aria-pressed="${npcActivityRunning ? "true" : "false"}"` : ""}
            ${playDisabled}
          >${playLabel}</button>
          <button class="btn good" data-action="accept-draft" ${acceptDisabled}>写入正史</button>
        </div>
      </header>

      ${isV27Mode && !(v27Observation?.externalModelCalled) ? `
      <p class="v27-fixture-note" role="note">
        本地原子回合夹具：只验证人物回合机制与世界结算边界，不产生真实的人物行为或台词质量。
        真实模型运行请到「真实人物观察页」，并按次授权。
      </p>` : ""}

      <div class="reality-controls" aria-label="观察设置">
        <div class="engine-switch" role="group" aria-label="模拟引擎">
          <button class="${isV27Mode ? "" : state.ui.engineMode !== "openai" ? "active" : ""}" data-action="ui-select-button" data-key="engineMode" data-value="local" data-engine-mode="local" title="只运行确定性经营规则，不调用本地语言模型">${fixedStage ? "规则预演" : "本地"}</button>
          <button class="${!isV27Mode && state.ui.engineMode === "openai" ? "active" : ""}" data-action="ui-select-button" data-key="engineMode" data-value="openai" data-engine-mode="openai" title="DeepSeek V4 Flash">V4 Flash</button>
          ${fixedStage ? `<button class="${isV27Mode ? "active" : ""}" data-action="ui-select-button" data-key="engineMode" data-value="v27" data-engine-mode="v27" title="v2.7：人物自行评估、选择并原子提交尝试，世界只结算动作是否发生、谁能看见">人物自决</button>` : ""}
        </div>
        ${isV27Mode ? `
          <div class="engine-switch npc-speed-switch" role="group" aria-label="推进速度">
            ${[["normal", "正常"], ["fast", "快速"]].map(([value, label]) => {
              const selected = (state.ui.npcActivitySpeed === "fast" ? "fast" : "normal") === value;
              return `<button class="${selected ? "active" : ""}" data-action="ui-select-button" data-key="npcActivitySpeed" data-value="${value}" aria-pressed="${selected}" title="${value === "fast" ? "缩短回合间的等待，人物仍依次完成活动" : "按正常节奏观察人物活动"}">${label}</button>`;
            }).join("")}
          </div>` : ""}
        <label><span>运行</span><select class="select" data-action="ui-select" data-key="timeGrain">
          ${[["day","一天"],["week","一周"],["scene","一场"],["beat","一拍"]].map(([value,label]) => `<option value="${value}" ${state.ui.timeGrain === value ? "selected" : ""}>${label}</option>`).join("")}
        </select></label>
        ${fixedStage ? `
          <div class="scope-summary" data-scope-summary="fixed-stage"><span>固定舞台</span><strong>${escapeHtml(focusLocation?.name || "望梯酒馆")}</strong></div>
          <div class="scope-summary tavern-life-summary" data-tavern-life-summary="true"><span>${escapeHtml(tavernDayLabel)}</span><strong>热饭 ${Number(stock.meals || 0)} · 茶 ${Number(stock.tea || 0)} · 柴 ${Number(stock.firewood || 0)}</strong></div>
          <div class="scope-summary" data-tavern-institution="true"><span>${escapeHtml(institution.householdName || "谢家")}经营</span><strong>${escapeHtml(`${ownerNames.join("、") || "谢恒"}东家 · ${operatorName || "谢母"}掌柜 · ${activeVisitCount}项来客事务`)}</strong></div>
          <div class="scope-summary" data-tavern-event-threads="true"><span>${openEventThreads.length}条未完事务</span><strong>${escapeHtml(latestThreadTopic)}</strong></div>
          <div class="scope-summary" data-tavern-relationship-progress="true"><span>本轮关系推进</span><strong>${relationshipProgressCount ? `${relationshipProgressCount}次公开回应已留下关系后果` : "尚无公开回应"}</strong></div>
        ` : `
          <label><span>视野</span><select class="select" data-action="ui-select" data-key="focusMode">
            ${[["ambient","全镇"],["location","聚焦地点"]].map(([value,label]) => `<option value="${value}" ${state.ui.focusMode === value ? "selected" : ""}>${label}</option>`).join("")}
          </select></label>
          ${state.ui.focusMode === "location" ? `
          <label><span>地点</span><select class="select" data-action="ui-select" data-key="selectedLocationId">
            ${state.locations.map((location) => `<option value="${location.id}" ${state.ui.selectedLocationId === location.id ? "selected" : ""}>${escapeHtml(location.name)}</option>`).join("")}
          </select></label>
          ` : `<div class="scope-summary" data-scope-summary="ambient"><span>地点</span><strong>全镇轮转</strong></div>`}
        `}
        <details class="scene-tools">
          <summary>${fixedStage ? "外界压力" : "场景设置"}</summary>
          <div class="scene-tools-popover">
            ${fixedStage ? "" : `<label class="toggle-row">
              <input type="checkbox" data-action="ui-checkbox" data-key="showObserverStage" ${state.ui?.showObserverStage ? "checked" : ""} />
              <span>显示俯视舞台</span>
            </label>`}
            <label class="field"><span>${fixedStage ? "让一项压力越过门槛" : "放入一个意外"}</span><textarea class="textarea compact" data-action="ui-input" data-key="injectedEvent" placeholder="${fixedStage ? "送来的米少了一升；细雨打湿新柴；剑阁钟声提前响起。" : "门外传来钥匙声。"}">${escapeHtml(state.ui.injectedEvent || "")}</textarea></label>
            <button class="btn small" data-action="inject-random-event">${fixedStage ? "换一项压力" : "随机意外"}</button>
          </div>
        </details>
      </div>

      ${state.ui.lastPlayError ? `<div class="play-error" role="alert"><strong>${isInterrupted
        ? "连接中断"
        : isModelError
          ? `DeepSeek ${modelStageLabel(livePerformance?.errorStage)}失败`
          : "DeepSeek 调用失败"}</strong><span>${escapeHtml(state.ui.lastPlayError)}</span></div>` : ""}

      <div class="observe-main ${fixedStage ? "ink-tavern-game-layout" : ""}">
        ${fixedStage ? `
          <section
            class="ink-tavern-stage ink-tavern-main-stage"
            data-ink-tavern-game-stage="true"
            data-stage-state="${inkTavernStageState}"
            data-npc-activity-state="${npcActivityRunning ? "running" : "stopped"}"
            data-world-version="${Number(v27Observation?.worldVersion || 0)}"
            aria-labelledby="ink-tavern-stage-title"
          >
            ${renderInkTavernStageMarkup(inkTavernObservation, {
              initialCharacters: inkTavernInitialCharacters,
              idleCaption: inkTavernIdleCaption,
              activityRunning: npcActivityRunning,
            })}
          </section>
        ` : state.ui?.showObserverStage ? renderObserverStage(state, draft, allEvents, playback) : ""}
        <div class="observer-window ${fixedStage ? "ink-tavern-game-ledger" : ""}" ${fixedStage ? 'data-v27-action-ledger="true"' : ""}>
          <div class="observer-window-head">
            <div class="live-cluster"><span class="live-dot"></span><span>${fixedStage ? "因果账本" : isLive ? "正在演出" : isInterrupted ? "现场已保留" : "正在发生"}</span></div>
            <div class="observer-clock">${escapeHtml(showLivePerformance ? livePerformance.label : playback.label)}</div>
          </div>
          ${isV27Mode ? "" : renderAgentParticipation(draft, state)}
          ${isV27Mode ? "" : renderCausalSceneTrace(draft, state)}
          ${!isV27Mode && showLivePerformance ? renderLiveCast(livePerformance, state) : ""}
          <div class="observer-stream" aria-live="polite" aria-label="现实时间线">
            ${isV27Mode
              ? renderV27Observation(state, v27Observation, v27Running)
              : showLivePerformance
              ? renderLiveInteractionStream(livePerformance, state)
              : events.length ? renderCompletedRealityTimeline(draft, state, events) : renderObserverEmpty(state)}
          </div>
        </div>
      </div>
    </section>
  `;
}

const V27_ACTION_LABELS = new Map([
  ["speak", "说话"],
  ["observe", "观察"],
  ["gesture", "动作"],
  ["move", "移动"],
  ["use_affordance", "使用"],
  ["take_out", "取出"],
  ["act", "行动"],
  ["leave", "离开"],
  ["rest", "休息"],
  ["practice", "练习"],
  ["pass", "不出手"],
  ["none", "不出手"],
]);

function v27ActionLabel(actionType = "") {
  return V27_ACTION_LABELS.get(actionType) || actionType || "未声明";
}

// The v2.7 surface deliberately reports less than the legacy timeline.  It shows
// what the character committed and what the world settled, and it does not
// narrate the gap between them: filling that gap is exactly the scene authority
// this runtime exists to remove.
function renderV27Turn(turn, state) {
  const character = state.characters.find((item) => item.id === turn.characterId) || null;
  const target = turn.targetCharacterId
    ? state.characters.find((item) => item.id === turn.targetCharacterId) || null
    : null;
  const silent = !turn.speech && !turn.visibleAction;
  const legacyFiveStageCompleted = turn.fiveStageCompleted === true
    || turn.fiveStageAgentCompleted === true;
  const submissionMode = turn.submissionMode || (legacyFiveStageCompleted ? "staged" : "");
  const maintenance = privateV27MaintenancePresentation({ ...turn, submissionMode });
  const completed = turn.characterAgentCompleted === true
    || (submissionMode === "staged" && legacyFiveStageCompleted);
  const completionLabel = maintenance?.completionLabel || (completed
    ? submissionMode === "atomic"
      ? "原子人物回合完成"
      : submissionMode === "staged"
        ? "五阶段人物回合完成"
        : "人物回合完成"
    : "人物回合未完整");
  const outcome = maintenance?.outcome || turn.outcome;
  return `
    <article class="v27-turn" data-v27-turn="${escapeHtml(turn.agentTurnId)}" data-outcome="${escapeHtml(outcome.status)}">
      <header class="v27-turn-head">
        <span class="v27-turn-index">${turn.index}</span>
        <strong class="v27-turn-actor">${escapeHtml(character?.name || turn.characterName || "未知人物")}</strong>
        <span class="v27-turn-action">${escapeHtml(maintenance?.actionLabel || v27ActionLabel(turn.actionType))}${!maintenance && target ? ` · 对 ${escapeHtml(target.name)}` : ""}</span>
        <span class="v27-turn-protocol">${completionLabel}${turn.protocolRepairCount ? ` · 含 ${turn.protocolRepairCount} 次协议自主修正` : ""}</span>
      </header>
      ${!maintenance && turn.speech ? `<p class="v27-turn-speech">“${escapeHtml(turn.speech)}”</p>` : ""}
      ${!maintenance && turn.visibleAction ? `<p class="v27-turn-visible">${escapeHtml(turn.visibleAction)}</p>` : ""}
      ${maintenance
        ? `<p class="v27-turn-silent">${escapeHtml(maintenance.description)}</p>`
        : silent ? `<p class="v27-turn-silent">这一回合没有对外发生可见动作或台词。</p>` : ""}
      ${!maintenance && turn.affectiveTexture.length ? `<p class="v27-turn-texture">${escapeHtml(turn.affectiveTexture.join("；"))}</p>` : ""}
      <footer class="v27-turn-outcome">
        <span class="v27-outcome-label">${escapeHtml(outcome.label)}</span>
        <span class="v27-outcome-detail">${escapeHtml(outcome.detail)}</span>
      </footer>
    </article>
  `;
}

function renderV27Observation(state, observation, running) {
  if (running) {
    return `
      <div class="observer-empty">
        <div class="observer-empty-title">人物正在完成自己的原子回合</div>
        <div class="observer-empty-text">世界要等人物提交尝试之后才结算。</div>
      </div>
    `;
  }
  if (!observation) {
    return `
      <div class="observer-empty">
        <div class="observer-empty-title">望梯酒馆静止在第一秒</div>
        <div class="observer-empty-text">人物自行评估、生成候选并选择调节，再把行动与表达作为一个整体提交；世界只结算动作是否发生、谁能听见或看见，再把结果送回真正受影响的人。按下运行人物回合。</div>
      </div>
    `;
  }
  if (!observation.turns.length) {
    return `
      <div class="observer-empty">
        <div class="observer-empty-title">没有人物被唤醒</div>
        <div class="observer-empty-text">当前世界状态下没有足够的机会窗口让任何人物开始一个回合。</div>
      </div>
    `;
  }
  const settled = observation.turns.filter((turn) => turn.outcome.status === "settled").length;
  const budget = observation.providerRequestBudget;
  return `
    <div class="v27-observation">
      <div class="v27-observation-meta">
        <span>${observation.turns.length} 个人物回合 · ${settled} 次被世界接住</span>
        <span>世界版本 ${observation.worldVersion} · ${observation.eventCount} 条世界事件</span>
        ${observation.externalModelCalled
          ? `<span>真实模型调用 ${budget ? `${budget.usedProviderRequests}/${budget.maxProviderRequests}` : "已发生"}</span>`
          : `<span>未调用外部模型</span>`}
      </div>
      ${observation.explanation
        ? `<p class="v27-observation-note">${escapeHtml(observation.explanation)}</p>`
        : observation.authorQualityVerdict === "not_claimed"
          ? `<p class="v27-observation-note">本地夹具只验证协议、结算与传播，不构成对台词与人物质量的结论。</p>`
          : ""}
      ${observation.turns.map((turn) => renderV27Turn(turn, state)).join("")}
    </div>
  `;
}

function modelStageLabel(stage = "") {
  return {
    private_simulators: "人物代理阶段",
    visibility_layer: "可见性阶段",
    scene_interaction: "场景互动阶段",
    novel_streamer: "正文阶段",
    dialogue_psychology: "心理阶段",
    depth_auditor: "审查阶段",
    repair_pass: "修复阶段",
  }[stage] || "模型阶段";
}

function liveAgentStatusLabel(status = "waiting") {
  return {
    waiting: "等待",
    preparing: "准备",
    ready: "就位",
    present: "在场",
    acting: "行动",
    responding: "回应",
    speaking: "说话",
    observing: "注视",
    failed: "中断",
  }[status] || "在场";
}

function characterForIdentity(state = {}, id = "", name = "") {
  return (state.characters || []).find((character) => character.id === id)
    || (state.characters || []).find((character) => character.name === name)
    || null;
}

function namesForParticipation(state = {}, ids = [], names = []) {
  return [...new Set((ids || []).map((id, index) => (
    names?.[index]
    || state.characters?.find((character) => character.id === id)?.name
    || id
  )).filter(Boolean))];
}

function renderAgentParticipation(draft, state = {}) {
  if (!draft) return "";
  const traces = (draft.agentParticipation || draft.periodSimulation?.ticks?.map((tick) => tick.agentParticipation) || [])
    .filter((trace) => trace?.slotId || trace?.slotLabel);
  if (!traces.length) return "";
  const allAgentNames = [...new Set(traces.flatMap((trace) => [
    ...namesForParticipation(state, trace.activatedAgentIds, trace.activatedAgentNames),
    ...namesForParticipation(state, trace.followupAgentIds, trace.followupAgentNames),
  ]))];
  const allRuleNames = [...new Set(traces.flatMap((trace) => namesForParticipation(state, trace.ruleOnlyCharacterIds, trace.ruleOnlyCharacterNames)))];
  const witnessCount = traces.filter((trace) => trace.witness?.ran).length;
  const agentSummary = allAgentNames.length <= 5
    ? allAgentNames.join("、") || "无"
    : `${allAgentNames.slice(0, 5).join("、")}等${allAgentNames.length}人`;
  return `
    <details class="agent-participation" data-agent-participation="true">
      <summary>
        <span>本轮 Agent 参与</span>
        <strong>人物 Agent：${escapeHtml(agentSummary)} · 规则同行 ${allRuleNames.length}人 · 场景整理 ${witnessCount}时段</strong>
      </summary>
      <div class="agent-participation-list">
        ${traces.map((trace) => {
          const agents = namesForParticipation(state, trace.activatedAgentIds, trace.activatedAgentNames);
          const followups = namesForParticipation(state, trace.followupAgentIds, trace.followupAgentNames);
          const ruleOnly = namesForParticipation(state, trace.ruleOnlyCharacterIds, trace.ruleOnlyCharacterNames);
          const failed = namesForParticipation(state, trace.failedAgentIds, trace.failedAgentNames);
          const witness = trace.witness?.ran
            ? trace.witness.degraded ? "场景整理：规则回退" : "场景整理：Activity Witness"
            : "场景整理：未调用";
          return `
            <div class="agent-participation-row" data-agent-participation-slot="${escapeHtml(trace.slotId || trace.slotLabel || "")}">
              <time>${escapeHtml(trace.slotLabel || trace.slotId || "时段")}</time>
              <span><b>人物 Agent</b>${escapeHtml(agents.join("、") || "无")}</span>
              ${followups.length ? `<span><b>同场即时回应</b>${escapeHtml(followups.join("、"))}</span>` : ""}
              <span><b>规则行动</b>${escapeHtml(ruleOnly.join("、") || "无")}</span>
              <span class="${failed.length || trace.witness?.degraded ? "participation-degraded" : ""}">${escapeHtml(failed.length ? `失败：${failed.join("、")} · ${witness}` : witness)}</span>
            </div>
          `;
        }).join("")}
      </div>
    </details>
  `;
}

function renderCausalSceneTrace(draft, state = {}) {
  const scene = draft?.causalScene;
  if (!scene?.actions?.length && !scene?.activations?.length) return "";
  const actions = scene.actions || [];
  const impacts = new Map((scene.impacts || []).map((impact) => [impact.id, impact]));
  const deliveries = scene.deliveries || [];
  const activations = scene.activations || [];
  const observerByAction = buildObserverPsychologyMap(draft);
  const zoneLabels = { threshold: "门槛", hall: "堂前", counter: "柜台", stove: "灶边", courtyard: "后院", stairs: "楼梯口", guest_room: "楼上客房" };
  const characterName = (id = "") => state.characters?.find((character) => character.id === id)?.name || id;
  const stopLabel = scene.stopReason === "quiescent" ? "自然静止" : scene.stopReason === "all-passed" ? "众人不再行动" : scene.stopReason === "max-steps" ? "达到安全步数" : scene.stopReason === "period-complete" ? "整段完成" : "场景停止";
  return `
    <details class="causal-scene-trace" data-causal-scene-trace="true">
      <summary>
        <span>场景因果链</span>
        <strong>${actions.length}次人物行动 · ${deliveries.length}次影响抵达 · ${Number(scene.elapsedSeconds || 0)}秒后${escapeHtml(stopLabel)}</strong>
      </summary>
      <div class="causal-scene-list">
        ${actions.map((action) => {
          const actorCharacter = characterForIdentity(state, action.actorId, action.actorName);
          const observerPsychology = observerByAction.get(action.id) || null;
          const actionImpactIds = new Set((action.impactFactors || []).map((impact) => impact.id));
          const reachedByCharacter = new Map();
          for (const delivery of deliveries.filter((item) => actionImpactIds.has(item.impactId))) {
            const current = reachedByCharacter.get(delivery.recipientId) || { name: characterName(delivery.recipientId), directed: false };
            current.directed = current.directed || Boolean(delivery.directed);
            reachedByCharacter.set(delivery.recipientId, current);
          }
          const reached = [...reachedByCharacter.values()].map((item) => `${item.name}${item.directed ? "（直接）" : "（感知）"}`);
          const next = activations.find((activation) => actionImpactIds.has(activation.sourceImpactId));
          const parent = impacts.get(action.causalParentImpactId);
          const cause = parent
            ? `${parent.modality === "sound" ? "听见" : parent.modality === "visual" ? "看见" : "受到"}“${parent.content}”`
            : "自身需要或职责达到行动阈值";
          const affectiveTexture = causalAffectiveTextureForUi(action);
          const expression = action.speech
            ? `${action.visibleAction ? `${causalSentenceForUi(action.visibleAction)} ` : ""}“${action.speech}”`
            : action.visibleAction || "改变了所在位置";
          const expressionWithTexture = [expression, affectiveTexture].filter(Boolean).join(" ");
          return `
            <div class="causal-scene-row" data-causal-action-id="${escapeHtml(action.id || "")}">
              <time>${action.slotLabel ? `${escapeHtml(action.slotLabel)} · ` : ""}${Math.max(0, Number(action.startedAtSeconds || 0))}–${Math.max(0, Number(action.endedAtSeconds || 0))}秒</time>
              <div class="causal-action-main">
                ${actorCharacter ? agentMindTriggerMarkup(actorCharacter, observerPsychology, "small") : ""}
                <div><b>${escapeHtml(action.actorName || characterName(action.actorId))}</b><span>${escapeHtml(zoneLabels[action.actorZoneId] || action.actorZoneId || "酒馆内")}</span><p>${escapeHtml(expressionWithTexture)}</p></div>
              </div>
              <div class="causal-link"><span>缘由</span><p>${escapeHtml(cause)}</p></div>
              <div class="causal-link"><span>传到</span><p>${escapeHtml(reached.join("、") || "没有抵达别人")}${next ? `；下一位：${escapeHtml(next.characterName || characterName(next.characterId))}` : ""}</p></div>
              ${action.materialConsequence ? `<div class="causal-link"><span>经营后果</span><p>${escapeHtml(action.materialConsequence)}</p></div>` : ""}
            </div>
          `;
        }).join("")}
      </div>
    </details>
  `;
}

function causalSentenceForUi(value = "") {
  const line = String(value || "").trim();
  return !line || /[。！？…]$/.test(line) ? line : `${line}。`;
}

function causalAffectiveTextureForUi(action = {}) {
  return [...new Set((Array.isArray(action.observableAffectiveTexture) ? action.observableAffectiveTexture : [])
    .map((row) => String(row?.feature || "").replace(/\s+/g, " ").trim())
    .filter(Boolean))]
    .join("；");
}

function dialogueSourceMarkup(entry = {}) {
  if (!isDirectResponseEntry(entry)) return "";
  const slotLabels = { dawn: "清晨", noon: "正午", afternoon: "午后", dusk: "黄昏", night: "夜深" };
  const sourceSlot = slotLabels[entry.responseSourceSlotLabel] || entry.responseSourceSlotLabel || "";
  const slot = sourceSlot ? `${sourceSlot} · ` : "";
  if (entry.responseTopic) {
    return `<div class="dialogue-source" data-dialogue-source="${escapeHtml(entry.respondsTo)}">接着 ${escapeHtml(slot)}「${escapeHtml(entry.responseTopic)}」</div>`;
  }
  if (entry.responseSourceLine) {
    return `<div class="dialogue-source" data-dialogue-source="${escapeHtml(entry.respondsTo)}">承接 ${escapeHtml(slot)}“${escapeHtml(entry.responseSourceLine)}”</div>`;
  }
  return `<div class="dialogue-source missing" data-dialogue-source="${escapeHtml(entry.respondsTo)}">回应来源未记录（旧草稿）</div>`;
}

function isDirectResponseEntry(entry = {}) {
  if (!entry.respondsTo) return false;
  if (entry.responseSourceSpeakerId && entry.targetId && entry.responseSourceSpeakerId !== entry.targetId) return false;
  return true;
}

function renderLiveCast(livePerformance = {}, state = {}) {
  const agents = (livePerformance.agents || [])
    .map((agent) => ({ agent, character: characterForIdentity(state, agent.characterId, agent.characterName) }))
    .filter((item) => item.character);
  if (!agents.length) return "";
  return `
    <div class="live-performance" data-live-performance="true">
      <div class="live-cast" aria-label="人物实时状态">
        ${agents.map(({ agent, character }) => `
          <div class="live-agent" data-live-agent="${escapeHtml(agent.characterId || character.id)}" data-status="${escapeHtml(agent.status || "waiting")}">
            ${pixelPortraitMarkup(character, "tiny")}
            <span class="live-agent-name">${escapeHtml(character.name)}</span>
            <span class="live-agent-state">${escapeHtml(liveAgentStatusLabel(agent.status))}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderLiveInteractionStream(livePerformance = {}, state = {}) {
  const thoughts = buildSpeakerThoughtMap(Object.values(livePerformance.psychologyByCharacter || {}));
  const novelText = String(livePerformance.novelText || "");
  if (novelText || livePerformance.phase === "writing") {
    const actions = (livePerformance.events || []).filter((event) => event.type === "action");
    const turns = (livePerformance.events || []).filter((event) => event.type === "dialogue").map((event) => ({
      speakerId: event.speakerId || "",
      speakerName: event.speakerName || "",
      targetId: event.targetId || "",
      targetName: event.targetName || "",
      line: event.line || "",
      turnRole: event.turnRole || "turn",
      respondsTo: event.respondsTo || "",
      responseSourceLine: event.responseSourceLine || "",
      responseSourceSpeakerId: event.responseSourceSpeakerId || "",
      responseSourceSlotId: event.responseSourceSlotId || "",
      responseSourceSlotLabel: event.responseSourceSlotLabel || "",
      responseThreadId: event.responseThreadId || "",
      responseTopic: event.responseTopic || "",
      actionId: event.id || "",
      observerPsychology: event.observerPsychology || null,
    }));
    return renderRealityTimeline(buildManuscriptTimelineEntries(novelText, turns, {}, actions), state, { live: true, caret: true, thoughts });
  }
  const events = livePerformance.events || [];
  if (!events.length) {
    const locationName = livePerformance.locationName
      || state.locations.find((location) => location.id === state.ui?.selectedLocationId)?.name
      || state.town?.name
      || "场中";
    return `
      <div class="live-stage-silence" data-live-performance="true">
        <span class="live-writing-mark" aria-hidden="true"></span>
        <p>${escapeHtml(locationName)}里，尚无人先开口。</p>
      </div>
    `;
  }
  return renderRealityTimeline(buildLiveEventTimelineEntries(events), state, { live: true, thoughts });
}

function agentMindTriggerMarkup(character, psychology = null, size = "medium") {
  const isAgentDecision = psychology?.visibility === "observer-only" && Boolean(psychology?.formulaReason || psychology?.privateReason || psychology?.selectedIntent);
  const formulaReason = isAgentDecision
    ? psychology.formulaReason || `人物参考自己的心理权衡，选择了“${psychology.selectedIntent?.label || "这次行动"}”。`
    : psychology?.thought || "";
  const privateThought = isAgentDecision ? psychology.privateReason || "" : psychology?.thought || "";
  if (!formulaReason && !privateThought) return pixelPortraitMarkup(character, size);
  const owner = character.id || character.name || "";
  const desire = isAgentDecision ? psychology.desire || psychology.currentIntention || "" : "";
  const trigger = isAgentDecision
    ? psychology.trigger?.content || "自身需要、职责或未完承诺达到行动阈值。"
    : psychology.heardLine ? `听见“${psychology.heardLine}”之后` : "这一刻没有说出口";
  const actionId = isAgentDecision ? psychology.actionId || "" : "";
  const sourceLabel = isAgentDecision ? "真实 Agent 决策" : "角色心理推演";
  const factorTrace = isAgentDecision ? psychology.factorTrace || null : null;
  const selectedCandidateId = factorTrace?.selectedCandidateId || psychology.selectedIntent?.selectedCandidateId || "";
  const selectedCandidate = factorTrace?.candidates?.find((candidate) => candidate.candidateId === selectedCandidateId)
    || factorTrace?.candidates?.[0]
    || null;
  const positiveFactors = (selectedCandidate?.positiveFactors || []).map((factor) => `${factor.label} +${Math.round(factor.contribution || 0)}`).join(" · ");
  const negativeFactors = (selectedCandidate?.negativeFactors || []).map((factor) => `${factor.label} −${Math.round(factor.contribution || 0)}`).join(" · ");
  const alternatives = (factorTrace?.candidates || []).filter((candidate) => candidate.candidateId !== selectedCandidate?.candidateId)
    .slice(0, 3)
    .map((candidate) => `${candidate.label} ${Math.round(candidate.activationScore || 0)}${candidate.feasible ? "" : "（受阻）"}`)
    .join(" / ");
  const copingLabels = { approach: "靠近并处理", avoid: "回避或拉开距离", assert: "坚定设限", inhibit: "克制表达", repair: "修复关系" };
  const coping = isAgentDecision && psychology.copingBias?.dominant
    ? copingLabels[psychology.copingBias.dominant] || psychology.copingBias.dominant
    : "";
  const repairNeed = isAgentDecision && Number(psychology.copingBias?.repairNeed || 0) > 0
    ? `修复需要 ${Math.round(Number(psychology.copingBias.repairNeed) * 100)}%`
    : "";
  const strategyLabels = {
    "direct-engagement": "直接接触",
    "brief-deferral": "简短延期",
    "firm-boundary": "明确设限",
    "minimal-response": "最少回应",
    "relationship-repair": "先修复关系",
    "quiet-withdrawal": "安静退开",
    "silent-focus": "沉默专注",
  };
  const expression = isAgentDecision && psychology.expressionStrategy?.mode
    ? strategyLabels[psychology.expressionStrategy.mode] || psychology.expressionStrategy.mode
    : "";
  const relationship = psychology.relationshipAppraisal?.toCharacterId
    ? `亲近 ${Math.round(psychology.relationshipAppraisal.closeness || 0)} · 戒备 ${Math.round(psychology.relationshipAppraisal.tension || 0)} · 信任 ${Math.round(psychology.relationshipAppraisal.trust || 0)}`
    : "";
  const affectBefore = psychology.eventAppraisal?.affect?.before || null;
  const affectAfter = psychology.eventAppraisal?.affect?.after || null;
  const affectChange = affectBefore && affectAfter
    ? `愉快感 ${Number(affectBefore.valence || 0).toFixed(2)}→${Number(affectAfter.valence || 0).toFixed(2)} · 激动 ${Number(affectBefore.arousal || 0).toFixed(2)}→${Number(affectAfter.arousal || 0).toFixed(2)} · 掌控感 ${Number(affectBefore.dominance || 0).toFixed(2)}→${Number(affectAfter.dominance || 0).toFixed(2)}`
    : "";
  const sensitivity = (psychology.eventAppraisal?.sensitivities || [])
    .map((item) => `${item.threatMeaning || item.sensitivityId} ${Math.round(Number(item.after || 0) * 100)}%`)
    .join(" · ");
  const memoryBasis = psychology.memoryBasis || null;
  const sourceKindLabels = { firsthand: "亲眼/亲耳", self_action: "自己刚做过", gossip: "转述", overheard: "旁听", legacy_summary: "旧摘要" };
  const memoryRoleLabels = {
    requester: "提出请求的人",
    requestedActor: "被请求采取行动的人",
    beneficiary: "这件事的受益人",
    ultimateRecipient: "最终接收结果的人",
    addressee: "被说话的人",
    speaker: "说话的人",
    observer: "旁观者",
  };
  const rememberedEvidence = (memoryBasis?.episodes || []).map((episode) => {
    const sourceKind = sourceKindLabels[episode.sourceKind] || episode.sourceKind || "记忆";
    return `${episode.topic || episode.content || "一件事"}（${sourceKind}，可信 ${Math.round(Number(episode.sourceConfidence || 0) * 100)}%，此刻可想起 ${Math.round(Number(episode.accessibility || 0) * 100)}%）`;
  }).join("；");
  const rememberedCommitments = (memoryBasis?.commitments || []).map((commitment) => (
    `${commitment.requestedAct || "一项未完请求"}（自己是${memoryRoleLabels[commitment.ownerRole] || commitment.ownerRole || "当事人"}，状态：${commitment.status || "未完"}）`
  )).join("；");
  const memoryPressure = memoryBasis?.influence
    ? `${memoryBasis.influence.explanation || "相关记忆参与了这次取舍"} · 相关度 ${Math.round(Number(memoryBasis.influence.total || 0) * 100)}%${Number(memoryBasis.influence.scoreDelta || 0) > 0 ? ` · 候选压力 +${Number(memoryBasis.influence.scoreDelta || 0).toFixed(1)}` : ""}`
    : "";
  return `
    <button class="speaker-thought-trigger agent-mind-trigger" type="button" aria-label="${escapeHtml(`查看${character.name}这次行为的心理动机：${formulaReason || privateThought}`)}" aria-expanded="false" data-agent-mind-trigger="true" data-agent-id="${escapeHtml(owner)}" data-agent-action-id="${escapeHtml(actionId)}" data-thought-owner="${escapeHtml(owner)}">
      ${pixelPortraitMarkup(character, size)}
      <span class="agent-mind-badge" aria-hidden="true">心</span>
      <template data-agent-mind-template>
        <article class="agent-mind-card ${isAgentDecision ? "is-agent-decision" : "is-legacy-thought"}" role="tooltip" data-agent-mind-card="true">
          <header><span>${escapeHtml(sourceLabel)}</span><strong>${escapeHtml(character.name || "人物")}</strong></header>
          ${desire ? `<div class="agent-mind-row"><small>此刻想要</small><p>${escapeHtml(desire)}</p></div>` : ""}
          <div class="agent-mind-row"><small>${isAgentDecision ? "实际触发" : "发生在"}</small><p>${escapeHtml(trigger)}</p></div>
          ${selectedCandidate ? `<div class="agent-mind-row agent-mind-score"><small>人物选中的行动 · 心理压力 ${Math.round(selectedCandidate.activationScore || 0)} 分</small><p>${escapeHtml(selectedCandidate.label)}</p></div>` : ""}
          ${relationship ? `<div class="agent-mind-row"><small>本人对对方的关系</small><p>${escapeHtml(relationship)}</p></div>` : ""}
          ${affectChange ? `<div class="agent-mind-row"><small>这件事造成的心理变化</small><p>${escapeHtml(affectChange)}</p></div>` : ""}
          ${sensitivity ? `<div class="agent-mind-row"><small>被触发的敏感点</small><p>${escapeHtml(sensitivity)}</p></div>` : ""}
          ${rememberedEvidence ? `<div class="agent-mind-row agent-mind-memory"><small>这次实际想起的记忆</small><p>${escapeHtml(rememberedEvidence)}</p></div>` : ""}
          ${rememberedCommitments ? `<div class="agent-mind-row agent-mind-memory"><small>记忆中的未完承诺</small><p>${escapeHtml(rememberedCommitments)}</p></div>` : ""}
          ${memoryPressure ? `<div class="agent-mind-row agent-mind-memory"><small>记忆如何影响选择</small><p>${escapeHtml(memoryPressure)}</p></div>` : ""}
          ${coping || expression || repairNeed ? `<div class="agent-mind-row"><small>应对与表达</small><p>${escapeHtml([coping, expression, repairNeed].filter(Boolean).join(" · "))}</p></div>` : ""}
          ${positiveFactors ? `<div class="agent-mind-row agent-mind-factors"><small>推动因子</small><p>${escapeHtml(positiveFactors)}</p></div>` : ""}
          ${negativeFactors ? `<div class="agent-mind-row agent-mind-factors"><small>阻碍因子</small><p>${escapeHtml(negativeFactors)}</p></div>` : ""}
          ${alternatives ? `<div class="agent-mind-row agent-mind-alternatives"><small>没有选中的近邻行动</small><p>${escapeHtml(alternatives)}</p></div>` : ""}
          ${formulaReason ? `<div class="agent-mind-reason"><small>${isAgentDecision ? "真实取舍" : "没有说出口"}</small><p>${escapeHtml(formulaReason)}</p></div>` : ""}
          ${isAgentDecision && privateThought ? `<div class="agent-mind-row"><small>人物没有说出口的一念</small><p>${escapeHtml(privateThought)}</p></div>` : ""}
          <footer>${isAgentDecision ? "仅观察者可见 · 不进入场中事实" : "仅观察者可见 · 旧草稿心理推演"}</footer>
        </article>
      </template>
    </button>
  `;
}

function speakerThoughtMarkup(character, thought = null, observerPsychology = null) {
  return agentMindTriggerMarkup(character, observerPsychology || thought, "medium");
}

function renderRealityTimeline(entries = [], state = {}, { live = false, caret = false, thoughts = new Map() } = {}) {
  const stagedEntries = assignDialogueSides(entries);
  return `
    <section class="reality-timeline dialogue-stage ${live ? "is-live" : ""}" data-reality-timeline="true" ${live ? 'data-live-reality-timeline="true" data-live-performance="true"' : ""}>
      <div class="reality-axis" data-reality-axis="true" aria-hidden="true"></div>
      ${stagedEntries.map((entry, index) => {
        if (entry.type === "dialogue") {
          const character = characterForIdentity(state, entry.speakerId, entry.speakerName);
          if (!character) {
            return `
              <article class="reality-timeline-entry narration observer-prose-line ${escapeHtml(entry.tone || "focus")}" data-observer-prose="true" style="--i:${index}">
                <div class="timeline-marker"><span class="timeline-dot"></span></div>
                <div class="timeline-copy"><p class="observer-prose-text">“${escapeHtml(entry.text || "")}”</p></div>
              </article>
            `;
          }
          const thought = speakerThoughtForEntry(thoughts, entry);
          return `
            <article class="reality-timeline-entry dialogue side-${escapeHtml(entry.side || "left")}" data-speaker-id="${escapeHtml(entry.speakerId || character.id || "")}" data-dialogue-side="${escapeHtml(entry.side || "left")}" style="--i:${index}">
              <div class="timeline-marker speaker-marker">${speakerThoughtMarkup(character, thought, entry.observerPsychology)}</div>
              <div class="timeline-copy">
                <div class="timeline-speaker"><strong>${escapeHtml(entry.speakerName || character.name || "人物")}</strong>${entry.targetName ? `<span>${isDirectResponseEntry(entry) ? "回答" : "对"}${escapeHtml(entry.targetName)}${isDirectResponseEntry(entry) ? "" : "说"}</span>` : ""}</div>
                ${dialogueSourceMarkup(entry)}
                <p>“${escapeHtml(entry.text || "")}”</p>
              </div>
            </article>
          `;
        }
        const behaviorCharacter = entry.actorId ? characterForIdentity(state, entry.actorId, entry.actorName) : null;
        return `
          <article class="reality-timeline-entry narration observer-prose-line ${escapeHtml(entry.tone || "focus")}" data-observer-prose="true" style="--i:${index}">
            <div class="timeline-marker ${behaviorCharacter && entry.observerPsychology ? "speaker-marker behavior-marker" : ""}">${behaviorCharacter && entry.observerPsychology ? agentMindTriggerMarkup(behaviorCharacter, entry.observerPsychology, "small") : '<span class="timeline-dot"></span>'}</div>
            <div class="timeline-copy">
              ${entry.actorName ? `<div class="timeline-speaker"><strong>${escapeHtml(entry.actorName)}</strong>${entry.targetName ? `<span>朝向${escapeHtml(entry.targetName)}</span>` : ""}</div>` : ""}
              <p class="observer-prose-text">${escapeHtml(entry.text || "")}</p>
            </div>
          </article>
        `;
      }).join("")}
      ${caret ? '<span class="manuscript-caret timeline-caret" aria-hidden="true"></span>' : ""}
    </section>
  `;
}

function renderNewsTimeline(briefs = [], state = {}) {
  return `
    <section class="reality-timeline news-timeline" data-reality-timeline="true" data-local-news-timeline="true">
      <div class="reality-axis" data-reality-axis="true" aria-hidden="true"></div>
      ${briefs.map((brief, index) => `
        <article class="reality-news-brief" data-news-brief="true" data-observer-prose="true" style="--i:${index}">
          <div class="timeline-marker news-marker"><span>${escapeHtml(brief.slotLabel.slice(0, 1) || "时")}</span></div>
          <div class="news-copy">
            <div class="news-dateline"><time>${escapeHtml(brief.slotLabel)}</time><span>${escapeHtml(brief.locationName)}</span></div>
            <p class="news-occurrence">${escapeHtml(brief.occurrence)}。</p>
            <p class="news-action" data-news-action="true">${escapeHtml(brief.action || "现场人物改变了原先的站位。")}</p>
            <div class="news-dialogue" data-news-dialogue="true">
              ${brief.dialogue.map((turn) => {
                const character = characterForIdentity(state, turn.speakerId, turn.speakerName);
                if (!character) return "";
                return `<div class="news-quote" data-speaker-id="${escapeHtml(turn.speakerId || character.id || "")}">${turn.observerPsychology ? agentMindTriggerMarkup(character, turn.observerPsychology, "tiny") : pixelPortraitMarkup(character, "tiny")}<p><strong>${escapeHtml(turn.speakerName || character.name)}</strong>${turn.targetName ? `<span>对${escapeHtml(turn.targetName)}</span>` : ""}：“${escapeHtml(turn.line)}”</p></div>`;
              }).join("")}
            </div>
            <p class="news-consequence" data-news-consequence="true">${escapeHtml(brief.consequence || "这件事留下了尚未处理的后果。")}</p>
          </div>
        </article>
      `).join("")}
    </section>
  `;
}

function renderCompletedRealityTimeline(draft, state, events = []) {
  const ticks = draft?.periodSimulation?.ticks || [];
  const newsReady = !String(draft?.novelText || "").trim()
    && ticks.length
    && ticks.slice(0, events.length).every((tick) => (tick.sceneInteraction?.agentExchanges || []).some((exchange) => (exchange.dialogueTurns || []).length));
  if (newsReady) return renderNewsTimeline(buildLocalNewsBriefs(draft, state, events.length), state);
  const manuscript = String(draft?.novelText || "").trim();
  if (manuscript) {
    const visibleText = events.map((event) => event.text).filter(Boolean).join("\n\n");
    const thoughts = buildSpeakerThoughtMap(draft.dialoguePsychology || [], draft.privateSimulations || []);
    const observerByAction = buildObserverPsychologyMap(draft);
    const actions = (draft.causalScene?.actions || []).filter((action) => action.visibleAction || action.observableAffectiveTexture?.length).map((action) => ({
      id: action.id || "",
      actorId: action.actorId || "",
      actorName: action.actorName || "",
      targetId: action.targetCharacterId || "",
      targetName: action.targetCharacterName || "",
      text: [action.visibleAction || "", causalAffectiveTextureForUi(action)].filter(Boolean).join("；"),
      observerPsychology: observerByAction.get(action.id) || null,
    }));
    return renderRealityTimeline(buildManuscriptTimelineEntries(visibleText, collectDraftDialogueTurns(draft), {}, actions), state, { thoughts });
  }
  return `<section class="reality-timeline legacy-timeline" data-reality-timeline="true"><div class="reality-axis" data-reality-axis="true" aria-hidden="true"></div>${events.map(renderObserverLine).join("")}</section>`;
}

function renderLiveManuscript(text = "") {
  const paragraphs = String(text || "").split(/\n\s*\n/).filter((paragraph) => paragraph.trim());
  return `
    <article class="live-manuscript" data-live-performance="true" data-live-manuscript="true">
      ${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph.trim()).replace(/\n/g, "<br>")}</p>`).join("")}
      <span class="manuscript-caret" aria-hidden="true"></span>
    </article>
  `;
}

function renderLiveInteractionEvent(event = {}) {
  if (event.type === "dialogue") {
    return `
      <article class="live-turn dialogue" data-live-event="dialogue">
        <div class="live-turn-meta">
          <strong>${escapeHtml(event.speakerName || "人物")}</strong>
          <span>${event.targetName ? `${isDirectResponseEntry(event) ? "回答" : "对"}${escapeHtml(event.targetName)}${isDirectResponseEntry(event) ? "" : "说"}` : "开口"}</span>
        </div>
        ${dialogueSourceMarkup({ ...event, text: event.line })}
        <p>“${escapeHtml(String(event.line || "").replace(/[“”]/g, ""))}”</p>
      </article>
    `;
  }
  if (event.type === "exchange_outcome") {
    return `
      <article class="live-turn outcome" data-live-event="exchange_outcome">
        <div class="live-turn-meta">
          <strong>结果</strong>
          ${event.sharedObject ? `<span>${escapeHtml(event.sharedObject)}</span>` : ""}
        </div>
        <p>${escapeHtml(event.text || "")}</p>
      </article>
    `;
  }
  return `
    <article class="live-turn action" data-live-event="action">
      <div class="live-turn-meta">
        <strong>${escapeHtml(event.actorName || "人物")}</strong>
        ${event.targetName ? `<span>朝向${escapeHtml(event.targetName)}</span>` : ""}
      </div>
      <p>${escapeHtml(event.text || "")}</p>
    </article>
  `;
}

function getObservationPlayback(state, draft, totalCount) {
  if (!draft) {
    return { visibleCount: 0, totalCount: 0, status: "idle", isPlaying: false, label: "等待第一轮" };
  }
  const playback = state.ui?.observerPlayback;
  if (!playback || playback.draftId !== draft.id) {
    return {
      visibleCount: totalCount,
      totalCount,
      status: "complete",
      isPlaying: false,
      label: formatDraftTime(draft.createdAt),
    };
  }
  const total = Math.max(0, Number(playback.totalCount || totalCount || 0));
  const visible = Math.max(0, Math.min(total, Number(playback.visibleCount || 0)));
  const isPlaying = playback.status === "playing" && visible < total;
  const status = isPlaying ? "playing" : "complete";
  return {
    visibleCount: visible,
    totalCount: total,
    status,
    isPlaying,
    label: `${isPlaying ? "正在观察" : "已观察"} ${visible}/${total}`,
  };
}

export function buildObservationEvents(draft, state) {
  if (!draft) return [];
  const manuscript = String(draft.novelText || "").trim();
  if (manuscript) return manuscript.split(/\n\s*\n/).filter(Boolean).map((paragraph, index) => ({
    id: `${draft.id}_novel_${index}`,
    index,
    time: `S+${String(index + 1).padStart(2, "0")}`,
    locationId: draft.locationId,
    location: getLocationName(state, draft.locationId),
    participantIds: draft.participantIds || [],
    sourceTickId: draft.id,
    movementSource: "canonical-novel",
    kind: index === 0 ? "开场" : "推进",
    tone: "focus",
    text: paragraph.trim(),
    beats: [],
  }));
  const periodTicks = draft.periodSimulation?.ticks || [];
  if (periodTicks.length) {
    const tickEvents = periodTicks.flatMap((tick, index) => {
      const focused = tick.resolution === "focused_scene";      const beats = buildPeriodEventBeats(tick, state, index, focused);
      const text = state.worldSetup?.generatedBySkills
        ? buildSandboxPeriodLine(tick, state, index, focused)
        : buildDiegeticPeriodLine(tick, state, index, focused);
      return {
        id: tick.id || `${draft.id}_tick_${index}`,
        index,
        time: tick.label || `T+${index}`,
        locationId: tick.locationId || draft.locationId,
        location: tick.locationName || getLocationName(state, tick.locationId),
        participantIds: tick.participantIds || [],
        sourceTickId: tick.id || `${draft.id}_tick_${index}`,
        movementSource: "period-tick",
        kind: focused ? "近景" : "远景",
        tone: focused ? "focus" : "background",
        text: sanitizeObservationLanguage(text),
        beats,
      };
    });
    return tickEvents;
  }
  const lines = buildDiegeticSceneLines(draft, state).map((line) => sanitizeObservationLanguage(line));
  const sceneBeats = buildSceneEventBeats(draft, state, lines);
  return lines.map((line, index) => ({
    id: `${draft.id}_scene_${index}`,
    index,
    time: `S+${String(index + 1).padStart(2, "0")}`,
    locationId: draft.locationId,
    location: getLocationName(state, draft.locationId),
    participantIds: draft.participantIds || [],
    sourceTickId: draft.id,
    movementSource: "scene-line",
    kind: index === 0 ? "开场" : "推进",
    tone: index === 0 ? "focus" : "scene",
    text: line,
    beats: sceneBeats[index] || [buildLineBeat(`${draft.id}_scene_${index}`, line, draft.locationId)],
  }));
}

function sanitizeObservationLanguage(text = "") {
  let cleaned = String(text || "").trim();
  if (!cleaned) return "";
  cleaned = cleaned
    .replace(/上一轮对白全文：?/g, "")
    .replace(/按刚才的记录，?/g, "")
    .replace(/上一轮的账/g, "刚才那笔账")
    .replace(/上一轮的价码/g, "刚才那笔价码")
    .replace(/上一轮的规矩/g, "刚才那条规矩")
    .replace(/上一轮的话/g, "刚才那句话")
    .replace(/上一轮的供词/g, "刚才那份供词")
    .replace(/上一轮的水线/g, "刚才那道水线")
    .replace(/上一轮的/g, "刚才的")
    .replace(/上一轮/g, "刚才")
    .replace(/上次/g, "刚才")
    .replace(/([^，。；：“”]{1,16})已经留了\d+\s*轮/g, "$1还留在原处")
    .replace(/([^，。；：“”]{1,16})留了\d+\s*轮/g, "$1还留在原处")
    .replace(/([^，。；：“”]{1,16})已经压了\d+\s*轮/g, "$1已经压在原处")
    .replace(/连续\d+\s*轮/g, "几次")
    .replace(/\d+\s*轮的/g, "刚才那")
    .replace(/第\d+\s*轮/g, "这一回")
    .replace(/\d+\s*轮/g, "几次")
    .replace(/欠下的话/g, "没说完的话")
    .replace(/未结清/g, "没说完")
    .replace(/留下明天必须追问的痕迹/g, "留下灯下的划痕")
    .replace(/([^；。]*?)必须先回答这个人会不会被带走，这一步在两人之间形成保护债/g, "$1只能看着被护住的人留在原处")
    .replace(/这一步在两人之间形成保护债/g, "两个人的手都没有离开见证处")
    .replace(/形成保护债/g, "留下没有收回的手")
    .replace(/保护债/g, "没有收回的手")
    .replace(/([^，；。]{1,16})没能带走([^，；。]{1,20})，([^，；。]{1,16})用([^，；。]{1,16})护住([^，；。]{1,16})并获得[^；。]+；\1若要审讯，(?:必须|只好)先把理由交给([^；。]+)/g, "$3把$4横在$1和$5之间；$1伸向$2的手停住，转身向$6说明扣人的理由")
    .replace(/([^，；。]{1,16})没能直接带走([^，；。]{1,20})，([^，；。]{1,16})把([^，；。]{1,20})留给([^，；。]{1,16})作见证；再要审讯，(?:必须|只好)从\5前重新开口/g, "$3把$4压到$5前；$1伸向$2的手停住，$5把两人的名字写在同一行")
    .replace(/([^，；。]{1,16})没能把([^，；。]{1,20})直接换走，([^，；。]{1,16})把([^，；。]{1,20})压给([^，；。]{1,16})作价；再加码的人先把名字留在\5旁/g, "$3把$4压到$5前；$1伸向$2的手停在案边，$5在价码旁写下两人的名字")
    .replace(/([^，；。]{1,16})护住([^，；。]{1,16})，([^，；。]{1,16})不能绕过([^，；。]{1,20})继续逼近；[^；。]+暂时落到\1手里/g, "$1把$4横在$3和$2之间；$3的脚步停住，没有越过$4")
    .replace(/([^，；。]{1,16})获得[^，；。]+，([^，；。]{1,16})不能只凭([^，；。]{1,20})改写这次见证；([^，；。]{1,16})把两人的名字并在同一行/g, "$1按住$3，$2伸来的手停在$4前；$4把两人的名字并在同一行")
    .replace(/关系状态：?[^。！？；]*[。！？；]?/g, "")
    .replace(/这轮关系转成临时控制/g, "两个人都没有从见证物旁退开")
    .replace(/这轮关系不再能退回原状/g, "两个人都没有把话收回去")
    .replace(/关系转成临时控制/g, "手仍压在见证物旁")
    .replace(/([^；。]+)暂时失去私下收回([^；。]+)的退路/g, "$1伸出的手停在$2旁")
    .replace(/迫使([^，。；]+)把([^，。；]+)说到([^，。；]+)面前/g, "$1的声音落在$3面前")
    .replace(/迫使([^，。；]+)当着([^，。；]+)选边/g, "$1的手停在$2前")
    .replace(/刚才那句话当着([^，。；！？“”]{1,16})说完/g, "$1前还少一个名字")
    .replace(/接住[^，。；！？]{1,18}刚才那一步/g, "把刚才的位置重新挡住")
    .replace(/解释权/g, "说法")
    .replace(/刚才那账/g, "刚才那笔账")
    .replace(/必须先/g, "只好先")
    .replace(/必须/g, "只好")
    .replace(/\s+/g, " ")
    .replace(/。。+/g, "。")
    .replace(/；。/g, "。")
    .trim();
  return cleaned;
}

function buildSandboxPrimerEvents(draft, state) {
  if (!state.worldSetup?.generatedBySkills) return [];
  const worldText = buildWorldSandboxText(state);
  const castText = buildCastSandboxText(state);
  return [
    {
      id: `${draft.id}_sandbox_world`,
      index: 0,
      time: "S+00",
      // The world paragraph is not "at" any scene location; an empty locationId
      // keeps location-filtered observers from mistaking it for a scene tick.
      locationId: "",
      location: state.town?.name || "世界",
      participantIds: [],
      sourceTickId: draft.id,
      movementSource: "sandbox-world",
      kind: "世界",
      tone: "focus",
      text: worldText,
      beats: [{ id: `${draft.id}_sandbox_world_beat`, type: "space", label: "世界", locationId: "", text: worldText }],
    },
    {
      id: `${draft.id}_sandbox_cast`,
      index: 1,
      time: "S+01",
      locationId: "",
      location: state.town?.name || "人物",
      participantIds: (state.characters || []).slice(0, 8).map((character) => character.id),
      sourceTickId: draft.id,
      movementSource: "sandbox-cast",
      kind: "人物",
      tone: "focus",
      text: castText,
      beats: (state.characters || []).slice(0, 6).map((character, index) => ({
        id: `${draft.id}_sandbox_cast_${index}`,
        type: "action",
        actorId: character.id,
        actorName: character.name,
        locationId: "",
        text: sandboxCharacterLine(character),
      })),
    },
  ].filter((event) => event.text);
}

function buildWorldSandboxText(state) {
  const town = state.town || {};
  const locations = (state.locations || []).slice(0, 4).map((location) => location.name).filter(Boolean);
  const objects = (town.recurringObjects || []).slice(0, 5).filter(Boolean);
  const rules = (town.publicRules || []).slice(0, 2).map((rule) => trimSandboxSentence(rule)).filter(Boolean);
  const firstRule = rules[0] || town.summary || "这里的城规会把每个人留在可见的位置";
  const secondRule = rules[1] || town.pressureClock || "";
  const locationLine = locations.length ? `${locations.join("、")}各自握着一条路。` : "";
  const objectLine = objects.length ? `${objects.join("、")}会在手里换主人。` : "";
  return [
    ensureSentence(`${town.name || state.project?.title || "这座城"}开在正邪、妖鬼和水路之间`),
    ensureSentence(firstRule),
    secondRule ? ensureSentence(secondRule) : "",
    locationLine,
    objectLine,
  ].filter(Boolean).join("");
}

function buildCastSandboxText(state) {
  const cast = (state.characters || []).slice(0, 6);
  if (!cast.length) return "";
  const lines = cast.map((character) => sandboxCharacterLine(character));
  return lines.join(" ");
}

function sandboxCharacterLine(character = {}) {
  const role = shortIdentity(character.publicIdentity || "");
  const object = sandboxObjectForCharacter(character);
  const desire = polishSandboxDesire(character.actionLines?.desire || character.internalSituation?.inadmissibleDesire || "");
  const name = character.name || "有人";
  const core = role ? `${name}是${role}` : `${name}在场`;
  const desireTail = desire ? `，守着${desire}` : "";
  const objectTail = object ? `，手边常有${object}` : "";
  return `${core}${desireTail}${objectTail}。`;
}

function shortIdentity(text = "") {
  return String(text || "")
    .split(/[，,。；;]/)[0]
    .replace(/，.*$/g, "")
    .trim();
}

function trimSandboxSentence(text = "") {
  return String(text || "")
    .replace(/[。！？]+$/g, "")
    .replace(/^让/, "")
    .replace(/^守住/, "")
    .replace(/^在不破城规的情况下/, "")
    .trim();
}

function polishSandboxDesire(text = "") {
  return trimSandboxSentence(text)
    .replace(/死人证词成为活人谈判桌上的位置$/, "死人证词在谈判桌上的位置")
    .replace(/，不让任何一派把病人当证据拖走$/, "")
    .replace(/，并证明器灵不是谁的工具$/, "")
    .replace(/，不让正邪两派发现他卖过一条水路$/, "")
    .replace(/仍有资格扣押邪派证人$/, "扣押邪派证人的资格")
    .trim();
}

function sandboxObjectForCharacter(character = {}) {
  const text = [character.publicIdentity, character.actionLines?.visible, character.actionLines?.desire, character.internalSituation?.inadmissibleDesire].filter(Boolean).join(" ");
  const objects = ["灵契", "魔印", "妖丹", "庇护牌", "药炉", "照骨镜", "渡令", "魂灯", "城令", "剑匣", "停剑令"];
  return objects.find((object) => text.includes(object)) || "";
}

function renderObserverStage(state, draft, events, playback) {
  const stage = buildObserverStage(state, draft, events, playback);
  return `
    <div class="observer-stage-panel" data-observer-stage="true">
      <div class="observer-stage-head">
        <span>${escapeHtml(stage.title)}</span>
        <span>${escapeHtml(stage.sourceLabel)}</span>
      </div>
      <div class="observer-stage-map" data-stage-map="true">
        ${stage.locations.map((location, index) => `
          <span class="stage-location stage-location-${index + 1}" data-stage-plan-location="${escapeHtml(location.id)}" style="--stage-left:${location.left}%;--stage-top:${location.top}%;">
            <span>${escapeHtml(location.name)}</span>
          </span>
        `).join("")}
        ${stage.paths.map((path, index) => `<span class="stage-path stage-path-${index + 1}" aria-hidden="true"></span>`).join("")}
        ${stage.actors.map((actor, index) => `
          <span
            class="stage-actor pixel-person stage-person actor-${index + 1}"
            data-stage-actor="${escapeHtml(actor.id)}"
            data-pixel-person="true"
            data-pixel-actor="${escapeHtml(actor.name)}"
            data-stage-location="${escapeHtml(actor.locationId)}"
            data-stage-previous-location="${escapeHtml(actor.previousLocationId)}"
            data-stage-event-source="${escapeHtml(actor.sourceTickId)}"
            data-movement-source="observation-event"
            style="--stage-left:${actor.left}%;--stage-top:${actor.top}%;--from-left:${actor.fromLeft}%;--from-top:${actor.fromTop}%;--actor-index:${index};"
          >
            <span class="pixel-person-shadow"></span>
            <span class="pixel-person-head"></span>
            <span class="pixel-person-body"></span>
            <span class="pixel-person-feet"></span>
            ${actor.dialogue ? `<span class="stage-speech" data-stage-dialogue="${escapeHtml(actor.id)}" data-stage-speaker="${escapeHtml(actor.id)}">${escapeHtml(actor.dialogue)}</span>` : ""}
            <span class="pixel-person-label">${escapeHtml(actor.name)}</span>
          </span>
        `).join("")}
      </div>
      ${renderStageProcess(stage)}
    </div>
  `;
}

function buildObserverStage(state, draft, events = [], playback = {}) {
  const visibleCount = Math.max(0, Number(playback?.visibleCount || 0));
  const visibleEvents = events.slice(0, visibleCount);
  const stageLocations = buildStageLocations(state, draft, visibleEvents);
  const lastEvent = visibleEvents[visibleEvents.length - 1];
  const actorIds = collectStageActorIds(state, draft, visibleEvents);
  const currentBeats = lastEvent?.beats || [];
  const dialogueBySpeaker = new Map(currentBeats
    .filter((beat) => beat.type === "dialogue" && (beat.speakerId || beat.actorId))
    .map((beat) => [beat.speakerId || beat.actorId, beat.text]));
  const actors = actorIds.map((id, index) => {
    const actor = buildStageActor(state, id, index, visibleEvents, draft, stageLocations);
    return {
      ...actor,
      dialogue: dialogueBySpeaker.get(id) || "",
      isInCurrentBeat: currentBeats.some((beat) => [beat.actorId, beat.speakerId, beat.targetId].includes(id)),
    };
  });
  return {
    title: "事件舞台",
    sourceLabel: lastEvent ? `${lastEvent.time} / ${lastEvent.location}` : "等待事件",
    locations: stageLocations,
    paths: [1, 2, 3],
    actors,
    currentEvent: lastEvent,
    beats: currentBeats,
  };
}

function renderStageProcess(stage) {
  const beats = stage.beats || [];
  return `
    <div class="stage-process" data-stage-process="true">
      <div class="stage-process-head">
        <span>${escapeHtml(stage.currentEvent ? "当前一拍" : "尚未开始")}</span>
        <span>${escapeHtml(stage.currentEvent?.time || "")}</span>
      </div>
      <div class="stage-process-list">
        ${beats.length ? beats.map(renderStageBeat).join("") : `<div class="stage-beat muted" data-stage-beat="waiting">按下播放后，人物的动作会逐拍出现。</div>`}
      </div>
    </div>
  `;
}

function renderStageBeat(beat, index) {
  const actorName = beat.actorName || beat.speakerName || beat.targetName || beat.label || "舞台";
  const text = beat.type === "dialogue" ? `“${beat.text}”` : beat.text;
  const actionAttr = beat.type === "action" ? ` data-stage-action="${escapeHtml(beat.actorId || "")}"` : "";
  const dialogueAttr = beat.type === "dialogue"
    ? ` data-stage-dialogue="${escapeHtml(beat.speakerId || beat.actorId || "")}" data-stage-speaker="${escapeHtml(beat.speakerId || beat.actorId || "")}"`
    : "";
  return `
    <div class="stage-beat ${escapeHtml(beat.type || "beat")}" data-stage-beat="${escapeHtml(beat.id || `beat_${index}`)}"${actionAttr}${dialogueAttr}>
      <span class="stage-beat-mark">${escapeHtml(stageBeatLabel(beat.type))}</span>
      <span class="stage-beat-actor">${escapeHtml(actorName)}</span>
      <span class="stage-beat-text">${escapeHtml(text)}</span>
    </div>
  `;
}

function buildStageLocations(state, draft, visibleEvents = []) {
  const eventLocationIds = [...new Set(visibleEvents.map((event) => event.locationId).filter(Boolean))];
  const preferred = [
    ...(draft?.periodSimulation?.locationIds || []),
    ...(state.ui?.selectedLocationId ? [state.ui.selectedLocationId] : []),
    ...(draft?.locationId ? [draft.locationId] : []),
    ...eventLocationIds,
    ...(state.locations || []).map((location) => location.id),
  ];
  const uniqueIds = [...new Set(preferred)].filter(Boolean).slice(0, 6);
  return uniqueIds.map((id, index) => {
    const slot = stageSlot(index);
    return {
      id,
      name: getLocationName(state, id),
      left: slot.left,
      top: slot.top,
    };
  });
}

function collectStageActorIds(state, draft, visibleEvents = []) {
  const appeared = visibleEvents.flatMap((event) => event.participantIds || []);
  const fallback = draft?.participantIds || state.ui?.activeCharacterIds || [];
  return [...new Set([...appeared, ...fallback])].filter(Boolean).slice(0, 8);
}

function buildStageActor(state, characterId, index, visibleEvents, draft, stageLocations) {
  const actorEvents = visibleEvents.filter((event) => (event.participantIds || []).includes(characterId));
  const currentEvent = actorEvents[actorEvents.length - 1] || visibleEvents[visibleEvents.length - 1] || null;
  const previousEvent = actorEvents.length > 1 ? actorEvents[actorEvents.length - 2] : currentEvent;
  const locationId = currentEvent?.locationId || draft?.locationId || state.ui?.selectedLocationId || stageLocations[0]?.id || "";
  const previousLocationId = previousEvent?.locationId || locationId;
  const currentSlot = stageSlotForLocation(stageLocations, locationId);
  const previousSlot = stageSlotForLocation(stageLocations, previousLocationId);
  const offset = actorOffset(index);
  return {
    id: characterId,
    name: getName(state, characterId),
    locationId,
    previousLocationId,
    sourceTickId: currentEvent?.sourceTickId || currentEvent?.id || draft?.id || "stage_waiting",
    left: currentSlot.left + offset.x,
    top: currentSlot.top + offset.y,
    fromLeft: previousSlot.left + offset.x,
    fromTop: previousSlot.top + offset.y,
  };
}

function stageSlot(index) {
  return [
    { left: 20, top: 25 },
    { left: 58, top: 25 },
    { left: 22, top: 65 },
    { left: 62, top: 65 },
    { left: 76, top: 45 },
    { left: 43, top: 48 },
  ][index % 6];
}

function stageSlotForLocation(stageLocations, locationId) {
  const location = stageLocations.find((item) => item.id === locationId) || stageLocations[0];
  return location || stageSlot(0);
}

function actorOffset(index) {
  return [
    { x: -4, y: -3 },
    { x: 3, y: -2 },
    { x: -1, y: 3 },
    { x: 5, y: 4 },
    { x: -6, y: 5 },
    { x: 7, y: -5 },
    { x: -8, y: -7 },
    { x: 8, y: 7 },
  ][index % 8];
}

function buildSandboxPeriodLine(tick, state, index, focused) {
  const location = getLocation(state, tick.locationId);
  const visibleEvent = pickVisibleEvent(location, index);
  const names = getParticipantNames(state, tick.participantIds);
  if (!focused) {
    const occurrence = describeBackgroundVisibleOccurrence(location, visibleEvent, names);
    const backgroundActions = (tick.agentOutputs || [])
      .slice(0, 2)
      .map((output, outputIndex) => cleanObservableAction(output.visibleAction, getName(state, output.characterId), getName(state, output.targetCharacterId), {
        sourceId: tick.id || `period_${index}`,
        tickIndex: index,
        index: outputIndex,
        locationId: location?.id || tick.locationId || "",
        visibleEvent,
      }))
      .filter(Boolean);
    const ambientFarView = state.ui?.focusMode === "ambient";
    const backgroundDialogue = ambientFarView ? farViewDialogueSentence(tick, state) : "";
    return [occurrence, ...backgroundActions, backgroundDialogue, describeDistantAftermath(location, names, index)].join(" ");
  }
  const outputs = (tick.agentOutputs || []).filter((output) => output?.characterId);
  const agentExchange = firstAgentExchange(tick);
  const occurrence = describeVisibleOccurrence(location, visibleEvent, names);
  const exchange = buildActualAgentExchangeSentence(outputs, state, location, visibleEvent) || sandboxFallbackExchange(outputs, state, location, visibleEvent);
  const dialogue = buildSandboxDialogueSentence(agentExchange, state);
  const outcome = cleanSandboxOutcome(agentExchange?.eventOutcome) || sandboxTraceLine(tick, state, location, index) || describeDistantAftermath(location, names, index);
  return [occurrence, exchange, dialogue, outcome].filter(Boolean).join(" ");
}

function firstAgentExchange(tick = {}) {
  return (tick.sceneInteraction?.agentExchanges || [])
    .find((exchange) => Array.isArray(exchange.dialogueTurns) || exchange.eventOutcome)
    || null;
}

function buildSandboxDialogueSentence(exchange = {}, state = {}, maxTurns = 6) {
  const turns = (exchange?.dialogueTurns || [])
    .map((turn) => {
      const speaker = turn.speakerName || getName(state, turn.speakerId) || "";
      const speech = normalizeSpeechText(turn.line || turn.text || "");
      if (!speaker || !speech) return "";
      return `${speaker}说：“${speech}”`;
    })
    .filter(Boolean);
  return turns.slice(0, Math.max(1, maxTurns)).join("");
}

function farViewDialogueSentence(tick = {}, state = {}) {
  const exchange = firstAgentExchange(tick);
  if (!exchange) return "";
  const slogans = authoredDefenseLines(state);
  return (exchange.dialogueTurns || []).slice(0, 2).map((turn) => {
    const speaker = turn.speakerName || getName(state, turn.speakerId) || "";
    const speech = contextualizeFarViewSpeech(turn.line || turn.text || "", slogans);
    if (!speaker || !speech) return "";
    return `${speaker}说：“${speech}”`;
  }).join("");
}

function authoredDefenseLines(state = {}) {
  return (state.characters || []).flatMap((character) => character.defenseLanguage || [])
    .map((line) => stripSpeechPunctuation(line))
    .filter(Boolean);
}

function contextualizeFarViewSpeech(line = "", slogans = []) {
  const parts = String(line || "").match(/[^。！？!?]+[。！？!?]?/g) || [];
  const stored = new Set(slogans);
  const contextual = parts
    .map((part) => part.trim())
    .filter((part) => part && !stored.has(stripSpeechPunctuation(part)));
  return normalizeSpeechText(contextual.join(""));
}

function stripSpeechPunctuation(value = "") {
  return String(value).replace(/[\p{P}\p{S}\s]+/gu, "");
}

function cleanSandboxOutcome(text = "") {
  const cleaned = stripEngineLanguage(text)
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || containsForbiddenObservationLanguage(cleaned)) return "";
  return ensureSentence(cleaned);
}

function sandboxFallbackExchange(outputs = [], state, location = {}, visibleEvent = "") {
  return (outputs || [])
    .slice(0, 2)
    .map((output, index) => firstObservableSentence(
      output.visibleAction,
      getName(state, output.characterId),
      getName(state, output.targetCharacterId),
      location,
      visibleEvent,
      index,
    ))
    .filter(Boolean)
    .join(" ");
}

function sandboxTraceLine(tick = {}, state = {}, location = {}, index = 0) {
  const names = getParticipantNames(state, tick.participantIds || []);
  return describeDistantAftermath(location, names, index);
}

function buildDiegeticPeriodLine(tick, state, index, focused) {
  const location = getLocation(state, tick.locationId);
  const visibleEvent = pickVisibleEvent(location, index);
  const names = getParticipantNames(state, tick.participantIds);
  if (!focused) {
    const occurrence = describeBackgroundVisibleOccurrence(location, visibleEvent, names);
    const backgroundActions = (tick.agentOutputs || [])
      .slice(0, 2)
      .map((output, outputIndex) => cleanObservableAction(output.visibleAction, getName(state, output.characterId), getName(state, output.targetCharacterId), {
        sourceId: tick.id || `period_${index}`,
        tickIndex: index,
        index: outputIndex,
        locationId: location?.id || tick.locationId || "",
        visibleEvent,
      }))
      .filter(Boolean);
    const ambientFarView = state.ui?.focusMode === "ambient";
    const backgroundDialogue = ambientFarView ? farViewDialogueSentence(tick, state) : "";
    return [occurrence, ...backgroundActions, backgroundDialogue, describeDistantAftermath(location, names, index)].join(" ");
  }

  const occurrence = describeVisibleOccurrence(location, visibleEvent, names);

  const exchangeLine = buildTickAgentExchangeLine(tick, state);
  if (exchangeLine) {
    return `${occurrence} ${exchangeLine}`;
  }

  const firstAction = (tick.agentOutputs || [])[0];
  const actor = getName(state, firstAction?.characterId || tick.participantIds?.[0]);
  const target = getName(state, firstAction?.targetCharacterId || tick.participantIds?.[1]);
  const action = cleanObservableAction(firstAction?.visibleAction, actor, target, {
    sourceId: tick.id || `period_${index}`,
    tickIndex: index,
    index: 0,
    locationId: location?.id || tick.locationId || "",
    visibleEvent,
  });
  const reaction = target && target !== actor ? `${target}没有立刻回答，旁边的人先听见椅脚擦过地板。` : "房间里没有人立刻接话。";
  return `${occurrence} ${action} ${reaction}`;
}

function buildTickAgentExchangeLine(tick = {}, state = {}) {
  const exchange = firstAgentExchange(tick);
  if (!exchange) return "";
  const dialogue = buildSandboxDialogueSentence(exchange, state);
  const outcome = cleanSandboxOutcome(exchange.eventOutcome);
  return [dialogue, outcome].filter(Boolean).join(" ");
}

function buildDiegeticSceneLines(draft, state) {
  const location = getLocation(state, draft.locationId);
  const names = getParticipantNames(state, draft.participantIds);
  const visibleEvent = pickVisibleEvent(location, 0);
  const exchangeLine = buildSceneAgentExchangeLine(draft, state);
  const lines = [
    `${describeVisibleOccurrence(location, visibleEvent, names)} ${names.length ? `${names.join("、")}都在场。` : ""}`,
    ...(draft.agentOutputs || []).slice(0, 3).map((output, index) => cleanObservableAction(output.visibleAction, getName(state, output.characterId), getName(state, output.targetCharacterId), {
      sourceId: draft.id || "scene",
      tickIndex: index,
      index,
      locationId: location?.id || draft.locationId || "",
      visibleEvent,
    })).filter(Boolean),
    exchangeLine,
  ];
  const firstTrace = (draft.irreversibleTraces || [])
    .map((trace) => cleanTrace(trace))
    .find(Boolean);
  if (firstTrace) lines.push(firstTrace);
  const visibleLines = lines.filter(Boolean);
  return visibleLines.length ? visibleLines : ["房间里有事发生，但还没有人愿意把它说破。"];
}

function firstSceneAgentExchange(draft = {}) {
  return (draft.sceneInteraction?.agentExchanges || [])
    .find((exchange) => Array.isArray(exchange.dialogueTurns) || exchange.eventOutcome)
    || null;
}

function buildSceneAgentExchangeLine(draft = {}, state = {}) {
  const exchange = firstSceneAgentExchange(draft);
  if (!exchange) return "";
  const dialogue = buildSandboxDialogueSentence(exchange, state);
  const outcome = cleanSandboxOutcome(exchange.eventOutcome);
  return [dialogue, outcome].filter(Boolean).join(" ");
}

function buildEventIntentSentence({ outputs = [], participantIds = [], state, location, visibleEvent, focused = false } = {}) {
  const maxClauses = focused ? 3 : 2;
  const clauses = (outputs || [])
    .slice(0, maxClauses)
    .map((output, index) => characterIntentClause(output, state, index))
    .filter(Boolean);
  if (!clauses.length) return "";
  const actorNames = clauses.map((clause) => clause.name).filter(Boolean);
  const names = actorNames.length ? actorNames : getParticipantNames(state, participantIds).slice(0, 2);
  const goalText = clauses.map((clause) => clause.text).join("；");
  const stateText = clauses.map((clause) => clause.stateText).filter(Boolean).join("；");
  const collision = buildIntentCollisionSentence(location, visibleEvent, names);
  const exchange = buildEventExchangeSentence(outputs, state, location, visibleEvent);
  return `${goalText}。${stateText ? `${stateText}。` : ""}${exchange || collision}`;
}

function characterIntentClause(output = {}, state, index = 0) {
  const character = state.characters.find((item) => item.id === output.characterId);
  const name = getName(state, output.characterId) || character?.name || "有人";
  const target = getName(state, output.targetCharacterId) || "";
  const intent = pickIntentGoal(output, character, name, target);
  if (!intent) return null;
  const verb = index === 0 ? "要" : "想";
  return {
    name,
    text: `${name}${verb}${intent}`,
    stateText: characterStateClause(output, character, name),
  };
}

function characterStateClause(output = {}, character = {}, name = "有人") {
  const phrase = characterStatePhrase(output, character);
  return phrase ? `${name}${phrase}` : "";
}

function characterStatePhrase(output = {}, character = {}) {
  const st = character?.currentState || {};
  const desire = finiteNumber(st.desire, 0);
  const shame = finiteNumber(st.shame, 0);
  const rage = finiteNumber(st.rage, 0);
  const selfDeception = finiteNumber(st.selfDeception, 0);
  const revengeImpulse = finiteNumber(st.revengeImpulse, 0);
  const protectionImpulse = finiteNumber(st.protectionImpulse, 0);
  const tone = output.tone || "";
  if (tone === "自毁") return "把话往回吞";
  if (tone === "撤退") return "站在退开的边上";
  const axes = [
    { score: shame + selfDeception + (tone === "伪装" ? 24 : 0), floor: 110, phrase: "绷着一层慌" },
    { score: rage + revengeImpulse + (tone === "惩罚" || tone === "陷害" ? 24 : 0), floor: 96, phrase: "压着火气" },
    { score: protectionImpulse + (tone === "保护" ? 32 : 0), floor: 68, phrase: "急着护住身边的人" },
    { score: desire + (tone === "接近" ? 24 : 0), floor: 68, phrase: "等着被看见" },
  ].sort((a, b) => b.score - a.score);
  const strongest = axes.find((axis) => axis.score >= axis.floor);
  if (strongest) return strongest.phrase;
  return "停在试探和退让之间";
}

function pickIntentGoal(output = {}, character = {}, actor = "有人", target = "") {
  const candidates = [
    output.realtimePublicGoal,
    output.publicGoal,
    character?.actionLines?.visible,
    output.planNextAction,
    output.realtimePrivateDesire,
    character?.actionLines?.desire,
    output.wantsFromOthers,
    output.hiddenAction,
    output.desireReason,
  ];
  for (const candidate of candidates) {
    const cleaned = sanitizeIntentGoal(candidate, actor, target);
    if (cleaned) return cleaned;
  }
  return target ? `让${target}先停在这里` : "守住眼前这一步";
}

function sanitizeIntentGoal(text = "", actor = "有人", target = "") {
  let cleaned = stripEngineLanguage(text)
    .replace(/[“”"「」『』]/g, "")
    .replace(/操盘手锁定[^：:]*[：:]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  cleaned = cleaned
    .split(/[。！？；;]/)[0]
    .replace(new RegExp(`^${escapeRegExp(actor)}(?:要|想|试图|希望|准备|必须|正在)?`), "")
    .replace(/^(要|想|试图|希望|准备|必须|正在|通过)/, "")
    .replace(/^让对方/, target ? `让${target}` : "让对方")
    .replace(/，但.*$/g, "")
    .replace(/,但.*$/g, "")
    .replace(/，却.*$/g, "")
    .replace(/,却.*$/g, "")
    .replace(/[，,：:、]\s*$/g, "")
    .trim();
  if (!cleaned || cleaned.length < 2) return "";
  if (containsForbiddenObservationLanguage(cleaned)) return "";
  return trimIntentGoal(condenseIntentGoal(cleaned));
}

function trimIntentGoal(text = "") {
  const chars = [...String(text || "")];
  if (chars.length <= 28) return text;
  return `${chars.slice(0, 28).join("")}这一点`;
}

function condenseIntentGoal(text = "") {
  const parts = String(text || "")
    .split(/[、，,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return text;
  const secondLooksLikeAction = /^[扣压递换试退收摁撤诊藏关验照封点领开合逼护挡问改折拿推拦]/.test(parts[1]);
  if (secondLooksLikeAction) return `${parts[0]}并${parts[1]}`;
  return parts[0];
}

function buildEventExchangeSentence(outputs = [], state, location = {}, visibleEvent = "") {
  const active = (outputs || []).filter((output) => output?.characterId).slice(0, 3);
  const first = active[0];
  const second = active.find((output) => output.characterId !== first?.characterId);
  if (!first || !second) return "";
  const actual = buildActualAgentExchangeSentence(active, state, location, visibleEvent);
  if (actual) return actual;
  const actor = getName(state, first.characterId) || "有人";
  const target = getName(state, second.characterId) || "另一个人";
  const raw = String(visibleEvent || "");
  const place = location?.name || "";
  if (/灵契|验身|押契|契牌/.test(raw)) return `${actor}扣住${target}的契牌，${target}把毒誓符压到铜盘边，守门人的印悬在半空。`;
  if (/妖丹|拍卖|竞价|试价|符箓/.test(raw) || /无咎市|市/.test(place)) return `${actor}把禁术符箓推到${target}面前，${target}用庇护牌挡住铜夹，摊主把账册合了一半。`;
  if (/破禁|扣押|锁灵|审讯|供词|剑匣/.test(raw) || /照骨司|镜塔|档案/.test(place)) return `${actor}把剑匣封条按到镜下，${target}伸手改锁，法铃在两人中间响了一声。`;
  if (/追捕|渡令|水阵|封渡|逃亡/.test(raw) || /归墟|渡/.test(place)) return `${actor}收起渡令，${target}摁住界石，水阵把追来的人压回岸上。`;
  if (/庇护|药|医坊|毒伤/.test(raw) || /万灵|医坊/.test(place)) return `${actor}扣下庇护牌，${target}把药炉推近伤者，门外的人被挡在帘外。`;
  if (/停剑|正邪|暗杀|谈判/.test(raw) || /停剑|茶楼/.test(place)) return `${actor}把停剑令压到茶盏旁，${target}没有拔剑，只把令牌推回桌心。`;
  if (/账本|欠款|会议|制服|租约|拒付|餐巾/.test(raw) || /餐桌|客厅|桌/.test(place)) return `${actor}把账本推到${target}面前，${target}没有接，铅笔停在欠款旁。`;
  if (/门|锁|钥匙|闹钟|书记员|车|迟到|缺勤/.test(raw) || /格里高尔房间|门/.test(place)) return `${actor}把话递到门缝里，${target}把手按在门板上，钥匙停在锁孔半圈。`;
  if (/琴|弦|小提琴|演奏|音阶/.test(raw)) return `${actor}把琴弓压低，${target}先看账本，桌边的声音停了一拍。`;
  if (/文牒|山门|行李|求救|通关/.test(raw)) return `${actor}把通关文牒收回袖中，${target}拦在路口，行李担停在石阶上。`;
  if (/钱|市集|买|卖|摊/.test(raw)) return `${actor}按住钱袋，${target}扣住货盒，摊前的人不再吆喝。`;
  const prop = observationLocationProp(location);
  return `${actor}把${prop}推到${target}面前，${target}先按住它，旁边的人停住。`;
}

function buildActualAgentExchangeSentence(outputs = [], state, location = {}, visibleEvent = "") {
  const byOutputId = new Map((outputs || []).filter((output) => output?.outputId).map((output) => [output.outputId, output]));
  const responder = (outputs || []).find((output) => output?.interactionInput?.sourceOutputId);
  if (!responder) return "";
  const source = byOutputId.get(responder.interactionInput.sourceOutputId)
    || outputs.find((output) => output.characterId === responder.interactionInput.sourceCharacterId);
  if (!source) return "";
  const sourceActor = getName(state, source.characterId) || "有人";
  const responderActor = getName(state, responder.characterId) || "另一个人";
  const sourceTarget = getName(state, source.targetCharacterId) || responderActor;
  const responderTarget = getName(state, responder.targetCharacterId) || sourceActor;
  const sourceLine = firstObservableSentence(source.visibleAction, sourceActor, sourceTarget, location, visibleEvent, 0);
  const responderLine = firstObservableSentence(responder.visibleAction, responderActor, responderTarget, location, visibleEvent, 1);
  return [sourceLine, responderLine].filter(Boolean).join(" ");
}

function firstObservableSentence(text = "", actor = "有人", target = "", location = {}, visibleEvent = "", index = 0) {
  const cleaned = cleanObservableAction(text, actor, target, {
    sourceId: `agent_exchange_${actor}_${index}`,
    tickIndex: index,
    index,
    locationId: location?.id || "",
    visibleEvent,
  });
  const sentences = String(cleaned || "")
    .split(/[。！？]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const sentence = sentences.find((part) => part.includes(actor))
    || (target ? sentences.find((part) => part.includes(target)) : "")
    || sentences.find(Boolean);
  return sentence ? `${sentence}。` : "";
}

function observationLocationProp(location = {}) {
  const name = location?.name || "";
  if (/法契|契门|界石/.test(name)) return "灵契";
  if (/无咎市|市/.test(name)) return "妖丹盒";
  if (/照骨司|镜塔|档案/.test(name)) return "照骨镜";
  if (/归墟|渡/.test(name)) return "渡令";
  if (/万灵|医坊/.test(name)) return "庇护牌";
  if (/停剑|茶楼/.test(name)) return "停剑令";
  if (/山门|路口/.test(name)) return "通关文牒";
  if (/密林|小路|行李/.test(name)) return "行李担";
  if (/餐桌|客厅|桌/.test(name)) return "账本";
  if (/房客|出租|空房间/.test(name)) return "餐巾";
  if (/房间|门/.test(name)) return "门边的椅子";
  if (/公司|柜台/.test(name)) return "缺勤记录";
  return "桌沿";
}

function buildIntentCollisionSentence(location = {}, visibleEvent = "", names = []) {
  const joined = joinConflictNames(names);
  const raw = String(visibleEvent || "");
  const place = location?.name || "这里";
  if (/灵契|验身|押契|契牌/.test(raw)) return `灵契和界石把${joined}推到铜盘前。`;
  if (/破禁|扣押|锁灵|审讯|供词/.test(raw)) return `法铃和供词把${joined}扣在照骨镜下。`;
  if (/妖丹|拍卖|竞价|试价|符箓/.test(raw)) return `妖丹盒和宗门令牌把${joined}压到同一张案台前。`;
  if (/追捕|渡令|水阵|封渡|逃亡/.test(raw)) return `渡令和水阵把${joined}拦在同一条界线上。`;
  if (/庇护|药|医坊|毒伤/.test(raw)) return `庇护牌和药炉把${joined}留在同一间医坊里。`;
  if (/停剑|正邪|暗杀|谈判/.test(raw)) return `停剑令把${joined}压到同一盏茶前。`;
  if (/账本|欠款|会议|制服|租约|拒付|餐巾/.test(raw) || /餐桌|客厅|桌/.test(place)) return `账本和欠款把${joined}留在同一张桌边。`;
  if (/门|锁|钥匙|闹钟|书记员|车|迟到|缺勤/.test(raw) || /格里高尔房间|门/.test(place)) return `门、车次和钥匙把${joined}推到同一扇门前。`;
  if (/琴|弦|小提琴|演奏|音阶/.test(raw)) return `琴声和账本把${joined}牵到同一段沉默里。`;
  if (/文牒|山门|行李|求救|通关/.test(raw)) return `通关文牒和路口把${joined}挡在同一条路上。`;
  if (/钱|市集|买|卖|摊/.test(raw)) return `钱袋和摊前的货把${joined}压到同一笔交易里。`;
  return `${place}把${joined}推到同一件事里。`;
}

function joinConflictNames(names = []) {
  const picked = [...new Set((names || []).filter(Boolean))].slice(0, 3);
  if (!picked.length) return "几个人";
  if (picked.length === 1) return picked[0];
  if (picked.length === 2) return `${picked[0]}和${picked[1]}`;
  return `${picked[0]}、${picked[1]}和${picked[2]}`;
}

function buildPeriodEventBeats(tick, state, index, focused) {
  const location = getLocation(state, tick.locationId);
  const locationId = location?.id || tick.locationId || "";
  const participantIds = tick.participantIds || [];
  const sourceId = tick.id || `period_${index}`;
  const names = getParticipantNames(state, participantIds);
  const visibleEvent = pickVisibleEvent(location, index);
  const beats = [buildSpaceBeat(`${sourceId}_space`, location, visibleEvent, names, locationId)];
  if (!focused) {
    // Far-view ticks keep their active characters visible as action beats —
    // spoken lines only surface when the source action actually carries a
    // quote (engine far-view output does not; authored ticks may).
    const backgroundBeats = (tick.agentOutputs || [])
      .slice(0, 2)
      .flatMap((output, outputIndex) => {
        const actorId = output.characterId || "";
        const actorName = getName(state, actorId) || "有人";
        const targetName = output.targetCharacterId ? getName(state, output.targetCharacterId) : "";
        const observable = cleanObservableAction(output.visibleAction, actorName, targetName, {
          sourceId,
          locationId,
          tickIndex: index,
          index: outputIndex,
          visibleEvent,
        });
        const actionText = cleanStageActionText(removeDialogueFromAction(observable), actorName, targetName, {
          sourceId,
          locationId,
          tickIndex: index,
          index: outputIndex,
          visibleEvent,
        });
        const dialogue = extractDialogue(observable);
        const rows = [];
        if (actionText) {
          rows.push({
            id: `${sourceId}_bg_action_${outputIndex}`,
            type: "action",
            actorId,
            actorName,
            locationId,
            text: actionText,
          });
        }
        if (dialogue) {
          rows.push({
            id: `${sourceId}_bg_dialogue_${outputIndex}`,
            type: "dialogue",
            actorId,
            speakerId: actorId,
            actorName,
            speakerName: actorName,
            locationId,
            text: dialogue,
          });
        }
        return rows;
      })
      .filter(Boolean);
    return [...beats, ...backgroundBeats]
      .map((beat) => ({ ...beat, text: sanitizeObservationLanguage(beat.text) }))
      .filter((beat) => beat?.text);
  }
  const outputs = (tick.agentOutputs || []).slice(0, 4);
  const exchange = firstAgentExchange(tick);

  outputs.forEach((output, outputIndex) => {
    beats.push(...buildAgentOutputBeats(output, state, {
      sourceId,
      locationId,
      tickIndex: index,
      index: outputIndex,
      visibleEvent,
    }));
  });

  if (exchange) {
    beats.push(...buildAgentExchangeBeats(exchange, state, {
      sourceId: `${sourceId}_exchange`,
      locationId,
    }));
  }

  if (!outputs.length && !exchange) {
    participantIds.slice(0, focused ? 3 : 1).forEach((characterId, participantIndex) => {
      beats.push(buildFallbackParticipantBeat(characterId, state, {
        sourceId,
        locationId,
        tickIndex: index,
        index: participantIndex,
        visibleEvent,
      }));
    });
  }

  if (focused && beats.length < 4) {
    const firstActorId = outputs[0]?.characterId || participantIds[0];
    const reactorId = participantIds.find((id) => id && id !== firstActorId);
    if (reactorId) {
      beats.push({
        id: `${sourceId}_reaction`,
        type: "reaction",
        actorId: reactorId,
        actorName: getName(state, reactorId),
        locationId,
        text: `${getName(state, reactorId)}停在原处，没有立刻答话。`,
      });
    }
  }

  return beats
    .map((beat) => ({ ...beat, text: sanitizeObservationLanguage(beat.text) }))
    .filter((beat) => beat?.text);
}

function buildSceneEventBeats(draft, state, lines = []) {
  const location = getLocation(state, draft.locationId);
  const locationId = location?.id || draft.locationId || "";
  const sourceId = draft.id || "scene";
  const names = getParticipantNames(state, draft.participantIds);
  const visibleEvent = pickVisibleEvent(location, 0);
  const exchange = firstSceneAgentExchange(draft);
  const grouped = [
    [buildSpaceBeat(`${sourceId}_scene_space`, location, visibleEvent, names, locationId)],
    ...(draft.agentOutputs || []).slice(0, 3).map((output, index) => buildAgentOutputBeats(output, state, {
      sourceId: `${sourceId}_scene`,
      locationId,
      tickIndex: index,
      index,
      visibleEvent,
    })),
  ];
  if (exchange) {
    grouped.push(buildAgentExchangeBeats(exchange, state, {
      sourceId: `${sourceId}_scene_exchange`,
      locationId,
    }));
  }
  const firstTrace = (draft.irreversibleTraces || [])
    .map((trace) => cleanTrace(trace))
    .find(Boolean);
  if (firstTrace) {
    grouped.push([{
      id: `${sourceId}_scene_trace`,
      type: "trace",
      label: "痕迹",
      locationId,
      text: firstTrace,
    }]);
  }
  return lines.map((line, index) => grouped[index] || [buildLineBeat(`${sourceId}_scene_${index}`, line, locationId)]);
}

function buildAgentExchangeBeats(exchange = {}, state = {}, context = {}) {
  const dialogueBeats = (exchange.dialogueTurns || [])
    .map((turn, index) => ({
      id: `${context.sourceId || "exchange"}_dialogue_${index}`,
      type: "dialogue",
      speakerId: turn.speakerId || "",
      actorId: turn.speakerId || "",
      speakerName: turn.speakerName || getName(state, turn.speakerId),
      actorName: turn.speakerName || getName(state, turn.speakerId),
      targetId: turn.targetId || "",
      targetName: turn.targetName || getName(state, turn.targetId),
      locationId: context.locationId || "",
      text: normalizeSpeechText(turn.line || turn.text || ""),
    }))
    .filter((beat) => beat.text);
  const outcome = cleanSandboxOutcome(exchange.eventOutcome);
  const outcomeBeat = outcome ? [{
    id: `${context.sourceId || "exchange"}_outcome`,
    type: "trace",
    label: "结果",
    locationId: context.locationId || "",
    text: outcome,
  }] : [];
  return [...dialogueBeats, ...outcomeBeat];
}

function buildSpaceBeat(id, location, visibleEvent, names, locationId) {
  return {
    id,
    type: "space",
    label: "空间",
    locationId,
    text: cleanStageActionText(describeVisibleOccurrence(location, visibleEvent, names), "舞台", ""),
  };
}

function buildAgentOutputBeats(output = {}, state, context) {
  const actorId = output.characterId || "";
  const targetId = output.targetCharacterId || "";
  const actorName = getName(state, actorId) || "有人";
  const targetName = targetId ? getName(state, targetId) : "";
  const observable = cleanObservableAction(output.visibleAction, actorName, targetName, {
    ...context,
    actorId,
    targetId,
  });
  const actionText = cleanStageActionText(removeDialogueFromAction(observable), actorName, targetName, context);
  const dialogue = extractDialogue(observable);
  const beats = [];

  if (actionText) {
    beats.push({
      id: `${context.sourceId}_action_${context.index}`,
      type: "action",
      actorId,
      actorName,
      targetId,
      targetName,
      locationId: context.locationId,
      text: actionText,
    });
  }

  if (dialogue) {
    beats.push({
      id: `${context.sourceId}_dialogue_${context.index}`,
      type: "dialogue",
      actorId,
      speakerId: actorId,
      actorName,
      speakerName: actorName,
      targetId,
      targetName,
      locationId: context.locationId,
      text: dialogue,
    });
  }

  return beats.length ? beats : [buildFallbackParticipantBeat(actorId, state, context)];
}

function buildFallbackParticipantBeat(characterId, state, context = {}) {
  const actorName = getName(state, characterId) || "有人";
  return {
    id: `${context.sourceId || "stage"}_fallback_${context.index || 0}`,
    type: "action",
    actorId: characterId || "",
    actorName,
    locationId: context.locationId,
    text: buildFallbackObservableAction(actorName, "", context),
  };
}

function buildLineBeat(id, line, locationId) {
  return {
    id,
    type: "space",
    label: "舞台",
    locationId,
    text: cleanStageActionText(line, "舞台", ""),
  };
}

function extractDialogue(text = "") {
  const matches = [...String(text).matchAll(/[“"「『]([^”"」』]+)[”"」』]/g)];
  return (matches[0]?.[1] || "").trim();
}

function removeDialogueFromAction(text = "") {
  return String(text)
    .replace(/[，,、]?\s*(?:[\u4e00-\u9fa5·]{1,12})?(?:低声|轻声|压低声音|小声|急忙|慢慢)?说[：:]?[“"「『][^”"」』]+[”"」』][。！？]?/g, "")
    .replace(/[“"「『][^”"」』]+[”"」』]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[，,；;：:。]\s*$/g, "")
    .trim();
}

function cleanStageActionText(text = "", actor = "有人", target = "", context = {}) {
  const cleaned = sanitizeObservableAction(text, actor, target, context)
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || containsForbiddenObservationLanguage(cleaned)) {
    return buildFallbackObservableAction(actor, target, context);
  }
  return cleaned;
}

function stageBeatLabel(type) {
  return ({
    action: "动作",
    dialogue: "对白",
    reaction: "反应",
    space: "场面",
    trace: "痕迹",
  })[type] || "一拍";
}

function getParticipantNames(state, ids = []) {
  return (ids || []).map((id) => getName(state, id)).filter(Boolean);
}

function pickVisibleEvent(location, index) {
  const events = location?.likelyEvents || [];
  return events.length ? events[index % events.length] : "一件小事";
}

function describeVisibleOccurrence(location, event, names = []) {
  const actor = names[0] || "有人";
  const second = names[1] || "另一个人";
  const third = names[2] || "旁边的人";
  const grete = findName(names, "格蕾特") || second;
  const father = findName(names, "父亲") || actor;
  const mother = findName(names, "母亲") || third;
  const gregor = findName(names, "格里高尔") || actor;
  const clerk = findName(names, "书记员") || second;
  const lodger = findName(names, "房客") || actor;
  const descriptions = {
    门后解释失败: `${location.name}里，${gregor}隔着门说：“我马上就好。”车次表已经翻过第一行。`,
    食物被放下又被撤走: `${location.name}门口，早餐盘被放下又端起，没人说这是不是催促。`,
    家具被搬离: `${location.name}里，椅子被挪开，样品箱从床边拖到门口。`,
    身体暴露在光里: `${location.name}的窗帘被拉开，晨光照到没扣好的样品箱。`,
    闹钟迟响: `${location.name}里，闹钟迟迟响起，${gregor}先看车次表，再看门缝下的光。`,
    样品箱没扣好: `${location.name}里，样布从箱扣边缘滑出，垂到地板上。`,
    车票压在账本下: `${location.name}里，车票被压在账本下面，露出一角蓝色边。`,
    门外催促: `${location.name}门外，${mother}压低声音催他快一点，话尾停在锁孔旁。`,
    钥匙转动: `${location.name}上，钥匙在锁孔里转了半圈，又停住。`,
    书记员后退: `${clerk}在${location.name}停住脚步，先看怀表，再看门牌。`,
    书记员提前登门: `${clerk}在${location.name}摘下帽子，说：“萨姆沙先生没有上车。”`,
    父亲挡门: `${father}站到${location.name}中间，一只手按着账本，一只手扶着门框。`,
    父亲挡住账本: `${father}的手按在账本边缘，铅笔滚到桌角。`,
    母亲哀求: `${mother}扶着门框说让他再缓一会儿，声音却先传到楼梯间。`,
    母亲替他解释: `${mother}替${gregor}说身体不舒服，说完又看向账本。`,
    家庭会议: `${location.name}上，几把椅子被拉近，谁也没有先碰盘子。`,
    账本摊开: `${location.name}上，账本被摊开，铅笔在欠款旁边停住。`,
    制服出现: `${father}把旧制服拿到光下，扣子比他的话更先抵达餐桌。`,
    旧制服被翻出: `${father}从柜底翻出旧制服，又像怕被看见似的抖了抖灰。`,
    小提琴演奏: `${grete}把小提琴架到肩上，第一声弓弦让账本旁的铅笔停住。`,
    小提琴练习中断: `${grete}的琴弓停在半空，隔壁房间的催促声盖过了音阶。`,
    缺勤记录: `${location.name}里，缺勤记录被推到柜台边，墨水还没有干。`,
    上级质问: `${clerk}低声念出车次和迟到时间，柜台后的人抬起头。`,
    同事窃听: `${location.name}旁边有人停下笔，隔着文件夹听另一边的谈话。`,
    收入冻结: `${location.name}里，一枚印章落下，薪水栏被红线划住。`,
    退租威胁: `${lodger}把餐巾折成窄条推到盘边，说：“这间屋子太吵。”`,
    小提琴被评价: `${lodger}没有鼓掌，只用指节敲了敲桌面。`,
    秘密被看见: `${location.name}旁的门缝忽然亮了一下，${grete}把琴弓压低。`,
    拒付争执: `${lodger}把钱袋按在桌上，${father}的手停在半空。`,
    餐巾被折好: `${location.name}上，餐巾被折得很窄，空椅子被擦到发亮。`,
    租约草稿被提起: `${father}提到也许可以出租一间房，话一落下，餐桌安静了一拍。`,
    空椅子被擦亮: `${mother}擦亮一把没人坐的椅子，布面反出细小的晨光。`,
    小提琴声停在门外: `${grete}的音阶停在门外，她把琴弓放回盒里。`,
    错过早班车: `${location.name}上，早班车的铃声远去，站牌下只剩一只没被提起的样品箱。`,
    家人第一次轻松出门: `${location.name}上，${grete}和${mother}并肩走了一段，又同时停下回头。`,
    公司传言扩散: `${location.name}旁，有人把“没来上班”说成“这人也许撑不住了”。`,
    车票被摊开: `${location.name}上，车票被摊在掌心，${grete}第一次认真看向远处。`,
    车票被揉皱: `${location.name}上，车票被揉出折痕，早班车已经没有回头的可能。`,
    街钟报时: `${location.name}的街钟报时，声音穿过雾气，${gregor}低头看表。`,
  };
  return descriptions[event] || describeGenericVisibleOccurrence(location, event, names);
}

function describeBackgroundVisibleOccurrence(location, event, names = []) {
  return describeGenericVisibleOccurrence(location, event, names);
}

function describeGenericVisibleOccurrence(location, event, names = []) {
  const place = location?.name || "舞台";
  const raw = String(event || "一件小事");
  const actor = names[0] || "有人";
  const second = names[1] || "另一个人";
  const localOccurrence = describeXianxiaLocationOccurrence(location, raw, actor, second);
  if (localOccurrence) return localOccurrence;
  if (/灵契|验身|押契|契牌/.test(raw)) return `${placeWithSuffix(place, "前")}，界石照出两道灵痕，${actor}的契牌被扣在铜盘里。`;
  if (/破禁|扣押|锁灵/.test(raw)) return `${placeWithSuffix(place, "中间")}，破禁铃忽然响起，${second}的袖口被锁灵索扣住。`;
  if (/拍卖|妖丹|竞价|试价/.test(raw)) return `${placeWithSuffix(place, "里")}，妖丹盒被推上案台，几枚宗门令牌同时压到桌面。`;
  if (/符箓|禁术|被截|换符/.test(raw)) return `${placeWithSuffix(place, "里")}，一张禁术符箓被铜夹截住，摊主把账册翻到空白页。`;
  if (/审讯|问供|供词|魂灯|翻供/.test(raw)) return `${placeWithSuffix(place, "里")}，魂灯晃了一下，供词上的名字换了墨色。`;
  if (/剑匣|封存|执法/.test(raw)) return `${placeWithSuffix(place, "里")}，执法剑匣被封上黑绳，封条贴到照骨镜下。`;
  if (/界石|裂响|护城/.test(raw)) return `${placeWithSuffix(place, "前")}，界石裂开一道光，守门人把铜盘往回拉。`;
  if (/追捕|水阵|封渡|渡令|逃亡/.test(raw)) return `${placeWithSuffix(place, "边")}，渡令被水阵压回岸上，追来的人停在界线外。`;
  if (/庇护|医坊|庇护牌|毒伤|药方/.test(raw)) return `${placeWithSuffix(place, "里")}，庇护牌被扣到药炉旁，伤者的袖口露出另一派的纹。`;
  if (/器灵|镜|案卷|旧案|禁名|影证/.test(raw)) return `${placeWithSuffix(place, "里")}，照骨镜亮了一下，旧案卷的封线自己松开。`;
  if (/正邪|停剑令|谈判|暗杀|城主/.test(raw)) return `${placeWithSuffix(place, "上")}，停剑令压住茶盏，正邪两枚令牌隔桌相抵。`;
  if (/求救|求助|呼救/.test(raw)) return `${placeWithSuffix(place, "前")}，${second}拦到路中央，尘土沾到衣角。`;
  if (/行李|包袱|担子/.test(raw) && /落|掉|倒|摔/.test(raw)) return `${placeWithSuffix(place, "里")}，行李从肩上滑下，扣环敲到石板。`;
  if (/文牒|账本|车票|信|纸|记录/.test(raw)) return `${placeWithSuffix(place, "上")}，一页纸被推到光里，${actor}没有马上接过去。`;
  if (/钥匙|门|锁/.test(raw)) return `${placeWithSuffix(place, "旁")}，锁孔轻响了一下，${actor}把手停在门边。`;
  if (/饭|茶|酒|杯|盘|餐/.test(raw)) return `${placeWithSuffix(place, "上")}，一只杯子被推开，桌边的人都停住。`;
  if (/琴|弦|笛|鼓|歌|声/.test(raw)) return `${placeWithSuffix(place, "里")}，声音断在半拍，${second}抬头看向门口。`;
  if (/争|吵|拒|挡|拦|追/.test(raw)) return `${placeWithSuffix(place, "中间")}，${actor}挡住去路，${second}的脚步停在他面前。`;
  if (/妖|影|骨|怪|雾/.test(raw)) return `${placeWithSuffix(place, "边")}，影子从墙角掠过，${actor}先把声音压低。`;
  if (/河|水|渡|船|桥/.test(raw)) return `${placeWithSuffix(place, "边")}，水声盖住半句话，${actor}扶住行李。`;
  if (/市集|摊|买|卖|钱/.test(raw)) return `${placeWithSuffix(place, "里")}，摊前的钱被按住，旁边的人不再吆喝。`;
  return `${placeWithSuffix(place, "里")}，${actor}把一枚凭证推到明处，${second}没有马上接过去。`;
}

function describeXianxiaLocationOccurrence(location, event, actor, second) {
  const place = location?.name || "";
  switch (location?.id) {
    case "loc_xianxia_contract_gate":
      if (/灵契|验身|押契|契牌/.test(event)) return `${placeWithSuffix(place, "前")}，界石照出两道灵痕，${actor}的契牌被扣在铜盘里。`;
      if (/破禁|扣押|锁灵/.test(event)) return `${placeWithSuffix(place, "前")}，破禁铃忽然响起，锁灵索从铜盘边弹向${second}的手腕。`;
      if (/正邪|令牌|互换/.test(event)) return `${placeWithSuffix(place, "前")}，正邪两枚契牌同时碰上铜盘，界石把两道灵痕照在同一面。`;
      if (/界石|裂响|护城/.test(event)) return `${placeWithSuffix(place, "前")}，界石裂开一道光，守门人把盛着灵契的铜盘往回拉。`;
      return `${placeWithSuffix(place, "前")}，守门人按住铜盘，界石上的灵痕停在${actor}与${second}之间。`;
    case "loc_xianxia_market":
      if (/符箓|禁术|被截|换符/.test(event)) return `${placeWithSuffix(place, "里")}，一张禁术符箓被铜夹截住，摊主把账册翻到空白页。`;
      if (/妖丹|拍卖|竞价|试价/.test(event)) return `${placeWithSuffix(place, "里")}，妖丹盒被推上案台，几枚宗门令牌同时压到桌面。`;
      if (/换命|血契/.test(event)) return `${placeWithSuffix(place, "里")}，散修把血契摊在案台上，围观的人给铜夹让出一圈空地。`;
      return `${placeWithSuffix(place, "里")}，摊主按住账册，${actor}递来的货物停在铜夹下面。`;
    case "loc_xianxia_court":
      if (/魂灯|供词|翻供/.test(event)) return `${placeWithSuffix(place, "里")}，魂灯晃了一下，供词上的名字换了墨色。`;
      if (/剑匣|封存|执法/.test(event)) return `${placeWithSuffix(place, "里")}，执法剑匣被封上黑绳，封条贴到照骨镜下。`;
      if (/灵契|撕开/.test(event)) return `${placeWithSuffix(place, "里")}，灵契在照骨镜下裂成两页，书记把两页分别压住。`;
      return `${placeWithSuffix(place, "里")}，法铃响过一声，照骨镜把${actor}与${second}的灵痕投到供词上。`;
    case "loc_xianxia_ferry":
      if (/追捕|水阵|拦下/.test(event)) return `${placeWithSuffix(place, "边")}，水阵沿石阶亮起，追来的人停在界线外。`;
      if (/妖族|庇护|逃亡/.test(event)) return `${placeWithSuffix(place, "边")}，一个湿透的妖族攥着庇护牌，渡船却没有靠岸。`;
      return `${placeWithSuffix(place, "边")}，渡令被水阵压回岸上，${actor}与${second}同时停在湿冷的石阶前。`;
    case "loc_xianxia_clinic":
      if (/毒伤|伤者|藏身/.test(event)) return `${placeWithSuffix(place, "里")}，药炉旁的伤者抽回手，袖口露出一线毒纹。`;
      if (/魂灯|供词|鬼修/.test(event)) return `${placeWithSuffix(place, "里")}，半截供词被压到药炉旁，魂灯映出还没干的血迹。`;
      if (/药方|妖血/.test(event)) return `${placeWithSuffix(place, "里")}，一页妖血药方从药柜滑落，庇护牌随即被人扣住。`;
      return `${placeWithSuffix(place, "里")}，庇护牌被扣到药炉旁，伤者没有被拖出医坊。`;
    case "loc_xianxia_archive":
      if (/影证|失踪/.test(event)) return `${placeWithSuffix(place, "里")}，照骨镜亮到一半，案卷里对应的影证只剩一道空框。`;
      if (/禁名|名字/.test(event)) return `${placeWithSuffix(place, "里")}，镜面浮出一个被刮去的名字，守卷人立刻按住案卷。`;
      if (/改锁|器灵/.test(event)) return `${placeWithSuffix(place, "里")}，镜锁自己转过一格，${actor}面前的案卷换了封线。`;
      return `${placeWithSuffix(place, "里")}，照骨镜亮了一下，旧案卷的封线自己松开。`;
    case "loc_xianxia_teahouse":
      if (/暗杀|刺客/.test(event)) return `${placeWithSuffix(place, "里")}，茶盏映出桌下的一截冷光，停剑令随即压住桌沿。`;
      if (/城主|密令/.test(event)) return `${placeWithSuffix(place, "里")}，送信人把城主密令压到茶盏下，封蜡没有拆。`;
      return `${placeWithSuffix(place, "里")}，停剑令压住茶盏，正邪两枚令牌隔桌相抵。`;
    default:
      return "";
  }
}

function placeWithSuffix(place = "舞台", suffix = "里") {
  const text = String(place || "舞台");
  return text.endsWith(suffix) ? text : `${text}${suffix}`;
}

function describeDistantAftermath(location, names = [], index = 0) {
  const actors = names.length ? names.join("、") : "几个人";
  if (location.id === "loc_xianxia_contract_gate") return `${actors}把契牌留在铜盘里，守门人没有立刻盖印。`;
  if (location.id === "loc_xianxia_market") return `${actors}围着妖丹盒退开，摊位上的铜夹还扣着禁术符箓。`;
  if (location.id === "loc_xianxia_court") return `${actors}没有离开照骨镜，法铃的余音压在供词上。`;
  if (location.id === "loc_xianxia_ferry") return `${actors}停在水阵外，渡令被压回湿冷的石阶。`;
  if (location.id === "loc_xianxia_clinic") return `${actors}守着药炉和庇护牌，伤者没有被拖出医坊。`;
  if (location.id === "loc_xianxia_archive") return `${actors}把旧案卷留在镜下，封线还没有重新合拢。`;
  if (location.id === "loc_xianxia_teahouse") return `${actors}隔着茶盏坐下，停剑令仍压在两枚令牌中间。`;
  if (location.id === "loc_gregor_room") return `${actors}没有把门完全打开，房里的安静被留到下一次。`;
  if (location.id === "loc_hallway") return `${actors}在门槛边停住，楼梯间已经有人放慢脚步。`;
  if (location.id === "loc_parlor") return `${actors}继续坐着，餐具声比谈话更清楚。`;
  if (location.id === "loc_office_counter") return `${actors}把名字留在纸面上，事情还没传回公寓。`;
  if (location.id === "loc_lodgers_table") return `${actors}各自盯着桌面，谁也没有碰那只空杯。`;
  const variants = [
    `${actors}把声音压低，脚步停在门槛外。`,
    `${actors}没有追上去，只留下桌边一点响动。`,
    `${actors}各自退开半步，刚才的话还悬在房间里。`,
    `${actors}把手边的东西放回原位，谁也没有先开口。`,
  ];
  return variants[index % variants.length];
}

function findName(names, keyword) {
  return names.find((name) => name.includes(keyword));
}

function cleanVisibleAction(text = "", actor = "有人", target = "", context = {}) {
  return sanitizeObservableAction(text, actor, target, context)
    .trim();
}

function cleanObservableAction(text = "", actor = "有人", target = "", context = {}) {
  const cleaned = cleanVisibleAction(text, actor, target, context);
  if (!cleaned || containsForbiddenObservationLanguage(cleaned)) {
    return buildFallbackObservableAction(actor, target, context);
  }
  return cleaned;
}

function buildFallbackObservableAction(actor = "有人", target = "", context = {}) {
  const targetName = target && target !== actor ? target : "门里的人";
  if (/格里高尔/.test(actor)) return pickFallbackAction([
    `${actor}贴近门缝，手指停在车次表边。`,
    `${actor}把样布从箱扣旁拽回去。`,
    `${actor}在地板上挪了一下，箱扣轻响。`,
    `${actor}把车票压到账本下面。`,
    `${actor}撑住床沿，袖口碰到样品箱。`,
  ], context);
  if (/格蕾特/.test(actor)) return pickFallbackAction([
    `${actor}把手放在门板上，指节停了一下。`,
    `${actor}把琴弓放回盒里。`,
    `${actor}把餐盘移到门边，又收回一点。`,
    `${actor}在餐桌旁停住，没有碰盘子。`,
    `${actor}把椅背上的围巾取下，攥在手里。`,
  ], context);
  if (/父亲|萨姆沙父亲/.test(actor)) return pickFallbackAction([
    `${actor}把账本按到桌面上，椅脚向后擦过地板。`,
    `${actor}把椅子拉近餐桌，手停在账本边。`,
    `${actor}把旧制服从椅背上拿起。`,
    `${actor}用指节敲了敲门框。`,
    `${actor}把铅笔压在欠款旁边。`,
  ], context);
  if (/母亲|萨姆沙母亲/.test(actor)) return pickFallbackAction([
    `${actor}扶住门框，低声劝${targetName}。`,
    `${actor}把餐具整理到一边。`,
    `${actor}把手帕攥在掌心。`,
    `${actor}把椅子往后挪了一点。`,
    `${actor}把早餐盘端起，又放回门边。`,
  ], context);
  if (/书记员/.test(actor)) return pickFallbackAction([
    `${actor}把怀表合上，把缺勤记录推到灯下。`,
    `${actor}把帽檐压低，手指停在门牌旁。`,
    `${actor}把车次表折起，夹进记录簿。`,
    `${actor}在柜台边停笔，墨迹留在缺勤栏。`,
  ], context);
  if (/房客/.test(actor)) return pickFallbackAction([
    `${actor}把餐巾折窄，指节敲了敲桌沿。`,
    `${actor}把钱袋按在盘边，刀叉停在半空。`,
    `${actor}把椅子转开一点，鞋尖抵住桌脚。`,
    `${actor}把杯子推远，杯底划过木面。`,
  ], context);
  if (/唐僧/.test(actor)) return pickFallbackAction([
    `${actor}停在路口，把通关文牒收进袖中。`,
    `${actor}把缰绳绕回掌心。`,
    `${actor}在山门前合起经卷。`,
    `${actor}把马牵到路边，袈裟扫过尘土。`,
  ], context);
  if (/孙悟空/.test(actor)) return pickFallbackAction([
    `${actor}绕到前面，金箍棒点了一下地面。`,
    `${actor}跃到石阶边，手搭凉棚。`,
    `${actor}把金箍棒横在路中央。`,
    `${actor}蹲到草丛旁，拨开一截枯枝。`,
  ], context);
  if (/猪八戒/.test(actor)) return pickFallbackAction([
    `${actor}扶住行李担，脚步停在路边。`,
    `${actor}把钉耙靠到肩上，行李绳勒住袖口。`,
    `${actor}挪到茶棚边，手还扣着担绳。`,
    `${actor}把包袱往背上颠了一下。`,
  ], context);
  if (/沙悟净/.test(actor)) return pickFallbackAction([
    `${actor}把行李往肩上稳了稳。`,
    `${actor}扶住担杖，脚跟停在车辙里。`,
    `${actor}把水袋递到路边石上。`,
    `${actor}把包袱重新扎紧。`,
  ], context);
  if (/白骨|妖/.test(actor)) return pickFallbackAction([
    `${actor}停在阴影里，把声音压低。`,
    `${actor}把袖口掩到篮子边。`,
    `${actor}从树后退开半步。`,
    `${actor}把脚印扫乱，裙角擦过草叶。`,
  ], context);
  return pickFallbackAction(
    target && target !== actor
      ? [
          `${actor}向${target}走近半步。`,
          `${actor}把手边的东西推到${target}面前。`,
          `${actor}停在${target}旁边，手指扣住桌沿。`,
        ]
      : [
          `${actor}停住脚步。`,
          `${actor}把手边的东西放回原处。`,
          `${actor}往后退开半步。`,
        ],
    context,
  );
}

function pickFallbackAction(actions = [], context = {}) {
  if (!actions.length) return "";
  return actions[fallbackVariantIndex(context) % actions.length];
}

function fallbackVariantIndex(context = {}) {
  const tickIndex = finiteNumber(context.tickIndex, 0);
  const itemIndex = finiteNumber(context.index, 0);
  const eventSeed = hashFallbackSeed(`${context.visibleEvent || ""}:${context.locationId || ""}`);
  return Math.max(0, tickIndex * 3 + itemIndex + (eventSeed % 2));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function hashFallbackSeed(value = "") {
  return [...String(value)].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function fallbackDialogueFor(actor = "", target = "") {
  if (/唐僧/.test(actor)) return "先停一停。";
  if (/孙悟空/.test(actor)) return "我去前面看看。";
  if (/猪八戒/.test(actor)) return "这路不对劲。";
  if (/沙悟净/.test(actor)) return "行李我扶着。";
  if (/白骨|妖/.test(actor)) return "再往前走几步。";
  if (/格里高尔/.test(actor)) return "我马上就好。";
  if (/格蕾特/.test(actor)) return "你先别开门。";
  if (/父亲|萨姆沙父亲/.test(actor)) return "把账本拿来。";
  if (/母亲|萨姆沙母亲/.test(actor)) return "让他再缓一会儿。";
  if (/书记员/.test(actor)) return "早班车已经走了。";
  if (/房客/.test(actor)) return "这间屋子得安静。";
  if (target && target !== actor) return `${target}，先停一下。`;
  return "先停一下。";
}

function cleanTrace(text = "") {
  return stripEngineLanguage(text)
    .replace(/^.*?：/, "")
    .replace(/^.*?留下：/, "")
    .trim();
}

function stripEngineLanguage(text = "") {
  return String(text)
    .replace(/\b(accurate|selective|misremembered|suppressed|fabricated|weaponized)\b/g, "")
    .replace(/私人模拟|实时模拟|低精度|后台运行|可见场所|行动候选|自主计划|把动作推向|表面上|实际上/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeObservableAction(text = "", actor = "有人", target = "", context = {}) {
  const raw = truncateInternalActionTail(String(text || ""));
  const materialized = materializeExplanatoryAction(raw, actor, target, context);
  const stripped = stripEngineLanguage(materialized)
    .replace(/\s+/g, " ")
    .trim();
  const normalized = normalizeGenericAction(stripped, actor, target, context);
  return ensureSentence(normalized);
}

function truncateInternalActionTail(text = "") {
  return String(text)
    .split(/(?:\s|。|；|;)*(?:这一次，|自主计划|把动作推向|计划的|更深|真正|这段记忆|表面上|实际上|后台动作|私人模拟)/)[0]
    .trim();
}

function materializeExplanatoryAction(text = "", actor = "有人", target = "", context = {}) {
  const reasonMatch = String(text).match(/^(.+?)以(.+?)为理由，?给了(.+?)一个比旁人更细的回应[。.]?$/);
  if (!reasonMatch) return text;
  const subject = reasonMatch[1]?.trim() || actor;
  const actionList = reasonMatch[2]?.trim() || "";
  const targetName = target || reasonMatch[3]?.trim() || "对方";
  const parts = actionList
    .split(/[、，,]/)
    .map((part) => materializeActionPart(part.trim(), targetName))
    .filter(Boolean);
  if (!parts.length) return buildFallbackObservableAction(subject, targetName, context);
  return `${subject}${parts.join("，")}`;
}

function materializeActionPart(part = "", target = "") {
  if (!part) return "";
  if (/^扶门框$/.test(part)) return "扶住门框";
  if (/^低声劝$/.test(part)) return `低声劝${target || "对方"}`;
  if (/^避开(.+)/.test(part)) return `避开${part.replace(/^避开/, "")}`;
  if (/^整理(.+)/.test(part)) return `把${part.replace(/^整理/, "")}整理到一边`;
  if (/^送食物$/.test(part)) return "把餐盘放到门边";
  if (/^清理房间$/.test(part)) return "把散在地上的东西收到墙边";
  if (/^维持家中秩序$/.test(part)) return "把椅子推回桌边";
  if (/^保护/.test(part)) return part.replace(/^保护/, "挡在") || "";
  return part;
}

function normalizeGenericAction(text = "", actor = "有人", target = "", context = {}) {
  const cleaned = String(text || "")
    .replace(/[。！？]\s*$/g, "")
    .trim();
  if (!cleaned) return "";
  const actorPattern = escapeRegExp(actor);
  const targetPattern = target ? escapeRegExp(target) : ".+?";
  const genericLook = new RegExp(`^${actorPattern}?看向${targetPattern}$`);
  if (genericLook.test(cleaned) || /^看向.+/.test(cleaned) || /^[^。！？]{1,24}看向[^。！？]{1,24}$/.test(cleaned)) {
    return buildFallbackObservableAction(actor, target, context);
  }
  if (/保持表面身份|维持表面身份|等待对方|看似普通|露出反应|给了.+回应|为理由/.test(cleaned)) {
    return buildFallbackObservableAction(actor, target, context);
  }
  return cleaned;
}

function ensureSentence(text = "") {
  const cleaned = String(text || "").trim();
  if (!cleaned) return "";
  return /[。！？][”"」』）)]?$/.test(cleaned) ? cleaned : `${cleaned}。`;
}

function escapeRegExp(text = "") {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderObserverLine(event) {
  const prose = buildObserverProse(event);
  return `
    <article class="observer-prose-line ${event.tone}" data-observer-prose="true" style="--i:${Number(event.index || 0)}">
      <p class="observer-prose-text">${escapeHtml(prose)}</p>
    </article>
  `;
}

function buildObserverProse(event = {}) {
  const fragments = [];
  const mainText = ensureSentence(event.text || "");
  const timePrefix = observerTimePrefix(event.time);
  if (mainText) fragments.push(timePrefix ? `${timePrefix}${mainText}` : mainText);

  const beatFragments = /说：“/.test(mainText) ? [] : (event.beats || [])
    .filter((beat) => beat.type === "dialogue")
    .map((beat) => ({
      text: observerBeatToProse(beat),
      speech: beat.type === "dialogue" ? normalizeSpeechText(beat.text) : "",
    }))
    .filter((fragment) => fragment.text)
    .filter((fragment) => shouldAppendObserverFragment(fragment.text, fragments, fragment.speech))
    .map((fragment) => fragment.text);

  const detailLimit = 1;
  for (const fragment of beatFragments.slice(0, detailLimit)) {
    fragments.push(fragment);
  }
  return joinObserverFragments(fragments) || "没有人开口，房间里的东西停在原处。";
}

function observerTimePrefix(time = "") {
  const cleaned = String(time || "").trim();
  if (!cleaned || /^[ST]\+/.test(cleaned)) return "";
  return `${cleaned}，`;
}

function observerBeatToProse(beat = {}) {
  if (!beat.text || beat.type === "space") return "";
  if (beat.type === "dialogue") {
    const speaker = beat.speakerName || beat.actorName || beat.label || "";
    const speech = normalizeSpeechText(sanitizeObservationLanguage(beat.text));
    if (!speech) return "";
    return speaker ? `${speaker}说：“${speech}”` : `有人说：“${speech}”`;
  }
  return ensureSentence(sanitizeObservationLanguage(beat.text));
}

function normalizeSpeechText(text = "") {
  const cleaned = String(text || "")
    .replace(/^[“"「『]+/, "")
    .replace(/[”"」』]+$/, "")
    .trim();
  if (!cleaned) return "";
  return /[。！？…]$/.test(cleaned) ? cleaned : `${cleaned}。`;
}

function shouldAppendObserverFragment(fragment, existingFragments = [], speech = "") {
  const comparableSpeech = comparableObserverText(speech);
  if (comparableSpeech && existingFragments.some((existing) => comparableObserverText(existing).includes(comparableSpeech))) {
    return false;
  }
  const comparable = comparableObserverText(fragment);
  if (!comparable || comparable.length < 6) return false;
  return !existingFragments.some((existing) => {
    const existingComparable = comparableObserverText(existing);
    return existingComparable.includes(comparable) || comparable.includes(existingComparable);
  });
}

function comparableObserverText(text = "") {
  return String(text || "")
    .replace(/[“”"「」『』，,。！？；;：:\s]/g, "")
    .trim();
}

function joinObserverFragments(fragments = []) {
  return fragments
    .map((fragment) => String(fragment || "").trim())
    .filter(Boolean)
    .join("");
}

function renderObserverEmpty(state) {
  const focusLocation = state.locations.find((location) => location.id === state.ui.selectedLocationId) || state.locations[0];
  const scopeName = state.ui.focusMode === "location" ? focusLocation?.name : state.town?.name;
  return `
    <div class="observer-empty">
      <div class="observer-empty-title">${escapeHtml(scopeName || "舞台")}静止在第一秒</div>
      <div class="observer-empty-text">按下开始观察。</div>
    </div>
  `;
}

function timeGrainLabel(value) {
  return ({ beat: "一拍", scene: "一场", day: "一天", week: "一周" })[value] || value || "一场";
}

function formatDraftTime(value) {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function renderControlDeck(state) {
  const draft = getLastDraft(state);
  return `
    <section class="grid grid-3">
      <div class="panel">
        <div class="panel-header"><div><div class="panel-title">焦点人物</div><div class="panel-kicker">只影响一拍/一场；一天/一周会自动纳入全镇角色</div></div></div>
        <div class="panel-body stack">
          ${state.characters.map((character) => renderParticipantCard(character, state)).join("")}
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <div><div class="panel-title">当前草稿</div><div class="panel-kicker">播放生成草稿，赞同后写入正史</div></div>
          <div class="row">
            <button class="btn small ${state.ui.detailMode === "scene" ? "primary" : "ghost"}" data-action="detail-mode" data-mode="scene">场景</button>
            <button class="btn small ${state.ui.detailMode === "agents" ? "primary" : "ghost"}" data-action="detail-mode" data-mode="agents">角色线路</button>
            <button class="btn small ${state.ui.detailMode === "subtext" ? "primary" : "ghost"}" data-action="detail-mode" data-mode="subtext">潜台词</button>
            <button class="btn small ${state.ui.detailMode === "audit" ? "primary" : "ghost"}" data-action="detail-mode" data-mode="audit">审查</button>
            <button class="btn small ${state.ui.detailMode === "pipeline" ? "primary" : "ghost"}" data-action="detail-mode" data-mode="pipeline">流水线</button>
            <button class="btn small ${state.ui.detailMode === "state" ? "primary" : "ghost"}" data-action="detail-mode" data-mode="state">状态理由</button>
            <button class="btn small ${state.ui.detailMode === "simulation" ? "primary" : "ghost"}" data-action="detail-mode" data-mode="simulation">模拟</button>
          </div>
        </div>
        <div class="panel-body">
          ${draft ? renderDraft(draft, state) : `<div class="scene-box scene-empty">还没有草稿。选择人物与地点后点击“播放”。</div>`}
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><div><div class="panel-title">操盘面板</div><div class="panel-kicker">控制地点、粒度、意外事件与正史写入</div></div></div>
        <div class="panel-body">
          ${renderControlPanel(state, draft)}
        </div>
      </div>
    </section>
  `;
}

function renderParticipantCard(character, state) {
  const active = state.ui.activeCharacterIds.includes(character.id);
  const selected = state.ui.selectedCharacterId === character.id;
  const st = character.currentState;
  const life = character.lifeState || {};
  const needs = life.needs || {};
  return `
    <div class="card ${active ? "selected" : ""}">
      <div class="card-title">
        <div>
          <button class="btn small ${selected ? "primary" : "ghost"}" data-action="select-character" data-id="${character.id}">${escapeHtml(character.name)}</button>
          <div class="card-subtitle">${escapeHtml(character.publicIdentity)}</div>
        </div>
        <label class="badge ${active ? "hot" : ""}"><input type="checkbox" ${active ? "checked" : ""} data-action="toggle-active" data-id="${character.id}" /> 焦点</label>
      </div>
      <div class="badge-row">
        ${state.worldSetup?.fixedStage ? `
          <span class="badge ${life.present ? "hot" : ""}">${life.present ? "在店" : "离店"}</span>
          <span class="badge">饿意 ${Number(needs.hunger || 0)}</span>
          <span class="badge">疲惫 ${Number(needs.fatigue || 0)}</span>
          <span class="badge">自己的事 ${Number(needs.autonomy || 0)}</span>
        ` : `
          <span class="badge">欲望 ${st.desire}</span>
          <span class="badge">羞耻 ${st.shame}</span>
          <span class="badge">自欺 ${st.selfDeception}</span>
          <span class="badge danger">报复 ${st.revengeImpulse}</span>
        `}
      </div>
      <div class="hr"></div>
      ${state.worldSetup?.fixedStage ? `
        <div class="small muted">现在：${escapeHtml(life.currentActivity?.description || character.currentActivity?.description || "尚未开始当天的事")}</div>
        <div class="small muted">不肯做：${escapeHtml(character.lifeProfile?.refusal || "")}</div>
      ` : `
        <div class="small muted">显性：${escapeHtml(character.actionLines.visible)}</div>
        <div class="small muted">阴影：${escapeHtml(character.actionLines.shadow)}</div>
      `}
    </div>
  `;
}

function renderControlPanel(state, draft) {
  return `
    ${state.worldSetup?.fixedStage ? `
      <div class="scope-summary" data-scope-summary="fixed-stage"><span>固定舞台</span><strong>${escapeHtml(state.locations?.[0]?.name || "望梯酒馆")}</strong></div>
    ` : `
      <div class="field">
        <label>焦点地点</label>
        <select class="select" data-action="ui-select" data-key="selectedLocationId">
          ${state.locations.map((location) => `<option value="${location.id}" ${state.ui.selectedLocationId === location.id ? "selected" : ""}>${escapeHtml(location.name)}</option>`).join("")}
        </select>
      </div>
    `}
    <div class="grid grid-2-tight">
      <div class="field">
        <label>播放粒度</label>
        <select class="select" data-action="ui-select" data-key="timeGrain">
          ${[["beat","一拍"],["scene","一场"],["day","一天"],["week","一周"]].map(([value,label]) => `<option value="${value}" ${state.ui.timeGrain === value ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </div>
      ${state.worldSetup?.fixedStage ? "" : `<div class="field">
        <label>观察模式</label>
        <select class="select" data-action="ui-select" data-key="focusMode">
          ${[["ambient","全镇背景"],["location","聚焦地点"]].map(([value,label]) => `<option value="${value}" ${state.ui.focusMode === value ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </div>`}
    </div>
    <div class="grid grid-2-tight">
      <div class="field">
        <label>驱动模式</label>
        <select class="select" data-action="ui-select" data-key="engineMode">
          ${[["local","本地沙盘"],["auto","自动"],["openai","真实模型"],["mock","浏览器 mock"]].map(([value,label]) => `<option value="${value}" ${state.ui.engineMode === value ? "selected" : ""}>${label}</option>`).join("")}
        </select>
        <div class="micro dim">本地沙盘可离线快速运行；自动和真实模型会交给本地 server 的多代理流水线。</div>
      </div>
    </div>
    <div class="field">
      <label>本轮操盘指令</label>
      <textarea class="textarea" data-action="ui-input" data-key="userDirective">${escapeHtml(state.ui.userDirective)}</textarea>
    </div>
    <div class="field">
      <label>注入意外事件</label>
      <textarea class="textarea" data-action="ui-input" data-key="injectedEvent" placeholder="例如：一封误投邮件出现在学生论坛截图里。">${escapeHtml(state.ui.injectedEvent || "")}</textarea>
    </div>
    <div class="field">
      <label>意外冲击强度：${Number(state.ui.eventImpact || 0)}</label>
      <input type="range" min="0" max="100" value="${Number(state.ui.eventImpact || 0)}" data-action="ui-range" data-key="eventImpact" />
      <div class="micro dim">强度会影响谣言扩散、证据误读和人物状态更新。</div>
    </div>
    ${renderInterventionMiniPanel(state)}
    <div class="row">
      <button class="btn primary" data-action="play">播放</button>
      <button class="btn good" data-action="accept-draft" ${draft ? "" : "disabled"}>完整赞同</button>
      <button class="btn good" data-action="accept-partial-draft" ${draft ? "" : "disabled"}>部分赞同</button>
      <button class="btn" data-action="play">重掷</button>
      <button class="btn" data-action="fork-draft" ${draft ? "" : "disabled"}>从草稿开分支</button>
    </div>
    ${renderPartialAcceptance(state)}
    <div class="hr"></div>
    <div class="row">
      <button class="btn small" data-action="detail-mode" data-mode="agents">深挖人物</button>
      <button class="btn small" data-action="detail-mode" data-mode="subtext">查看潜台词</button>
      <button class="btn small" data-action="detail-mode" data-mode="audit">深度审查</button>
      <button class="btn small" data-action="detail-mode" data-mode="pipeline">流水线</button>
      <button class="btn small" data-action="detail-mode" data-mode="state">状态理由</button>
      <button class="btn small" data-action="detail-mode" data-mode="simulation">实时模拟</button>
      <button class="btn small" data-action="tab" data-tab="simulation">模拟页</button>
      <button class="btn small" data-action="inject-random-event">随机意外</button>
      <button class="btn small" data-action="tab" data-tab="timeline">关系回放</button>
      <button class="btn small" data-action="tab" data-tab="plans">计划层</button>
    </div>
    <div class="hr"></div>
    ${renderBranchIsolationStatus(state)}
    <div class="hr"></div>
    ${renderRelationshipSnapshot(state)}
  `;
}


function renderInterventionMiniPanel(state) {
  const active = (state.interventions || []).filter((item) => item.enabled !== false && item.consumed !== true);
  return `
    <div class="card intervention-card">
      <div class="card-title"><span>操盘干预</span><span class="badge hot">${active.length} 个有效</span></div>
      <div class="micro dim">干预会进入 CharacterAgent→Director 播放循环，强制人物以自己的动机执行误读、保护、陷害、沉默、承认等动作。</div>
      <div class="badge-row">
        ${active.slice(0, 4).map((item) => `<span class="badge">${escapeHtml(interventionTypeLabel(item.type))}/${escapeHtml(interventionActionLabel(item.action))} · ${escapeHtml(getName(state, item.targetCharacterId || item.characterId))}</span>`).join("")}
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn small" data-action="tab" data-tab="interventions">打开干预层</button>
      </div>
    </div>
  `;
}

function renderPlanView(state) {
  const plans = ensureCharacterPlans(state);
  const audit = auditPlans({ ...state, characterPlans: plans }, getLastDraft(state));
  return `
    <section class="grid grid-2">
      <div class="panel">
        <div class="panel-header"><div><div class="panel-title">角色自主计划层</div><div class="panel-kicker">每个人物拥有短期计划、中期伪装、长期自我神话；播放时角色代理会执行、背叛或暴露计划。</div></div></div>
        <div class="panel-body stack">
          <div class="badge-row">
            <span class="badge">计划使用分 ${audit.planUseScore}</span>
            <span class="badge ${audit.planRisk > 60 ? "danger" : ""}">计划风险 ${audit.planRisk}</span>
            <span class="badge">高压计划 ${audit.highPressurePlanCount}</span>
            <span class="badge">冻结计划 ${audit.frozenPlanCount}</span>
          </div>
          ${(audit.warnings || []).length ? `<div class="callout warning">${audit.warnings.map(escapeHtml).join("<br/>")}</div>` : `<div class="callout good">当前计划层可用。下一次播放会把计划写进角色线路与状态理由。</div>`}
          ${plans.map((plan) => renderPlannerV10Card(plan, state)).join("")}
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><div><div class="panel-title">计划如何进入故事</div><div class="panel-kicker">这不是剧情大纲，而是人物私下谋划自己的命运。</div></div></div>
        <div class="panel-body stack">
          <div class="scene-box">
            ${plans.slice(0, 4).map((plan) => `<p>${escapeHtml(summarizePlan(plan, state))}</p>`).join("")}
          </div>
          <div class="card">
            <div class="card-title">硬规则</div>
            <ul class="small-list">
              <li>短期计划必须转化为可表演行动：接近、撤退、保护、惩罚、设证、藏证、承认、背叛或自毁。</li>
              <li>中期伪装负责把真实目的改名为原则、爱、学术、保护、正义或牺牲。</li>
              <li>长期自我神话负责制造人物最不愿失去的解释权。</li>
              <li>高压计划如果没有进入行动，DepthAuditor 会判定人物只是响应场景。</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderPlannerV10Card(plan, state) {
  const character = state.characters.find((item) => item.id === plan.characterId);
  const targetOptions = state.characters.map((character) => `<option value="${character.id}" ${plan.targetCharacterId === character.id ? "selected" : ""}>${escapeHtml(character.name)}</option>`).join("");
  return `
    <div class="card plan-card">
      <div class="card-title">
        <div>
          <div>${escapeHtml(character?.name || plan.characterId)}</div>
          <div class="card-subtitle">${escapeHtml(character?.publicIdentity || "")}</div>
        </div>
        <div class="row">
          <button class="btn small ${plan.status === "frozen" ? "danger" : "ghost"}" data-action="plan-freeze" data-id="${plan.characterId}">${plan.status === "frozen" ? "解冻" : "冻结"}</button>
          <button class="btn small" data-action="plan-regenerate" data-id="${plan.characterId}">重建</button>
        </div>
      </div>
      <div class="badge-row">
        <span class="badge">${escapeHtml(planStatusLabel(plan.status))}</span>
        <span class="badge">${escapeHtml(tacticLabel(plan.currentTactic))}</span>
        <span class="badge">进度 ${plan.progress}</span>
        <span class="badge ${plan.pressure > 70 ? "hot" : ""}">压力 ${plan.pressure}</span>
        <span class="badge ${plan.risk > 70 ? "danger" : ""}">暴露风险 ${plan.risk}</span>
      </div>
      <div class="grid grid-2-tight">
        <div class="field"><label>目标人物</label><select class="select" data-action="plan-select" data-id="${plan.id}" data-key="targetCharacterId">${targetOptions}</select></div>
        <div class="field"><label>当前战术</label><select class="select" data-action="plan-select" data-id="${plan.id}" data-key="currentTactic">${planTactics.map(([value,label]) => `<option value="${value}" ${plan.currentTactic === value ? "selected" : ""}>${label}</option>`).join("")}</select></div>
        <div class="field"><label>状态</label><select class="select" data-action="plan-select" data-id="${plan.id}" data-key="status">${planStatusOptions.map(([value,label]) => `<option value="${value}" ${plan.status === value ? "selected" : ""}>${label}</option>`).join("")}</select></div>
        <div class="field"><label>优先级 ${plan.priority}</label><input type="range" min="0" max="100" value="${plan.priority}" data-action="plan-range" data-id="${plan.id}" data-key="priority" /></div>
      </div>
      ${renderPlannerV10TextField(plan, "shortTermPlan", "短期计划")}
      ${renderPlannerV10TextField(plan, "midTermMask", "中期伪装")}
      ${renderPlannerV10TextField(plan, "longTermSelfMyth", "长期自我神话")}
      ${renderPlannerV10TextField(plan, "hiddenObjective", "隐藏目标")}
      ${renderPlannerV10TextField(plan, "nextActionBias", "下一步偏置")}
      ${renderPlannerV10TextField(plan, "planObstacle", "计划阻力")}
      ${renderPlannerV10TextField(plan, "selfSabotage", "自我破坏点")}
      ${(plan.planLog || []).length ? `<details><summary>计划日志</summary><div class="stack">${plan.planLog.slice(0, 6).map((item) => `<div class="micro dim">${escapeHtml(item.at || "")}｜${escapeHtml(item.line || item)}</div>`).join("")}</div></details>` : ""}
    </div>
  `;
}

function renderPlannerV10TextField(plan, key, label) {
  return `<div class="field"><label>${label}</label><textarea class="textarea compact" data-action="plan-edit" data-id="${plan.id}" data-key="${key}">${escapeHtml(plan[key] || "")}</textarea></div>`;
}

function renderInterventionLab(state) {
  return `
    <section class="grid grid-2 intervention-lab">
      <div class="panel">
        <div class="panel-header"><div><div class="panel-title">新增操盘干预</div><div class="panel-kicker">不是写情节命令，而是改写人物下一步行动的内在约束</div></div></div>
        <div class="panel-body">
          ${renderInterventionForm(state)}
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><div><div class="panel-title">有效干预</div><div class="panel-kicker">干预按当前分支隔离；next_play 会在赞同后消耗</div></div><button class="btn small danger" data-action="clear-interventions">清空</button></div>
        <div class="panel-body stack">
          ${renderInterventionList(state)}
        </div>
      </div>
    </section>
  `;
}

function renderInterventionForm(state) {
  const draft = state.ui.interventionDraft || {};
  const active = state.ui.activeCharacterIds || [];
  const first = draft.targetCharacterId || active[0] || state.characters[0]?.id;
  const second = draft.secondaryCharacterId || active.find((id) => id !== first) || state.characters.find((c) => c.id !== first)?.id || first;
  return `
    <form id="operator-intervention-form" class="stack">
      <div class="grid grid-2-tight">
        <div class="field"><label>干预类型</label><select class="select" name="type" data-action="intervention-draft" data-key="type">
          ${interventionTypeOptions().map(([value, label]) => `<option value="${value}" ${draft.type === value ? "selected" : ""}>${label}</option>`).join("")}
        </select></div>
        <div class="field"><label>行动方向</label><select class="select" name="action" data-action="intervention-draft" data-key="action">
          ${interventionActionOptions().map(([value, label]) => `<option value="${value}" ${draft.action === value ? "selected" : ""}>${label}</option>`).join("")}
        </select></div>
      </div>
      <div class="grid grid-2-tight">
        <div class="field"><label>行动人物</label><select class="select" name="targetCharacterId" data-action="intervention-draft" data-key="targetCharacterId">
          ${state.characters.map((character) => `<option value="${character.id}" ${first === character.id ? "selected" : ""}>${escapeHtml(character.name)}</option>`).join("")}
        </select></div>
        <div class="field"><label>对象人物</label><select class="select" name="secondaryCharacterId" data-action="intervention-draft" data-key="secondaryCharacterId">
          ${state.characters.map((character) => `<option value="${character.id}" ${second === character.id ? "selected" : ""}>${escapeHtml(character.name)}</option>`).join("")}
        </select></div>
      </div>
      <div class="field"><label>干预指令</label><textarea class="textarea" name="instruction" data-action="intervention-draft" data-key="instruction" placeholder="例如：让林澄保护沈闻山，但保护本身也成为占有与报复。">${escapeHtml(draft.instruction || "")}</textarea></div>
      <div class="grid grid-2-tight">
        <div class="field"><label>强度：${Number(draft.intensity || state.ui.eventImpact || 60)}</label><input type="range" min="0" max="100" name="intensity" value="${Number(draft.intensity || state.ui.eventImpact || 60)}" data-action="intervention-draft-range" data-key="intensity" /></div>
        <div class="field"><label>持续方式</label><select class="select" name="persistence" data-action="intervention-draft" data-key="persistence">
          ${[["next_play","只作用下一次播放"],["persistent","持续到手动删除"]].map(([value,label]) => `<option value="${value}" ${draft.persistence === value ? "selected" : ""}>${label}</option>`).join("")}
        </select></div>
      </div>
      <div class="row"><button class="btn primary" type="submit">加入干预</button><button class="btn" type="button" data-action="play">加入后可直接播放</button></div>
    </form>
  `;
}

function renderInterventionList(state) {
  const items = state.interventions || [];
  if (!items.length) return `<div class="scene-empty">还没有操盘干预。新增一个干预后，播放会强制人物把它转成行动。</div>`;
  return items.map((item) => `
    <div class="card ${item.enabled === false || item.consumed ? "soft-card" : "selected"}">
      <div class="card-title">
        <span>${escapeHtml(interventionTypeLabel(item.type))} / ${escapeHtml(interventionActionLabel(item.action))}</span>
        <span class="badge ${item.enabled !== false && !item.consumed ? "hot" : ""}">${item.consumed ? "已消耗" : item.enabled === false ? "停用" : "有效"}</span>
      </div>
      ${renderKv("人物", `${getName(state, item.targetCharacterId || item.characterId)} → ${getName(state, item.secondaryCharacterId || item.targetId)}`)}
      ${renderKv("指令", item.instruction)}
      ${renderKv("强度", String(item.intensity || 0))}
      ${renderKv("持续", item.persistence === "persistent" ? "持续" : "下一次播放")}
      <div class="row" style="margin-top:10px">
        <button class="btn small" data-action="toggle-intervention" data-id="${item.id}">${item.enabled === false ? "启用" : "停用"}</button>
        <button class="btn small danger" data-action="delete-intervention" data-id="${item.id}">删除</button>
      </div>
    </div>
  `).join("");
}

function interventionTypeOptions() {
  return [["lock_motivation","锁定动机"],["lock_relationship","锁定关系方向"],["force_misread","强制误读"],["force_action","强制行动"],["event_impact","事件冲击"],["force_silence","强制沉默"],["force_protect","强制保护"],["force_betray","强制陷害/背叛"],["force_confession","强制承认"]];
}
function interventionActionOptions() {
  return [["misread","误读"],["protect","保护"],["frame","陷害/设证"],["silence","沉默"],["confess","承认"],["approach","接近"],["withdraw","撤退"],["punish","惩罚"],["save","拯救"],["betray","背叛"],["self_destroy","自毁"],["force_noble","高尚但污染"],["force_vile","卑劣但求救"]];
}
function interventionTypeLabel(type) { return Object.fromEntries(interventionTypeOptions())[type] || type || "干预"; }
function interventionActionLabel(action) { return Object.fromEntries(interventionActionOptions())[action] || action || "行动"; }


function renderPartialAcceptance(state) {
  const pa = state.ui.partialAcceptance || {};
  const items = [
    ["scene", "场景文本"],
    ["characters", "人物状态"],
    ["relationships", "关系变化"],
    ["rumors", "谣言"],
    ["evidence", "证据"],
    ["characterMemories", "人物记忆"],
    ["characterPlans", "角色计划"],
    ["irreversibleTraces", "不可逆痕迹"],
    ["stateChangeReasons", "状态理由"],
  ];
  return `
    <div class="card partial-card">
      <div class="panel-title small">部分赞同范围</div>
      <div class="badge-row">
        ${items.map(([key, label]) => `<label class="badge"><input type="checkbox" ${pa[key] !== false ? "checked" : ""} data-action="partial-accept" data-key="${key}" /> ${label}</label>`).join("")}
      </div>
      <div class="micro dim">部分赞同会把当前草稿按勾选项写入正史；未勾选的状态不更新。</div>
    </div>
  `;
}


function renderBranchIsolationStatus(state) {
  const activeBranch = getActiveBranch(state);
  const stats = getBranchSnapshotStats(state, activeBranch?.id);
  return `
    <div class="card branch-isolation-card">
      <div class="card-title"><span>分支隔离状态</span><span class="badge hot">${escapeHtml(activeBranch?.title || "当前分支")}</span></div>
      <div class="badge-row">
        <span class="badge">人物 ${stats.characters}</span>
        <span class="badge">关系 ${stats.relationships}</span>
        <span class="badge">正史 ${stats.canonEvents}</span>
        <span class="badge">草稿 ${stats.draftScenes}</span>
        <span class="badge danger">痕迹 ${stats.irreversibleTraces}</span>
      </div>
      <div class="micro dim">v1.2：分支仍隔离快照；实时模拟 tick、角色计划、记忆、证据、谣言和不可逆痕迹会随当前分支分叉，不会污染其他命运线。</div>
    </div>
  `;
}

function renderRelationshipSnapshot(state) {
  const active = state.ui.activeCharacterIds;
  const relationships = state.relationships.filter((rel) => active.includes(rel.fromCharacterId) && active.includes(rel.toCharacterId)).slice(0, 4);
  if (!relationships.length) return `<div class="muted small">选择至少两个人物后显示关系张力。</div>`;
  return `
    <div class="stack">
      <div class="panel-title small">关系张力</div>
      ${relationships.map((rel) => `
        <div class="card">
          <div class="small"><strong>${escapeHtml(getName(state, rel.fromCharacterId))}</strong> → <strong>${escapeHtml(getName(state, rel.toCharacterId))}</strong></div>
          ${renderMetric("被看见", rel.wantsToBeSeen)}
          ${renderMetric("怨恨", rel.resentment)}
          ${renderMetric("保护", rel.protection)}
          <div class="micro muted">误读：${escapeHtml(rel.misreading)}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderDraft(draft, state) {
  const mode = state.ui.detailMode;
  if (mode === "agents") return renderAgents(draft, state);
  if (mode === "subtext") return renderSubtext(draft);
  if (mode === "audit") return renderAudit(draft);
  if (mode === "pipeline") return renderPipeline(draft);
  if (mode === "state") return renderStateReasons(draft, state);
  if (mode === "simulation") return renderSimulationTick(draft, state);
  return `
    <div class="scene-box">${escapeHtml(draft.sceneText)}</div>
    <div class="drawer">
      <div class="badge-row">
        <span class="badge hot">${escapeHtml(draft.surfaceEvent)}</span>
        <span class="badge">${escapeHtml(draft.provider || "unknown-provider")}</span>
        ${draft.providerWarning ? `<span class="badge danger">fallback: ${escapeHtml(draft.providerWarning)}</span>` : ""}
        ${(draft.irreversibleTraces || []).map((trace) => `<span class="badge danger">${escapeHtml(trace)}</span>`).join("")}
        ${draft.pipelineMeta?.mode ? `<span class="badge">流水线 ${escapeHtml(draft.pipelineMeta.mode)}</span>` : draft.engineMeta?.mode ? `<span class="badge">引擎 ${escapeHtml(draft.engineMeta.mode)}</span>` : ""}
        ${draft.pipelineMeta?.repaired ? `<span class="badge danger">已修复</span>` : ""}
        ${draft.engineMeta?.repaired ? `<span class="badge danger">RepairPass 已介入</span>` : ""}
      </div>
      ${draft.engineMeta?.pipeline ? `<div class="micro dim">流水线：${escapeHtml(draft.engineMeta.pipeline)}</div>` : ""}
      ${draft.repairNote ? `<div class="micro dim">修复说明：${escapeHtml(draft.repairNote)}</div>` : ""}
      ${renderPipelineSteps(draft)}
      ${draft.engineMeta?.error ? `<div class="micro dim">模型错误：${escapeHtml(draft.engineMeta.error)}</div>` : ""}
    </div>
  `;
}

function renderPipelineSteps(draft) {
  const rawSteps = draft.engineMeta?.pipelineSteps || draft.engineMeta?.stages || [];
  const legacySteps = Array.isArray(draft.engineMeta?.steps) ? draft.engineMeta.steps.map((name) => ({ name })) : [];
  const steps = rawSteps.length ? rawSteps : legacySteps;
  if (!steps.length) return "";
  return `<div class="badge-row pipeline-steps">${steps.map((step) => {
    const label = step.step || step.name || "Stage";
    const tone = step.tone ? ` · ${escapeHtml(step.tone)}` : "";
    const repair = step.shouldRepair || step.repairNeeded ? " · repair" : "";
    const ms = Number.isFinite(Number(step.durationMs || step.elapsedMs)) ? ` · ${Number(step.durationMs || step.elapsedMs)}ms` : "";
    return `<span class="badge">${escapeHtml(label)}${tone}${repair}${ms}</span>`;
  }).join("")}</div>`;
}

function renderPipelineTrace(draft) {
  const trace = draft.pipelineTrace || [];
  if (!trace.length) {
    return `<div class="card"><div class="panel-title small">流水线</div><div class="muted small">当前草稿没有流水线记录。mock 或旧草稿只显示 engineMeta。</div>${draft.engineMeta ? renderKv("engineMeta", JSON.stringify(draft.engineMeta, null, 2)) : ""}</div>`;
  }
  return `<div class="stack">
    <div class="card">
      <div class="panel-title small">多代理流水线</div>
      <div class="micro dim">CharacterAgent → DirectorSynthesizer → DepthAuditor → RepairPass → StateArchivist</div>
    </div>
    ${trace.map((step, index) => `
      <div class="card">
        <div class="card-title"><span>${index + 1}. ${escapeHtml(step.step || "step")}</span><span class="badge">${escapeHtml(step.provider || "local")}</span></div>
        ${step.characterName ? renderKv("人物", step.characterName) : ""}
        ${step.tone ? renderKv("调性", step.tone) : ""}
        ${typeof step.durationMs === "number" ? renderKv("耗时", `${step.durationMs}ms`) : ""}
        ${step.repairNeeded !== undefined ? renderKv("需要修复", String(step.repairNeeded)) : ""}
        ${step.repairNotes ? renderKv("修复备注", (step.repairNotes || []).join("；")) : ""}
        ${step.updateCounts ? renderKv("状态更新", JSON.stringify(step.updateCounts)) : ""}
      </div>
    `).join("")}
  </div>`;
}

function renderAgents(draft, state) {
  return `<div class="stack">
    ${(draft.agentOutputs || []).map((output) => `
      <div class="card">
        <div class="card-title"><span>${escapeHtml(getName(state, output.characterId))}</span><span class="badge hot">${escapeHtml(output.tone)}</span></div>
        ${output.situationalRole ? renderKv("酒馆身份", output.situationalRole) : ""}
        ${output.agency?.placeRelationship ? renderKv("与场所的关系", output.agency.placeRelationship) : ""}
        ${output.perceivedVisit?.purpose ? renderKv("当前来意或接待事务", `${output.perceivedVisit.purpose}（${output.perceivedVisit.stage || "进行中"}）`) : ""}
        ${renderKv("显性行动", output.visibleAction)}
        ${output.contextManifest?.items?.length ? renderKv("本轮实际采用的上下文", output.contextManifest.items.map((item) => `${item.protected ? "受保护" : "补充"} · ${item.inclusionReason}：${item.content}`).join("\n")) : ""}
        ${renderKv("隐藏行动", output.hiddenAction)}
        ${renderKv("防御伪装", output.defenseAction)}
        ${renderKv("阴影行动", output.shadowAction)}
        ${renderKv("想从别人那里得到", output.wantsFromOthers)}
        ${renderKv("不愿承认的伤害", output.possibleHarm)}
        ${renderKv("可能的高尚", output.possibleNobleAction)}
        ${output.planInfluence ? renderKv("自主计划压力", output.planInfluence) : ""}
        ${output.planRiskIfExposed ? renderKv("计划暴露风险", output.planRiskIfExposed) : ""}
        ${output.realtimePrivateDesire ? renderKv("实时私人欲望", output.realtimePrivateDesire) : ""}
        ${output.realtimeDefensiveMask ? renderKv("实时防御面具", output.realtimeDefensiveMask) : ""}
        ${output.realtimeShadowImpulse ? renderKv("实时阴影冲动", output.realtimeShadowImpulse) : ""}
        ${output.falseBeliefs?.length ? renderKv("错误信念", output.falseBeliefs.join("；")) : ""}
      </div>
    `).join("")}
  </div>`;
}

function renderSubtext(draft) {
  return `<div class="stack">
    ${(draft.subtextMatrix || []).map((item) => `
      <div class="card">
        <div class="card-title"><span>${escapeHtml(item.speaker)}</span><span class="badge">潜台词行动</span></div>
        ${renderKv("表面句子", item.line)}
        ${renderKv("表面", item.surface)}
        ${renderKv("隐藏行动", item.hiddenAction)}
        ${renderKv("想得到", item.speakerWants)}
        ${renderKv("对方误读", item.listenerMisreads)}
      </div>
    `).join("")}
  </div>`;
}


function renderPipeline(draft) {
  const meta = draft.pipelineMeta || draft.engineMeta || {};
  const stages = meta.stages || [];
  return `<div class="stack">
    <div class="card">
      <div class="card-title"><span>模型流水线</span><span class="badge hot">${escapeHtml(meta.mode || draft.provider || "unknown")}</span></div>
      ${renderKv("Provider", meta.provider || draft.provider || "unknown")}
      ${renderKv("Model", meta.model || draft.model || "local/mock")}
      ${renderKv("总耗时", typeof meta.elapsedMs === "number" ? `${meta.elapsedMs} ms` : "n/a")}
      ${renderKv("是否修复", meta.repaired ? `是：${meta.repairReason || "审查触发"}` : "否")}
      ${meta.error ? renderKv("错误 / fallback", meta.error) : ""}
    </div>
    ${stages.length ? stages.map((stage, index) => `<div class="card">
      <div class="card-title"><span>${index + 1}. ${escapeHtml(stage.name || "Stage")}</span><span class="badge">${escapeHtml(stage.provider || "local")}</span></div>
      ${renderKv("模型", stage.model || "local")}
      ${renderKv("耗时", typeof stage.elapsedMs === "number" ? `${stage.elapsedMs} ms` : "n/a")}
      ${stage.responseId ? renderKv("Response", stage.responseId) : ""}
      ${stage.scores ? renderKv("审查分", JSON.stringify(stage.scores)) : ""}
    </div>`).join("") : `<div class="muted small">暂无流水线记录。</div>`}
  </div>`;
}


function renderStateReasons(draft, state) {
  const reasons = draft.updateBundle?.stateChangeReasons || draft.stateChangeReasons || [];
  const interventions = draft.interventionsApplied || [];
  return `<div class="stack">
    <div class="card">
      <div class="card-title"><span>操盘干预与状态变化</span><span class="badge hot">${interventions.length} 个干预</span></div>
      ${interventions.length ? interventions.map((item) => `<div class="timeline-text">• ${escapeHtml(interventionTypeLabel(item.type))}/${escapeHtml(interventionActionLabel(item.action))}：${escapeHtml(getName(state, item.characterId))} → ${escapeHtml(getName(state, item.targetCharacterId))}；${escapeHtml(item.instruction || "")}</div>`).join("") : `<div class="muted small">本轮没有显式干预。</div>`}
    </div>
    ${reasons.length ? reasons.map((item) => `<div class="card"><div class="card-title"><span>${escapeHtml(item.characterName || getName(state, item.characterId))}</span><span class="badge">${escapeHtml(item.tone || "状态")}</span></div><div class="timeline-text">${escapeHtml(item.reason || "无状态理由。")}</div></div>`).join("") : `<div class="scene-empty">当前草稿还没有状态变化理由。</div>`}
  </div>`;
}


function renderAudit(draft) {
  const audit = draft.audit || {};
  return `<div class="stack">
    <div class="card">
      ${renderMetric("扁平风险", audit.flatCharacterRisk || 0)}
      ${renderMetric("安全收束", audit.safeClosureRisk || 0)}
      ${renderMetric("单一动机", audit.singleMotivationRisk || 0)}
      ${renderMetric("道德修复偏置", audit.moralRepairBias || 0)}
      ${renderMetric("多重动机", audit.multiMotivationScore || 0)}
      ${renderMetric("互相污染", audit.relationshipMutualContaminationScore || 0)}
      ${renderMetric("不可逆后果", audit.irreversibleConsequenceScore || 0)}
      ${renderMetric("记忆压力", audit.memoryPressureScore || audit.memoryDistortionPressure || 0)}
      ${renderMetric("计划使用", audit.planUseScore || 0)}
      ${renderMetric("计划风险", audit.planRisk || 0)}
      ${renderMetric("记忆入行动", audit.memoryChangedActionScore || audit.memoryActionInfluenceScore || 0)}
      ${renderMetric("忽略记忆风险", audit.ignoredMemoryRisk || audit.memoryNeglectRisk || 0)}
      ${renderMetric("单义记忆风险", audit.singleMemoryRisk || 0)}
      ${renderMetric("记忆冲突版本", audit.memoryConflictScore || audit.memoryConflictVersionScore || 0)}
      ${renderMetric("实时模拟", audit.sceneSimulationScore || audit.realtimeSimulationScore || 0)}
      ${renderMetric("私人意图覆盖", audit.privateIntentCoverage || 0)}
      ${renderMetric("非脚本碰撞", audit.unscriptedCollisionScore || 0)}
      ${renderMetric("计划脚本风险", audit.planScriptRisk || audit.realtimeSimulationRisk || 0)}
      ${renderMetric("可见性张力", audit.visibilityTensionScore || audit.visibilityScore || 0)}
    </div>
    <div class="card">
      <div class="panel-title small">警告</div>
      ${(audit.warnings || []).length ? (audit.warnings || []).map((warning) => `<div class="timeline-text">• ${escapeHtml(warning)}</div>`).join("") : `<div class="muted small">暂无硬性警告。</div>`}
    </div>
    <div class="card">
      <div class="panel-title small">必须修复</div>
      ${(audit.requiredFixes || []).length ? (audit.requiredFixes || []).map((fix) => `<div class="timeline-text">• ${escapeHtml(fix)}</div>`).join("") : `<div class="muted small">无需强制重写。</div>`}
    </div>
    ${renderMemoryAuditBlock(audit)}
  </div>`;
}

function renderSimulationTick(draft, state) {
  const tick = draft.simulationTick;
  const interaction = draft.sceneInteraction || tick?.sceneInteraction || {};
  const visibility = tick?.visibilityLayer || draft.visibilityLayer || {};
  if (!tick) return `<div class="scene-empty">当前草稿没有实时模拟 tick。旧草稿或旧版本 mock 不包含此结构。</div>`;
  return `<div class="stack">
    <div class="card">
      <div class="card-title"><span>Simulation Tick</span><span class="badge hot">${escapeHtml(tick.id)}</span></div>
      ${renderKv("粒度", tick.grain)}
      ${renderKv("模式", tick.mode || "tick_based_realtime")}
      ${renderKv("地点", tick.locationName)}
      ${renderKv("可见压力", tick.visiblePressure || (visibility.visibleFacts || []).join("；"))}
      ${renderKv("隐藏压力", tick.hiddenPressure || (visibility.hiddenFacts || []).join("；"))}
      ${renderMetric("平均矛盾", tick.contradictionPressureSummary?.averageContradiction || 0)}
      ${renderMetric("隐藏事实压力", tick.contradictionPressureSummary?.hiddenFactPressure || 0)}
    </div>
    <div class="card">
      <div class="panel-title small">私人内心模拟</div>
      ${(tick.privateSimulations || []).map((sim) => `<div class="mini-card">
        <div class="card-title"><span>${escapeHtml(sim.characterName)}</span><span class="badge">${escapeHtml(sim.tone)}</span></div>
        ${renderKv("目标对象", sim.targetCharacterName)}
        ${renderKv("公开目标", sim.publicGoal)}
        ${renderKv("私人欲望", sim.privateDesire)}
        ${renderKv("防御面具", sim.defensiveMask)}
        ${renderKv("阴影冲动", sim.shadowImpulse)}
        ${renderKv("高尚冲动", sim.nobleImpulse)}
        ${renderKv("行动候选", sim.actionCandidate)}
        ${renderKv("想从别人那里得到", sim.whatTheyWantFromOthers)}
        ${renderKv("不愿承认", sim.whatTheyRefuseToAdmit)}
        ${renderKv("计划张力", sim.planTension)}
        ${renderKv("记忆张力", sim.memoryTension)}
        ${renderKv("可见性盲点", sim.visibilityBlindSpot)}
        ${renderMetric("矛盾压力", sim.contradictionScore || 0)}
      </div>`).join("")}
    </div>
    <div class="card">
      <div class="panel-title small">可见性层</div>
      ${(visibility.perCharacter || []).map((layer) => `<div class="mini-card">
        <div class="card-title"><span>${escapeHtml(layer.characterName)}</span><span class="badge">知道/误以为/隐藏</span></div>
        ${renderKv("目标", layer.targetCharacterName)}
        ${renderKv("已知事实", (layer.knownFacts || []).join("；"))}
        ${renderKv("盲点", (layer.blindSpots || []).join("；"))}
        ${renderKv("错误信念", (layer.falseBeliefs || []).join("；"))}
        ${renderKv("秘密杠杆", (layer.secretLevers || []).join("；"))}
      </div>`).join("") || `<div class="muted small">暂无可见性层。</div>`}
    </div>
    <div class="card">
      <div class="panel-title small">场景互动模拟</div>
      ${(interaction.interactionBeats || []).map((beat) => `<div class="timeline-text">• ${escapeHtml(beat.beat)}<br/><span class="micro dim">私人：${escapeHtml(beat.privateIntent)}｜面具：${escapeHtml(beat.defensiveMask)}｜泄漏：${escapeHtml(beat.shadowLeak)}</span></div>`).join("") || `<div class="muted small">暂无 interaction beat。</div>`}
      ${(interaction.misunderstandings || []).length ? `<div class="hr"></div>${(interaction.misunderstandings || []).map((item) => `<div class="timeline-text">误读：${escapeHtml(item.misunderstanding || item)}</div>`).join("")}` : ""}
      ${(interaction.reversals || []).length ? `<div class="hr"></div>${(interaction.reversals || []).map((line) => `<div class="timeline-text">反转：${escapeHtml(line)}</div>`).join("")}` : ""}
      ${(interaction.visibilityFlips || []).length ? `<div class="hr"></div>${(interaction.visibilityFlips || []).map((item) => `<div class="timeline-text danger-text">可见性翻转：${escapeHtml(item.characterName)}｜${escapeHtml(item.possibleExposure)}</div>`).join("")}` : ""}
      ${(interaction.simulationNotes || []).length ? `<div class="hr"></div>${(interaction.simulationNotes || []).map((line) => `<div class="micro dim">${escapeHtml(line)}</div>`).join("")}` : ""}
    </div>
  </div>`;
}

function renderSimulationView(state) {
  const draft = getLastDraft(state);
  return `<section class="grid grid-2">
    <div class="panel">
      <div class="panel-header"><div><div class="panel-title">实时人物模拟循环</div><div class="panel-kicker">计划不是剧情；计划是人物进入场景前对自己的谎言。播放时每个人物先独立生成私人内心模拟，再进入同一场所互相误读。</div></div></div>
      <div class="panel-body stack">
        <div class="card">
          <div class="panel-title small">v1.2 流程</div>
          <ol class="small">
            <li>CharacterPrivateSimulator：生成每个人物的公开目标、私人欲望、防御面具、阴影冲动。</li>
            <li>VisibilityLayer：区分谁知道什么、谁误以为什么、谁故意隐藏什么。</li>
            <li>SceneInteractionSimulator：把私人模拟放进同一场所，生成误读、反击、证据和不可逆痕迹。</li>
            <li>DepthAuditor：检查人物是否只是执行计划，而不是从私人冲突里临场行动。</li>
          </ol>
        </div>
        ${draft ? renderSimulationTick(draft, state) : `<div class="scene-empty">点击播放后，这里会显示本轮 simulation tick。</div>`}
      </div>
    </div>
    <div class="panel">
      <div class="panel-header"><div><div class="panel-title">当前人物后台</div><div class="panel-kicker">下次播放会即时读取当前分支的记忆、计划、关系、干预和场所压力。</div></div></div>
      <div class="panel-body stack">
        ${state.characters.filter((character) => state.ui.activeCharacterIds.includes(character.id)).map((character) => `<div class="card">
          <div class="card-title"><span>${escapeHtml(character.name)}</span><span class="badge">参与</span></div>
          ${renderKv("显性", character.actionLines?.visible)}
          ${renderKv("欲望", character.actionLines?.desire)}
          ${renderKv("防御", character.actionLines?.defense)}
          ${renderKv("阴影", character.actionLines?.shadow)}
          <div class="badge-row"><span class="badge">欲望 ${character.currentState?.desire}</span><span class="badge">羞耻 ${character.currentState?.shame}</span><span class="badge danger">报复 ${character.currentState?.revengeImpulse}</span></div>
        </div>`).join("") || `<div class="scene-empty">没有选择参与人物。</div>`}
      </div>
    </div>
  </section>`;
}

function renderCharacterWorkshop(state) {
  const selected = state.characters.find((character) => character.id === state.ui.selectedCharacterId) || state.characters[0];
  return `
    <section class="grid grid-2">
      <div class="panel">
        <div class="panel-header"><div><div class="panel-title">角色列表</div><div class="panel-kicker">选择角色，编辑四条行动线</div></div></div>
        <div class="panel-body stack">
          ${state.characters.map((character) => renderCharacterListItem(character, state)).join("")}
          <div class="hr"></div>
          ${renderNewCharacterForm()}
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><div><div class="panel-title">深层角色卡</div><div class="panel-kicker">角色不是设定，而是互相矛盾的行动源</div></div></div>
        <div class="panel-body">
          ${renderCharacterEditor(selected)}
        </div>
      </div>
    </section>
  `;
}

function renderCharacterListItem(character, state) {
  return `
    <div class="card ${state.ui.selectedCharacterId === character.id ? "selected" : ""}">
      <div class="card-title">
        <button class="btn small ${state.ui.selectedCharacterId === character.id ? "primary" : "ghost"}" data-action="select-character" data-id="${character.id}">${escapeHtml(character.name)}</button>
        <button class="btn small danger" data-action="delete-character" data-id="${character.id}">删除</button>
      </div>
      <div class="card-subtitle">${escapeHtml(character.publicIdentity)}</div>
      <div class="badge-row">
        <span class="badge">显性</span><span class="badge danger">阴影</span><span class="badge">自欺 ${character.currentState.selfDeception}</span>
      </div>
    </div>
  `;
}

function renderNewCharacterForm() {
  return `
    <form id="new-character-form" class="card">
      <div class="panel-title small">新增人物</div>
      <div class="field"><label>姓名</label><input class="input" name="name" placeholder="人物姓名" /></div>
      <div class="field"><label>公开身份</label><input class="input" name="publicIdentity" placeholder="例如：校医、旧爱、学生会主席" /></div>
      <div class="field"><label>人物核心概念</label><textarea class="textarea" name="concept" placeholder="他/她不能承认的欲望、自欺或阴影。"></textarea></div>
      <button class="btn primary" type="submit">生成角色卡</button>
    </form>
  `;
}

function renderCharacterEditor(character) {
  if (!character) return "";
  return `
    <div class="grid grid-2">
      <div>
        ${renderEditField("姓名", "name", character.name, character.id)}
        ${renderEditField("公开身份", "publicIdentity", character.publicIdentity, character.id, "textarea")}
        ${renderNestedField("自我神话", "internalSituation.selfMyth", character.internalSituation.selfMyth, character.id)}
        ${renderNestedField("不可承认的欲望", "internalSituation.inadmissibleDesire", character.internalSituation.inadmissibleDesire, character.id)}
        ${renderNestedField("最深羞耻", "internalSituation.deepestShame", character.internalSituation.deepestShame, character.id)}
        ${renderNestedField("反复自欺句", "internalSituation.repeatedSelfLie", character.internalSituation.repeatedSelfLie, character.id)}
      </div>
      <div>
        ${renderNestedField("显性行动线", "actionLines.visible", character.actionLines.visible, character.id)}
        ${renderNestedField("欲望行动线", "actionLines.desire", character.actionLines.desire, character.id)}
        ${renderNestedField("防御行动线", "actionLines.defense", character.actionLines.defense, character.id)}
        ${renderNestedField("阴影行动线", "actionLines.shadow", character.actionLines.shadow, character.id)}
      </div>
    </div>
    <div class="hr"></div>
    <div class="grid grid-4">
      ${renderSlider(character.id, "desire", "欲望", character.currentState.desire)}
      ${renderSlider(character.id, "shame", "羞耻", character.currentState.shame)}
      ${renderSlider(character.id, "rage", "愤怒", character.currentState.rage)}
      ${renderSlider(character.id, "selfDeception", "自欺", character.currentState.selfDeception)}
      ${renderSlider(character.id, "protectionImpulse", "保护", character.currentState.protectionImpulse)}
      ${renderSlider(character.id, "revengeImpulse", "报复", character.currentState.revengeImpulse)}
      ${renderSlider(character.id, "love", "爱慕", character.currentState.love)}
      ${renderSlider(character.id, "selfDestruction", "自毁", character.currentState.selfDestruction)}
    </div>
    <div class="hr"></div>
    <div class="card">
      <div class="panel-title small">内心法庭</div>
      ${renderKv("控告自己", character.innerCourt.accusesSelfOf)}
      ${renderKv("替自己辩护", character.innerCourt.defendsSelfWith)}
      ${renderKv("隐藏证据", character.innerCourt.hiddenEvidence)}
      ${renderKv("想被谁审判", character.innerCourt.desiredJudge)}
      ${renderKv("又为何怨恨审判者", character.innerCourt.resentsJudgeBecause)}
    </div>
  `;
}

function renderEditField(label, key, value, characterId, type = "input") {
  const input = type === "textarea"
    ? `<textarea class="textarea" data-action="character-field" data-id="${characterId}" data-key="${key}">${escapeHtml(value)}</textarea>`
    : `<input class="input" data-action="character-field" data-id="${characterId}" data-key="${key}" value="${escapeHtml(value)}" />`;
  return `<div class="field"><label>${label}</label>${input}</div>`;
}

function renderNestedField(label, path, value, characterId) {
  return `<div class="field"><label>${label}</label><textarea class="textarea" data-action="character-nested" data-id="${characterId}" data-path="${path}">${escapeHtml(value)}</textarea></div>`;
}

function renderSlider(characterId, key, label, value) {
  return `
    <div class="card">
      <div class="row space-between"><span class="small muted">${label}</span><strong>${value}</strong></div>
      <input type="range" min="0" max="100" value="${value}" data-action="character-state" data-id="${characterId}" data-key="${key}" />
    </div>
  `;
}

function renderTownWorkshop(state) {
  const selected = state.locations.find((loc) => loc.id === state.ui.selectedLocationId) || state.locations[0];
  return `
    <section class="grid grid-2">
      <div class="panel">
        <div class="panel-header"><div><div class="panel-title">小镇场域</div><div class="panel-kicker">场所不是背景，是压力机器</div></div></div>
        <div class="panel-body">
          <div class="field"><label>小镇名称</label><input class="input" data-action="town-field" data-key="name" value="${escapeHtml(state.town.name)}" /></div>
          <div class="field"><label>类型</label><input class="input" data-action="town-field" data-key="type" value="${escapeHtml(state.town.type)}" /></div>
          <div class="field"><label>气氛即压力</label><textarea class="textarea" data-action="town-field" data-key="atmosphereAsPressure">${escapeHtml(state.town.atmosphereAsPressure)}</textarea></div>
          <div class="card">
            <div class="panel-title small">权力结构</div>
            ${renderKv("公开权力", state.town.powerStructure.officialPower.join("、"))}
            ${renderKv("隐藏权力", state.town.powerStructure.hiddenPower.join("、"))}
            ${renderKv("交换规则", state.town.powerStructure.exchangeRules.join("、"))}
          </div>
          <div class="card">
            <div class="panel-title small">逃离成本</div>
            <div class="timeline-text">${escapeHtml(state.town.escapeCost.join("；"))}</div>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><div><div class="panel-title">空间卡</div><div class="panel-kicker">每个空间暴露不同的阴影</div></div></div>
        <div class="panel-body">
          <div class="location-map">
            ${state.locations.map((loc) => renderLocationCard(loc, state)).join("")}
          </div>
          <div class="hr"></div>
          ${selected ? renderLocationEditor(selected) : ""}
        </div>
      </div>
    </section>
  `;
}

function renderLocationCard(location, state) {
  const active = state.ui.selectedLocationId === location.id;
  return `<button class="location-card ${active ? "active" : ""}" data-action="select-location" data-id="${location.id}">
    <div class="card-title">${escapeHtml(location.name)}</div>
    <div class="card-subtitle">${escapeHtml(location.subtext)}</div>
  </button>`;
}

function renderLocationEditor(location) {
  return `
    <div class="card">
      <div class="panel-title">${escapeHtml(location.name)}</div>
      ${renderLocationField("表面用途", "visibleUse", location)}
      ${renderLocationField("隐藏用途", "hiddenUse", location)}
      ${renderLocationField("权力规则", "powerRule", location)}
      ${renderLocationField("潜台词", "subtext", location)}
    </div>
  `;
}

function renderLocationField(label, key, location) {
  return `<div class="field"><label>${label}</label><textarea class="textarea" data-action="location-field" data-id="${location.id}" data-key="${key}">${escapeHtml(location[key])}</textarea></div>`;
}

function renderArchive(state) {
  return `
    <section class="grid grid-4 archive-grid">
      <div class="panel">
        <div class="panel-header"><div><div class="panel-title">正史时间线</div><div class="panel-kicker">只有“赞同”的草稿进入这里</div></div></div>
        <div class="panel-body timeline">
          ${renderBranchTree(state)}
          <div class="hr"></div>
          ${getVisibleCanonEvents(state).length ? getVisibleCanonEvents(state).map((event) => renderCanonEvent(event, state)).join("") : `<div class="scene-empty">当前分支暂无正史。</div>`}
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><div><div class="panel-title">分支树</div><div class="panel-kicker">每条分支拥有独立状态快照</div></div></div>
        <div class="panel-body stack">
          ${renderBranches(state)}
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><div><div class="panel-title">证据与不可逆痕迹</div><div class="panel-kicker">故事真正改变状态的地方</div></div></div>
        <div class="panel-body stack">
          ${(state.evidence || []).slice(0, 12).map((item) => renderTraceItem(item, "证据")).join("") || `<div class="muted small">暂无证据。</div>`}
          ${(state.irreversibleTraces || []).slice(0, 12).map((item) => renderTraceItem(item, "痕迹")).join("")}
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><div><div class="panel-title">谣言系统</div><div class="panel-kicker">私人关系如何变成公共叙事</div></div></div>
        <div class="panel-body stack">
          ${(state.rumors || []).slice(0, 12).map((rumor) => `
            <div class="card">
              <div class="card-title"><span>谣言</span><span class="badge danger">传播 ${rumor.spreadRisk}</span></div>
              <div class="timeline-text">${escapeHtml(rumor.content)}</div>
              <div class="micro dim">扭曲：${escapeHtml(rumor.distortion)}</div>
            </div>
          `).join("") || `<div class="muted small">暂无谣言。</div>`}
        </div>
      </div>
    </section>
  `;
}

function renderBranches(state) {
  const branches = state.branches || [];
  if (!branches.length) return `<div class="muted small">暂无分支。</div>`;
  return branches.map((branch) => {
    const active = branch.id === state.ui.activeBranchId;
    return `
      <button class="branch-card ${active ? "active" : ""}" data-action="branch-select" data-id="${branch.id}">
        <div class="card-title"><span>${escapeHtml(branch.title || branch.id)}</span><span class="badge ${active ? "hot" : ""}">${active ? "当前" : "隔离分支"}</span></div>
        <div class="micro dim">父分支：${escapeHtml(branch.parentBranchId || "无")} · 正史 ${countBranchItems(branch, "canonEvents")} · 草稿 ${countBranchItems(branch, "draftScenes")} · 人物 ${countBranchItems(branch, "characters")} · 关系 ${countBranchItems(branch, "relationships")} · 证据 ${countBranchItems(branch, "evidence")} · 谣言 ${countBranchItems(branch, "rumors")}</div>
        <div class="timeline-text">${escapeHtml(branch.note || "")}</div>
      </button>
    `;
  }).join("");
}

function renderBranchTree(state) {
  const branches = state.branches || [];
  return `<div class="stack">
    <div class="panel-title small">分支树</div>
    ${branches.map((branch) => `
      <div class="card ${branch.id === state.ui.activeBranchId ? "selected" : ""}">
        <div class="card-title">
          <span>${escapeHtml(branch.title)}</span>
          <button class="btn small ${branch.id === state.ui.activeBranchId ? "primary" : "ghost"}" data-action="switch-branch" data-id="${branch.id}">${branch.id === state.ui.activeBranchId ? "活跃" : "切换"}</button>
        </div>
        <div class="micro dim">父分支：${escapeHtml(branch.parentBranchId || "无")} · 正史 ${countBranchItems(branch, "canonEvents")} · 草稿 ${countBranchItems(branch, "draftScenes")} · 人物 ${countBranchItems(branch, "characters")} · 关系 ${countBranchItems(branch, "relationships")} · 证据 ${countBranchItems(branch, "evidence")} · 谣言 ${countBranchItems(branch, "rumors")}</div>
        <div class="micro dim">切换会恢复该分支的人物状态、关系、正史、草稿、谣言、证据和不可逆痕迹。</div>
        ${branch.note ? `<div class="timeline-text">${escapeHtml(branch.note)}</div>` : ""}
      </div>
    `).join("")}
  </div>`;
}


function getBranchSnapshotStats(state, branchId) {
  const activeBranchId = state.ui.activeBranchId || state.project.activeBranchId;
  const branch = (state.branches || []).find((item) => item.id === branchId);
  const snapshot = branch?.snapshot;
  if (!snapshot || branchId === activeBranchId) {
    return {
      characters: (state.characters || []).length,
      relationships: (state.relationships || []).length,
      canonEvents: (state.canonEvents || []).length,
      draftScenes: (state.draftScenes || []).length,
      rumors: (state.rumors || []).length,
      evidence: (state.evidence || []).length,
      irreversibleTraces: (state.irreversibleTraces || []).length,
    };
  }
  return {
    characters: (snapshot.characters || []).length,
    relationships: (snapshot.relationships || []).length,
    canonEvents: (snapshot.canonEvents || []).length,
    draftScenes: (snapshot.draftScenes || []).length,
    rumors: (snapshot.rumors || []).length,
    evidence: (snapshot.evidence || []).length,
    irreversibleTraces: (snapshot.irreversibleTraces || []).length,
  };
}

function renderBranchStatsInline(state, branchId) {
  const stats = getBranchSnapshotStats(state, branchId);
  return `人物 ${stats.characters} · 关系 ${stats.relationships} · 正史 ${stats.canonEvents} · 草稿 ${stats.draftScenes} · 证据 ${stats.evidence} · 谣言 ${stats.rumors} · 痕迹 ${stats.irreversibleTraces}`;
}

function getVisibleCanonEvents(state) {
  return state.canonEvents || [];
}

function countBranchItems(branch, key) {
  if (branch.snapshot && Array.isArray(branch.snapshot[key])) return branch.snapshot[key].length;
  if (key === "canonEvents") return branch.canonEventIds?.length || 0;
  if (key === "draftScenes") return branch.draftSceneIds?.length || 0;
  return 0;
}

function renderCanonEvent(event, state) {
  return `
    <div class="timeline-item">
      <div class="timeline-title">${escapeHtml(event.title)}</div>
      <div class="timeline-meta">${new Date(event.acceptedAt).toLocaleString()} · ${escapeHtml(getLocationName(state, event.locationId))} · ${(event.participantIds || []).map((id) => escapeHtml(getName(state, id))).join("、")}</div>
      <div class="timeline-text">${escapeHtml((event.summary || "").slice(0, 360))}${(event.summary || "").length > 360 ? "……" : ""}</div>
      <div class="badge-row" style="margin-top:10px">
        <span class="badge">源草稿 ${escapeHtml(event.sourceDraftId || "无")}</span>
        ${event.preAcceptSnapshot ? `<span class="badge good">可撤销快照</span>` : `<span class="badge">无快照</span>`}
        ${event.replay?.agentOutputs?.length ? `<span class="badge hot">内心供词 ${event.replay.agentOutputs.length}</span>` : ""}
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn small" data-action="replay-canon" data-id="${event.id}">从此重演</button>
        <button class="btn small danger" data-action="undo-canon" data-id="${event.id}" ${event.preAcceptSnapshot ? "" : "disabled"}>撤销到发生前</button>
        <button class="btn small" data-action="tab" data-tab="timeline">查看回放</button>
      </div>
    </div>
  `;
}


function renderTraceItem(item, label) {
  return `
    <div class="card">
      <div class="card-title"><span>${label}</span><span class="badge">${escapeHtml(item.type || "trace")}</span></div>
      <div class="timeline-text">${escapeHtml(item.content)}</div>
      ${item.canBeMisreadAs ? `<div class="micro dim">可被误读为：${escapeHtml(item.canBeMisreadAs)}</div>` : ""}
    </div>
  `;
}

function renderMemoryAuditBlock(audit) {
  const memoryAudit = audit.memoryAudit || {};
  const checked = memoryAudit.memoriesChecked || audit.memoriesChecked || [];
  const used = memoryAudit.usedMemories || [];
  const ignored = memoryAudit.ignoredMemories || [];
  if (!checked.length && !used.length && !ignored.length) return `<div class="card"><div class="panel-title small">记忆审查</div><div class="muted small">当前草稿没有可审查的角色记忆；赞同后会生成下一轮记忆。</div></div>`;
  return `<div class="card"><div class="panel-title small">记忆审查</div>
    <div class="badge-row"><span class="badge hot">检查 ${checked.length}</span><span class="badge good">已入行动 ${used.length}</span><span class="badge danger">盲区 ${ignored.length}</span></div>
    ${checked.slice(0, 6).map((item) => `<div class="timeline-text">• ${escapeHtml(item.summary || item.id || "记忆")} · 风险 ${Number(item.risk || 0)} · 热度 ${Number(item.heat || 0)}</div>`).join("")}
    ${ignored.slice(0, 4).map((item) => `<div class="timeline-text danger-text">盲区：${escapeHtml(item.memoryId || item.id || "memory")} · ${escapeHtml(item.type || "")}/${escapeHtml(item.stance || "")}</div>`).join("")}
  </div>`;
}

function renderMetric(label, value) {
  const val = Math.max(0, Math.min(100, Number(value) || 0));
  return `<div class="metric"><span>${escapeHtml(label)}</span><div class="meter"><span style="width:${val}%"></span></div><strong>${val}</strong></div>`;
}

function renderKv(key, value) {
  return `<div class="kv"><div class="kv-key">${escapeHtml(key)}</div><div class="kv-val">${escapeHtml(value)}</div></div>`;
}



function renderTimelineReplay(state) {
  const pair = buildRelationshipTimeline(state, state.ui.timelinePairFromId, state.ui.timelinePairToId);
  const court = buildInnerCourtReplay(state, state.ui.timelineCharacterId || state.ui.selectedCharacterId);
  return `
    <section class="timeline-replay-page stack">
      <div class="panel">
        <div class="panel-header">
          <div>
            <div class="panel-title">关系时间轴 + 内心法庭回放</div>
            <div class="panel-kicker">v0.7：回看正史如何改变关系；把人物动作拆回表层、欲望、防御、阴影和自我惩罚。</div>
          </div>
          <div class="badge-row"><span class="badge hot">${escapeHtml(pair.label)}</span><span class="badge danger">法庭：${escapeHtml(court.characterName)}</span></div>
        </div>
        <div class="panel-body">
          <div class="grid grid-3-tight timeline-controls">
            <div class="field"><label>关系 A</label><select class="select" data-action="ui-select" data-key="timelinePairFromId">${state.characters.map((character) => `<option value="${character.id}" ${pair.fromId === character.id ? "selected" : ""}>${escapeHtml(character.name)}</option>`).join("")}</select></div>
            <div class="field"><label>关系 B</label><select class="select" data-action="ui-select" data-key="timelinePairToId">${state.characters.map((character) => `<option value="${character.id}" ${pair.toId === character.id ? "selected" : ""}>${escapeHtml(character.name)}</option>`).join("")}</select></div>
            <div class="field"><label>内心法庭人物</label><select class="select" data-action="ui-select" data-key="timelineCharacterId">${state.characters.map((character) => `<option value="${character.id}" ${court.characterId === character.id ? "selected" : ""}>${escapeHtml(character.name)}</option>`).join("")}</select></div>
          </div>
        </div>
      </div>
      <section class="grid grid-2 timeline-grid">
        <div class="panel"><div class="panel-header"><div><div class="panel-title">关系时间轴</div><div class="panel-kicker">不是好感度，而是爱、怨恨、保护、报复、占有和误读如何移动</div></div></div><div class="panel-body stack">${renderRelationshipCurrent(pair)}${pair.items.length ? pair.items.map((item, index) => renderTimelineItem(state, item, index)).join("") : `<div class="scene-empty">当前关系还没有进入正史回放。先在操盘台播放并赞同一场戏。</div>`}</div></div>
        <div class="panel"><div class="panel-header"><div><div class="panel-title">内心法庭回放</div><div class="panel-kicker">每个正史事件都回放角色如何控告自己、替自己辩护、隐藏证据</div></div></div><div class="panel-body stack">${renderInnerCourtPanel(state, court)}</div></div>
      </section>
      ${renderReplayMarkers(state)}
    </section>
  `;
}

function renderRelationshipCurrent(pair) {
  const f = pair.current.forward;
  const r = pair.current.reverse;
  if (!f && !r) return `<div class="card"><div class="card-title"><span>当前关系</span><span class="badge">尚未建立</span></div></div>`;
  return `<div class="card selected"><div class="card-title"><span>当前关系：${escapeHtml(pair.label)}</span><span class="badge hot">实时状态</span></div><div class="grid grid-2-tight">${renderRelationshipMiniState(f, "A → B")}${renderRelationshipMiniState(r, "B → A")}</div></div>`;
}

function renderRelationshipMiniState(rel, label) {
  if (!rel) return `<div class="card soft-card"><div class="card-title"><span>${escapeHtml(label)}</span><span class="badge">无记录</span></div></div>`;
  return `<div class="card soft-card"><div class="card-title"><span>${escapeHtml(label)}</span></div>${renderMetric("吸引", rel.attraction || 0)}${renderMetric("怨恨", rel.resentment || 0)}${renderMetric("保护", rel.protection || 0)}${renderMetric("欺骗", rel.deception || 0)}<div class="micro dim">误读：${escapeHtml(rel.misreading || "无")}</div></div>`;
}

function renderTimelineItem(state, item, index) {
  const undo = buildUndoPreview(state, item.id);
  return `<div class="card replay-event-card"><div class="card-title"><span>${index + 1}. ${escapeHtml(item.title)}</span><span class="badge ${item.canRewind ? "hot" : ""}">${item.canRewind ? "可撤销重演" : "旧事件"}</span></div><div class="timeline-meta">${item.at ? new Date(item.at).toLocaleString() : "无时间"} · ${escapeHtml(getLocationName(state, item.locationId))}</div><div class="timeline-text">${escapeHtml((item.summary || "").slice(0, 320))}${item.summary && item.summary.length > 320 ? "……" : ""}</div>${item.pairShifts.length ? `<div class="hr"></div><div class="panel-title small">关系变化</div>${item.pairShifts.map((shift) => renderShiftCard(state, shift)).join("")}` : ""}${item.agentOutputs.length ? `<div class="hr"></div><div class="panel-title small">人物动作</div>${item.agentOutputs.map((output) => renderAgentReplayLine(state, output)).join("")}` : ""}${item.evidence.length || item.rumors.length || item.traces.length ? `<div class="hr"></div><div class="badge-row">${item.evidence.map((ev) => `<span class="badge">证据：${escapeHtml((ev.content || ev.type || "").slice(0, 44))}</span>`).join("")}${item.rumors.map((rumor) => `<span class="badge danger">谣言：${escapeHtml((rumor.content || "").slice(0, 44))}</span>`).join("")}${item.traces.map((trace) => `<span class="badge danger">痕迹：${escapeHtml((trace.content || "").slice(0, 44))}</span>`).join("")}</div>` : ""}${undo ? `<div class="hr"></div><div class="row space-between"><div class="micro dim">撤销预览：将移除约 ${undo.removedCanonCount} 个正史；人物变化 ${undo.characterDeltaCount}；关系变化 ${undo.relationshipDeltaCount}。</div><button class="btn small danger" data-action="undo-canon" data-id="${item.id}" ${undo.canRewind ? "" : "disabled"}>撤销到此之前</button><button class="btn small primary" data-action="undo-and-replay" data-id="${item.id}" ${undo.canRewind ? "" : "disabled"}>撤销并重演</button></div>` : ""}</div>`;
}

function renderShiftCard(state, shift) {
  const entries = Object.entries(shift.deltas || {}).filter(([, value]) => Number(value) !== 0).slice(0, 8);
  return `<div class="card soft-card"><div class="card-title"><span>${escapeHtml(getName(state, shift.fromCharacterId))} → ${escapeHtml(getName(state, shift.toCharacterId))}</span></div><div class="badge-row">${entries.map(([key, value]) => `<span class="badge ${Number(value) > 0 ? "good" : "danger"}">${escapeHtml(metricLabel(key))}${Number(value) > 0 ? "+" : ""}${value}</span>`).join("")}</div><div class="micro dim">误读：${escapeHtml(shift.misreading || "无")}</div><div class="micro dim">未说出口：${escapeHtml(shift.unspoken || "无")}</div></div>`;
}

function renderAgentReplayLine(state, output) {
  return `<div class="card soft-card"><div class="card-title"><span>${escapeHtml(getName(state, output.characterId))}</span><span class="badge">${escapeHtml(output.tone || "行动")}</span></div><div class="timeline-text"><strong>显性：</strong>${escapeHtml(output.visibleAction || "")}</div><div class="timeline-text"><strong>隐藏：</strong>${escapeHtml(output.hiddenAction || output.desireReason || "")}</div><div class="timeline-text"><strong>防御：</strong>${escapeHtml(output.defenseAction || output.surfaceJustification || "")}</div><div class="timeline-text"><strong>阴影：</strong>${escapeHtml(output.shadowAction || output.unadmittedPleasure || "")}</div></div>`;
}

function renderInnerCourtPanel(state, court) {
  return `<div class="stack"><div class="card selected"><div class="card-title"><span>${escapeHtml(court.characterName)}</span><span class="badge hot">${court.stats.actionCount} 次行动</span></div>${renderKv("自我神话", court.selfMyth)}${renderKv("控告自己", court.innerCourt?.accusesSelfOf || "未记录")}${renderKv("替自己辩护", court.innerCourt?.defendsSelfWith || "未记录")}${renderKv("隐藏证据", court.innerCourt?.hiddenEvidence || "未记录")}<div class="badge-row"><span class="badge danger">惩罚/自毁 ${court.stats.punitiveCount}</span><span class="badge good">接近/保护 ${court.stats.approachCount}</span><span class="badge">可撤销 ${court.stats.rewindableCount}</span></div></div>${court.items.length ? court.items.map((item, index) => renderCourtItem(state, item, index)).join("") : `<div class="scene-empty">该人物还没有进入正史回放。先让他/她参与播放并赞同。</div>`}</div>`;
}

function renderCourtItem(state, item, index) {
  return `<div class="card court-card"><div class="card-title"><span>${index + 1}. ${escapeHtml(item.surfaceEvent)}</span><span class="badge ${/惩罚|陷害|自毁/.test(item.tone) ? "danger" : "hot"}">${escapeHtml(item.tone)}</span></div><div class="timeline-meta">${item.at ? new Date(item.at).toLocaleString() : "无时间"} · 对象：${escapeHtml(item.targetName || "无")}</div><div class="court-grid">${renderCourtFacet("表层理由", item.surfaceJustification)}${renderCourtFacet("欲望理由", item.desireReason)}${renderCourtFacet("羞耻理由", item.shameReason)}${renderCourtFacet("权力理由", item.powerReason)}${renderCourtFacet("自欺理由", item.selfDeceptionReason)}${renderCourtFacet("不承认的快感", item.unadmittedPleasure)}${renderCourtFacet("事后自罚", item.postActionSelfPunishment)}${renderCourtFacet("向他人索取", item.wantsFromOthers)}</div><div class="hr"></div><div class="timeline-text"><strong>显性行动：</strong>${escapeHtml(item.visibleAction)}</div><div class="timeline-text"><strong>隐藏行动：</strong>${escapeHtml(item.hiddenAction)}</div><div class="timeline-text"><strong>防御行动：</strong>${escapeHtml(item.defenseAction)}</div><div class="timeline-text"><strong>阴影行动：</strong>${escapeHtml(item.shadowAction)}</div>${item.canRewind ? `<div class="row" style="margin-top:10px"><button class="btn small danger" data-action="undo-canon" data-id="${item.canonEventId}">撤销这次正史</button><button class="btn small primary" data-action="undo-and-replay" data-id="${item.canonEventId}">撤销并重演</button></div>` : ""}</div>`;
}

function renderCourtFacet(label, text) {
  return `<div class="court-facet"><div class="micro dim">${escapeHtml(label)}</div><div class="small">${escapeHtml(text || "未记录")}</div></div>`;
}

function renderReplayMarkers(state) {
  const markers = state.replayMarkers || [];
  if (!markers.length) return `<section class="panel"><div class="panel-header"><div><div class="panel-title">撤销 / 重演标记</div><div class="panel-kicker">撤销正史后这里会留下可重演入口</div></div></div><div class="panel-body"><div class="scene-empty">还没有撤销过正史事件。</div></div></section>`;
  return `<section class="panel"><div class="panel-header"><div><div class="panel-title">撤销 / 重演标记</div><div class="panel-kicker">这些标记记录操盘手在哪个命运节点回退</div></div></div><div class="panel-body stack">${markers.map((marker) => `<div class="card"><div class="card-title"><span>${escapeHtml(marker.title || "重演标记")}</span><span class="badge danger">撤销</span></div><div class="timeline-text">${escapeHtml(marker.note || "")}</div><div class="micro dim">源草稿：${escapeHtml(marker.sourceDraftId || "无")}</div><div class="row" style="margin-top:10px"><button class="btn small primary" data-action="replay-canon" data-id="${marker.id}">重演这条线</button></div></div>`).join("")}</div></section>`;
}


function renderMemoryAuditView(state) {
  const draft = getLastDraft(state) || {};
  const audit = draft.audit?.memoryAudit || buildMemoryAudit(state, draft.participantIds ? draft : { ...draft, participantIds: state.ui.activeCharacterIds || [] });
  return `
    <section class="grid grid-2 memory-audit-page">
      <div class="panel">
        <div class="panel-header"><div><div class="panel-title">记忆驱动审查</div><div class="panel-kicker">检查人物是否真正使用、扭曲、压抑或武器化记忆</div></div></div>
        <div class="panel-body stack">
          <div class="card">
            ${renderMetric("记忆压力", audit.memoryPressureScore || audit.memoryDistortionPressure || 0)}
      ${renderMetric("计划使用", audit.planUseScore || 0)}
      ${renderMetric("计划风险", audit.planRisk || 0)}
            ${renderMetric("记忆入行动", audit.memoryChangedActionScore || audit.memoryActionInfluenceScore || 0)}
            ${renderMetric("忽略记忆风险", audit.ignoredMemoryRisk || audit.memoryNeglectRisk || 0)}
            ${renderMetric("单义记忆风险", audit.singleMemoryRisk || 0)}
            ${renderMetric("记忆冲突版本", audit.memoryConflictScore || audit.memoryConflictVersionScore || 0)}
      ${renderMetric("实时模拟", audit.sceneSimulationScore || audit.realtimeSimulationScore || 0)}
      ${renderMetric("私人意图覆盖", audit.privateIntentCoverage || 0)}
      ${renderMetric("非脚本碰撞", audit.unscriptedCollisionScore || 0)}
      ${renderMetric("计划脚本风险", audit.planScriptRisk || audit.realtimeSimulationRisk || 0)}
      ${renderMetric("可见性张力", audit.visibilityTensionScore || audit.visibilityScore || 0)}
          </div>
          <div class="card">
            <div class="card-title"><span>总体判断</span><span class="badge hot">${Number(audit.totalRelevantMemories || 0)} 段相关记忆</span></div>
            <div class="timeline-text">高热度记忆：${Number(audit.hotMemoryTotal || 0)}；使用记忆的人物：${Number(audit.usedCharacterCount || 0)}。</div>
            ${(audit.warnings || []).length ? (audit.warnings || []).map((warning) => `<div class="timeline-text">• ${escapeHtml(warning)}</div>`).join("") : `<div class="muted small">暂无记忆审查警告。</div>`}
          </div>
          <div class="card">
            <div class="card-title"><span>必须修复</span><span class="badge ${audit.repairNeeded ? "danger" : ""}">${audit.repairNeeded ? "需要" : "暂不需要"}</span></div>
            ${(audit.requiredFixes || []).length ? (audit.requiredFixes || []).map((fix) => `<div class="timeline-text">• ${escapeHtml(fix)}</div>`).join("") : `<div class="muted small">暂无记忆修复要求。</div>`}
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><div><div class="panel-title">人物记忆压力</div><div class="panel-kicker">每个人是否把历史带进本轮行动</div></div></div>
        <div class="panel-body stack">
          ${(audit.perCharacter || []).map((item) => renderMemoryAuditCharacter(state, item)).join("") || `<div class="scene-empty">选择人物并播放后，这里会显示记忆审查。</div>`}
          <div class="hr"></div>
          <div class="panel-title small">冲突版本</div>
          ${(audit.conflictGroups || []).length ? (audit.conflictGroups || []).map((group) => `<div class="card soft-card"><div class="card-title"><span>${escapeHtml(group.sourceId)}</span><span class="badge danger">${group.count} 个版本</span></div><div class="timeline-text">人物：${escapeHtml((group.characters || []).map((id) => getName(state, id)).join("、"))}</div><div class="micro dim">类型：${escapeHtml((group.types || []).join(" / "))}；立场：${escapeHtml((group.stances || []).join(" / "))}；极性差：${Number(group.polaritySpread || 0)}</div></div>`).join("") : `<div class="muted small">暂无同源冲突版本。可以从“记忆/证据”把同一正史转给不同人物。</div>`}
        </div>
      </div>
    </section>
  `;
}

function renderMemoryAuditCharacter(state, item) {
  return `<div class="card">
    <div class="card-title"><span>${escapeHtml(getName(state, item.characterId))}</span><span class="badge ${item.ignoredHotMemories ? "danger" : ""}">忽略高热 ${Number(item.ignoredHotMemories || 0)}</span></div>
    <div class="badge-row">
      <span class="badge">总记忆 ${Number(item.totalMemories || 0)}</span>
      <span class="badge hot">高热 ${Number(item.hotMemories || 0)}</span>
      <span class="badge">被使用 ${Number(item.usedMemories || 0)}</span>
      <span class="badge">类型 ${Number(item.typeCount || 0)}</span>
      <span class="badge">立场 ${Number(item.stanceCount || 0)}</span>
      <span class="badge ${item.hasDistortionAction ? "hot" : ""}">${item.hasDistortionAction ? "有扭曲动作" : "无扭曲动作"}</span>
    </div>
    <div class="micro dim">最危险记忆：${escapeHtml(item.mostDangerousMemoryId || "无")}</div>
  </div>`;
}

function renderMemoryAndEvidence(state) {
  const selectedCharacterId = state.ui.memoryCharacterId || state.characters[0]?.id;
  const selectedCharacter = state.characters.find((item) => item.id === selectedCharacterId) || state.characters[0];
  const memories = getCharacterMemories(state, selectedCharacter?.id);
  const summary = buildMemoryConflictSummary(state, selectedCharacter?.id);
  const graph = buildEvidenceGraph(state, { focusCharacterId: state.ui.graphFocusCharacterId || selectedCharacter?.id });
  return `
    <section class="grid grid-2 memory-graph-page">
      <div class="panel">
        <div class="panel-header"><div><div class="panel-title">角色记忆编辑器</div><div class="panel-kicker">记忆不是背景；它会成为人物下一步行动的偏见、借口和证据</div></div></div>
        <div class="panel-body stack">
          <div class="field"><label>编辑人物</label><select class="select" data-action="ui-select" data-key="memoryCharacterId">
            ${state.characters.map((character) => `<option value="${character.id}" ${selectedCharacter?.id === character.id ? "selected" : ""}>${escapeHtml(character.name)}</option>`).join("")}
          </select></div>
          ${renderMemorySummary(summary)}
          ${renderMemoryForm(state, selectedCharacter)}
          <div class="hr"></div>
          <div class="panel-title small">${escapeHtml(selectedCharacter?.name || "人物")} 的记忆</div>
          ${memories.length ? memories.map((memory) => renderMemoryCard(state, memory)).join("") : `<div class="scene-empty">这个人物还没有当前分支的私人记忆。</div>`}
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><div><div class="panel-title">正史证据图谱</div><div class="panel-kicker">把正史、证据、谣言、痕迹和人物记忆连成可追溯网络</div></div></div>
        <div class="panel-body stack">
          <div class="field"><label>图谱焦点</label><select class="select" data-action="ui-select" data-key="graphFocusCharacterId">
            ${state.characters.map((character) => `<option value="${character.id}" ${state.ui.graphFocusCharacterId === character.id ? "selected" : ""}>${escapeHtml(character.name)}</option>`).join("")}
          </select></div>
          ${renderGraphStats(graph)}
          ${renderEvidenceGraph(graph)}
          <div class="hr"></div>
          <div class="panel-title small">从正史生成记忆</div>
          ${(state.canonEvents || []).slice(0, 8).map((event) => `
            <div class="card soft-card">
              <div class="card-title"><span>${escapeHtml(event.title || event.surfaceEvent || event.id)}</span><button class="btn small" data-action="memory-from-canon" data-id="${event.id}">转成记忆</button></div>
              <div class="timeline-text">${escapeHtml(event.summary || event.sceneText?.slice(0, 120) || "正史事件")}</div>
            </div>
          `).join("") || `<div class="muted small">当前分支暂无正史，先在操盘台赞同一条草稿。</div>`}
        </div>
      </div>
    </section>
  `;
}

function renderMemorySummary(summary) {
  return `
    <div class="card memory-summary">
      <div class="card-title"><span>记忆冲突</span><span class="badge hot">${summary.total} 段</span></div>
      <div class="badge-row">
        <span class="badge danger">扭曲 ${summary.distorted}</span>
        <span class="badge">欲望 ${summary.desire}</span>
        <span class="badge">保护 ${summary.protective}</span>
        <span class="badge">报复 ${summary.revenge}</span>
        <span class="badge ${summary.mostUnreliable ? "danger" : ""}">最低可信 ${summary.mostUnreliable ? summary.mostUnreliable.reliability : "-"}</span>
      </div>
      <div class="micro dim">人物后续行动会读取这些记忆：准确记忆会约束行动，误记和压抑会制造偏见，武器化记忆会成为报复或保护的材料。</div>
    </div>
  `;
}

function renderMemoryForm(state, selectedCharacter) {
  const draft = state.ui.memoryDraft || {};
  const targetId = draft.targetCharacterId || state.characters.find((item) => item.id !== selectedCharacter?.id)?.id || selectedCharacter?.id;
  return `
    <form id="memory-form" class="card stack">
      <div class="card-title"><span>新增记忆</span><span class="badge">当前分支</span></div>
      <input type="hidden" name="characterId" value="${escapeHtml(selectedCharacter?.id || "")}" />
      <div class="grid grid-2-tight">
        <div class="field"><label>记忆关于谁</label><select class="select" name="targetCharacterId" data-action="memory-draft" data-key="targetCharacterId">
          <option value="">无特定对象</option>
          ${state.characters.map((character) => `<option value="${character.id}" ${targetId === character.id ? "selected" : ""}>${escapeHtml(character.name)}</option>`).join("")}
        </select></div>
        <div class="field"><label>记忆类型</label><select class="select" name="type" data-action="memory-draft" data-key="type">
          ${memoryTypeOptions.map(([value, label]) => `<option value="${value}" ${draft.type === value ? "selected" : ""}>${label}</option>`).join("")}
        </select></div>
      </div>
      <div class="grid grid-2-tight">
        <div class="field"><label>记忆立场</label><select class="select" name="stance" data-action="memory-draft" data-key="stance">
          ${memoryStanceOptions.map(([value, label]) => `<option value="${value}" ${draft.stance === value ? "selected" : ""}>${label}</option>`).join("")}
        </select></div>
        <div class="field"><label>可信度：${Number(draft.reliability ?? 55)}</label><input type="range" min="0" max="100" name="reliability" value="${Number(draft.reliability ?? 55)}" data-action="memory-draft-range" data-key="reliability" /></div>
      </div>
      <div class="field"><label>记忆内容</label><textarea class="textarea" name="content" data-action="memory-draft" data-key="content" placeholder="人物记得什么？这段记忆怎样改变下一次行动？">${escapeHtml(draft.content || "")}</textarea></div>
      <div class="grid grid-2-tight">
        <div class="field"><label>公开版本</label><textarea class="textarea" name="publicVersion" data-action="memory-draft" data-key="publicVersion">${escapeHtml(draft.publicVersion || "")}</textarea></div>
        <div class="field"><label>私人版本</label><textarea class="textarea" name="privateVersion" data-action="memory-draft" data-key="privateVersion">${escapeHtml(draft.privateVersion || "")}</textarea></div>
      </div>
      <div class="field"><label>扭曲机制</label><textarea class="textarea" name="distortion" data-action="memory-draft" data-key="distortion" placeholder="这段记忆如何被自我神话、羞耻、欲望或报复篡改？">${escapeHtml(draft.distortion || "")}</textarea></div>
      <div class="field"><label>热度：${Number(draft.heat ?? 60)}</label><input type="range" min="0" max="100" name="heat" value="${Number(draft.heat ?? 60)}" data-action="memory-draft-range" data-key="heat" /></div>
      <button class="btn primary" type="submit">写入记忆</button>
    </form>
  `;
}

function renderMemoryCard(state, memory) {
  return `
    <div class="card memory-card">
      <div class="card-title">
        <span>${escapeHtml(memory.content || memory.privateVersion || "未命名记忆")}</span>
        <button class="btn small danger" data-action="delete-memory" data-id="${memory.id}">删除</button>
      </div>
      <div class="badge-row">
        <span class="badge hot">${escapeHtml(memoryTypeLabel(memory.type))}</span>
        <span class="badge">${escapeHtml(memoryStanceLabel(memory.stance))}</span>
        <span class="badge ${Number(memory.reliability || 0) < 45 ? "danger" : ""}">${escapeHtml(memoryReliabilityLabel(memory.reliability))} ${Number(memory.reliability || 0)}</span>
        <span class="badge">热度 ${Number(memory.heat || 0)}</span>
        ${memory.targetCharacterId ? `<span class="badge">关于 ${escapeHtml(getName(state, memory.targetCharacterId))}</span>` : ""}
      </div>
      <div class="grid grid-2-tight" style="margin-top:10px">
        <div class="field"><label>公开版本</label><textarea class="textarea" data-action="memory-edit" data-id="${memory.id}" data-key="publicVersion">${escapeHtml(memory.publicVersion || "")}</textarea></div>
        <div class="field"><label>私人版本</label><textarea class="textarea" data-action="memory-edit" data-id="${memory.id}" data-key="privateVersion">${escapeHtml(memory.privateVersion || "")}</textarea></div>
      </div>
      <div class="field"><label>扭曲机制</label><textarea class="textarea" data-action="memory-edit" data-id="${memory.id}" data-key="distortion">${escapeHtml(memory.distortion || "")}</textarea></div>
      <div class="grid grid-2-tight">
        <div class="field"><label>可信度：${Number(memory.reliability || 0)}</label><input type="range" min="0" max="100" value="${Number(memory.reliability || 0)}" data-action="memory-edit-range" data-id="${memory.id}" data-key="reliability" /></div>
        <div class="field"><label>热度：${Number(memory.heat || 0)}</label><input type="range" min="0" max="100" value="${Number(memory.heat || 0)}" data-action="memory-edit-range" data-id="${memory.id}" data-key="heat" /></div>
      </div>
      <div class="micro dim">来源：${escapeHtml(memory.source || "operator")} · ${escapeHtml(memory.updatedAt || memory.createdAt || "")}</div>
    </div>
  `;
}

function renderGraphStats(graph) {
  return `
    <div class="diff-summary graph-summary">
      ${Object.entries(graph.stats || {}).map(([key, value]) => `<div class="card diff-stat-card"><div class="micro dim">${escapeHtml(graphStatLabel(key))}</div><div class="panel-title">${Number(value || 0)}</div></div>`).join("")}
    </div>
  `;
}

function renderEvidenceGraph(graph) {
  const byType = groupBy(graph.nodes || [], "type");
  return `
    <div class="evidence-graph">
      ${Object.entries(byType).map(([type, nodes]) => `
        <div class="card graph-column">
          <div class="card-title"><span>${escapeHtml(graphNodeTypeLabel(type))}</span><span class="badge">${nodes.length}</span></div>
          <div class="stack">
            ${nodes.slice(0, 10).map((node) => `<div class="graph-node ${escapeHtml(type)}"><strong>${escapeHtml(node.label)}</strong><div class="micro dim">${escapeHtml(node.subtitle || node.rawId || "")}</div></div>`).join("")}
          </div>
        </div>
      `).join("")}
      <div class="card graph-edge-list">
        <div class="card-title"><span>连接</span><span class="badge">${graph.edges.length}</span></div>
        ${(graph.edges || []).slice(0, 24).map((edge) => `<div class="timeline-text"><span class="badge">${escapeHtml(edge.label)}</span> ${escapeHtml(edge.from)} → ${escapeHtml(edge.to)}</div>`).join("") || `<div class="muted small">暂无连接。</div>`}
      </div>
    </div>
  `;
}

function groupBy(items, key) {
  return (items || []).reduce((acc, item) => {
    const group = item[key] || "other";
    acc[group] = acc[group] || [];
    acc[group].push(item);
    return acc;
  }, {});
}

function graphStatLabel(key) {
  return ({ characters: "人物", canon: "正史", evidence: "证据", rumors: "谣言", memories: "记忆", traces: "痕迹", edges: "连接" })[key] || key;
}

function graphNodeTypeLabel(type) {
  return ({ character: "人物", canon: "正史", evidence: "证据", rumor: "谣言", memory: "记忆", trace: "痕迹" })[type] || type;
}

function renderBranchDiffView(state) {
  const branches = state.branches || [];
  if (branches.length < 2) {
    return `
      <section class="panel">
        <div class="panel-header"><div><div class="panel-title">分支差异视图</div><div class="panel-kicker">至少需要两条分支才能比较命运差异</div></div></div>
        <div class="panel-body"><div class="scene-empty">从草稿开出新分支后，这里会显示人物状态、关系、正史、证据、谣言和不可逆痕迹的差异。</div></div>
      </section>
    `;
  }
  const activeBranchId = state.ui.activeBranchId || state.project.activeBranchId || branches[0]?.id;
  const baseId = resolveBranchId(state, state.ui.diffBaseBranchId, activeBranchId);
  const compareFallback = branches.find((branch) => branch.id !== baseId)?.id || activeBranchId;
  const compareId = resolveBranchId(state, state.ui.diffCompareBranchId, compareFallback);
  const diff = buildBranchDiff(state, baseId, compareId);
  return `
    <section class="diff-page stack">
      <div class="panel">
        <div class="panel-header">
          <div>
            <div class="panel-title">分支差异视图</div>
            <div class="panel-kicker">比较两条命运线怎样改写人物、关系、证据、谣言和不可逆痕迹</div>
          </div>
          <div class="badge-row">
            <span class="badge hot">A: ${escapeHtml(getBranchTitle(state, baseId))}</span>
            <span class="badge danger">B: ${escapeHtml(getBranchTitle(state, compareId))}</span>
          </div>
        </div>
        <div class="panel-body">
          <div class="grid grid-2-tight">
            <div class="field">
              <label>基准分支 A</label>
              <select class="select" data-action="ui-select" data-key="diffBaseBranchId">
                ${branches.map((branch) => `<option value="${branch.id}" ${branch.id === baseId ? "selected" : ""}>${escapeHtml(branch.title || branch.id)}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label>比较分支 B</label>
              <select class="select" data-action="ui-select" data-key="diffCompareBranchId">
                ${branches.map((branch) => `<option value="${branch.id}" ${branch.id === compareId ? "selected" : ""}>${escapeHtml(branch.title || branch.id)}</option>`).join("")}
              </select>
            </div>
          </div>
          ${renderDiffSummary(diff)}
        </div>
      </div>
      <section class="grid grid-2 diff-grid">
        ${renderCharacterDiffPanel(diff)}
        ${renderRelationshipDiffPanel(diff)}
      </section>
      <section class="grid grid-3 diff-grid">
        ${renderCollectionDiffPanel("正史事件", diff.collections.canonEvents, "这些事件决定哪条线被承认为发生过")}
        ${renderCollectionDiffPanel("证据", diff.collections.evidence, "证据会改变外界如何命名人物关系")}
        ${renderCollectionDiffPanel("谣言", diff.collections.rumors, "谣言把私人行动改写成公共叙事")}
      </section>
      <section class="grid grid-2 diff-grid">
        ${renderCollectionDiffPanel("不可逆痕迹", diff.collections.irreversibleTraces, "这些痕迹标记人物无法回到原点的位置")}
        ${renderCollectionDiffPanel("草稿", diff.collections.draftScenes, "未赞同内容仍可成为分支原料")}
      </section>
    </section>
  `;
}

function resolveBranchId(state, candidateId, fallbackId) {
  const branches = state.branches || [];
  if (branches.some((branch) => branch.id === candidateId)) return candidateId;
  if (branches.some((branch) => branch.id === fallbackId)) return fallbackId;
  return branches[0]?.id || null;
}

function getSnapshotForBranch(state, branchId) {
  const activeBranchId = state.ui.activeBranchId || state.project.activeBranchId;
  const branch = (state.branches || []).find((item) => item.id === branchId);
  if (!branch || branchId === activeBranchId) {
    return {
      characters: state.characters || [],
      relationships: state.relationships || [],
      canonEvents: state.canonEvents || [],
      draftScenes: state.draftScenes || [],
      rumors: state.rumors || [],
      evidence: state.evidence || [],
      secrets: state.secrets || [],
      irreversibleTraces: state.irreversibleTraces || [],
    };
  }
  const snapshot = branch.snapshot || {};
  return {
    characters: snapshot.characters || [],
    relationships: snapshot.relationships || [],
    canonEvents: snapshot.canonEvents || [],
    draftScenes: snapshot.draftScenes || [],
    rumors: snapshot.rumors || [],
    evidence: snapshot.evidence || [],
    secrets: snapshot.secrets || [],
    irreversibleTraces: snapshot.irreversibleTraces || [],
  };
}

function buildBranchDiff(state, baseId, compareId) {
  const base = getSnapshotForBranch(state, baseId);
  const compare = getSnapshotForBranch(state, compareId);
  return {
    baseId,
    compareId,
    baseTitle: getBranchTitle(state, baseId),
    compareTitle: getBranchTitle(state, compareId),
    stats: buildStatsDiff(base, compare),
    characters: buildCharacterDiff(base.characters, compare.characters),
    relationships: buildRelationshipDiff(base.relationships, compare.relationships, base, compare),
    collections: {
      canonEvents: buildCollectionDiff(base.canonEvents, compare.canonEvents, describeCanonLikeItem),
      draftScenes: buildCollectionDiff(base.draftScenes, compare.draftScenes, describeDraftLikeItem),
      rumors: buildCollectionDiff(base.rumors, compare.rumors, describeTraceLikeItem),
      evidence: buildCollectionDiff(base.evidence, compare.evidence, describeTraceLikeItem),
      irreversibleTraces: buildCollectionDiff(base.irreversibleTraces, compare.irreversibleTraces, describeTraceLikeItem),
    },
  };
}

function buildStatsDiff(base, compare) {
  const keys = ["characters", "relationships", "canonEvents", "draftScenes", "rumors", "evidence", "secrets", "irreversibleTraces"];
  return keys.map((key) => {
    const a = base[key]?.length || 0;
    const b = compare[key]?.length || 0;
    return { key, label: statLabel(key), base: a, compare: b, delta: b - a };
  });
}

function statLabel(key) {
  const labels = { characters: "人物", relationships: "关系", canonEvents: "正史", draftScenes: "草稿", rumors: "谣言", evidence: "证据", secrets: "秘密", irreversibleTraces: "痕迹" };
  return labels[key] || key;
}

function buildCharacterDiff(baseCharacters, compareCharacters) {
  const baseMap = mapById(baseCharacters);
  const compareMap = mapById(compareCharacters);
  const ids = [...new Set([...baseMap.keys(), ...compareMap.keys()])];
  const numericKeys = ["desire", "shame", "rage", "selfDeception", "protectionImpulse", "revengeImpulse", "love", "selfDestruction"];
  return ids.map((id) => {
    const a = baseMap.get(id);
    const b = compareMap.get(id);
    if (!a) return { id, type: "added", name: b?.name || id, details: ["只存在于比较分支 B"], changes: [] };
    if (!b) return { id, type: "removed", name: a?.name || id, details: ["只存在于基准分支 A"], changes: [] };
    const changes = numericKeys.map((key) => {
      const baseValue = Number(a.currentState?.[key] || 0);
      const compareValue = Number(b.currentState?.[key] || 0);
      return { key, label: characterMetricLabel(key), base: baseValue, compare: compareValue, delta: compareValue - baseValue };
    }).filter((item) => item.delta !== 0);
    const details = [];
    if (a.actionLines?.visible !== b.actionLines?.visible) details.push("显性行动线改变");
    if (a.actionLines?.desire !== b.actionLines?.desire) details.push("欲望行动线改变");
    if (a.actionLines?.defense !== b.actionLines?.defense) details.push("防御行动线改变");
    if (a.actionLines?.shadow !== b.actionLines?.shadow) details.push("阴影行动线改变");
    return { id, type: changes.length || details.length ? "changed" : "same", name: b.name || a.name || id, changes, details };
  }).sort(sortDiffItems);
}

function characterMetricLabel(key) {
  const labels = { desire: "欲望", shame: "羞耻", rage: "愤怒", selfDeception: "自欺", protectionImpulse: "保护", revengeImpulse: "报复", love: "爱慕", selfDestruction: "自毁" };
  return labels[key] || key;
}

function buildRelationshipDiff(baseRelationships, compareRelationships, baseSnapshot, compareSnapshot) {
  const baseMap = mapRelationships(baseRelationships);
  const compareMap = mapRelationships(compareRelationships);
  const ids = [...new Set([...baseMap.keys(), ...compareMap.keys()])];
  const numericKeys = ["love", "attraction", "resentment", "fear", "dependence", "power", "shame", "jealousy", "protection", "revenge", "deception", "wantsToBeSeen", "wantsToPossess", "wantsToEscape", "wantsToDestroy"];
  return ids.map((id) => {
    const a = baseMap.get(id);
    const b = compareMap.get(id);
    const source = b || a || {};
    const label = `${lookupName(compareSnapshot, baseSnapshot, source.fromCharacterId)} → ${lookupName(compareSnapshot, baseSnapshot, source.toCharacterId)}`;
    if (!a) return { id, type: "added", label, details: ["只存在于比较分支 B"], changes: [] };
    if (!b) return { id, type: "removed", label, details: ["只存在于基准分支 A"], changes: [] };
    const changes = numericKeys.map((key) => {
      const baseValue = Number(a[key] || 0);
      const compareValue = Number(b[key] || 0);
      return { key, label: relationshipMetricLabel(key), base: baseValue, compare: compareValue, delta: compareValue - baseValue };
    }).filter((item) => item.delta !== 0);
    const details = [];
    if ((a.misreading || "") !== (b.misreading || "")) details.push("误读改变");
    if ((a.unspoken || "") !== (b.unspoken || "")) details.push("未说出口的话改变");
    return { id, type: changes.length || details.length ? "changed" : "same", label, changes, details };
  }).sort(sortDiffItems);
}

function relationshipMetricLabel(key) {
  const labels = { love: "爱", attraction: "吸引", resentment: "怨恨", fear: "恐惧", dependence: "依赖", power: "权力", shame: "羞耻", jealousy: "嫉妒", protection: "保护", revenge: "报复", deception: "欺骗", wantsToBeSeen: "被看见", wantsToPossess: "占有", wantsToEscape: "逃离", wantsToDestroy: "毁掉" };
  return labels[key] || key;
}

function buildCollectionDiff(baseItems, compareItems, describe) {
  const baseMap = mapCollection(baseItems, describe);
  const compareMap = mapCollection(compareItems, describe);
  const keys = [...new Set([...baseMap.keys(), ...compareMap.keys()])];
  const items = keys.map((key) => {
    const a = baseMap.get(key);
    const b = compareMap.get(key);
    if (!a) return { key, type: "added", text: b.text, meta: b.meta };
    if (!b) return { key, type: "removed", text: a.text, meta: a.meta };
    return { key, type: "same", text: b.text, meta: b.meta };
  }).sort(sortDiffItems);
  return { added: items.filter((item) => item.type === "added"), removed: items.filter((item) => item.type === "removed"), same: items.filter((item) => item.type === "same") };
}

function mapById(items) { return new Map((items || []).map((item) => [item.id, item])); }
function mapRelationships(items) { return new Map((items || []).map((item) => [`${item.fromCharacterId}->${item.toCharacterId}`, item])); }
function mapCollection(items, describe) {
  const map = new Map();
  for (const item of items || []) {
    const descriptor = describe(item);
    const key = item?.id || descriptor.text;
    map.set(key, descriptor);
  }
  return map;
}
function describeCanonLikeItem(item) { return { text: item?.title || item?.summary || item?.surfaceEvent || item?.id || "未命名事件", meta: item?.summary || item?.acceptedAt || "" }; }
function describeDraftLikeItem(item) { return { text: item?.surfaceEvent || item?.title || item?.sceneText?.slice(0, 90) || item?.id || "未命名草稿", meta: item?.sceneText || item?.createdAt || "" }; }
function describeTraceLikeItem(item) { return { text: item?.content || item?.title || item?.type || item?.id || "未命名痕迹", meta: item?.distortion || item?.canBeMisreadAs || item?.type || "" }; }
function sortDiffItems(a, b) {
  const order = { changed: 0, added: 1, removed: 2, same: 3 };
  return (order[a.type] ?? 9) - (order[b.type] ?? 9) || String(a.name || a.label || a.text || a.key).localeCompare(String(b.name || b.label || b.text || b.key), "zh-Hans-CN");
}

function renderDiffSummary(diff) {
  return `<div class="diff-summary">${diff.stats.map((stat) => `<div class="card diff-stat-card"><div class="card-title"><span>${escapeHtml(stat.label)}</span>${renderDeltaBadge(stat.delta)}</div><div class="micro dim">A ${stat.base} → B ${stat.compare}</div></div>`).join("")}</div>`;
}

function renderCharacterDiffPanel(diff) {
  const changed = diff.characters.filter((item) => item.type !== "same");
  return `<div class="panel"><div class="panel-header"><div><div class="panel-title">人物状态差异</div><div class="panel-kicker">比较同一人物在两条命运线里的欲望、羞耻、报复和自毁变化</div></div></div><div class="panel-body stack">${changed.length ? changed.map(renderCharacterDiffCard).join("") : `<div class="scene-empty">人物状态暂无差异。</div>`}</div></div>`;
}
function renderCharacterDiffCard(item) {
  return `<div class="card diff-card ${item.type}"><div class="card-title"><span>${escapeHtml(item.name)}</span><span class="badge ${diffBadgeClass(item.type)}">${escapeHtml(diffTypeLabel(item.type))}</span></div>${item.changes?.length ? `<div class="diff-metric-list">${item.changes.slice(0, 8).map(renderDiffMetric).join("")}</div>` : ""}${item.details?.length ? `<div class="badge-row">${item.details.map((detail) => `<span class="badge">${escapeHtml(detail)}</span>`).join("")}</div>` : ""}</div>`;
}
function renderRelationshipDiffPanel(diff) {
  const changed = diff.relationships.filter((item) => item.type !== "same");
  return `<div class="panel"><div class="panel-header"><div><div class="panel-title">关系张力差异</div><div class="panel-kicker">比较爱、怨恨、欺骗、保护、占有、逃离和毁掉冲动</div></div></div><div class="panel-body stack">${changed.length ? changed.map(renderRelationshipDiffCard).join("") : `<div class="scene-empty">关系状态暂无差异。</div>`}</div></div>`;
}
function renderRelationshipDiffCard(item) {
  return `<div class="card diff-card ${item.type}"><div class="card-title"><span>${escapeHtml(item.label)}</span><span class="badge ${diffBadgeClass(item.type)}">${escapeHtml(diffTypeLabel(item.type))}</span></div>${item.changes?.length ? `<div class="diff-metric-list">${item.changes.slice(0, 10).map(renderDiffMetric).join("")}</div>` : ""}${item.details?.length ? `<div class="badge-row">${item.details.map((detail) => `<span class="badge">${escapeHtml(detail)}</span>`).join("")}</div>` : ""}</div>`;
}
function renderDiffMetric(change) {
  const tone = change.delta > 0 ? "up" : "down";
  return `<div class="diff-metric ${tone}"><span>${escapeHtml(change.label)}</span><strong>${change.base} → ${change.compare}</strong>${renderDeltaBadge(change.delta)}</div>`;
}
function renderCollectionDiffPanel(title, collection, kicker) {
  const visible = [...collection.added, ...collection.removed].slice(0, 14);
  return `<div class="panel"><div class="panel-header"><div><div class="panel-title">${escapeHtml(title)}</div><div class="panel-kicker">${escapeHtml(kicker)}</div></div></div><div class="panel-body stack"><div class="badge-row"><span class="badge good">B 新增 ${collection.added.length}</span><span class="badge danger">B 缺失 ${collection.removed.length}</span><span class="badge">相同 ${collection.same.length}</span></div>${visible.length ? visible.map(renderCollectionDiffItem).join("") : `<div class="scene-empty">暂无可见差异。</div>`}</div></div>`;
}
function renderCollectionDiffItem(item) {
  const meta = item.meta ? String(item.meta) : "";
  return `<div class="card diff-card ${item.type}"><div class="card-title"><span>${escapeHtml(item.text)}</span><span class="badge ${diffBadgeClass(item.type)}">${escapeHtml(diffTypeLabel(item.type))}</span></div>${meta ? `<div class="timeline-text">${escapeHtml(meta.slice(0, 220))}${meta.length > 220 ? "……" : ""}</div>` : ""}</div>`;
}
function renderDeltaBadge(delta) {
  const value = Number(delta) || 0;
  const cls = value > 0 ? "good" : value < 0 ? "danger" : "";
  const sign = value > 0 ? "+" : "";
  return `<span class="badge ${cls}">${sign}${value}</span>`;
}
function diffTypeLabel(type) { if (type === "added") return "B 新增"; if (type === "removed") return "B 缺失"; if (type === "changed") return "已改变"; return "相同"; }
function diffBadgeClass(type) { if (type === "added") return "good"; if (type === "removed") return "danger"; if (type === "changed") return "hot"; return ""; }
function lookupName(primarySnapshot, fallbackSnapshot, characterId) {
  const primary = (primarySnapshot.characters || []).find((character) => character.id === characterId);
  const fallback = (fallbackSnapshot.characters || []).find((character) => character.id === characterId);
  return primary?.name || fallback?.name || characterId;
}


function getLastDraft(state) {
  // v0.7: state.draftScenes already belongs to the active branch snapshot.
  if (state.ui.lastDraftId) {
    const direct = state.draftScenes.find((draft) => draft.id === state.ui.lastDraftId);
    if (direct) return direct;
  }
  return state.draftScenes[0];
}

function getName(state, id) {
  return state.characters.find((character) => character.id === id)?.name || id;
}

function getActiveBranch(state) {
  return (state.branches || []).find((branch) => branch.id === (state.ui.activeBranchId || state.project.activeBranchId));
}

function getBranchTitle(state, branchId) {
  return (state.branches || []).find((branch) => branch.id === branchId)?.title || branchId || "主线";
}

function getLocationName(state, id) {
  return state.locations.find((location) => location.id === id)?.name || id;
}

function getLocation(state, id) {
  return state.locations.find((location) => location.id === id) || state.locations[0] || { id, name: id || "舞台", likelyEvents: [] };
}
