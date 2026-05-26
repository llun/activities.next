import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { Mastodon } from '@/lib/types/activitypub'
import { getMastodonAttachment } from '@/lib/types/domain/attachment'
import {
  Status,
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

type MastodonAccountCache = Map<string, Promise<Mastodon.Account | null>>
type ReplyStatusCache = Map<string, Status | null>
type StatusMetricsCache = {
  reblogs: Map<string, number>
  replies: Map<string, number>
}
type PollVoteState = {
  voted: boolean
  ownVotes: number[]
}
type PollVoteCache = Map<string, PollVoteState>

interface GetMastodonStatusOptions {
  accountCache?: MastodonAccountCache
  replyStatusCache?: ReplyStatusCache
  statusMetricsCache?: StatusMetricsCache
  pollVoteCache?: PollVoteCache
  pinnedStatusIds?: Set<string>
}

const getMastodonAccount = (
  database: Database,
  actorId: string,
  options?: GetMastodonStatusOptions
): Promise<Mastodon.Account | null> => {
  if (!options?.accountCache) {
    return database.getMastodonActorFromId({ id: actorId })
  }

  const cachedAccount = options.accountCache.get(actorId)
  if (cachedAccount) {
    return cachedAccount
  }

  const account = database.getMastodonActorFromId({ id: actorId })
  options.accountCache.set(actorId, account)
  return account
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
    return isStatusBookmarked(status.originalStatus)
  }

  return status.isActorBookmarked ?? false
}

const addStatusActorIds = (status: Status, actorIds: Set<string>) => {
  actorIds.add(status.actorId)
  if (status.type === StatusType.enum.Announce) {
    addStatusActorIds(status.originalStatus, actorIds)
  }
}

const addStatusMetricIds = (status: Status, statusIds: Set<string>) => {
  if (status.type === StatusType.enum.Announce) {
    addStatusMetricIds(status.originalStatus, statusIds)
    return
  }

  statusIds.add(status.id)
}

const addStatusReplyIds = (status: Status, statusIds: Set<string>) => {
  if (status.type === StatusType.enum.Announce) {
    addStatusReplyIds(status.originalStatus, statusIds)
    return
  }

  if (status.reply) statusIds.add(status.reply)
}

const addStatusPollIds = (status: Status, statusIds: Set<string>) => {
  if (status.type === StatusType.enum.Announce) {
    addStatusPollIds(status.originalStatus, statusIds)
    return
  }

  if (status.type === StatusType.enum.Poll) statusIds.add(status.id)
}

const isStatusPinnableByActor = (status: Status, currentActorId?: string) => {
  if (!currentActorId) return false
  if (status.type === StatusType.enum.Announce) return false
  if (status.actorId !== currentActorId) return false
  return getVisibility(status.to, status.cc) !== 'direct'
}

const addStatusPinnedLookupIds = (
  status: Status,
  statusIds: Set<string>,
  currentActorId?: string
) => {
  if (status.type === StatusType.enum.Announce) {
    return
  }

  if (isStatusPinnableByActor(status, currentActorId)) statusIds.add(status.id)
}

const isStatusPinned = async (
  database: Database,
  status: Status,
  currentActorId?: string,
  options?: GetMastodonStatusOptions
): Promise<boolean | undefined> => {
  if (!currentActorId) return undefined
  if (!isStatusPinnableByActor(status, currentActorId)) return undefined
  if (options?.pinnedStatusIds) return options.pinnedStatusIds.has(status.id)

  const pinnedStatusIds = await database.getPinnedStatusIds({
    actorId: currentActorId,
    statusIds: [status.id]
  })
  return pinnedStatusIds.includes(status.id)
}

const getReplyStatus = async (
  database: Database,
  statusId: string,
  options?: GetMastodonStatusOptions
) => {
  const replyStatusCache = options?.replyStatusCache
  if (!replyStatusCache) return database.getStatus({ statusId })

  if (replyStatusCache.has(statusId)) {
    return replyStatusCache.get(statusId) ?? null
  }

  const replyStatus = await database.getStatus({ statusId })
  replyStatusCache.set(statusId, replyStatus)
  return replyStatus
}

const getStatusReblogsCount = async (
  database: Database,
  statusId: string,
  options?: GetMastodonStatusOptions
) => {
  const reblogsCache = options?.statusMetricsCache?.reblogs
  if (reblogsCache?.has(statusId)) return reblogsCache.get(statusId) ?? 0

  return database.getStatusReblogsCount({ statusId })
}

const getStatusRepliesCount = async (
  database: Database,
  statusId: string,
  options?: GetMastodonStatusOptions
) => {
  const repliesCache = options?.statusMetricsCache?.replies
  if (repliesCache?.has(statusId)) return repliesCache.get(statusId) ?? 0

  return database.getStatusRepliesCount({ statusId })
}

const getPollVoteState = async (
  database: Database,
  status: StatusPoll,
  currentActorId?: string,
  options?: GetMastodonStatusOptions
): Promise<PollVoteState> => {
  if (!currentActorId) return { voted: false, ownVotes: [] }

  const cachedVoteState = options?.pollVoteCache?.get(status.id)
  if (cachedVoteState) return cachedVoteState

  const [voted, ownVotes] = await Promise.all([
    database.hasActorVoted({
      statusId: status.id,
      actorId: currentActorId
    }),
    database.getActorPollVotes({
      statusId: status.id,
      actorId: currentActorId
    })
  ])
  return { voted, ownVotes }
}

export const getMastodonStatus = async (
  database: Database,
  status: Status,
  currentActorId?: string,
  options?: GetMastodonStatusOptions
): Promise<Mastodon.Status | null> => {
  const account = await getMastodonAccount(database, status.actorId, options)
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
      ? await getStatusReblogsCount(database, status.id, options)
      : 0
  const pinned = await isStatusPinned(database, status, currentActorId, options)

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
    ...(pinned === undefined ? {} : { pinned }),

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
    const originalReblogsCount = await getStatusReblogsCount(
      database,
      status.originalStatus.id,
      options
    )

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
        currentActorId,
        options
      ),
      media_attachments: []
    })
  }

  const replyStatus = status.reply
    ? await getReplyStatus(database, status.reply, options)
    : null
  const repliesCount = await getStatusRepliesCount(database, status.id, options)

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
    const { voted, ownVotes } = await getPollVoteState(
      database,
      status,
      currentActorId,
      options
    )

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
  currentActorId?: string,
  inputOptions: GetMastodonStatusOptions = {}
): Promise<Mastodon.Status[]> => {
  if (statuses.length === 0) return []

  const actorIds = new Set<string>()
  statuses.forEach((status) => addStatusActorIds(status, actorIds))
  const metricStatusIds = new Set<string>()
  statuses.forEach((status) => addStatusMetricIds(status, metricStatusIds))
  const replyStatusIds = new Set<string>()
  statuses.forEach((status) => addStatusReplyIds(status, replyStatusIds))
  const pollStatusIds = new Set<string>()
  statuses.forEach((status) => addStatusPollIds(status, pollStatusIds))
  const pinnedLookupStatusIds = new Set<string>()
  statuses.forEach((status) =>
    addStatusPinnedLookupIds(status, pinnedLookupStatusIds, currentActorId)
  )
  const requestedActorIds = [...actorIds]
  const requestedMetricStatusIds = [...metricStatusIds]
  const requestedReplyStatusIds = [...replyStatusIds]
  const requestedPollStatusIds = currentActorId ? [...pollStatusIds] : []
  const requestedPinnedLookupStatusIds =
    currentActorId && !inputOptions.pinnedStatusIds
      ? [...pinnedLookupStatusIds]
      : []
  const [
    accounts,
    reblogCounts,
    replyCounts,
    replyStatuses,
    pollVotes,
    pinnedStatusIds
  ] = await Promise.all([
    database.getMastodonActorsFromIds({
      ids: requestedActorIds
    }),
    database.getStatusReblogsCounts({
      statusIds: requestedMetricStatusIds
    }),
    database.getStatusRepliesCounts({
      statusIds: requestedMetricStatusIds
    }),
    requestedReplyStatusIds.length > 0
      ? database.getStatusesByIds({
          statusIds: requestedReplyStatusIds,
          currentActorId
        })
      : Promise.resolve([]),
    requestedPollStatusIds.length > 0 && currentActorId
      ? database.getActorPollVotesForStatuses({
          statusIds: requestedPollStatusIds,
          actorId: currentActorId
        })
      : Promise.resolve<Record<string, number[]>>({}),
    requestedPinnedLookupStatusIds.length > 0 && currentActorId
      ? database.getPinnedStatusIds({
          actorId: currentActorId,
          statusIds: requestedPinnedLookupStatusIds
        })
      : Promise.resolve<string[]>([])
  ])
  const requestedActorIdSet = new Set(requestedActorIds)
  const accountCache: MastodonAccountCache = new Map()

  for (const account of accounts) {
    const decodedActorId =
      typeof account.id === 'string' ? idToUrl(account.id) : ''
    if (requestedActorIdSet.has(decodedActorId)) {
      accountCache.set(decodedActorId, Promise.resolve(account))
      continue
    }

    if (requestedActorIdSet.has(account.url)) {
      accountCache.set(account.url, Promise.resolve(account))
    }
  }
  for (const actorId of actorIds) {
    if (!accountCache.has(actorId)) {
      accountCache.set(actorId, Promise.resolve(null))
    }
  }

  const options: GetMastodonStatusOptions = {
    ...inputOptions,
    pinnedStatusIds:
      inputOptions.pinnedStatusIds ?? new Set<string>(pinnedStatusIds),
    accountCache,
    statusMetricsCache: {
      reblogs: new Map(
        requestedMetricStatusIds.map((statusId) => [
          statusId,
          reblogCounts[statusId] ?? 0
        ])
      ),
      replies: new Map(
        requestedMetricStatusIds.map((statusId) => [
          statusId,
          replyCounts[statusId] ?? 0
        ])
      )
    },
    replyStatusCache: new Map(
      requestedReplyStatusIds.map((statusId) => [statusId, null])
    ),
    pollVoteCache: new Map(
      requestedPollStatusIds.map((statusId) => {
        const ownVotes = pollVotes[statusId] ?? []
        return [
          statusId,
          {
            voted: ownVotes.length > 0,
            ownVotes
          }
        ]
      })
    )
  }
  for (const replyStatus of replyStatuses) {
    options.replyStatusCache?.set(replyStatus.id, replyStatus)
  }

  return (
    await Promise.all(
      statuses.map((status) =>
        getMastodonStatus(database, status, currentActorId, options)
      )
    )
  ).filter((status): status is Mastodon.Status => status !== null)
}
