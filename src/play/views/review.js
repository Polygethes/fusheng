import { loadDraft, saveDraft, clearDraft } from "../draft.js";
import { setAt, nearestField } from "../paths.js";
import { describePath, escapeHtml } from "../editors/common.js";
import { render as renderWorld } from "../editors/world.js";
import { render as renderPlaces } from "../editors/places.js";
import { render as renderPeople } from "../editors/people.js";
import { render as renderRelationships } from "../editors/relationships.js";
import { render as renderOpening } from "../editors/opening.js";
import { openRewritePanel } from "../rewritePanel.js";
import { estimateRun } from "../blueprintModel.js";
import { flattenLayout } from "../../worlds/layoutAtlas.mjs";
import { buildScene } from "../../stage/tiles.js";
import { createCamera } from "../../stage/camera.js";

const TABS = [
  { id: "world", label: "世界" },
  { id: "places", label: "地点" },
  { id: "people", label: "人物" },
  { id: "relationships", label: "关系" },
  { id: "opening", label: "开场" },
];

const plainMessage = (issue) => String(issue.message || "").split(String(issue.path || "\u0000")).join("").replace(/^[\s:：]+/u, "");

let pendingFocusPath = null;

export function render(root, ctx) {
  const params = ctx.params || [];
  const validTabs = ["world", "places", "people", "relationships", "opening"];
  let activeTab = validTabs.includes(params[0]) ? params[0] : "world";

  let draft = loadDraft();

  if (!draft || !draft.blueprint) {
    root.innerHTML = `
      <div class="review-empty px alt">
        <h2 class="empty-title">还没有草稿</h2>
        <p class="empty-desc">可以从快速模式或捏世界模式开始创建新的世界。</p>
        <div class="empty-actions">
          <button type="button" class="btn primary btn-quick">快速模式</button>
          <button type="button" class="btn btn-craft">捏世界</button>
        </div>
      </div>
    `;
    root.querySelector(".btn-quick")?.addEventListener("click", () => ctx.go("quick"));
    root.querySelector(".btn-craft")?.addEventListener("click", () => ctx.go("craft"));
    return () => {};
  }

  const townTitle = draft.blueprint.meta?.title || "未命名世界";
  const sourceLabel = draft.mode === "quick" ? "快速模式草稿" : "捏世界草稿";
  const initialIssues = draft.lastCheck?.issues || [];

  root.innerHTML = `
    <div class="review">
      <div class="view-head">
        <button type="button" class="btn btn-back">← 返回</button>
        <h2 class="review-title">审改：${escapeHtml(townTitle)}</h2>
        <span class="source-tag">${escapeHtml(sourceLabel)}</span>
      </div>

      <div class="review-body">
        <div class="review-main">
          <div class="tabs-bar">
            ${TABS.map((tab) => {
              const count = initialIssues.filter((i) => i.section === tab.id).length;
              const tabText = count > 0 ? `${tab.label} · ${count}` : tab.label;
              return `<button type="button" class="btn tab-btn${tab.id === activeTab ? " on" : ""}" data-tab="${tab.id}">${escapeHtml(tabText)}</button>`;
            }).join("")}
          </div>
          <div class="tab-editor-container"></div>
        </div>

        <div class="review-sidebar px alt">
          <div class="sidebar-head">
            <h3>检查与开始</h3>
            <button type="button" class="btn primary btn-compile">编译并检查</button>
          </div>

          <div class="check-results"></div>

          <div class="preview-box" hidden>
            <div class="preview-canvas-wrapper">
              <canvas class="preview-canvas"></canvas>
            </div>
            <div class="preview-actions">
              <button type="button" class="btn btn-back-exterior" hidden>回到外景</button>
              <button type="button" class="btn btn-reroll-map">换一张地图</button>
            </div>
          </div>

          <div class="cost-estimate">
            <div class="estimate-head">花费估算</div>
            <div class="estimate-row">
              <label>打算运行几个游戏小时</label>
              <input type="number" class="hours-input" value="8" min="1" max="72" />
            </div>
            <div class="estimate-text"></div>
            <div class="estimate-hint">只是估计，实际取决于人物之间发生多少事</div>
          </div>

          <div class="start-actions">
            <button type="button" class="btn primary btn-start" disabled>开始</button>
            <div class="start-hint">先编译并检查</div>
          </div>
        </div>
      </div>
    </div>
  `;

  root.querySelector(".btn-back")?.addEventListener("click", () => ctx.go("new"));

  const editorContainer = root.querySelector(".tab-editor-container");

  const editorCtx = {
    blueprint: () => draft.blueprint,
    update: (path, value) => {
      draft.blueprint = setAt(draft.blueprint, path, value);
      if (draft.lastCheck) {
        draft.lastCheck.stale = true;
      }
      saveDraft(draft);
      if (path === "meta.title") {
        const titleEl = root.querySelector(".review-title");
        if (titleEl) titleEl.textContent = `审改：${value || "未命名世界"}`;
      }
      updateTabsLabels();
      updateSidebarState();
    },
    replace: (newBlueprint) => {
      draft.blueprint = newBlueprint;
      if (draft.lastCheck) {
        draft.lastCheck.stale = true;
      }
      saveDraft(draft);
      renderEditor();
      updateTabsLabels();
      updateSidebarState();
    },
    rewrite: (sectionPath, label) => {
      openRewritePanel({
        anchor: root,
        sectionPath,
        label,
        blueprint: draft.blueprint,
        onDone: (newBlueprint) => editorCtx.replace(newBlueprint),
      });
    },
  };

  function updateTabsLabels() {
    const issues = draft.lastCheck?.issues || [];
    root.querySelectorAll(".tab-btn").forEach((btn) => {
      const tabId = btn.getAttribute("data-tab");
      const tabDef = TABS.find((t) => t.id === tabId);
      if (!tabDef) return;
      const count = issues.filter((i) => i.section === tabId).length;
      btn.textContent = count > 0 ? `${tabDef.label} · ${count}` : tabDef.label;
    });
  }

  function renderEditor() {
    if (!editorContainer) return;
    editorContainer.innerHTML = "";
    if (activeTab === "world") {
      renderWorld(editorContainer, editorCtx);
    } else if (activeTab === "places") {
      renderPlaces(editorContainer, editorCtx);
    } else if (activeTab === "people") {
      renderPeople(editorContainer, editorCtx);
    } else if (activeTab === "relationships") {
      renderRelationships(editorContainer, editorCtx);
    } else if (activeTab === "opening") {
      renderOpening(editorContainer, editorCtx);
    }

    if (pendingFocusPath) {
      const p = pendingFocusPath;
      pendingFocusPath = null;
      if (typeof requestAnimationFrame !== "undefined") {
        requestAnimationFrame(() => focusAndFlashField(p));
      } else {
        focusAndFlashField(p);
      }
    }
  }

  function focusAndFlashField(targetPath) {
    if (!editorContainer) return;
    const elements = Array.from(editorContainer.querySelectorAll("[data-path]"));
    const paths = elements.map((el) => el.getAttribute("data-path")).filter(Boolean);
    const matched = nearestField(targetPath, paths);
    if (!matched) return;
    const el = editorContainer.querySelector(`[data-path="${matched}"]`);
    if (!el) return;
    const target = el.closest(".field") || el.closest(".row-item") || el;
    if (typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    target.classList.add("flash");
    setTimeout(() => {
      target.classList.remove("flash");
    }, 1500);
  }

  // Tabs click handler
  root.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabId = btn.getAttribute("data-tab");
      if (tabId) ctx.go(`review/${tabId}`);
    });
  });

  // Sidebar results rendering
  function renderCheckResults() {
    const container = root.querySelector(".check-results");
    if (!container) return;
    const check = draft.lastCheck;
    if (!check) {
      container.innerHTML = "";
      return;
    }

    if (check.ok) {
      container.innerHTML = `<div class="check-status check-success">没有问题，可以开始</div>`;
      return;
    }

    const issues = check.issues || [];
    const grouped = {};
    for (const tab of TABS) grouped[tab.id] = [];
    for (const iss of issues) {
      const sec = iss.section || "world";
      if (!grouped[sec]) grouped[sec] = [];
      grouped[sec].push(iss);
    }

    let issuesHtml = `<div class="check-status check-failure">发现 ${issues.length} 个问题</div><div class="issue-list">`;
    for (const tab of TABS) {
      const tabIssues = grouped[tab.id];
      if (!tabIssues || !tabIssues.length) continue;
      issuesHtml += `
        <div class="issue-group">
          <div class="issue-group-title">${escapeHtml(tab.label)} (${tabIssues.length})</div>
          ${tabIssues
            .map(
              (iss) => `
            <div class="issue-item" data-path="${escapeHtml(iss.path)}" data-section="${escapeHtml(tab.id)}">
              ${escapeHtml(describePath(draft.blueprint, iss.path))}：${escapeHtml(plainMessage(iss))}
            </div>
          `,
            )
            .join("")}
        </div>
      `;
    }
    issuesHtml += `</div>`;
    container.innerHTML = issuesHtml;

    container.querySelectorAll(".issue-item").forEach((item) => {
      item.addEventListener("click", () => {
        const sec = item.getAttribute("data-section");
        const path = item.getAttribute("data-path");
        if (sec && sec !== activeTab) {
          pendingFocusPath = path;
          ctx.go(`review/${sec}`);
        } else if (path) {
          focusAndFlashField(path);
        }
      });
    });
  }

  // Map preview
  function renderMapPreview() {
    const previewBox = root.querySelector(".preview-box");
    if (!previewBox) return;
    const preview = draft.lastCheck?.preview;
    if (!preview || !preview.layout) {
      previewBox.hidden = true;
      return;
    }
    previewBox.hidden = false;
    const canvas = previewBox.querySelector(".preview-canvas");
    const backBtn = previewBox.querySelector(".btn-back-exterior");
    if (!canvas) return;

    try {
      const atlas = flattenLayout(preview.layout);
      const scene = buildScene(atlas.layout);
      const camera = createCamera(atlas, { zoom: 0 });
      const g = canvas.getContext("2d");

      function drawFrame() {
        const [w, h] = camera.size();
        canvas.width = w;
        canvas.height = h;
        g.imageSmoothingEnabled = false;
        g.setTransform(1, 0, 0, 1, -camera.x, -camera.y);
        g.drawImage(scene.bg, 0, 0);
        if (scene.overlay) g.drawImage(scene.overlay, 0, 0);
        g.setTransform(1, 0, 0, 1, 0, 0);
      }

      drawFrame();

      canvas.onclick = (event) => {
        if (camera.mapId !== "exterior") return;
        const [scX, scY] = camera.toScene(event.clientX, event.clientY, canvas);
        for (const roof of atlas.layout.roofs || []) {
          const [rc, rr, rw, rh] = roof.rect;
          if (scX >= rc * 16 && scX < (rc + rw) * 16 && scY >= rr * 16 && scY < (rr + rh) * 16) {
            camera.show(`interior:${roof.siteId}`);
            drawFrame();
            if (backBtn) backBtn.hidden = false;
            break;
          }
        }
      };

      if (backBtn) {
        backBtn.onclick = () => {
          camera.show("exterior");
          drawFrame();
          backBtn.hidden = true;
        };
      }
    } catch {
      // preview error fallback
    }
  }

  // Cost estimate
  function renderCostEstimate() {
    const hoursInput = root.querySelector(".hours-input");
    const textEl = root.querySelector(".estimate-text");
    if (!hoursInput || !textEl) return;
    const update = () => {
      let h = parseInt(hoursInput.value, 10);
      if (isNaN(h) || h < 1) h = 1;
      if (h > 72) h = 72;
      const count = draft.blueprint.residents?.length || 0;
      const est = estimateRun({ residents: count, gameHours: h });
      textEl.textContent = est.text;
    };
    hoursInput.oninput = update;
    update();
  }

  function updateSidebarState() {
    renderCheckResults();
    renderMapPreview();
    renderCostEstimate();

    const startBtn = root.querySelector(".btn-start");
    const startHint = root.querySelector(".start-hint");
    const check = draft.lastCheck;
    const canStart = check && check.ok === true && !check.stale;

    if (startBtn) {
      startBtn.disabled = !canStart;
    }
    if (startHint) {
      startHint.hidden = !!canStart;
      startHint.textContent = "先编译并检查";
    }
  }

  async function doCompile() {
    const btn = root.querySelector(".btn-compile");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "正在检查...";
    }
    const seed = draft.seed ?? draft.blueprint.meta?.seed ?? 1;
    try {
      const res = await fetch("/api/create/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blueprint: draft.blueprint, seed }),
      });
      const data = await res.json();
      draft.lastCheck = {
        ok: data.ok,
        stage: data.stage,
        seed: data.seed ?? seed,
        issues: data.issues || [],
        preview: data.preview,
        stale: false,
      };
      draft.seed = data.seed ?? seed;
      saveDraft(draft);
      updateTabsLabels();
      updateSidebarState();
    } catch (err) {
      alert("检查失败：" + (err.message || err));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "编译并检查";
      }
    }
  }

  async function doStart(replace = false) {
    const btn = root.querySelector(".btn-start");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "启动中...";
    }
    const seed = draft.seed ?? draft.blueprint.meta?.seed ?? 1;
    const payload = { blueprint: draft.blueprint, seed };
    if (replace) payload.replace = true;

    try {
      const res = await fetch("/api/create/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.status === 201 && data.ok) {
        clearDraft();
        location.href = data.observerUrl;
        return;
      }
      if (res.status === 409 || data.code === "WORLD_EXISTS") {
        if (confirm("世界库里已经有同名的世界，要覆盖吗？")) {
          await doStart(true);
          return;
        }
      } else {
        let msg = data.message || "启动世界失败";
        if (data.issues?.length) {
          msg += "\n" + data.issues.map((i) => `${describePath(draft.blueprint, i.path)}: ${plainMessage(i)}`).join("\n");
        }
        alert(msg);
      }
    } catch (err) {
      alert("启动世界出错：" + (err.message || err));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "开始";
        updateSidebarState();
      }
    }
  }

  root.querySelector(".btn-compile")?.addEventListener("click", () => doCompile());
  root.querySelector(".btn-start")?.addEventListener("click", () => doStart());
  root.querySelector(".btn-reroll-map")?.addEventListener("click", () => {
    draft.seed = 1 + Math.floor(Math.random() * 9999);
    if (draft.blueprint?.meta) draft.blueprint.meta.seed = draft.seed;
    saveDraft(draft);
    doCompile();
  });

  // Initial render
  updateTabsLabels();
  renderEditor();
  updateSidebarState();

  return () => {};
}
