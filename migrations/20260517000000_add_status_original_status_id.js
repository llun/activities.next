const ANNOUNCE_ORIGINAL_STATUS_INDEX = 'statuses_announce_actor_original_idx'

const getOriginalStatusIdFromAnnounceContent = (content) => {
  if (!content) return null
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content)
      if (typeof parsed === 'string') return parsed
      if (parsed && typeof parsed.url === 'string') return parsed.url
      if (parsed && typeof parsed.id === 'string') return parsed.id
      return null
    } catch {
      return content
    }
  }
  if (typeof content === 'object') {
    if (typeof content.url === 'string') return content.url
    if (typeof content.id === 'string') return content.id
  }
  return null
}

exports.up = async (knex) => {
  const hasOriginalStatusId = await knex.schema.hasColumn(
    'statuses',
    'originalStatusId'
  )
  if (!hasOriginalStatusId) {
    await knex.schema.alterTable('statuses', (table) => {
      table.string('originalStatusId').nullable()
    })
  }

  const announces = await knex('statuses')
    .select('id', 'content')
    .where('type', 'Announce')
    .whereNull('originalStatusId')
  for (const announce of announces) {
    const originalStatusId = getOriginalStatusIdFromAnnounceContent(
      announce.content
    )
    if (!originalStatusId) continue
    await knex('statuses').where('id', announce.id).update({
      originalStatusId
    })
  }

  await knex.schema.alterTable('statuses', (table) => {
    table.index(
      ['type', 'actorId', 'originalStatusId'],
      ANNOUNCE_ORIGINAL_STATUS_INDEX
    )
  })
}

exports.down = async (knex) => {
  const hasOriginalStatusId = await knex.schema.hasColumn(
    'statuses',
    'originalStatusId'
  )
  if (!hasOriginalStatusId) return

  await knex.schema.alterTable('statuses', (table) => {
    table.dropIndex(
      ['type', 'actorId', 'originalStatusId'],
      ANNOUNCE_ORIGINAL_STATUS_INDEX
    )
  })
  await knex.schema.alterTable('statuses', (table) => {
    table.dropColumn('originalStatusId')
  })
}
