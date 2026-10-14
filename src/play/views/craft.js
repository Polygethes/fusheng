import { loadDraft, saveDraft, clearDraft } from "../draft.js";
import { setAt } from "../paths.js";
import { blankBlueprint, GENRES, addResident } from "../blueprintModel.js";
import { SITE_TYPES } from "../../worlds/catalog/index.mjs";
import { escapeHtml } from "../editors/common.js";
import { openRewritePanel } from "../rewritePanel.js";
import { render as renderWorld } from "../editors/world.js";
import { render as renderPlaces } from "../editors/places.js";
import { render as renderPeople } from "../editors/people.js";
import { render as renderRelationships } from "../editors/relationships.js";
import { render as renderOpening } from "../editors/opening.js";

export const STEPS = [
  { id: "genre", label: "类型" },
  { id: "world", label: "世界与小镇" },
  { id: "places", label: "地点与住户" },
  { id: "people", label: "居民" },
  { id: "relationships", label: "关系" },
  { id: "opening", label: "开场" },
];

const GENRE_DESCS = {
  古风: "古风武侠、田园桃源风格的小镇生活",
  现代: "现代生活、街角日常与老街烟火气",
  奇幻: "魔法遗迹、神秘工坊与奇幻住民",
  自定义: "自由设定时代与风貌，从零开始搭建",
};

export function checkStep(stepId, bp) {
  if (!bp) return { ok: false, issues: ["草稿不存在"] };
  const issues = [];
  if (stepId === "world") {
    if (!String(bp.meta?.title || "").trim()) issues.push("世界名（meta.title）不能为空");
    if (!String(bp.town?.name || "").trim()) issues.push("小镇名（town.name）不能为空");
  } else if (stepId === "places") {
    const households = bp.households || [];
    if (households.length === 0) issues.push("至少需要 1 户");
    const unhoused = households.filter((h) => !h.siteId);
    if (unhoused.length > 0) {
      unhoused.forEach((h) => issues.push(`户「${h.name || h.id}」未选择住处`));
    }
    const sites = bp.town?.sites || [];
    const hasOutdoor = sites.some((s) => {
      const typeDef = SITE_TYPES[s.type];
      return typeDef?.kind === "outdoor" || ["square", "well", "market", "forest", "hill", "field", "river_bank", "bridge", "pond", "road_out", "street"].includes(s.type);
    });
    if (!hasOutdoor) issues.push("至少一个室外地点（广场、井、集市之类）");
  } else if (stepId === "people") {
    const households = bp.households || [];
    const residents = bp.residents || [];
    if (residents.length === 0) {
      issues.push("居民列表为空，每户至少 1 人");
    }
    const emptyHh = households.filter((h) => !residents.some((r) => r.householdId === h.id));
    emptyHh.forEach((h) => issues.push(`户「${h.name || h.id}」至少需要 1 人`));

    const nameless = residents.filter((r) => !String(r.name || "").trim());
    nameless.forEach((r) => issues.push(`居民「${r.id}」缺少名字`));

    const noDesires = residents.filter((r) => {
      if (!Array.isArray(r.desires) || r.desires.length === 0) return true;
      return !r.desires.some((d) => Boolean(d && (d.object || d.verb || d.outcome)));
    });
    noDesires.forEach((r) => issues.push(`居民「${r.name || r.id}」至少需要 1 个欲望`));
  } else if (stepId === "relationships") {
    const residents = bp.residents || [];
    const rels = bp.relationships || [];
    const noRel = residents.filter((r) => !rels.some((rel) => rel.from === r.id || rel.to === r.id));
    noRel.forEach((r) => issues.push(`居民「${r.name || r.id}」至少需要 1 条关系`));
  } else if (stepId === "opening") {
    const deadlines = bp.opening?.deadlines || [];
    if (deadlines.length === 0) {
      issues.push("至少需要 1 个时限");
    }
    const noConds = deadlines.filter((d) => !Array.isArray(d.conditions) || d.conditions.length === 0);
    noConds.forEach((d, idx) => issues.push(`时限「${d.label || `#${idx + 1}`}」每个时限至少 1 个条件`));
  }
  return { ok: issues.length === 0, issues };
}

export function render(root, ctx) {
  const params = ctx.params || [];
  let stepId = params[0] || "genre";
  const stepIndex = STEPS.findIndex((s) => s.id === stepId);
  if (stepIndex === -1) {
    stepId = "genre";
  }
  const currentIndex = STEPS.findIndex((s) => s.id === stepId);

  let draft = loadDraft();

  // Mode check
  if (draft && draft.mode === "quick") {
    const proceed = confirm("开始捏世界会替换掉现在的快速模式草稿，继续吗？");
    if (!proceed) {
      ctx.go("new");
      return () => {};
    }
    clearDraft();
    draft = null;
    if (stepId !== "genre") {
      ctx.go("craft/genre");
      return () => {};
    }
  }

  // If no blueprint yet and not on genre step, redirect to genre
  if ((!draft || !draft.blueprint) && stepId !== "genre") {
    ctx.go("craft/genre");
    return () => {};
  }

  // Base layout
  root.innerHTML = `
    <div class="craft-page">
      <header class="craft-header">
        <div class="craft-top-bar">
          <button type="button" class="btn btn-back">← 返回</button>
          <h1 class="craft-title">捏一个世界</h1>
          <div class="header-spacer"></div>
        </div>
        <nav class="steps-bar" aria-label="制作步骤">
          <div class="steps">
            ${STEPS.map((step, idx) => {
              const isCurrent = idx === currentIndex;
              const isPast = idx < currentIndex || (draft?.blueprint && idx <= currentIndex);
              const statusClass = isCurrent ? "current" : (isPast ? "completed" : "pending");
              return `
                <div class="step-item ${statusClass}" data-step="${step.id}" data-index="${idx}">
                  <span class="step-dot">${idx + 1}</span>
                  <span class="step-label">${escapeHtml(step.label)}</span>
                </div>
              `;
            }).join("")}
          </div>
        </nav>
      </header>

      <main class="craft-body">
        <div class="craft-step-content"></div>

        <div class="craft-step-warning note error" hidden></div>

        <div class="craft-nav-bar">
          <button type="button" class="btn btn-prev"${currentIndex === 0 ? " disabled" : ""}>上一步</button>
          <div class="nav-right">
            <button type="button" class="btn btn-continue-anyway" hidden>仍然继续</button>
            <button type="button" class="btn primary btn-next">${currentIndex === STEPS.length - 1 ? "去检查和预览 →" : "下一步"}</button>
          </div>
        </div>
      </main>
    </div>
  `;

  // Bind top back button
  root.querySelector(".btn-back")?.addEventListener("click", () => ctx.go("new"));

  // Bind clickable past steps
  root.querySelectorAll(".step-item.completed").forEach((el) => {
    el.addEventListener("click", () => {
      const targetStep = el.getAttribute("data-step");
      if (targetStep && targetStep !== stepId) {
        ctx.go(`craft/${targetStep}`);
      }
    });
  });

  const contentContainer = root.querySelector(".craft-step-content");
  const warningEl = root.querySelector(".craft-step-warning");
  const continueAnywayBtn = root.querySelector(".btn-continue-anyway");
  const nextBtn = root.querySelector(".btn-next");
  const prevBtn = root.querySelector(".btn-prev");

  // Editor ctx
  const editorCtx = {
    blueprint: () => draft?.blueprint,
    update: (path, value) => {
      if (!draft || !draft.blueprint) return;
      draft.blueprint = setAt(draft.blueprint, path, value);
      if (draft.lastCheck) draft.lastCheck.stale = true;
      saveDraft(draft);
    },
    replace: (newBlueprint) => {
      if (!draft) draft = { seed: 1, mode: "craft" };
      draft.blueprint = newBlueprint;
      if (draft.lastCheck) draft.lastCheck.stale = true;
      saveDraft(draft);
      renderCurrentStep();
    },
    rewrite: (sectionPath, label) => {
      openRewritePanel({
        anchor: root,
        sectionPath,
        label,
        blueprint: draft?.blueprint,
        onDone: (newBp) => editorCtx.replace(newBp),
      });
    },
  };

  function renderGenreStep() {
    const hasCraftDraft = draft && draft.mode === "craft" && draft.blueprint;
    contentContainer.innerHTML = `
      <div class="genre-step-panel">
        ${hasCraftDraft ? `<div class="note genre-alert-note">已经选过类型。重新选会清空后面填的内容。</div>` : ""}
        <div class="genre-cards">
          ${Object.keys(GENRES).map((genreName) => {
            const def = GENRES[genreName];
            const siteNames = (def.sites || []).map((s) => s[1]);
            const sitesDesc = siteNames.length > 0 ? siteNames.join("、") : "无预设地点（纯自定义）";
            const desc = GENRE_DESCS[genreName] || "";
            return `
              <div class="genre-card panel" data-genre="${escapeHtml(genreName)}">
                <div class="genre-card-header">
                  <span class="genre-title">${escapeHtml(genreName)}</span>
                  ${hasCraftDraft && draft.blueprint?.meta?.genre?.includes(genreName) ? `<span class="badge">当前</span>` : ""}
                </div>
                <p class="genre-desc">${escapeHtml(desc)}</p>
                <div class="genre-sites">
                  <span class="genre-sites-label">带有的地点：</span>
                  <span class="genre-sites-list">${escapeHtml(sitesDesc)}</span>
                </div>
                <div class="genre-action">
                  <button type="button" class="btn primary btn-pick-genre">选择这个类型</button>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;

    contentContainer.querySelectorAll(".genre-card").forEach((card) => {
      const genreName = card.getAttribute("data-genre");
      card.addEventListener("click", () => {
        if (hasCraftDraft) {
          const ok = confirm("已经选过类型。重新选会清空后面填的内容，继续吗？");
          if (!ok) return;
        }
        const rand4 = Math.floor(1000 + Math.random() * 9000);
        const bp = blankBlueprint(genreName, { id: `my_town_${rand4}`, seed: 1 });
        draft = { blueprint: bp, seed: 1, mode: "craft" };
        saveDraft(draft);
        ctx.go("craft/world");
      });
    });
  }

  function renderPeopleExtraHeader() {
    const households = draft?.blueprint?.households || [];
    const hhOptions = households.map((h) => `<option value="${escapeHtml(h.id)}">户：${escapeHtml(h.name || h.id)}</option>`).join("");
    return `
      <div class="prompt-resident-box panel">
        <div class="prompt-resident-title">+ 用一句话描述，让模型捏一个新居民</div>
        <div class="prompt-resident-form">
          <div class="prompt-resident-row">
            <input type="text" class="prompt-resident-input" placeholder="写一句描述，例如：药铺的学徒，十五六岁，想去城里学医" maxlength="200" />
            <select class="prompt-resident-hh"${households.length === 0 ? " disabled" : ""}>
              ${households.length > 0 ? hhOptions : `<option value="">(尚未建户)</option>`}
            </select>
            <button type="button" class="btn primary btn-do-prompt-resident">让模型生成新居民</button>
          </div>
          <div class="prompt-resident-auth-row">
            <label><input type="checkbox" class="prompt-resident-auth" /> 我授权调用真实模型，最多 3 次请求</label>
          </div>
          <div class="note prompt-resident-status" hidden></div>
        </div>
      </div>
    `;
  }

  function bindPeopleExtraEvents() {
    const box = contentContainer.querySelector(".prompt-resident-box");
    if (!box) return;
    const btn = box.querySelector(".btn-do-prompt-resident");
    const inputEl = box.querySelector(".prompt-resident-input");
    const hhSelect = box.querySelector(".prompt-resident-hh");
    const authEl = box.querySelector(".prompt-resident-auth");
    const statusEl = box.querySelector(".prompt-resident-status");

    btn?.addEventListener("click", async () => {
      if (!authEl.checked) {
        statusEl.hidden = false;
        statusEl.textContent = "请勾选授权调用模型。";
        statusEl.className = "note prompt-resident-status error";
        return;
      }
      const desc = inputEl.value.trim();
      if (!desc) {
        statusEl.hidden = false;
        statusEl.textContent = "请填写一句描述。";
        statusEl.className = "note prompt-resident-status error";
        return;
      }

      const householdId = hhSelect?.value || undefined;
      // 1. Add blank resident locally
      const added = addResident(draft.blueprint, householdId);
      const newRes = added.blueprint.residents.find((r) => r.id === added.id);
      if (newRes) {
        newRes.name = "新居民";
      }
      draft.blueprint = added.blueprint;
      saveDraft(draft);
      renderCurrentStep();

      // Show in-progress status
      const updatedBox = contentContainer.querySelector(".prompt-resident-box");
      const updatedStatus = updatedBox?.querySelector(".prompt-resident-status");
      const updatedBtn = updatedBox?.querySelector(".btn-do-prompt-resident");
      if (updatedStatus) {
        updatedStatus.hidden = false;
        updatedStatus.textContent = "模型思考中，正在捏人...";
        updatedStatus.className = "note prompt-resident-status";
      }
      if (updatedBtn) {
        updatedBtn.disabled = true;
      }

      try {
        const res = await fetch("/api/create/rewrite", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            blueprint: draft.blueprint,
            sectionPath: `residents/${added.id}`,
            instruction: desc,
            authorized: true,
            maxRequests: 3,
          }),
        });
        const data = await res.json();
        if (data.ok && data.blueprint) {
          editorCtx.replace(data.blueprint);
        } else {
          const msg = data.message || "模型生成未完全通过";
          renderCurrentStep();
          const errBox = contentContainer.querySelector(".prompt-resident-box");
          const errStatus = errBox?.querySelector(".prompt-resident-status");
          if (errStatus) {
            errStatus.hidden = false;
            errStatus.textContent = `${msg}，已保留该居民，可以手动填。`;
            errStatus.className = "note prompt-resident-status error";
          }
        }
      } catch (err) {
        renderCurrentStep();
        const errBox = contentContainer.querySelector(".prompt-resident-box");
        const errStatus = errBox?.querySelector(".prompt-resident-status");
        if (errStatus) {
          errStatus.hidden = false;
          errStatus.textContent = `请求出错：${err.message || err}，已保留该居民，可以手动填。`;
          errStatus.className = "note prompt-resident-status error";
        }
      }
    });
  }

  function renderCurrentStep() {
    if (warningEl) {
      warningEl.hidden = true;
      warningEl.textContent = "";
    }
    if (continueAnywayBtn) {
      continueAnywayBtn.hidden = true;
    }

    if (stepId === "genre") {
      renderGenreStep();
    } else if (stepId === "world") {
      contentContainer.innerHTML = "";
      renderWorld(contentContainer, editorCtx);
    } else if (stepId === "places") {
      contentContainer.innerHTML = "";
      renderPlaces(contentContainer, editorCtx);
    } else if (stepId === "people") {
      contentContainer.innerHTML = `
        <div class="craft-people-step">
          ${renderPeopleExtraHeader()}
          <div class="craft-people-editor-area"></div>
        </div>
      `;
      bindPeopleExtraEvents();
      const editorArea = contentContainer.querySelector(".craft-people-editor-area");
      renderPeople(editorArea, editorCtx);
    } else if (stepId === "relationships") {
      contentContainer.innerHTML = "";
      renderRelationships(contentContainer, editorCtx);
    } else if (stepId === "opening") {
      contentContainer.innerHTML = "";
      renderOpening(contentContainer, editorCtx);
    }
  }

  function goNextStep() {
    if (currentIndex === STEPS.length - 1) {
      ctx.go("review/world");
    } else {
      const nextStep = STEPS[currentIndex + 1].id;
      ctx.go(`craft/${nextStep}`);
    }
  }

  // Navigation handlers
  prevBtn?.addEventListener("click", () => {
    if (currentIndex > 0) {
      const prevStep = STEPS[currentIndex - 1].id;
      ctx.go(`craft/${prevStep}`);
    }
  });

  nextBtn?.addEventListener("click", () => {
    if (stepId === "genre") {
      goNextStep();
      return;
    }
    const checkResult = checkStep(stepId, draft?.blueprint);
    if (checkResult.ok) {
      goNextStep();
    } else {
      warningEl.hidden = false;
      warningEl.innerHTML = `
        <div class="warning-title">这一步还有未完善的项（仍可继续，也可稍后在审改页修改）：</div>
        <ul class="warning-issues">${checkResult.issues.map((msg) => `<li>${escapeHtml(msg)}</li>`).join("")}</ul>
      `;
      continueAnywayBtn.hidden = false;
    }
  });

  continueAnywayBtn?.addEventListener("click", () => {
    goNextStep();
  });

  renderCurrentStep();

  return () => {};
}
