import { Knex } from 'knex'

import { createQueueJob } from '@/lib/database/domains/queueJob/queries'
import { searchQueries } from '@/lib/database/domains/search/queries'
import { normalizeHashtagSearchName } from '@/lib/database/domains/search/rows'
import { deleteStatusSearchDocumentsByStatusIds } from '@/lib/database/domains/search/statuses'
import { getAnnounceOriginalStatusId } from '@/lib/database/domains/status/rows'
import type {
  StatusLookupDatabase,
  StatusReadDatabase,
  StatusWriteDatabase
} from '@/lib/database/domains/status/types'
import { kyselyFor } from '@/lib/database/kysely'
import {
  CounterKey,
  decreaseCounterValue,
  deleteCounterValues
} from '@/lib/database/sql/utils/counter'
import {
  chunkArray,
  deleteRowsByColumnChunks,
  getWhereInBatchSize
} from '@/lib/database/sql/utils/knex'
import { announceOriginalPointer } from '@/lib/database/sql/utils/publiclyReadableStatus'
import {
  StatusHashtagTagRow,
  selectHashtagTagsByStatusIds,
  selectPubliclyAddressedStatusIds
} from '@/lib/database/sql/utils/status'
import { PUBLIC_ACTIVITY_RECIPIENTS } from '@/lib/database/sql/utils/statusVisibility'
import {
  DeleteStatusParams,
  DeleteStatusWithQueueJobParams,
  GetStatusEditHistoryParams,
  StatusDatabase
} from '@/lib/types/database/operations'
import { StatusType } from '@/lib/types/domain/status'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

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

// The Kysely twin is publiclyReadableStatusIds
// (lib/database/kysely/visibility/publiclyReadable.ts), which getRebloggedBy
// and getActorStatusesCount use. This Knex form has no production caller
// left: it stays as the reference publiclyReadableStatusEquivalence.test.ts
// runs the twin against over the same rows, and statusReadableSql.test.ts
// pins its compiled SQL, MySQL branch included.
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
// subquery to filter against. Its Kysely twin actorVisibleStatusIds
// (lib/database/kysely/visibility/actorVisible.ts) is what `getActorStatuses`
// filters `statuses.id` by and `getAttachmentsForActor` filters
// `attachments.statusId` by, so a followers-only post's images are withheld
// from exactly the viewers the post itself is withheld from. This Knex form
// has no production caller left; it stays as the reference
// actorVisibleEquivalence.test.ts holds the twin to, so change both together.
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

// Status deletion, the one part of the status domain still on Knex (the rest
// is lib/database/domains/status/). getSQLDatabase spreads these methods into
// the facade beside the Kysely ones. buildPubliclyReadableStatusIdsQuery and
// buildActorVisibleStatusIdsQuery above are the Knex forms only the
// equivalence tests still use.
export type StatusKnexDatabase = Omit<
  StatusDatabase,
  | keyof StatusLookupDatabase
  | keyof StatusWriteDatabase
  | keyof StatusReadDatabase
>

export const StatusSQLDatabaseMixin = (database: Knex): StatusKnexDatabase => {
  const getStatusUrlHash = (url: string): string => getHashFromString(url)

  async function deleteStatusEditHistory({
    statusId
  }: GetStatusEditHistoryParams): Promise<void> {
    await database('status_history').where('statusId', statusId).delete()
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
          // `updateStatusCounters` in `lib/database/domains/status/writes.ts`),
          // so they must not set it here either — deleting the newest public
          // post would otherwise reveal the date of a later direct message.
          // "Not direct" is `getVisibility`'s rule: addressed to the public
          // collection or to a followers collection.
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

  return {
    deleteStatusEditHistory,
    deleteStatus,
    deleteStatusWithQueueJob
  }
}
