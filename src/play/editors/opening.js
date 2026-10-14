import { SITE_TYPES } from "../../worlds/catalog/index.mjs";
import { setAt } from "../paths.js";
import { field, bindFields, escapeHtml } from "./common.js";

const KNOWN_OPTIONS = [
  { value: "public", label: "大家都知道" },
  { value: "hidden", label: "藏着" },
  { value: "private", label: "只有主人知道" },
];

const CONDITION_KINDS = [
  { value: "object_ready", label: "东西做好了" },
  { value: "object_holder", label: "东西到了某人手里" },
  { value: "actor_at", label: "某人到了某处" },
];

export function render(container, ctx) {
  const bp = ctx.blueprint();
  const opening = bp.opening || {};
  const residents = bp.residents || [];
  const sites = bp.town?.sites || [];

  const buildingSites = sites.filter((s) => SITE_TYPES[s.type]?.kind === "building");
  const objects = opening.objects || [];
  const deadlines = opening.deadlines || [];
  const mysteries = opening.mysteries || [];
  const positions = opening.positions || {};
  const eventsCount = Array.isArray(opening.events) ? opening.events.length : 0;
  const visitorsCount = Array.isArray(opening.visitors) ? opening.visitors.length : 0;

  // Count residents per site in positions
  const siteResidentCounts = new Map();
  for (const s of sites) siteResidentCounts.set(s.id, 0);
  for (const r of residents) {
    const sId = positions[r.id];
    if (sId && siteResidentCounts.has(sId)) {
      siteResidentCounts.set(sId, siteResidentCounts.get(sId) + 1);
    }
  }

  // Position rows
  const siteSelectOptions = [
    { value: "", label: "未指定地点" },
    ...sites.map((s) => ({ value: s.id, label: s.name || s.id })),
  ];

  const positionsHtml = residents
    .map((r) => {
      const currentSiteId = positions[r.id] || "";
      const count = siteResidentCounts.get(currentSiteId) || 0;
      const isOvercrowded = count > 6;
      return `
        <div class="row-item position-row">
          <div class="row-inputs">
            <span class="resident-label">${escapeHtml(r.name || r.id)} (${escapeHtml(r.role || "居民")})</span>
            <span class="rel-arrow">→</span>
            <select data-path="opening.positions.${r.id}" class="position-select">
              ${siteSelectOptions.map((opt) => `<option value="${escapeHtml(opt.value)}"${opt.value === currentSiteId ? " selected" : ""}>${escapeHtml(opt.label)}</option>`).join("")}
            </select>
            ${isOvercrowded ? `<span class="warning-text">同一处开场不超过 6 人（当前 ${count} 人）</span>` : ""}
          </div>
        </div>
      `;
    })
    .join("");

  // Object rows
  const craftableObjects = objects.filter((o) => o.madeAt);

  const objectsHtml = objects
    .map((obj, i) => {
      const p = `opening.objects[${i}]`;
      const isCrafted = obj.madeAt !== undefined;
      return `
        <div class="row-item object-card" data-object-index="${i}">
          <div class="object-primary-row">
            <input type="text" data-path="${p}.name" value="${escapeHtml(obj.name || "")}" placeholder="物件名称" maxlength="24" class="input-obj-name" />
            <select class="obj-site-select" data-path="${p}.siteId">
              <option value="">放在地点...</option>
              ${sites.map((s) => `<option value="${escapeHtml(s.id)}"${obj.siteId === s.id ? " selected" : ""}>${escapeHtml(s.name || s.id)}</option>`).join("")}
            </select>
            <select class="obj-holder-select" data-path="${p}.holder">
              <option value="">在某人手里...</option>
              ${residents.map((r) => `<option value="${escapeHtml(r.id)}"${obj.holder === r.id ? " selected" : ""}>${escapeHtml(r.name || r.id)}</option>`).join("")}
            </select>
            <select data-path="${p}.known" class="obj-known-select">
              ${KNOWN_OPTIONS.map((opt) => `<option value="${escapeHtml(opt.value)}"${obj.known === opt.value ? " selected" : ""}>${escapeHtml(opt.label)}</option>`).join("")}
            </select>
            <label class="checkbox-label crafted-checkbox-label">
              <input type="checkbox" class="crafted-toggle" data-object-index="${i}" ${isCrafted ? "checked" : ""} />
              要做出来
            </label>
            <button type="button" class="btn btn-del-obj" data-index="${i}">删除</button>
          </div>
          ${isCrafted ? `
            <div class="object-crafted-row">
              <span class="crafted-label">制作地点：</span>
              <select data-path="${p}.madeAt">
                <option value="">选择制作地点（建筑）...</option>
                ${buildingSites.map((s) => `<option value="${escapeHtml(s.id)}"${obj.madeAt === s.id ? " selected" : ""}>${escapeHtml(s.name || s.id)}</option>`).join("")}
              </select>
              <span class="crafted-label">需要份数：</span>
              <input type="number" data-path="${p}.needed" value="${obj.needed || 1}" min="1" max="10" class="input-needed" />
            </div>
          ` : ""}
        </div>
      `;
    })
    .join("");

  // Deadline cards
  const deadlinesHtml = deadlines
    .map((dl, i) => {
      const p = `opening.deadlines[${i}]`;
      const responsible = dl.responsible || [];
      const knownBy = dl.knownBy || [];
      const conditions = dl.conditions || [];

      return `
        <div class="deadline-card" data-deadline-index="${i}">
          <div class="deadline-card-header">
            <div class="deadline-title-fields">
              <input type="text" data-path="${p}.label" value="${escapeHtml(dl.label || "")}" placeholder="时限内容（如：早市开市前修好抽屉）" maxlength="100" class="input-dl-label" />
              <div class="deadline-clock-field">
                <span>到点：</span>
                <input type="text" data-path="${p}.dueClock" data-kind="clock" value="${escapeHtml(dl.dueClock || "")}" placeholder="HH:MM" maxlength="5" class="input-clock" />
              </div>
            </div>
            <button type="button" class="btn btn-del-deadline" data-index="${i}">删除时限</button>
          </div>

          <div class="deadline-people-row">
            <div class="field">
              <label>负责的人</label>
              <div class="chips-wrap responsible-chips">
                ${residents.map((r) => {
                  const active = responsible.includes(r.id);
                  return `<button type="button" class="chip-btn chip-responsible${active ? " active" : ""}" data-dl-index="${i}" data-resident-id="${escapeHtml(r.id)}">${escapeHtml(r.name || r.id)}</button>`;
                }).join("")}
              </div>
            </div>
            <div class="field">
              <label>知道的人</label>
              <div class="chips-wrap knownby-chips">
                ${residents.map((r) => {
                  const active = knownBy.includes(r.id);
                  return `<button type="button" class="chip-btn chip-knownby${active ? " active" : ""}" data-dl-index="${i}" data-resident-id="${escapeHtml(r.id)}">${escapeHtml(r.name || r.id)}</button>`;
                }).join("")}
              </div>
            </div>
          </div>

          <div class="field">
            <label>误了会怎样</label>
            <textarea data-path="${p}.consequence" maxlength="400" placeholder="误了时限的后果...">${escapeHtml(dl.consequence || "")}</textarea>
          </div>

          <!-- 条件列表 -->
          <div class="deadline-conditions">
            <label class="conditions-title">达成条件 (${conditions.length}/6)</label>
            <div class="conditions-list">
              ${conditions.map((cond, cIdx) => renderConditionRow(cond, i, cIdx, craftableObjects, objects, residents, sites)).join("")}
            </div>
            ${conditions.length < 6 ? `
              <div class="add-row">
                <button type="button" class="btn btn-add-cond" data-dl-index="${i}">+ 添加达成条件</button>
              </div>
            ` : ""}
          </div>
        </div>
      `;
    })
    .join("");

  // Mysteries list
  const mysteriesHtml = mysteries
    .map((m, k) => `
      <div class="row-item">
        <div class="row-inputs">
          <input type="text" data-path="opening.mysteries[${k}]" value="${escapeHtml(m)}" placeholder="悬念内容..." maxlength="200" />
          <button type="button" class="btn btn-del-mystery" data-index="${k}">删除</button>
        </div>
      </div>
    `)
    .join("");

  container.innerHTML = `
    <div class="opening-editor">
      <!-- 局面 -->
      <div class="editor-section">
        <div class="section-title">开场局面</div>
        ${field({ path: "opening.situation", label: "局面描述", value: opening.situation, kind: "textarea", maxLength: 400 })}
      </div>

      <!-- 开场位置 -->
      <div class="editor-section">
        <div class="section-title">开场位置</div>
        <div class="positions-list">
          ${positionsHtml || '<div class="row-empty">镇上还没有居民</div>'}
        </div>
      </div>

      <!-- 物件 -->
      <div class="editor-section">
        <div class="section-title">物件 (${objects.length}/30)</div>
        <div class="row-list objects-list">
          ${objectsHtml || '<div class="row-empty">暂无开场物件</div>'}
        </div>
        ${objects.length < 30 ? `
          <div class="add-row">
            <button type="button" class="btn btn-add-obj">+ 添加物件</button>
          </div>
        ` : ""}
      </div>

      <!-- 时限 -->
      <div class="editor-section">
        <div class="section-title">时限 (${deadlines.length}/6)</div>
        <div class="deadlines-list">
          ${deadlinesHtml || '<div class="row-empty">暂无时限</div>'}
        </div>
        ${deadlines.length < 6 ? `
          <div class="add-row">
            <button type="button" class="btn btn-add-deadline">+ 添加时限</button>
          </div>
        ` : ""}
      </div>

      <!-- 悬念 -->
      <div class="editor-section">
        <div class="section-title">悬念 (${mysteries.length}/8)</div>
        <div class="row-list mysteries-list">
          ${mysteriesHtml || '<div class="row-empty">暂无悬念</div>'}
        </div>
        ${mysteries.length < 8 ? `
          <div class="add-row">
            <button type="button" class="btn btn-add-mystery">+ 添加悬念</button>
          </div>
        ` : ""}
      </div>

      <!-- 事件与来访者 -->
      <div class="editor-section">
        <div class="section-title">事件与来访者</div>
        <div class="unedited-meta-row">
          <span>开场事件：共 ${eventsCount} 条（本版不编辑）</span>
          <span style="margin-left: 24px;">来访者：共 ${visitorsCount} 位（本版不编辑）</span>
        </div>
      </div>

      <!-- 页底重写 -->
      <div class="editor-actions">
        <button type="button" class="btn btn-rewrite">让模型重写这一页</button>
      </div>
    </div>
  `;

  bindOpeningEvents(container, ctx, residents, sites, buildingSites);
  bindFields(container, ctx);
}

function renderConditionRow(cond, dlIdx, cIdx, craftableObjects, allObjects, residents, sites) {
  const p = `opening.deadlines[${dlIdx}].conditions[${cIdx}]`;
  const kind = cond.kind || "object_ready";

  let detailInputsHtml = "";
  if (kind === "object_ready") {
    detailInputsHtml = `
      <select data-path="${p}.object">
        <option value="">选择需要做出的物件...</option>
        ${craftableObjects.map((o) => `<option value="${escapeHtml(o.name)}"${cond.object === o.name ? " selected" : ""}>${escapeHtml(o.name)}</option>`).join("")}
      </select>
    `;
  } else if (kind === "object_holder") {
    detailInputsHtml = `
      <select data-path="${p}.object">
        <option value="">选择物件...</option>
        ${allObjects.map((o) => `<option value="${escapeHtml(o.name)}"${cond.object === o.name ? " selected" : ""}>${escapeHtml(o.name)}</option>`).join("")}
      </select>
      <select data-path="${p}.holder">
        <option value="">选择持有者...</option>
        ${residents.map((r) => `<option value="${escapeHtml(r.id)}"${cond.holder === r.id ? " selected" : ""}>${escapeHtml(r.name || r.id)}</option>`).join("")}
      </select>
    `;
  } else if (kind === "actor_at") {
    detailInputsHtml = `
      <select data-path="${p}.actor">
        <option value="">选择人物...</option>
        ${residents.map((r) => `<option value="${escapeHtml(r.id)}"${cond.actor === r.id ? " selected" : ""}>${escapeHtml(r.name || r.id)}</option>`).join("")}
      </select>
      <select data-path="${p}.siteId">
        <option value="">选择地点...</option>
        ${sites.map((s) => `<option value="${escapeHtml(s.id)}"${cond.siteId === s.id ? " selected" : ""}>${escapeHtml(s.name || s.id)}</option>`).join("")}
      </select>
    `;
  }

  return `
    <div class="row-item condition-row">
      <div class="row-inputs">
        <select class="cond-kind-select" data-dl-index="${dlIdx}" data-cond-index="${cIdx}">
          ${CONDITION_KINDS.map((k) => `<option value="${escapeHtml(k.value)}"${kind === k.value ? " selected" : ""}>${escapeHtml(k.label)}</option>`).join("")}
        </select>
        ${detailInputsHtml}
        <button type="button" class="btn btn-del-cond" data-dl-index="${dlIdx}" data-cond-index="${cIdx}">删除</button>
      </div>
    </div>
  `;
}

function bindOpeningEvents(container, ctx, residents, sites, buildingSites) {
  // Objects mutual exclusion between siteId and holder
  container.querySelectorAll(".object-card").forEach((card) => {
    const objIdx = card.getAttribute("data-object-index");
    const siteSelect = card.querySelector(".obj-site-select");
    const holderSelect = card.querySelector(".obj-holder-select");

    siteSelect?.addEventListener("change", () => {
      if (siteSelect.value) {
        if (holderSelect) holderSelect.value = "";
        ctx.update(`opening.objects[${objIdx}].holder`, null);
      }
    });

    holderSelect?.addEventListener("change", () => {
      if (holderSelect.value) {
        if (siteSelect) siteSelect.value = "";
        ctx.update(`opening.objects[${objIdx}].siteId`, null);
      }
    });
  });

  // Crafted toggle
  container.querySelectorAll(".crafted-toggle").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const idx = Number(cb.getAttribute("data-object-index"));
      const isCrafted = e.target.checked;
      const objects = [...(ctx.blueprint().opening?.objects || [])];
      const curObj = objects[idx];
      if (!curObj) return;

      if (isCrafted) {
        curObj.madeAt = buildingSites[0]?.id || "";
        curObj.needed = 1;
      } else {
        delete curObj.madeAt;
        delete curObj.needed;
      }
      const bp = setAt(ctx.blueprint(), `opening.objects[${idx}]`, curObj);
      ctx.replace(bp);
    });
  });

  // Add Object
  container.querySelector(".btn-add-obj")?.addEventListener("click", () => {
    const objects = [
      ...(ctx.blueprint().opening?.objects || []),
      { name: "", siteId: sites[0]?.id || null, holder: null, state: {}, known: "public" },
    ];
    const bp = setAt(ctx.blueprint(), "opening.objects", objects);
    ctx.replace(bp);
  });

  // Delete Object
  container.querySelectorAll(".btn-del-obj").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-index"));
      const objects = [...(ctx.blueprint().opening?.objects || [])];
      objects.splice(idx, 1);
      const bp = setAt(ctx.blueprint(), "opening.objects", objects);
      ctx.replace(bp);
    });
  });

  // Deadline responsible chips
  container.querySelectorAll(".chip-responsible").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dlIdx = Number(btn.getAttribute("data-dl-index"));
      const rId = btn.getAttribute("data-resident-id");
      const dl = ctx.blueprint().opening?.deadlines?.[dlIdx];
      if (!dl) return;

      const current = [...(dl.responsible || [])];
      const existsIdx = current.indexOf(rId);
      if (existsIdx >= 0) {
        current.splice(existsIdx, 1);
        btn.classList.remove("active");
      } else {
        if (current.length < 10) {
          current.push(rId);
          btn.classList.add("active");
        }
      }
      ctx.update(`opening.deadlines[${dlIdx}].responsible`, current);
    });
  });

  // Deadline knownBy chips
  container.querySelectorAll(".chip-knownby").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dlIdx = Number(btn.getAttribute("data-dl-index"));
      const rId = btn.getAttribute("data-resident-id");
      const dl = ctx.blueprint().opening?.deadlines?.[dlIdx];
      if (!dl) return;

      const current = [...(dl.knownBy || [])];
      const existsIdx = current.indexOf(rId);
      if (existsIdx >= 0) {
        current.splice(existsIdx, 1);
        btn.classList.remove("active");
      } else {
        if (current.length < 30) {
          current.push(rId);
          btn.classList.add("active");
        }
      }
      ctx.update(`opening.deadlines[${dlIdx}].knownBy`, current);
    });
  });

  // Condition kind select change
  container.querySelectorAll(".cond-kind-select").forEach((sel) => {
    sel.addEventListener("change", (e) => {
      const dlIdx = Number(sel.getAttribute("data-dl-index"));
      const cIdx = Number(sel.getAttribute("data-cond-index"));
      const newKind = e.target.value;

      const dl = ctx.blueprint().opening?.deadlines?.[dlIdx];
      if (!dl) return;
      const conditions = [...(dl.conditions || [])];
      const objects = ctx.blueprint().opening?.objects || [];

      let newCond = { kind: newKind };
      if (newKind === "object_ready") {
        const craftable = objects.find((o) => o.madeAt);
        newCond.object = craftable?.name || "";
      } else if (newKind === "object_holder") {
        newCond.object = objects[0]?.name || "";
        newCond.holder = residents[0]?.id || "";
      } else if (newKind === "actor_at") {
        newCond.actor = residents[0]?.id || "";
        newCond.siteId = sites[0]?.id || "";
      }

      conditions[cIdx] = newCond;
      const bp = setAt(ctx.blueprint(), `opening.deadlines[${dlIdx}].conditions`, conditions);
      ctx.replace(bp);
    });
  });

  // Add Condition
  container.querySelectorAll(".btn-add-cond").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dlIdx = Number(btn.getAttribute("data-dl-index"));
      const dl = ctx.blueprint().opening?.deadlines?.[dlIdx];
      if (!dl) return;

      const conditions = [...(dl.conditions || [])];
      const objects = ctx.blueprint().opening?.objects || [];
      const craftable = objects.find((o) => o.madeAt);

      const defaultCond = craftable
        ? { kind: "object_ready", object: craftable.name }
        : { kind: "actor_at", actor: residents[0]?.id || "", siteId: sites[0]?.id || "" };

      conditions.push(defaultCond);
      const bp = setAt(ctx.blueprint(), `opening.deadlines[${dlIdx}].conditions`, conditions);
      ctx.replace(bp);
    });
  });

  // Delete Condition
  container.querySelectorAll(".btn-del-cond").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dlIdx = Number(btn.getAttribute("data-dl-index"));
      const cIdx = Number(btn.getAttribute("data-cond-index"));
      const dl = ctx.blueprint().opening?.deadlines?.[dlIdx];
      if (!dl) return;

      const conditions = [...(dl.conditions || [])];
      conditions.splice(cIdx, 1);
      const bp = setAt(ctx.blueprint(), `opening.deadlines[${dlIdx}].conditions`, conditions);
      ctx.replace(bp);
    });
  });

  // Add Deadline
  container.querySelector(".btn-add-deadline")?.addEventListener("click", () => {
    const deadlines = [
      ...(ctx.blueprint().opening?.deadlines || []),
      {
        label: "",
        dueClock: "12:00",
        responsible: [],
        knownBy: [],
        conditions: [],
        consequence: "",
      },
    ];
    const bp = setAt(ctx.blueprint(), "opening.deadlines", deadlines);
    ctx.replace(bp);
  });

  // Delete Deadline
  container.querySelectorAll(".btn-del-deadline").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-index"));
      const deadlines = [...(ctx.blueprint().opening?.deadlines || [])];
      deadlines.splice(idx, 1);
      const bp = setAt(ctx.blueprint(), "opening.deadlines", deadlines);
      ctx.replace(bp);
    });
  });

  // Add Mystery
  container.querySelector(".btn-add-mystery")?.addEventListener("click", () => {
    const mysteries = [...(ctx.blueprint().opening?.mysteries || []), ""];
    const bp = setAt(ctx.blueprint(), "opening.mysteries", mysteries);
    ctx.replace(bp);
  });

  // Delete Mystery
  container.querySelectorAll(".btn-del-mystery").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-index"));
      const mysteries = [...(ctx.blueprint().opening?.mysteries || [])];
      mysteries.splice(idx, 1);
      const bp = setAt(ctx.blueprint(), "opening.mysteries", mysteries);
      ctx.replace(bp);
    });
  });

  // Rewrite opening
  container.querySelector(".btn-rewrite")?.addEventListener("click", () => {
    ctx.rewrite("opening", "开场");
  });
}
