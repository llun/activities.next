/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) => {
  return knex.schema
    .createTable('accounts', function (table) {
      table.string('id').primary()
      table.string('email').unique()
      table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
      table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

      table.index(['email', 'createdAt', 'updatedAt'], 'accountsIndex')
    })
    .createTable('actors', function (table) {
      table.string('id').unique()
      table
        .string('preferredUsername')
        .unique({ indexName: 'actors_preferredUsername_unique' })

      table.string('accountId')
      table.foreign('accountId').references('id').inTable('accounts')

      table.string('name')
      table.text('summary')
      table.boolean('manuallyApprovesFollowers')
      table.boolean('discoverable')

      table.text('publicKey')
      table.text('privateKey')

      table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
      table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

      table.index(
        ['preferredUsername', 'createdAt', 'updatedAt'],
        'actorsIndex'
      )
    })
    .createTable('statuses', function (table) {
      table.string('id').primary()
      table.string('url')

      table.string('actorId')

      table.string('type')
      table.text('text')
      table.text('summary')

      table.string('reply')
      table.boolean('sensitive')
      table.string('visibility')
      table.string('language')

      table.string('thread')
      table.string('conversation')

      table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
      table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())
      table.index(['actorId', 'createdAt', 'updatedAt'], 'statusesIndex')
    })
    .createTable('questions', function (table) {
      table.string('statusId')

      table.text('options')

      table.integer('votersCount').defaultTo(0)

      table.timestamp('endAt', { useTz: true }).defaultTo(knex.fn.now())

      table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
      table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

      table.index(['statusId', 'createdAt', 'updatedAt'], 'questionsIndex')
    })
    .createTable('follows', function (table) {
      table.string('id').primary()
      table.string('actorId')
      table.string('actorHost')

      table.string('targetActorId')
      table.string('targetActorHost')
      table.string('status')

      table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
      table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())
      table.index(
        [
          'actorId',
          'actorHost',
          'targetActorId',
          'targetActorHost',
          'status',
          'createdAt',
          'updatedAt'
        ],
        'followsIndex'
      )
    })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => {
  return knex.schema
    .dropTable('follows')
    .dropTable('questions')
    .dropTable('statuses')
    .dropTable('actors')
    .dropTable('accounts')
}
