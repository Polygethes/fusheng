export function render(root, ctx) {
  let unmounted = false;

  root.innerHTML = `
    <div class="view-head">
      <button class="btn btn-back">← 返回</button>
      <h2>世界库</h2>
    </div>
    <div class="world-container">
      <div class="world-loading">加载中…</div>
    </div>
  `;

  root.querySelector(".btn-back")?.addEventListener("click", () => ctx.go(""));

  const container = root.querySelector(".world-container");

  async function loadWorlds() {
    let libraryList = [];
    let worldsList = [];
    try {
      const res = await fetch("/api/library");
      const data = await res.json();
      if (data.ok && Array.isArray(data.worlds)) libraryList = data.worlds;
    } catch {}

    try {
      const res = await fetch("/api/worlds");
      const data = await res.json();
      if (data.ok && Array.isArray(data.worlds)) worldsList = data.worlds;
    } catch {}

    if (unmounted) return;

    const map = new Map();
    for (const w of libraryList) {
      map.set(w.id, {
        id: w.id,
        title: w.title,
        builtIn: Boolean(w.builtIn),
        residents: typeof w.residents === "number" ? w.residents : undefined,
      });
    }
    for (const w of worldsList) {
      if (!map.has(w.id)) {
        map.set(w.id, {
          id: w.id,
          title: w.title,
          builtIn: true,
          residents: Array.isArray(w.cast) ? w.cast.length : (Array.isArray(w.sceneCast) ? w.sceneCast.length : undefined),
        });
      } else {
        const item = map.get(w.id);
        if (item.residents === undefined) {
          if (Array.isArray(w.cast)) item.residents = w.cast.length;
          else if (Array.isArray(w.sceneCast)) item.residents = w.sceneCast.length;
        }
      }
    }

    const worlds = Array.from(map.values());

    if (worlds.length === 0) {
      container.innerHTML = `<p class="library-empty">还没有自己的世界。回到开始界面选“新的世界”。</p>`;
      return;
    }

    container.innerHTML = `<div class="world-list"></div>`;
    const listEl = container.querySelector(".world-list");

    for (const world of worlds) {
      const card = document.createElement("div");
      card.className = "card px world-card";

      const title = world.title || world.id;
      const badgeText = world.builtIn ? "内置" : "我的世界";
      const badgeClass = world.builtIn ? "badge" : "badge primary";
      const residentsText = typeof world.residents === "number" ? `${world.residents} 位居民` : "";

      card.innerHTML = `
        <div class="world-card-head">
          <h3 class="world-card-title">${escapeHtml(title)}</h3>
          <span class="${badgeClass}">${badgeText}</span>
        </div>
        <div class="world-id">${escapeHtml(world.id)}</div>
        ${residentsText ? `<div class="world-meta">${escapeHtml(residentsText)}</div>` : ""}
        <div class="world-error" hidden></div>
        <div class="world-actions">
          <button class="btn primary btn-new-save">新开存档</button>
          ${!world.builtIn ? `<button class="btn btn-delete">删除</button>` : ""}
        </div>
      `;

      const errEl = card.querySelector(".world-error");

      card.querySelector(".btn-new-save")?.addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        errEl.hidden = true;
        try {
          const res = await fetch("/api/create/new-save", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ worldId: world.id }),
          });
          const data = await res.json();
          if (res.ok && data.ok && data.observerUrl) {
            location.href = data.observerUrl;
          } else {
            errEl.textContent = data.message || "新开存档失败。";
            errEl.hidden = false;
            btn.disabled = false;
          }
        } catch (err) {
          errEl.textContent = err.message || "请求失败。";
          errEl.hidden = false;
          btn.disabled = false;
        }
      });

      if (!world.builtIn) {
        card.querySelector(".btn-delete")?.addEventListener("click", async () => {
          if (!confirm(`确定要删除世界“${title}”吗？此操作无法撤销。`)) return;
          try {
            const res = await fetch(`/api/library/${world.id}`, { method: "DELETE" });
            const data = await res.json();
            if (res.ok && data.ok) {
              loadWorlds();
            } else {
              errEl.textContent = data.message || "删除失败。";
              errEl.hidden = false;
            }
          } catch (err) {
            errEl.textContent = err.message || "请求失败。";
            errEl.hidden = false;
          }
        });
      }

      listEl.appendChild(card);
    }
  }

  loadWorlds();

  return () => {
    unmounted = true;
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
