import { ActorData } from '@/lib/models/actor'
import { StatusData } from '@/lib/models/status'
import { Storage } from '@/lib/storage/types'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

import { getMastodonAccount } from './getMastodonAccount'
import { MastodonStatus } from './types'

export const getMastodonStatus = async (
  storage: Storage,
  status: StatusData
) => {
  const account = await getMastodonAccount(storage, status.actor as ActorData)
  return MastodonStatus.parse({
    id: status.id,
    created_at: getISOTimeUTC(status.createdAt),
    in_reply_to_id: null,
    in_reply_to_account_id: null,
    sensitive: false,
    spoiler_text: status.summary || null,
    visibility: 'public',
    language: null,
    uri: status.id,
    url: status.url,
    replies_count: 0,
    reblogs_count: 0,
    favourites_count: status.totalLikes || 0,
    edited_at: null,
    favourited: status.isActorLiked || null,
    reblogged: status.isActorAnnounced || null,
    muted: false,
    bookmarked: false,
    content: status.text,
    filtered: [],
    reblog: null,
    account,
    media_attachments: [],
    mentions: [],
    tags: [],
    emojis: [],
    card: null,
    poll: null,
    application: null
  })
}
