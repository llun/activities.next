import { getActorFromId } from '@/lib/database/domains/actor/lookups'
import { isActorBookmarkedStatus } from '@/lib/database/domains/bookmark/queries'
import { parseElevationSeries } from '@/lib/database/domains/fitnessFile/rows'
import { isActorLikedStatus } from '@/lib/database/domains/like/queries'
import { getStatusLinkPreviews } from '@/lib/database/domains/linkPreview/queries'
import { getAttachments } from '@/lib/database/domains/media/queries'
import { coercePollEndAt } from '@/lib/database/domains/status/coercePollEndAt'
import { getTags } from '@/lib/database/domains/status/hashtags'
import { getStatusEditHistory } from '@/lib/database/domains/status/history'
import { getActorAnnouncedStatusId } from '@/lib/database/domains/status/lookups'
import {
  getActorPollVotes,
  hasActorVoted
} from '@/lib/database/domains/status/polls'
import {
  getAnnounceOriginalStatusId,
  getStatusActorProfile
} from '@/lib/database/domains/status/rows'
import type {
  GetStatusParams,
  StatusRow
} from '@/lib/database/domains/status/types'
import {
  getDetectedLanguage,
  getDetectedLanguages
} from '@/lib/database/domains/statusDetectedLanguage/queries'
import { getStatusReactionRollups } from '@/lib/database/domains/statusReaction/queries'
import type { Db } from '@/lib/database/kysely'
import { getCounterValue } from '@/lib/database/kysely/counter'
import { CounterKey } from '@/lib/database/utils/counter'
import { getCompatibleJSON } from '@/lib/database/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/utils/getCompatibleTime'
import { isFitnessProcessingStuck } from '@/lib/services/fitness-files/processingState'
import { getStatusEditTransitions } from '@/lib/services/statuses/statusEditChanges'
import type { SQLFitnessFile } from '@/lib/types/database/fitnessFile'
import type { LinkPreviewRecord } from '@/lib/types/database/operations'
import { PollChoice } from '@/lib/types/domain/pollChoice'
import {
  QuoteState,
  type Status,
  StatusAnnounce,
  type StatusLinkPreview,
  StatusNote,
  StatusPoll,
  type StatusQuote,
  StatusType
} from '@/lib/types/domain/status'
import type { StatusReaction } from '@/lib/types/mastodon/statusReaction'
import { getAttachmentMediaPath } from '@/lib/utils/getAttachmentMediaPath'

// Status hydration: a `statuses` row read into the domain Status, with its
// recipients, author, attachments, tags, counters, edits, poll, fitness file,
// detected language, quote edge, link preview, reactions and the viewer's own
// like, bookmark, boost and votes. The list reads (./reads.ts) batch the
// per-status lookups for a whole page into a StatusHydrationContext first.

const MAX_ANNOUNCE_RESOLUTION_DEPTH = 10

export type StatusHydrationContext = {
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

// The stored row carries fetch bookkeeping (status, error, hashes) the UI has
// no use for; the domain object gets only what a card renders. Only completed
// cards reach here, so a missing title would be a bug rather than a state —
// it is coerced rather than trusted so one bad row cannot break a timeline.
const toStatusLinkPreview = (record: LinkPreviewRecord): StatusLinkPreview => ({
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

export const getStatusLinkPreviewsForIds = async (
  db: Db,
  statusIds: string[]
): Promise<Map<string, StatusLinkPreview>> => {
  const records = await getStatusLinkPreviews(db, { statusIds })
  return new Map(
    [...records.entries()].map(([statusId, record]) => [
      statusId,
      toStatusLinkPreview(record)
    ])
  )
}

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

// Batched emoji-reaction rollups for a page of statuses, in the shape the
// domain Status carries. Every hydration site uses this so none of them falls
// back to the per-status lookup — that fallback exists for single-status
// routes, not for list paths.
export const buildReactionRollupContext = async (
  db: Db,
  statusIds: string[],
  currentActorId?: string
): Promise<Map<string, StatusReaction[]>> => {
  const context = new Map<string, StatusReaction[]>(
    statusIds.map((statusId) => [statusId, []])
  )
  if (statusIds.length === 0) return context

  const rollups = await getStatusReactionRollups(db, {
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
export const buildViewerHydration = async (
  db: Db,
  statusIds: string[],
  currentActorId?: string
): Promise<Pick<
  StatusHydrationContext,
  'likedStatusIds' | 'bookmarkedStatusIds' | 'announcedStatusIds'
> | null> => {
  // No viewer means no viewer state to resolve, and the consumer must be left
  // with the fields UNSET — it reads an unset field as "not batched, look this
  // status up individually", which is the correct behaviour for anonymous
  // reads (where the lookup is skipped outright).
  if (!currentActorId) return null

  // A viewer with nothing to look up still gets empty sets rather than null:
  // returning null here would mark the page as un-batched and send every row
  // back to a per-status query. The id lists are not chunked, as before: they
  // hold one page of statuses.
  const [bookmarkRows, likeRows, announceRows] =
    statusIds.length === 0
      ? [[], [], []]
      : await Promise.all([
          db
            .selectFrom('bookmarks')
            .select('statusId')
            .where('actorId', '=', currentActorId)
            .where('statusId', 'in', statusIds)
            .execute(),
          db
            .selectFrom('likes')
            .select('statusId')
            .where('actorId', '=', currentActorId)
            .where('statusId', 'in', statusIds)
            .execute(),
          db
            .selectFrom('statuses')
            .select(['id', 'originalStatusId'])
            .where('type', '=', StatusType.enum.Announce)
            .where('actorId', '=', currentActorId)
            .where('originalStatusId', 'in', statusIds)
            .execute()
        ])
  return {
    bookmarkedStatusIds: new Set(bookmarkRows.map((row) => row.statusId)),
    likedStatusIds: new Set(likeRows.map((row) => row.statusId)),
    announcedStatusIds: new Map(
      announceRows.map(
        (row) => [row.originalStatusId as string, row.id] as const
      )
    )
  }
}

// The ids of the Notes and Polls a page of rows hydrates: the rows themselves,
// and for an Announce the status it boosts, followed down a chain of boosts
// (up to MAX_ANNOUNCE_RESOLUTION_DEPTH reads).
export const collectHydrationStatusIds = async (
  db: Db,
  statuses: StatusRow[]
): Promise<Set<string>> => {
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
        ? await db
            .selectFrom('statuses')
            .selectAll()
            .where('id', 'in', missingOriginalStatusIds)
            .execute()
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

const selectStatusQuoteEdges = (db: Db) =>
  db
    .selectFrom('status_quotes')
    .leftJoin('statuses', 'statuses.id', 'status_quotes.quotedStatusId')
    .select([
      'status_quotes.statusId',
      'status_quotes.quotedStatusId',
      'status_quotes.state',
      'status_quotes.authorizationUri',
      'statuses.url as quotedStatusUrl'
    ])

// Per-status quote-edge read used when a caller did not pre-batch them into the
// hydration context (mirrors the detected-language fallback).
const getStatusQuoteEdgeForData = async (
  db: Db,
  statusId: string
): Promise<StatusQuote | null> => {
  const row = await selectStatusQuoteEdges(db)
    .where('status_quotes.statusId', '=', statusId)
    .limit(1)
    .executeTakeFirst()
  return row ? toStatusQuoteEdge(row) : null
}

// Batch quote-edge read for a timeline page (avoids one query per status).
export const getStatusQuoteEdges = async (
  db: Db,
  statusIds: string[]
): Promise<Map<string, StatusQuote>> => {
  const edges = new Map<string, StatusQuote>()
  if (statusIds.length === 0) return edges
  const rows = await selectStatusQuoteEdges(db)
    .where('status_quotes.statusId', 'in', statusIds)
    .execute()
  for (const row of rows) edges.set(row.statusId, toStatusQuoteEdge(row))
  return edges
}

// The hydration context of a page of rows: the detected languages, quote
// edges, link previews and reactions of every status the page shows, and the
// viewer's own likes, bookmarks and boosts of them when there is a viewer.
export const buildStatusHydrationContext = async (
  db: Db,
  statuses: StatusRow[],
  currentActorId?: string
): Promise<StatusHydrationContext> => {
  const hydrationStatusIds = await collectHydrationStatusIds(db, statuses)
  const hasHydrationStatusIds = hydrationStatusIds.size > 0
  // Detected language is viewer-independent, so it's batched for every
  // fetch (not just signed-in viewers) to avoid falling back to a per-status
  // query in hydrateStatusRow. All the batched lookups run in one
  // Promise.all rather than sequentially.
  const [
    detectedLanguages,
    quoteEdges,
    linkPreviews,
    reactionRollups,
    viewerHydration
  ] = await Promise.all([
    hasHydrationStatusIds
      ? getDetectedLanguages(db, { statusIds: [...hydrationStatusIds] })
      : Promise.resolve({}),
    // Quote edges are viewer-independent, so batch them for every fetch (as
    // with detected languages) rather than falling back to a per-status
    // query in hydrateStatusRow.
    hasHydrationStatusIds
      ? getStatusQuoteEdges(db, [...hydrationStatusIds])
      : Promise.resolve(new Map<string, StatusQuote>()),
    // Link preview cards are viewer-independent too, and batched for the same
    // reason.
    hasHydrationStatusIds
      ? getStatusLinkPreviewsForIds(db, [...hydrationStatusIds])
      : Promise.resolve(new Map<string, StatusLinkPreview>()),
    buildReactionRollupContext(db, [...hydrationStatusIds], currentActorId),
    buildViewerHydration(db, [...hydrationStatusIds], currentActorId)
  ])
  return {
    detectedLanguages,
    quoteEdges,
    linkPreviews,
    reactionRollups,
    ...(viewerHydration ?? {})
  }
}

const getPollChoices = async (db: Db, statusId: string) => {
  const rows = await db
    .selectFrom('poll_choices')
    .selectAll()
    .where('statusId', '=', statusId)
    .orderBy('choiceId', 'asc')
    .execute()
  return rows.map((data) =>
    PollChoice.parse({
      ...data,
      // A NULL timestamp throws here (getCompatibleTime(null)).
      createdAt: getCompatibleTime(data.createdAt as number),
      updatedAt: getCompatibleTime(data.updatedAt as number)
    })
  )
}

const getPollVotersCount = async (
  db: Db,
  statusId: string
): Promise<number> => {
  const result = await db
    .selectFrom('poll_voters')
    .select((eb) => eb.fn.countAll().as('count'))
    .where('statusId', '=', statusId)
    .limit(1)
    .executeTakeFirst()
  return parseInt(String(result?.count ?? '0'), 10)
}

// A status can carry several fitness files (e.g. the same ride merged from two
// devices). Surface the primary one — matching getFitnessFileByStatus —
// instead of an arbitrary first row. The gear name comes along on this same
// query rather than a follow-up lookup — hydration runs per status, so a
// second round trip here is an N+1 across a whole timeline page. Every column
// is table-qualified because both tables carry `deletedAt`/`createdAt`.
const getStatusFitnessFile = (db: Db, statusId: string) =>
  db
    .selectFrom('fitness_files')
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
    .leftJoin('fitness_gears', (join) =>
      join
        .onRef('fitness_files.gearId', '=', 'fitness_gears.id')
        .on('fitness_gears.deletedAt', 'is', null)
    )
    // The recording device is a second gear row on the same status, so it
    // needs an aliased join of its own — the same table twice, with the same
    // `deletedAt` guard and for the same reasons.
    .leftJoin('fitness_gears as device_gears', (join) =>
      join
        .onRef('fitness_files.deviceGearId', '=', 'device_gears.id')
        .on('device_gears.deletedAt', 'is', null)
    )
    .selectAll('fitness_files')
    .select([
      'fitness_gears.name as gearName',
      'device_gears.name as deviceGearName'
    ])
    .where('fitness_files.statusId', '=', statusId)
    .where('fitness_files.deletedAt', 'is', null)
    .orderBy('fitness_files.isPrimary', 'desc')
    .orderBy('fitness_files.activityStartTime', 'asc')
    .orderBy('fitness_files.createdAt', 'asc')
    .limit(1)
    .executeTakeFirst()

export const getStatusWithHydration = async (
  db: Db,
  {
    statusId,
    withReplies,
    currentActorId,
    hydrationContext = {}
  }: GetStatusParams & { hydrationContext?: StatusHydrationContext }
): Promise<Status | null> => {
  const status = await db
    .selectFrom('statuses')
    .selectAll()
    .where('id', '=', statusId)
    .limit(1)
    .executeTakeFirst()
  if (!status) return null

  return hydrateStatusRow(
    db,
    status,
    currentActorId,
    withReplies,
    hydrationContext
  )
}

export const getStatus = (
  db: Db,
  { statusId, withReplies, currentActorId }: GetStatusParams
): Promise<Status | null> =>
  getStatusWithHydration(db, { statusId, currentActorId, withReplies })

// Hydrates a `statuses` row. An Announce is hydrated with the status it boosts
// (null when that is gone); `withReplies` adds the replies to a Note or Poll,
// newest first. The context's pre-batched maps and sets replace the
// per-status lookups they cover.
export const hydrateStatusRow = async (
  db: Db,
  data: StatusRow,
  currentActorId?: string,
  withReplies?: boolean,
  hydrationContext: StatusHydrationContext = {}
): Promise<Status | null> => {
  const recipients = (type: 'to' | 'cc') =>
    db
      .selectFrom('recipients')
      .selectAll()
      .where('statusId', '=', data.id)
      .where('type', '=', type)
      .execute()
  const [to, cc] = await Promise.all([recipients('to'), recipients('cc')])

  if (data.type === StatusType.enum.Announce) {
    const originalStatusId = getAnnounceOriginalStatusId(data)
    if (!originalStatusId) return null
    const [actor, originalStatus] = await Promise.all([
      getActorFromId(db, { id: data.actorId as string }),
      getStatusWithHydration(db, {
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
      createdAt: getCompatibleTime(data.createdAt as number),
      updatedAt: getCompatibleTime(data.updatedAt as number)
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
    getAttachments(db, { statusId: data.id }),
    getTags(db, { statusId: data.id }),
    withReplies
      ? db
          .selectFrom('statuses')
          .select('id')
          .where('reply', '=', data.id)
          .orderBy('createdAt', 'desc')
          .execute()
      : Promise.resolve([]),
    getActorFromId(db, { id: data.actorId as string }),
    getCounterValue(db, CounterKey.totalLike(data.id)),
    getCounterValue(db, CounterKey.totalReblog(data.id)),
    currentActorId
      ? hydrationContext.likedStatusIds
        ? hydrationContext.likedStatusIds.has(data.id)
        : isActorLikedStatus(db, {
            statusId: data.id,
            actorId: currentActorId
          })
      : false,
    currentActorId
      ? hydrationContext.bookmarkedStatusIds
        ? hydrationContext.bookmarkedStatusIds.has(data.id)
        : isActorBookmarkedStatus(db, {
            statusId: data.id,
            actorId: currentActorId,
            statusType: data.type as StatusType
          })
      : false,
    currentActorId
      ? hydrationContext.announcedStatusIds
        ? (hydrationContext.announcedStatusIds.get(data.id) ?? null)
        : getActorAnnouncedStatusId(db, {
            originalStatusId: data.id,
            actorId: currentActorId
          })
      : null,
    getStatusEditHistory(db, { statusId: data.id }),
    data.type === StatusType.enum.Poll
      ? getPollChoices(db, data.id)
      : Promise.resolve([]),
    getStatusFitnessFile(db, data.id),
    hydrationContext?.detectedLanguages
      ? (hydrationContext.detectedLanguages[data.id] ?? null)
      : getDetectedLanguage(db, { statusId: data.id }),
    // Quote edge: use the pre-batched map when present, otherwise read this
    // status's edge directly (mirrors the detected-language fallback).
    hydrationContext?.quoteEdges
      ? (hydrationContext.quoteEdges.get(data.id) ?? null)
      : getStatusQuoteEdgeForData(db, data.id),
    // Link preview card: the pre-batched map when the page covered this
    // status, otherwise a single lookup (single-status routes).
    hydrationContext?.linkPreviews
      ? (hydrationContext.linkPreviews.get(data.id) ?? null)
      : getStatusLinkPreviewsForIds(db, [data.id]).then(
          (previews) => previews.get(data.id) ?? null
        ),
    // Reaction rollups: the pre-batched map when the page covered this status,
    // otherwise a single lookup (single-status routes). `has` rather than a
    // truthiness check, so a reaction-less status resolves from the batch.
    hydrationContext?.reactionRollups?.has(data.id)
      ? (hydrationContext.reactionRollups.get(data.id) ?? [])
      : getStatusReactionRollups(db, {
          statusIds: [data.id],
          currentActorId
        }).then((rollups) =>
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
    await Promise.all(
      replies.map((item) => getStatus(db, { statusId: item.id }))
    )
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content = getCompatibleJSON<any>(data.content)
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
                processingStatus:
                  fitnessFile.processingStatus as SQLFitnessFile['processingStatus'],
                updatedAt: getCompatibleTime(fitnessFile.updatedAt as number)
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
            // The truthiness check is kept (as toFitnessFile keeps it), so an
            // epoch-0 start reads as unset, as it always did on SQLite.
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
    createdAt: getCompatibleTime(data.createdAt as number),
    updatedAt: getCompatibleTime(data.updatedAt as number),

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
      getPollVotersCount(db, data.id),
      currentActorId
        ? hasActorVoted(db, { statusId: data.id, actorId: currentActorId })
        : false,
      currentActorId
        ? getActorPollVotes(db, { statusId: data.id, actorId: currentActorId })
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
