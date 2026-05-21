const crypto = require('crypto')

const DIRECT_STATUS_BATCH_SIZE = 500
const DIRECT_TIMELINE = 'direct'
const PUBLIC_AUDIENCES = [
  'https://www.w3.org/ns/activitystreams#Public',
  'as:Public'
]

const conversationIdForRoot = (rootStatusId) =>
  crypto.createHash('sha256').update(rootStatusId).digest('hex')

const asDate = (value) => (value instanceof Date ? value : new Date(value))

const isMembershipOlderThanStatus = (membership, status) => {
  const membershipTime = asDate(membership.lastStatusCreatedAt).getTime()
  const statusTime = asDate(status.createdAt).getTime()
  if (membershipTime !== statusTime) return membershipTime < statusTime
  return String(membership.lastStatusId) < String(status.id)
}

const compareStatusOrder = (left, right) => {
  const leftTime = asDate(left.createdAt).getTime()
  const rightTime = asDate(right.createdAt).getTime()
  if (leftTime !== rightTime) return leftTime - rightTime
  return String(left.id).localeCompare(String(right.id))
}

const uniqueStatusesById = (statuses) => {
  const statusesById = new Map()
  for (const status of statuses) {
    if (!statusesById.has(status.id)) statusesById.set(status.id, status)
  }
  return [...statusesById.values()]
}

const insertIfMissing = async (knex, table, where, values) => {
  await knex(table).insert(values).onConflict(Object.keys(where)).ignore()
}

const insertTimelineStatusIfMissing = async ({
  knex,
  actorId,
  status,
  currentTime
}) =>
  insertIfMissing(
    knex,
    'timelines',
    {
      actorId,
      timeline: DIRECT_TIMELINE,
      statusId: status.id
    },
    {
      actorId,
      timeline: DIRECT_TIMELINE,
      statusId: status.id,
      statusActorId: status.actorId,
      createdAt: asDate(status.createdAt),
      updatedAt: currentTime
    }
  )

const getRecipientlessDirectReplyQuery = (knex, parentReferenceColumn) =>
  knex('statuses as direct_replies')
    .innerJoin(
      'statuses as parent_statuses',
      'direct_replies.reply',
      parentReferenceColumn
    )
    .leftJoin('actors as parent_actors', function () {
      this.on('parent_actors.id', '=', 'parent_statuses.actorId')
    })
    .leftJoin(
      'direct_conversation_statuses as parent_conversation_statuses',
      'parent_conversation_statuses.statusId',
      'parent_statuses.id'
    )
    .leftJoin(
      'direct_conversations as parent_conversations',
      'parent_conversations.id',
      'parent_conversation_statuses.conversationId'
    )
    .whereIn('direct_replies.type', ['Note', 'Poll'])
    .whereNotNull('direct_replies.reply')
    .whereNot('direct_replies.reply', '')
    .where((builder) => {
      builder
        .whereNotNull('parent_conversation_statuses.conversationId')
        .orWhere((rootParent) => {
          rootParent
            .whereNotNull('parent_actors.privateKey')
            .whereNot('parent_actors.privateKey', '')
            .whereExists(function () {
              this.select(knex.raw('1'))
                .from('recipients as parent_recipients')
                .whereRaw('?? = ??', [
                  'parent_recipients.statusId',
                  'parent_statuses.id'
                ])
                .where((recipientBuilder) => {
                  recipientBuilder
                    .whereIn('parent_recipients.actorId', PUBLIC_AUDIENCES)
                    .orWhere('parent_recipients.actorId', 'like', '%/followers')
                })
            })
        })
    })
    .whereNotExists(function () {
      this.select(knex.raw('1'))
        .from('recipients as reply_recipients')
        .whereRaw('?? = ??', ['reply_recipients.statusId', 'direct_replies.id'])
    })
    .whereNotExists(function () {
      this.select(knex.raw('1'))
        .from('direct_conversation_statuses as reply_conversation_statuses')
        .whereRaw('?? = ??', [
          'reply_conversation_statuses.statusId',
          'direct_replies.id'
        ])
    })
    .orderBy('direct_replies.createdAt', 'asc')
    .orderBy('direct_replies.id', 'asc')
    .limit(DIRECT_STATUS_BATCH_SIZE)
    .select(
      'direct_replies.id',
      'direct_replies.actorId',
      'direct_replies.createdAt',
      'parent_statuses.actorId as parentActorId',
      'parent_conversation_statuses.conversationId as parentConversationId',
      'parent_conversations.rootStatusId as parentRootStatusId'
    )

const getRecipientlessDirectReplyBatch = async (knex) => {
  const statusesByParentReference = await Promise.all([
    getRecipientlessDirectReplyQuery(knex, 'parent_statuses.id'),
    getRecipientlessDirectReplyQuery(knex, 'parent_statuses.url')
  ])

  return uniqueStatusesById(statusesByParentReference.flat())
    .sort(compareStatusOrder)
    .slice(0, DIRECT_STATUS_BATCH_SIZE)
}

const getParticipantActorIdsByConversationId = async (
  knex,
  conversationIds
) => {
  if (conversationIds.length === 0) return new Map()

  const rows = await knex('direct_conversation_participants')
    .whereIn('conversationId', conversationIds)
    .select('conversationId', 'actorId')
  return rows.reduce((output, row) => {
    const participantActorIds = output.get(row.conversationId) || []
    participantActorIds.push(row.actorId)
    output.set(row.conversationId, participantActorIds)
    return output
  }, new Map())
}

const buildDirectReplySyncData = ({
  directReplies,
  participantActorIdsByConversationId
}) =>
  directReplies.map((status) => {
    const conversationId =
      status.parentConversationId || conversationIdForRoot(status.id)
    const inheritedParticipantActorIds = status.parentConversationId
      ? participantActorIdsByConversationId.get(status.parentConversationId) ||
        []
      : []

    return {
      ...status,
      conversationId,
      rootStatusId: status.parentRootStatusId || status.id,
      participantActorIds: [
        ...new Set([
          status.actorId,
          ...(inheritedParticipantActorIds.length > 0
            ? inheritedParticipantActorIds
            : [status.parentActorId])
        ])
      ]
    }
  })

const upsertMembershipForStatus = async ({
  trx,
  actorId,
  conversationId,
  status,
  currentTime
}) => {
  const statusCreatedAt = asDate(status.createdAt)
  const unread = actorId !== status.actorId
  const existingMembership = await trx('direct_conversation_memberships')
    .where({ actorId, conversationId })
    .first()

  if (!existingMembership) {
    await insertIfMissing(
      trx,
      'direct_conversation_memberships',
      { actorId, conversationId },
      {
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
    )
    return
  }

  if (!isMembershipOlderThanStatus(existingMembership, status)) return

  await trx('direct_conversation_memberships')
    .where('id', existingMembership.id)
    .update({
      lastStatusId: status.id,
      lastStatusCreatedAt: statusCreatedAt,
      unread,
      ...(unread ? {} : { readAt: statusCreatedAt }),
      hiddenAt: null,
      updatedAt: currentTime
    })
}

const getNextRecipientlessDirectReplyBatch = async (knex) => {
  const directReplies = await getRecipientlessDirectReplyBatch(knex)
  const parentConversationIds = [
    ...new Set(
      directReplies.map((status) => status.parentConversationId).filter(Boolean)
    )
  ]
  const participantActorIdsByConversationId =
    await getParticipantActorIdsByConversationId(knex, parentConversationIds)

  return buildDirectReplySyncData({
    directReplies,
    participantActorIdsByConversationId
  })
}

const getBatchLocalActorIds = (knex, directReplies) => {
  const batchParticipantActorIds = [
    ...new Set(directReplies.flatMap((status) => status.participantActorIds))
  ]
  return getLocalActorIds(knex, batchParticipantActorIds)
}

const getStatusLocalActorIds = (status, batchLocalActorIds) =>
  status.participantActorIds.filter((actorId) =>
    batchLocalActorIds.has(actorId)
  )

const insertDirectConversationParticipantIfMissing = async ({
  trx,
  conversationId,
  actorId,
  currentTime
}) => {
  await insertIfMissing(
    trx,
    'direct_conversation_participants',
    { conversationId, actorId },
    {
      id: crypto.randomUUID(),
      conversationId,
      actorId,
      createdAt: currentTime,
      updatedAt: currentTime
    }
  )
}

const insertDirectConversationIfMissing = async ({
  trx,
  status,
  currentTime
}) =>
  insertIfMissing(
    trx,
    'direct_conversations',
    { id: status.conversationId },
    {
      id: status.conversationId,
      rootStatusId: status.rootStatusId,
      createdAt: asDate(status.createdAt),
      updatedAt: currentTime
    }
  )

const insertDirectConversationStatusIfMissing = async ({
  trx,
  status,
  currentTime
}) =>
  insertIfMissing(
    trx,
    'direct_conversation_statuses',
    { conversationId: status.conversationId, statusId: status.id },
    {
      conversationId: status.conversationId,
      statusId: status.id,
      createdAt: asDate(status.createdAt),
      updatedAt: currentTime
    }
  )

const syncRecipientlessDirectReply = async ({
  trx,
  status,
  batchLocalActorIds
}) => {
  const currentTime = new Date()
  await insertDirectConversationIfMissing({ trx, status, currentTime })
  await insertDirectConversationStatusIfMissing({ trx, status, currentTime })

  for (const actorId of status.participantActorIds) {
    await insertDirectConversationParticipantIfMissing({
      trx,
      conversationId: status.conversationId,
      actorId,
      currentTime
    })
  }

  for (const actorId of getStatusLocalActorIds(status, batchLocalActorIds)) {
    await insertTimelineStatusIfMissing({
      knex: trx,
      actorId,
      status,
      currentTime
    })

    await upsertMembershipForStatus({
      trx,
      actorId,
      conversationId: status.conversationId,
      status,
      currentTime
    })
  }
}

const getLocalActorIds = async (knex, actorIds) => {
  if (actorIds.length === 0) return new Set()

  const rows = await knex('actors')
    .whereIn('id', actorIds)
    .whereNotNull('privateKey')
    .whereNot('privateKey', '')
    .select('id')
  return new Set(rows.map((row) => row.id))
}

exports.up = async (knex) => {
  while (true) {
    const directReplies = await getNextRecipientlessDirectReplyBatch(knex)
    if (directReplies.length === 0) break
    const batchLocalActorIds = await getBatchLocalActorIds(knex, directReplies)

    await knex.transaction(async (trx) => {
      for (const status of directReplies) {
        await syncRecipientlessDirectReply({ trx, status, batchLocalActorIds })
      }
    })
  }
}

exports.down = async () => {
  // Backfilled conversations cannot be distinguished from later legitimate syncs.
}
