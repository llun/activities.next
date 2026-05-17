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
import {
  Status,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { getVisibility } from '@/lib/utils/getVisibility'

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

const PUBLIC_AUDIENCES = new Set([
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
])
const MAX_DIRECT_CONVERSATION_ROOT_DEPTH = 50

const isFollowersAudience = (actorId: string) => actorId.endsWith('/followers')

export const isDirectAudienceActorId = (actorId: string) =>
  !PUBLIC_AUDIENCES.has(actorId) && !isFollowersAudience(actorId)

export const isDirectStatus = (
  status: Status
): status is StatusNote | StatusPoll =>
  status.type !== StatusType.enum.Announce &&
  getVisibility(status.to, status.cc) === 'direct'

export const getDirectStatusParticipantActorIds = (status: Status) =>
  [...new Set([status.actorId, ...status.to, ...status.cc])].filter(
    isDirectAudienceActorId
  )

const getConversationIdForRootStatusId = (rootStatusId: string) =>
  createHash('sha256').update(rootStatusId).digest('hex')

const isMembershipOlderThanStatus = (
  membership: DirectConversationMembershipRow,
  status: Status
) => {
  const membershipTime = getCompatibleTime(membership.lastStatusCreatedAt)
  if (membershipTime !== status.createdAt)
    return membershipTime < status.createdAt
  return String(membership.lastStatusId) < status.id
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

const applyStatusCursor = (
  query: Knex.QueryBuilder,
  cursor: DirectConversationStatusRow,
  direction: 'older' | 'newer'
) => {
  const createdAtOperator = direction === 'older' ? '<' : '>'
  const idOperator = direction === 'older' ? '<' : '>'

  query.andWhere((builder) => {
    builder
      .where('createdAt', createdAtOperator, cursor.createdAt)
      .orWhere((tieBreaker) => {
        tieBreaker
          .where('createdAt', cursor.createdAt)
          .andWhere('statusId', idOperator, cursor.statusId)
      })
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
    const existing = await trx(table).where(where).first()
    if (existing) return
    await trx(table).insert(values)
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
  }
}

export const DirectConversationSQLDatabaseMixin = (
  database: Knex,
  statusDatabase: StatusDatabase
): DirectConversationDatabase => {
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
    const statuses = await statusDatabase.getStatusesByIds({
      statusIds: rows.map((row) => row.lastStatusId),
      currentActorId
    })
    const statusById = new Map(statuses.map((status) => [status.id, status]))

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
    const row = await buildConversationQuery({ actorId, includeHidden })
      .where('direct_conversation_memberships.id', conversationId)
      .first<DirectConversationMembershipRow>()
    if (!row) return null
    const [conversation] = await hydrateConversationRows([row], actorId)
    return conversation ?? null
  }

  return {
    async syncDirectConversationForStatus({
      status
    }: SyncDirectConversationForStatusParams) {
      if (!isDirectStatus(status)) return

      const rootStatusId = await resolveConversationRootStatusId(status)
      const conversationId = getConversationIdForRootStatusId(rootStatusId)
      const participantActorIds = getDirectStatusParticipantActorIds(status)
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

        for (const actorId of participantActorIds) {
          await insertIfMissing({
            trx,
            table: 'direct_conversation_participants',
            where: { conversationId, actorId },
            values: {
              id: randomUUID(),
              conversationId,
              actorId,
              createdAt: currentTime,
              updatedAt: currentTime
            }
          })
        }

        const localParticipantActorIds = await getLocalParticipantActorIds(
          trx,
          participantActorIds
        )
        for (const actorId of localParticipantActorIds) {
          const existingMembership = await trx(
            'direct_conversation_memberships'
          )
            .where({
              actorId,
              conversationId
            })
            .first<DirectConversationMembershipRow>()
          const unread = actorId !== status.actorId

          if (!existingMembership) {
            await trx('direct_conversation_memberships').insert({
              actorId,
              conversationId,
              lastStatusId: status.id,
              lastStatusCreatedAt: statusCreatedAt,
              unread,
              readAt: unread ? null : statusCreatedAt,
              hiddenAt: null,
              createdAt: currentTime,
              updatedAt: currentTime
            })
            continue
          }

          if (!isMembershipOlderThanStatus(existingMembership, status)) continue

          await trx('direct_conversation_memberships')
            .where('id', existingMembership.id)
            .update({
              lastStatusId: status.id,
              lastStatusCreatedAt: statusCreatedAt,
              unread,
              readAt: unread ? existingMembership.readAt : statusCreatedAt,
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

      if (olderCursorId) {
        const cursor = await buildConversationQuery({ actorId })
          .where('direct_conversation_memberships.id', olderCursorId)
          .first<DirectConversationMembershipRow>()
        if (!cursor) return []
        applyMembershipCursor(query, cursor, 'older')
      }

      if (newerCursorId) {
        const cursor = await buildConversationQuery({ actorId })
          .where('direct_conversation_memberships.id', newerCursorId)
          .first<DirectConversationMembershipRow>()
        if (!cursor) return []
        applyMembershipCursor(query, cursor, 'newer')
      }

      const rows = await query
        .orderBy('direct_conversation_memberships.lastStatusCreatedAt', 'desc')
        .orderBy('direct_conversation_memberships.id', 'desc')
        .limit(limit)
      return hydrateConversationRows(rows, actorId)
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

      const rows = await query
        .orderBy('createdAt', 'desc')
        .orderBy('statusId', 'desc')
        .limit(limit)
      return statusDatabase.getStatusesByIds({
        statusIds: rows.map((row) => row.statusId),
        currentActorId: actorId
      })
    }
  }
}
