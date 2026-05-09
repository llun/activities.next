import { Block } from '@/lib/types/domain/block'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { urlToId } from '@/lib/utils/urlToId'

const UUID_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const USERNAME_PATTERN = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/

const getFallbackUsername = (block: Block) => {
  const segment = block.targetActorId.split('/').filter(Boolean).pop()
  if (!segment) return block.targetActorHost

  let decodedSegment: string
  try {
    decodedSegment = decodeURIComponent(segment)
  } catch {
    return block.targetActorHost
  }

  if (
    !USERNAME_PATTERN.test(decodedSegment) ||
    UUID_LIKE_PATTERN.test(decodedSegment)
  ) {
    return block.targetActorHost
  }

  return decodedSegment
}

export const getFallbackBlockedAccount = (block: Block): MastodonAccount => {
  const username = getFallbackUsername(block)
  const acct =
    username === block.targetActorHost
      ? block.targetActorHost
      : `${username}@${block.targetActorHost}`

  return {
    id: urlToId(block.targetActorId),
    username,
    acct,
    url: block.targetActorId,
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
    created_at: getISOTimeUTC(0),
    last_status_at: null,
    statuses_count: 0,
    followers_count: 0,
    following_count: 0
  }
}
