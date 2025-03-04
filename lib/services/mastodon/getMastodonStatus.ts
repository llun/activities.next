import { Mastodon } from '@llun/activities.schema'

import { Database } from '@/lib/database/types'
import { getMastodonAttachment } from '@/lib/models/attachment'
import { Status } from '@/lib/models/status'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { urlToId } from '@/lib/utils/urlToId'

export const getMastodonStatus = async (
  database: Database,
  status: Status
): Promise<Mastodon.Status | null> => {
  const account = await database.getMastodonActorFromId({ id: status.actorId })
  if (!account) {
    return null
  }
  const baseData = {
    // Identifiers & timestamps
    id: urlToId(status.id),
    created_at: getISOTimeUTC(status.createdAt),
    edited_at: status.updatedAt ? getISOTimeUTC(status.updatedAt) : null,

    // Visibility settings
    sensitive: false,
    spoiler_text: '',
    visibility: 'public',
    language: null,

    // URI & URL
    uri: status.id,
    url: status.id,

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

      in_reply_to_id: null,
      in_reply_to_account_id: null,

      reblog: await getMastodonStatus(database, status.originalStatus),
      media_attachments: []
    })
  }

  const replyStatus = status.reply
    ? await database.getStatus({ statusId: status.reply })
    : null

  return Mastodon.Status.parse({
    ...baseData,
    spoiler_text: status.summary ?? '',
    url: status.url,

    // Reply information
    in_reply_to_id: replyStatus ? urlToId(replyStatus.id) : null,
    in_reply_to_account_id: replyStatus ? urlToId(replyStatus.actorId) : null,

    replies_count: status.replies.length,

    favourites_count: status.totalLikes || 0,
    favourited: status.isActorLiked ?? false,

    edited_at: status.updatedAt ? getISOTimeUTC(status.updatedAt) : null,

    reblogged: status.isActorAnnounced ?? false,
    content: status.text,

    reblog: null,

    media_attachments: status.attachments.map((attachment) =>
      getMastodonAttachment(attachment)
    )
  })
}
