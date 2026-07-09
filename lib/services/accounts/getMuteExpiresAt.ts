import { Mute } from '@/lib/types/domain/mute'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

// Mastodon reports timed mutes as an ISO 8601 datetime and indefinite mutes
// as null (Relationship.muting_expires_at / MutedAccount.mute_expires_at).
// Expired rows never reach the serializers: getMute/isMuting/getMutes all
// filter out rows whose endsAt is in the past.
export const getMuteExpiresAt = (mute: Pick<Mute, 'endsAt'>): string | null =>
  mute.endsAt !== null ? getISOTimeUTC(mute.endsAt) : null
