import { estimateDraftCalls } from "../blueprintModel.js";
import { saveDraft } from "../draft.js";
import { readEvents } from "../sse.js";

const SIZES = [
  { value: "small", label: "小（约 6 人）", residents: 6 },
  { value: "medium", label: "中（约 12 人）", residents: 12 },
  { value: "large", label: "大（约 20 人）", residents: 20 },
];

const STOPPED_NAMES = {
  world: "世界与小镇",
  residents: "居民",
  relationships: "关系",
  opening: "开场",
  repair: "修整",
};

const PLACEHOLDER = "江南水乡的小镇，梅雨季，茶馆老板娘和失踪多年的哥哥\n北方矿镇，冬天封山前的最后一周，人人都在囤货";

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function render(root, ctx) {
  let closed = false;
  let configured = true;
  let isGenerating = false;
  let sourceText = "";
  let sourceFileName = "";
  let selectedSize = "medium";
  let abortController = null;
  let reviewTimer = null;

  root.innerHTML = `
    <div class="view-head">
      <button class="btn btn-back">← 返回</button>
      <h2>快速模式</h2>
    </div>

    <div class="quick-settings-warning" hidden></div>

    <div class="quick-panel px">
      <div class="quick-field">
        <label class="quick-label" for="quick-idea">你的想法</label>
        <textarea id="quick-idea" class="quick-textarea" rows="6" maxlength="2000" placeholder="${escapeHtml(PLACEHOLDER)}"></textarea>
      </div>

      <div class="quick-field">
        <label class="quick-label">参考资料（可选）</label>
        <div class="quick-file-zone">
          <input type="file" class="quick-file-input" accept=".txt,.md,text/plain,text/markdown">
          <div class="quick-file-info" hidden>
            <span class="quick-file-name"></span>
            <button type="button" class="btn btn-remove-file">移除</button>
          </div>
          <div class="quick-file-error" hidden></div>
        </div>
      </div>

      <div class="quick-field">
        <label class="quick-label">规模</label>
        <div class="quick-radios">
          ${SIZES.map((s) => `
            <label class="quick-radio-label">
              <input type="radio" name="quick-size" value="${s.value}" ${s.value === "medium" ? "checked" : ""}>
              ${s.label}
            </label>
          `).join("")}
        </div>
      </div>

      <div class="quick-field">
        <div class="quick-estimate"></div>
      </div>

      <div class="quick-field">
        <label class="quick-label" for="quick-max-requests">请求上限</label>
        <input type="number" id="quick-max-requests" class="quick-number-input" min="1" max="40">
      </div>

      <div class="quick-field">
        <label class="quick-checkbox-label">
          <input type="checkbox" class="quick-auth-checkbox">
          我授权本次调用真实模型，最多发出上面填写的请求数
        </label>
      </div>

      <div class="quick-actions">
        <button type="button" class="btn primary btn-generate" disabled>生成</button>
      </div>

      <div class="quick-error-msg" hidden></div>
    </div>

    <div class="quick-progress-panel px" hidden>
      <div class="quick-progress-head">
        <h3 class="quick-progress-title">生成进度</h3>
        <span class="quick-request-count"></span>
      </div>
      <div class="quick-stages"></div>
      <div class="quick-progress-note" hidden></div>
      <div class="quick-progress-actions">
        <button type="button" class="btn btn-cancel">取消</button>
      </div>
    </div>
  `;

  const backBtn = root.querySelector(".btn-back");
  const settingsWarningEl = root.querySelector(".quick-settings-warning");
  const formPanel = root.querySelector(".quick-panel");
  const ideaEl = root.querySelector("#quick-idea");
  const fileInput = root.querySelector(".quick-file-input");
  const fileInfoEl = root.querySelector(".quick-file-info");
  const fileNameEl = root.querySelector(".quick-file-name");
  const removeFileBtn = root.querySelector(".btn-remove-file");
  const fileErrorEl = root.querySelector(".quick-file-error");
  const sizeRadios = root.querySelectorAll('input[name="quick-size"]');
  const estimateEl = root.querySelector(".quick-estimate");
  const maxRequestsEl = root.querySelector("#quick-max-requests");
  const authCheckbox = root.querySelector(".quick-auth-checkbox");
  const generateBtn = root.querySelector(".btn-generate");
  const formErrorEl = root.querySelector(".quick-error-msg");

  const progressPanel = root.querySelector(".quick-progress-panel");
  const requestCountEl = root.querySelector(".quick-request-count");
  const stagesEl = root.querySelector(".quick-stages");
  const progressNoteEl = root.querySelector(".quick-progress-note");
  const cancelBtn = root.querySelector(".btn-cancel");

  function getResidents(sizeVal) {
    return SIZES.find((s) => s.value === sizeVal)?.residents || 12;
  }

  function updateEstimateAndDefaultMax() {
    const residents = getResidents(selectedSize);
    const n = estimateDraftCalls(residents);
    estimateEl.textContent = `起草约 ${n} 次调用；某一段没通过检查时会重问，最多再多几次。`;
    maxRequestsEl.value = String(n + 6);
  }

  function updateGenerateButtonState() {
    const hasIdea = ideaEl.value.trim().length > 0;
    const hasSource = sourceText.length > 0;
    const authorized = authCheckbox.checked;
    const canSubmit = !isGenerating && configured && (hasIdea || hasSource) && authorized;
    generateBtn.disabled = !canSubmit;
  }

  function setFormDisabled(disabled) {
    isGenerating = disabled;
    formPanel.classList.toggle("is-disabled", disabled);
    ideaEl.disabled = disabled;
    fileInput.disabled = disabled;
    removeFileBtn.disabled = disabled;
    sizeRadios.forEach((r) => { r.disabled = disabled; });
    maxRequestsEl.disabled = disabled;
    authCheckbox.disabled = disabled;
    updateGenerateButtonState();
  }

  function addStage(label) {
    const active = stagesEl.querySelector(".stage-line.active");
    if (active) {
      active.classList.remove("active");
      active.classList.add("done");
      active.textContent = `✓ ${active.dataset.label}`;
    }
    const line = document.createElement("div");
    line.className = "stage-line active";
    line.dataset.label = label;
    line.textContent = `▶ ${label}`;
    stagesEl.appendChild(line);
  }

  function markLastStageDone() {
    const active = stagesEl.querySelector(".stage-line.active");
    if (active) {
      active.classList.remove("active");
      active.classList.add("done");
      active.textContent = `✓ ${active.dataset.label}`;
    }
  }

  backBtn.addEventListener("click", () => {
    if (abortController) abortController.abort();
    ctx.go("new");
  });

  ideaEl.addEventListener("input", updateGenerateButtonState);
  authCheckbox.addEventListener("change", updateGenerateButtonState);

  sizeRadios.forEach((r) => {
    r.addEventListener("change", () => {
      if (r.checked) {
        selectedSize = r.value;
        updateEstimateAndDefaultMax();
      }
    });
  });

  fileInput.addEventListener("change", () => {
    fileErrorEl.hidden = true;
    fileErrorEl.textContent = "";
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > 200 * 1024) {
      fileErrorEl.hidden = false;
      fileErrorEl.textContent = "参考资料不能超过 200KB";
      fileInput.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (closed) return;
      sourceText = String(reader.result || "");
      sourceFileName = file.name;
      fileInput.hidden = true;
      fileInfoEl.hidden = false;
      fileNameEl.textContent = `${sourceFileName}（${sourceText.length} 字）`;
      updateGenerateButtonState();
    };
    reader.readAsText(file);
  });

  removeFileBtn.addEventListener("click", () => {
    sourceText = "";
    sourceFileName = "";
    fileInput.value = "";
    fileInput.hidden = false;
    fileInfoEl.hidden = true;
    fileErrorEl.hidden = true;
    fileErrorEl.textContent = "";
    updateGenerateButtonState();
  });

  cancelBtn.addEventListener("click", () => {
    if (abortController) {
      abortController.abort();
    }
  });

  generateBtn.addEventListener("click", async () => {
    if (generateBtn.disabled || isGenerating) return;

    formErrorEl.hidden = true;
    formErrorEl.textContent = "";
    progressPanel.hidden = false;
    stagesEl.innerHTML = "";
    requestCountEl.textContent = "";
    progressNoteEl.hidden = true;
    progressNoteEl.innerHTML = "";
    cancelBtn.hidden = false;

    setFormDisabled(true);

    const controller = new AbortController();
    abortController = controller;

    const idea = ideaEl.value.trim();
    const reqNum = parseInt(maxRequestsEl.value, 10);
    const residents = getResidents(selectedSize);
    const fallbackMax = estimateDraftCalls(residents) + 6;
    const maxRequests = Number.isInteger(reqNum) && reqNum >= 1 && reqNum <= 40 ? reqNum : fallbackMax;

    try {
      const response = await fetch("/api/create/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idea,
          sourceText,
          sizeHint: selectedSize,
          maxRequests,
          authorized: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let msg = "生成请求失败";
        try {
          const body = await response.json();
          if (body?.message) msg = body.message;
        } catch { /* ignore non-JSON error */ }
        progressPanel.hidden = true;
        formErrorEl.hidden = false;
        formErrorEl.textContent = msg;
        setFormDisabled(false);
        return;
      }

      for await (const { event, data } of readEvents(response)) {
        if (closed || controller.signal.aborted) break;

        if (event === "progress") {
          if (data.event === "stage") {
            addStage(data.label);
          } else if (data.event === "request") {
            requestCountEl.textContent = `第 ${data.request} 次请求 / 上限 ${data.maxRequests}`;
          }
        } else if (event === "result") {
          cancelBtn.hidden = true;
          if (data.ok) {
            markLastStageDone();
            saveDraft({
              blueprint: data.blueprint,
              seed: data.blueprint?.meta?.seed,
              mode: "quick",
              issues: [],
            });
            progressNoteEl.hidden = false;
            progressNoteEl.textContent = `草稿已生成，共调用 ${data.requests} 次`;
            reviewTimer = setTimeout(() => {
              if (!closed) ctx.go("review");
            }, 600);
          } else {
            const stoppedChinese = STOPPED_NAMES[data.stoppedAt] || data.stoppedAt || "未完成";
            const issuesList = Array.isArray(data.issues) ? data.issues : [];
            const top3 = issuesList.slice(0, 3).map((item) => (typeof item === "string" ? item : item.message || JSON.stringify(item))).join("；");
            if (data.blueprint) {
              saveDraft({
                blueprint: data.blueprint,
                seed: data.blueprint?.meta?.seed,
                mode: "quick",
                issues: issuesList,
              });
              progressNoteEl.hidden = false;
              progressNoteEl.innerHTML = `
                <span>起草停在「${escapeHtml(stoppedChinese)}」：${escapeHtml(top3)}。已写好的部分存成了草稿，可以到审改页接着改。</span>
                <button type="button" class="btn primary btn-to-review">去审改页</button>
              `;
              progressNoteEl.querySelector(".btn-to-review")?.addEventListener("click", () => ctx.go("review"));
            } else {
              progressNoteEl.hidden = false;
              progressNoteEl.textContent = `起草停在「${escapeHtml(stoppedChinese)}」：${escapeHtml(top3)}。`;
              setFormDisabled(false);
            }
          }
        } else if (event === "error") {
          cancelBtn.hidden = true;
          progressNoteEl.hidden = false;
          progressNoteEl.textContent = data.message || "生成遇到错误";
          setFormDisabled(false);
        }
      }
    } catch (err) {
      if (closed) return;
      if (controller.signal.aborted || err.name === "AbortError") {
        cancelBtn.hidden = true;
        progressNoteEl.hidden = false;
        progressNoteEl.textContent = "已取消，没有保存草稿";
        setFormDisabled(false);
      } else {
        cancelBtn.hidden = true;
        progressNoteEl.hidden = false;
        progressNoteEl.textContent = err.message || "请求失败";
        setFormDisabled(false);
      }
    }
  });

  updateEstimateAndDefaultMax();

  ctx.settingsStatus?.().then((settings) => {
    if (closed) return;
    if (!settings || !settings.configured) {
      configured = false;
      settingsWarningEl.hidden = false;
      settingsWarningEl.innerHTML = `
        <div class="draft-banner px alt">
          <span>还没有设置模型 API：生成世界需要用到它。</span>
          <button type="button" class="btn primary btn-open-settings">去设置</button>
        </div>
      `;
      settingsWarningEl.querySelector(".btn-open-settings")?.addEventListener("click", () => ctx.openSettings());
      updateGenerateButtonState();
    }
  }).catch(() => {});

  return () => {
    closed = true;
    if (reviewTimer) clearTimeout(reviewTimer);
    if (abortController) abortController.abort();
  };
}
