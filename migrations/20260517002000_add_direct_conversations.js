const crypto = require('crypto')

const PUBLIC_AUDIENCES = new Set([
  'https://www.w3.org/ns/activitystreams#Public',
  'as:Public'
])

const isFollowersAudience = (actorId) =>
  typeof actorId === 'string' && actorId.endsWith('/followers')

const isDirectRecipient = (actorId) =>
  actorId && !PUBLIC_AUDIENCES.has(actorId) && !isFollowersAudience(actorId)

const conversationIdForRoot = (rootStatusId) =>
  crypto.createHash('sha256').update(rootStatusId).digest('hex')

const asDate = (value) => (value instanceof Date ? value : new Date(value))

const isOlderThanStatus = (membership, status) => {
  const membershipTime = asDate(membership.lastStatusCreatedAt).getTime()
  const statusTime = asDate(status.createdAt).getTime()
  if (membershipTime !== statusTime) return membershipTime < statusTime
  return String(membership.lastStatusId) < String(status.id)
}

const createTables = async (knex) => {
  await knex.schema.createTable('direct_conversations', (table) => {
    table.string('id').primary()
    table.string('rootStatusId').notNullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.index(['rootStatusId'], 'direct_conversations_root_status')
  })

  await knex.schema.createTable('direct_conversation_participants', (table) => {
    table.string('id').primary()
    table.string('conversationId').notNullable()
    table.string('actorId').notNullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.unique(['conversationId', 'actorId'], {
      indexName: 'direct_participant_conversation_actor'
    })
    table.index(['actorId'], 'direct_participant_actor')
  })

  await knex.schema.createTable('direct_conversation_statuses', (table) => {
    table.string('conversationId').notNullable()
    table.string('statusId').notNullable()
    table.timestamp('createdAt', { useTz: true }).notNullable()
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.primary(['conversationId', 'statusId'])
    table.index(['statusId'], 'direct_conversation_status')
    table.index(
      ['conversationId', 'createdAt', 'statusId'],
      'direct_conversation_statuses_order'
    )
  })

  await knex.schema.createTable('direct_conversation_memberships', (table) => {
    table.bigIncrements('id').primary()
    table.string('actorId').notNullable()
    table.string('conversationId').notNullable()
    table.string('lastStatusId').notNullable()
    table.timestamp('lastStatusCreatedAt', { useTz: true }).notNullable()
    table.boolean('unread').notNullable().defaultTo(false)
    table.timestamp('readAt', { useTz: true }).nullable()
    table.timestamp('hiddenAt', { useTz: true }).nullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.unique(['actorId', 'conversationId'], {
      indexName: 'direct_membership_actor_conversation'
    })
    table.index(
      ['actorId', 'hiddenAt', 'lastStatusCreatedAt', 'id'],
      'direct_membership_actor_visible'
    )
    table.index(['lastStatusId'], 'direct_membership_last_status')
  })
}

const DIRECT_STATUS_BATCH_SIZE = 500
const LOCAL_ACTOR_LOOKUP_BATCH_SIZE = 500
const MAX_DIRECT_CONVERSATION_ROOT_DEPTH = 50

const attachRecipients = async (knex, statusRows) => {
  if (statusRows.length === 0) return []

  const recipientRows = await knex('recipients')
    .whereIn(
      'statusId',
      statusRows.map((status) => status.id)
    )
    .select('statusId', 'actorId', 'type')

  const recipientsByStatusId = recipientRows.reduce((output, recipient) => {
    output[recipient.statusId] = output[recipient.statusId] || []
    output[recipient.statusId].push(recipient)
    return output
  }, {})

  return statusRows.map((status) => ({
    ...status,
    recipients: recipientsByStatusId[status.id] || []
  }))
}

const isDirectStatusRow = (status) => {
  const recipients = status.recipients.map((recipient) => recipient.actorId)
  // Older direct rows may not have recipient rows after the status visibility
  // column was removed, so recipient-less rows need the same cleanup/backfill.
  return recipients.length === 0 || recipients.every(isDirectRecipient)
}

const getDirectStatusBatch = async (knex, cursor) => {
  let query = knex('statuses')
    .whereIn('type', ['Note', 'Poll'])
    .orderBy('createdAt', 'asc')
    .orderBy('id', 'asc')
    .limit(DIRECT_STATUS_BATCH_SIZE)
    .select('id', 'actorId', 'reply', 'createdAt')

  if (cursor) {
    query = query.where((builder) => {
      builder.where('createdAt', '>', cursor.createdAt).orWhere((sameTime) => {
        sameTime
          .where('createdAt', cursor.createdAt)
          .where('id', '>', cursor.id)
      })
    })
  }

  const statusRows = await query
  const statusesWithRecipients = await attachRecipients(knex, statusRows)
  return {
    cursor: statusRows[statusRows.length - 1] || cursor,
    hasMore: statusRows.length === DIRECT_STATUS_BATCH_SIZE,
    statuses: statusesWithRecipients.filter(isDirectStatusRow)
  }
}

const getDirectStatusRow = async (knex, statusId) => {
  const status = await knex('statuses')
    .where('id', statusId)
    .whereIn('type', ['Note', 'Poll'])
    .select('id', 'actorId', 'reply', 'createdAt')
    .first()
  if (!status) return null

  const [statusWithRecipients] = await attachRecipients(knex, [status])
  return isDirectStatusRow(statusWithRecipients) ? statusWithRecipients : null
}

const getSyncedRootStatusId = async (knex, statusId) => {
  const row = await knex('direct_conversation_statuses')
    .innerJoin(
      'direct_conversations',
      'direct_conversation_statuses.conversationId',
      'direct_conversations.id'
    )
    .where('direct_conversation_statuses.statusId', statusId)
    .select('direct_conversations.rootStatusId')
    .first()
  return row ? row.rootStatusId : null
}

const resolveRootStatusId = async (knex, status) => {
  let root = status
  const seen = new Set([status.id])

  for (
    let depth = 0;
    depth < MAX_DIRECT_CONVERSATION_ROOT_DEPTH && root.reply;
    depth += 1
  ) {
    if (seen.has(root.reply)) break
    const syncedRootStatusId = await getSyncedRootStatusId(knex, root.reply)
    if (syncedRootStatusId) return syncedRootStatusId

    const parent = await getDirectStatusRow(knex, root.reply)
    if (!parent) break

    root = parent
    seen.add(root.id)
  }
  return root.id
}

const insertIfMissing = async (knex, table, where, values) => {
  await knex(table).insert(values).onConflict(Object.keys(where)).ignore()
  return values
}

const getParticipantActorIds = (status) =>
  [
    ...new Set([
      status.actorId,
      ...status.recipients.map((recipient) => recipient.actorId)
    ])
  ].filter(isDirectRecipient)

const getLocalActorIds = async (knex, statuses) => {
  const actorIds = [
    ...new Set(statuses.flatMap((status) => getParticipantActorIds(status)))
  ]
  const localActorIds = new Set()

  for (let i = 0; i < actorIds.length; i += LOCAL_ACTOR_LOOKUP_BATCH_SIZE) {
    const actorIdBatch = actorIds.slice(i, i + LOCAL_ACTOR_LOOKUP_BATCH_SIZE)
    const localActorRows = await knex('actors')
      .whereIn('id', actorIdBatch)
      .whereNotNull('privateKey')
      .whereNot('privateKey', '')
      .select('id')

    for (const actor of localActorRows) {
      localActorIds.add(actor.id)
    }
  }

  return localActorIds
}

const backfillDirectConversations = async (knex) => {
  let cursor = null
  let hasMore = true

  while (hasMore) {
    const batch = await getDirectStatusBatch(knex, cursor)
    const directStatuses = batch.statuses
    hasMore = batch.hasMore
    cursor = batch.cursor
    if (directStatuses.length === 0) continue

    const localActorIds = await getLocalActorIds(knex, directStatuses)

    for (const status of directStatuses) {
      const rootStatusId = await resolveRootStatusId(knex, status)
      const conversationId = conversationIdForRoot(rootStatusId)
      const currentTime = new Date()
      const participantActorIds = getParticipantActorIds(status)

      await insertIfMissing(
        knex,
        'direct_conversations',
        { id: conversationId },
        {
          id: conversationId,
          rootStatusId,
          createdAt: asDate(status.createdAt),
          updatedAt: currentTime
        }
      )

      await insertIfMissing(
        knex,
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
          knex,
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

      if (participantActorIds.length === 0) continue

      const statusLocalActorIds = participantActorIds.filter((actorId) =>
        localActorIds.has(actorId)
      )

      for (const actorId of statusLocalActorIds) {
        const existingMembership = await knex('direct_conversation_memberships')
          .where({
            actorId,
            conversationId
          })
          .first()
        const unread = actorId !== status.actorId

        if (!existingMembership) {
          await knex('direct_conversation_memberships').insert({
            actorId,
            conversationId,
            lastStatusId: status.id,
            lastStatusCreatedAt: asDate(status.createdAt),
            unread,
            readAt: unread ? null : asDate(status.createdAt),
            hiddenAt: null,
            createdAt: currentTime,
            updatedAt: currentTime
          })
          continue
        }

        if (!isOlderThanStatus(existingMembership, status)) continue
        await knex('direct_conversation_memberships')
          .where('id', existingMembership.id)
          .update({
            lastStatusId: status.id,
            lastStatusCreatedAt: asDate(status.createdAt),
            unread,
            readAt: unread
              ? existingMembership.readAt
              : asDate(status.createdAt),
            hiddenAt: null,
            updatedAt: currentTime
          })
      }
    }

    await knex('timelines')
      .whereIn(
        'statusId',
        directStatuses.map((status) => status.id)
      )
      .whereIn('timeline', ['main', 'home', 'noannounce'])
      .delete()
  }
}

exports.up = async (knex) => {
  await createTables(knex)
  await backfillDirectConversations(knex)
}

exports.down = async (knex) => {
  // This migration moves direct statuses out of home timelines during backfill.
  // Dropping the conversation tables cannot restore those timeline rows safely.
  throw new Error(
    'Irreversible migration: direct conversation backfill removes timeline rows and cannot be safely rolled back.'
  )
}
