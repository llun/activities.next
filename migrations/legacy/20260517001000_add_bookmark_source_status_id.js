const SOURCE_STATUS_INDEX = 'bookmarks_actor_source_status'

export const up = async (knex) => {
  const hasSourceStatusId = await knex.schema.hasColumn(
    'bookmarks',
    'sourceStatusId'
  )
  if (!hasSourceStatusId) {
    await knex.schema.alterTable('bookmarks', (table) => {
      table.string('sourceStatusId').nullable()
    })
  }

  await knex('bookmarks')
    .whereNull('sourceStatusId')
    .update({
      sourceStatusId: knex.ref('statusId')
    })

  await knex.schema.alterTable('bookmarks', (table) => {
    table.index(['actorId', 'sourceStatusId'], SOURCE_STATUS_INDEX)
  })
}

export const down = async (knex) => {
  const hasSourceStatusId = await knex.schema.hasColumn(
    'bookmarks',
    'sourceStatusId'
  )
  if (!hasSourceStatusId) return

  await knex.schema.alterTable('bookmarks', (table) => {
    table.dropIndex(['actorId', 'sourceStatusId'], SOURCE_STATUS_INDEX)
  })
  await knex.schema.alterTable('bookmarks', (table) => {
    table.dropColumn('sourceStatusId')
  })
}
