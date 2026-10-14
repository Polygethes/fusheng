// Only these operations can become public body facts. Free prose remains in
// the authored stage record; it is never interpreted as a physical operation.
const BODY_VERBS = Object.freeze({ nod: "点头", shake_head: "摇头", turn_head: "转头", gaze: "转动视线",
  point: "伸手示意", bow: "欠身", smile: "露出笑容", frown: "皱眉", shrug: "耸肩",
  raise_hand: "抬手", lower_hand: "垂手", clench_hand: "握紧手指", release_hand: "松开手指" });
const DIRECTIONS = Object.freeze({ forward: "向前", left: "向左", right: "向右", up: "向上", down: "向下", neutral: "" });
const AMPLITUDES = Object.freeze({ small: "轻微地", medium: "", large: "明显地" });
const SPEEDS = Object.freeze({ slow: "缓缓", normal: "", quick: "迅速" });
export const PHYSICAL_AFFECTIVE_CUES = Object.freeze({
  gaze_lowered: { channel: "gaze", modality: "visual", feature: "目光垂下。" },
  gaze_fixed: { channel: "attentionLock", modality: "visual", feature: "视线停住。" },
  breath_shallow: { channel: "breath", modality: "sound", feature: "呼吸变浅。" },
  breath_exhale: { channel: "breath", modality: "sound", feature: "呼出一口气。" },
  voice_hesitant: { channel: "voiceOnset", modality: "sound", feature: "话音起得迟疑。" },
  voice_quick: { channel: "pace", modality: "sound", feature: "语速变快。" },
  voice_slow: { channel: "pace", modality: "sound", feature: "语速放慢。" },
  voice_high: { channel: "pitch", modality: "sound", feature: "声调抬高。" },
  voice_low: { channel: "pitch", modality: "sound", feature: "声调压低。" },
  voice_soft: { channel: "volume", modality: "sound", feature: "声音放轻。" },
  voice_loud: { channel: "volume", modality: "sound", feature: "声音变响。" },
  movement_paused: { channel: "movementInterruption", modality: "visual", feature: "身体动作顿住。" },
  posture_tense: { channel: "posture", modality: "visual", feature: "肩背绷紧。" },
  posture_relaxed: { channel: "posture", modality: "visual", feature: "肩背放松。" },
  hand_tense: { channel: "handTension", modality: "visual", feature: "手指收紧。" },
  hand_relaxed: { channel: "handTension", modality: "visual", feature: "手指松开。" },
});
export const bodyActionsSchema = Object.freeze({ type: "array", maxItems: 2, items: {
  type: "object", additionalProperties: false, required: ["kind", "direction", "amplitude", "speed"], properties: {
    kind: { type: "string", enum: Object.keys(BODY_VERBS) }, direction: { type: "string", enum: Object.keys(DIRECTIONS) },
    amplitude: { type: "string", enum: Object.keys(AMPLITUDES) }, speed: { type: "string", enum: Object.keys(SPEEDS) },
  },
} });
export function validBodyActions(actions) {
  return Array.isArray(actions) && actions.length <= 2 && actions.every(row => row && typeof row === "object"
    && Object.keys(row).length === 4 && Object.hasOwn(BODY_VERBS, row.kind) && Object.hasOwn(DIRECTIONS, row.direction)
    && Object.hasOwn(AMPLITUDES, row.amplitude) && Object.hasOwn(SPEEDS, row.speed));
}
export function renderBodyActions(actions = []) {
  if (!validBodyActions(actions)) return "";
  return actions.map(row => `${AMPLITUDES[row.amplitude]}${SPEEDS[row.speed]}${DIRECTIONS[row.direction]}${BODY_VERBS[row.kind]}。`).join("");
}
export function canonicalAffectiveTexture(rows = [], { hasSpeech = false } = {}) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 2).flatMap(row => {
    const definition = Object.hasOwn(PHYSICAL_AFFECTIVE_CUES, row?.cue) ? PHYSICAL_AFFECTIVE_CUES[row.cue] : null;
    if (!definition || definition.channel !== row.channel || definition.modality !== row.modality) return [];
    if (row.cue.startsWith("voice_") && !hasSpeech) return [];
    return [{ cue: row.cue, ...definition }];
  });
}
export function validatePhysicalExpression(expression = {}, primitive = "") {
  const errors = [];
  const actions = expression.bodyActions ?? [];
  if (!validBodyActions(actions)) errors.push({ code: "PHYSICAL_EXPRESSION_INVALID", path: "publicExpression.bodyActions",
    message: "Use at most two supported body operations with exact kind, direction, amplitude and speed. Free text cannot define new physical operations." });
  if (primitive === "gesture" && (!Array.isArray(actions) || !actions.length)) errors.push({ code: "PHYSICAL_EXPRESSION_REQUIRED", path: "publicExpression.bodyActions",
    message: "A gesture requires a supported body operation. Object work must use its perceived affordance; bodyDelta is an unverified draft." });
  for (const [index, row] of (Array.isArray(expression.affectiveDeltas) ? expression.affectiveDeltas : []).entries()) {
    const definition = Object.hasOwn(PHYSICAL_AFFECTIVE_CUES, row?.cue) ? PHYSICAL_AFFECTIVE_CUES[row.cue] : null;
    if (!definition || definition.channel !== row.channel || definition.modality !== row.modality
      || (row.cue.startsWith("voice_") && !String(expression.utterance?.literalSpeech || "").trim())) errors.push({
      code: "PHYSICAL_AFFECTIVE_CUE_INVALID", path: `publicExpression.affectiveDeltas[${index}]`,
      message: "Choose a supported cue with its defined channel and modality; voice cues require actual speech. Feature prose is retained only for audit.",
    });
  }
  return errors;
}
export function physicalAttemptForSettlement(attempt = {}) {
  const payload = { ...attempt.payload };
  // Do not accept an already-sanitized flag from a caller. Rebuild on every
  // entrance, including direct calls to a capability registry.
  payload.visibleAction = "";
  delete payload.gesture;
  delete payload.soundContent;
  payload.observableAffectiveTexture = canonicalAffectiveTexture(payload.observableAffectiveTexture,
    { hasSpeech: Boolean(String(payload.utterance || payload.speech || "").trim()) });
  return { ...attempt, payload };
}
