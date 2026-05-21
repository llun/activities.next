import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { Mastodon } from '@/lib/types/activitypub'
import { getMastodonAttachment } from '@/lib/types/domain/attachment'
import {
  Status,
  StatusNote,
  StatusPoll,
  StatusType,
  hasStatusBeenEdited
} from '@/lib/types/domain/status'
import { Tag, TagType } from '@/lib/types/domain/tag'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { getVisibility } from '@/lib/utils/getVisibility'
import { processStatusText } from '@/lib/utils/text/processStatusText'
import { idToUrl, urlToId } from '@/lib/utils/urlToId'

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

type MastodonStatusHydrationContext = {
  accountByActorId: Map<string, Mastodon.Account>
  replyStatusById: Map<string, Status>
  reblogCountByStatusId: Map<string, number>
  replyCountByStatusId: Map<string, number>
}

const MAX_RELATED_STATUS_DEPTH = 10

const collectRelatedStatuses = (status: Status, statuses: Status[] = []) => {
  const seen = new Set<string>()
  let currentStatus: Status | null = status
  let depth = 0

  while (currentStatus && !seen.has(currentStatus.id)) {
    statuses.push(currentStatus)
    seen.add(currentStatus.id)

    if (
      currentStatus.type !== StatusType.enum.Announce ||
      depth >= MAX_RELATED_STATUS_DEPTH
    ) {
      break
    }

    currentStatus = currentStatus.originalStatus
    depth += 1
  }

  return statuses
}

const getReblogTargetStatus = (
  status: Status
): StatusNote | StatusPoll | null => {
  let currentStatus: Status = status
  const seen = new Set<string>()
  let depth = 0

  while (currentStatus.type === StatusType.enum.Announce) {
    if (seen.has(currentStatus.id) || depth >= MAX_RELATED_STATUS_DEPTH) {
      return null
    }

    seen.add(currentStatus.id)
    currentStatus = currentStatus.originalStatus
    depth += 1
  }

  if (
    currentStatus.type === StatusType.enum.Note ||
    currentStatus.type === StatusType.enum.Poll
  ) {
    return currentStatus
  }

  return null
}

const getMentionsFromTags = (tags: Tag[]): MastodonMention[] => {
  return tags
    .filter((tag) => tag.type === TagType.enum.mention)
    .map((tag) => {
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

const getEmojisFromTags = (tags: Tag[]): MastodonCustomEmoji[] => {
  return tags
    .filter((tag) => tag.type === TagType.enum.emoji)
    .map((tag) => {
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

const getHashtagsFromTags = (tags: Tag[], host: string): MastodonTag[] => {
  return tags
    .filter((tag) => tag.type === TagType.enum.hashtag)
    .map((tag) => {
      const name = tag.name.startsWith('#') ? tag.name.slice(1) : tag.name
      return {
        name,
        url: tag.value || `https://${host}/tags/${name}`
      }
    })
}

const isStatusBookmarked = (status: Status): boolean => {
  if (status.type === StatusType.enum.Announce) {
    return getReblogTargetStatus(status)?.isActorBookmarked ?? false
  }

  return status.isActorBookmarked ?? false
}

const getAccountByActorId = (
  accounts: Mastodon.Account[],
  actorIds: string[]
) => {
  const requestedActorIds = new Set(actorIds)
  const accountByActorId = new Map<string, Mastodon.Account>()

  for (const account of accounts) {
    const decodedActorId =
      typeof account.id === 'string' ? idToUrl(account.id) : ''

    if (requestedActorIds.has(decodedActorId)) {
      accountByActorId.set(decodedActorId, account)
      continue
    }

    if (requestedActorIds.has(account.url)) {
      accountByActorId.set(account.url, account)
    }
  }

  if (accounts.length === actorIds.length) {
    accounts.forEach((account, index) => {
      if (!accountByActorId.has(actorIds[index])) {
        accountByActorId.set(actorIds[index], account)
      }
    })
  }

  return accountByActorId
}

const getMastodonStatusFromContext = async (
  database: Database,
  status: Status,
  context: MastodonStatusHydrationContext,
  currentActorId?: string
): Promise<Mastodon.Status | null> => {
  const account = context.accountByActorId.get(status.actorId)
  if (!account) {
    return null
  }

  const host = getConfig().host

  const visibility =
    status.type === StatusType.enum.Announce && status.originalStatus
      ? getVisibility(status.originalStatus.to, status.originalStatus.cc)
      : getVisibility(status.to, status.cc)

  const reblogsCount =
    status.type !== StatusType.enum.Announce
      ? (context.reblogCountByStatusId.get(status.id) ?? status.totalShares)
      : 0

  const baseData = {
    id: urlToId(status.id),
    created_at: getISOTimeUTC(status.createdAt),
    edited_at:
      status.type !== StatusType.enum.Announce && hasStatusBeenEdited(status)
        ? getISOTimeUTC(status.updatedAt)
        : null,

    sensitive: false,
    spoiler_text: '',
    visibility,
    language: null,

    uri: status.id,
    url: status.id,

    replies_count: 0,
    reblogs_count: reblogsCount,
    favourites_count: 0,

    favourited: false,
    reblogged: false,
    muted: false,
    bookmarked: isStatusBookmarked(status),

    content: '',
    text: null,
    account,

    mentions: [],
    tags: [],
    emojis: [],
    card: null,
    poll: null
  }

  if (status.type === StatusType.enum.Announce) {
    const reblogTarget = getReblogTargetStatus(status)
    const originalReblogsCount = reblogTarget
      ? (context.reblogCountByStatusId.get(reblogTarget.id) ??
        reblogTarget.totalShares)
      : 0

    const originalVisibility = reblogTarget
      ? getVisibility(reblogTarget.to, reblogTarget.cc)
      : visibility

    return Mastodon.Status.parse({
      ...baseData,
      visibility: originalVisibility,
      reblogs_count: originalReblogsCount,

      in_reply_to_id: null,
      in_reply_to_account_id: null,

      reblog: reblogTarget
        ? await getMastodonStatusFromContext(
            database,
            reblogTarget,
            context,
            currentActorId
          )
        : null,
      media_attachments: []
    })
  }

  const replyStatus = status.reply
    ? context.replyStatusById.get(status.reply)
    : null
  const repliesCount = context.replyCountByStatusId.get(status.id) ?? 0

  const mentions = getMentionsFromTags(status.tags)
  const emojis = getEmojisFromTags(status.tags)
  const hashtags = getHashtagsFromTags(status.tags, host)

  const sensitive = Boolean(status.summary && status.summary.length > 0)
  const mastodonStatus = {
    ...baseData,
    spoiler_text: status.summary ?? '',
    sensitive,
    url: status.url,

    in_reply_to_id: replyStatus ? urlToId(replyStatus.id) : null,
    in_reply_to_account_id: replyStatus ? urlToId(replyStatus.actorId) : null,

    replies_count: repliesCount,

    favourites_count: status.totalLikes || 0,
    favourited: status.isActorLiked ?? false,

    reblogged: status.actorAnnounceStatusId !== null,
    content: processStatusText(host, status),

    text: status.text,

    reblog: null,

    mentions,
    emojis,
    tags: hashtags,

    media_attachments: status.attachments.map((attachment) =>
      getMastodonAttachment(attachment)
    )
  }

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

export const getMastodonStatuses = async (
  database: Database,
  statuses: Status[],
  currentActorId?: string
): Promise<Mastodon.Status[]> => {
  if (statuses.length === 0) return []

  const relatedStatuses = statuses.flatMap((status) =>
    collectRelatedStatuses(status)
  )
  const actorIds = [...new Set(relatedStatuses.map((status) => status.actorId))]
  const statusIds = [
    ...new Set(
      relatedStatuses.flatMap((status) =>
        status.type === StatusType.enum.Announce ? [] : [status.id]
      )
    )
  ]
  const replyIds = [
    ...new Set(
      relatedStatuses.flatMap((status) =>
        status.type === StatusType.enum.Announce || !status.reply
          ? []
          : [status.reply]
      )
    )
  ]

  const [accounts, replyStatuses, reblogCounts, replyCounts] =
    await Promise.all([
      database.getMastodonActorsFromIds({ ids: actorIds }),
      database.getStatusesByIds({ statusIds: replyIds }),
      database.getStatusReblogsCounts({ statusIds }),
      database.getStatusRepliesCounts({ statusIds })
    ])
  const accountByActorId = getAccountByActorId(accounts, actorIds)
  const replyStatusById = new Map(
    replyStatuses.map((replyStatus) => [replyStatus.id, replyStatus])
  )
  const reblogCountByStatusId = new Map(Object.entries(reblogCounts))
  const replyCountByStatusId = new Map(Object.entries(replyCounts))
  const context = {
    accountByActorId,
    replyStatusById,
    reblogCountByStatusId,
    replyCountByStatusId
  }
  const mastodonStatuses = await Promise.all(
    statuses.map((status) =>
      getMastodonStatusFromContext(database, status, context, currentActorId)
    )
  )
  return mastodonStatuses.filter(
    (status): status is Mastodon.Status => status !== null
  )
}

export const getMastodonStatus = async (
  database: Database,
  status: Status,
  currentActorId?: string
): Promise<Mastodon.Status | null> => {
  const statuses = await getMastodonStatuses(database, [status], currentActorId)
  return statuses[0] ?? null
}
