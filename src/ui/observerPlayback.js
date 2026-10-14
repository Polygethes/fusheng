export function buildInitialObserverPlayback(draft, totalCount) {
  const total = Math.max(0, Number(totalCount || 0));
  const visible = Math.min(total, total > 0 ? 1 : 0);
  return {
    draftId: draft?.id || null,
    visibleCount: visible,
    totalCount: total,
    status: visible < total ? "playing" : "complete",
  };
}

export function advanceObserverPlayback(playback) {
  const total = Math.max(0, Number(playback?.totalCount || 0));
  const current = Math.max(0, Math.min(total, Number(playback?.visibleCount || 0)));
  const visibleCount = Math.min(total, current + 1);
  return {
    ...(playback || {}),
    visibleCount,
    totalCount: total,
    status: visibleCount < total ? "playing" : "complete",
  };
}
