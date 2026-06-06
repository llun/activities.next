import { Mute } from '@/lib/types/domain/mute'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import { getMastodonTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { urlToId } from '@/lib/utils/urlToId'

const UUID_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const USERNAME_PATTERN = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/

const getFallbackUsername = (mute: Mute) => {
  const segment = mute.targetActorId.split('/').filter(Boolean).pop()
  if (!segment) return mute.targetActorHost

  let decodedSegment: string
  try {
    decodedSegment = decodeURIComponent(segment)
  } catch {
    return mute.targetActorHost
  }

  if (
    !USERNAME_PATTERN.test(decodedSegment) ||
    UUID_LIKE_PATTERN.test(decodedSegment)
  ) {
    return mute.targetActorHost
  }

  return decodedSegment
}

export const getFallbackMutedAccount = (mute: Mute): MastodonAccount => {
  const username = getFallbackUsername(mute)
  const acct =
    username === mute.targetActorHost
      ? mute.targetActorHost
      : `${username}@${mute.targetActorHost}`

  return {
    id: urlToId(mute.targetActorId),
    username,
    acct,
    url: mute.targetActorId,
    display_name: 'Account unavailable',
    note: '',
    avatar: '',
    avatar_static: '',
    header: '',
    header_static: '',
    locked: false,
    source: {
      note: '',
      fields: [],
      privacy: 'public',
      sensitive: false,
      language: 'en',
      follow_requests_count: 0
    },
    fields: [],
    emojis: [],
    bot: false,
    group: false,
    discoverable: false,
    noindex: true,
    created_at: getMastodonTimeUTC(0),
    last_status_at: null,
    statuses_count: 0,
    followers_count: 0,
    following_count: 0
  }
}
