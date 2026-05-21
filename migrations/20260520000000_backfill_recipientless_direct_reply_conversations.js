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

const getRecipientlessDirectReplyBatch = async (knex, cursor) => {
  let query = knex('statuses as direct_replies')
    .innerJoin('statuses as parent_statuses', function () {
      this.on('direct_replies.reply', '=', 'parent_statuses.id').orOn(
        'direct_replies.reply',
        '=',
        'parent_statuses.url'
      )
    })
    .innerJoin('actors as parent_actors', function () {
      this.on('parent_actors.id', '=', 'parent_statuses.actorId')
    })
    .whereIn('direct_replies.type', ['Note', 'Poll'])
    .whereNotNull('direct_replies.reply')
    .whereNot('direct_replies.reply', '')
    .whereNotNull('parent_actors.privateKey')
    .whereNot('parent_actors.privateKey', '')
    .whereExists(function () {
      this.select(knex.raw('1'))
        .from('recipients as parent_recipients')
        .whereRaw('?? = ??', [
          'parent_recipients.statusId',
          'parent_statuses.id'
        ])
        .where((builder) => {
          builder
            .whereIn('parent_recipients.actorId', PUBLIC_AUDIENCES)
            .orWhere('parent_recipients.actorId', 'like', '%/followers')
        })
    })
    .whereNotExists(function () {
      this.select(knex.raw('1'))
        .from('recipients as reply_recipients')
        .whereRaw('?? = ??', ['reply_recipients.statusId', 'direct_replies.id'])
    })
    .orderBy('direct_replies.createdAt', 'asc')
    .orderBy('direct_replies.id', 'asc')
    .limit(DIRECT_STATUS_BATCH_SIZE)
    .select(
      'direct_replies.id',
      'direct_replies.actorId',
      'direct_replies.createdAt',
      'parent_statuses.actorId as parentActorId'
    )

  if (cursor) {
    query = query.where((builder) => {
      builder
        .where('direct_replies.createdAt', '>', cursor.createdAt)
        .orWhere((sameTime) => {
          sameTime
            .where('direct_replies.createdAt', cursor.createdAt)
            .where('direct_replies.id', '>', cursor.id)
        })
    })
  }

  const statuses = await query
  return {
    cursor: statuses[statuses.length - 1] || cursor,
    hasMore: statuses.length === DIRECT_STATUS_BATCH_SIZE,
    statuses
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
  let cursor = null
  let hasMore = true

  while (hasMore) {
    const batch = await getRecipientlessDirectReplyBatch(knex, cursor)
    const directReplies = batch.statuses
    hasMore = batch.hasMore
    cursor = batch.cursor
    if (directReplies.length === 0) continue

    const batchParticipantActorIds = [
      ...new Set(
        directReplies.flatMap((status) => [
          status.actorId,
          status.parentActorId
        ])
      )
    ]
    const batchLocalActorIds = await getLocalActorIds(
      knex,
      batchParticipantActorIds
    )

    await knex.transaction(async (trx) => {
      for (const status of directReplies) {
        const conversationId = conversationIdForRoot(status.id)
        const currentTime = new Date()
        const participantActorIds = [
          ...new Set([status.actorId, status.parentActorId])
        ]
        const localActorIds = participantActorIds.filter((actorId) =>
          batchLocalActorIds.has(actorId)
        )

        await insertIfMissing(
          trx,
          'direct_conversations',
          { id: conversationId },
          {
            id: conversationId,
            rootStatusId: status.id,
            createdAt: asDate(status.createdAt),
            updatedAt: currentTime
          }
        )

        await insertIfMissing(
          trx,
          'direct_conversation_statuses',
          { conversationId, statusId: status.id },
          {
            conversationId,
            statusId: status.id,
            createdAt: asDate(status.createdAt),
            updatedAt: currentTime
          }
        )

        for (const actorId of participantActorIds) {
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

        for (const actorId of localActorIds) {
          await insertTimelineStatusIfMissing({
            knex: trx,
            actorId,
            status,
            currentTime
          })

          const unread = actorId !== status.actorId
          await insertIfMissing(
            trx,
            'direct_conversation_memberships',
            { actorId, conversationId },
            {
              actorId,
              conversationId,
              lastStatusId: status.id,
              lastStatusCreatedAt: asDate(status.createdAt),
              unread,
              readAt: unread ? null : asDate(status.createdAt),
              hiddenAt: null,
              createdAt: currentTime,
              updatedAt: currentTime
            }
          )
        }
      }
    })
  }
}

exports.down = async () => {
  // Backfilled conversations cannot be distinguished from later legitimate syncs.
}
