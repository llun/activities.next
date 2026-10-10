import {
  type DirectConversationMembershipRow,
  type DirectConversationStatusRow,
  getMembershipReadStateForStatus
} from '@/lib/database/domains/conversation/ordering'
import type { DirectConversation } from '@/lib/database/domains/conversation/types'
import type { Db } from '@/lib/database/kysely'
import { pastKeyset } from '@/lib/database/kysely/keyset'
import type { StatusDatabase } from '@/lib/types/database/operations'

/**
 * Where this domain gets hydrated statuses from: the status facade, injected
 * by lib/database/sql/index.ts until status is ported. It runs on the root
 * Knex instance, so it is only ever called outside this domain's
 * transactions.
 */
export type ConversationStatusSource = Pick<StatusDatabase, 'getStatusesByIds'>

const DIRECT_CONVERSATION_FALLBACK_STATUS_BATCH_SIZE = 50
const MAX_DIRECT_CONVERSATION_FALLBACK_STATUS_BATCHES = 4

export const statusKeyset = (cursor: DirectConversationStatusRow) => ({
  createdAt: cursor.createdAt,
  tieBreaker: cursor.statusId
})

export const getStatusesByIdVisibleToActor = async (
  statuses: ConversationStatusSource,
  statusIds: string[],
  actorId: string
) => {
  const rows = await statuses.getStatusesByIds({
    statusIds,
    currentActorId: actorId,
    visibleToActorId: actorId
  })
  return new Map(rows.map((status) => [status.id, status]))
}

// Up to DIRECT_CONVERSATION_FALLBACK_STATUS_BATCH_SIZE newest statuses of each
// conversation, older than that conversation's cursor when it has one.
const getFallbackStatusRowsForConversations = async (
  db: Db,
  {
    conversationIds,
    cursorByConversationId
  }: {
    conversationIds: string[]
    cursorByConversationId: Map<string, DirectConversationStatusRow>
  }
): Promise<DirectConversationStatusRow[]> => {
  if (conversationIds.length === 0) return []

  const rankedRowsQuery = db
    .selectFrom('direct_conversation_statuses')
    .select((eb) => [
      'conversationId',
      'statusId',
      'createdAt',
      eb.fn
        .agg<number>('row_number')
        .over((ob) =>
          ob
            .partitionBy('conversationId')
            .orderBy('createdAt', 'desc')
            .orderBy('statusId', 'desc')
        )
        .as('conversationStatusRank')
    ])
    .where((eb) =>
      eb.or(
        conversationIds.map((conversationId) => {
          const cursor = cursorByConversationId.get(conversationId)
          const inConversation = eb('conversationId', '=', conversationId)
          if (!cursor) return inConversation
          return eb.and([
            inConversation,
            pastKeyset(eb, statusKeyset(cursor), '<', 'statusId')
          ])
        })
      )
    )

  return db
    .selectFrom(rankedRowsQuery.as('ranked_direct_conversation_statuses'))
    .select(['conversationId', 'statusId', 'createdAt'])
    .where(
      'conversationStatusRank',
      '<=',
      DIRECT_CONVERSATION_FALLBACK_STATUS_BATCH_SIZE
    )
    .orderBy('conversationId', 'asc')
    .orderBy('createdAt', 'desc')
    .orderBy('statusId', 'desc')
    .execute()
}

// Turns membership rows into conversations with their last status. A row
// whose last status the actor cannot see (deleted, or narrowed away from
// them) falls back to the newest status of the conversation they can see;
// the stored row is left as it is.
export const hydrateConversationRows = async (
  db: Db,
  statuses: ConversationStatusSource,
  rows: DirectConversationMembershipRow[],
  currentActorId: string
): Promise<DirectConversation[]> => {
  if (rows.length === 0) return []

  const conversationIds = rows.map((row) => row.conversationId)
  const participantRows = await db
    .selectFrom('direct_conversation_participants')
    .select(['conversationId', 'actorId'])
    .where('conversationId', 'in', conversationIds)
    .execute()
  const participantActorIdsByConversationId = participantRows.reduce(
    (output, participant) => {
      output[participant.conversationId] =
        output[participant.conversationId] || []
      output[participant.conversationId].push(participant.actorId)
      return output
    },
    {} as Record<string, string[]>
  )
  const statusById = await getStatusesByIdVisibleToActor(
    statuses,
    rows.map((row) => row.lastStatusId),
    currentActorId
  )
  const rowsMissingLastStatus = rows.filter(
    (row) => !statusById.has(row.lastStatusId)
  )
  const fallbackStatusRowsByConversationId = new Map<
    string,
    DirectConversationStatusRow
  >()

  if (rowsMissingLastStatus.length > 0) {
    const unresolvedFallbackConversationIds = new Set(
      rowsMissingLastStatus.map((row) => row.conversationId)
    )
    const fallbackCursorByConversationId = new Map<
      string,
      DirectConversationStatusRow
    >()

    for (
      let batchIndex = 0;
      batchIndex < MAX_DIRECT_CONVERSATION_FALLBACK_STATUS_BATCHES &&
      unresolvedFallbackConversationIds.size > 0;
      batchIndex += 1
    ) {
      const fallbackRows = await getFallbackStatusRowsForConversations(db, {
        conversationIds: [...unresolvedFallbackConversationIds],
        cursorByConversationId: fallbackCursorByConversationId
      })
      if (fallbackRows.length === 0) break

      const fallbackRowsByConversationId = fallbackRows.reduce(
        (output, fallbackRow) => {
          const conversationRows = output.get(fallbackRow.conversationId) || []
          conversationRows.push(fallbackRow)
          output.set(fallbackRow.conversationId, conversationRows)
          return output
        },
        new Map<string, DirectConversationStatusRow[]>()
      )
      const fallbackStatusById = await getStatusesByIdVisibleToActor(
        statuses,
        fallbackRows.map((row) => row.statusId),
        currentActorId
      )

      for (const conversationId of [...unresolvedFallbackConversationIds]) {
        const conversationFallbackRows =
          fallbackRowsByConversationId.get(conversationId) || []
        if (conversationFallbackRows.length === 0) {
          unresolvedFallbackConversationIds.delete(conversationId)
          continue
        }

        for (const fallbackRow of conversationFallbackRows) {
          const fallbackStatus = fallbackStatusById.get(fallbackRow.statusId)
          if (!fallbackStatus) continue

          fallbackStatusRowsByConversationId.set(conversationId, fallbackRow)
          statusById.set(fallbackStatus.id, fallbackStatus)
          unresolvedFallbackConversationIds.delete(conversationId)
          break
        }

        if (
          fallbackStatusRowsByConversationId.has(conversationId) ||
          conversationFallbackRows.length <
            DIRECT_CONVERSATION_FALLBACK_STATUS_BATCH_SIZE
        ) {
          unresolvedFallbackConversationIds.delete(conversationId)
          continue
        }

        fallbackCursorByConversationId.set(
          conversationId,
          conversationFallbackRows[conversationFallbackRows.length - 1]
        )
      }
    }
  }

  for (const row of rowsMissingLastStatus) {
    const fallbackRow = fallbackStatusRowsByConversationId.get(
      row.conversationId
    )
    if (!fallbackRow || fallbackRow.statusId === row.lastStatusId) continue

    const fallbackStatus = statusById.get(fallbackRow.statusId)
    if (!fallbackStatus) continue

    const readState = getMembershipReadStateForStatus({
      actorId: currentActorId,
      status: fallbackStatus,
      statusCreatedAt: fallbackRow.createdAt,
      readAt: row.readAt
    })

    row.lastStatusId = fallbackRow.statusId
    row.lastStatusCreatedAt = fallbackRow.createdAt
    row.unread = readState.unread
    row.readAt = readState.readAt
  }

  return rows
    .map((row) => {
      const lastStatus = statusById.get(row.lastStatusId)
      if (!lastStatus) return null
      return {
        id: String(row.id),
        actorId: row.actorId,
        conversationId: row.conversationId,
        rootStatusId: row.rootStatusId,
        participantActorIds:
          participantActorIdsByConversationId[row.conversationId] || [],
        lastStatusId: row.lastStatusId,
        lastStatus,
        lastStatusCreatedAt: row.lastStatusCreatedAt,
        unread: row.unread,
        readAt: row.readAt ? row.readAt : null,
        hiddenAt: row.hiddenAt ? row.hiddenAt : null,
        // Nullable in the schema, but every writer sets both.
        createdAt: row.createdAt ?? 0,
        updatedAt: row.updatedAt ?? 0
      }
    })
    .filter(
      (conversation): conversation is DirectConversation =>
        conversation !== null
    )
}
