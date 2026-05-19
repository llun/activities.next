import { createHash, randomUUID } from 'crypto'
import { Knex } from 'knex'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { isUniqueConstraintError } from '@/lib/database/sql/utils/isUniqueConstraintError'
import {
  DirectConversation,
  DirectConversationDatabase,
  GetDirectConversationParams,
  GetDirectConversationStatusesParams,
  GetDirectConversationsParams,
  HideDirectConversationParams,
  MarkDirectConversationReadParams,
  StatusDatabase,
  SyncDirectConversationForStatusParams
} from '@/lib/types/database/operations'
import { Status, StatusNote, StatusPoll } from '@/lib/types/domain/status'
import {
  getDirectStatusParticipantActorIds,
  isDirectStatus
} from '@/lib/utils/directStatus'

type DirectConversationMembershipRow = {
  id: string | number
  actorId: string
  conversationId: string
  rootStatusId: string
  lastStatusId: string
  lastStatusCreatedAt: Date | string | number
  unread: boolean | number
  readAt: Date | string | number | null
  hiddenAt: Date | string | number | null
  createdAt: Date | string | number
  updatedAt: Date | string | number
}

type DirectConversationStatusRow = {
  conversationId: string
  statusId: string
  createdAt: Date | string | number
}

const MAX_DIRECT_CONVERSATION_ROOT_DEPTH = 50
const DIRECT_CONVERSATION_FALLBACK_STATUS_BATCH_SIZE = 50
const MAX_DIRECT_CONVERSATION_FALLBACK_STATUS_BATCHES = 4
const MAX_BIGINT_ID = '9223372036854775807'

const getConversationIdForRootStatusId = (rootStatusId: string) =>
  createHash('sha256').update(rootStatusId).digest('hex')

const normalizeMembershipId = (id: string) => {
  if (!/^[0-9]+$/.test(id)) return null

  const normalizedId = id.replace(/^0+/, '')
  if (!normalizedId) return null
  if (normalizedId.length > MAX_BIGINT_ID.length) return null
  if (
    normalizedId.length === MAX_BIGINT_ID.length &&
    normalizedId > MAX_BIGINT_ID
  )
    return null

  return normalizedId
}

const isValidMembershipId = (id: string) => normalizeMembershipId(id) !== null

const compareMembershipIdsDesc = (
  left: string | number,
  right: string | number
) => {
  const leftId = BigInt(String(left))
  const rightId = BigInt(String(right))

  if (leftId === rightId) return 0
  return leftId > rightId ? -1 : 1
}

const compareMembershipOrderDesc = (
  left: Pick<DirectConversationMembershipRow, 'id' | 'lastStatusCreatedAt'>,
  right: Pick<DirectConversationMembershipRow, 'id' | 'lastStatusCreatedAt'>
) => {
  const leftTime = getCompatibleTime(left.lastStatusCreatedAt)
  const rightTime = getCompatibleTime(right.lastStatusCreatedAt)

  if (leftTime !== rightTime) return rightTime - leftTime
  return compareMembershipIdsDesc(left.id, right.id)
}

const compareConversationOrderDesc = (
  left: Pick<DirectConversation, 'id' | 'lastStatusCreatedAt'>,
  right: Pick<DirectConversation, 'id' | 'lastStatusCreatedAt'>
) => {
  if (left.lastStatusCreatedAt !== right.lastStatusCreatedAt)
    return right.lastStatusCreatedAt - left.lastStatusCreatedAt
  return compareMembershipIdsDesc(left.id, right.id)
}

const compareConversationToMembershipOrderDesc = (
  conversation: Pick<DirectConversation, 'id' | 'lastStatusCreatedAt'>,
  membership: Pick<
    DirectConversationMembershipRow,
    'id' | 'lastStatusCreatedAt'
  >
) =>
  compareMembershipOrderDesc(
    {
      id: conversation.id,
      lastStatusCreatedAt: conversation.lastStatusCreatedAt
    },
    membership
  )

const isMembershipOlderThanStatus = (
  membership: DirectConversationMembershipRow,
  status: Status
) => {
  const membershipTime = getCompatibleTime(membership.lastStatusCreatedAt)
  if (membershipTime !== status.createdAt)
    return membershipTime < status.createdAt
  return String(membership.lastStatusId) < status.id
}

const getMembershipReadStateForStatus = ({
  actorId,
  status,
  statusCreatedAt,
  readAt
}: {
  actorId: string
  status: Status
  statusCreatedAt: Date | string | number
  readAt: DirectConversationMembershipRow['readAt']
}) => {
  const readAtTime = readAt ? getCompatibleTime(readAt) : null
  const statusTime = getCompatibleTime(statusCreatedAt)

  if (actorId === status.actorId)
    return {
      unread: false,
      readAt: readAtTime && readAtTime > statusTime ? readAt : statusCreatedAt
    }

  if (readAtTime && readAtTime >= statusTime)
    return {
      unread: false,
      readAt
    }

  return {
    unread: true,
    readAt
  }
}

const applyMembershipCursor = (
  query: Knex.QueryBuilder,
  cursor: DirectConversationMembershipRow,
  direction: 'older' | 'newer'
) => {
  const createdAtOperator = direction === 'older' ? '<' : '>'
  const idOperator = direction === 'older' ? '<' : '>'

  query.andWhere((builder) => {
    builder
      .where(
        'direct_conversation_memberships.lastStatusCreatedAt',
        createdAtOperator,
        cursor.lastStatusCreatedAt
      )
      .orWhere((tieBreaker) => {
        tieBreaker
          .where(
            'direct_conversation_memberships.lastStatusCreatedAt',
            cursor.lastStatusCreatedAt
          )
          .andWhere('direct_conversation_memberships.id', idOperator, cursor.id)
      })
  })
}

const applyStatusCursorCondition = (
  builder: Knex.QueryBuilder,
  cursor: DirectConversationStatusRow,
  direction: 'older' | 'newer'
) => {
  const createdAtOperator = direction === 'older' ? '<' : '>'
  const idOperator = direction === 'older' ? '<' : '>'

  builder
    .where('createdAt', createdAtOperator, cursor.createdAt)
    .orWhere((tieBreaker) => {
      tieBreaker
        .where('createdAt', cursor.createdAt)
        .andWhere('statusId', idOperator, cursor.statusId)
    })
}

const applyStatusCursor = (
  query: Knex.QueryBuilder,
  cursor: DirectConversationStatusRow,
  direction: 'older' | 'newer'
) => {
  query.andWhere((builder) => {
    applyStatusCursorCondition(builder, cursor, direction)
  })
}

const insertIfMissing = async ({
  trx,
  table,
  where,
  values
}: {
  trx: Knex.Transaction
  table: string
  where: Record<string, string>
  values: Record<string, unknown>
}) => {
  try {
    await trx(table).insert(values).onConflict(Object.keys(where)).ignore()
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
  }
}

const insertDirectConversationParticipantsIfMissing = async ({
  trx,
  conversationId,
  actorIds,
  currentTime
}: {
  trx: Knex.Transaction
  conversationId: string
  actorIds: string[]
  currentTime: Date
}) => {
  if (actorIds.length === 0) return

  const existingRows = await trx('direct_conversation_participants')
    .where('conversationId', conversationId)
    .whereIn('actorId', actorIds)
    .select<{ actorId: string }[]>('actorId')
  const existingActorIds = new Set(existingRows.map((row) => row.actorId))
  const missingRows = actorIds
    .filter((actorId) => !existingActorIds.has(actorId))
    .map((actorId) => ({
      id: randomUUID(),
      conversationId,
      actorId,
      createdAt: currentTime,
      updatedAt: currentTime
    }))

  if (missingRows.length === 0) return

  await trx('direct_conversation_participants')
    .insert(missingRows)
    .onConflict(['conversationId', 'actorId'])
    .ignore()
}

export const DirectConversationSQLDatabaseMixin = (
  database: Knex,
  statusDatabase: StatusDatabase
): DirectConversationDatabase => {
  const getSyncedRootStatusId = async (statusId: string) => {
    const row = await database('direct_conversation_statuses')
      .innerJoin(
        'direct_conversations',
        'direct_conversation_statuses.conversationId',
        'direct_conversations.id'
      )
      .where('direct_conversation_statuses.statusId', statusId)
      .select<{ rootStatusId: string }[]>('direct_conversations.rootStatusId')
      .first()
    return row?.rootStatusId ?? null
  }

  const resolveConversationRootStatusId = async (
    status: StatusNote | StatusPoll
  ) => {
    let root = status
    const seen = new Set([status.id])

    for (
      let depth = 0;
      depth < MAX_DIRECT_CONVERSATION_ROOT_DEPTH && root.reply;
      depth += 1
    ) {
      const syncedRootStatusId = await getSyncedRootStatusId(root.reply)
      if (syncedRootStatusId) return syncedRootStatusId

      const parentStatus = await statusDatabase.getStatus({
        statusId: root.reply,
        withReplies: false
      })
      if (!parentStatus || !isDirectStatus(parentStatus)) break
      if (seen.has(parentStatus.id)) break
      seen.add(parentStatus.id)
      root = parentStatus
    }

    return root.id
  }

  const getStatusesByIdVisibleToActor = async (
    statusIds: string[],
    actorId: string
  ) => {
    const statuses = await statusDatabase.getStatusesByIds({
      statusIds,
      currentActorId: actorId,
      visibleToActorId: actorId
    })
    return new Map(statuses.map((status) => [status.id, status]))
  }

  const getFallbackStatusRowsForConversations = async ({
    conversationIds,
    cursorByConversationId
  }: {
    conversationIds: string[]
    cursorByConversationId: Map<string, DirectConversationStatusRow>
  }) => {
    if (conversationIds.length === 0) return []

    const rankedRowsQuery = database('direct_conversation_statuses')
      .select('conversationId', 'statusId', 'createdAt')
      .where((builder) => {
        for (const conversationId of conversationIds) {
          builder.orWhere((conversationBuilder) => {
            conversationBuilder.where('conversationId', conversationId)
            const cursor = cursorByConversationId.get(conversationId)
            if (cursor) {
              conversationBuilder.andWhere((cursorBuilder) => {
                applyStatusCursorCondition(cursorBuilder, cursor, 'older')
              })
            }
          })
        }
      })
      .rowNumber('conversationStatusRank', function () {
        this.partitionBy('conversationId')
          .orderBy('createdAt', 'desc')
          .orderBy('statusId', 'desc')
      })

    return database(rankedRowsQuery.as('ranked_direct_conversation_statuses'))
      .where(
        'conversationStatusRank',
        '<=',
        DIRECT_CONVERSATION_FALLBACK_STATUS_BATCH_SIZE
      )
      .select<
        DirectConversationStatusRow[]
      >('conversationId', 'statusId', 'createdAt')
      .orderBy('conversationId', 'asc')
      .orderBy('createdAt', 'desc')
      .orderBy('statusId', 'desc')
  }

  const getLocalParticipantActorIds = async (
    trx: Knex.Transaction,
    participantActorIds: string[]
  ) => {
    if (participantActorIds.length === 0) return []
    const rows = await trx('actors')
      .whereIn('id', participantActorIds)
      .whereNotNull('privateKey')
      .whereNot('privateKey', '')
      .select<{ id: string }[]>('id')
    return rows.map((row) => row.id)
  }

  const hydrateConversationRows = async (
    rows: DirectConversationMembershipRow[],
    currentActorId: string
  ): Promise<DirectConversation[]> => {
    if (rows.length === 0) return []

    const conversationIds = rows.map((row) => row.conversationId)
    const participantRows = await database('direct_conversation_participants')
      .whereIn('conversationId', conversationIds)
      .select<
        { conversationId: string; actorId: string }[]
      >('conversationId', 'actorId')
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
      const unresolvedFallbackConversationIds = new Set([
        ...new Set(rowsMissingLastStatus.map((row) => row.conversationId))
      ])
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
        const fallbackRows = await getFallbackStatusRowsForConversations({
          conversationIds: [...unresolvedFallbackConversationIds],
          cursorByConversationId: fallbackCursorByConversationId
        })
        if (fallbackRows.length === 0) break

        const fallbackRowsByConversationId = fallbackRows.reduce(
          (output, fallbackRow) => {
            const conversationRows =
              output.get(fallbackRow.conversationId) || []
            conversationRows.push(fallbackRow)
            output.set(fallbackRow.conversationId, conversationRows)
            return output
          },
          new Map<string, DirectConversationStatusRow[]>()
        )
        const fallbackStatusById = await getStatusesByIdVisibleToActor(
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
          lastStatusCreatedAt: getCompatibleTime(row.lastStatusCreatedAt),
          unread: Boolean(row.unread),
          readAt: row.readAt ? getCompatibleTime(row.readAt) : null,
          hiddenAt: row.hiddenAt ? getCompatibleTime(row.hiddenAt) : null,
          createdAt: getCompatibleTime(row.createdAt),
          updatedAt: getCompatibleTime(row.updatedAt)
        }
      })
      .filter(
        (conversation): conversation is DirectConversation =>
          conversation !== null
      )
  }

  const buildConversationQuery = ({
    actorId,
    includeHidden = false
  }: Pick<GetDirectConversationParams, 'actorId' | 'includeHidden'>) => {
    const query = database('direct_conversation_memberships')
      .innerJoin(
        'direct_conversations',
        'direct_conversation_memberships.conversationId',
        'direct_conversations.id'
      )
      .where('direct_conversation_memberships.actorId', actorId)
      .select<
        DirectConversationMembershipRow[]
      >('direct_conversation_memberships.id', 'direct_conversation_memberships.actorId', 'direct_conversation_memberships.conversationId', 'direct_conversations.rootStatusId', 'direct_conversation_memberships.lastStatusId', 'direct_conversation_memberships.lastStatusCreatedAt', 'direct_conversation_memberships.unread', 'direct_conversation_memberships.readAt', 'direct_conversation_memberships.hiddenAt', 'direct_conversation_memberships.createdAt', 'direct_conversation_memberships.updatedAt')

    if (!includeHidden)
      query.whereNull('direct_conversation_memberships.hiddenAt')
    return query
  }

  const getDirectConversationByMembershipId = async ({
    actorId,
    conversationId,
    includeHidden
  }: GetDirectConversationParams) => {
    if (!isValidMembershipId(conversationId)) return null

    const row = await buildConversationQuery({ actorId, includeHidden })
      .where('direct_conversation_memberships.id', conversationId)
      .first<DirectConversationMembershipRow>()
    if (!row) return null
    const [conversation] = await hydrateConversationRows([row], actorId)
    return conversation ?? null
  }

  const getDirectConversationCursor = async ({
    actorId,
    conversationId
  }: Pick<GetDirectConversationParams, 'actorId' | 'conversationId'>) => {
    if (!isValidMembershipId(conversationId)) return null

    const row = await buildConversationQuery({ actorId })
      .where('direct_conversation_memberships.id', conversationId)
      .first<DirectConversationMembershipRow>()
    if (!row) return null

    const [conversation] = await hydrateConversationRows([row], actorId)
    return conversation ?? null
  }

  const getHydratedConversationPage = async ({
    actorId,
    query,
    limit,
    olderThan,
    newerThan
  }: {
    actorId: string
    query: Knex.QueryBuilder
    limit: number
    olderThan: DirectConversation | null
    newerThan: DirectConversation | null
  }) => {
    if (limit <= 0) return []

    const conversations: DirectConversation[] = []
    const scanBatchSize = Math.max(limit, PER_PAGE_LIMIT)
    let scannedCursor: DirectConversationMembershipRow | null = null

    while (conversations.length < limit || scannedCursor) {
      const scanQuery = query.clone()
      if (scannedCursor)
        applyMembershipCursor(scanQuery, scannedCursor, 'older')

      const rows = await scanQuery
        .orderBy('direct_conversation_memberships.lastStatusCreatedAt', 'desc')
        .orderBy('direct_conversation_memberships.id', 'desc')
        .limit(scanBatchSize)
      if (rows.length === 0) break
      const scanBoundary = { ...rows[rows.length - 1] }

      const hydratedRows = await hydrateConversationRows(rows, actorId)
      conversations.push(
        ...hydratedRows.filter((conversation) => {
          if (
            olderThan &&
            compareConversationOrderDesc(conversation, olderThan) <= 0
          )
            return false
          if (
            newerThan &&
            compareConversationOrderDesc(conversation, newerThan) >= 0
          )
            return false
          return true
        })
      )
      conversations.sort(compareConversationOrderDesc)
      conversations.splice(limit)

      if (rows.length < scanBatchSize) break
      if (
        conversations.length === limit &&
        compareConversationToMembershipOrderDesc(
          conversations[conversations.length - 1],
          scanBoundary
        ) <= 0
      )
        break
      if (
        newerThan &&
        compareConversationToMembershipOrderDesc(newerThan, scanBoundary) <= 0
      )
        break

      scannedCursor = scanBoundary
    }

    return conversations
  }

  return {
    async syncDirectConversationForStatus({
      status,
      excludedLocalActorIds
    }: SyncDirectConversationForStatusParams) {
      if (!isDirectStatus(status)) return

      const rootStatusId = await resolveConversationRootStatusId(status)
      const conversationId = getConversationIdForRootStatusId(rootStatusId)
      const participantActorIds = getDirectStatusParticipantActorIds(status)
      const excludedActorIdSet = new Set(excludedLocalActorIds ?? [])
      const statusCreatedAt = new Date(status.createdAt)
      const currentTime = new Date()

      await database.transaction(async (trx) => {
        await insertIfMissing({
          trx,
          table: 'direct_conversations',
          where: { id: conversationId },
          values: {
            id: conversationId,
            rootStatusId,
            createdAt: statusCreatedAt,
            updatedAt: currentTime
          }
        })

        await insertIfMissing({
          trx,
          table: 'direct_conversation_statuses',
          where: { conversationId, statusId: status.id },
          values: {
            conversationId,
            statusId: status.id,
            createdAt: statusCreatedAt,
            updatedAt: currentTime
          }
        })

        await insertDirectConversationParticipantsIfMissing({
          trx,
          conversationId,
          actorIds: participantActorIds,
          currentTime
        })

        const localParticipantActorIds = [
          ...new Set(
            await getLocalParticipantActorIds(trx, participantActorIds)
          )
        ].filter((actorId) => !excludedActorIdSet.has(actorId))
        const existingMemberships =
          localParticipantActorIds.length > 0
            ? await trx('direct_conversation_memberships')
                .where('conversationId', conversationId)
                .whereIn('actorId', localParticipantActorIds)
                .select<DirectConversationMembershipRow[]>()
            : []
        const existingMembershipByActorId = new Map(
          existingMemberships.map((membership) => [
            membership.actorId,
            membership
          ])
        )

        const missingMembershipRows = localParticipantActorIds
          .filter((actorId) => !existingMembershipByActorId.has(actorId))
          .map((actorId) => {
            const unread = actorId !== status.actorId
            return {
              actorId,
              conversationId,
              lastStatusId: status.id,
              lastStatusCreatedAt: statusCreatedAt,
              unread,
              readAt: unread ? null : statusCreatedAt,
              hiddenAt: null,
              createdAt: currentTime,
              updatedAt: currentTime
            }
          })

        if (missingMembershipRows.length > 0) {
          await trx('direct_conversation_memberships')
            .insert(missingMembershipRows)
            .onConflict(['actorId', 'conversationId'])
            .ignore()
        }

        const staleMemberships = existingMemberships.filter((membership) =>
          isMembershipOlderThanStatus(membership, status)
        )
        const staleRecipientMembershipIds = staleMemberships
          .filter((membership) => membership.actorId !== status.actorId)
          .map((membership) => membership.id)

        if (staleRecipientMembershipIds.length > 0) {
          await trx('direct_conversation_memberships')
            .whereIn('id', staleRecipientMembershipIds)
            .update({
              lastStatusId: status.id,
              lastStatusCreatedAt: statusCreatedAt,
              unread: true,
              hiddenAt: null,
              updatedAt: currentTime
            })
        }

        const staleSenderMembership = staleMemberships.find(
          (membership) => membership.actorId === status.actorId
        )

        if (staleSenderMembership) {
          await trx('direct_conversation_memberships')
            .where('id', staleSenderMembership.id)
            .update({
              lastStatusId: status.id,
              lastStatusCreatedAt: statusCreatedAt,
              unread: false,
              readAt: statusCreatedAt,
              hiddenAt: null,
              updatedAt: currentTime
            })
        }
      })
    },

    async getDirectConversations({
      actorId,
      limit = PER_PAGE_LIMIT,
      maxId,
      minId
    }: GetDirectConversationsParams) {
      const query = buildConversationQuery({ actorId })
      const olderCursorId = maxId
      const newerCursorId = minId

      if (
        (olderCursorId && !isValidMembershipId(olderCursorId)) ||
        (newerCursorId && !isValidMembershipId(newerCursorId))
      )
        return []

      const olderThan = olderCursorId
        ? await getDirectConversationCursor({
            actorId,
            conversationId: olderCursorId
          })
        : null
      if (olderCursorId && !olderThan) return []

      const newerThan = newerCursorId
        ? await getDirectConversationCursor({
            actorId,
            conversationId: newerCursorId
          })
        : null
      if (newerCursorId && !newerThan) return []

      return getHydratedConversationPage({
        actorId,
        query,
        limit,
        olderThan,
        newerThan
      })
    },

    async getDirectConversation({
      actorId,
      conversationId,
      includeHidden
    }: GetDirectConversationParams) {
      return getDirectConversationByMembershipId({
        actorId,
        conversationId,
        includeHidden
      })
    },

    async markDirectConversationRead({
      actorId,
      conversationId
    }: MarkDirectConversationReadParams) {
      if (!isValidMembershipId(conversationId)) return null

      const row = await buildConversationQuery({ actorId })
        .where('direct_conversation_memberships.id', conversationId)
        .first<DirectConversationMembershipRow>()
      if (!row) return null

      await database('direct_conversation_memberships')
        .where('id', row.id)
        .update({
          unread: false,
          readAt: new Date(),
          updatedAt: new Date()
        })

      return getDirectConversationByMembershipId({ actorId, conversationId })
    },

    async hideDirectConversation({
      actorId,
      conversationId
    }: HideDirectConversationParams) {
      if (!isValidMembershipId(conversationId)) return

      await database('direct_conversation_memberships')
        .where({
          actorId,
          id: conversationId
        })
        .update({
          hiddenAt: new Date(),
          unread: false,
          updatedAt: new Date()
        })
    },

    async getDirectConversationStatuses({
      actorId,
      conversationId,
      limit = PER_PAGE_LIMIT,
      maxStatusId,
      minStatusId
    }: GetDirectConversationStatusesParams) {
      if (!isValidMembershipId(conversationId)) return []

      const conversation = await getDirectConversationByMembershipId({
        actorId,
        conversationId
      })
      if (!conversation) return []

      const query = database('direct_conversation_statuses')
        .where('conversationId', conversation.conversationId)
        .select<
          DirectConversationStatusRow[]
        >('conversationId', 'statusId', 'createdAt')

      if (maxStatusId) {
        const cursor = await database('direct_conversation_statuses')
          .where({
            conversationId: conversation.conversationId,
            statusId: maxStatusId
          })
          .first<DirectConversationStatusRow>()
        if (!cursor) return []
        applyStatusCursor(query, cursor, 'older')
      }

      if (minStatusId) {
        const cursor = await database('direct_conversation_statuses')
          .where({
            conversationId: conversation.conversationId,
            statusId: minStatusId
          })
          .first<DirectConversationStatusRow>()
        if (!cursor) return []
        applyStatusCursor(query, cursor, 'newer')
      }

      if (limit <= 0) return []

      const statuses: Status[] = []
      const scanBatchSize = Math.max(limit, PER_PAGE_LIMIT)
      let scannedCursor: DirectConversationStatusRow | null = null

      while (statuses.length < limit) {
        const scanQuery = query.clone()
        if (scannedCursor) applyStatusCursor(scanQuery, scannedCursor, 'older')

        const rows = await scanQuery
          .orderBy('createdAt', 'desc')
          .orderBy('statusId', 'desc')
          .limit(scanBatchSize)
        if (rows.length === 0) break

        const statusById = await getStatusesByIdVisibleToActor(
          rows.map((row) => row.statusId),
          actorId
        )

        for (const row of rows) {
          const status = statusById.get(row.statusId)
          if (!status) continue

          statuses.push(status)
          if (statuses.length === limit) break
        }

        if (statuses.length === limit || rows.length < scanBatchSize) break
        scannedCursor = rows[rows.length - 1]
      }

      return statuses
    }
  }
}
