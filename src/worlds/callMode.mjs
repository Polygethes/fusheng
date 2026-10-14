// Which call mode a run uses. The three-call mode stays for built-in worlds only;
// performance and hybrid run one call a beat and can be used anywhere.
const MODES = new Set(["three-call", "performance", "hybrid"]);

export function resolveCallMode({ scale, requested = "", fallback = "performance" } = {}) {
  const asked = String(requested || "").trim();
  if (asked && !MODES.has(asked)) {
    throw Object.assign(new Error("调用模式只能是 three-call、performance 或 hybrid。"), { code: "CALL_MODE_INVALID" });
  }
  if (scale === "town") {
    if (asked === "three-call") {
      throw Object.assign(new Error("小镇世界只支持演绎模式（performance）和混合模式（hybrid），三段调用模式只用于内置世界。"), { code: "CALL_MODE_UNSUPPORTED" });
    }
    if (asked === "hybrid") return "hybrid";
    return "performance";
  }
  return asked || fallback;
}
