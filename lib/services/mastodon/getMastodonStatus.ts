import { addQuoteFallbackToContent } from '@/lib/activities/quoteNoteFields'
import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { isConversationMutedForActor } from '@/lib/services/mastodon/conversationMute'
import { getMastodonPreviewCard } from '@/lib/services/mastodon/getMastodonPreviewCard'
import { getEffectiveQuoteApprovalPolicy } from '@/lib/services/quotes/quotePolicy'
import { canActorReadStatus } from '@/lib/services/statusAccess'
import { Mastodon } from '@/lib/types/activitypub'
import { StatusReactionRollup } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { getMastodonAttachment } from '@/lib/types/domain/attachment'
import { FollowStatus } from '@/lib/types/domain/follow'
import {
  QuoteApprovalPolicy,
  Status,
  StatusNote,
  StatusPoll,
  StatusType,
  getOriginalStatus,
  hasStatusBeenEdited
} from '@/lib/types/domain/status'
import { Tag, TagType } from '@/lib/types/domain/tag'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { getVisibility } from '@/lib/utils/getVisibility'
import { logger } from '@/lib/utils/logger'
import { getClientActorId, getClientStatusId } from '@/lib/utils/publicId'
import { toEmojiShortcodeToken } from '@/lib/utils/text/getEmojiTags'
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
// statusId -> its (name, count, me) rollups, in first-reaction order.
type StatusReactionsCache = Map<string, StatusReactionRollup[]>

interface GetMastodonStatusOptions {
  accountCache?: MastodonAccountCache
  replyStatusCache?: ReplyStatusCache
  quotedStatusCache?: QuotedStatusCache
  statusMetricsCache?: StatusMetricsCache
  pollVoteCache?: PollVoteCache
  // Emoji-reaction rollups for the whole page, resolved by getMastodonStatuses
  // in one grouped query. A missing entry falls back to a single per-status
  // lookup (the single-status routes), mirroring statusMetricsCache.
  reactionsCache?: StatusReactionsCache
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
  // Batched accepted-follow state (quoted-author actorId → viewer follows them)
  // for the followers-policy quote_approval.current_user verdict, resolved once
  // per page in getMastodonStatuses so no per-status follow lookup is needed.
  // Mirrors getFollowerStateByActorId in statusRouteAccess. A missing entry
  // falls back to a single per-status follow lookup.
  quoteFollowerStateByActorId?: ReadonlyMap<string, boolean>
  // Mentioned-actor URI → publicId for the whole page, resolved once in
  // getMastodonStatuses. A mention tag carries only the actor URI (no hydrated
  // actor), so this is the only way to emit a mention id without a query per
  // mention. Absent means "not batched": the single-status path resolves its own
  // status's mentions, and a mention with no entry falls back to the legacy
  // colon form (an actor we do not store has no publicId).
  mentionActorPublicIds?: ReadonlyMap<string, string>
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

const getMentionActorIdsFromTags = (tags: Tag[]): string[] =>
  tags
    .filter((tag) => tag.type === TagType.enum.mention && Boolean(tag.value))
    .map((tag) => tag.value)

const getMentionsFromTags = (
  tags: Tag[],
  actorPublicIds?: ReadonlyMap<string, string>
): MastodonMention[] => {
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
        // A mention of an actor we do not store (or a pre-backfill row) has no
        // publicId, so the legacy encoding stays the permanent fallback.
        id: actorPublicIds?.get(tag.value) ?? urlToId(tag.value),
        username,
        url: tag.value,
        acct
      }
    })
}

// The mention publicIds for one status: the page-wide map when
// getMastodonStatuses batched one, otherwise a single lookup for this status's
// own mentions (the single-status routes). Recursion into a reblog original or
// an embedded quote reuses whichever the caller had, so a nested status without
// a batched map resolves its own mentions the same way.
const getMentionActorPublicIds = async (
  database: Database,
  tags: Tag[],
  options?: GetMastodonStatusOptions
): Promise<ReadonlyMap<string, string> | undefined> => {
  if (options?.mentionActorPublicIds) return options.mentionActorPublicIds

  const actorIds = getMentionActorIdsFromTags(tags)
  if (actorIds.length === 0) return undefined
  return database.getActorPublicIds({ actorIds })
}

/**
 * The custom emoji a client is told this status carries.
 *
 * Normalized through the SAME `toEmojiShortcodeToken` the renderer uses, so
 * this list and the `content` beside it agree. Stripping colons here with a
 * local regex instead let the two drift: a stored name the renderer refuses —
 * one containing markup, a space, or nothing at all between its colons — was
 * still advertised here, so a client was handed a shortcode that appears
 * nowhere in the content it came with, and in the markup case was handed
 * attacker-controlled markup in a field it may well substitute into HTML
 * itself. An inbound `Emoji` tag's `name` is stored verbatim, so those are the
 * names that actually arrive.
 */
const getEmojisFromTags = (tags: Tag[]): MastodonCustomEmoji[] => {
  return tags
    .filter((tag) => tag.type === TagType.enum.emoji)
    .flatMap((tag) => {
      const token = toEmojiShortcodeToken(tag.name)
      if (!token) return []
      return [
        {
          // `token` is `:shortcode:`; the API field is the bare shortcode.
          shortcode: token.slice(1, -1),
          url: tag.value,
          static_url: tag.value,
          visible_in_picker: true,
          category: null
        }
      ]
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

// Mentioned actors are referenced by bare URI on the tag, so the whole page's
// mention ids are collected here and resolved to publicIds in one query.
const addStatusMentionActorIds = (status: Status, actorIds: Set<string>) => {
  if (status.type === StatusType.enum.Announce) {
    // Unlike its siblings this also runs over the prefetched quoted statuses,
    // outside the collector's try/catch, so a boost whose original is gone is
    // skipped here rather than thrown.
    if (status.originalStatus) {
      addStatusMentionActorIds(status.originalStatus, actorIds)
    }
    return
  }

  for (const actorId of getMentionActorIdsFromTags(status.tags)) {
    actorIds.add(actorId)
  }
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

// Collect the authors whose followers-policy statuses the viewer might quote, so
// the batched quote_approval verdict can resolve accepted-follow state for the
// whole page in one query. Only followers-policy statuses authored by someone
// other than the viewer need a follow lookup (self / public / nobody are decided
// without one).
const addQuoteFollowerCandidateAuthorId = (
  status: Status,
  currentActorId: string,
  authorIds: Set<string>
) => {
  const target =
    status.type === StatusType.enum.Announce ? status.originalStatus : status
  if (!target || target.type === StatusType.enum.Announce) return
  if (target.actorId === currentActorId) return
  if (getEffectiveQuoteApprovalPolicy(target) === 'followers') {
    authorIds.add(target.actorId)
  }
}

const getQuotedStatus = async (
  database: Database,
  statusId: string,
  currentActorId?: string,
  options?: GetMastodonStatusOptions
) => {
  const quotedStatusCache = options?.quotedStatusCache
  // The batch cache is populated by getStatusesByIds with the viewer, so cached
  // quoted statuses already carry the viewer's action state. The uncached
  // (single-status) path must pass currentActorId itself, otherwise the embedded
  // quoted_status would report favourited/bookmarked/reblogged as false.
  if (!quotedStatusCache)
    return database.getStatus({ statusId, currentActorId })

  if (quotedStatusCache.has(statusId)) {
    return quotedStatusCache.get(statusId) ?? null
  }

  const quotedStatus = await database.getStatus({ statusId, currentActorId })
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

// Whether `viewerActorId` has an accepted follow of `authorId`, sourced from the
// batched map when present (getMastodonStatuses populates it for the whole page)
// and otherwise from a single follow lookup — mirroring canActorReadSingleStatus
// in statusAccess. A merely-requested follow does not count.
const isAcceptedFollowerOf = async (
  database: Database,
  viewerActorId: string,
  authorId: string,
  options?: GetMastodonStatusOptions
): Promise<boolean> => {
  const prefetched = options?.quoteFollowerStateByActorId?.get(authorId)
  if (prefetched !== undefined) return prefetched

  const follow = await database.getAcceptedOrRequestedFollow({
    actorId: viewerActorId,
    targetActorId: authorId
  })
  return follow?.status === FollowStatus.enum.Accepted
}

// Build the `quote_approval` object for a non-Announce status. `current_user` is
// the viewer's standing, matching canQuoteStatus: self / `public` → `automatic`,
// `nobody` → `denied`, and for `followers` → `automatic` iff the viewer is an
// accepted follower of the author, else `denied`. Block relationships (which
// already gate the status's visibility, per canActorReadStatus's block-free hot
// path) are not re-checked here. An anonymous viewer is always `unknown`.
const getQuoteApproval = async (
  database: Database,
  status: StatusNote | StatusPoll,
  currentActorId?: string,
  options?: GetMastodonStatusOptions
) => {
  const policy = getEffectiveQuoteApprovalPolicy(status)
  const automatic = QUOTE_POLICY_AUTOMATIC_AUDIENCE[policy]
  let currentUser: string
  if (!currentActorId) currentUser = 'unknown'
  else if (currentActorId === status.actorId) currentUser = 'automatic'
  else if (policy === 'public') currentUser = 'automatic'
  else if (policy === 'nobody') currentUser = 'denied'
  else {
    const isFollower = await isAcceptedFollowerOf(
      database,
      currentActorId,
      status.actorId,
      options
    )
    currentUser = isFollower ? 'automatic' : 'denied'
  }
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

const EMPTY_REACTIONS: StatusReactionRollup[] = []

// Reads the page-wide rollups the batch path prefetched, and falls back to a
// single lookup for a status the batch did not cover (or the single-status
// routes, which pass no cache at all) — the same contract as
// getStatusReblogsCount. `has` rather than a truthiness check, so a status with
// no reactions resolves from the cache instead of re-querying.
const getStatusReactions = async (
  database: Database,
  statusId: string,
  currentActorId?: string,
  options?: GetMastodonStatusOptions
): Promise<StatusReactionRollup[]> => {
  const cached = options?.reactionsCache
  if (cached?.has(statusId)) return cached.get(statusId) ?? EMPTY_REACTIONS

  return database.getStatusReactionRollups({
    statusIds: [statusId],
    currentActorId
  })
}

const toMastodonReactions = (
  rollups: StatusReactionRollup[]
): Mastodon.StatusReaction[] =>
  rollups.map((rollup) => ({
    name: rollup.name,
    count: rollup.count,
    me: rollup.me,
    url: rollup.url,
    static_url: rollup.staticUrl
  }))

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
    id: getClientStatusId(status),
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
    // An Announce wrapper carries no reactions of its own; the boosted status
    // surfaces them on `reblog`, exactly as it does for the counts above.
    reactions: [],
    pleroma: { emoji_reactions: [] },

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

  const reactions = toMastodonReactions(
    await getStatusReactions(database, status.id, currentActorId, options)
  )
  const mentions = getMentionsFromTags(
    status.tags,
    await getMentionActorPublicIds(database, status.tags, options)
  )
  const emojis = getEmojisFromTags(status.tags)
  const hashtags = getHashtagsFromTags(status.tags, host)

  // Mastodon marks a status sensitive when it was explicitly flagged sensitive
  // OR carries a content warning (spoiler/summary).
  const quoteDepth = options?.quoteDepth ?? 0
  const quoteApproval = await getQuoteApproval(
    database,
    status,
    currentActorId,
    options
  )

  let quote:
    | { state: string; quoted_status: Mastodon.Status | null }
    | { state: string; quoted_status_id: string | null }
    | undefined
  // In the Mastodon client API specification, `content` keeps custom emoji as
  // literal `:shortcode:` tokens within the HTML; clients (e.g. Ivory, Elk)
  // use `status.emojis` to render them natively and strip <img> tags in posts.
  let statusContent = processStatusText(host, status, { convertEmojis: false })
  const edge = status.quote
  if (edge) {
    // Resolve the viewer-relative state and the readable quoted status once, then
    // apply it identically at depth 0 (full Quote) and depth >= 1 (ShallowQuote):
    // only an `accepted` edge whose target exists and is readable resolves a
    // quoted status; a missing target downgrades to `deleted`, an unreadable one
    // to `unauthorized`, and both withhold the target (no embed, no id). This
    // stops a nested quote from leaking a deleted/unreadable status id.
    let effectiveState: string = edge.state
    let readableQuoted: Status | null = null
    if (edge.state === 'accepted') {
      const quotedStatus = await getQuotedStatus(
        database,
        edge.quotedStatusId,
        currentActorId,
        options
      )
      if (!quotedStatus) {
        effectiveState = 'deleted'
      } else {
        const viewer = await getViewerActor(database, currentActorId, options)
        const canRead = await canActorReadStatus({
          database,
          status: quotedStatus,
          currentActor: viewer
        })
        if (!canRead) effectiveState = 'unauthorized'
        else readableQuoted = quotedStatus
      }
    }

    const originalQuoted = readableQuoted
      ? getOriginalStatus(readableQuoted)
      : null
    const fallbackUrl =
      originalQuoted?.url ||
      readableQuoted?.id ||
      edge.quotedStatusUrl ||
      edge.quotedStatusId
    statusContent = addQuoteFallbackToContent(statusContent, edge, fallbackUrl)

    if (quoteDepth >= 1) {
      // ShallowQuote: reference by id only, and only when the downgraded state is
      // still accepted (target exists and is readable). Stops recursion.
      quote = {
        state: effectiveState,
        quoted_status_id: readableQuoted
          ? getClientStatusId(readableQuoted)
          : null
      }
    } else if (!readableQuoted) {
      // Placeholder: no embedded quoted status for non-accepted / deleted /
      // unauthorized states.
      quote = { state: effectiveState, quoted_status: null }
    } else {
      const quotedEntity = await getMastodonStatus(
        database,
        readableQuoted,
        currentActorId,
        { ...options, quoteDepth: 1 }
      )
      quote = quotedEntity
        ? { state: 'accepted', quoted_status: quotedEntity }
        : { state: 'deleted', quoted_status: null }
    }
  }

  const sensitive =
    (status.sensitive ?? false) ||
    Boolean(status.summary && status.summary.length > 0)
  const mastodonStatus = {
    ...baseData,
    spoiler_text: status.summary ?? '',
    sensitive,
    language: status.language ?? null,
    url: status.url,

    in_reply_to_id: replyStatus ? getClientStatusId(replyStatus) : null,
    // The hydrated reply carries its author as an ActorProfile (which holds the
    // publicId); `actorId` is a bare URI, so it can only fall back to the legacy
    // encoding when the author row could not be hydrated.
    in_reply_to_account_id: replyStatus
      ? replyStatus.actor
        ? getClientActorId(replyStatus.actor)
        : urlToId(replyStatus.actorId)
      : null,

    replies_count: repliesCount,

    favourites_count: status.totalLikes || 0,
    favourited: status.isActorLiked ?? false,

    // Both dialects are derived from the same rollups, so they cannot disagree.
    // Reactions are never favourites: they do not feed favourites_count.
    reactions,
    pleroma: { emoji_reactions: reactions },

    reblogged: status.actorAnnounceStatusId !== null,
    content: statusContent,
    application: status.applicationName
      ? {
          name: status.applicationName,
          website: status.applicationWebsite ?? null
        }
      : null,

    text: status.text,

    reblog: null,

    // The link preview card. Only the unwrapped status carries one — an
    // Announce keeps the `card: null` from baseData, the same way
    // media_attachments is forced empty on that branch.
    card: getMastodonPreviewCard(status.linkPreview),

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
      // A poll's id IS its status id, so it flips with the status.
      id: getClientStatusId(status),
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
      emojis,
      voted,
      own_votes: ownVotes
    })
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
  const mentionActorIds = new Set<string>()

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
      addStatusMentionActorIds(status, mentionActorIds)
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
    mutedConversationRootIds,
    reactionRollups
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
      : Promise.resolve<string[]>([]),
    // One grouped query for the whole page — the statuses that carry metrics
    // plus the quoted statuses embedded in them — seeded into reactionsCache
    // below so no status needs a lookup of its own.
    database.getStatusReactionRollups({
      statusIds: [...requestedMetricStatusIds, ...requestedQuoteStatusIds],
      currentActorId
    })
  ])
  // Seed every requested id, including those with no reactions, so a reaction-
  // less status resolves from the cache rather than falling back to a query.
  const reactionsCache: StatusReactionsCache = new Map(
    [...requestedMetricStatusIds, ...requestedQuoteStatusIds].map(
      (statusId) => [statusId, EMPTY_REACTIONS] as const
    )
  )
  for (const rollup of reactionRollups) {
    const existing = reactionsCache.get(rollup.statusId)
    if (existing && existing !== EMPTY_REACTIONS) {
      existing.push(rollup)
      continue
    }
    reactionsCache.set(rollup.statusId, [rollup])
  }
  const requestedActorIdSet = new Set(requestedActorIds)
  const accountCache: MastodonAccountCache = new Map()

  for (const account of accounts) {
    // `uri` is by definition the ActivityPub actor id — the same value the
    // lookup was made with — so it is the only encoding-independent key. `url`
    // is a profile URL (`/@name`) on some actors, and `id` is a publicId that
    // cannot be decoded back to a URI at all; both stay as fallbacks so an
    // account entity built elsewhere still resolves.
    const actorId = [
      account.uri,
      account.url,
      typeof account.id === 'string' ? idToUrl(account.id) : ''
    ].find((candidate) => requestedActorIdSet.has(candidate))
    if (actorId) accountCache.set(actorId, Promise.resolve(account))
  }
  for (const actorId of actorIds) {
    if (!accountCache.has(actorId)) {
      accountCache.set(actorId, Promise.resolve(null))
    }
  }

  // Resolve accepted-follow state once for every followers-policy author on the
  // page (top-level statuses, their reblog originals, and embedded quoted
  // statuses) so the quote_approval.current_user verdict needs no per-status
  // follow lookup. Mirrors getFollowerStateByActorId in statusRouteAccess.
  const quoteFollowerCandidateAuthorIds = new Set<string>()
  if (currentActorId) {
    for (const status of safeStatuses) {
      addQuoteFollowerCandidateAuthorId(
        status,
        currentActorId,
        quoteFollowerCandidateAuthorIds
      )
    }
    for (const quotedStatus of quotedStatuses) {
      addQuoteFollowerCandidateAuthorId(
        quotedStatus,
        currentActorId,
        quoteFollowerCandidateAuthorIds
      )
    }
  }
  const quoteFollowerTargetActorIds = [...quoteFollowerCandidateAuthorIds]
  const acceptedQuoteFollowTargetActorIds =
    currentActorId && quoteFollowerTargetActorIds.length > 0
      ? new Set(
          await database.getAcceptedFollowTargetActorIds({
            actorId: currentActorId,
            targetActorIds: quoteFollowerTargetActorIds
          })
        )
      : new Set<string>()
  const quoteFollowerStateByActorId = new Map(
    quoteFollowerTargetActorIds.map(
      (actorId) =>
        [actorId, acceptedQuoteFollowTargetActorIds.has(actorId)] as const
    )
  )

  // Mention ids for the whole page in one query — the top-level statuses (and
  // their reblog originals) plus the quoted statuses embedded in them, which are
  // only known once the prefetch above resolved.
  for (const quotedStatus of quotedStatuses) {
    addStatusMentionActorIds(quotedStatus, mentionActorIds)
  }
  const mentionActorPublicIds =
    mentionActorIds.size > 0
      ? await database.getActorPublicIds({ actorIds: [...mentionActorIds] })
      : new Map<string, string>()

  const options: GetMastodonStatusOptions = {
    ...inputOptions,
    quoteFollowerStateByActorId,
    pinnedStatusIds:
      inputOptions.pinnedStatusIds ?? new Set<string>(pinnedStatusIds),
    mutedConversationRootIds:
      inputOptions.mutedConversationRootIds ??
      new Set<string>(mutedConversationRootIds),
    conversationRootCache:
      inputOptions.conversationRootCache ?? new Map<string, string>(),
    accountCache,
    mentionActorPublicIds,
    reactionsCache,
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
