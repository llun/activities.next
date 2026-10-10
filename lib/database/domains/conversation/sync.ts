import { randomUUID } from 'crypto'

import {
  type DirectConversationStatusLookup,
  type DirectConversationStatusLookupRow,
  buildDirectConversationStatusLookup,
  getConversationIdForRootStatusId,
  isDirectStatusLookup,
  isMembershipOlderThanStatus
} from '@/lib/database/domains/conversation/ordering'
import type { SyncDirectConversationForStatusParams } from '@/lib/database/domains/conversation/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import { isLocalActor } from '@/lib/database/kysely/visibility/localActor'
import { StatusNote, StatusPoll, StatusType } from '@/lib/types/domain/status'
import {
  getDirectStatusParticipantActorIds,
  isDirectAudienceActorId,
  isDirectStatus
} from '@/lib/utils/directStatus'
import { getHashFromString } from '@/lib/utils/getHashFromString'

const MAX_DIRECT_CONVERSATION_ROOT_DEPTH = 50

// The root of the conversation `statusId` is already synced into, if any.
const getSyncedRootStatusId = async (db: Db, statusId: string) => {
  const row = await db
    .selectFrom('direct_conversation_statuses')
    .innerJoin(
      'direct_conversations',
      'direct_conversation_statuses.conversationId',
      'direct_conversations.id'
    )
    .where('direct_conversation_statuses.statusId', '=', statusId)
    .select('direct_conversations.rootStatusId')
    .limit(1)
    .executeTakeFirst()
  return row?.rootStatusId ?? null
}

const getSyncedConversationParticipantActorIds = async (
  db: Db,
  statusId: string
) => {
  const rows = await db
    .selectFrom('direct_conversation_statuses')
    .innerJoin(
      'direct_conversation_participants',
      'direct_conversation_statuses.conversationId',
      'direct_conversation_participants.conversationId'
    )
    .where('direct_conversation_statuses.statusId', '=', statusId)
    .select('direct_conversation_participants.actorId')
    .execute()

  return rows.map((row) => row.actorId)
}

// The Note or Poll whose id, or else whose url, is `statusReference`, with its
// recipients; no full status hydration.
const getStatusByIdOrUrl = async (db: Db, statusReference: string) => {
  const urlHash = getHashFromString(statusReference)
  // Limit before joining recipients so id matches keep precedence without
  // dropping recipient rows from the chosen status.
  const matchingStatusQuery = db
    .selectFrom('statuses')
    .where('statuses.type', 'in', [StatusType.enum.Note, StatusType.enum.Poll])
    .where((eb) =>
      eb.or([
        eb('statuses.id', '=', statusReference),
        eb.and([
          eb('statuses.urlHash', '=', urlHash),
          eb('statuses.url', '=', statusReference)
        ])
      ])
    )
    .orderBy((eb) =>
      eb.case().when('statuses.id', '=', statusReference).then(0).else(1).end()
    )
    .limit(1)
    .select([
      'statuses.id',
      'statuses.url',
      'statuses.actorId',
      'statuses.type',
      'statuses.reply'
    ])
    .as('status_lookup')

  const rows: DirectConversationStatusLookupRow[] = await db
    .selectFrom(matchingStatusQuery)
    .leftJoin('recipients', 'recipients.statusId', 'status_lookup.id')
    .select([
      'status_lookup.id',
      'status_lookup.url',
      'status_lookup.actorId',
      'status_lookup.type',
      'status_lookup.reply',
      'recipients.actorId as recipientActorId',
      'recipients.type as recipientType'
    ])
    .execute()
  return buildDirectConversationStatusLookup(rows)
}

const isLocalActorId = async (db: Db, actorId: string) => {
  const row = await db
    .selectFrom('actors')
    .select('id')
    .where('id', '=', actorId)
    .where(isLocalActor)
    .limit(1)
    .executeTakeFirst()
  return Boolean(row)
}

const getDirectConversationParticipantActorIds = async (
  db: Db,
  status: StatusNote | StatusPoll
) => {
  const participantActorIds = getDirectStatusParticipantActorIds(status)
  const hasExplicitDirectAudience = [...status.to, ...status.cc].some(
    isDirectAudienceActorId
  )
  if (hasExplicitDirectAudience || !status.reply) {
    return participantActorIds
  }

  const parentStatus = await getStatusByIdOrUrl(db, status.reply)
  // A recipientless reply is only a direct conversation when the parent
  // proves it targets a local actor or an existing direct conversation.
  if (!parentStatus) return []

  const parentParticipantActorIds =
    await getSyncedConversationParticipantActorIds(db, parentStatus.id)
  if (parentParticipantActorIds.length > 0) {
    return [...new Set([...participantActorIds, ...parentParticipantActorIds])]
  }

  if (!(await isLocalActorId(db, parentStatus.actorId))) return []

  return [...new Set([...participantActorIds, parentStatus.actorId])]
}

const resolveConversationRootStatusId = async (
  db: Db,
  status: StatusNote | StatusPoll
) => {
  let root: DirectConversationStatusLookup = status
  const seen = new Set([status.id])

  for (
    let depth = 0;
    depth < MAX_DIRECT_CONVERSATION_ROOT_DEPTH && root.reply;
    depth += 1
  ) {
    const syncedRootStatusId = await getSyncedRootStatusId(db, root.reply)
    if (syncedRootStatusId) return syncedRootStatusId

    const parentStatus = await getStatusByIdOrUrl(db, root.reply)
    // Empty to/cc statuses are direct, so recipientless reply chains keep
    // walking through this check.
    if (!parentStatus || !isDirectStatusLookup(parentStatus)) break
    if (seen.has(parentStatus.id)) break
    seen.add(parentStatus.id)
    root = parentStatus
  }

  return root.id
}

const getLocalParticipantActorIds = async (
  trx: Db,
  participantActorIds: string[]
) => {
  if (participantActorIds.length === 0) return []
  const rows = await trx
    .selectFrom('actors')
    .select('id')
    .where('id', 'in', participantActorIds)
    .where(isLocalActor)
    // actors.id is nullable in the schema; a row matched by id is not null.
    .$narrowType<{ id: string }>()
    .execute()
  return rows.map((row) => row.id)
}

// Local participants with a block either way with the status author. The
// caller's `excludedLocalActorIds` only covers the status's own to/cc, but a
// recipientless reply inherits the parent's author or conversation
// participants here, so the block check has to run on the resolved set.
const getActorIdsBlockingEitherWay = async (
  trx: Db,
  actorIds: string[],
  authorActorId: string
) => {
  if (actorIds.length === 0) return new Set<string>()
  const rows = await trx
    .selectFrom('blocks')
    .select(['actorId', 'targetActorId'])
    .where((eb) =>
      eb.or([
        eb.and([
          eb('actorId', 'in', actorIds),
          eb('targetActorId', '=', authorActorId)
        ]),
        eb.and([
          eb('actorId', '=', authorActorId),
          eb('targetActorId', 'in', actorIds)
        ])
      ])
    )
    .execute()
  return new Set(
    rows.map((row) =>
      row.actorId === authorActorId ? row.targetActorId : row.actorId
    )
  )
}

const insertDirectConversationParticipantsIfMissing = async ({
  trx,
  conversationId,
  actorIds,
  currentTime
}: {
  trx: Db
  conversationId: string
  actorIds: string[]
  currentTime: Date
}) => {
  if (actorIds.length === 0) return

  const existingRows = await trx
    .selectFrom('direct_conversation_participants')
    .select('actorId')
    .where('conversationId', '=', conversationId)
    .where('actorId', 'in', actorIds)
    .execute()
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

  await trx
    .insertInto('direct_conversation_participants')
    .values(missingRows)
    .onConflict((oc) => oc.columns(['conversationId', 'actorId']).doNothing())
    .execute()
}

export const syncDirectConversationForStatus = async (
  db: Db,
  { status, excludedLocalActorIds }: SyncDirectConversationForStatusParams
): Promise<void> => {
  if (!isDirectStatus(status)) return

  const rootStatusId = await resolveConversationRootStatusId(db, status)
  const conversationId = getConversationIdForRootStatusId(rootStatusId)
  const participantActorIds = await getDirectConversationParticipantActorIds(
    db,
    status
  )
  const excludedActorIdSet = new Set(excludedLocalActorIds ?? [])
  const statusCreatedAt = new Date(status.createdAt)
  const currentTime = new Date()

  await inTransaction(db, async (trx) => {
    const unfilteredLocalParticipantActorIds = [
      ...new Set(await getLocalParticipantActorIds(trx, participantActorIds))
    ]

    if (unfilteredLocalParticipantActorIds.length === 0) return

    const blockedActorIdSet = await getActorIdsBlockingEitherWay(
      trx,
      unfilteredLocalParticipantActorIds.filter(
        (actorId) => actorId !== status.actorId
      ),
      status.actorId
    )
    const localParticipantActorIds = unfilteredLocalParticipantActorIds.filter(
      (actorId) =>
        !excludedActorIdSet.has(actorId) && !blockedActorIdSet.has(actorId)
    )

    await trx
      .insertInto('direct_conversations')
      .values({
        id: conversationId,
        rootStatusId,
        createdAt: statusCreatedAt,
        updatedAt: currentTime
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute()

    await trx
      .insertInto('direct_conversation_statuses')
      .values({
        conversationId,
        statusId: status.id,
        createdAt: statusCreatedAt,
        updatedAt: currentTime
      })
      .onConflict((oc) =>
        oc.columns(['conversationId', 'statusId']).doNothing()
      )
      .execute()

    await insertDirectConversationParticipantsIfMissing({
      trx,
      conversationId,
      actorIds: participantActorIds,
      currentTime
    })

    const existingMemberships =
      localParticipantActorIds.length > 0
        ? await trx
            .selectFrom('direct_conversation_memberships')
            .selectAll()
            .where('conversationId', '=', conversationId)
            .where('actorId', 'in', localParticipantActorIds)
            .execute()
        : []
    const existingMembershipByActorId = new Map(
      existingMemberships.map((membership) => [membership.actorId, membership])
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
      await trx
        .insertInto('direct_conversation_memberships')
        .values(missingMembershipRows)
        .onConflict((oc) =>
          oc.columns(['actorId', 'conversationId']).doNothing()
        )
        .execute()
    }

    const staleMemberships = existingMemberships.filter((membership) =>
      isMembershipOlderThanStatus(membership, status)
    )
    const staleRecipientMembershipIds = staleMemberships
      .filter((membership) => membership.actorId !== status.actorId)
      .map((membership) => membership.id)

    if (staleRecipientMembershipIds.length > 0) {
      await trx
        .updateTable('direct_conversation_memberships')
        .set({
          lastStatusId: status.id,
          lastStatusCreatedAt: statusCreatedAt,
          unread: true,
          hiddenAt: null,
          updatedAt: currentTime
        })
        .where('id', 'in', staleRecipientMembershipIds)
        .execute()
    }

    const staleSenderMembership = staleMemberships.find(
      (membership) => membership.actorId === status.actorId
    )

    if (staleSenderMembership) {
      await trx
        .updateTable('direct_conversation_memberships')
        .set({
          lastStatusId: status.id,
          lastStatusCreatedAt: statusCreatedAt,
          unread: false,
          readAt: statusCreatedAt,
          hiddenAt: null,
          updatedAt: currentTime
        })
        .where('id', '=', staleSenderMembership.id)
        .execute()
    }
  })
}
