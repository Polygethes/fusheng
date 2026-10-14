import { sprite, drawPortrait } from "../../stage/sprites.js";
import {
  PALETTES,
  PERSONALITY_SLIDERS,
  SKILL_CHOICES,
  sliderValue,
  setSlider,
  addResident,
  removeResident,
} from "../blueprintModel.js";
import { setAt } from "../paths.js";
import { field, bindFields, escapeHtml } from "./common.js";

const STYLE_LABELS = [
  ["bun", "发髻"],
  ["beard", "胡子"],
  ["long", "长发"],
  ["apron", "围裙"],
  ["sword", "佩剑"],
  ["bandaged", "缠绷带"],
  ["short", "短发"],
  ["braid", "辫子"],
  ["hat", "帽子"],
  ["bald", "光头"],
  ["ponytail", "马尾"],
  ["clean_shaven", "净面"],
];

let expandedResidentId = null;

function timeToMinutes(t = "") {
  const parts = String(t).split(":");
  if (parts.length < 2) return 0;
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  return Math.min(1440, Math.max(0, h * 60 + m));
}

export function render(container, ctx) {
  const bp = ctx.blueprint();
  const residents = bp.residents || [];
  const households = bp.households || [];
  const sites = bp.town?.sites || [];

  if (!expandedResidentId && residents.length > 0) {
    expandedResidentId = residents[0].id;
  }
  if (expandedResidentId && !residents.some((r) => r.id === expandedResidentId)) {
    expandedResidentId = residents[0]?.id || null;
  }

  // Group residents by household
  const householdMap = new Map();
  for (const hh of households) {
    householdMap.set(hh.id, []);
  }
  const otherResidents = [];

  for (const r of residents) {
    if (r.householdId && householdMap.has(r.householdId)) {
      householdMap.get(r.householdId).push(r);
    } else {
      otherResidents.push(r);
    }
  }

  // Build group cards HTML
  let groupsHtml = "";
  for (const hh of households) {
    const members = householdMap.get(hh.id) || [];
    groupsHtml += `
      <div class="resident-group">
        <div class="resident-group-title">户：${escapeHtml(hh.name || hh.id)}</div>
        <div class="resident-card-list">
          ${members.map((m) => renderResidentCard(m, m.id === expandedResidentId)).join("")}
        </div>
        <div class="add-resident-row">
          <button type="button" class="btn btn-add-resident" data-household-id="${escapeHtml(hh.id)}">+ 添加一位</button>
        </div>
      </div>
    `;
  }

  if (otherResidents.length > 0 || households.length === 0) {
    groupsHtml += `
      <div class="resident-group">
        <div class="resident-group-title">其他</div>
        <div class="resident-card-list">
          ${otherResidents.map((m) => renderResidentCard(m, m.id === expandedResidentId)).join("")}
        </div>
        <div class="add-resident-row">
          <button type="button" class="btn btn-add-resident" data-household-id="">+ 添加一位</button>
        </div>
      </div>
    `;
  }

  // Expanded resident editor HTML
  const expandedResident = residents.find((r) => r.id === expandedResidentId);
  const expIndex = residents.indexOf(expandedResident);

  let editorHtml = "";
  if (expandedResident && expIndex >= 0) {
    editorHtml = renderExpandedEditor(expandedResident, expIndex, households, sites);
  } else {
    editorHtml = `<div class="editor-placeholder"><p>请选择或添加一位居民进行编辑</p></div>`;
  }

  container.innerHTML = `
    <div class="people-page">
      <div class="people-sidebar">
        ${groupsHtml}
      </div>
      <div class="people-main">
        ${editorHtml}
      </div>
    </div>
  `;

  // Draw portraits for cards
  container.querySelectorAll(".card-portrait-canvas").forEach((cEl) => {
    const rId = cEl.getAttribute("data-resident-id");
    const m = residents.find((r) => r.id === rId);
    if (m) {
      const c2d = cEl.getContext("2d");
      if (c2d) drawPortrait(c2d, m, 24);
    }
  });

  // Card click to expand
  container.querySelectorAll(".person-card").forEach((cardEl) => {
    cardEl.addEventListener("click", () => {
      const rId = cardEl.getAttribute("data-resident-id");
      if (rId && rId !== expandedResidentId) {
        expandedResidentId = rId;
        render(container, ctx);
      }
    });
  });

  // Add resident buttons
  container.querySelectorAll(".btn-add-resident").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const hhId = btn.getAttribute("data-household-id") || "";
      const res = addResident(ctx.blueprint(), hhId);
      expandedResidentId = res.id;
      ctx.replace(res.blueprint);
    });
  });

  if (expandedResident && expIndex >= 0) {
    bindExpandedEditor(container, ctx, expandedResident, expIndex, sites);
  }

  bindFields(container, ctx);
}

function renderResidentCard(r, isExpanded) {
  return `
    <div class="person-card${isExpanded ? " active" : ""}" data-resident-id="${escapeHtml(r.id)}">
      <div class="person-card-portrait">
        <canvas class="card-portrait-canvas" width="24" height="24" data-resident-id="${escapeHtml(r.id)}"></canvas>
      </div>
      <div class="person-card-info">
        <div class="person-card-name">${escapeHtml(r.name || "未命名")}</div>
        <div class="person-card-meta">${escapeHtml(r.age ? `${r.age} 岁` : "")} · ${escapeHtml(r.role || "无身份")}</div>
      </div>
    </div>
  `;
}

function renderExpandedEditor(r, i, households, sites) {
  const p = `residents[${i}]`;
  const app = r.appearance || {};
  const personality = r.personality || {};
  const skills = r.skills || [];
  const speech = r.speech || { style: "", samples: [] };
  const samples = speech.samples || [];
  const desires = r.desires || [];
  const principles = r.principles || [];
  const boundaries = r.boundaries || [];
  const routine = r.routine || [];
  const memories = r.memories || [];
  const secrets = r.secrets || [];

  const isChild = Boolean(app.child || (r.age != null && r.age < 14));

  const householdOptions = [
    { value: "", label: "无 / 其他" },
    ...households.map((h) => ({ value: h.id, label: h.name || h.id })),
  ];

  const siteOptions = [
    { value: "", label: "无 / 未指定" },
    ...sites.map((s) => ({ value: s.id, label: s.name || s.id })),
  ];

  return `
    <div class="person-editor">
      <!-- 基本信息 -->
      <div class="editor-section">
        <div class="section-title">基本信息</div>
        <div class="field-grid">
          ${field({ path: `${p}.name`, label: "名字", value: r.name, maxLength: 24 })}
          ${field({ path: `${p}.age`, label: "年龄", value: r.age, kind: "number" })}
          ${field({ path: `${p}.role`, label: "身份", value: r.role, maxLength: 80 })}
          ${field({ path: `${p}.householdId`, label: "所属户", value: r.householdId, kind: "select", options: householdOptions })}
          ${field({ path: `${p}.workSiteId`, label: "在哪干活", value: r.workSiteId, kind: "select", options: siteOptions })}
        </div>
      </div>

      <!-- 外貌 -->
      <div class="editor-section">
        <div class="section-title">外貌</div>
        <div class="appearance-container">
          <div class="appearance-preview">
            <div class="preview-dirs">
              <div class="dir-cell"><canvas class="preview-canvas-dir" width="14" height="22" data-dir="down"></canvas><span>正</span></div>
              <div class="dir-cell"><canvas class="preview-canvas-dir" width="14" height="22" data-dir="left"></canvas><span>左</span></div>
              <div class="dir-cell"><canvas class="preview-canvas-dir" width="14" height="22" data-dir="right"></canvas><span>右</span></div>
              <div class="dir-cell"><canvas class="preview-canvas-dir" width="14" height="22" data-dir="up"></canvas><span>背</span></div>
            </div>
          </div>
          <div class="appearance-controls">
            ${renderPaletteRow(i, "skin", "肤色", PALETTES.skin, app.skin)}
            ${renderPaletteRow(i, "hair", "发色", PALETTES.hair, app.hair)}
            ${renderPaletteRow(i, "robe", "衣色", PALETTES.robe, app.robe)}
            ${renderPaletteRow(i, "sash", "腰带", PALETTES.sash, app.sash)}

            <div class="styles-row">
              <label>造型</label>
              <div class="chips-wrap style-chips">
                ${STYLE_LABELS.map(([key, name]) => {
                  const active = (app.styles || []).includes(key);
                  return `<button type="button" class="chip-btn style-chip${active ? " active" : ""}" data-style="${key}">${escapeHtml(name)}</button>`;
                }).join("")}
              </div>
            </div>

            <div class="child-row">
              <label class="checkbox-label">
                <input type="checkbox" class="child-checkbox" ${isChild ? "checked" : ""} ${r.age < 14 ? "disabled" : ""} />
                孩子（年龄小于 14 岁时自动勾选）
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- 性格 -->
      <div class="editor-section">
        <div class="section-title">性格</div>
        <div class="personality-list">
          ${PERSONALITY_SLIDERS.map((row) => {
            const val = sliderValue(personality, row.key);
            return `
              <div class="slider-row" data-path="${p}.personality.${row.key}">
                <span class="slider-end-label low">${escapeHtml(row.low)}</span>
                <input type="range" class="personality-slider" min="0" max="100" value="${val}" data-key="${row.key}" />
                <span class="slider-end-label high">${escapeHtml(row.high)}</span>
              </div>
            `;
          }).join("")}
        </div>
      </div>

      <!-- 技能 -->
      <div class="editor-section">
        <div class="section-title">技能</div>
        <div class="chips-wrap skill-chips">
          ${SKILL_CHOICES.map((s) => {
            const active = skills.includes(s.id);
            return `<button type="button" class="chip-btn skill-chip${active ? " active" : ""}" data-skill="${escapeHtml(s.id)}">${escapeHtml(s.name)}</button>`;
          }).join("")}
        </div>
      </div>

      <!-- 说话 -->
      <div class="editor-section">
        <div class="section-title">说话</div>
        ${field({ path: `${p}.speech.style`, label: "说话方式", value: speech.style, kind: "textarea", maxLength: 400 })}
        <div class="sub-section-title">示例台词 (${samples.length}/12)</div>
        <div class="row-list samples-list">
          ${samples.map((sample, k) => `
            <div class="row-item">
              <div class="row-inputs">
                <input type="text" data-path="${p}.speech.samples[${k}]" value="${escapeHtml(sample)}" maxlength="80" placeholder="台词..." />
                <button type="button" class="btn btn-del-sample" data-index="${k}">删除</button>
              </div>
            </div>
          `).join("")}
        </div>
        ${samples.length < 12 ? `
          <div class="add-row">
            <button type="button" class="btn btn-add-sample">+ 添加一句台词</button>
          </div>
        ` : ""}
      </div>

      <!-- 处境 -->
      <div class="editor-section">
        <div class="section-title">处境</div>
        ${field({ path: `${p}.situation`, label: "处境", value: r.situation, kind: "textarea", maxLength: 400 })}
      </div>

      <!-- 欲望 -->
      <div class="editor-section">
        <div class="section-title">欲望 (${desires.length}/4)</div>
        <div class="row-list desires-list">
          ${desires.map((d, k) => `
            <div class="row-item desire-item">
              <div class="desire-row-inputs">
                <span>想</span>
                <input type="text" class="input-inline" data-path="${p}.desires[${k}].verb" value="${escapeHtml(d.verb || "")}" placeholder="动词（如：修好）" maxlength="24" />
                <div class="input-with-hint">
                  <input type="text" class="input-inline" data-path="${p}.desires[${k}].object" value="${escapeHtml(d.object || "")}" placeholder="具体人/地/物（如：药柜抽屉）" maxlength="80" />
                  <span class="field-hint">写具体的人、地点或东西的名字，比如“百草堂的腰伤药包”</span>
                </div>
                <span>，盼着</span>
                <input type="text" class="input-inline" data-path="${p}.desires[${k}].outcome" value="${escapeHtml(d.outcome || "")}" placeholder="结果（如：能顺顺当当拉开）" maxlength="200" />
                <button type="button" class="btn btn-del-desire" data-index="${k}">删除</button>
              </div>
              <div class="slider-row desire-slider-row" data-path="${p}.desires[${k}].strength">
                <span class="slider-end-label">强度</span>
                <input type="range" class="desire-strength-slider" min="0" max="100" value="${Math.round((d.strength ?? 0.5) * 100)}" data-index="${k}" />
                <span class="slider-value-label">${Math.round((d.strength ?? 0.5) * 100)}%</span>
              </div>
            </div>
          `).join("")}
        </div>
        ${desires.length < 4 ? `
          <div class="add-row">
            <button type="button" class="btn btn-add-desire">+ 添加一条欲望</button>
          </div>
        ` : ""}
      </div>

      <!-- 原则 -->
      <div class="editor-section">
        <div class="section-title">原则 (${principles.length}/8)</div>
        <div class="row-list principles-list">
          ${principles.map((pri, k) => `
            <div class="row-item">
              <div class="row-inputs">
                <input type="text" data-path="${p}.principles[${k}]" value="${escapeHtml(pri)}" maxlength="100" placeholder="为人处事的原则..." />
                <button type="button" class="btn btn-del-principle" data-index="${k}">删除</button>
              </div>
            </div>
          `).join("")}
        </div>
        ${principles.length < 8 ? `
          <div class="add-row">
            <button type="button" class="btn btn-add-principle">+ 添加原则</button>
          </div>
        ` : ""}
      </div>

      <!-- 底线 -->
      <div class="editor-section">
        <div class="section-title">底线 (${boundaries.length}/6)</div>
        <div class="row-list boundaries-list">
          ${boundaries.map((bnd, k) => `
            <div class="row-item boundary-item">
              <div class="boundary-grid">
                <div class="field">
                  <label>护着什么</label>
                  <input type="text" data-path="${p}.boundaries[${k}].protects" value="${escapeHtml(bnd.protects || "")}" maxlength="80" placeholder="如：家传的铁砧" />
                </div>
                <div class="field">
                  <label>碰到什么</label>
                  <input type="text" data-path="${p}.boundaries[${k}].trigger" value="${escapeHtml(bnd.trigger || "")}" maxlength="100" placeholder="如：有人出言讥讽" />
                </div>
                <div class="field">
                  <label>会怎样</label>
                  <input type="text" data-path="${p}.boundaries[${k}].response" value="${escapeHtml(bnd.response || "")}" maxlength="100" placeholder="如：当场翻脸" />
                </div>
                <button type="button" class="btn btn-del-boundary" data-index="${k}">删除</button>
              </div>
            </div>
          `).join("")}
        </div>
        ${boundaries.length < 6 ? `
          <div class="add-row">
            <button type="button" class="btn btn-add-boundary">+ 添加底线</button>
          </div>
        ` : ""}
      </div>

      <!-- 作息 -->
      <div class="editor-section">
        <div class="section-title">作息 (${routine.length}/12)</div>
        <div class="row-list routine-list">
          ${routine.map((block, k) => {
            const startMin = timeToMinutes(block.from);
            const endMin = timeToMinutes(block.to);
            const duration = Math.max(0, endMin >= startMin ? endMin - startMin : 1440 - startMin + endMin);
            const leftPct = ((startMin / 1440) * 100).toFixed(1);
            const widthPct = ((duration / 1440) * 100).toFixed(1);

            return `
              <div class="row-item routine-item">
                <div class="routine-inputs">
                  <input type="text" class="input-clock" data-path="${p}.routine[${k}].from" data-kind="clock" value="${escapeHtml(block.from || "")}" placeholder="HH:MM" maxlength="5" />
                  <span>至</span>
                  <input type="text" class="input-clock" data-path="${p}.routine[${k}].to" data-kind="clock" value="${escapeHtml(block.to || "")}" placeholder="HH:MM" maxlength="5" />
                  <select data-path="${p}.routine[${k}].siteId">
                    ${siteOptions.map((opt) => `<option value="${escapeHtml(opt.value)}"${opt.value === block.siteId ? " selected" : ""}>${escapeHtml(opt.label)}</option>`).join("")}
                  </select>
                  <input type="text" data-path="${p}.routine[${k}].activity" value="${escapeHtml(block.activity || "")}" placeholder="做什么..." maxlength="100" />
                  <button type="button" class="btn btn-del-routine" data-index="${k}">删除</button>
                </div>
                <div class="timeline-bar-wrapper">
                  <div class="timeline-bar-track">
                    <div class="timeline-bar-fill" style="left: ${leftPct}%; width: ${widthPct}%;"></div>
                  </div>
                  <div class="timeline-bar-labels"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
                </div>
              </div>
            `;
          }).join("")}
        </div>
        ${routine.length < 12 ? `
          <div class="add-row">
            <button type="button" class="btn btn-add-routine">+ 添加作息段</button>
          </div>
        ` : ""}
      </div>

      <!-- 记忆 -->
      <div class="editor-section">
        <div class="section-title">记忆 (${memories.length}/6)</div>
        <div class="row-list memories-list">
          ${memories.map((m, k) => `
            <div class="row-item">
              <div class="row-inputs">
                <input type="text" data-path="${p}.memories[${k}].when" value="${escapeHtml(m.when || "")}" placeholder="什么时候..." maxlength="40" style="flex: 1;" />
                <input type="text" data-path="${p}.memories[${k}].content" value="${escapeHtml(m.content || "")}" placeholder="内容..." maxlength="200" style="flex: 2;" />
                <button type="button" class="btn btn-del-memory" data-index="${k}">删除</button>
              </div>
            </div>
          `).join("")}
        </div>
        ${memories.length < 6 ? `
          <div class="add-row">
            <button type="button" class="btn btn-add-memory">+ 添加记忆</button>
          </div>
        ` : ""}
      </div>

      <!-- 秘密 -->
      <div class="editor-section">
        <div class="section-title">秘密 (${secrets.length}/6)</div>
        <div class="row-list secrets-list">
          ${secrets.map((sec, k) => `
            <div class="row-item">
              <div class="row-inputs">
                <input type="text" data-path="${p}.secrets[${k}]" value="${escapeHtml(sec)}" maxlength="200" placeholder="不可告人的秘密..." />
                <button type="button" class="btn btn-del-secret" data-index="${k}">删除</button>
              </div>
            </div>
          `).join("")}
        </div>
        ${secrets.length < 6 ? `
          <div class="add-row">
            <button type="button" class="btn btn-add-secret">+ 添加秘密</button>
          </div>
        ` : ""}
      </div>

      <!-- 底部按钮 -->
      <div class="editor-actions resident-actions">
        <button type="button" class="btn btn-rewrite-resident">让模型补全 / 重写这个人</button>
        <button type="button" class="btn btn-danger btn-del-resident">删除这个人</button>
      </div>
    </div>
  `;
}

function renderPaletteRow(i, prop, label, colors = [], currentValue = "") {
  return `
    <div class="palette-row" data-prop="${prop}">
      <span class="palette-label">${escapeHtml(label)}</span>
      <div class="swatches">
        ${colors.map((c) => {
          const active = c.toLowerCase() === (currentValue || "").toLowerCase();
          return `<button type="button" class="swatch-btn${active ? " active" : ""}" style="background-color: ${c}" data-color="${c}" title="${c}"></button>`;
        }).join("")}
        <input type="color" class="swatch-custom-color" value="${currentValue || "#000000"}" title="自定义颜色" />
      </div>
    </div>
  `;
}

function bindExpandedEditor(container, ctx, r, i, sites) {
  const p = `residents[${i}]`;

  // Draw 4-dir appearance preview
  function updatePreview(appearance) {
    const member = { id: "preview:" + JSON.stringify(appearance), appearance };
    container.querySelectorAll(".preview-canvas-dir").forEach((cEl) => {
      const dir = cEl.getAttribute("data-dir") || "down";
      const c2d = cEl.getContext("2d");
      if (c2d) {
        c2d.imageSmoothingEnabled = false;
        c2d.clearRect(0, 0, 14, 22);
        const spr = sprite(member, dir, 0);
        c2d.drawImage(spr, 0, 0);
      }
    });
  }

  updatePreview(r.appearance || {});

  // Swatches click
  container.querySelectorAll(".palette-row").forEach((row) => {
    const prop = row.getAttribute("data-prop");
    row.querySelectorAll(".swatch-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const color = btn.getAttribute("data-color");
        row.querySelectorAll(".swatch-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const customInput = row.querySelector(".swatch-custom-color");
        if (customInput) customInput.value = color;

        r.appearance = { ...(r.appearance || {}), [prop]: color };
        ctx.update(`${p}.appearance.${prop}`, color);
        updatePreview(r.appearance);
      });
    });

    const customInput = row.querySelector(".swatch-custom-color");
    customInput?.addEventListener("input", (e) => {
      const color = e.target.value;
      row.querySelectorAll(".swatch-btn").forEach((b) => b.classList.remove("active"));
      r.appearance = { ...(r.appearance || {}), [prop]: color };
      ctx.update(`${p}.appearance.${prop}`, color);
      updatePreview(r.appearance);
    });
  });

  // Styles multi-select
  container.querySelectorAll(".style-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const styleKey = btn.getAttribute("data-style");
      const curStyles = [...(r.appearance?.styles || [])];
      const idx = curStyles.indexOf(styleKey);
      let nextStyles;
      if (idx >= 0) {
        curStyles.splice(idx, 1);
        nextStyles = curStyles;
        btn.classList.remove("active");
      } else {
        nextStyles = [...curStyles, styleKey];
        btn.classList.add("active");
      }
      r.appearance = { ...(r.appearance || {}), styles: nextStyles };
      ctx.update(`${p}.appearance.styles`, nextStyles);
      updatePreview(r.appearance);
    });
  });

  // Child checkbox
  const childCheckbox = container.querySelector(".child-checkbox");
  childCheckbox?.addEventListener("change", (e) => {
    const isChild = e.target.checked;
    r.appearance = { ...(r.appearance || {}), child: isChild };
    ctx.update(`${p}.appearance.child`, isChild);
    updatePreview(r.appearance);
  });

  // Watch age input to auto-check child
  const ageInput = container.querySelector(`[data-path="${p}.age"]`);
  ageInput?.addEventListener("input", (e) => {
    const age = Number(e.target.value);
    if (!isNaN(age) && age < 14) {
      if (childCheckbox) {
        childCheckbox.checked = true;
        childCheckbox.disabled = true;
      }
      if (!r.appearance?.child) {
        r.appearance = { ...(r.appearance || {}), child: true };
        ctx.update(`${p}.appearance.child`, true);
        updatePreview(r.appearance);
      }
    } else if (childCheckbox) {
      childCheckbox.disabled = false;
    }
  });

  // Personality sliders
  container.querySelectorAll(".personality-slider").forEach((slider) => {
    slider.addEventListener("input", (e) => {
      const key = slider.getAttribute("data-key");
      const val = Number(e.target.value) / 100;
      r.personality = setSlider(r.personality, key, val * 100);
      ctx.update(`${p}.personality.${key}`, val);
    });
  });

  // Skills multi-select
  container.querySelectorAll(".skill-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const skillId = btn.getAttribute("data-skill");
      const curSkills = [...(r.skills || [])];
      const idx = curSkills.indexOf(skillId);
      let nextSkills;
      if (idx >= 0) {
        curSkills.splice(idx, 1);
        nextSkills = curSkills;
        btn.classList.remove("active");
      } else {
        nextSkills = [...curSkills, skillId];
        btn.classList.add("active");
      }
      r.skills = nextSkills;
      ctx.update(`${p}.skills`, nextSkills);
    });
  });

  // Speech samples add/del
  container.querySelector(".btn-add-sample")?.addEventListener("click", () => {
    const samples = [...(r.speech?.samples || []), ""];
    const bp = setAt(ctx.blueprint(), `${p}.speech.samples`, samples);
    ctx.replace(bp);
  });

  container.querySelectorAll(".btn-del-sample").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-index"));
      const samples = [...(r.speech?.samples || [])];
      samples.splice(idx, 1);
      const bp = setAt(ctx.blueprint(), `${p}.speech.samples`, samples);
      ctx.replace(bp);
    });
  });

  // Desires strength slider
  container.querySelectorAll(".desire-strength-slider").forEach((slider) => {
    slider.addEventListener("input", (e) => {
      const idx = Number(slider.getAttribute("data-index"));
      const val = Number(e.target.value) / 100;
      const label = slider.parentElement?.querySelector(".slider-value-label");
      if (label) label.textContent = `${Math.round(val * 100)}%`;
      ctx.update(`${p}.desires[${idx}].strength`, val);
    });
  });

  // Desires add/del
  container.querySelector(".btn-add-desire")?.addEventListener("click", () => {
    const desires = [...(r.desires || []), { verb: "", object: "", outcome: "", strength: 0.5 }];
    const bp = setAt(ctx.blueprint(), `${p}.desires`, desires);
    ctx.replace(bp);
  });

  container.querySelectorAll(".btn-del-desire").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-index"));
      const desires = [...(r.desires || [])];
      desires.splice(idx, 1);
      const bp = setAt(ctx.blueprint(), `${p}.desires`, desires);
      ctx.replace(bp);
    });
  });

  // Principles add/del
  container.querySelector(".btn-add-principle")?.addEventListener("click", () => {
    const principles = [...(r.principles || []), ""];
    const bp = setAt(ctx.blueprint(), `${p}.principles`, principles);
    ctx.replace(bp);
  });

  container.querySelectorAll(".btn-del-principle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-index"));
      const principles = [...(r.principles || [])];
      principles.splice(idx, 1);
      const bp = setAt(ctx.blueprint(), `${p}.principles`, principles);
      ctx.replace(bp);
    });
  });

  // Boundaries add/del
  container.querySelector(".btn-add-boundary")?.addEventListener("click", () => {
    const boundaries = [...(r.boundaries || []), { protects: "", trigger: "", response: "" }];
    const bp = setAt(ctx.blueprint(), `${p}.boundaries`, boundaries);
    ctx.replace(bp);
  });

  container.querySelectorAll(".btn-del-boundary").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-index"));
      const boundaries = [...(r.boundaries || [])];
      boundaries.splice(idx, 1);
      const bp = setAt(ctx.blueprint(), `${p}.boundaries`, boundaries);
      ctx.replace(bp);
    });
  });

  // Routine add/del
  container.querySelector(".btn-add-routine")?.addEventListener("click", () => {
    const defaultSiteId = sites[0]?.id || "";
    const routine = [...(r.routine || []), { from: "08:00", to: "12:00", siteId: defaultSiteId, activity: "" }];
    const bp = setAt(ctx.blueprint(), `${p}.routine`, routine);
    ctx.replace(bp);
  });

  container.querySelectorAll(".btn-del-routine").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-index"));
      const routine = [...(r.routine || [])];
      routine.splice(idx, 1);
      const bp = setAt(ctx.blueprint(), `${p}.routine`, routine);
      ctx.replace(bp);
    });
  });

  // Memories add/del
  container.querySelector(".btn-add-memory")?.addEventListener("click", () => {
    const memories = [...(r.memories || []), { when: "", content: "" }];
    const bp = setAt(ctx.blueprint(), `${p}.memories`, memories);
    ctx.replace(bp);
  });

  container.querySelectorAll(".btn-del-memory").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-index"));
      const memories = [...(r.memories || [])];
      memories.splice(idx, 1);
      const bp = setAt(ctx.blueprint(), `${p}.memories`, memories);
      ctx.replace(bp);
    });
  });

  // Secrets add/del
  container.querySelector(".btn-add-secret")?.addEventListener("click", () => {
    const secrets = [...(r.secrets || []), ""];
    const bp = setAt(ctx.blueprint(), `${p}.secrets`, secrets);
    ctx.replace(bp);
  });

  container.querySelectorAll(".btn-del-secret").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-index"));
      const secrets = [...(r.secrets || [])];
      secrets.splice(idx, 1);
      const bp = setAt(ctx.blueprint(), `${p}.secrets`, secrets);
      ctx.replace(bp);
    });
  });

  // Rewrite resident button
  container.querySelector(".btn-rewrite-resident")?.addEventListener("click", () => {
    ctx.rewrite(`residents/${r.id}`, `居民 ${r.name || "未命名"}`);
  });

  // Delete resident button
  container.querySelector(".btn-del-resident")?.addEventListener("click", () => {
    const confirmed = typeof confirm === "function" ? confirm(`确定要删除居民「${r.name || r.id}」吗？相关的关系与开场设置会一并移除。`) : true;
    if (confirmed) {
      const bp = removeResident(ctx.blueprint(), r.id);
      expandedResidentId = null;
      ctx.replace(bp);
    }
  });
}
