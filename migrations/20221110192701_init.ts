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

      table.string('accountId').unsigned()
      table.foreign('accountId').references('id').inTable('accounts')

      table.string('followingId')
      table.foreign('followingId').references('id').inTable('actors')

      table.text('summary')
      table.boolean('manuallyApprovesFollowers')
      table.boolean('discoverable')

      table.text('publicKey')
      table.text('privateKey')

      table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
      table.timestamp('updatedAt', { useTz: true })
    })
    .createTable('statuses', function (table) {
      table.string('uri').primary()
      table.string('actorId').unsigned()
      table.foreign('actorId').references('id').inTable('actors')

      table.string('url')
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
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('status').dropTable('accounts')
}
