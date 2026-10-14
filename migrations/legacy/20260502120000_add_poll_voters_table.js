/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
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
  let lastStatusId = null
  let lastActorId = null

  while (true) {
    let query = knex('poll_answers')
      .distinct('statusId', 'actorId')
      .whereNotNull('statusId')
      .whereNotNull('actorId')
      .orderBy('statusId')
      .orderBy('actorId')
      .limit(batchSize)

    if (lastStatusId !== null && lastActorId !== null) {
      query = query.andWhere(function () {
        this.where('statusId', '>', lastStatusId).orWhere(function () {
          this.where('statusId', lastStatusId).andWhere(
            'actorId',
            '>',
            lastActorId
          )
        })
      })
    }

    const existingVotes = await query

    if (existingVotes.length === 0) return

    await knex('poll_voters').insert(
      existingVotes.map((vote) => ({
        statusId: vote.statusId,
        actorId: vote.actorId,
        createdAt: now,
        updatedAt: now
      }))
    )

    const lastVote = existingVotes[existingVotes.length - 1]
    lastStatusId = lastVote.statusId
    lastActorId = lastVote.actorId
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.schema.dropTable('poll_voters')
}
