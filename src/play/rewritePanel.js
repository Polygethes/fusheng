// Shared modal panel for rewriting a section of a blueprint with the model
export function openRewritePanel({ anchor, sectionPath, label, blueprint, onDone }) {
  if (!anchor) return null;

  let modal = anchor.querySelector(".rewrite-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.className = "modal rewrite-modal";
    modal.innerHTML = `
      <div class="px panel">
        <div class="ctitle rewrite-modal-title">让模型重写</div>
        <p class="modal-desc">只改这一页，其他页一个字不动</p>
        <div class="field">
          <textarea class="rewrite-instruction" maxlength="500" placeholder="写写你想怎么改（最多 500 字，可空）"></textarea>
        </div>
        <div class="rewrite-auth-row">
          <label><input type="checkbox" class="rewrite-auth" /> 我授权调用真实模型，最多 3 次请求</label>
        </div>
        <div class="note rewrite-status"></div>
        <div class="actions">
          <button type="button" class="btn btn-cancel-rewrite">取消</button>
          <button type="button" class="btn primary btn-do-rewrite">重写</button>
        </div>
      </div>
    `;
    anchor.appendChild(modal);
  }

  modal.hidden = false;
  const titleEl = modal.querySelector(".rewrite-modal-title");
  if (titleEl) titleEl.textContent = `让模型重写 · ${label}`;

  const instructionEl = modal.querySelector(".rewrite-instruction");
  if (instructionEl) instructionEl.value = "";

  const authEl = modal.querySelector(".rewrite-auth");
  if (authEl) authEl.checked = false;

  const statusEl = modal.querySelector(".rewrite-status");
  if (statusEl) {
    statusEl.textContent = "";
    statusEl.className = "note rewrite-status";
  }

  const cancelBtn = modal.querySelector(".btn-cancel-rewrite");
  const doBtn = modal.querySelector(".btn-do-rewrite");

  if (cancelBtn) {
    cancelBtn.onclick = () => {
      modal.hidden = true;
    };
  }

  if (doBtn) {
    doBtn.onclick = async () => {
      if (authEl && !authEl.checked) {
        if (statusEl) {
          statusEl.textContent = "请勾选授权调用模型。";
          statusEl.className = "note rewrite-status error";
        }
        return;
      }
      const instruction = instructionEl ? instructionEl.value.trim() : "";
      doBtn.disabled = true;
      doBtn.textContent = "重写中...";
      if (statusEl) {
        statusEl.textContent = "模型思考中，请稍候...";
        statusEl.className = "note rewrite-status";
      }

      try {
        const bp = typeof blueprint === "function" ? blueprint() : blueprint;
        const res = await fetch("/api/create/rewrite", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            blueprint: bp,
            sectionPath,
            instruction,
            authorized: true,
            maxRequests: 3,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          onDone?.(data.blueprint);
          const issueCount = data.issues?.length || 0;
          if (statusEl) {
            statusEl.textContent = `已重写；还有 ${issueCount} 个问题`;
            statusEl.className = "note rewrite-status success";
          }
          setTimeout(() => {
            modal.hidden = true;
          }, 1200);
        } else {
          const msg = data.message || (data.issues ? `重写未完全通过（${data.issues.length} 个问题）` : "重写失败");
          if (statusEl) {
            statusEl.textContent = msg;
            statusEl.className = "note rewrite-status error";
          }
        }
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = "请求出错：" + (err.message || err);
          statusEl.className = "note rewrite-status error";
        }
      } finally {
        doBtn.disabled = false;
        doBtn.textContent = "重写";
      }
    };
  }

  return modal;
}
