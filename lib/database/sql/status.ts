import { Knex } from 'knex'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { parseElevationSeries } from '@/lib/database/domains/fitnessFile/rows'
import { createQueueJob } from '@/lib/database/domains/queueJob/queries'
import { searchQueries } from '@/lib/database/domains/search/queries'
import {
  getHashtagStorageNames,
  normalizeHashtagSearchName
} from '@/lib/database/domains/search/rows'
import { deleteStatusSearchDocumentsByStatusIds } from '@/lib/database/domains/search/statuses'
import { getTags } from '@/lib/database/domains/status/hashtags'
import { getActorAnnouncedStatusId } from '@/lib/database/domains/status/lookups'
import {
  getActorPollVotes,
  hasActorVoted
} from '@/lib/database/domains/status/polls'
import {
  getOriginalStatusIdFromAnnounceContent,
  getStatusActorProfile
} from '@/lib/database/domains/status/rows'
import type {
  StatusHydration,
  StatusLookupDatabase,
  StatusWriteDatabase
} from '@/lib/database/domains/status/types'
import { kyselyFor } from '@/lib/database/kysely'
import { coercePollEndAt } from '@/lib/database/sql/utils/coercePollEndAt'
import {
  CounterKey,
  decreaseCounterValue,
  deleteCounterValues,
  getCounterValue,
  getCounterValues
} from '@/lib/database/sql/utils/counter'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  chunkArray,
  deleteRowsByColumnChunks,
  getWhereInBatchSize
} from '@/lib/database/sql/utils/knex'
import {
  announceOriginalPointer,
  wherePubliclyReadableStatus
} from '@/lib/database/sql/utils/publiclyReadableStatus'
import {
  StatusHashtagTagRow,
  selectHashtagTagsByStatusIds,
  selectPubliclyAddressedStatusIds
} from '@/lib/database/sql/utils/status'
import {
  PUBLIC_ACTIVITY_RECIPIENTS,
  applyPotentiallyReadableStatusFilter as applyPotentiallyReadableStatusVisibilityFilter
} from '@/lib/database/sql/utils/statusVisibility'
import { isFitnessProcessingStuck } from '@/lib/services/fitness-files/processingState'
import { getStatusEditTransitions } from '@/lib/services/statuses/statusEditChanges'
import { SQLFitnessFile } from '@/lib/types/database/fitnessFile'
import { ActorDatabase } from '@/lib/types/database/operations'
import { BookmarkDatabase } from '@/lib/types/database/operations'
import { LikeDatabase } from '@/lib/types/database/operations'
import {
  LinkPreviewDatabase,
  LinkPreviewRecord
} from '@/lib/types/database/operations'
import { MediaDatabase } from '@/lib/types/database/operations'
import {
  DeleteStatusParams,
  DeleteStatusWithQueueJobParams,
  GetActorStatusesCountParams,
  GetActorStatusesParams,
  GetStatusCountsParams,
  GetStatusEditHistoryParams,
  GetStatusParams,
  GetStatusReblogsCountParams,
  GetStatusRepliesCountParams,
  GetStatusRepliesParams,
  GetStatusesByIdsParams,
  StatusDatabase,
  StatusDetectedLanguageDatabase,
  StatusEditRevision,
  StatusReactionDatabase
} from '@/lib/types/database/operations'
import { Attachment } from '@/lib/types/domain/attachment'
import { PollChoice } from '@/lib/types/domain/pollChoice'
import {
  QuoteState,
  Status,
  StatusAnnounce,
  StatusLinkPreview,
  StatusNote,
  StatusPoll,
  StatusQuote,
  StatusType
} from '@/lib/types/domain/status'
import { StatusReaction } from '@/lib/types/mastodon/statusReaction'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { getAttachmentMediaPath } from '@/lib/utils/getAttachmentMediaPath'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

import { getCompatibleJSON } from './utils/getCompatibleJSON'

const MAX_ANNOUNCE_RESOLUTION_DEPTH = 10
// Counts breadth-first reply levels from the deleted root, not total replies.
// This bounds transaction size while still allowing wide conversation cleanup.
const MAX_STATUS_REPLY_DELETE_DEPTH = 100

type StatusDeletionRow = {
  id: string
  actorId: string
  type: StatusType
  reply: string | null
  content: unknown
  originalStatusId: string | null
}

const statusReplyDeletionDepthError = (statusId: string) =>
  new Error(`Status reply deletion depth limit exceeded for status ${statusId}`)

const publicRecipientStatusIds = (database: Knex) =>
  database('recipients')
    .select('statusId')
    .whereIn('recipients.actorId', PUBLIC_ACTIVITY_RECIPIENTS)

type StatusHydrationContext = {
  bookmarkedStatusIds?: Set<string>
  likedStatusIds?: Set<string>
  // originalStatusId -> the viewer's own Announce id for it. Only the id is
  // ever consumed, so this batches what would otherwise be a per-status lookup
  // that fully hydrates an Announce just to read `.id` off it.
  announcedStatusIds?: Map<string, string>
  // Pre-batched content-detected languages, keyed by statusId. Viewer-
  // independent (unlike the like/bookmark sets above), so callers populate it
  // for any timeline page regardless of whether a viewer is signed in.
  detectedLanguages?: Record<string, string>
  // Pre-batched quote edges, keyed by the quoting statusId. Viewer-independent;
  // the viewer-relative downgrades happen later in the Mastodon serializer.
  quoteEdges?: Map<string, StatusQuote>
  // Pre-batched link preview cards, keyed by statusId. Viewer-independent, and
  // populated for every fetch for the same reason quote edges are: without it
  // each status in a page falls back to its own lookup.
  linkPreviews?: Map<string, StatusLinkPreview>
  // Pre-batched emoji-reaction rollups, keyed by statusId. Viewer-RELATIVE (the
  // `me` flag), so it is only populated once per page and reused rather than
  // re-queried per status. An absent entry means "the batch did not cover this
  // status", which falls back to a single lookup.
  reactionRollups?: Map<string, StatusReaction[]>
}

// The Kysely twin is publiclyReadableStatusIds
// (lib/database/kysely/visibility/publiclyReadable.ts), which getRebloggedBy
// uses; publiclyReadableStatusEquivalence.test.ts runs both over the same rows.
export const buildPubliclyReadableStatusIdsQuery = ({
  database,
  targetStatusIds
}: {
  database: Knex
  targetStatusIds: Knex.QueryBuilder
}) => {
  const clientName = String(database.client.config.client)
  const targetStatusIdsQuery = targetStatusIds.clone().as('target_status_ids')

  if (clientName.includes('mysql')) {
    return database
      .select('target_statuses.id')
      .from(targetStatusIdsQuery)
      .innerJoin(
        'statuses as target_statuses',
        'target_statuses.id',
        'target_status_ids.id'
      )
      .whereIn('target_statuses.id', publicRecipientStatusIds(database))
      .where((qb) => {
        qb.whereNot(
          'target_statuses.type',
          StatusType.enum.Announce
        ).orWhereExists(function () {
          this.select(database.raw('1'))
            .from('statuses as original_statuses')
            .where(
              'original_statuses.id',
              announceOriginalPointer(database, 'target_statuses')
            )
            // One hop only: a boosted boost is rejected here rather than
            // followed, so MySQL answers "not publicly readable" where the
            // recursive branch below walks the chain and answers "yes". The
            // gap predates the shared pointer and MySQL has no CI coverage,
            // so nothing will tell you if it ever matters.
            .whereNot('original_statuses.type', StatusType.enum.Announce)
            .whereIn('original_statuses.id', publicRecipientStatusIds(database))
        })
      })
  }

  return database
    .withRecursive(
      'publicly_readable_statuses',
      ['targetId', 'id', 'type', 'originalPointer'],
      (cte) => {
        cte
          .select(
            'target_statuses.id as targetId',
            'target_statuses.id',
            'target_statuses.type',
            announceOriginalPointer(database, 'target_statuses')
          )
          .from(targetStatusIdsQuery)
          .innerJoin(
            'statuses as target_statuses',
            'target_statuses.id',
            'target_status_ids.id'
          )
          .whereIn('target_statuses.id', publicRecipientStatusIds(database))
          .union((qb) => {
            qb.select(
              'readable_statuses.targetId',
              'original_statuses.id',
              'original_statuses.type',
              announceOriginalPointer(database, 'original_statuses')
            )
              .from('statuses as original_statuses')
              .innerJoin(
                'publicly_readable_statuses as readable_statuses',
                'readable_statuses.originalPointer',
                'original_statuses.id'
              )
              .where('readable_statuses.type', StatusType.enum.Announce)
              .whereIn(
                'original_statuses.id',
                publicRecipientStatusIds(database)
              )
          })
      }
    )
    .select('targetId as id')
    .from('publicly_readable_statuses')
    .whereNot('type', StatusType.enum.Announce)
}

// The set of one actor's status ids a given audience may be shown, as a
// subquery to filter against. `getActorStatuses` filters `statuses.id` by it;
// `getAttachmentsForActor` filters `attachments.statusId` by the same set (its
// Kysely twin actorVisibleStatusIds in
// lib/database/kysely/visibility/actorVisible.ts, which
// actorVisibleEquivalence.test.ts holds to the same ids; change both
// together), so a followers-only post's images are withheld from exactly the
// viewers the post itself is withheld from.
//
// Returns `null` for "no filter", which is a real audience rather than a
// missing one — the owner viewing their own timeline, and the complete history
// export in `scripts/backup/actorArchive.ts`. Callers must therefore decide the
// audience deliberately; `resolveActorStatusesAudience` in
// `@/lib/services/statusAccess` is how request paths do that.
export const buildActorVisibleStatusIdsQuery = ({
  database,
  actorId,
  publicOnly = false,
  visibleToActorId,
  includeFollowersOnly = false,
  followersAudience
}: {
  database: Knex
  actorId: string
  publicOnly?: boolean
  visibleToActorId?: string | null
  includeFollowersOnly?: boolean
  followersAudience?: string | null
}): Knex.QueryBuilder | null => {
  if (!publicOnly && !visibleToActorId && !includeFollowersOnly) return null

  if (publicOnly) {
    return buildPubliclyReadableStatusIdsQuery({
      database,
      targetStatusIds: database('statuses')
        .select('statuses.id')
        .where('actorId', actorId)
    })
  }

  const recipientActorIds = [...PUBLIC_ACTIVITY_RECIPIENTS]
  if (includeFollowersOnly) {
    recipientActorIds.push(
      ...[followersAudience, `${actorId}/followers`].filter(
        (audience): audience is string => Boolean(audience)
      )
    )
  }
  if (visibleToActorId) {
    recipientActorIds.push(visibleToActorId)
  }

  return database('recipients')
    .select('statusId')
    .whereIn('recipients.actorId', [...new Set(recipientActorIds)])
}

// The status methods still on Knex (hydration, the actor and reply feeds, the
// counts, the edit history reads and deletion), plus the row hydration the
// Kysely status queries (lib/database/domains/status/queries.ts) read through.
// getSQLDatabase spreads the methods into the facade beside the Kysely ones
// and hands hydrateStatusRow to those queries only.
export type StatusKnexDatabase = Omit<
  StatusDatabase,
  keyof StatusLookupDatabase | keyof StatusWriteDatabase
> &
  Pick<StatusHydration, 'hydrateStatusRow'>

export const StatusSQLDatabaseMixin = (
  database: Knex,
  actorDatabase: ActorDatabase,
  likeDatabase: LikeDatabase,
  bookmarkDatabase: BookmarkDatabase,
  mediaDatabase: MediaDatabase,
  statusDetectedLanguageDatabase: StatusDetectedLanguageDatabase,
  statusReactionDatabase: StatusReactionDatabase,
  linkPreviewDatabase: LinkPreviewDatabase
): StatusKnexDatabase => {
  // The stored row carries fetch bookkeeping (status, error, hashes) the UI has
  // no use for; the domain object gets only what a card renders. Only completed
  // cards reach here, so a missing title would be a bug rather than a state —
  // it is coerced rather than trusted so one bad row cannot break a timeline.
  const toStatusLinkPreview = (
    record: LinkPreviewRecord
  ): StatusLinkPreview => ({
    url: record.url,
    title: record.title ?? '',
    description: record.description,
    type: record.type,
    siteName: record.siteName,
    authorName: record.authorName,
    authorUrl: record.authorUrl,
    imageUrl: record.imageUrl,
    imageWidth: record.imageWidth,
    imageHeight: record.imageHeight,
    publishedAt: record.publishedAt
  })

  const getStatusLinkPreviewsForIds = async (
    statusIds: string[]
  ): Promise<Map<string, StatusLinkPreview>> => {
    const records = await linkPreviewDatabase.getStatusLinkPreviews({
      statusIds
    })
    return new Map(
      [...records.entries()].map(([statusId, record]) => [
        statusId,
        toStatusLinkPreview(record)
      ])
    )
  }
  const applyPotentiallyReadableStatusFilter = ({
    query,
    visibleToActorId
  }: {
    query: Knex.QueryBuilder
    visibleToActorId: string
  }) =>
    applyPotentiallyReadableStatusVisibilityFilter({
      database,
      query,
      visibleToActorId
    })

  const sortAttachmentsForFitnessMap = <T extends { id: string; url: string }>(
    attachments: T[],
    mapImagePath?: string | null
  ): T[] => {
    if (!mapImagePath) return attachments

    const normalizedMapImagePath = decodeURIComponent(mapImagePath).replace(
      /^\/+/,
      ''
    )
    const mapAttachment = attachments.find((attachment) => {
      const attachmentPath = getAttachmentMediaPath(attachment.url)
      return (
        attachmentPath === normalizedMapImagePath ||
        attachmentPath.endsWith(normalizedMapImagePath)
      )
    })

    if (!mapAttachment) return attachments

    return [...attachments].sort((a, b) => {
      if (a.id === mapAttachment.id) return -1
      if (b.id === mapAttachment.id) return 1
      return 0
    })
  }

  const getAnnounceOriginalStatusId = ({
    content,
    originalStatusId
  }: {
    content?: unknown
    originalStatusId?: string | null
  }): string | null =>
    originalStatusId || getOriginalStatusIdFromAnnounceContent(content)

  const getStatusUrlHash = (url: string): string => getHashFromString(url)

  async function getStatus({
    statusId,
    withReplies,
    currentActorId
  }: GetStatusParams) {
    return getStatusWithHydration({
      statusId,
      currentActorId,
      withReplies
    })
  }

  async function getStatusWithHydration({
    statusId,
    withReplies,
    currentActorId,
    hydrationContext = {}
  }: GetStatusParams & { hydrationContext?: StatusHydrationContext }) {
    const status = await database('statuses').where('id', statusId).first()
    if (!status) return null

    return getStatusWithAttachmentsFromData(
      status,
      currentActorId,
      withReplies,
      hydrationContext
    )
  }

  const getActorTargetStatusIds = (actorId: string) =>
    database('statuses').select('statuses.id').where('actorId', actorId)

  async function deleteStatusEditHistory({
    statusId
  }: GetStatusEditHistoryParams): Promise<void> {
    await database('status_history').where('statusId', statusId).delete()
  }

  async function getStatusEditHistory({
    statusId
  }: GetStatusEditHistoryParams): Promise<StatusEditRevision[]> {
    // Each row holds the content of a prior version; `updatedAt` is when that
    // version was superseded. Order by the recorded transition time and then
    // row id so equal timestamps still produce a stable revision timeline.
    const rows = await database('status_history')
      .where('statusId', statusId)
      .orderBy('updatedAt', 'asc')
      .orderBy('id', 'asc')
    return rows.map((row) => {
      const content = getCompatibleJSON(row.data)
      const hasField = (field: string) =>
        content != null && Object.prototype.hasOwnProperty.call(content, field)
      // Rows written before per-revision snapshots only carry text/summary.
      // Keep availability separate from nullable values: explicit `null` is a
      // known empty value for summary or poll options, while a missing key is
      // unknown and must not be reported as a change or no change.
      const attachments = Attachment.array().safeParse(content?.attachments)
      const pollOptions = Array.isArray(content?.pollOptions)
        ? content.pollOptions.filter(
            (option: unknown): option is string => typeof option === 'string'
          )
        : null
      const pollOptionsAvailable =
        content?.pollOptions === null ||
        (Array.isArray(content?.pollOptions) &&
          content.pollOptions.every(
            (option: unknown) => typeof option === 'string'
          ))
      return {
        text: typeof content?.text === 'string' ? content.text : '',
        summary: typeof content?.summary === 'string' ? content.summary : null,
        sensitive:
          typeof content?.sensitive === 'boolean' ? content.sensitive : null,
        attachments: attachments.success ? attachments.data : null,
        pollOptions,
        createdAt: getCompatibleTime(row.createdAt),
        available: {
          text: typeof content?.text === 'string',
          summary:
            hasField('summary') &&
            (content.summary === null || typeof content.summary === 'string'),
          sensitive: typeof content?.sensitive === 'boolean',
          attachments: attachments.success,
          pollOptions: pollOptionsAvailable
        },
        supersededAt: getCompatibleTime(row.updatedAt)
      }
    })
  }

  // Batched emoji-reaction rollups for a page of statuses, in the shape the
  // domain Status carries. Every hydration site uses this so none of them falls
  // back to the per-status lookup — that fallback exists for single-status
  // routes, not for list paths.
  async function buildReactionRollupContext(
    statusIds: string[],
    currentActorId?: string
  ): Promise<Map<string, StatusReaction[]>> {
    const context = new Map<string, StatusReaction[]>(
      statusIds.map((statusId) => [statusId, []])
    )
    if (statusIds.length === 0) return context

    const rollups = await statusReactionDatabase.getStatusReactionRollups({
      statusIds,
      currentActorId
    })
    for (const rollup of rollups) {
      context.get(rollup.statusId)?.push({
        name: rollup.name,
        count: rollup.count,
        me: rollup.me,
        url: rollup.url,
        static_url: rollup.staticUrl
      })
    }
    return context
  }

  // The viewer's own like/bookmark state for a page of statuses, batched. Every
  // list path that hydrates for a viewer uses this: passing a `currentActorId`
  // into per-status hydration without it turns on a like lookup, a bookmark
  // lookup and an announce lookup *per row*.
  async function buildViewerHydration(
    statusIds: string[],
    currentActorId?: string
  ): Promise<Pick<
    StatusHydrationContext,
    'likedStatusIds' | 'bookmarkedStatusIds' | 'announcedStatusIds'
  > | null> {
    // No viewer means no viewer state to resolve, and the consumer must be left
    // with the fields UNSET — it reads an unset field as "not batched, look this
    // status up individually", which is the correct behaviour for anonymous
    // reads (where the lookup is skipped outright).
    if (!currentActorId) return null

    // A viewer with nothing to look up still gets empty sets rather than null:
    // returning null here would mark the page as un-batched and send every row
    // back to a per-status query.
    const [bookmarkRows, likeRows, announceRows] =
      statusIds.length === 0
        ? [[], [], []]
        : await Promise.all([
            database('bookmarks')
              .where('actorId', currentActorId)
              .whereIn('statusId', statusIds)
              .select<{ statusId: string }[]>('statusId'),
            database('likes')
              .where('actorId', currentActorId)
              .whereIn('statusId', statusIds)
              .select<{ statusId: string }[]>('statusId'),
            database('statuses')
              .where('type', StatusType.enum.Announce)
              .where('actorId', currentActorId)
              .whereIn('originalStatusId', statusIds)
              .select<{ id: string; originalStatusId: string }[]>(
                'id',
                'originalStatusId'
              )
          ])
    return {
      bookmarkedStatusIds: new Set(bookmarkRows.map((row) => row.statusId)),
      likedStatusIds: new Set(likeRows.map((row) => row.statusId)),
      announcedStatusIds: new Map(
        announceRows.map((row) => [row.originalStatusId, row.id] as const)
      )
    }
  }

  async function getStatusReplies({
    statusId,
    url,
    limit,
    publicOnly = false,
    visibleToActorId,
    currentActorId,
    order = 'desc'
  }: GetStatusRepliesParams) {
    let query = database('statuses')
      .where((builder) => {
        builder.where('reply', statusId)
        if (url) {
          builder.orWhere('reply', url)
        }
      })
      .orderBy([
        { column: 'createdAt', order },
        { column: 'id', order }
      ])

    if (publicOnly) {
      query = query.modify(wherePubliclyReadableStatus, database)
    } else if (visibleToActorId) {
      query = applyPotentiallyReadableStatusFilter({
        query,
        visibleToActorId
      })
    }

    if (limit) {
      query = query.limit(limit)
    }

    const statuses = await query
    // Batch detected-language and quote-edge hydration so this doesn't N+1 one
    // query per reply (mirroring getStatusesByIds).
    const hydrationStatusIds = await collectHydrationStatusIds(statuses)
    const [
      detectedLanguages,
      quoteEdges,
      linkPreviews,
      reactionRollups,
      viewerHydration
    ] = await Promise.all([
      hydrationStatusIds.size > 0
        ? statusDetectedLanguageDatabase.getDetectedLanguages({
            statusIds: [...hydrationStatusIds]
          })
        : Promise.resolve({}),
      hydrationStatusIds.size > 0
        ? getStatusQuoteEdges([...hydrationStatusIds])
        : Promise.resolve(new Map<string, StatusQuote>()),
      hydrationStatusIds.size > 0
        ? getStatusLinkPreviewsForIds([...hydrationStatusIds])
        : Promise.resolve(new Map<string, StatusLinkPreview>()),
      buildReactionRollupContext([...hydrationStatusIds], currentActorId),
      buildViewerHydration([...hydrationStatusIds], currentActorId)
    ])
    const hydrationContext: StatusHydrationContext = {
      detectedLanguages,
      quoteEdges,
      linkPreviews,
      reactionRollups,
      ...(viewerHydration ?? {})
    }
    const statusesWithAttachments = (
      await Promise.all(
        statuses.map((item) =>
          getStatusWithAttachmentsFromData(
            item,
            currentActorId,
            undefined,
            hydrationContext
          )
        )
      )
    ).filter((status): status is Status => status !== null)
    return statusesWithAttachments
  }

  async function getActorStatusesCount({
    actorId,
    publicOnly = false
  }: GetActorStatusesCountParams) {
    if (publicOnly) {
      // There is no counter for this: an Announce is only publicly readable
      // while the status it boosts still is, and that status belongs to another
      // actor whose visibility edits and deletes never touch this actor's rows.
      // So the count is computed — but counted straight off the readable-ids
      // subquery, which is already scoped to this actor's statuses. Filtering
      // `statuses` by it re-applied the same `actorId` predicate through one
      // primary-key lookup per returned id, for a result the subquery had
      // already decided.
      //
      // One of the two readability call sites that keep the set-based form
      // (`getRebloggedBy` in lib/database/domains/status/interactions.ts is the
      // other, for a different reason recorded there).
      // The correlated `wherePubliclyReadableStatus` costs one recursive-CTE
      // instantiation per Announce row — a LIMIT amortises that to a page, and
      // a COUNT over the actor's whole history cannot amortise it at all. On
      // a PostgreSQL 18 seed shaped like production (an actor with 1,889
      // publicly readable statuses, half of them Announces) the correlated
      // form read 40% fewer buffers and still took three times as long:
      // 15,421 buffers / 54ms against 25,752 / 18ms here. The two are pinned
      // as equivalent by `publiclyReadableStatusEquivalence.test.ts`; only
      // their plans differ.
      const result = await database
        .from(
          buildPubliclyReadableStatusIdsQuery({
            database,
            targetStatusIds: getActorTargetStatusIds(actorId)
          }).as('publicly_readable_actor_statuses')
        )
        .countDistinct<{ count: string | number }>({
          count: 'publicly_readable_actor_statuses.id'
        })
        .first()

      return parseInt(String(result?.count ?? '0'), 10)
    }

    return getCounterValue(database, CounterKey.totalStatus(actorId))
  }

  async function getActorStatuses({
    actorId,
    currentActorId,
    minStatusId,
    maxStatusId,
    limit = PER_PAGE_LIMIT,
    publicOnly = false,
    visibleToActorId,
    includeFollowersOnly = false,
    followersAudience,
    onlyMedia = false,
    excludeReplies = false,
    excludeReblogs = false,
    tagged,
    pinned = false
  }: GetActorStatusesParams) {
    let query = database('statuses')
      .where('actorId', actorId)
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)

    if (publicOnly) {
      // The one visibility mode that does NOT go through
      // `buildActorVisibleStatusIdsQuery`. That builder answers with a
      // materialised id set, which is right for the attachment and gallery
      // filters (`getAttachmentsForActor` builds the same set through its
      // Kysely twin, `actorVisibleStatusIds`) — they have no ordered bound to
      // early-terminate on — and wrong here, because the planner must finish
      // it before this query's LIMIT sees a single row. It made the page cost
      // the actor's entire public history: a flat 33,311 buffers at every page
      // size on a production-shaped PostgreSQL 18 seed, against 476
      // correlated. The two forms select identical rows
      // (`publiclyReadableStatusEquivalence.test.ts`), so an attachment is
      // still exactly as readable as the post carrying it — which is the
      // invariant sharing one builder was there to protect.
      query = query.modify(wherePubliclyReadableStatus, database)
    } else {
      // A null subquery means the caller asked for no visibility filter at all
      // — the owner's own timeline and the full-history export both rely on
      // that. See `buildActorVisibleStatusIdsQuery`.
      const visibleStatusIds = buildActorVisibleStatusIdsQuery({
        database,
        actorId,
        publicOnly,
        visibleToActorId,
        includeFollowersOnly,
        followersAudience
      })
      if (visibleStatusIds) {
        query = query.whereIn('statuses.id', visibleStatusIds)
      }
    }

    if (onlyMedia) {
      query = query.whereExists(function () {
        this.select(database.raw('1'))
          .from('attachments')
          .whereRaw('?? = ??', ['attachments.statusId', 'statuses.id'])
      })
    }

    if (excludeReplies) {
      query = query.where((builder) => {
        builder
          .where((noReply) => {
            noReply.whereNull('statuses.reply').orWhere('statuses.reply', '')
          })
          .orWhereExists(function () {
            this.select(database.raw('1'))
              .from('statuses as reply_parent_by_id')
              .where('reply_parent_by_id.actorId', actorId)
              .whereRaw('?? = ??', ['reply_parent_by_id.id', 'statuses.reply'])
          })
          .orWhereExists(function () {
            this.select(database.raw('1'))
              .from('statuses as reply_parent_by_url')
              .where('reply_parent_by_url.actorId', actorId)
              .whereRaw('?? = ??', [
                'reply_parent_by_url.urlHash',
                'statuses.replyHash'
              ])
              .whereRaw('?? = ??', [
                'reply_parent_by_url.url',
                'statuses.reply'
              ])
          })
      })
    }

    if (excludeReblogs) {
      query = query.whereNot('statuses.type', StatusType.enum.Announce)
    }

    if (tagged !== undefined && tagged !== null) {
      const normalizedNames = getHashtagStorageNames(tagged)
      if (normalizedNames.length === 0) {
        query = query.whereRaw('1 = 0')
      } else {
        query = query.whereExists(function () {
          this.select(database.raw('1'))
            .from('tags')
            .whereRaw('?? = ??', ['tags.statusId', 'statuses.id'])
            .where('tags.type', 'hashtag')
            .whereIn('tags.nameNormalized', normalizedNames)
        })
      }
    }

    if (pinned) {
      query = query.whereExists(function () {
        this.select(database.raw('1'))
          .from('status_pins')
          .where('status_pins.actorId', actorId)
          .whereRaw('?? = ??', ['status_pins.statusId', 'statuses.id'])
      })
    }

    if (minStatusId) {
      const minStatus = await database('statuses')
        .where('id', minStatusId)
        .first()
      if (minStatus) {
        query = query.where((wb) => {
          wb.where('statuses.createdAt', '>', minStatus.createdAt).orWhere(
            (sameCreatedAt) => {
              sameCreatedAt
                .where('statuses.createdAt', '=', minStatus.createdAt)
                .where('statuses.id', '>', minStatusId)
            }
          )
        })
      }
    }

    if (maxStatusId) {
      const maxStatus = await database('statuses')
        .where('id', maxStatusId)
        .first()
      if (maxStatus) {
        query = query.where((wb) => {
          wb.where('statuses.createdAt', '<', maxStatus.createdAt).orWhere(
            (sameCreatedAt) => {
              sameCreatedAt
                .where('statuses.createdAt', '=', maxStatus.createdAt)
                .where('statuses.id', '<', maxStatusId)
            }
          )
        })
      }
    }

    const statuses = await query
    // Batch detected-language and quote-edge hydration so this doesn't N+1 one
    // query per status (mirroring getStatusesByIds) — actor status lists back
    // profile pages and the Mastodon accounts/:id/statuses endpoint.
    const hydrationStatusIds = await collectHydrationStatusIds(statuses)
    const [
      detectedLanguages,
      quoteEdges,
      linkPreviews,
      reactionRollups,
      viewerHydration
    ] = await Promise.all([
      hydrationStatusIds.size > 0
        ? statusDetectedLanguageDatabase.getDetectedLanguages({
            statusIds: [...hydrationStatusIds]
          })
        : Promise.resolve({}),
      hydrationStatusIds.size > 0
        ? getStatusQuoteEdges([...hydrationStatusIds])
        : Promise.resolve(new Map<string, StatusQuote>()),
      hydrationStatusIds.size > 0
        ? getStatusLinkPreviewsForIds([...hydrationStatusIds])
        : Promise.resolve(new Map<string, StatusLinkPreview>()),
      buildReactionRollupContext([...hydrationStatusIds], currentActorId),
      buildViewerHydration([...hydrationStatusIds], currentActorId)
    ])
    const hydrationContext: StatusHydrationContext = {
      detectedLanguages,
      quoteEdges,
      linkPreviews,
      reactionRollups,
      ...(viewerHydration ?? {})
    }
    const statusesWithAttachments = (
      await Promise.all(
        statuses.map((item) =>
          getStatusWithAttachmentsFromData(
            item,
            currentActorId,
            undefined,
            hydrationContext
          )
        )
      )
    ).filter((status): status is Status => status !== null)
    return statusesWithAttachments
  }

  async function getStatusesByIds({
    statusIds,
    currentActorId,
    visibleToActorId,
    withReplies
  }: GetStatusesByIdsParams): Promise<Status[]> {
    if (statusIds.length === 0) {
      return []
    }

    const uniqueStatusIds = [...new Set(statusIds)]
    let query = database('statuses').whereIn('id', uniqueStatusIds)
    if (visibleToActorId) {
      query = applyPotentiallyReadableStatusFilter({
        query,
        visibleToActorId
      })
    }
    const statuses = await query.select()
    const hydrationContext: StatusHydrationContext = {}
    const hydrationStatusIds = await collectHydrationStatusIds(statuses)
    const hasHydrationStatusIds = hydrationStatusIds.size > 0
    // Detected language is viewer-independent, so it's batched for every
    // fetch (not just signed-in viewers) to avoid falling back to a
    // per-status query in getStatusWithAttachmentsFromData. Run it in the
    // same Promise.all as the bookmark/like queries below rather than
    // sequentially, so all three independent batched lookups overlap.
    const [
      detectedLanguages,
      quoteEdges,
      linkPreviews,
      reactionRollups,
      viewerHydration
    ] = await Promise.all([
      hasHydrationStatusIds
        ? statusDetectedLanguageDatabase.getDetectedLanguages({
            statusIds: [...hydrationStatusIds]
          })
        : Promise.resolve({}),
      // Quote edges are viewer-independent, so batch them for every fetch (as
      // with detected languages) rather than falling back to a per-status
      // query in getStatusWithAttachmentsFromData.
      hasHydrationStatusIds
        ? getStatusQuoteEdges([...hydrationStatusIds])
        : Promise.resolve(new Map<string, StatusQuote>()),
      // Link preview cards are viewer-independent too, and batched for the same
      // reason.
      hasHydrationStatusIds
        ? getStatusLinkPreviewsForIds([...hydrationStatusIds])
        : Promise.resolve(new Map<string, StatusLinkPreview>()),
      buildReactionRollupContext([...hydrationStatusIds], currentActorId),
      buildViewerHydration([...hydrationStatusIds], currentActorId)
    ])
    hydrationContext.detectedLanguages = detectedLanguages
    hydrationContext.quoteEdges = quoteEdges
    hydrationContext.linkPreviews = linkPreviews
    hydrationContext.reactionRollups = reactionRollups
    Object.assign(hydrationContext, viewerHydration ?? {})
    const statusMap = new Map(
      statuses.map((statusData) => [statusData.id, statusData] as const)
    )
    const orderedStatusData = statusIds
      .map((statusId) => statusMap.get(statusId))
      .filter((statusData) => Boolean(statusData))
    const statusesWithAttachments = (
      await Promise.all(
        orderedStatusData.map((statusData) =>
          getStatusWithAttachmentsFromData(
            statusData,
            currentActorId,
            withReplies,
            hydrationContext
          )
        )
      )
    ).filter((status): status is Status => status !== null)

    return statusesWithAttachments
  }

  async function collectHydrationStatusIds(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    statuses: any[]
  ): Promise<Set<string>> {
    const statusIds = new Set<string>()
    const seen = new Set<string>()
    let pending = statuses

    for (
      let depth = 0;
      pending.length > 0 && depth <= MAX_ANNOUNCE_RESOLUTION_DEPTH;
      depth += 1
    ) {
      const originalStatusIds: string[] = []
      for (const statusData of pending) {
        if (seen.has(statusData.id)) continue
        seen.add(statusData.id)

        if (statusData.type === StatusType.enum.Announce) {
          const originalStatusId = getAnnounceOriginalStatusId(statusData)
          if (originalStatusId) originalStatusIds.push(originalStatusId)
        } else {
          statusIds.add(statusData.id)
        }
      }

      const missingOriginalStatusIds = [
        ...new Set(originalStatusIds.filter((statusId) => !seen.has(statusId)))
      ]
      pending =
        missingOriginalStatusIds.length > 0
          ? await database('statuses')
              .whereIn('id', missingOriginalStatusIds)
              .select()
          : []
    }

    return statusIds
  }

  type StatusQuoteEdgeRow = {
    statusId: string
    quotedStatusId: string
    quotedStatusUrl?: string | null
    state: string
    authorizationUri: string | null
  }

  const toStatusQuoteEdge = (row: StatusQuoteEdgeRow): StatusQuote => ({
    quotedStatusId: row.quotedStatusId,
    quotedStatusUrl: row.quotedStatusUrl ?? null,
    state: QuoteState.parse(row.state),
    authorizationUri: row.authorizationUri ?? null
  })

  // Per-status quote-edge read used when a caller did not pre-batch them into the
  // hydration context (mirrors the detected-language fallback).
  const getStatusQuoteEdgeForData = async (
    statusId: string
  ): Promise<StatusQuote | null> => {
    const row = await database('status_quotes')
      .leftJoin('statuses', 'statuses.id', 'status_quotes.quotedStatusId')
      .where('status_quotes.statusId', statusId)
      .first<StatusQuoteEdgeRow>(
        'status_quotes.statusId',
        'status_quotes.quotedStatusId',
        'status_quotes.state',
        'status_quotes.authorizationUri',
        'statuses.url as quotedStatusUrl'
      )
    return row ? toStatusQuoteEdge(row) : null
  }

  // Batch quote-edge read for a timeline page (avoids one query per status).
  const getStatusQuoteEdges = async (
    statusIds: string[]
  ): Promise<Map<string, StatusQuote>> => {
    const edges = new Map<string, StatusQuote>()
    if (statusIds.length === 0) return edges
    const rows = await database('status_quotes')
      .leftJoin('statuses', 'statuses.id', 'status_quotes.quotedStatusId')
      .whereIn('status_quotes.statusId', statusIds)
      .select<StatusQuoteEdgeRow[]>(
        'status_quotes.statusId',
        'status_quotes.quotedStatusId',
        'status_quotes.state',
        'status_quotes.authorizationUri',
        'statuses.url as quotedStatusUrl'
      )
    for (const row of rows) edges.set(row.statusId, toStatusQuoteEdge(row))
    return edges
  }

  const addCounterAdjustment = (
    adjustments: Map<string, number>,
    counterKey: string,
    amount = 1
  ) => {
    adjustments.set(counterKey, (adjustments.get(counterKey) ?? 0) + amount)
  }

  const selectStatusDeletionRowsByIds = async (
    trx: Knex.Transaction,
    statusIds: string[]
  ) => {
    const rows: StatusDeletionRow[] = []
    for (const statusIdChunk of chunkArray(
      statusIds,
      getWhereInBatchSize(trx)
    )) {
      rows.push(
        ...(await trx('statuses')
          .whereIn('id', statusIdChunk)
          .select<StatusDeletionRow[]>(
            'id',
            'actorId',
            'type',
            'reply',
            'content',
            'originalStatusId'
          ))
      )
    }
    return rows
  }

  const selectReplyIdsByStatusIds = async (
    trx: Knex.Transaction,
    statusIds: string[]
  ) => {
    // Reply traversal stays on statuses.reply, which is indexed by migration.
    const rows: { id: string }[] = []
    for (const statusIdChunk of chunkArray(
      statusIds,
      getWhereInBatchSize(trx)
    )) {
      rows.push(
        ...(await trx('statuses')
          .whereIn('reply', statusIdChunk)
          .select<{ id: string }[]>('id'))
      )
    }
    return rows
  }

  const statusActorMatches = (statusActorId: string, actorId: string) => {
    const normalizedStatusActorId = normalizeActorId(statusActorId)
    const normalizedExpectedActorId = normalizeActorId(actorId)
    return (
      normalizedStatusActorId !== null &&
      normalizedExpectedActorId !== null &&
      normalizedStatusActorId === normalizedExpectedActorId
    )
  }

  const selectLocalActorIds = async (
    trx: Knex.Transaction,
    actorIds: string[]
  ) => {
    const localActorIds = new Set<string>()
    for (const actorIdChunk of chunkArray(actorIds, getWhereInBatchSize(trx))) {
      const rows = await trx('actors')
        .whereIn('id', actorIdChunk)
        .whereNotNull('accountId')
        .select<{ id: string }[]>('id')
      for (const row of rows) {
        localActorIds.add(row.id)
      }
    }
    return localActorIds
  }

  const resolveParentStatusIdsByReplyReferences = async (
    trx: Knex.Transaction,
    replyReferences: string[]
  ) => {
    const referenceToStatusId = new Map<string, string>()
    const uniqueReplyReferences = [
      ...new Set(replyReferences.filter((reply) => reply.length > 0))
    ]
    const batchSize = Math.max(1, Math.floor(getWhereInBatchSize(trx) / 3))

    for (const replyReferenceChunk of chunkArray(
      uniqueReplyReferences,
      batchSize
    )) {
      const replyReferenceHashes = replyReferenceChunk.map((reply) =>
        getStatusUrlHash(reply)
      )
      const rows = await trx('statuses')
        .whereIn('id', replyReferenceChunk)
        .orWhere((builder) =>
          builder
            .whereIn('urlHash', replyReferenceHashes)
            .whereIn('url', replyReferenceChunk)
        )
        .select<{ id: string; url: string | null }[]>('id', 'url')

      for (const row of rows) {
        referenceToStatusId.set(row.id, row.id)
        if (row.url) {
          referenceToStatusId.set(row.url, row.id)
        }
      }
    }

    return referenceToStatusId
  }

  const applyStatusDeletionCounterAdjustments = async ({
    currentTime,
    publiclyAddressedStatusIds,
    statuses,
    trx
  }: {
    currentTime: Date
    // Mirrors the create path: only publicly addressed replies were counted.
    publiclyAddressedStatusIds: Set<string>
    statuses: StatusDeletionRow[]
    trx: Knex.Transaction
  }) => {
    const adjustments = new Map<string, number>()
    const localActorIds = await selectLocalActorIds(trx, [
      ...new Set(statuses.map((status) => status.actorId))
    ])
    const parentStatusIdByReplyReference =
      await resolveParentStatusIdsByReplyReferences(
        trx,
        statuses
          .map((status) => status.reply ?? '')
          .filter((reply) => reply.length > 0)
      )

    for (const status of statuses) {
      addCounterAdjustment(adjustments, CounterKey.totalStatus(status.actorId))
      addCounterAdjustment(adjustments, CounterKey.serviceTotalStatuses())
      if (localActorIds.has(status.actorId)) {
        addCounterAdjustment(adjustments, CounterKey.nodeinfoLocalPosts())
      }

      if (status.type === StatusType.enum.Announce) {
        const originalStatusId = getAnnounceOriginalStatusId(status)
        if (originalStatusId) {
          addCounterAdjustment(
            adjustments,
            CounterKey.totalReblog(originalStatusId)
          )
        }
      }

      if (status.reply && publiclyAddressedStatusIds.has(status.id)) {
        const parentStatusId = parentStatusIdByReplyReference.get(status.reply)
        if (parentStatusId) {
          addCounterAdjustment(
            adjustments,
            CounterKey.totalReply(parentStatusId)
          )
        }
      }
    }

    for (const [counterKey, amount] of adjustments) {
      await decreaseCounterValue(trx, counterKey, amount, currentTime)
    }
  }

  const applyHashtagDeletionCounterAdjustments = async ({
    currentTime,
    publiclyAddressedStatusIds,
    tags,
    trx
  }: {
    currentTime: Date
    // Mirrors the create path: only publicly addressed statuses' tags counted.
    publiclyAddressedStatusIds: Set<string>
    tags: StatusHashtagTagRow[]
    trx: Knex.Transaction
  }) => {
    const adjustments = new Map<string, number>()

    for (const tag of tags) {
      if (!publiclyAddressedStatusIds.has(tag.statusId)) continue
      const tagName = normalizeHashtagSearchName(tag.name)
      addCounterAdjustment(adjustments, CounterKey.totalHashtag(tagName))
    }

    for (const [counterKey, amount] of adjustments) {
      await decreaseCounterValue(trx, counterKey, amount, currentTime)
    }
  }

  // Recompute the persisted `actors.lastStatusAt` for each affected actor after
  // their statuses have been physically deleted. A correlated subquery yields the
  // greatest remaining `statuses.createdAt`, or NULL when none remain — so
  // deleting an actor's most-recent (or last) status keeps `lastStatusAt` and the
  // directory `active` order correct. MUST run after the `statuses` rows are gone.
  const recomputeActorsLastStatusAt = async ({
    actorIds,
    trx
  }: {
    actorIds: string[]
    trx: Knex.Transaction
  }) => {
    const uniqueActorIds = [...new Set(actorIds)]
    if (uniqueActorIds.length === 0) return

    for (const actorIdChunk of chunkArray(
      uniqueActorIds,
      getWhereInBatchSize(trx)
    )) {
      // Lock the affected actor rows before recomputing (no-op on SQLite, which
      // serializes writers; matches the pinStatus precedent). This recompute is
      // an unconditional overwrite, so without the lock a concurrent create — whose
      // guarded lastStatusAt bump holds the same row lock until it commits — could,
      // under PostgreSQL READ COMMITTED, let this statement's stale snapshot
      // clobber the just-committed newer value with an older MAX (or NULL). Taking
      // the lock first serializes the two and forces the following UPDATE to take a
      // fresh snapshot that already sees the new status.
      await trx('actors').whereIn('id', actorIdChunk).select('id').forUpdate()
      await trx('actors')
        .whereIn('id', actorIdChunk)
        .update({
          // Direct statuses never advanced `lastStatusAt` on create (see
          // `updateStatusCounters`), so they must not set it here either —
          // deleting the newest public post would otherwise reveal the date of
          // a later direct message. "Not direct" is `getVisibility`'s rule:
          // addressed to the public collection or to a followers collection.
          lastStatusAt: trx('statuses')
            .max('createdAt')
            .where('statuses.actorId', trx.ref('actors.id'))
            .whereExists((builder) =>
              builder
                .select(trx.raw('1'))
                .from('recipients')
                .whereRaw('?? = ??', ['recipients.statusId', 'statuses.id'])
                .where((audience) =>
                  audience
                    .whereIn('recipients.actorId', PUBLIC_ACTIVITY_RECIPIENTS)
                    .orWhere('recipients.actorId', 'like', '%/followers')
                )
            )
        })
    }
  }

  const collectStatusDeletionRows = async ({
    actorId,
    statusId,
    trx
  }: DeleteStatusParams & {
    trx: Knex.Transaction
  }) => {
    const levels: StatusDeletionRow[][] = []
    const seen = new Set<string>([statusId])
    let currentStatusIds = [statusId]

    for (let depth = 0; currentStatusIds.length > 0; depth += 1) {
      if (depth >= MAX_STATUS_REPLY_DELETE_DEPTH) {
        throw statusReplyDeletionDepthError(statusId)
      }

      let rows = await selectStatusDeletionRowsByIds(trx, currentStatusIds)
      const rowsToDelete = actorId
        ? rows.filter((row) => statusActorMatches(row.actorId, actorId))
        : rows
      if (actorId) {
        if (depth === 0 && !rowsToDelete.some((row) => row.id === statusId)) {
          return []
        }
      }

      if (rows.length === 0) {
        currentStatusIds = []
        continue
      }

      if (rowsToDelete.length > 0) {
        levels.push(rowsToDelete)
      }

      const replies = await selectReplyIdsByStatusIds(
        trx,
        rows.map((row) => row.id)
      )
      const nextStatusIds: string[] = []

      for (const { id: replyId } of replies) {
        if (!seen.has(replyId)) {
          seen.add(replyId)
          nextStatusIds.push(replyId)
        }
      }

      currentStatusIds = nextStatusIds
    }

    return levels.reverse().flat()
  }

  const chunkStatusDeletionRows = ({
    actorId,
    statuses,
    trx
  }: {
    actorId?: string
    statuses: StatusDeletionRow[]
    trx: Knex.Transaction
  }) => {
    const maxBindings = getWhereInBatchSize(trx)
    if (!actorId) return chunkArray(statuses, maxBindings)

    const chunks: StatusDeletionRow[][] = []
    let currentChunk: StatusDeletionRow[] = []
    let currentActorIds = new Set<string>()

    for (const status of statuses) {
      const nextActorIdCount =
        currentActorIds.size + (currentActorIds.has(status.actorId) ? 0 : 1)
      const nextBindingCount = currentChunk.length + 1 + nextActorIdCount

      if (currentChunk.length > 0 && nextBindingCount > maxBindings) {
        chunks.push(currentChunk)
        currentChunk = []
        currentActorIds = new Set<string>()
      }

      currentChunk.push(status)
      currentActorIds.add(status.actorId)
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk)
    }

    return chunks
  }

  const deleteStatusRowsByIdChunks = async ({
    actorId,
    statuses,
    trx
  }: {
    actorId?: string
    statuses: StatusDeletionRow[]
    trx: Knex.Transaction
  }) => {
    for (const statusChunk of chunkStatusDeletionRows({
      actorId,
      statuses,
      trx
    })) {
      const query = trx('statuses').whereIn(
        'id',
        statusChunk.map((status) => status.id)
      )
      if (actorId) {
        query.whereIn('actorId', [
          ...new Set(statusChunk.map((status) => status.actorId))
        ])
      }
      await query.delete()
    }
  }

  const refreshAffectedHashtags = async ({
    collectedHashtags,
    statusId
  }: {
    collectedHashtags: string[]
    statusId: string
  }) => {
    if (collectedHashtags.length === 0) return
    // Keep hashtag aggregate writes outside the delete transaction. A full
    // reindexSearchHashtags run can reconcile this if the process exits
    // after commit and before this best-effort refresh completes.
    try {
      await searchQueries.indexHashtagSearchDocuments(kyselyFor(database), {
        hashtags: [...new Set(collectedHashtags)]
      })
    } catch (err) {
      logger.warn(
        {
          err,
          hashtags: [...new Set(collectedHashtags)],
          statusId
        },
        'Failed to refresh hashtag search documents after status deletion'
      )
    }
  }

  const executeStatusDeletion = async ({
    actorId,
    affectedHashtags,
    statusId,
    trx
  }: {
    actorId?: string
    affectedHashtags?: string[]
    statusId: string
    trx: Knex.Transaction
  }): Promise<boolean> => {
    const statusesToDelete = await collectStatusDeletionRows({
      actorId,
      statusId,
      trx
    })
    if (statusesToDelete.length === 0) return false

    const currentTime = new Date()
    const statusIdsToDelete = statusesToDelete.map((status) => status.id)
    const publiclyAddressedStatusIds = await selectPubliclyAddressedStatusIds(
      trx,
      statusIdsToDelete
    )
    await applyStatusDeletionCounterAdjustments({
      currentTime,
      publiclyAddressedStatusIds,
      statuses: statusesToDelete,
      trx
    })

    const hashtagTags = await selectHashtagTagsByStatusIds(
      trx,
      statusIdsToDelete
    )
    await applyHashtagDeletionCounterAdjustments({
      currentTime,
      publiclyAddressedStatusIds,
      tags: hashtagTags,
      trx
    })
    affectedHashtags?.push(...hashtagTags.map((tag) => tag.name))

    await deleteRowsByColumnChunks(
      trx,
      'recipients',
      'statusId',
      statusIdsToDelete
    )
    await deleteRowsByColumnChunks(trx, 'likes', 'statusId', statusIdsToDelete)
    // Emoji reactions follow the status, like favourites do. A remote status
    // that is deleted and later re-fetched under the same id would otherwise
    // come back wearing its old reaction chips.
    await deleteRowsByColumnChunks(
      trx,
      'status_reactions',
      'statusId',
      statusIdsToDelete
    )
    await deleteRowsByColumnChunks(trx, 'tags', 'statusId', statusIdsToDelete)
    await deleteRowsByColumnChunks(
      trx,
      'attachments',
      'statusId',
      statusIdsToDelete
    )
    await deleteRowsByColumnChunks(
      trx,
      'bookmarks',
      'statusId',
      statusIdsToDelete
    )
    await deleteRowsByColumnChunks(
      trx,
      'status_pins',
      'statusId',
      statusIdsToDelete
    )
    // The deleted status's own outgoing quote edge is removed with it.
    await deleteRowsByColumnChunks(
      trx,
      'status_quotes',
      'statusId',
      statusIdsToDelete
    )
    // Statuses that quote a now-deleted status keep their edge but move to
    // `deleted` (the quoting posts survive and render a tombstone). Terminal
    // edges (rejected/revoked/deleted) are left untouched.
    for (const chunk of chunkArray(
      statusIdsToDelete,
      getWhereInBatchSize(trx)
    )) {
      await trx('status_quotes')
        .whereIn('quotedStatusId', chunk)
        .whereIn('state', ['pending', 'accepted'])
        .update({ state: 'deleted', updatedAt: currentTime })
    }
    await deleteRowsByColumnChunks(
      trx,
      'status_history',
      'statusId',
      statusIdsToDelete
    )
    await deleteRowsByColumnChunks(
      trx,
      'poll_answers',
      'statusId',
      statusIdsToDelete
    )
    await deleteRowsByColumnChunks(
      trx,
      'poll_voters',
      'statusId',
      statusIdsToDelete
    )
    await deleteRowsByColumnChunks(
      trx,
      'poll_choices',
      'statusId',
      statusIdsToDelete
    )
    await deleteRowsByColumnChunks(
      trx,
      'timelines',
      'statusId',
      statusIdsToDelete
    )
    // Mirror the `timelines` cleanup for the collection fan-out feed so deleting
    // a status does not leave orphaned rows in the high-row-count
    // `collection_timeline` table (matching the materialized-timeline pattern
    // rather than a DB foreign key, which the sibling `timelines` table also
    // does not use).
    await deleteRowsByColumnChunks(
      trx,
      'collection_timeline',
      'statusId',
      statusIdsToDelete
    )
    await deleteRowsByColumnChunks(
      trx,
      'notifications',
      'statusId',
      statusIdsToDelete
    )
    await deleteRowsByColumnChunks(
      trx,
      'direct_conversation_statuses',
      'statusId',
      statusIdsToDelete
    )
    // Clean up idempotency keys that pointed at the deleted status so a retried
    // create with the same key does not resolve to a now-missing status (which
    // would otherwise let the retry create a duplicate). Likewise drop any
    // conversation mute rows keyed on a deleted thread root.
    await deleteRowsByColumnChunks(
      trx,
      'idempotency_keys',
      'statusId',
      statusIdsToDelete
    )
    await deleteRowsByColumnChunks(
      trx,
      'status_mutes',
      'statusId',
      statusIdsToDelete
    )
    await deleteRowsByColumnChunks(
      trx,
      'status_detected_languages',
      'statusId',
      statusIdsToDelete
    )
    // Only the status→card link goes; `link_previews` is a per-URL cache shared
    // with every other status that links the same page. Without this the rows
    // accumulate one per deleted status forever (there is no FK by design), and
    // a deleted-then-refetched remote status could come back wearing its old
    // card.
    await deleteRowsByColumnChunks(
      trx,
      'status_link_previews',
      'statusId',
      statusIdsToDelete
    )
    for (const statusIdChunk of chunkArray(
      statusIdsToDelete,
      getWhereInBatchSize(trx)
    )) {
      // A Wahoo import can be between attaching its file and persisting its
      // provider statusId. Record the deletion in the same transaction as the
      // status removal, using either link, so a delayed revision cannot
      // recreate a post the owner explicitly deleted.
      const wahooTombstone = {
        hadStatus: true,
        statusId: null,
        status: 'completed',
        lastError: null,
        updatedAt: currentTime
      }
      await trx('wahoo_imports')
        .whereIn('statusId', statusIdChunk)
        .update(wahooTombstone)
      await trx('wahoo_imports')
        .whereIn(
          'fitnessFileId',
          trx('fitness_files').select('id').whereIn('statusId', statusIdChunk)
        )
        .update(wahooTombstone)
      await trx('fitness_files')
        .whereIn('statusId', statusIdChunk)
        .update({ statusId: null })
    }
    await deleteStatusRowsByIdChunks({
      actorId,
      statuses: statusesToDelete,
      trx
    })
    await recomputeActorsLastStatusAt({
      actorIds: statusesToDelete.map((status) => status.actorId),
      trx
    })
    await deleteStatusSearchDocumentsByStatusIds(
      kyselyFor(trx),
      statusIdsToDelete
    )
    await deleteCounterValues(
      trx,
      statusIdsToDelete.flatMap((statusId) => [
        CounterKey.totalLike(statusId),
        CounterKey.totalReblog(statusId),
        CounterKey.totalReply(statusId)
      ])
    )
    return true
  }

  async function deleteStatus({
    actorId,
    affectedHashtags,
    statusId,
    trx
  }: DeleteStatusParams & {
    affectedHashtags?: string[]
    trx?: Knex.Transaction
  }) {
    if (!trx) {
      const collectedHashtags: string[] = []
      await database.transaction(async (trx) => {
        await executeStatusDeletion({
          actorId,
          affectedHashtags: collectedHashtags,
          statusId,
          trx
        })
      })
      await refreshAffectedHashtags({ collectedHashtags, statusId })
      return
    }

    await executeStatusDeletion({
      actorId,
      affectedHashtags,
      statusId,
      trx
    })
  }

  async function deleteStatusWithQueueJob({
    actorId,
    statusId,
    queueJob
  }: DeleteStatusWithQueueJobParams): Promise<boolean> {
    const collectedHashtags: string[] = []
    const deleted = await database.transaction(async (trx) => {
      const isDeleted = await executeStatusDeletion({
        actorId,
        affectedHashtags: collectedHashtags,
        statusId,
        trx
      })
      if (!isDeleted) {
        return false
      }

      // The queue job joins this Knex transaction through its Kysely view, so
      // it commits or rolls back with the deletion.
      await createQueueJob(kyselyFor(trx), queueJob)
      return true
    })

    if (!deleted) {
      return false
    }

    await refreshAffectedHashtags({ collectedHashtags, statusId })
    return true
  }

  // Private
  async function getPollChoices(statusId: string) {
    const raw = await database('poll_choices')
      .where('statusId', statusId)
      .orderBy('choiceId', 'asc')
    return raw.map((data) =>
      PollChoice.parse({
        ...data,
        createdAt: getCompatibleTime(data.createdAt),
        updatedAt: getCompatibleTime(data.updatedAt)
      })
    )
  }

  async function getPollVotersCount(statusId: string): Promise<number> {
    const result = await database('poll_voters')
      .where('statusId', statusId)
      .count<{ count: string }>('* as count')
      .first()
    return parseInt(String(result?.count ?? '0'), 10)
  }

  async function getStatusWithAttachmentsFromData(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
    currentActorId?: string,
    withReplies?: boolean,
    hydrationContext: StatusHydrationContext = {}
  ): Promise<Status | null> {
    const [to, cc] = await Promise.all([
      database('recipients').where('statusId', data.id).andWhere('type', 'to'),
      database('recipients').where('statusId', data.id).andWhere('type', 'cc')
    ])

    if (data.type === StatusType.enum.Announce) {
      const originalStatusId = getAnnounceOriginalStatusId(data)
      if (!originalStatusId) return null
      const [actor, originalStatus] = await Promise.all([
        actorDatabase.getActorFromId({ id: data.actorId }),
        getStatusWithHydration({
          statusId: originalStatusId,
          currentActorId,
          hydrationContext
        })
      ])
      if (!originalStatus) return null
      return StatusAnnounce.parse({
        id: data.id,
        publicId: data.publicId ?? null,
        actorId: data.actorId,
        actor: actor ? getStatusActorProfile(actor) : null,
        type: StatusType.enum.Announce,
        to: to.map((item) => item.actorId),
        cc: cc.map((item) => item.actorId),
        edits: [],
        originalStatus: originalStatus as StatusNote,
        isLocalActor: Boolean(actor?.account),
        createdAt: getCompatibleTime(data.createdAt),
        updatedAt: getCompatibleTime(data.updatedAt)
      })
    }

    const [
      attachments,
      tags,
      replies,
      actor,
      totalLikes,
      totalShares,
      isActorLikedStatusResult,
      isActorBookmarkedStatusResult,
      actorAnnounceStatusId,
      edits,
      currentPollChoices,
      fitnessFile,
      detectedLanguage,
      quoteEdge,
      linkPreview,
      reactions
    ] = await Promise.all([
      mediaDatabase.getAttachments({ statusId: data.id }),
      getTags(kyselyFor(database), { statusId: data.id }),
      withReplies
        ? database('statuses')
            .select('id')
            .where('reply', data.id)
            .orderBy('createdAt', 'desc')
        : Promise.resolve([]),
      actorDatabase.getActorFromId({ id: data.actorId }),
      getCounterValue(database, CounterKey.totalLike(data.id)),
      getCounterValue(database, CounterKey.totalReblog(data.id)),
      currentActorId
        ? hydrationContext.likedStatusIds
          ? hydrationContext.likedStatusIds.has(data.id)
          : likeDatabase.isActorLikedStatus({
              statusId: data.id,
              actorId: currentActorId
            })
        : false,
      currentActorId
        ? hydrationContext.bookmarkedStatusIds
          ? hydrationContext.bookmarkedStatusIds.has(data.id)
          : bookmarkDatabase.isActorBookmarkedStatus({
              statusId: data.id,
              actorId: currentActorId,
              statusType: data.type
            })
        : false,
      currentActorId
        ? hydrationContext.announcedStatusIds
          ? (hydrationContext.announcedStatusIds.get(data.id) ?? null)
          : getActorAnnouncedStatusId(kyselyFor(database), {
              originalStatusId: data.id,
              actorId: currentActorId
            })
        : null,
      getStatusEditHistory({ statusId: data.id }),
      data.type === StatusType.enum.Poll
        ? getPollChoices(data.id)
        : Promise.resolve([]),
      // A status can carry several fitness files (e.g. the same ride merged
      // from two devices). Surface the primary one — matching
      // getFitnessFileByStatus — instead of an arbitrary `.first()`.
      // The gear name comes along on this same query rather than a follow-up
      // lookup — `getStatus` runs per status, so a second round trip here is an
      // N+1 across a whole timeline page. Every clause below is table-qualified
      // because both tables carry `deletedAt`/`createdAt`.
      database<SQLFitnessFile>('fitness_files')
        // `deletedAt` belongs in the JOIN's ON clause, never the WHERE: as a
        // WHERE it is false for a soft-deleted gear and would drop the whole
        // fitness_files row, taking the entire activity off the status. Here it
        // only withholds the name.
        //
        // Today `deleteFitnessGear` nulls `fitness_files.gearId` in the same
        // transaction, so this never matches a deleted gear anyway — but that
        // coupling is invisible from here, and the sibling reader
        // (`getFitnessGearNamesByIds`) filters too. A future cleanup path that
        // soft-deletes gear without nulling would otherwise leak the name onto
        // every public post that used it.
        .leftJoin('fitness_gears', function () {
          this.on('fitness_files.gearId', '=', 'fitness_gears.id').andOnNull(
            'fitness_gears.deletedAt'
          )
        })
        // The recording device is a second gear row on the same status, so it
        // needs an aliased join of its own — the same table twice, with the
        // same `deletedAt` guard and for the same reasons.
        .leftJoin('fitness_gears as device_gears', function () {
          this.on(
            'fitness_files.deviceGearId',
            '=',
            'device_gears.id'
          ).andOnNull('device_gears.deletedAt')
        })
        .where('fitness_files.statusId', data.id)
        .whereNull('fitness_files.deletedAt')
        .orderBy('fitness_files.isPrimary', 'desc')
        .orderBy('fitness_files.activityStartTime', 'asc')
        .orderBy('fitness_files.createdAt', 'asc')
        .select(
          'fitness_files.*',
          'fitness_gears.name as gearName',
          'device_gears.name as deviceGearName'
        )
        .first<
          | (SQLFitnessFile & {
              gearName?: string | null
              deviceGearName?: string | null
            })
          | undefined
        >(),
      hydrationContext?.detectedLanguages
        ? (hydrationContext.detectedLanguages[data.id] ?? null)
        : statusDetectedLanguageDatabase.getDetectedLanguage({
            statusId: data.id
          }),
      // Quote edge: use the pre-batched map when present, otherwise read this
      // status's edge directly (mirrors the detected-language fallback).
      hydrationContext?.quoteEdges
        ? (hydrationContext.quoteEdges.get(data.id) ?? null)
        : getStatusQuoteEdgeForData(data.id),
      // Link preview card: the pre-batched map when the page covered this
      // status, otherwise a single lookup (single-status routes).
      hydrationContext?.linkPreviews
        ? (hydrationContext.linkPreviews.get(data.id) ?? null)
        : getStatusLinkPreviewsForIds([data.id]).then(
            (previews) => previews.get(data.id) ?? null
          ),
      // Reaction rollups: the pre-batched map when the page covered this status,
      // otherwise a single lookup (single-status routes). `has` rather than a
      // truthiness check, so a reaction-less status resolves from the batch.
      hydrationContext?.reactionRollups?.has(data.id)
        ? (hydrationContext.reactionRollups.get(data.id) ?? [])
        : statusReactionDatabase
            .getStatusReactionRollups({
              statusIds: [data.id],
              currentActorId
            })
            .then((rollups) =>
              rollups.map((rollup) => ({
                name: rollup.name,
                count: rollup.count,
                me: rollup.me,
                url: rollup.url,
                static_url: rollup.staticUrl
              }))
            )
    ])

    const repliesNote = (
      await Promise.all(replies.map((item) => getStatus({ statusId: item.id })))
    )
      .map((item) =>
        item?.type &&
        [StatusType.enum.Note, StatusType.enum.Poll].includes(
          item?.type as any // eslint-disable-line @typescript-eslint/no-explicit-any
        )
          ? item
          : null
      )
      .filter((item): item is StatusNote => Boolean(item))
    const orderedAttachments = sortAttachmentsForFitnessMap(
      attachments,
      fitnessFile?.mapImagePath
    )

    const content = getCompatibleJSON(data.content)
    const editTransitions = getStatusEditTransitions(
      edits,
      {
        text: content.text,
        summary: content.summary ?? null,
        sensitive: content.sensitive ?? false,
        attachments: orderedAttachments,
        pollOptions:
          data.type === StatusType.enum.Poll
            ? currentPollChoices.map((choice) => choice.title)
            : null,
        available: {
          text: true,
          summary: true,
          sensitive: true,
          attachments: true,
          pollOptions: true
        }
      },
      data.type === StatusType.enum.Poll
    )
    const base = {
      id: data.id,
      publicId: data.publicId ?? null,
      url: content.url ?? data.url,
      to: to.map((item) => item.actorId),
      cc: cc.map((item) => item.actorId),
      actorId: data.actorId,
      actor: actor ? getStatusActorProfile(actor) : null,
      type: data.type,
      text: content.text,
      summary: content.summary,
      sensitive: content.sensitive ?? false,
      language: content.language ?? null,
      detectedLanguage,
      applicationName: data.applicationName ?? null,
      applicationWebsite: data.applicationWebsite ?? null,
      reply: data.reply,
      replies: repliesNote,
      // The quote edge (this status quotes another), when present. Announce rows
      // return earlier and never carry it.
      ...(quoteEdge ? { quote: quoteEdge } : {}),
      // The link preview card, when this status has one. Announce rows return
      // earlier; their card belongs to the status they wrap.
      ...(linkPreview ? { linkPreview } : {}),
      // Who may quote THIS status, read back from the content blob.
      ...(content.quoteApprovalPolicy
        ? { quoteApprovalPolicy: content.quoteApprovalPolicy }
        : {}),
      totalLikes,
      totalShares,
      reactions,
      isActorLiked: isActorLikedStatusResult,
      isActorBookmarked: isActorBookmarkedStatusResult,
      actorAnnounceStatusId,
      isLocalActor: Boolean(actor?.account),
      attachments: orderedAttachments,
      tags,
      ...(fitnessFile
        ? {
            fitness: {
              id: fitnessFile.id,
              fileName: fitnessFile.fileName,
              fileType: fitnessFile.fileType,
              mimeType: fitnessFile.mimeType,
              bytes: Number(fitnessFile.bytes),
              url: `/api/v1/fitness-files/${fitnessFile.id}`,
              processingStatus: fitnessFile.processingStatus ?? 'pending',
              // True when the file has sat in `processing` long enough that the
              // worker must have died mid-job. Lets clients offer a retry
              // instead of an endless spinner. Computed server-side so the
              // client never does time math (avoids hydration drift).
              processingStuck: isFitnessProcessingStuck(
                {
                  processingStatus: fitnessFile.processingStatus,
                  updatedAt: getCompatibleTime(fitnessFile.updatedAt)
                },
                Date.now()
              ),
              // The kind of problem, never the reason — see StatusFitnessFile.
              ...(fitnessFile.mapError
                ? {
                    mapFailure: fitnessFile.hasMapData
                      ? ('stale' as const)
                      : ('missing' as const)
                  }
                : {}),
              ...(typeof fitnessFile.totalDistanceMeters === 'number'
                ? { totalDistanceMeters: fitnessFile.totalDistanceMeters }
                : null),
              ...(typeof fitnessFile.totalDurationSeconds === 'number'
                ? { totalDurationSeconds: fitnessFile.totalDurationSeconds }
                : null),
              ...(typeof fitnessFile.movingTimeSeconds === 'number'
                ? { movingTimeSeconds: fitnessFile.movingTimeSeconds }
                : null),
              ...(typeof fitnessFile.elevationGainMeters === 'number'
                ? { elevationGainMeters: fitnessFile.elevationGainMeters }
                : null),
              ...(fitnessFile.activityType
                ? { activityType: fitnessFile.activityType }
                : null),
              ...(fitnessFile.activityStartTime
                ? {
                    activityStartTime: getCompatibleTime(
                      fitnessFile.activityStartTime
                    )
                  }
                : null),
              hasMapData: Boolean(fitnessFile.hasMapData),
              ...(fitnessFile.description
                ? { description: fitnessFile.description }
                : null),
              ...(fitnessFile.deviceManufacturer
                ? { deviceManufacturer: fitnessFile.deviceManufacturer }
                : null),
              ...(fitnessFile.deviceName
                ? { deviceName: fitnessFile.deviceName }
                : null),
              ...(fitnessFile.sourceUrl
                ? { sourceUrl: fitnessFile.sourceUrl }
                : null),
              gearId: fitnessFile.gearId ?? null,
              gearName: fitnessFile.gearName ?? null,
              deviceGearId: fitnessFile.deviceGearId ?? null,
              deviceGearName: fitnessFile.deviceGearName ?? null,
              ...(typeof fitnessFile.avgPower === 'number'
                ? { avgPower: fitnessFile.avgPower }
                : null),
              ...(typeof fitnessFile.maxPower === 'number'
                ? { maxPower: fitnessFile.maxPower }
                : null),
              ...(typeof fitnessFile.avgHeartRate === 'number'
                ? { avgHeartRate: fitnessFile.avgHeartRate }
                : null),
              ...(typeof fitnessFile.maxHeartRate === 'number'
                ? { maxHeartRate: fitnessFile.maxHeartRate }
                : null),
              ...(typeof fitnessFile.totalWorkKj === 'number'
                ? { totalWorkKj: fitnessFile.totalWorkKj }
                : null),
              ...(fitnessFile.elevationSeries
                ? {
                    elevationSeries: parseElevationSeries(
                      fitnessFile.elevationSeries
                    )
                  }
                : null)
            }
          }
        : null),
      createdAt: getCompatibleTime(data.createdAt),
      updatedAt: getCompatibleTime(data.updatedAt),

      edits: edits.map((item, index) => ({
        text: item.text,
        textAvailable: item.available.text,
        summary: item.summary,
        createdAt: item.createdAt,
        ...editTransitions[index]
      }))
    }
    if (data.type === StatusType.enum.Poll) {
      const [votersCount, voted, ownVotes] = await Promise.all([
        getPollVotersCount(data.id),
        currentActorId
          ? hasActorVoted(kyselyFor(database), {
              statusId: data.id,
              actorId: currentActorId
            })
          : false,
        currentActorId
          ? getActorPollVotes(kyselyFor(database), {
              statusId: data.id,
              actorId: currentActorId
            })
          : []
      ])
      return StatusPoll.parse({
        ...base,
        choices: currentPollChoices,
        // Coerce to a finite timestamp; guards legacy/corrupt rows where endAt
        // may be missing or a non-numeric value (see coercePollEndAt). Falls
        // back to the status creation time (stable across reads) rather than
        // Date.now() so hydration stays deterministic.
        endAt: coercePollEndAt(content.endAt, base.createdAt),
        pollType: content.pollType ?? 'oneOf',
        hideTotals: content.hideTotals ?? false,
        votersCount,
        voted,
        ownVotes
      })
    }

    return StatusNote.parse(base)
  }

  async function getStatusReblogsCount({
    statusId
  }: GetStatusReblogsCountParams): Promise<number> {
    return getCounterValue(database, CounterKey.totalReblog(statusId))
  }

  async function getStatusCounterValues(
    { statusIds }: GetStatusCountsParams,
    getCounterId: (statusId: string) => string
  ): Promise<Record<string, number>> {
    const uniqueStatusIds = [...new Set(statusIds)]
    const counterIdsByStatusId = new Map(
      uniqueStatusIds.map((statusId) => [statusId, getCounterId(statusId)])
    )
    const counterValueRows = await Promise.all(
      chunkArray(
        [...counterIdsByStatusId.values()],
        getWhereInBatchSize(database)
      ).map((counterIds) => getCounterValues(database, counterIds))
    )
    const counterValues = Object.assign({}, ...counterValueRows) as Record<
      string,
      number
    >

    return Object.fromEntries(
      uniqueStatusIds.map((statusId) => [
        statusId,
        counterValues[counterIdsByStatusId.get(statusId) ?? ''] ?? 0
      ])
    )
  }

  async function getStatusReblogsCounts(
    params: GetStatusCountsParams
  ): Promise<Record<string, number>> {
    return getStatusCounterValues(params, CounterKey.totalReblog)
  }

  async function getStatusRepliesCount({
    statusId,
    url,
    publicOnly = false
  }: GetStatusRepliesCountParams): Promise<number> {
    if (!url && !publicOnly) {
      return getCounterValue(database, CounterKey.totalReply(statusId))
    }

    let query = database('statuses').where((builder) => {
      builder.where('reply', statusId)
      if (url) {
        builder.orWhere('reply', url)
      }
    })

    if (publicOnly) {
      query = query.modify(wherePubliclyReadableStatus, database)
    }

    // The filter below is about the REPLY row, and still has to be: an
    // Announce whose boosted original is a public Note satisfies the
    // readability predicate under either form, so only this line keeps it out
    // of a reply count. What changed is why that needs saying. The
    // readable-ids subquery this replaced reported the resolved *original's*
    // type, so the two `type` tests were about different rows and reading them
    // as a duplicate was the trap; the correlated predicate tests the reply row
    // itself. Nothing writes `reply` on an Announce today either way, so
    // dropping this line still moves no number anyone can observe — which is
    // exactly why it needs saying at all.
    const result = await query
      .whereNot('type', StatusType.enum.Announce)
      .count<{ count: string }>('* as count')
      .first()

    return parseInt(String(result?.count ?? '0'), 10)
  }

  async function getStatusRepliesCounts(
    params: GetStatusCountsParams
  ): Promise<Record<string, number>> {
    return getStatusCounterValues(params, CounterKey.totalReply)
  }

  return {
    getStatus,
    getStatusReplies,
    getStatusEditHistory,
    deleteStatusEditHistory,
    getActorStatusesCount,
    getActorStatuses,
    getStatusesByIds,
    deleteStatus,
    deleteStatusWithQueueJob,
    getStatusReblogsCount,
    getStatusReblogsCounts,
    getStatusRepliesCount,
    getStatusRepliesCounts,
    hydrateStatusRow: (row, currentActorId) =>
      getStatusWithAttachmentsFromData(row, currentActorId)
  }
}
