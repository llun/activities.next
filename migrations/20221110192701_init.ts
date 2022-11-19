import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema
    .createTable('accounts', function (table) {
      table.string('id').primary()
      table.string('email').unique()

      table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
      table.timestamp('updatedAt', { useTz: true })
    })
    .createTable('actors', function (table) {
      table.string('id').unique()
      table.string('preferredUsername').unique()

      table.string('accountId')
      table.foreign('accountId').references('id').inTable('accounts')

      table.text('summary')
      table.boolean('manuallyApprovesFollowers')
      table.boolean('discoverable')

      table.text('publicKey')
      table.text('privateKey')

      table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
      table.timestamp('updatedAt', { useTz: true })
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
      table.timestamp('updatedAt', { useTz: true })
    })
    .createTable('questions', function (table) {
      table.string('statusId')

      table.text('options')

      table.integer('votersCount').defaultTo(0)

      table.timestamp('endAt', { useTz: true }).defaultTo(knex.fn.now())

      table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
      table.timestamp('updatedAt', { useTz: true })
    })
    .createTable('follows', function (table) {
      table.string('id').primary()
      table.string('actorId')
      table.string('actorHost')

      table.string('targetActorId')
      table.string('targetActorHost')
      table.string('status')

      table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
      table.timestamp('updatedAt', { useTz: true })
    })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema
    .dropTable('follows')
    .dropTable('questions')
    .dropTable('status')
    .dropTable('actors')
    .dropTable('accounts')
}
