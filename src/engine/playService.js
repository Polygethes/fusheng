import { playNext as playWithMock } from "./mockEngine.js";

async function emitEvent(onEvent, event) {
  if (typeof onEvent === "function") await onEvent(event);
}

function createClientRunId() {
  if (globalThis.crypto?.randomUUID) return `run_${globalThis.crypto.randomUUID().replace(/-/g, "")}`;
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function waitBeforeReconnect(attempt) {
  return new Promise((resolve) => setTimeout(resolve, 350 * Math.max(1, attempt)));
}

function nonRetryableError(message) {
  const error = new Error(message);
  error.retryable = false;
  return error;
}

async function readEventStream(response, onEvent, { afterSeq = 0, onSequence } = {}) {
  if (!response.body?.getReader) throw new Error("当前浏览器不支持实时输出流。 ");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalDraft = null;
  let highestSequence = Math.max(0, Number(afterSeq) || 0);

  const consumeLine = async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      throw nonRetryableError("实时输出包含无法解析的事件。 ");
    }
    if (event.type === "heartbeat") return;
    const sequence = Math.max(0, Number(event.seq) || 0);
    if (sequence && sequence <= highestSequence) return;
    if (sequence) {
      highestSequence = sequence;
      onSequence?.(highestSequence);
    }
    await emitEvent(onEvent, event);
    if (event.type === "error") {
      const error = nonRetryableError(event.error || "DeepSeek 实时模拟失败。 ");
      error.kind = event.kind || "run_error";
      error.stage = event.stage || "";
      throw error;
    }
    if (event.type === "complete") finalDraft = event.draft || null;
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      await consumeLine(line);
      if (finalDraft) {
        await reader.cancel().catch(() => {});
        return finalDraft;
      }
    }
    if (done) break;
  }
  if (buffer.trim()) {
    await consumeLine(buffer);
    if (finalDraft) return finalDraft;
  }
  if (!finalDraft) throw new Error("实时输出结束，但没有收到最终场景。 ");
  return finalDraft;
}

async function playRemoteStream(state, engineMode, onEvent) {
  const runId = createClientRunId();
  let afterSeq = 0;
  let lastError = null;
  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch("/api/engine/play/stream", {
        method: "POST",
        headers: {
          "accept": "application/x-ndjson",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          state,
          mode: engineMode,
          allowFallback: engineMode !== "openai",
          runId,
          afterSeq,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const error = new Error(data.error || `HTTP ${response.status}`);
        error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw error;
      }
      return await readEventStream(response, onEvent, {
        afterSeq,
        onSequence: (sequence) => { afterSeq = Math.max(afterSeq, sequence); },
      });
    } catch (error) {
      lastError = error;
      if (error?.retryable === false) throw error;
      if (attempt >= maxAttempts - 1) break;
      await emitEvent(onEvent, {
        type: "connection_retrying",
        runId,
        attempt: attempt + 1,
        afterSeq,
      });
      await waitBeforeReconnect(attempt + 1);
    }
  }

  const detail = lastError?.message ? `：${lastError.message}` : "";
  const error = new Error(`实时连接中断，已保留当前场景${detail}`);
  error.cause = lastError;
  throw error;
}

export async function playNext(state, { onEvent } = {}) {
  const engineMode = state.ui?.engineMode || "local";
  if (engineMode === "local" || engineMode === "mock") {
    await emitEvent(onEvent, { type: "run_started", provider: "browser-mock" });
    const draft = playWithMock(state);
    draft.provider = "browser-mock";
    draft.engine = { provider: "browser-mock", reason: "user selected local theater" };
    await emitEvent(onEvent, { type: "complete", draft });
    return draft;
  }

  try {
    const draft = await playRemoteStream(state, engineMode, onEvent);
    return {
      ...draft,
      provider: draft.provider || draft.engine?.provider || "server",
    };
  } catch (error) {
    if (engineMode === "openai") throw error;
    const draft = playWithMock(state);
    draft.provider = "browser-mock-fallback";
    draft.engine = { provider: "browser-mock-fallback", error: error?.message || String(error) };
    draft.providerWarning = error?.message || String(error);
    await emitEvent(onEvent, { type: "complete", draft, fallback: true });
    return draft;
  }
}
