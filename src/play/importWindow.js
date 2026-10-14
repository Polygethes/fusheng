// The window for bringing a script, story or setting notes into a new world:
// paste it, pick files or drop them in, see how much the model will actually
// read and who speaks in it, and say whether the draft should adapt it or only
// borrow from it. The text helpers are pure so they can be checked without a
// page; the window itself only exists while it is open.

/** The model reads this many characters of the text (stages.mjs SOURCE_TEXT_LIMIT). */
export const MODEL_READ_LIMIT = 30000;
/** The server refuses reference text over this many UTF-8 bytes (createApi.mjs SOURCE_BYTES_LIMIT). */
export const SOURCE_BYTES_LIMIT = 200 * 1024;
/** A single file larger than this is not read at all. */
export const FILE_BYTES_LIMIT = 1024 * 1024;
export const IMPORT_ACCEPT = ".txt,.text,.md,.markdown,.fountain,text/plain,text/markdown";

const UNREADABLE = /\.(docx?|pdf|pages|rtf|epub|odt|wps|xlsx?|pptx?|zip)$/iu;
const NOT_SPEAKERS = new Set([
  "场景", "场次", "时间", "地点", "人物", "角色", "出场人物", "旁白", "画外音", "独白", "字幕", "注", "注释", "备注", "说明", "提示",
  "内景", "外景", "镜头", "景别", "音效", "音乐", "动作", "声音", "背景", "简介", "梗概", "故事梗概", "主题", "片名", "剧名", "书名",
  "标题", "作者", "编剧", "导演", "原著", "时长", "集数", "类型", "风格", "基调", "设定", "世界观", "大纲", "第一幕", "全剧终",
  "他", "她", "它", "我", "你", "您", "他们", "她们", "我们", "你们", "大家", "众人", "所有人", "有人", "某人", "其他人",
  "但是", "可是", "于是", "然后", "比如", "例如", "所以", "因为", "如果", "其中", "总之", "原文", "译文",
  "note", "notes", "scene", "title", "author", "time", "location", "setting", "cast", "characters", "summary", "logline",
  "int", "ext", "vo", "os", "http", "https", "v.o", "o.s", "bgm", "fade in", "fade out", "cut to", "the end",
]);

const commaNumber = (n) => Number(n).toLocaleString("en-US");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/gu, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

/** Text from a file's bytes: a BOM decides, then UTF-8 if it is valid, else GB18030 (Windows-saved Chinese). */
export function decodeTextBytes(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data[0] === 0xff && data[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(data.subarray(2)), encoding: "utf-16le" };
  if (data[0] === 0xfe && data[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(data.subarray(2)), encoding: "utf-16be" };
  try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(data), encoding: "utf-8" }; }
  catch { /* not UTF-8 */ }
  try { return { text: new TextDecoder("gb18030").decode(data), encoding: "gb18030" }; }
  catch { return { text: new TextDecoder("utf-8").decode(data), encoding: "utf-8" }; }
}

/** One line ending, no BOM, no trailing spaces, at most one blank line in a row. */
export function normalizeImportedText(text = "") {
  return String(text)
    .replace(/^﻿/u, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t　]+$/gmu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/** Appends one file's text under its name, so the model can tell the pieces apart. */
export function appendSource(current = "", name = "", text = "") {
  const body = normalizeImportedText(text);
  if (!body) return current;
  const head = name ? `【${name}】\n` : "";
  return current.trim() ? `${current.trimEnd()}\n\n${head}${body}` : `${head}${body}`;
}

/** What the server and the model will make of the text. */
export function measureSource(text = "") {
  const trimmed = String(text).trim();
  const chars = trimmed.length;
  const bytes = new TextEncoder().encode(String(text)).length;
  return { chars, bytes, modelChars: Math.min(chars, MODEL_READ_LIMIT), clipped: chars > MODEL_READ_LIMIT, tooLarge: bytes > SOURCE_BYTES_LIMIT };
}

function speakerName(raw) {
  const name = raw.replace(/\s+/gu, " ").trim();
  if (!name || NOT_SPEAKERS.has(name.toLowerCase()) || /\d/u.test(name)) return null;
  if (/^第.+[集场章幕回节部卷]$/u.test(name)) return null;
  const han = /^[\p{Script=Han}·•]+$/u.test(name);
  if (han) {
    if (name.length > 8) return null;
    // "他说：“……”" in a novel names a verb, not a person.
    if (name.length > 1 && /[说道问喊叫答骂笑想]$/u.test(name)) return null;
    return name;
  }
  if (/^[A-Za-z][A-Za-z .'’-]{0,23}$/u.test(name)) return name;
  return null;
}

/**
 * Who speaks in a script, by count of lines, roughly: "名字：台词",
 * "名字（低声）：台词", "**名字**：台词", and screenplay cues in capitals
 * on their own line. Names seen only once are left out.
 */
export function detectSpeakers(text = "", { limit = 20 } = {}) {
  const counts = new Map();
  const lines = normalizeImportedText(text).split("\n");
  const add = (raw) => {
    const name = speakerName(raw);
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/^[\s>#*\-–—·•]+/u, "").replace(/\*\*|__/gu, "");
    const colon = line.match(/^([^：:（(\[【「“"]{1,24}?)\s*(?:[（(][^）)]{0,16}[）)])?\s*[：:]/u);
    if (colon) { add(colon[1]); continue; }
    const cue = line.match(/^([A-Z][A-Z .'’-]{1,23}?)\s*(?:\([^)]{0,16}\))?$/u);
    if (cue && !/^(INT|EXT|FADE|CUT|DISSOLVE|SMASH|THE END)\b/u.test(cue[1]) && (lines[i - 1] ?? "").trim() === "" && (lines[i + 1] ?? "").trim()) add(cue[1]);
  }
  return [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit)
    .map(([name, lines]) => ({ name, lines }));
}

/** The size that fits the speakers found, if there are enough of them to go by. */
export function suggestedSize(speakers = []) {
  const n = speakers.length;
  if (n < 2) return null;
  return n <= 8 ? "small" : n <= 15 ? "medium" : "large";
}

/** One line for the page: how much is imported, how it will be used, who is in it. */
export function describeImport({ text = "", mode = "adapt" } = {}) {
  const size = measureSource(text);
  const speakers = detectSpeakers(text);
  const parts = [`已导入 ${commaNumber(size.chars)} 字`, mode === "adapt" ? "按原作改编" : "只作参考"];
  if (size.clipped) parts.push(`模型只读前 ${commaNumber(MODEL_READ_LIMIT)} 字`);
  if (speakers.length) parts.push(`识别到 ${speakers.length} 位说话的人：${speakers.slice(0, 6).map((row) => row.name).join("、")}${speakers.length > 6 ? "……" : ""}`);
  return parts.join(" · ");
}

async function readFileText(file) {
  if (UNREADABLE.test(file.name)) throw new Error(`「${file.name}」不是纯文本：Word、PDF 等请先另存为 .txt 再导入。`);
  if (file.size > FILE_BYTES_LIMIT) throw new Error(`「${file.name}」超过 1MB，读不进来；可以先删掉不需要的部分。`);
  const { text } = decodeTextBytes(new Uint8Array(await file.arrayBuffer()));
  if (/\u0000/u.test(text)) throw new Error(`「${file.name}」看起来不是文本文件。`);
  return text;
}

/**
 * Opens the window over the page. onConfirm gets { text, mode } (empty text
 * means the player cleared it); onClose runs however it closes.
 * @returns {{ close: () => void }}
 */
export function openImportWindow({ text = "", mode = "adapt", onConfirm, onClose } = {}) {
  const opener = document.activeElement;
  const modal = document.createElement("div");
  modal.className = "modal import-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "importTitle");
  modal.innerHTML = `
    <div class="px panel import-panel">
      <div class="ctitle" id="importTitle">导入剧本或文本</div>
      <p class="note">把剧本、小说片段或设定稿贴进来，或者选文件（.txt / .md / .fountain，可以多选，也可以直接拖进这个窗口）。Word、PDF 请先另存为 .txt。</p>
      <div class="import-tools">
        <button type="button" class="btn import-pick">选择文件…</button>
        <input type="file" class="import-file" multiple accept="${IMPORT_ACCEPT}" hidden>
        <button type="button" class="btn import-clear">清空</button>
      </div>
      <textarea class="quick-textarea import-text" rows="14" spellcheck="false" aria-label="剧本或文本内容" placeholder="顾怀山：死不了。……短剑带上了？&#10;顾小满：带上了，就在身上收着。"></textarea>
      <div class="import-stats" aria-live="polite"></div>
      <div class="import-speakers"></div>
      <fieldset class="import-modes">
        <legend class="quick-label">怎么用这份文本</legend>
        <label class="quick-radio-label"><input type="radio" name="import-mode" value="adapt"> 按原作改编：人物、关系、地方以原作为准</label>
        <label class="quick-radio-label"><input type="radio" name="import-mode" value="reference"> 只作参考：模型可以取材，不必照着写</label>
      </fieldset>
      <div class="err import-error" role="alert"></div>
      <div class="actions">
        <button type="button" class="btn import-cancel">取消</button>
        <button type="button" class="btn primary import-ok">用这份文本</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const panel = modal.querySelector(".import-panel");
  const textarea = modal.querySelector(".import-text");
  const fileInput = modal.querySelector(".import-file");
  const statsEl = modal.querySelector(".import-stats");
  const speakersEl = modal.querySelector(".import-speakers");
  const errorEl = modal.querySelector(".import-error");
  const okBtn = modal.querySelector(".import-ok");
  const modeInputs = [...modal.querySelectorAll('input[name="import-mode"]')];
  textarea.value = text;
  for (const input of modeInputs) input.checked = input.value === (mode === "reference" ? "reference" : "adapt");

  let closed = false;
  let timer = null;
  let fileProblems = "";

  function refresh() {
    timer = null;
    const size = measureSource(textarea.value);
    const notes = [`${commaNumber(size.chars)} 字 · ${(size.bytes / 1024).toFixed(1)} KB / 200 KB`];
    if (size.clipped) notes.push(`模型只读前 ${commaNumber(MODEL_READ_LIMIT)} 字，后面的读不到；可以删掉不重要的段落，或者只留要改编的那几场。`);
    statsEl.textContent = notes.join(" · ");
    statsEl.classList.toggle("warn", size.clipped);
    const speakers = detectSpeakers(textarea.value);
    speakersEl.innerHTML = speakers.length
      ? `<span class="import-speakers-head">按台词粗略识别的人物：</span>${speakers.map((row) => `<span class="import-speaker">${escapeHtml(row.name)} ×${row.lines}</span>`).join("")}`
      : "";
    errorEl.textContent = [size.tooLarge ? "文本超过 200KB，发不出去：先删掉一些再导入。" : "", fileProblems].filter(Boolean).join(" ");
    okBtn.disabled = size.tooLarge;
  }
  const schedule = () => { if (!timer) timer = setTimeout(refresh, 150); };

  async function addFiles(files) {
    const problems = [];
    let value = textarea.value;
    for (const file of files) {
      try { value = appendSource(value, file.name, await readFileText(file)); }
      catch (error) { problems.push(error.message); }
    }
    if (closed) return;
    textarea.value = value;
    fileProblems = problems.join(" ");
    refresh();
  }

  function close() {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    removeEventListener("keydown", onKey, true);
    modal.remove();
    onClose?.();
    if (opener && typeof opener.focus === "function" && document.contains(opener)) opener.focus();
  }
  function onKey(event) {
    if (event.key === "Escape") { event.preventDefault(); close(); }
  }

  modal.querySelector(".import-pick").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const files = [...(fileInput.files || [])];
    fileInput.value = "";
    if (files.length) addFiles(files);
  });
  modal.querySelector(".import-clear").addEventListener("click", () => {
    textarea.value = "";
    fileProblems = "";
    refresh();
    textarea.focus();
  });
  textarea.addEventListener("input", () => { fileProblems = ""; schedule(); });
  panel.addEventListener("dragover", (event) => { event.preventDefault(); panel.classList.add("is-dropping"); });
  panel.addEventListener("dragleave", (event) => { if (!panel.contains(event.relatedTarget)) panel.classList.remove("is-dropping"); });
  panel.addEventListener("drop", (event) => {
    event.preventDefault();
    panel.classList.remove("is-dropping");
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length) addFiles(files);
  });
  modal.querySelector(".import-cancel").addEventListener("click", close);
  okBtn.addEventListener("click", () => {
    if (okBtn.disabled) return;
    const chosen = modeInputs.find((input) => input.checked)?.value || "adapt";
    const result = { text: normalizeImportedText(textarea.value), mode: chosen };
    close();
    onConfirm?.(result);
  });
  addEventListener("keydown", onKey, true);

  refresh();
  textarea.focus();
  return { close };
}
