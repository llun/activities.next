import { MAX_NOTIFICATION_GROUP_KEY_LENGTH } from '@/lib/services/statuses/reactionLimits'
import { getHashFromString } from '@/lib/utils/getHashFromString'

/**
 * Groups an actor's reaction notifications per (status, emoji). Both parts are
 * remote-controlled and unbounded-ish — the status id is a URL and the name can
 * be a full `shortcode@domain` — so the readable form is used only while it fits
 * the varchar(255) column, with a digest of the same inputs as the overflow
 * fallback. The digest is deterministic, so a group stays stable across
 * deliveries either way.
 */
export const getReactionGroupKey = (statusId: string, name: string) => {
  const groupKey = `emoji_reaction:${statusId}:${name}`
  if (groupKey.length <= MAX_NOTIFICATION_GROUP_KEY_LENGTH) return groupKey
  return `emoji_reaction:${getHashFromString(`${statusId}:${name}`)}`
}
