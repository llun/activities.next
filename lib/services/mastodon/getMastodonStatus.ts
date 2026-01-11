import { Mastodon } from '@llun/activities.schema'

import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { getMastodonAttachment } from '@/lib/models/attachment'
import { Status, StatusType } from '@/lib/models/status'
import { Tag, TagType } from '@/lib/models/tag'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { getVisibility } from '@/lib/utils/getVisibility'
import { processStatusText } from '@/lib/utils/text/processStatusText'
import { urlToId } from '@/lib/utils/urlToId'

// Inline types matching the Mastodon.Status schema expectations
interface MastodonMention {
  id: string
  username: string
  url: string
  acct: string
}

interface MastodonCustomEmoji {
  shortcode: string
  url: string
  static_url: string
  visible_in_picker: boolean
  category: string | null
}

interface MastodonTag {
  name: string
  url: string
}

/**
 * Extract Mastodon mentions from status tags
 */
const getMentionsFromTags = (tags: Tag[]): MastodonMention[] => {
  return tags
    .filter((tag) => tag.type === TagType.enum.mention)
    .map((tag) => {
      // Extract username and acct from mention name
      // tag.name is typically like "@user@domain.com" or "@user"
      const mentionName = tag.name.startsWith('@')
        ? tag.name.slice(1)
        : tag.name
      const parts = mentionName.split('@')
      const username = parts[0]
      const acct = parts.length > 1 ? mentionName : username

      return {
        id: urlToId(tag.value),
        username,
        url: tag.value,
        acct
      }
    })
}

/**
 * Extract Mastodon custom emojis from status tags
 */
const getEmojisFromTags = (tags: Tag[]): MastodonCustomEmoji[] => {
  return tags
    .filter((tag) => tag.type === TagType.enum.emoji)
    .map((tag) => {
      // tag.name is typically like ":emoji:" - remove colons for shortcode
      const shortcode = tag.name.replace(/^:+|:+$/g, '')
      return {
        shortcode,
        url: tag.value,
        static_url: tag.value,
        visible_in_picker: true,
        category: null
      }
    })
}

/**
 * Extract Mastodon hashtags from status tags
 */
const getHashtagsFromTags = (tags: Tag[], host: string): MastodonTag[] => {
  return tags
    .filter((tag) => tag.type === TagType.enum.hashtag)
    .map((tag) => {
      // tag.name is typically like "#hashtag" - remove hash for name
      const name = tag.name.startsWith('#') ? tag.name.slice(1) : tag.name
      return {
        name,
        url: tag.value || `https://${host}/tags/${name}`
      }
    })
}

export const getMastodonStatus = async (
  database: Database,
  status: Status,
  currentActorId?: string
): Promise<Mastodon.Status | null> => {
  const account = await database.getMastodonActorFromId({ id: status.actorId })
  if (!account) {
    return null
  }

  // Get the host from the global config
  const host = getConfig().host

  // Derive visibility from recipients.
  // For Announce (reblog) statuses, prefer the original status's visibility.
  const visibility =
    status.type === StatusType.enum.Announce && status.originalStatus
      ? getVisibility(status.originalStatus.to, status.originalStatus.cc)
      : getVisibility(status.to, status.cc)

  // Get reblogs count for non-Announce statuses
  const reblogsCount =
    status.type !== StatusType.enum.Announce
      ? await database.getStatusReblogsCount({ statusId: status.id })
      : 0

  const baseData = {
    // Identifiers & timestamps
    id: urlToId(status.id),
    created_at: getISOTimeUTC(status.createdAt),
    edited_at: status.updatedAt ? getISOTimeUTC(status.updatedAt) : null,

    // Visibility settings
    sensitive: false,
    spoiler_text: '',
    visibility,
    language: null,

    // URI & URL
    uri: status.id,
    url: status.id,

    // Count metrics
    replies_count: 0,
    reblogs_count: reblogsCount,
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
    const originalReblogsCount = await database.getStatusReblogsCount({
      statusId: status.originalStatus.id
    })

    // For reblogs, use the visibility from the original status
    const originalVisibility = getVisibility(
      status.originalStatus.to,
      status.originalStatus.cc
    )

    return Mastodon.Status.parse({
      ...baseData,
      visibility: originalVisibility,
      reblogs_count: originalReblogsCount,

      in_reply_to_id: null,
      in_reply_to_account_id: null,

      reblog: await getMastodonStatus(
        database,
        status.originalStatus,
        currentActorId
      ),
      media_attachments: []
    })
  }

  const replyStatus = status.reply
    ? await database.getStatus({ statusId: status.reply })
    : null

  // Extract mentions, emojis, and hashtags from tags
  const mentions = getMentionsFromTags(status.tags)
  const emojis = getEmojisFromTags(status.tags)
  const hashtags = getHashtagsFromTags(status.tags, host)

  // Sensitive is true if there's a spoiler_text/summary
  const sensitive = Boolean(status.summary && status.summary.length > 0)

  const mastodonStatus = {
    ...baseData,
    spoiler_text: status.summary ?? '',
    sensitive,
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

    // Plain text source (for editing)
    text: status.text,

    reblog: null,

    // Extracted tag data
    mentions,
    emojis,
    tags: hashtags,

    media_attachments: status.attachments.map((attachment) =>
      getMastodonAttachment(attachment)
    )
  }

  // Create poll data if status is a Poll type
  let pollData = null
  if (status.type === StatusType.enum.Poll) {
    const voted = currentActorId
      ? await database.hasActorVoted({
          statusId: status.id,
          actorId: currentActorId
        })
      : false

    const ownVotes = currentActorId
      ? await database.getActorPollVotes({
          statusId: status.id,
          actorId: currentActorId
        })
      : []

    pollData = Mastodon.Poll.parse({
      id: urlToId(status.id),
      expires_at: getISOTimeUTC(status.endAt),
      expired: Date.now() > status.endAt,
      multiple: status.pollType === 'anyOf',
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
      voted,
      own_votes: ownVotes
    })
  }

  return Mastodon.Status.parse({
    ...mastodonStatus,
    poll: pollData
  })
}
