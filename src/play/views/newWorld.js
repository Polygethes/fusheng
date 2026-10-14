import { loadDraft, clearDraft } from "../draft.js";
import "../blueprintModel.js";

function formatTime(isoString) {
  if (!isoString) return "刚刚";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return isoString;
  }
}

export function render(root, ctx) {
  const draft = loadDraft();
  let draftHtml = "";
  if (draft && draft.blueprint) {
    const townName = draft.blueprint.town?.name || draft.blueprint.meta?.title || "未命名小镇";
    const residentCount = draft.blueprint.residents?.length || 0;
    const timeStr = formatTime(draft.updatedAt);
    draftHtml = `
      <div class="draft-banner px alt">
        <span class="draft-info">你有一份没写完的草稿（${escapeHtml(townName)}，${residentCount} 位居民，最后修改于 ${escapeHtml(timeStr)}）</span>
        <div class="draft-actions">
          <button class="btn primary btn-draft-continue">继续改</button>
          <button class="btn btn-draft-discard">丢弃</button>
        </div>
      </div>
    `;
  }

  root.innerHTML = `
    <div class="view-head">
      <button class="btn btn-back">← 返回</button>
      <h2>新的世界</h2>
    </div>
    ${draftHtml}
    <div class="cards">
      <div class="card px">
        <h3 class="card-title">快速模式</h3>
        <p class="card-desc">写一句想法，或者贴一段故事，模型先起草，你再一页一页改。</p>
        <p class="card-sub">需要模型 API；起草一座小镇约调用 9–11 次。</p>
        <button class="btn primary btn-quick">开始</button>
      </div>
      <div class="card px">
        <h3 class="card-title">捏世界模式</h3>
        <p class="card-desc">像捏角色一样一步步选：小镇、住户、每一个人、他们之间的关系、开场的事。</p>
        <p class="card-sub">不用模型也能完成；想偷懒时可以让模型补全某个人。</p>
        <button class="btn primary btn-craft">开始</button>
      </div>
      <div class="card px">
        <h3 class="card-title">导入剧本</h3>
        <p class="card-desc">已经有剧本、小说或设定稿？贴进来或选文件，模型照原作的人物、关系和地方起草小镇，你再一页一页改。</p>
        <p class="card-sub">需要模型 API；支持 .txt、.md、.fountain，原作很长时模型只读前 3 万字。</p>
        <button class="btn primary btn-import">导入</button>
      </div>
    </div>
  `;

  root.querySelector(".btn-back")?.addEventListener("click", () => ctx.go(""));
  root.querySelector(".btn-quick")?.addEventListener("click", () => ctx.go("quick"));
  root.querySelector(".btn-craft")?.addEventListener("click", () => ctx.go("craft"));
  root.querySelector(".btn-import")?.addEventListener("click", () => ctx.go("quick/import"));

  if (draft) {
    root.querySelector(".btn-draft-continue")?.addEventListener("click", () => ctx.go("review"));
    root.querySelector(".btn-draft-discard")?.addEventListener("click", () => {
      if (confirm("确定要丢弃当前草稿吗？此操作无法撤销。")) {
        clearDraft();
        render(root, ctx);
      }
    });
  }

  return () => {};
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
