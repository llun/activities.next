const COUNTER_PREFIXES = [
  'total-status:',
  'total-followers:',
  'total-following:',
  'total-like:',
  'total-reblog:',
  'total-reply:',
  'media-usage:'
]

exports.config = { transaction: false }

const COUNTERS_TMP_TABLE = 'counters_tmp_new'

const parseInteger = (input) => {
  if (input === null || input === undefined) return 0
  const parsed = Number.parseInt(`${input}`, 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

const parseStatusContent = (content) => {
  if (!content) return null
  if (typeof content === 'string') {
    try {
      return JSON.parse(content)
    } catch {
      return content
    }
  }
  return content
}

const createCountersTable = (knex, tableName, withIndex = true) =>
  knex.schema.createTable(tableName, function (table) {
    table.text('id').primary()
    table.bigInteger('value').notNullable().defaultTo(0)

    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    if (withIndex) {
      table.index(['id', 'createdAt', 'updatedAt'], 'countersIndex')
    }
  })

const rebuildCountersTable = async (knex) => {
  const hasCounters = await knex.schema.hasTable('counters')
  if (!hasCounters) {
    await createCountersTable(knex, 'counters')
    return
  }

  await knex.schema.dropTableIfExists(COUNTERS_TMP_TABLE)
  await createCountersTable(knex, COUNTERS_TMP_TABLE, false)

  const existingRows = await knex('counters').select(
    'id',
    'value',
    'createdAt',
    'updatedAt'
  )

  if (existingRows.length > 0) {
    await knex(COUNTERS_TMP_TABLE).insert(
      existingRows.map((row) => ({
        id: row.id,
        value: parseInteger(row.value),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }))
    )
  }

  await knex.schema.dropTable('counters')
  await knex.schema.renameTable(COUNTERS_TMP_TABLE, 'counters')
  await knex.schema.alterTable('counters', function (table) {
    table.index(['id', 'createdAt', 'updatedAt'], 'countersIndex')
  })
}

const upsertCounter = async (knex, id, value, currentTime) => {
  const nextValue = Math.max(0, parseInteger(value))
  await knex('counters')
    .insert({
      id,
      value: nextValue,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    .onConflict('id')
    .merge({
      value: nextValue,
      updatedAt: currentTime
    })
}

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await rebuildCountersTable(knex)

  const currentTime = new Date()
  const computed = new Map()

  const statuses = await knex('statuses').select(
    'id',
    'actorId',
    'type',
    'reply',
    'content'
  )

  const statusReferenceToId = new Map()
  for (const status of statuses) {
    statusReferenceToId.set(status.id, status.id)

    if (status.actorId) {
      const key = `total-status:${status.actorId}`
      computed.set(key, (computed.get(key) || 0) + 1)
    }

    const content = parseStatusContent(status.content)
    if (content && typeof content === 'object') {
      if (typeof content.url === 'string' && content.url.length > 0) {
        statusReferenceToId.set(content.url, status.id)
      }
    }

    if (status.type === 'Announce') {
      const originalStatusId =
        typeof content === 'string' ? content : content?.id || status.content
      if (typeof originalStatusId === 'string' && originalStatusId.length > 0) {
        const key = `total-reblog:${originalStatusId}`
        computed.set(key, (computed.get(key) || 0) + 1)
      }
    }
  }

  for (const status of statuses) {
    if (!status.reply || typeof status.reply !== 'string') continue
    const parentStatusId = statusReferenceToId.get(status.reply)
    if (!parentStatusId) continue

    const key = `total-reply:${parentStatusId}`
    computed.set(key, (computed.get(key) || 0) + 1)
  }

  const likes = await knex('likes').select('statusId')
  for (const like of likes) {
    if (!like.statusId) continue
    const key = `total-like:${like.statusId}`
    computed.set(key, (computed.get(key) || 0) + 1)
  }

  const acceptedFollows = await knex('follows')
    .where('status', 'Accepted')
    .select('actorId', 'targetActorId')
  for (const follow of acceptedFollows) {
    if (follow.actorId) {
      const key = `total-following:${follow.actorId}`
      computed.set(key, (computed.get(key) || 0) + 1)
    }

    if (follow.targetActorId) {
      const key = `total-followers:${follow.targetActorId}`
      computed.set(key, (computed.get(key) || 0) + 1)
    }
  }

  const medias = await knex('medias')
    .leftJoin('actors', 'medias.actorId', 'actors.id')
    .select('actors.accountId as accountId', 'originalBytes', 'thumbnailBytes')
  for (const media of medias) {
    if (!media.accountId) continue

    const totalBytes =
      parseInteger(media.originalBytes) + parseInteger(media.thumbnailBytes)
    if (totalBytes <= 0) continue

    const key = `media-usage:${media.accountId}`
    computed.set(key, (computed.get(key) || 0) + totalBytes)
  }

  for (const [key, value] of computed.entries()) {
    await upsertCounter(knex, key, value, currentTime)
  }

  const existingTargetCounterIds = (await knex('counters').select('id'))
    .map((item) => item.id)
    .filter((id) =>
      COUNTER_PREFIXES.some(
        (prefix) => typeof id === 'string' && id.startsWith(prefix)
      )
    )

  for (const id of existingTargetCounterIds) {
    if (computed.has(id)) continue
    await upsertCounter(knex, id, 0, currentTime)
  }
}

/**
 * @param { import('knex').Knex } _knex
 * @returns { Promise<void> }
 */
exports.down = async function down(_knex) {
  // Irreversible migration: this rebuilds the counters schema and overwrites
  // targeted counter values based on current data.
  throw new Error(
    'Irreversible migration: cannot restore previous counters state'
  )
}
