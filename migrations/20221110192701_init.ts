import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema
    .createTable('accounts', function (table) {
      table.string('id').primary()
      table.string('email').unique().index('emailIndex')

      table
        .timestamp('createdAt', { useTz: true })
        .defaultTo(knex.fn.now())
        .index('timeIndex')
      table.timestamp('updatedAt', { useTz: true }).index('timeIndex')
    })
    .createTable('actors', function (table) {
      table.string('id').unique()
      table.string('preferredUsername').unique().index('usernameIndex')

      table.string('accountId')
      table.foreign('accountId').references('id').inTable('accounts')

      table.string('name')
      table.text('summary')
      table.boolean('manuallyApprovesFollowers')
      table.boolean('discoverable')

      table.text('publicKey')
      table.text('privateKey')

      table
        .timestamp('createdAt', { useTz: true })
        .defaultTo(knex.fn.now())
        .index('timeIndex')
      table.timestamp('updatedAt', { useTz: true }).index('timeIndex')
    })
    .createTable('statuses', function (table) {
      table.string('id').primary()
      table.string('url')

      table.string('actorId').index('actorIndex')

      table.string('type')
      table.text('text')
      table.text('summary')

      table.string('reply')
      table.boolean('sensitive')
      table.string('visibility')
      table.string('language')

      table.string('thread')
      table.string('conversation')

      table
        .timestamp('createdAt', { useTz: true })
        .defaultTo(knex.fn.now())
        .index('timeIndex')
      table.timestamp('updatedAt', { useTz: true }).index('timeIndex')
    })
    .createTable('statusDeliveries', function (table) {
      table.string('statusId').index('statusIndex')
      table.string('to')
    })
    .createTable('questions', function (table) {
      table.string('statusId').index('statusIndex')

      table.text('options')

      table.integer('votersCount').defaultTo(0)

      table.timestamp('endAt', { useTz: true }).defaultTo(knex.fn.now())

      table
        .timestamp('createdAt', { useTz: true })
        .defaultTo(knex.fn.now())
        .index('timeIndex')
      table.timestamp('updatedAt', { useTz: true }).index('timeIndex')
    })
    .createTable('follows', function (table) {
      table.string('id').primary()
      table.string('actorId').index('followStatusIndex')
      table.string('actorHost').index('actorHostIndex')

      table.string('targetActorId').index('followStatusIndex')
      table.string('targetActorHost').index('targetActorHostIndex')
      table.string('status').index('followStatusIndex')

      table
        .timestamp('createdAt', { useTz: true })
        .defaultTo(knex.fn.now())
        .index('timeIndex')
      table.timestamp('updatedAt', { useTz: true }).index('timeIndex')
    })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema
    .dropTable('follows')
    .dropTable('questions')
    .dropTable('status')
    .dropTable('statusDeliveries')
    .dropTable('actors')
    .dropTable('accounts')
}
