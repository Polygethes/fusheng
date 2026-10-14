export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/gu, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

export function field({
  path,
  label,
  value,
  kind = "text",
  options = [],
  maxLength,
  hint,
}) {
  const id = `field-${String(path).replace(/[^\w-]/gu, "-")}`;
  const hintHtml = hint ? `<span class="field-hint">${escapeHtml(hint)}</span>` : "";
  let control = "";

  if (kind === "textarea") {
    control = `<textarea id="${id}" data-path="${escapeHtml(path)}"${maxLength ? ` maxlength="${maxLength}"` : ""}>${escapeHtml(value ?? "")}</textarea>`;
  } else if (kind === "number") {
    control = `<input id="${id}" type="number" data-path="${escapeHtml(path)}" value="${value ?? ""}"${maxLength ? ` maxlength="${maxLength}"` : ""} />`;
  } else if (kind === "clock") {
    control = `<input id="${id}" type="text" data-path="${escapeHtml(path)}" data-kind="clock" value="${escapeHtml(value ?? "")}" placeholder="HH:MM" maxlength="5" />`;
  } else if (kind === "select") {
    const opts = options
      .map((opt) => {
        const optVal = opt && typeof opt === "object" && "value" in opt ? opt.value : (Array.isArray(opt) ? opt[0] : opt);
        const optLabel = opt && typeof opt === "object" && "label" in opt ? opt.label : (Array.isArray(opt) ? opt[1] : opt);
        const isSelected = (value == null && (optVal == null || optVal === "")) || (value != null && String(value) === String(optVal));
        const valAttr = optVal == null ? "" : String(optVal);
        return `<option value="${escapeHtml(valAttr)}"${isSelected ? " selected" : ""}>${escapeHtml(optLabel)}</option>`;
      })
      .join("");
    control = `<select id="${id}" data-path="${escapeHtml(path)}">${opts}</select>`;
  } else {
    control = `<input id="${id}" type="text" data-path="${escapeHtml(path)}" value="${escapeHtml(value ?? "")}"${maxLength ? ` maxlength="${maxLength}"` : ""} />`;
  }

  return `<div class="field"><label for="${id}">${escapeHtml(label)}${hintHtml}</label>${control}</div>`;
}

export function bindFields(container, ctx) {
  if (!container || !container.querySelectorAll) return;
  const elements = container.querySelectorAll("[data-path]");
  for (const el of elements) {
    const path = el.getAttribute("data-path") || el.dataset?.path;
    if (!path) continue;
    const isSelect = el.tagName === "SELECT";
    const isNumber = el.type === "number";
    const handler = () => {
      let val = el.value;
      if (isSelect) {
        val = (val === "" || val === "null") ? null : val;
      } else if (isNumber) {
        val = val === "" ? null : Number(val);
      }
      ctx.update(path, val);
    };
    if (isSelect) {
      el.addEventListener("change", handler);
    } else {
      el.addEventListener("input", handler);
    }
  }
}

export function describePath(blueprint, path = "") {
  const str = String(path);

  // households[i]
  const mHh = str.match(/^households\[(\d+)\](?:\.(.*))?$/);
  if (mHh) {
    const idx = Number(mHh[1]);
    const hh = blueprint?.households?.[idx];
    const name = hh?.name || `第 ${idx + 1} 户`;
    const field = mHh[2];
    if (field === "siteId") return `户「${name}」的住处`;
    if (field === "name") return `户「${name}」的名称`;
    if (field === "id") return `户「${name}」的标识`;
    if (!field) return `户「${name}」`;
    return `户「${name}」的 ${field}`;
  }

  // town.sites[i]
  const mSite = str.match(/^town\.sites\[(\d+)\](?:\.(.*))?$/);
  if (mSite) {
    const idx = Number(mSite[1]);
    const site = blueprint?.town?.sites?.[idx];
    const name = site?.name || `第 ${idx + 1} 个地点`;
    const field = mSite[2];
    if (field === "type") return `地点「${name}」的类型`;
    if (field === "name") return `地点「${name}」的名称`;
    if (field === "id") return `地点「${name}」的标识`;
    if (field === "householdId") return `地点「${name}」所属的户`;
    if (!field) return `地点「${name}」`;
    return `地点「${name}」的 ${field}`;
  }

  // residents[i]
  const mRes = str.match(/^residents\[(\d+)\](?:\.(.*))?$/);
  if (mRes) {
    const idx = Number(mRes[1]);
    const res = blueprint?.residents?.[idx];
    const name = res?.name || `第 ${idx + 1} 位居民`;
    const field = mRes[2];
    if (field) {
      const mRoutine = field.match(/^routine\[(\d+)\](?:\.(.*))?$/);
      if (mRoutine) {
        const rIdx = Number(mRoutine[1]) + 1;
        const rField = mRoutine[2];
        if (rField === "siteId") return `「${name}」的作息第 ${rIdx} 段的地点`;
        if (rField === "from") return `「${name}」的作息第 ${rIdx} 段的开始时刻`;
        if (rField === "to") return `「${name}」的作息第 ${rIdx} 段的结束时刻`;
        if (!rField) return `「${name}」的作息第 ${rIdx} 段`;
        return `「${name}」的作息第 ${rIdx} 段的 ${rField}`;
      }
      const mDesire = field.match(/^desires\[(\d+)\](?:\.(.*))?$/);
      if (mDesire) {
        const dIdx = Number(mDesire[1]) + 1;
        const dField = mDesire[2];
        if (dField === "object") return `「${name}」的欲望第 ${dIdx} 项的目标`;
        if (!dField) return `「${name}」的欲望第 ${dIdx} 项`;
        return `「${name}」的欲望第 ${dIdx} 项的 ${dField}`;
      }
      if (field === "workSiteId") return `「${name}」的工作地点`;
      if (field === "householdId") return `「${name}」所属的户`;
      if (field === "name") return `「${name}」的姓名`;
      if (field === "age") return `「${name}」的年龄`;
      if (field === "role") return `「${name}」的身份`;
      if (field === "routine") return `「${name}」的作息`;
      if (field === "desires") return `「${name}」的欲望`;
      if (field.startsWith("appearance")) return `「${name}」的外貌`;
      return `「${name}」的 ${field}`;
    }
    return `居民「${name}」`;
  }

  // opening.objects[i]
  const mObj = str.match(/^opening\.objects\[(\d+)\](?:\.(.*))?$/);
  if (mObj) {
    const idx = Number(mObj[1]);
    const obj = blueprint?.opening?.objects?.[idx];
    const name = obj?.name || `第 ${idx + 1} 件物件`;
    const field = mObj[2];
    if (field === "siteId") return `开场物件「${name}」的位置`;
    if (field === "holder") return `开场物件「${name}」的持有人`;
    if (field === "madeAt") return `开场物件「${name}」的制作地点`;
    if (field === "madeWith") return `开场物件「${name}」的制作活计`;
    if (field === "name") return `开场物件「${name}」的名称`;
    if (!field) return `开场物件「${name}」`;
    return `开场物件「${name}」的 ${field}`;
  }

  // opening.positions.<id>
  const mPos = str.match(/^opening\.positions\.(\w+)$/);
  if (mPos) {
    const rId = mPos[1];
    const res = blueprint?.residents?.find((r) => r.id === rId);
    return `人物「${res?.name || rId}」的开场位置`;
  }

  // meta
  if (str === "meta.title") return "世界名";
  if (str === "meta.premise") return "世界前提";
  if (str === "meta.genre") return "类型";
  if (str === "meta.tone") return "基调";
  if (str === "meta.startDay") return "开场日子";
  if (str === "meta.startClock") return "开场时刻";
  if (str === "meta.startLabel") return "时辰说法";
  if (str === "meta.id") return "世界库名称";

  // town
  if (str === "town.name") return "镇名";
  if (str === "town.sites") return "小镇地点";
  if (str === "town.terrain.river") return "地形（河流）";
  if (str === "town.terrain.forest") return "地形（树林）";
  if (str === "town.terrain.hills") return "地形（山丘）";
  if (str === "town.terrain.fields") return "地形（农田）";
  if (str === "town.terrain") return "小镇地形";

  return str;
}
