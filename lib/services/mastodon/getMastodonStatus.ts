import { Mastodon } from '@llun/activities.schema'

import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { getMastodonAttachment } from '@/lib/models/attachment'
import { Status, StatusType } from '@/lib/models/status'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { processStatusText } from '@/lib/utils/text/processStatusText'
import { urlToId } from '@/lib/utils/urlToId'

export const getMastodonStatus = async (
  database: Database,
  status: Status
): Promise<Mastodon.Status | null> => {
  const account = await database.getMastodonActorFromId({ id: status.actorId })
  if (!account) {
    return null
  }

  // Get the host from the global config
  const host = getConfig().host

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

  if (status.type === StatusType.enum.Announce) {
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

  const mastodonStatus = {
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

    reblogged: status.actorAnnounceStatusId !== null,
    content: processStatusText(host, status),

    reblog: null,

    media_attachments: status.attachments.map((attachment) =>
      getMastodonAttachment(attachment)
    )
  }

  // Create poll data if status is a Poll type
  const pollData =
    status.type === StatusType.enum.Poll
      ? Mastodon.Poll.parse({
          id: urlToId(status.id),
          expires_at: getISOTimeUTC(status.endAt),
          expired: Date.now() > status.endAt,
          multiple: false,
          votes_count: status.choices.reduce(
            (sum, choice) => sum + choice.totalVotes,
            0
          ),
          voters_count: 0,
          options: status.choices.map((choice) => ({
            title: choice.title,
            votes_count: choice.totalVotes
          })),
          emojis: [],
          voted: false,
          own_votes: []
        })
      : null

  return Mastodon.Status.parse({
    ...mastodonStatus,
    poll: pollData
  })
}
