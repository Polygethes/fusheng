import { RELATIONSHIP_PRESETS, setRelationship, removeRelationship } from "../blueprintModel.js";
import { setAt } from "../paths.js";
import { bindFields, escapeHtml } from "./common.js";

const FEELING_DIMENSIONS = [
  ["love", "爱"],
  ["attraction", "吸引"],
  ["resentment", "怨"],
  ["fear", "怕"],
  ["dependence", "依赖"],
  ["power", "压着对方"],
  ["shame", "羞愧"],
  ["jealousy", "嫉妒"],
  ["protection", "想护着"],
  ["revenge", "想报复"],
  ["deception", "瞒着对方"],
  ["wantsToBeSeen", "想被看见"],
  ["wantsToPossess", "想占有"],
  ["wantsToEscape", "想躲开"],
  ["wantsToDestroy", "想毁掉"],
];

const DIMENSION_LABEL_MAP = Object.fromEntries(FEELING_DIMENSIONS);

export function render(container, ctx) {
  const bp = ctx.blueprint();
  const residents = bp.residents || [];
  const relationships = bp.relationships || [];

  const residentMap = new Map(residents.map((r) => [r.id, r]));

  // Find residents without any relationships
  const unlinkedResidents = residents.filter(
    (r) => !relationships.some((rel) => rel.from === r.id || rel.to === r.id),
  );

  // Group relationships by `from`
  const byFrom = new Map();
  relationships.forEach((rel, index) => {
    if (!byFrom.has(rel.from)) byFrom.set(rel.from, []);
    byFrom.get(rel.from).push({ rel, index });
  });

  let cardsHtml = "";
  if (relationships.length === 0) {
    cardsHtml = `<div class="row-empty">暂无关系，请在下方添加</div>`;
  } else {
    for (const [fromId, relList] of byFrom.entries()) {
      const fromPerson = residentMap.get(fromId);
      const fromName = fromPerson ? fromPerson.name || fromId : fromId;
      cardsHtml += `
        <div class="rel-group">
          <div class="rel-group-title">从「${escapeHtml(fromName)}」出发的关系 (${relList.length})</div>
          <div class="rel-card-list">
            ${relList.map(({ rel, index }) => renderRelationshipCard(rel, index, residentMap)).join("")}
          </div>
        </div>
      `;
    }
  }

  const residentOptions = [
    { value: "", label: "选择人物..." },
    ...residents.map((r) => ({ value: r.id, label: r.name ? `${r.name} (${r.role || r.id})` : r.id })),
  ];

  container.innerHTML = `
    <div class="relationships-editor">
      <div class="editor-notice">
        <div class="notice-main">关系有方向：A 怎么看 B，和 B 怎么看 A，是两条。</div>
        ${unlinkedResidents.length > 0 ? `
          <div class="unlinked-warning">
            <strong>未建立关系的人物：</strong>${unlinkedResidents.map((r) => escapeHtml(r.name || r.id)).join("、")}。每个人至少要有一条关系。
          </div>
        ` : ""}
      </div>

      <div class="rel-main-list">
        ${cardsHtml}
      </div>

      <div class="editor-section add-rel-section">
        <div class="section-title">添加关系</div>
        <div class="add-rel-controls">
          <div class="field">
            <label>从谁 (A)</label>
            <select class="add-rel-from">
              ${residentOptions.map((opt) => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`).join("")}
            </select>
          </div>
          <span class="rel-arrow">→</span>
          <div class="field">
            <label>到谁 (B)</label>
            <select class="add-rel-to">
              ${residentOptions.map((opt) => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`).join("")}
            </select>
          </div>
          <button type="button" class="btn primary btn-add-rel">添加关系</button>
        </div>
        <div class="add-rel-warning note" style="display: none;"></div>
      </div>
    </div>
  `;

  // Bind relationship cards
  bindRelationshipEvents(container, ctx, residentMap);

  // Bind Add Relationship
  const fromSelect = container.querySelector(".add-rel-from");
  const toSelect = container.querySelector(".add-rel-to");
  const addBtn = container.querySelector(".btn-add-rel");
  const warnEl = container.querySelector(".add-rel-warning");

  function checkAddState() {
    const from = fromSelect?.value;
    const to = toSelect?.value;
    if (warnEl) {
      if (from && to && from === to) {
        warnEl.textContent = "关系不能指向自己。";
        warnEl.style.display = "block";
      } else if (from && to && ctx.blueprint().relationships?.some((r) => r.from === from && r.to === to)) {
        warnEl.textContent = "已经有了这条关系。";
        warnEl.style.display = "block";
      } else {
        warnEl.style.display = "none";
      }
    }
  }

  fromSelect?.addEventListener("change", checkAddState);
  toSelect?.addEventListener("change", checkAddState);

  addBtn?.addEventListener("click", () => {
    const from = fromSelect?.value;
    const to = toSelect?.value;
    if (!from || !to) {
      if (warnEl) {
        warnEl.textContent = "请选择双方人物。";
        warnEl.style.display = "block";
      }
      return;
    }
    if (from === to) {
      if (warnEl) {
        warnEl.textContent = "关系不能指向自己。";
        warnEl.style.display = "block";
      }
      return;
    }
    if (ctx.blueprint().relationships?.some((r) => r.from === from && r.to === to)) {
      if (warnEl) {
        warnEl.textContent = "已经有了这条关系。";
        warnEl.style.display = "block";
      }
      return;
    }

    const next = setRelationship(ctx.blueprint(), from, to, {
      label: "",
      address: [],
      feelings: {},
      unspoken: "",
      misreading: "",
    });
    ctx.replace(next);
  });

  bindFields(container, ctx);
}

function renderRelationshipCard(rel, index, residentMap) {
  const p = `relationships[${index}]`;
  const fromPerson = residentMap.get(rel.from);
  const toPerson = residentMap.get(rel.to);
  const fromName = fromPerson ? fromPerson.name || rel.from : rel.from;
  const toName = toPerson ? toPerson.name || rel.to : rel.to;

  const feelings = rel.feelings || {};
  const currentDimKeys = Object.keys(feelings);
  const availableDims = FEELING_DIMENSIONS.filter(([k]) => !currentDimKeys.includes(k));

  return `
    <div class="rel-card" data-rel-index="${index}">
      <div class="rel-card-header">
        <div class="rel-title">
          <span class="rel-person from">${escapeHtml(fromName)}</span>
          <span class="rel-arrow">→</span>
          <span class="rel-person to">${escapeHtml(toName)}</span>
        </div>
        <div class="rel-actions">
          <button type="button" class="btn btn-rewrite-rel" data-index="${index}">让模型重写这条</button>
          <button type="button" class="btn btn-del-rel" data-index="${index}">删除</button>
        </div>
      </div>

      <div class="rel-card-body">
        <!-- 关系标签与预设 -->
        <div class="field">
          <label>关系</label>
          <input type="text" data-path="${p}.label" value="${escapeHtml(rel.label || "")}" maxlength="60" placeholder="怎么看对方（如：老邻居、暗中爱慕）" />
          <div class="rel-presets">
            <span class="presets-label">预设：</span>
            ${RELATIONSHIP_PRESETS.map((preset, prIdx) => `
              <button type="button" class="btn btn-preset" data-rel-index="${index}" data-preset-idx="${prIdx}">${escapeHtml(preset.label)}</button>
            `).join("")}
          </div>
        </div>

        <!-- 称呼 -->
        <div class="field" data-path="${p}.address">
          <label>称呼（逗号分隔，最多 6 个，每个 ≤20 字）</label>
          <input type="text" class="rel-address-input" data-rel-index="${index}" value="${escapeHtml((rel.address || []).join("，"))}" placeholder="平时怎么叫对方，如：阿芸，师妹" />
        </div>

        <!-- 感情维度 -->
        <div class="field feelings-field">
          <label>感情维度 (${currentDimKeys.length}/15)</label>
          <div class="feelings-list">
            ${currentDimKeys.map((dim) => {
              const dimName = DIMENSION_LABEL_MAP[dim] || dim;
              const val = Math.round(Number(feelings[dim] ?? 50));
              return `
                <div class="slider-row feeling-row" data-path="${p}.feelings.${dim}">
                  <span class="feeling-name">${escapeHtml(dimName)}</span>
                  <input type="range" class="feeling-slider" min="0" max="100" value="${val}" data-rel-index="${index}" data-dim="${dim}" />
                  <span class="feeling-val">${val}</span>
                  <button type="button" class="btn btn-del-feeling" data-rel-index="${index}" data-dim="${dim}">×</button>
                </div>
              `;
            }).join("")}
          </div>
          ${availableDims.length > 0 ? `
            <div class="add-feeling-row">
              <select class="new-feeling-select" data-rel-index="${index}">
                <option value="">+ 选择要添加的感情维度...</option>
                ${availableDims.map(([k, name]) => `<option value="${escapeHtml(k)}">${escapeHtml(name)}</option>`).join("")}
              </select>
            </div>
          ` : ""}
        </div>

        <!-- 没说出口的话 & 看错的地方 -->
        <div class="field-grid">
          <div class="field">
            <label>没说出口的话</label>
            <input type="text" data-path="${p}.unspoken" value="${escapeHtml(rel.unspoken || "")}" maxlength="200" placeholder="心里想但没说出来的话..." />
          </div>
          <div class="field">
            <label>可能看错的地方</label>
            <input type="text" data-path="${p}.misreading" value="${escapeHtml(rel.misreading || "")}" maxlength="200" placeholder="对对方的误解或误读..." />
          </div>
        </div>
      </div>
    </div>
  `;
}

function bindRelationshipEvents(container, ctx, residentMap) {
  // Preset buttons
  container.querySelectorAll(".btn-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      const relIdx = Number(btn.getAttribute("data-rel-index"));
      const prIdx = Number(btn.getAttribute("data-preset-idx"));
      const preset = RELATIONSHIP_PRESETS[prIdx];
      const rel = ctx.blueprint().relationships?.[relIdx];
      if (!preset || !rel) return;

      const next = setRelationship(ctx.blueprint(), rel.from, rel.to, {
        label: preset.label,
        feelings: { ...preset.feelings },
      });
      ctx.replace(next);
    });
  });

  // Address input
  container.querySelectorAll(".rel-address-input").forEach((input) => {
    input.addEventListener("input", (e) => {
      const relIdx = Number(input.getAttribute("data-rel-index"));
      const p = `relationships[${relIdx}]`;
      const val = e.target.value;
      const arr = val
        .split(/[，,]/u)
        .map((s) => s.trim().slice(0, 20))
        .filter(Boolean)
        .slice(0, 6);
      ctx.update(`${p}.address`, arr);
    });
  });

  // Feelings sliders
  container.querySelectorAll(".feeling-slider").forEach((slider) => {
    slider.addEventListener("input", (e) => {
      const relIdx = Number(slider.getAttribute("data-rel-index"));
      const dim = slider.getAttribute("data-dim");
      const val = Number(e.target.value);
      const valEl = slider.parentElement?.querySelector(".feeling-val");
      if (valEl) valEl.textContent = String(val);
      ctx.update(`relationships[${relIdx}].feelings.${dim}`, val);
    });
  });

  // Feelings delete
  container.querySelectorAll(".btn-del-feeling").forEach((btn) => {
    btn.addEventListener("click", () => {
      const relIdx = Number(btn.getAttribute("data-rel-index"));
      const dim = btn.getAttribute("data-dim");
      const rel = ctx.blueprint().relationships?.[relIdx];
      if (!rel) return;
      const nextFeelings = { ...(rel.feelings || {}) };
      delete nextFeelings[dim];
      const bp = setAt(ctx.blueprint(), `relationships[${relIdx}].feelings`, nextFeelings);
      ctx.replace(bp);
    });
  });

  // Feelings add select
  container.querySelectorAll(".new-feeling-select").forEach((select) => {
    select.addEventListener("change", () => {
      const dim = select.value;
      if (!dim) return;
      const relIdx = Number(select.getAttribute("data-rel-index"));
      const rel = ctx.blueprint().relationships?.[relIdx];
      if (!rel) return;
      const nextFeelings = { ...(rel.feelings || {}), [dim]: 50 };
      const bp = setAt(ctx.blueprint(), `relationships[${relIdx}].feelings`, nextFeelings);
      ctx.replace(bp);
    });
  });

  // Rewrite relationship
  container.querySelectorAll(".btn-rewrite-rel").forEach((btn) => {
    btn.addEventListener("click", () => {
      const relIdx = Number(btn.getAttribute("data-index"));
      const rel = ctx.blueprint().relationships?.[relIdx];
      if (!rel) return;
      const fromPerson = residentMap.get(rel.from);
      const toPerson = residentMap.get(rel.to);
      const fromName = fromPerson ? fromPerson.name || rel.from : rel.from;
      const toName = toPerson ? toPerson.name || rel.to : rel.to;
      ctx.rewrite(`relationships/${rel.from}/${rel.to}`, `关系 ${fromName}→${toName}`);
    });
  });

  // Delete relationship
  container.querySelectorAll(".btn-del-rel").forEach((btn) => {
    btn.addEventListener("click", () => {
      const relIdx = Number(btn.getAttribute("data-index"));
      const rel = ctx.blueprint().relationships?.[relIdx];
      if (!rel) return;
      const next = removeRelationship(ctx.blueprint(), rel.from, rel.to);
      ctx.replace(next);
    });
  });
}
