import { Mastodon } from '@llun/activities.schema'

import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'
import { getMastodonAttachment } from '@/lib/models/attachment'
import { Status } from '@/lib/models/status'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

import { getMastodonAccount } from './getMastodonAccount'
import { ReblogMastodonStatus } from './types'

export const getMastodonStatus = async (
  database: Database,
  status: Status
): Promise<Mastodon.Status | ReblogMastodonStatus> => {
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
    return Mastodon.Status.parse({
      id: status.id,
      created_at: getISOTimeUTC(status.createdAt),
      in_reply_to_id: null,
      in_reply_to_account_id: null,
      sensitive: false,
      spoiler_text: status.summary ?? '',
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
      text: null,
      account,
      media_attachments: status.attachments.map((attachment) =>
        getMastodonAttachment(attachment)
      ),
      mentions: [],
      tags: [],
      emojis: [],
      card: null,
      poll: null
    })
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    console.error('Error while parsing Mastodon status')
    console.error(nodeError.message)
    throw error
  }
}
