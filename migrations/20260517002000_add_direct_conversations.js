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

const getDirectStatusRows = async (knex) => {
  const statusRows = await knex('statuses')
    .whereIn('type', ['Note', 'Poll'])
    .select('id', 'actorId', 'reply', 'createdAt')
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

  return statusRows
    .map((status) => ({
      ...status,
      recipients: recipientsByStatusId[status.id] || []
    }))
    .filter((status) => {
      const recipients = status.recipients.map((recipient) => recipient.actorId)
      return recipients.length > 0 && recipients.every(isDirectRecipient)
    })
}

const resolveRootStatusId = (status, directStatusesById) => {
  let root = status
  const seen = new Set([status.id])
  while (
    root.reply &&
    directStatusesById.has(root.reply) &&
    !seen.has(root.reply)
  ) {
    root = directStatusesById.get(root.reply)
    seen.add(root.id)
  }
  return root.id
}

const insertIfMissing = async (knex, table, where, values) => {
  const existing = await knex(table).where(where).first()
  if (existing) return existing
  await knex(table).insert(values)
  return values
}

const backfillDirectConversations = async (knex) => {
  const directStatuses = await getDirectStatusRows(knex)
  const directStatusesById = new Map(
    directStatuses.map((status) => [status.id, status])
  )

  directStatuses.sort((a, b) => {
    const timeA = asDate(a.createdAt).getTime()
    const timeB = asDate(b.createdAt).getTime()
    if (timeA !== timeB) return timeA - timeB
    return String(a.id).localeCompare(String(b.id))
  })

  for (const status of directStatuses) {
    const rootStatusId = resolveRootStatusId(status, directStatusesById)
    const conversationId = conversationIdForRoot(rootStatusId)
    const currentTime = new Date()
    const participantActorIds = [
      ...new Set([
        status.actorId,
        ...status.recipients.map((recipient) => recipient.actorId)
      ])
    ].filter(isDirectRecipient)

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

    const localActorRows = await knex('actors')
      .whereIn('id', participantActorIds)
      .whereNotNull('privateKey')
      .whereNot('privateKey', '')
      .select('id')

    for (const actor of localActorRows) {
      const existingMembership = await knex('direct_conversation_memberships')
        .where({
          actorId: actor.id,
          conversationId
        })
        .first()
      const unread = actor.id !== status.actorId

      if (!existingMembership) {
        await knex('direct_conversation_memberships').insert({
          actorId: actor.id,
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
          readAt: unread ? existingMembership.readAt : asDate(status.createdAt),
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

exports.up = async (knex) => {
  await createTables(knex)
  await backfillDirectConversations(knex)
}

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('direct_conversation_memberships')
  await knex.schema.dropTableIfExists('direct_conversation_statuses')
  await knex.schema.dropTableIfExists('direct_conversation_participants')
  await knex.schema.dropTableIfExists('direct_conversations')
}
