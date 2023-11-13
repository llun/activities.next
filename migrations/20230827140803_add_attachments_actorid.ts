import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('attachments', function (table) {
    table.string('actorId')

    table.index(['actorId'], 'attachments_actorId_idx')
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('attachments', function (table) {
    table.dropIndex(['actorId'], 'attachments_actorId_idx')
    table.dropColumns('actorId')
  })
}
