export function waitingNote(waitingSince, nowMs = Date.now()) {
  if (!waitingSince) return "";
  const sinceMs = Date.parse(waitingSince);
  if (!Number.isFinite(sinceMs)) return "";
  const diffMs = nowMs - sinceMs;
  if (diffMs < 0) return "";
  const totalSeconds = Math.floor(diffMs / 1000);
  if (totalSeconds < 15) return "";
  if (totalSeconds < 60) {
    return ` · 等模型回应 ${totalSeconds} 秒`;
  }
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return ` · 等模型回应 ${m} 分 ${s} 秒`;
}

// The run is waiting out a gateway that is down before it sends the request again.
export function gatewayNote(gatewayWait, nowMs = Date.now()) {
  if (!gatewayWait) return "";
  const untilMs = Date.parse(gatewayWait.until);
  if (!Number.isFinite(untilMs)) return "";
  const left = Math.ceil((untilMs - nowMs) / 1000);
  const which = `（第 ${gatewayWait.round}/${gatewayWait.rounds} 次）`;
  return left > 0 ? ` · 网关暂时不通，${left} 秒后再试${which}` : ` · 网关暂时不通，正在再试${which}`;
}
