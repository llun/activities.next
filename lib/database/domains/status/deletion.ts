import { createQueueJob } from '@/lib/database/domains/queueJob/queries'
import { searchQueries } from '@/lib/database/domains/search/queries'
import { normalizeHashtagSearchName } from '@/lib/database/domains/search/rows'
import { deleteStatusSearchDocumentsByStatusIds } from '@/lib/database/domains/search/statuses'
import { selectHashtagTagsByStatusIds } from '@/lib/database/domains/status/hashtags'
import { getAnnounceOriginalStatusId } from '@/lib/database/domains/status/rows'
import type {
  DeleteStatusParams,
  DeleteStatusWithQueueJobParams,
  GetStatusEditHistoryParams
} from '@/lib/database/domains/status/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import {
  decreaseCounterValue,
  deleteCounterValues
} from '@/lib/database/kysely/counter'
import { forUpdate } from '@/lib/database/kysely/dialect'
import {
  getWhereInBatchSize,
  selectInChunks
} from '@/lib/database/kysely/inList'
import { PUBLIC_ACTIVITY_RECIPIENTS } from '@/lib/database/kysely/visibility/potentiallyReadable'
import { CounterKey } from '@/lib/database/sql/utils/counter'
import { chunkArray } from '@/lib/database/sql/utils/knex'
import { StatusType } from '@/lib/types/domain/status'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

// Status deletion: a status with its reply tree, every row that hangs off
// those statuses and the counters they moved, in one transaction, and the
// edit-history purge. The hashtag search documents the deleted tags fed are
// refreshed after the transaction commits, best effort.

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

// Runs `run` once per chunk of `values`, one after the other, each chunk as
// long as one `in (…)` list may be.
const forEachChunk = async <Value>(
  db: Db,
  values: Value[],
  run: (chunk: Value[]) => Promise<unknown>
) => {
  for (const chunk of chunkArray(values, getWhereInBatchSize(db))) {
    await run(chunk)
  }
}

export const deleteStatusEditHistory = async (
  db: Db,
  { statusId }: GetStatusEditHistoryParams
): Promise<void> => {
  await db
    .deleteFrom('status_history')
    .where('statusId', '=', statusId)
    .execute()
}

// The subset of `statusIds` that is publicly addressed, read from
// `recipients`: `isPubliclyAddressed` (lib/database/sql/utils/status.ts) at
// create time, which decided whether a reply moved its parent's reply counter
// and a tag its hashtag counter. The deletions read it to move back only what
// was moved, so it MUST run before those statuses' recipient rows are removed.
export const selectPubliclyAddressedStatusIds = async (
  db: Db,
  statusIds: string[]
): Promise<Set<string>> => {
  const rows = await selectInChunks(
    db,
    statusIds,
    (chunk) =>
      db
        .selectFrom('recipients')
        .select('statusId')
        .distinct()
        .where('statusId', 'in', chunk)
        .where('actorId', 'in', PUBLIC_ACTIVITY_RECIPIENTS)
        .execute(),
    PUBLIC_ACTIVITY_RECIPIENTS.length
  )
  return new Set(rows.map((row) => row.statusId as string))
}

const addCounterAdjustment = (
  adjustments: Map<string, number>,
  counterKey: string,
  amount = 1
) => {
  adjustments.set(counterKey, (adjustments.get(counterKey) ?? 0) + amount)
}

const selectStatusDeletionRowsByIds = (trx: Db, statusIds: string[]) =>
  selectInChunks(trx, statusIds, (chunk) =>
    trx
      .selectFrom('statuses')
      .select(['id', 'actorId', 'type', 'reply', 'content', 'originalStatusId'])
      .where('id', 'in', chunk)
      .$narrowType<StatusDeletionRow>()
      .execute()
  )

// Reply traversal stays on statuses.reply, which is indexed by migration.
const selectReplyIdsByStatusIds = (trx: Db, statusIds: string[]) =>
  selectInChunks(trx, statusIds, (chunk) =>
    trx
      .selectFrom('statuses')
      .select('id')
      .where('reply', 'in', chunk)
      .$narrowType<{ id: string }>()
      .execute()
  )

const statusActorMatches = (statusActorId: string, actorId: string) => {
  const normalizedStatusActorId = normalizeActorId(statusActorId)
  const normalizedExpectedActorId = normalizeActorId(actorId)
  return (
    normalizedStatusActorId !== null &&
    normalizedExpectedActorId !== null &&
    normalizedStatusActorId === normalizedExpectedActorId
  )
}

const selectLocalActorIds = async (trx: Db, actorIds: string[]) => {
  const rows = await selectInChunks(trx, actorIds, (chunk) =>
    trx
      .selectFrom('actors')
      .select('id')
      .where('id', 'in', chunk)
      .where('accountId', 'is not', null)
      .execute()
  )
  return new Set(rows.map((row) => row.id))
}

const resolveParentStatusIdsByReplyReferences = async (
  trx: Db,
  replyReferences: string[]
) => {
  const referenceToStatusId = new Map<string, string>()
  const uniqueReplyReferences = [
    ...new Set(replyReferences.filter((reply) => reply.length > 0))
  ]
  // Each reference is bound three times: as an id, a url and a url hash.
  const batchSize = Math.max(1, Math.floor(getWhereInBatchSize(trx) / 3))

  for (const replyReferenceChunk of chunkArray(
    uniqueReplyReferences,
    batchSize
  )) {
    const replyReferenceHashes = replyReferenceChunk.map((reply) =>
      getHashFromString(reply)
    )
    const rows = await trx
      .selectFrom('statuses')
      .select(['id', 'url'])
      .where((eb) =>
        eb.or([
          eb('id', 'in', replyReferenceChunk),
          eb.and([
            eb('urlHash', 'in', replyReferenceHashes),
            eb('url', 'in', replyReferenceChunk)
          ])
        ])
      )
      .$narrowType<{ id: string }>()
      .execute()

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
  trx: Db
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
        addCounterAdjustment(adjustments, CounterKey.totalReply(parentStatusId))
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
  tags: { statusId: string; name: string }[]
  trx: Db
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
  trx: Db
}) => {
  const uniqueActorIds = [...new Set(actorIds)]
  if (uniqueActorIds.length === 0) return

  await forEachChunk(trx, uniqueActorIds, async (actorIdChunk) => {
    // Lock the affected actor rows before recomputing (no-op on SQLite, which
    // serializes writers; matches the pinStatus precedent). This recompute is
    // an unconditional overwrite, so without the lock a concurrent create — whose
    // guarded lastStatusAt bump holds the same row lock until it commits — could,
    // under PostgreSQL READ COMMITTED, let this statement's stale snapshot
    // clobber the just-committed newer value with an older MAX (or NULL). Taking
    // the lock first serializes the two and forces the following UPDATE to take a
    // fresh snapshot that already sees the new status.
    await forUpdate(
      trx,
      trx.selectFrom('actors').select('id').where('id', 'in', actorIdChunk)
    ).execute()
    await trx
      .updateTable('actors')
      .set((eb) => ({
        // Direct statuses never advanced `lastStatusAt` on create (see
        // `updateStatusCounters` in `./writes.ts`), so they must not set it
        // here either — deleting the newest public post would otherwise reveal
        // the date of a later direct message. "Not direct" is
        // `getVisibility`'s rule: addressed to the public collection or to a
        // followers collection.
        lastStatusAt: eb
          .selectFrom('statuses')
          .select((max) => max.fn.max('createdAt').as('lastStatusAt'))
          .whereRef('statuses.actorId', '=', 'actors.id')
          .where((exists) =>
            exists.exists(
              exists
                .selectFrom('recipients')
                .select(exists.lit(1).as('one'))
                .whereRef('recipients.statusId', '=', 'statuses.id')
                .where((audience) =>
                  audience.or([
                    audience(
                      'recipients.actorId',
                      'in',
                      PUBLIC_ACTIVITY_RECIPIENTS
                    ),
                    audience('recipients.actorId', 'like', '%/followers')
                  ])
                )
            )
          )
          // The column reads back as EpochMs and is written as a Date; the
          // database moves the value across as it is.
          .$castTo<{ lastStatusAt: Date | null }>()
      }))
      .where('id', 'in', actorIdChunk)
      .execute()
  })
}

const collectStatusDeletionRows = async ({
  actorId,
  statusId,
  trx
}: DeleteStatusParams & {
  trx: Db
}) => {
  const levels: StatusDeletionRow[][] = []
  const seen = new Set<string>([statusId])
  let currentStatusIds = [statusId]

  for (let depth = 0; currentStatusIds.length > 0; depth += 1) {
    if (depth >= MAX_STATUS_REPLY_DELETE_DEPTH) {
      throw statusReplyDeletionDepthError(statusId)
    }

    const rows = await selectStatusDeletionRowsByIds(trx, currentStatusIds)
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

// With an actor scope the status delete also binds each chunk's distinct
// author ids, so a chunk closes before its ids and authors together would
// pass the binding limit.
const chunkStatusDeletionRows = ({
  actorId,
  statuses,
  trx
}: {
  actorId?: string
  statuses: StatusDeletionRow[]
  trx: Db
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
  trx: Db
}) => {
  for (const statusChunk of chunkStatusDeletionRows({
    actorId,
    statuses,
    trx
  })) {
    await trx
      .deleteFrom('statuses')
      .where(
        'id',
        'in',
        statusChunk.map((status) => status.id)
      )
      .$if(Boolean(actorId), (query) =>
        query.where('actorId', 'in', [
          ...new Set(statusChunk.map((status) => status.actorId))
        ])
      )
      .execute()
  }
}

// Keep hashtag aggregate writes outside the delete transaction. A full
// reindexSearchHashtags run can reconcile this if the process exits after
// commit and before this best-effort refresh completes. Called through
// searchQueries, so a test can stand in for it.
const refreshAffectedHashtags = async (
  db: Db,
  {
    collectedHashtags,
    statusId
  }: {
    collectedHashtags: string[]
    statusId: string
  }
) => {
  if (collectedHashtags.length === 0) return
  try {
    await searchQueries.indexHashtagSearchDocuments(db, {
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

// The deletion transaction's body: every statement runs on `trx`. Returns
// false, having written nothing, when there is nothing to delete (no such
// status, or one of another actor's when `actorId` is given).
const executeStatusDeletion = async ({
  actorId,
  affectedHashtags,
  statusId,
  trx
}: {
  actorId?: string
  affectedHashtags: string[]
  statusId: string
  trx: Db
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

  const hashtagTags = await selectHashtagTagsByStatusIds(trx, statusIdsToDelete)
  await applyHashtagDeletionCounterAdjustments({
    currentTime,
    publiclyAddressedStatusIds,
    tags: hashtagTags,
    trx
  })
  affectedHashtags.push(...hashtagTags.map((tag) => tag.name))

  const deleteByStatusIds = (remove: (chunk: string[]) => Promise<unknown>) =>
    forEachChunk(trx, statusIdsToDelete, remove)

  await deleteByStatusIds((chunk) =>
    trx.deleteFrom('recipients').where('statusId', 'in', chunk).execute()
  )
  await deleteByStatusIds((chunk) =>
    trx.deleteFrom('likes').where('statusId', 'in', chunk).execute()
  )
  // Emoji reactions follow the status, like favourites do. A remote status
  // that is deleted and later re-fetched under the same id would otherwise
  // come back wearing its old reaction chips.
  await deleteByStatusIds((chunk) =>
    trx.deleteFrom('status_reactions').where('statusId', 'in', chunk).execute()
  )
  await deleteByStatusIds((chunk) =>
    trx.deleteFrom('tags').where('statusId', 'in', chunk).execute()
  )
  await deleteByStatusIds((chunk) =>
    trx.deleteFrom('attachments').where('statusId', 'in', chunk).execute()
  )
  await deleteByStatusIds((chunk) =>
    trx.deleteFrom('bookmarks').where('statusId', 'in', chunk).execute()
  )
  await deleteByStatusIds((chunk) =>
    trx.deleteFrom('status_pins').where('statusId', 'in', chunk).execute()
  )
  // The deleted status's own outgoing quote edge is removed with it.
  await deleteByStatusIds((chunk) =>
    trx.deleteFrom('status_quotes').where('statusId', 'in', chunk).execute()
  )
  // Statuses that quote a now-deleted status keep their edge but move to
  // `deleted` (the quoting posts survive and render a tombstone). Terminal
  // edges (rejected/revoked/deleted) are left untouched.
  await deleteByStatusIds((chunk) =>
    trx
      .updateTable('status_quotes')
      .set({ state: 'deleted', updatedAt: currentTime })
      .where('quotedStatusId', 'in', chunk)
      .where('state', 'in', ['pending', 'accepted'])
      .execute()
  )
  await deleteByStatusIds((chunk) =>
    trx.deleteFrom('status_history').where('statusId', 'in', chunk).execute()
  )
  await deleteByStatusIds((chunk) =>
    trx.deleteFrom('poll_answers').where('statusId', 'in', chunk).execute()
  )
  await deleteByStatusIds((chunk) =>
    trx.deleteFrom('poll_voters').where('statusId', 'in', chunk).execute()
  )
  await deleteByStatusIds((chunk) =>
    trx.deleteFrom('poll_choices').where('statusId', 'in', chunk).execute()
  )
  await deleteByStatusIds((chunk) =>
    trx.deleteFrom('timelines').where('statusId', 'in', chunk).execute()
  )
  // Mirror the `timelines` cleanup for the collection fan-out feed so deleting
  // a status does not leave orphaned rows in the high-row-count
  // `collection_timeline` table (matching the materialized-timeline pattern
  // rather than a DB foreign key, which the sibling `timelines` table also
  // does not use).
  await deleteByStatusIds((chunk) =>
    trx
      .deleteFrom('collection_timeline')
      .where('statusId', 'in', chunk)
      .execute()
  )
  await deleteByStatusIds((chunk) =>
    trx.deleteFrom('notifications').where('statusId', 'in', chunk).execute()
  )
  await deleteByStatusIds((chunk) =>
    trx
      .deleteFrom('direct_conversation_statuses')
      .where('statusId', 'in', chunk)
      .execute()
  )
  // Clean up idempotency keys that pointed at the deleted status so a retried
  // create with the same key does not resolve to a now-missing status (which
  // would otherwise let the retry create a duplicate). Likewise drop any
  // conversation mute rows keyed on a deleted thread root.
  await deleteByStatusIds((chunk) =>
    trx.deleteFrom('idempotency_keys').where('statusId', 'in', chunk).execute()
  )
  await deleteByStatusIds((chunk) =>
    trx.deleteFrom('status_mutes').where('statusId', 'in', chunk).execute()
  )
  await deleteByStatusIds((chunk) =>
    trx
      .deleteFrom('status_detected_languages')
      .where('statusId', 'in', chunk)
      .execute()
  )
  // Only the status→card link goes; `link_previews` is a per-URL cache shared
  // with every other status that links the same page. Without this the rows
  // accumulate one per deleted status forever (there is no FK by design), and
  // a deleted-then-refetched remote status could come back wearing its old
  // card.
  await deleteByStatusIds((chunk) =>
    trx
      .deleteFrom('status_link_previews')
      .where('statusId', 'in', chunk)
      .execute()
  )
  await deleteByStatusIds(async (statusIdChunk) => {
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
    await trx
      .updateTable('wahoo_imports')
      .set(wahooTombstone)
      .where('statusId', 'in', statusIdChunk)
      .execute()
    await trx
      .updateTable('wahoo_imports')
      .set(wahooTombstone)
      .where(
        'fitnessFileId',
        'in',
        trx
          .selectFrom('fitness_files')
          .select('id')
          .where('statusId', 'in', statusIdChunk)
      )
      .execute()
    await trx
      .updateTable('fitness_files')
      .set({ statusId: null })
      .where('statusId', 'in', statusIdChunk)
      .execute()
  })
  await deleteStatusRowsByIdChunks({
    actorId,
    statuses: statusesToDelete,
    trx
  })
  await recomputeActorsLastStatusAt({
    actorIds: statusesToDelete.map((status) => status.actorId),
    trx
  })
  await deleteStatusSearchDocumentsByStatusIds(trx, statusIdsToDelete)
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

// Deletes the status and its reply tree (with `actorId`, only the statuses
// of that actor, and nothing when the root is another actor's) in one
// transaction, then refreshes the affected hashtags' search documents.
export const deleteStatus = async (
  db: Db,
  { actorId, statusId }: DeleteStatusParams
): Promise<void> => {
  const collectedHashtags: string[] = []
  await inTransaction(db, (trx) =>
    executeStatusDeletion({
      actorId,
      affectedHashtags: collectedHashtags,
      statusId,
      trx
    })
  )
  await refreshAffectedHashtags(db, { collectedHashtags, statusId })
}

// deleteStatus with `actorId` plus a queue job, inserted in the same
// transaction only when something was deleted. Returns whether it was.
export const deleteStatusWithQueueJob = async (
  db: Db,
  { actorId, statusId, queueJob }: DeleteStatusWithQueueJobParams
): Promise<boolean> => {
  const collectedHashtags: string[] = []
  const deleted = await inTransaction(db, async (trx) => {
    const isDeleted = await executeStatusDeletion({
      actorId,
      affectedHashtags: collectedHashtags,
      statusId,
      trx
    })
    if (!isDeleted) {
      return false
    }

    await createQueueJob(trx, queueJob)
    return true
  })

  if (!deleted) {
    return false
  }

  await refreshAffectedHashtags(db, { collectedHashtags, statusId })
  return true
}
