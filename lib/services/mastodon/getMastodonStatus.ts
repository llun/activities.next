import { Mastodon } from '@llun/activities.schema'

import { Database } from '@/lib/database/types'
import { getMastodonAttachment } from '@/lib/models/attachment'
import { Status } from '@/lib/models/status'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

export const getMastodonStatus = async (
  database: Database,
  status: Status
): Promise<Mastodon.Status> => {
  const account = await database.getMastodonActorFromId({ id: status.actorId })
  const baseData = {
    // Identifiers & timestamps
    id: status.id,
    created_at: getISOTimeUTC(status.createdAt),
    edited_at: status.updatedAt ? getISOTimeUTC(status.updatedAt) : null,

    // Reply information
    in_reply_to_id: null,
    in_reply_to_account_id: null,

    // Visibility settings
    sensitive: false,
    spoiler_text: '',
    visibility: 'public',
    language: null,

    // URI & URL
    uri: status.id,
    url: null,

    // Count metrics
    replies_count: 0,
    reblogs_count: 0,
    favourites_count: 0,

    // Interaction flags
    favourited: false,
    reblogged: false,
    muted: false,
    bookmarked: false,

    // Content and account info
    content: '',
    text: null,
    account,

    // Additional data
    mentions: [],
    tags: [],
    emojis: [],
    card: null,
    poll: null
  }

  if (status.type === 'Announce') {
    return Mastodon.Status.parse({
      ...baseData,
      reblog: await getMastodonStatus(database, status.originalStatus),
      media_attachments: []
    })
  }
  return Mastodon.Status.parse({
    ...baseData,
    spoiler_text: status.summary ?? '',
    url: status.url,
    favourites_count: status.totalLikes || 0,
    edited_at: status.updatedAt ? getISOTimeUTC(status.updatedAt) : null,
    favourited: status.isActorLiked ?? false,
    reblogged: status.isActorAnnounced ?? false,
    content: status.text,
    reblog: null,
    media_attachments: status.attachments.map((attachment) =>
      getMastodonAttachment(attachment)
    )
  })
}
