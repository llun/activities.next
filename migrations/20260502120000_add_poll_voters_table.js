/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
  await knex.schema.createTable('poll_voters', function (table) {
    table.increments('id').primary()
    table.string('statusId').notNullable()
    table.string('actorId').notNullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.unique(['statusId', 'actorId'])
    table.index(['statusId'])
  })

  const batchSize = 500
  const now = new Date()
  let offset = 0

  while (true) {
    const existingVotes = await knex('poll_answers')
      .distinct('statusId', 'actorId')
      .whereNotNull('statusId')
      .whereNotNull('actorId')
      .orderBy('statusId')
      .orderBy('actorId')
      .limit(batchSize)
      .offset(offset)

    if (existingVotes.length === 0) return

    await knex('poll_voters').insert(
      existingVotes.map((vote) => ({
        statusId: vote.statusId,
        actorId: vote.actorId,
        createdAt: now,
        updatedAt: now
      }))
    )

    offset += existingVotes.length
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async (knex) => {
  await knex.schema.dropTable('poll_voters')
}
