import { ActorData } from '@/lib/models/actor'
import { StatusData } from '@/lib/models/status'
import { Storage } from '@/lib/storage/types'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

import { getMastodonAccount } from './getMastodonAccount'
import { MastodonStatus, ReblogMastodonStatus } from './types'

export const getMastodonStatus = async (
  storage: Storage,
  status: StatusData
): Promise<MastodonStatus | ReblogMastodonStatus> => {
  const account = await getMastodonAccount(storage, status.actor as ActorData)
  if (status.type === 'Announce') {
    return ReblogMastodonStatus.parse({
      id: status.id,
      created_at: getISOTimeUTC(status.createdAt),
      in_reply_to_id: null,
      in_reply_to_account_id: null,
      sensitive: false,
      spoiler_text: '',
      visibility: 'public',
      language: null,
      uri: status.id,
      url: null,
      replies_count: 0,
      reblogs_count: 0,
      favourites_count: 0,
      edited_at: null,
      favourited: false,
      reblogged: false,
      muted: false,
      bookmarked: false,
      content: '',
      filtered: [],
      reblog: await getMastodonStatus(storage, status.originalStatus),
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
    reblog: null,
    favourites_count: status.totalLikes || 0,
    edited_at: null,
    favourited: status.isActorLiked ?? false,
    reblogged: status.isActorAnnounced ?? false,
    muted: false,
    bookmarked: false,
    content: status.text,
    filtered: [],
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
