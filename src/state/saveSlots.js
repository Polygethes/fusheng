const DB_NAME = "character-town-saves-v12";
const STORE_NAME = "world-saves";
const FALLBACK_KEY = "character-town-world-saves-v12";

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function cleanName(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 60) || "未命名存档";
}

function saveSummary(record = {}) {
  const { payload, ...summary } = record;
  return clone(summary);
}

function validatePayload(payload = "") {
  const text = String(payload || "");
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || !parsed.project || !parsed.town || !parsed.ui) {
    throw new Error("存档内容不完整");
  }
  return text;
}

export function prepareSavePayload(source = {}) {
  const snapshot = clone(source);
  snapshot.ui = { ...(snapshot.ui || {}) };
  const returnTab = snapshot.ui.saveReturnTab;
  snapshot.ui.activeTab = returnTab && returnTab !== "saves" ? returnTab : "reality";
  snapshot.ui.livePerformance = null;
  snapshot.ui.lastPlayError = "";
  if (snapshot.ui.observerPlayback?.status === "playing") {
    snapshot.ui.observerPlayback = {
      ...snapshot.ui.observerPlayback,
      visibleCount: snapshot.ui.observerPlayback.totalCount || snapshot.ui.observerPlayback.visibleCount || 0,
      status: "complete",
    };
  }
  delete snapshot.ui.saveReturnTab;
  delete snapshot.ui.saveSlots;
  delete snapshot.ui.saveSlotsStatus;
  delete snapshot.ui.saveNameDraft;
  return JSON.stringify(snapshot);
}

export function buildSaveMetadata(state = {}) {
  const activeBranchId = state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main";
  const branch = (state.branches || []).find((item) => item.id === activeBranchId);
  return {
    worldName: state.town?.name || state.project?.title || "未命名世界",
    projectTitle: state.project?.title || state.town?.name || "未命名世界",
    branchTitle: branch?.title || "主线",
    characterCount: (state.characters || []).length,
    locationCount: (state.locations || []).length,
    canonCount: (state.canonEvents || []).length,
    draftCount: (state.draftScenes || []).length,
    storyCount: (state.storyRevisions || []).length,
  };
}

export function createMemorySaveDriver() {
  const records = new Map();
  return {
    async getAll() { return [...records.values()].map(clone); },
    async get(id) { return records.has(id) ? clone(records.get(id)) : null; },
    async put(record) { records.set(record.id, clone(record)); },
    async delete(id) { records.delete(id); },
  };
}

function createLocalStorageDriver(storage) {
  function read() {
    try {
      return JSON.parse(storage.getItem(FALLBACK_KEY) || "{}");
    } catch {
      return {};
    }
  }
  function write(records) {
    storage.setItem(FALLBACK_KEY, JSON.stringify(records));
  }
  return {
    async getAll() { return Object.values(read()); },
    async get(id) { return read()[id] || null; },
    async put(record) {
      const records = read();
      records[record.id] = record;
      write(records);
    },
    async delete(id) {
      const records = read();
      delete records[id];
      write(records);
    },
  };
}

function createIndexedDbDriver(indexedDb) {
  let databasePromise = null;
  function open() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDb.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("无法打开存档库"));
    });
    return databasePromise;
  }
  async function requestResult(mode, operation) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      const request = operation(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || transaction.error || new Error("存档操作失败"));
    });
  }
  return {
    async getAll() { return requestResult("readonly", (store) => store.getAll()); },
    async get(id) { return requestResult("readonly", (store) => store.get(id)); },
    async put(record) { await requestResult("readwrite", (store) => store.put(record)); },
    async delete(id) { await requestResult("readwrite", (store) => store.delete(id)); },
  };
}

function defaultDriver() {
  if (typeof indexedDB !== "undefined" && indexedDB?.open) return createIndexedDbDriver(indexedDB);
  if (typeof localStorage !== "undefined" && localStorage?.getItem) return createLocalStorageDriver(localStorage);
  return createMemorySaveDriver();
}

export function createSaveRepository({
  driver = defaultDriver(),
  now = () => new Date().toISOString(),
  idFactory = () => `save_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
} = {}) {
  return {
    async list() {
      const records = await driver.getAll();
      return records
        .slice()
        .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
        .map(saveSummary);
    },
    async load(id) {
      const record = await driver.get(id);
      if (!record) throw new Error("这个存档不存在");
      validatePayload(record.payload);
      return clone(record);
    },
    async save({ id = "", name = "", payload = "", metadata = {} } = {}) {
      const normalizedPayload = validatePayload(payload);
      const existing = id ? await driver.get(id) : null;
      if (id && !existing) throw new Error("要覆盖的存档不存在");
      const timestamp = now();
      const record = {
        ...(existing || {}),
        ...clone(metadata),
        id: existing?.id || id || idFactory(),
        name: cleanName(name || existing?.name),
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp,
        payload: normalizedPayload,
        schemaVersion: 1,
      };
      await driver.put(record);
      return saveSummary(record);
    },
    async delete(id) {
      await driver.delete(id);
    },
  };
}

export const saveRepository = createSaveRepository();
