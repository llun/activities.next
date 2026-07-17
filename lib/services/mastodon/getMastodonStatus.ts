import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { isConversationMutedForActor } from '@/lib/services/mastodon/conversationMute'
import { canActorReadStatus } from '@/lib/services/statusAccess'
import { Mastodon } from '@/lib/types/activitypub'
import { Actor } from '@/lib/types/domain/actor'
import { getMastodonAttachment } from '@/lib/types/domain/attachment'
import {
  QuoteApprovalPolicy,
  Status,
  StatusNote,
  StatusPoll,
  StatusType,
  hasStatusBeenEdited
} from '@/lib/types/domain/status'
import { Tag, TagType } from '@/lib/types/domain/tag'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { getVisibility } from '@/lib/utils/getVisibility'
import { logger } from '@/lib/utils/logger'
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
type QuotedStatusCache = Map<string, Status | null>
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
  quotedStatusCache?: QuotedStatusCache
  statusMetricsCache?: StatusMetricsCache
  pollVoteCache?: PollVoteCache
  // Depth of quote nesting: 0 emits a full Quote (embedding the quoted status),
  // >= 1 emits a ShallowQuote (id only) and does not recurse further.
  quoteDepth?: number
  // The signed-in viewer as a domain Actor (or null for anonymous), resolved
  // once per batch so quote visibility checks don't re-fetch it per status.
  // `undefined` means "not resolved yet"; a per-status call resolves it lazily.
  viewerActor?: Actor | null
  pinnedStatusIds?: Set<string>
  // The set of thread-root status ids whose conversations the current actor has
  // muted. An empty set means "no mutes", letting per-status checks short-circuit.
  mutedConversationRootIds?: Set<string>
  // Memoizes thread-root resolution (statusId → rootId) across a batch render so
  // a thread's shared ancestors are walked once rather than once per status.
  conversationRootCache?: Map<string, string>
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

// Collect the ids of quoted statuses that will be embedded (only `accepted`
// edges at depth 0 render the full quoted status), mirroring addStatusReplyIds.
const addStatusQuoteIds = (status: Status, statusIds: Set<string>) => {
  if (status.type === StatusType.enum.Announce) {
    addStatusQuoteIds(status.originalStatus, statusIds)
    return
  }
  if (status.quote?.state === 'accepted' && status.quote.quotedStatusId) {
    statusIds.add(status.quote.quotedStatusId)
  }
}

const getQuotedStatus = async (
  database: Database,
  statusId: string,
  options?: GetMastodonStatusOptions
) => {
  const quotedStatusCache = options?.quotedStatusCache
  if (!quotedStatusCache) return database.getStatus({ statusId })

  if (quotedStatusCache.has(statusId)) {
    return quotedStatusCache.get(statusId) ?? null
  }

  const quotedStatus = await database.getStatus({ statusId })
  quotedStatusCache.set(statusId, quotedStatus)
  return quotedStatus
}

// Resolve the viewer as a domain Actor for quote visibility checks. Uses the
// batch-resolved value when present; otherwise fetches once (single-status path).
const getViewerActor = async (
  database: Database,
  currentActorId?: string,
  options?: GetMastodonStatusOptions
): Promise<Actor | null> => {
  if (!currentActorId) return null
  if (options && options.viewerActor !== undefined) return options.viewerActor
  return (await database.getActorFromId({ id: currentActorId })) ?? null
}

// Approved audiences per policy. Manual approval queues are not modelled in v1,
// so `manual` is always empty.
const QUOTE_POLICY_AUTOMATIC_AUDIENCE: Record<QuoteApprovalPolicy, string[]> = {
  public: ['public'],
  followers: ['followers'],
  nobody: []
}

// Build the `quote_approval` object for a non-Announce status. `current_user`
// is the viewer's standing; the follower-relationship refinement for the
// `followers` policy lands with canQuoteStatus in a later PR, so an
// unauthenticated or follower viewer sees `unknown` there.
const getQuoteApproval = (
  status: StatusNote | StatusPoll,
  currentActorId?: string
) => {
  const policy: QuoteApprovalPolicy = status.quoteApprovalPolicy ?? 'public'
  const automatic = QUOTE_POLICY_AUTOMATIC_AUDIENCE[policy]
  let currentUser: string
  if (!currentActorId) currentUser = 'unknown'
  else if (currentActorId === status.actorId) currentUser = 'automatic'
  else if (policy === 'public') currentUser = 'automatic'
  else if (policy === 'nobody') currentUser = 'denied'
  else currentUser = 'unknown'
  return { automatic, manual: [] as string[], current_user: currentUser }
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
  const muted = await isConversationMutedForActor(
    database,
    status,
    currentActorId,
    options?.mutedConversationRootIds,
    options?.conversationRootCache
  )

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
    muted,
    bookmarked: isStatusBookmarked(status),
    ...(pinned === undefined ? {} : { pinned }),

    content: '',
    text: null,
    account,
    application: null,

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

  // Mastodon marks a status sensitive when it was explicitly flagged sensitive
  // OR carries a content warning (spoiler/summary).
  const sensitive =
    (status.sensitive ?? false) ||
    Boolean(status.summary && status.summary.length > 0)
  const mastodonStatus = {
    ...baseData,
    spoiler_text: status.summary ?? '',
    sensitive,
    language: status.language ?? null,
    url: status.url,

    in_reply_to_id: replyStatus ? urlToId(replyStatus.id) : null,
    in_reply_to_account_id: replyStatus ? urlToId(replyStatus.actorId) : null,

    replies_count: repliesCount,

    favourites_count: status.totalLikes || 0,
    favourited: status.isActorLiked ?? false,

    reblogged: status.actorAnnounceStatusId !== null,
    content: processStatusText(host, status),
    application: status.applicationName
      ? {
          name: status.applicationName,
          website: status.applicationWebsite ?? null
        }
      : null,

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

    // Mastodon's Poll#show_totals_now?: a hide_totals poll keeps per-option
    // tallies hidden (null) until it expires; the top-level votes_count and
    // voters_count stay numeric per the Poll entity spec.
    const showTotals =
      !(status.hideTotals ?? false) || Date.now() > status.endAt

    pollData = Mastodon.Poll.parse({
      id: urlToId(status.id),
      expires_at: getISOTimeUTC(status.endAt),
      expired: Date.now() > status.endAt,
      multiple: status.pollType === 'anyOf',
      votes_count: status.choices.reduce(
        (sum, choice) => sum + choice.totalVotes,
        0
      ),
      voters_count: status.votersCount ?? 0,
      options: status.choices.map((choice) => ({
        title: choice.title,
        votes_count: showTotals ? choice.totalVotes : null
      })),
      emojis: [],
      voted,
      own_votes: ownVotes
    })
  }

  const quoteDepth = options?.quoteDepth ?? 0
  const quoteApproval = getQuoteApproval(status, currentActorId)

  let quote:
    | { state: string; quoted_status: Mastodon.Status | null }
    | { state: string; quoted_status_id: string | null }
    | undefined
  const edge = status.quote
  if (edge) {
    if (quoteDepth >= 1) {
      // Depth >= 1: reference by id only and stop recursing (ShallowQuote). Only
      // an accepted edge exposes the quoted id, matching the depth-0 contract
      // where non-accepted states withhold the quoted status.
      quote = {
        state: edge.state,
        quoted_status_id:
          edge.state === 'accepted' ? urlToId(edge.quotedStatusId) : null
      }
    } else if (edge.state !== 'accepted') {
      // Only `accepted` embeds the quoted status; other states show a
      // placeholder with no quoted status.
      quote = { state: edge.state, quoted_status: null }
    } else {
      const quotedStatus = await getQuotedStatus(
        database,
        edge.quotedStatusId,
        options
      )
      if (!quotedStatus) {
        // The quoted status is gone: downgrade to `deleted`.
        quote = { state: 'deleted', quoted_status: null }
      } else {
        const viewer = await getViewerActor(database, currentActorId, options)
        const canRead = await canActorReadStatus({
          database,
          status: quotedStatus,
          currentActor: viewer
        })
        if (!canRead) {
          // The viewer cannot read the quoted status: downgrade to
          // `unauthorized` and withhold the quoted status.
          quote = { state: 'unauthorized', quoted_status: null }
        } else {
          const quotedEntity = await getMastodonStatus(
            database,
            quotedStatus,
            currentActorId,
            { ...options, quoteDepth: 1 }
          )
          quote = quotedEntity
            ? { state: 'accepted', quoted_status: quotedEntity }
            : { state: 'deleted', quoted_status: null }
        }
      }
    }
  }

  return Mastodon.Status.parse({
    ...mastodonStatus,
    poll: pollData,
    quote_approval: quoteApproval,
    ...(quote ? { quote } : {})
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
  const metricStatusIds = new Set<string>()
  const replyStatusIds = new Set<string>()
  const pollStatusIds = new Set<string>()
  const pinnedLookupStatusIds = new Set<string>()
  const quoteStatusIds = new Set<string>()

  // Collect lookup ids per status, dropping any whose shape throws here (for
  // example a reblog whose original was deleted, leaving a null originalStatus).
  // A single un-hydratable row must be skipped, never fatal, so one bad page
  // entry can't 500 the whole timeline request.
  const safeStatuses: Status[] = []
  for (const status of statuses) {
    try {
      addStatusActorIds(status, actorIds)
      addStatusMetricIds(status, metricStatusIds)
      addStatusReplyIds(status, replyStatusIds)
      addStatusPollIds(status, pollStatusIds)
      addStatusPinnedLookupIds(status, pinnedLookupStatusIds, currentActorId)
      addStatusQuoteIds(status, quoteStatusIds)
      safeStatuses.push(status)
    } catch (error) {
      logger.warn({
        message:
          'Skipping un-hydratable status while collecting timeline lookup ids',
        statusId: (status as { id?: string } | null)?.id,
        error:
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error)
      })
    }
  }
  if (safeStatuses.length === 0) return []
  const requestedActorIds = [...actorIds]
  const requestedMetricStatusIds = [...metricStatusIds]
  const requestedReplyStatusIds = [...replyStatusIds]
  const requestedQuoteStatusIds = [...quoteStatusIds]
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
    quotedStatuses,
    viewerActor,
    pollVotes,
    pinnedStatusIds,
    mutedConversationRootIds
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
    // Prefetch quoted statuses regardless of visibility (no visibleToActorId):
    // the per-status downgrade distinguishes "missing" (deleted) from
    // "present but unreadable" (unauthorized).
    requestedQuoteStatusIds.length > 0
      ? database.getStatusesByIds({
          statusIds: requestedQuoteStatusIds,
          currentActorId
        })
      : Promise.resolve([]),
    // The viewer as a domain Actor, resolved once for quote visibility checks.
    currentActorId
      ? database.getActorFromId({ id: currentActorId })
      : Promise.resolve(null),
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
      : Promise.resolve<string[]>([]),
    currentActorId
      ? database.getActorMutedConversationRootIds({ actorId: currentActorId })
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
    mutedConversationRootIds:
      inputOptions.mutedConversationRootIds ??
      new Set<string>(mutedConversationRootIds),
    conversationRootCache:
      inputOptions.conversationRootCache ?? new Map<string, string>(),
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
    quotedStatusCache: new Map(
      requestedQuoteStatusIds.map((statusId) => [statusId, null])
    ),
    viewerActor: viewerActor ?? null,
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
  for (const quotedStatus of quotedStatuses) {
    options.quotedStatusCache?.set(quotedStatus.id, quotedStatus)
  }

  return (
    await Promise.all(
      safeStatuses.map(async (status) => {
        try {
          return await getMastodonStatus(
            database,
            status,
            currentActorId,
            options
          )
        } catch (error) {
          // Hydration of a single status can still throw on malformed data (a
          // poll/attachment with bad shape, etc.). Skip and log it rather than
          // failing the entire page.
          logger.warn({
            message:
              'Skipping un-hydratable status during Mastodon serialization',
            statusId: (status as { id?: string } | null)?.id,
            error:
              error instanceof Error
                ? (error.stack ?? error.message)
                : String(error)
          })
          return null
        }
      })
    )
  ).filter((status): status is Mastodon.Status => status !== null)
}
