import { SITE_TYPES } from "../../worlds/catalog/index.mjs";
import { addSite, removeSite, addHousehold, removeHousehold } from "../blueprintModel.js";
import { field, bindFields, describePath, escapeHtml } from "./common.js";

const SITE_TYPE_OPTIONS = Object.entries(SITE_TYPES).map(([key, info]) => ({
  value: key,
  label: info.label,
}));

export function render(container, ctx) {
  const bp = ctx.blueprint();
  const sites = bp.town?.sites || [];
  const households = bp.households || [];
  const residents = bp.residents || [];

  const buildingSites = sites.filter((s) => SITE_TYPES[s.type]?.kind === "building");
  const buildingOptions = [
    { value: "", label: "选择住处..." },
    ...buildingSites.map((s) => ({ value: s.id, label: s.name || s.id })),
  ];

  const siteRowsHtml = sites
    .map(
      (site, i) => `
      <div class="row-item" data-site-id="${escapeHtml(site.id)}">
        <div class="row-inputs">
          <input type="text" data-path="town.sites[${i}].name" value="${escapeHtml(site.name)}" placeholder="地点名字" />
          <select data-path="town.sites[${i}].type">
            ${SITE_TYPE_OPTIONS.map(
              (opt) => `<option value="${escapeHtml(opt.value)}"${opt.value === site.type ? " selected" : ""}>${escapeHtml(opt.label)}</option>`,
            ).join("")}
          </select>
          <button type="button" class="btn btn-del-site" data-site-id="${escapeHtml(site.id)}">删除</button>
        </div>
      </div>
    `,
    )
    .join("");

  const householdRowsHtml = households
    .map((hh, i) => {
      const memberCount = residents.filter((r) => r.householdId === hh.id).length;
      return `
        <div class="row-item" data-household-id="${escapeHtml(hh.id)}">
          <div class="row-inputs">
            <input type="text" data-path="households[${i}].name" value="${escapeHtml(hh.name)}" placeholder="户名" />
            <select data-path="households[${i}].siteId">
              ${buildingOptions
                .map(
                  (opt) =>
                    `<option value="${escapeHtml(opt.value)}"${opt.value === hh.siteId ? " selected" : ""}>${escapeHtml(opt.label)}</option>`,
                )
                .join("")}
            </select>
            <span class="row-meta">${memberCount} 人</span>
            <button type="button" class="btn btn-del-household" data-household-id="${escapeHtml(hh.id)}">删除</button>
          </div>
        </div>
      `;
    })
    .join("");

  container.innerHTML = `
    <div class="editor-section">
      <div class="section-title">地点列表 (${sites.length})</div>
      <div class="row-list site-list">
        ${siteRowsHtml || '<div class="row-empty">暂无地点</div>'}
      </div>
      <div class="add-row add-site-row">
        <select class="new-site-type">
          ${SITE_TYPE_OPTIONS.map((opt) => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`).join("")}
        </select>
        <input type="text" class="new-site-name" placeholder="地点名称（留空使用默认名）" />
        <button type="button" class="btn btn-add-site">添加地点</button>
      </div>
    </div>

    <div class="editor-section">
      <div class="section-title">住户列表 (${households.length})</div>
      <div class="row-list household-list">
        ${householdRowsHtml || '<div class="row-empty">暂无住户</div>'}
      </div>
      <div class="add-row">
        <button type="button" class="btn btn-add-household">添加一户</button>
      </div>
    </div>

    <div class="editor-actions">
      <button type="button" class="btn btn-rewrite">让模型重写这一页</button>
    </div>
  `;

  bindFields(container, ctx);

  // Bind site deletion
  container.querySelectorAll(".btn-del-site").forEach((btn) => {
    btn.addEventListener("click", () => {
      const siteId = btn.getAttribute("data-site-id");
      const res = removeSite(ctx.blueprint(), siteId);
      if (res.ok) {
        ctx.replace(res.blueprint);
      } else {
        const row = btn.closest(".row-item");
        let warnEl = row?.querySelector(".row-warning");
        if (!warnEl && row) {
          warnEl = document.createElement("div");
          warnEl.className = "row-warning";
          row.appendChild(warnEl);
        }
        if (warnEl) {
          const refs = res.references.map((r) => describePath(ctx.blueprint(), r)).join("、");
          warnEl.textContent = `先把这些改到别的地点，才能删除：${refs}`;
        }
      }
    });
  });

  // Bind add site
  container.querySelector(".btn-add-site")?.addEventListener("click", () => {
    const type = container.querySelector(".new-site-type")?.value;
    const name = container.querySelector(".new-site-name")?.value?.trim() || "";
    try {
      const { blueprint } = addSite(ctx.blueprint(), type, name);
      ctx.replace(blueprint);
    } catch (err) {
      alert(err.message || "添加地点失败");
    }
  });

  // Bind household deletion
  container.querySelectorAll(".btn-del-household").forEach((btn) => {
    btn.addEventListener("click", () => {
      const hhId = btn.getAttribute("data-household-id");
      const res = removeHousehold(ctx.blueprint(), hhId);
      if (res.ok) {
        ctx.replace(res.blueprint);
      } else {
        const row = btn.closest(".row-item");
        let warnEl = row?.querySelector(".row-warning");
        if (!warnEl && row) {
          warnEl = document.createElement("div");
          warnEl.className = "row-warning";
          row.appendChild(warnEl);
        }
        if (warnEl) {
          warnEl.textContent = `这户还有 ${res.members.length} 个人，先到「人物」页把他们移走或删掉。`;
        }
      }
    });
  });

  // Bind add household
  container.querySelector(".btn-add-household")?.addEventListener("click", () => {
    const { blueprint } = addHousehold(ctx.blueprint());
    ctx.replace(blueprint);
  });

  // Bind rewrite
  container.querySelector(".btn-rewrite")?.addEventListener("click", () => {
    ctx.rewrite("town", "小镇");
  });
}
