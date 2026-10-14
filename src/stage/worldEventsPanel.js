// 观察台天意面板 (P6.6b): 降下天意、排队结算、查看天意记录
import { WEATHER_KINDS } from "../worlds/weatherKinds.mjs";
const KIND_LABELS = {
  weather: "天气",
  object: "东西",
  message: "口信",
  urge: "授意",
  accident: "意外",
};

const ACCIDENT_PRESETS = [
  { label: "不能用了", stateKey: "ready", value: false },
  { label: "修好了", stateKey: "ready", value: true },
  { label: "弄脏了", dirty: true, stateKey: "dirty", value: true },
  { label: "摔坏了一角", stateKey: "damaged", value: true },
];

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

export function createWorldEventsPanel({ root, runId, world, director }) {
  const isTown = world?.scale === "town";
  let live = false;
  let timer = null;
  let currentKind = isTown ? "weather" : "message";
  let selectedWeather = "rain";

  // 容器
  const container = document.createElement("div");
  container.className = "heaven-panel";

  // 说明文字
  const descEl = document.createElement("div");
  descEl.className = "heaven-desc";
  descEl.textContent = "天意改变世界，不替任何人说话：只有看得见、听得见或被点名的人会知道。授意只在一个人心里添一个念头，做不做由他自己。";
  container.appendChild(descEl);

  // 种类切换按钮
  const kindsBar = document.createElement("div");
  kindsBar.className = "heaven-kinds";
  const kindBtns = {};
  for (const [k, lbl] of Object.entries(KIND_LABELS)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn${k === currentKind ? " on" : ""}`;
    btn.textContent = lbl;
    if (k === "weather" && !isTown) {
      btn.hidden = true;
    }
    btn.onclick = () => switchKind(k);
    kindsBar.appendChild(btn);
    kindBtns[k] = btn;
  }
  container.appendChild(kindsBar);

  // 表单容器
  const formEl = document.createElement("div");
  formEl.className = "heaven-form";
  container.appendChild(formEl);

  // 天气表单
  const weatherBox = document.createElement("div");
  const weatherBtnsBox = document.createElement("div");
  weatherBtnsBox.className = "heaven-weather-btns";
  const weatherBtns = {};
  for (const opt of WEATHER_KINDS.map((row) => ({ value: row.id, label: row.label }))) {
    const wBtn = document.createElement("button");
    wBtn.type = "button";
    wBtn.className = `btn${opt.value === selectedWeather ? " on" : ""}`;
    wBtn.textContent = opt.label;
    wBtn.onclick = () => {
      selectedWeather = opt.value;
      for (const [val, b] of Object.entries(weatherBtns)) {
        b.classList.toggle("on", val === selectedWeather);
      }
    };
    weatherBtnsBox.appendChild(wBtn);
    weatherBtns[opt.value] = wBtn;
  }
  weatherBox.appendChild(weatherBtnsBox);

  // 东西表单
  const objectBox = document.createElement("div");
  objectBox.innerHTML = `
    <label>名字<input type="text" class="hw-obj-label" maxlength="24" placeholder="东西的名字"></label>
    <label>放在<select class="hw-obj-zone"></select></label>
    <label>样子<input type="text" class="hw-obj-desc" maxlength="200" placeholder="样子（可空）"></label>
  `;
  const objZoneSelect = objectBox.querySelector(".hw-obj-zone");
  const objLabelInput = objectBox.querySelector(".hw-obj-label");
  const objDescInput = objectBox.querySelector(".hw-obj-desc");
  // 填充 zones 按名字排序
  const sortedZones = Object.entries(world.zones || {})
    .map(([zid, zlabel]) => ({ id: zid, name: zlabel || zid }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  objZoneSelect.innerHTML = sortedZones.map((z) => `<option value="${escapeHtml(z.id)}">${escapeHtml(z.name)}</option>`).join("");

  // 口信表单
  const messageBox = document.createElement("div");
  messageBox.innerHTML = `
    <label>给谁<select class="hw-msg-to"></select></label>
    <label>说什么<textarea class="hw-msg-text" maxlength="200" rows="3" placeholder="说些什么"></textarea></label>
    <label>托谁带的<input type="text" class="hw-msg-from" maxlength="24" placeholder="托谁带的（可空）"></label>
  `;
  const msgToSelect = messageBox.querySelector(".hw-msg-to");
  const msgTextInput = messageBox.querySelector(".hw-msg-text");
  const msgFromInput = messageBox.querySelector(".hw-msg-from");
  // 填充 sceneCast 人物，显示名字
  const sceneCastMembers = (world.cast || []).filter((c) => (world.sceneCast || []).includes(c.id));
  msgToSelect.innerHTML = sceneCastMembers.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("");

  // 授意表单
  const urgeBox = document.createElement("div");
  urgeBox.innerHTML = `
    <label>给谁<select class="hw-urge-to"></select></label>
    <label>念头<textarea class="hw-urge-text" maxlength="100" rows="2" placeholder="比如：很想把这件事告诉何嫂"></textarea></label>
    <div class="heaven-desc">他只会觉得是自己冒出来的想法，别人不会知道；照不照做、怎么做，由他决定。</div>
  `;
  const urgeToSelect = urgeBox.querySelector(".hw-urge-to");
  const urgeTextInput = urgeBox.querySelector(".hw-urge-text");
  urgeToSelect.innerHTML = sceneCastMembers.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("");

  // 意外表单
  const accidentBox = document.createElement("div");
  accidentBox.innerHTML = `
    <label>哪件东西<select class="hw-acc-obj"></select></label>
    <label>怎么了<select class="hw-acc-preset">
      <option value="0">不能用了</option>
      <option value="1">修好了</option>
      <option value="2">弄脏了</option>
      <option value="3">摔坏了一角</option>
    </select></label>
    <label>看上去发生了什么<input type="text" class="hw-acc-desc" maxlength="200" placeholder="看上去发生了什么（必填）"></label>
  `;
  const accObjSelect = accidentBox.querySelector(".hw-acc-obj");
  const accPresetSelect = accidentBox.querySelector(".hw-acc-preset");
  const accDescInput = accidentBox.querySelector(".hw-acc-desc");

  function refreshAccidentObjects() {
    const list = Object.entries(director?.objects || {})
      .filter(([, obj]) => obj && obj.label)
      .map(([oid, obj]) => ({ id: oid, label: obj.label }));
    if (!list.length) {
      accObjSelect.innerHTML = '<option value="">暂无物件</option>';
    } else {
      accObjSelect.innerHTML = list.map((o) => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.label)}</option>`).join("");
    }
  }

  // 切换表单页面
  function switchKind(kind) {
    currentKind = kind;
    for (const [k, btn] of Object.entries(kindBtns)) {
      btn.classList.toggle("on", k === kind);
    }
    formEl.replaceChildren();
    if (kind === "weather") {
      if (isTown) formEl.appendChild(weatherBox);
    } else if (kind === "object") formEl.appendChild(objectBox);
    else if (kind === "message") formEl.appendChild(messageBox);
    else if (kind === "urge") formEl.appendChild(urgeBox);
    else if (kind === "accident") {
      refreshAccidentObjects();
      formEl.appendChild(accidentBox);
    }
  }
  switchKind(currentKind);

  // 提示信息与提交按钮
  const actBar = document.createElement("div");
  actBar.style.marginTop = "8px";
  const submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.className = "btn primary";
  submitBtn.textContent = "降下天意";
  actBar.appendChild(submitBtn);
  container.appendChild(actBar);

  const statusEl = document.createElement("div");
  statusEl.className = "heaven-status";
  container.appendChild(statusEl);

  function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle("err", isError);
  }

  // 提交事件
  submitBtn.onclick = async () => {
    setStatus("");
    let body = null;
    if (currentKind === "weather") {
      body = { kind: "weather", weather: selectedWeather };
    } else if (currentKind === "object") {
      const label = objLabelInput.value.trim();
      const zoneId = objZoneSelect.value;
      const description = objDescInput.value.trim();
      if (!label) { setStatus("请填写东西的名字。", true); return; }
      if (!zoneId) { setStatus("请选择放在哪里。", true); return; }
      body = { kind: "object", label, zoneId, description };
    } else if (currentKind === "message") {
      const toCharacterId = msgToSelect.value;
      const text = msgTextInput.value.trim();
      const from = msgFromInput.value.trim();
      if (!toCharacterId) { setStatus("请选择给谁捎信。", true); return; }
      if (!text) { setStatus("请填写口信内容。", true); return; }
      body = { kind: "message", toCharacterId, text, from };
    } else if (currentKind === "urge") {
      const toCharacterId = urgeToSelect.value;
      const text = urgeTextInput.value.trim();
      if (!toCharacterId) { setStatus("请选择给谁授意。", true); return; }
      if (!text) { setStatus("请写下这个念头。", true); return; }
      body = { kind: "urge", toCharacterId, text };
    } else if (currentKind === "accident") {
      const objectId = accObjSelect.value;
      const presetIdx = Number(accPresetSelect.value);
      const preset = ACCIDENT_PRESETS[presetIdx] || ACCIDENT_PRESETS[0];
      const description = accDescInput.value.trim();
      if (!objectId) { setStatus("请选择哪件东西。", true); return; }
      if (!description) { setStatus("请写下看上去发生了什么。", true); return; }
      body = {
        kind: "accident",
        objectId,
        stateKey: preset.stateKey,
        value: preset.value,
        description,
      };
    }

    try {
      submitBtn.disabled = true;
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 202) {
        setStatus("已排上，下一拍之前结算。");
        // 清空文字输入
        if (currentKind === "object") {
          objLabelInput.value = "";
          objDescInput.value = "";
        } else if (currentKind === "message") {
          msgTextInput.value = "";
          msgFromInput.value = "";
        } else if (currentKind === "urge") {
          urgeTextInput.value = "";
        } else if (currentKind === "accident") {
          accDescInput.value = "";
        }
        await loadEvents();
      } else {
        const msg = data?.message || data?.code || `请求失败 (${res.status})`;
        setStatus(msg, true);
      }
    } catch {
      setStatus("网络请求失败，稍后重试。", true);
    } finally {
      submitBtn.disabled = false;
    }
  };

  // 列表容器
  const listEl = document.createElement("div");
  listEl.className = "heaven-list";
  container.appendChild(listEl);

  async function loadEvents() {
    if (!live) return;
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/events`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.ok || !Array.isArray(data.events)) return;
      renderEvents(data.events);
    } catch {
      // 忽略轮询网络抖动
    }
  }

  function renderEvents(events) {
    // 最新的在上面
    const list = events.slice().reverse();
    if (!list.length) {
      listEl.innerHTML = '<div class="heaven-list-item dim">本次运行暂无天意</div>';
      return;
    }
    listEl.innerHTML = list
      .map((ev) => {
        const kindText = KIND_LABELS[ev.kind] || ev.kind;
        let statusText = "";
        if (ev.status === "queued") {
          statusText = '<span class="queued">排队中</span>';
        } else if (ev.status === "applied") {
          statusText = `<span class="applied">已结算（${ev.delivered ?? 0} 人察觉）</span>`;
        } else if (ev.status === "rejected") {
          statusText = `<span class="rejected">没有成立：${escapeHtml(ev.message || "")}</span>`;
        } else {
          statusText = escapeHtml(ev.status);
        }
        return `<div class="heaven-list-item"><b>${escapeHtml(kindText)}</b> · ${statusText}</div>`;
      })
      .join("");
  }

  function startPolling() {
    if (timer) return;
    loadEvents();
    timer = setInterval(loadEvents, 3000);
  }

  function stopPolling() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function updateVisibility() {
    const shouldShow = live;
    if (root.parentElement && root.parentElement.id === "heavenBox") {
      root.parentElement.hidden = !shouldShow;
    }
    if (shouldShow) {
      startPolling();
    } else {
      stopPolling();
    }
  }

  root.replaceChildren(container);
  updateVisibility();

  return {
    setLive(isLive) {
      live = Boolean(isLive);
      updateVisibility();
    },
    destroy() {
      stopPolling();
      root.replaceChildren();
      if (root.parentElement && root.parentElement.id === "heavenBox") {
        root.parentElement.hidden = true;
      }
    },
  };
}
