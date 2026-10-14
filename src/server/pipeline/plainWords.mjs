// Small pieces of how a person's own situation is put into words.
import { SETBACK_WORDS } from "../simulation/temper.mjs";

const clean = (value) => String(value ?? "").trim();
// Failures whose own result already says why in words.
const SAID_ALREADY = new Set(["MOVE_BLOCKED_BY_FLOOD", "MOVE_HELD", "OBJECT_NOT_IN_HAND", "OBJECT_NOT_HELD"]);
const pad = (value) => String(value).padStart(2, "0");

/**
 * What someone longs for, as a sentence: the longing itself when the town
 * wrote one ("你盼着有人带回消息……。", "你想在织屋里织布……。"), else the
 * verb and what it is about ("你想补亮北坡阵眼的阵纹。").
 */
export function desireLine(desiredState = {}) {
  const outcome = clean(desiredState.observableOutcome).replace(/[。！!]+$/u, "");
  if (!outcome) return `你想${clean(desiredState.verb)}${clean(desiredState.object)}。`;
  if (/^(盼着|想|要|希望|巴不得)/u.test(outcome)) return `你${outcome}。`;
  return `你想${outcome}。`;
}

/**
 * When a line was said or a thing happened: the hour on the town's clock
 * ("19:05") when the town keeps one (`startMinutes` is the minute of day it
 * opened), else minutes and seconds since the opening ("01:35").
 */
export function clockStamp(seconds = 0, startMinutes = null) {
  const at = Math.max(0, Number(seconds || 0));
  if (startMinutes === null || startMinutes === undefined || !Number.isFinite(Number(startMinutes))) {
    return `${pad(Math.floor(at / 60))}:${pad(Math.floor(at % 60))}`;
  }
  const minute = ((Math.floor(Number(startMinutes) + at / 60) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}

/** Why one's own last act did not happen, in plain words, for a noticed own-action result ([] for anything else). */
export function failureReasons(row = {}) {
  if (clean(row.type) !== "own_action_result") return [];
  const codes = (row.semanticFrame?.actionResult?.failureCodes || []).map(clean);
  return [...new Set(codes.filter((code) => !SAID_ALREADY.has(code)).map((code) => SETBACK_WORDS[code]).filter(Boolean))];
}
