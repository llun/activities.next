import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'
import { Status } from '@/lib/models/status'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

import { getMastodonAccount } from './getMastodonAccount'
import { MastodonStatus, ReblogMastodonStatus } from './types'

export const getMastodonStatus = async (
  database: Database,
  status: Status
): Promise<MastodonStatus | ReblogMastodonStatus> => {
  const account = await getMastodonAccount(database, status.actor as Actor)
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
      reblog: await getMastodonStatus(database, status.originalStatus),
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
  try {
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
      media_attachments: status.attachments.map((attachment) => ({
        id: attachment.id,
        type: attachment.mediaType,
        url: attachment.url,
        description: attachment.name
      })),
      mentions: [],
      tags: [],
      emojis: [],
      card: null,
      poll: null,
      application: null
    })
  } catch (error) {
    console.error('Error while parsing Mastodon status')
    console.error(error.message)
    console.log(account)
    throw error
  }
}
