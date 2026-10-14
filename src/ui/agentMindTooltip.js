const TOOLTIP_ID = "agent-mind-tooltip";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function setupAgentMindTooltip(root) {
  if (!root?.addEventListener || !root.ownerDocument) return () => {};
  const documentRef = root.ownerDocument;
  const windowRef = documentRef.defaultView;
  let tooltip = documentRef.getElementById(TOOLTIP_ID);
  if (!tooltip) {
    tooltip = documentRef.createElement("div");
    tooltip.id = TOOLTIP_ID;
    tooltip.className = "agent-mind-tooltip-float";
    tooltip.dataset.agentMindFloat = "true";
    tooltip.hidden = true;
    documentRef.body.append(tooltip);
  }

  let activeTrigger = null;
  let hideTimer = null;
  let pinned = false;

  const clearHideTimer = () => {
    if (hideTimer) windowRef?.clearTimeout(hideTimer);
    hideTimer = null;
  };

  const position = () => {
    if (!activeTrigger || tooltip.hidden) return;
    const anchor = activeTrigger.getBoundingClientRect();
    const panel = tooltip.getBoundingClientRect();
    const viewportWidth = windowRef?.innerWidth || documentRef.documentElement.clientWidth;
    const viewportHeight = windowRef?.innerHeight || documentRef.documentElement.clientHeight;
    const gutter = 12;
    const gap = 14;
    let placement = "right";
    let left = anchor.right + gap;
    let top = anchor.top + (anchor.height - panel.height) / 2;

    if (left + panel.width > viewportWidth - gutter) {
      const leftCandidate = anchor.left - panel.width - gap;
      if (leftCandidate >= gutter) {
        left = leftCandidate;
        placement = "left";
      } else {
        left = anchor.left + (anchor.width - panel.width) / 2;
        top = anchor.bottom + gap;
        placement = "bottom";
        if (top + panel.height > viewportHeight - gutter) {
          top = anchor.top - panel.height - gap;
          placement = "top";
        }
      }
    }

    tooltip.dataset.placement = placement;
    tooltip.style.left = `${Math.round(clamp(left, gutter, Math.max(gutter, viewportWidth - panel.width - gutter)))}px`;
    tooltip.style.top = `${Math.round(clamp(top, gutter, Math.max(gutter, viewportHeight - panel.height - gutter)))}px`;
  };

  const show = (trigger, { pin = false } = {}) => {
    const template = trigger?.querySelector?.("template[data-agent-mind-template]");
    if (!template) return;
    clearHideTimer();
    if (activeTrigger && activeTrigger !== trigger) activeTrigger.setAttribute("aria-expanded", "false");
    activeTrigger = trigger;
    pinned = pin;
    tooltip.replaceChildren(template.content.cloneNode(true));
    tooltip.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    trigger.setAttribute("aria-describedby", TOOLTIP_ID);
    windowRef?.requestAnimationFrame(position);
  };

  const hide = () => {
    clearHideTimer();
    if (activeTrigger) {
      activeTrigger.setAttribute("aria-expanded", "false");
      activeTrigger.removeAttribute("aria-describedby");
    }
    activeTrigger = null;
    pinned = false;
    tooltip.hidden = true;
    tooltip.replaceChildren();
  };

  const scheduleHide = () => {
    clearHideTimer();
    if (pinned) return;
    hideTimer = windowRef?.setTimeout(hide, 90);
  };

  const triggerFrom = (target) => target?.closest?.("[data-agent-mind-trigger]") || null;

  const onPointerOver = (event) => {
    const trigger = triggerFrom(event.target);
    if (!trigger || trigger.contains(event.relatedTarget)) return;
    show(trigger);
  };
  const onPointerOut = (event) => {
    const trigger = triggerFrom(event.target);
    if (!trigger || trigger.contains(event.relatedTarget)) return;
    scheduleHide();
  };
  const onFocusIn = (event) => {
    const trigger = triggerFrom(event.target);
    if (trigger) show(trigger);
  };
  const onFocusOut = (event) => {
    const trigger = triggerFrom(event.target);
    if (trigger && !trigger.contains(event.relatedTarget)) scheduleHide();
  };
  const onClick = (event) => {
    const trigger = triggerFrom(event.target);
    if (trigger) {
      if (activeTrigger === trigger && pinned) hide();
      else show(trigger, { pin: true });
      return;
    }
    if (pinned && !tooltip.contains(event.target)) hide();
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape" && activeTrigger) {
      const previousTrigger = activeTrigger;
      hide();
      previousTrigger.focus?.();
    }
  };

  root.addEventListener("pointerover", onPointerOver);
  root.addEventListener("pointerout", onPointerOut);
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  documentRef.addEventListener("click", onClick);
  documentRef.addEventListener("keydown", onKeyDown);
  tooltip.addEventListener("pointerenter", clearHideTimer);
  tooltip.addEventListener("pointerleave", scheduleHide);
  windowRef?.addEventListener("resize", position);
  windowRef?.addEventListener("scroll", position, true);

  return () => {
    clearHideTimer();
    root.removeEventListener("pointerover", onPointerOver);
    root.removeEventListener("pointerout", onPointerOut);
    root.removeEventListener("focusin", onFocusIn);
    root.removeEventListener("focusout", onFocusOut);
    documentRef.removeEventListener("click", onClick);
    documentRef.removeEventListener("keydown", onKeyDown);
    windowRef?.removeEventListener("resize", position);
    windowRef?.removeEventListener("scroll", position, true);
    hide();
  };
}
