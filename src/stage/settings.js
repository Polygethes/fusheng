// Settings modal panel for configuring API keys and gateway options.
const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/gu, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

export function createSettingsPanel({ onSaved } = {}) {
  const modal = $("settingsModal");
  const provider = $("setProvider");
  const baseUrl = $("setBaseUrl");
  const rowBaseUrl = $("rowSetBaseUrl");
  const apiKey = $("setApiKey");
  const model = $("setModel");
  const responseFormat = $("setFormat");
  const status = $("setStatus");
  const saveBtn = $("setSave");
  const testBtn = $("setTest");
  const cancelBtn = $("setCancel");

  let currentSettings = null;
  const FIXED_BASES = { gemini: "https://generativelanguage.googleapis.com", deepseek: "https://api.deepseek.com" };
  const DEFAULT_MODELS = { gemini: "gemini-3.8-flash", deepseek: "deepseek-flash" };
  const baseFor = (name, url) => FIXED_BASES[name] || url || "";

  function updateProviderVisibility() {
    rowBaseUrl.style.display = provider.value === "openai-compatible" ? "" : "none";
    // DeepSeek answers JSON only as json_object.
    const deepseek = provider.value === "deepseek";
    const schemaOption = responseFormat.querySelector('option[value="json_schema"]');
    if (schemaOption) { schemaOption.disabled = deepseek; schemaOption.hidden = deepseek; }
    if (deepseek) responseFormat.value = "json_object";
    checkHostChange();
  }
  provider.onchange = () => {
    // A model name from another provider would not work here: offer this provider's default.
    const typed = model.value.trim();
    const foreign = !typed || (provider.value === "deepseek" ? !/^deepseek/u.test(typed) : provider.value === "gemini" && /^deepseek/u.test(typed));
    if (foreign && DEFAULT_MODELS[provider.value]) model.value = DEFAULT_MODELS[provider.value];
    updateProviderVisibility();
  };
  baseUrl.oninput = checkHostChange;

  function checkHostChange() {
    if (!currentSettings || !currentSettings.configured) return;
    const currentBase = baseFor(currentSettings.provider, currentSettings.baseUrl);
    const newBase = baseFor(provider.value, baseUrl.value.trim());
    try {
      if (currentBase && newBase && new URL(currentBase).host !== new URL(newBase).host && !apiKey.value.trim()) {
        status.textContent = "提示：换了请求地址，请重新填写密钥。";
        status.className = "note";
        return;
      }
    } catch {}
    if (status.textContent === "提示：换了请求地址，请重新填写密钥。") {
      status.textContent = "";
    }
  }

  async function open() {
    status.textContent = "载入设置中…";
    status.className = "note";
    modal.hidden = false;
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || data.code);
      currentSettings = data.settings;
      provider.value = currentSettings.provider || "gemini";
      baseUrl.value = currentSettings.baseUrl || "";
      model.value = currentSettings.model || "gemini-3.8-flash";
      responseFormat.value = currentSettings.responseFormat || "json_object";
      apiKey.value = "";
      if (currentSettings.configured && currentSettings.keyMask) {
        apiKey.placeholder = `已保存：${currentSettings.keyMask}，留空不改`;
      } else {
        apiKey.placeholder = "填入 API Key";
      }
      updateProviderVisibility();
      status.textContent = "";
    } catch (err) {
      status.textContent = `载入失败：${err.message}`;
      status.className = "err";
    }
  }

  async function save({ silent = false } = {}) {
    if (!silent) {
      status.textContent = "保存中…";
      status.className = "note";
    }
    const patch = {
      provider: provider.value,
      baseUrl: baseUrl.value.trim(),
      model: model.value.trim(),
      responseFormat: responseFormat.value,
    };
    if (apiKey.value.trim()) {
      patch.apiKey = apiKey.value.trim();
    }
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const msg = data.issues?.map((i) => i.message).join("；") || data.message || data.code;
        throw new Error(msg);
      }
      currentSettings = data.settings;
      apiKey.value = "";
      if (currentSettings.configured && currentSettings.keyMask) {
        apiKey.placeholder = `已保存：${currentSettings.keyMask}，留空不改`;
      }
      if (!silent) {
        status.textContent = "保存成功。";
        status.className = "note";
      }
      onSaved?.(currentSettings);
      return true;
    } catch (err) {
      status.textContent = `保存失败：${err.message}`;
      status.className = "err";
      return false;
    }
  }

  saveBtn.onclick = async () => {
    const ok = await save();
    if (ok) modal.hidden = true;
  };

  testBtn.onclick = async () => {
    const saved = await save({ silent: true });
    if (!saved) return;
    status.textContent = "正在测试连接…";
    status.className = "note";
    try {
      const res = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || data.code || "连接失败");
      }
      status.textContent = `连接成功：返回模型 ${data.model}，耗时 ${Math.round(data.elapsedMs || 0)}ms。`;
      status.className = "note";
    } catch (err) {
      status.textContent = `测试连接失败：${err.message}`;
      status.className = "err";
    }
  };

  cancelBtn.onclick = () => { modal.hidden = true; };

  return { open };
}
