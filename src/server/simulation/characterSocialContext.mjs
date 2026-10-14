/**
 * Recipient-specific objective social context.
 *
 * This module separates people participating in an action from third-party
 * observers and exposes only objective place/social evidence. Norm pressure,
 * responsibility and anticipated relationship cost belong to the receiving
 * Character Agent and are intentionally absent here.
 */

import { normalizeObjectiveSocialFacts } from "./characterSocialAppraisal.mjs";

export const CHARACTER_SOCIAL_CONTEXT_VERSION = "character-social-context-v2";

function clean(value = "") {
  return String(value ?? "").trim();
}

function unit(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function unique(values = []) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

/**
 * Project objective audience and venue conditions without psychological
 * interpretation. The Character Agent later decides whose gaze matters.
 */
export function deriveCharacterSocialContext({
  actorId = "",
  directParticipantIds = [],
  potentialObservers = [],
  place = {},
  socialFacts = [],
  venue = {},
} = {}) {
  const actor = clean(actorId);
  const participants = unique([actor, ...directParticipantIds]);
  const participantSet = new Set(participants);
  const thirdPartyObservers = (potentialObservers || [])
    .map((row) => ({
      characterId: clean(row?.characterId),
      noticeProbability: unit(row?.noticeProbability),
      modalities: unique(row?.modalities || []),
    }))
    .filter((row) => row.characterId && !participantSet.has(row.characterId));
  const exposureMass = thirdPartyObservers.reduce((sum, row) => (
    sum + row.noticeProbability
  ), 0);
  const audienceExposure = thirdPartyObservers.length
    ? unit(exposureMass / thirdPartyObservers.length)
    : 0;
  return {
    schemaVersion: CHARACTER_SOCIAL_CONTEXT_VERSION,
    authority: "recipient-specific-world-projection",
    actorId: actor,
    directParticipantIds: participants,
    thirdPartyObserverIds: thirdPartyObservers.map((row) => row.characterId),
    thirdPartyObservers,
    audienceExposure,
    place: {
      placeId: clean(place.placeId || venue.placeId),
      zoneId: clean(place.zoneId || venue.zoneId),
      publicAccess: place.publicAccess === true || venue.publicZone === true,
    },
    socialFacts: normalizeObjectiveSocialFacts(socialFacts),
    interpretationAuthority: "character-agent",
  };
}
