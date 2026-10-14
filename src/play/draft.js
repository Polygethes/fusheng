// The draft being created, kept in this browser between visits. Only a
// convenience: the world itself is saved on the server when the player starts
// it, and a page that cannot read storage simply starts with no draft.
const KEY = "gtown.draft.v1";

export function loadDraft() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "null");
    return value && typeof value === "object" && value.blueprint ? value : null;
  } catch { return null; }
}

export function saveDraft(draft) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...draft, updatedAt: new Date().toISOString() })); return true; }
  catch { return false; }
}

export function clearDraft() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
