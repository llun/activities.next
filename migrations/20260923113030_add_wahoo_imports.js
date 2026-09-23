/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  await knex.schema.alterTable('fitness_settings', function (table) {
    table.string('providerUserId')
    table.string('providerEnvironment')
    table.string('grantedScopes')
    table.text('wahooWebhookToken')
    table.string('wahooWebhookTokenHash')
    table.timestamp('lastWebhookAt', { useTz: true })
    table.timestamp('lastImportAt', { useTz: true })
    table.text('connectionError')
  })
  await knex.schema.alterTable('fitness_settings', function (table) {
    table.index('wahooWebhookTokenHash', 'fitness_settings_wahoo_token_idx')
  })

  await knex.schema.createTable('wahoo_imports', function (table) {
    table.string('id').primary()
    table
      .string('actorId')
      .notNullable()
      .references('id')
      .inTable('actors')
      .onDelete('CASCADE')
    table.string('providerUserId').notNullable()
    table.string('workoutId').notNullable()
    table.string('summaryId')
    table.timestamp('summaryUpdatedAt', { useTz: true })
    table
      .string('fitnessFileId')
      .references('id')
      .inTable('fitness_files')
      .onDelete('SET NULL')
    table
      .string('statusId')
      .references('id')
      .inTable('statuses')
      .onDelete('SET NULL')
    table.string('historyImportId')
    table.string('status').notNullable().defaultTo('pending')
    table.integer('attempts').notNullable().defaultTo(0)
    table.text('lastError')
    table
      .timestamp('createdAt', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now())
    table
      .timestamp('updatedAt', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now())
    table.unique(['actorId', 'providerUserId', 'workoutId'])
    table.index(['actorId', 'status'], 'wahoo_imports_actor_status_idx')
    table.index('historyImportId', 'wahoo_imports_history_idx')
  })

  await knex.schema.createTable('wahoo_history_imports', function (table) {
    table.string('id').primary()
    table
      .string('actorId')
      .notNullable()
      .references('id')
      .inTable('actors')
      .onDelete('CASCADE')
    table.string('providerUserId').notNullable()
    table.date('fromDate').notNullable()
    table.date('toDate').notNullable()
    table.integer('nextPage').notNullable().defaultTo(1)
    table.boolean('scanComplete').notNullable().defaultTo(false)
    table.integer('total').notNullable().defaultTo(0)
    table.integer('completed').notNullable().defaultTo(0)
    table.integer('failed').notNullable().defaultTo(0)
    table.string('status').notNullable().defaultTo('pending')
    table.text('lastError')
    table
      .timestamp('createdAt', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now())
    table
      .timestamp('updatedAt', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now())
    table.index(['actorId', 'status'], 'wahoo_history_actor_status_idx')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  await knex.schema.dropTable('wahoo_history_imports')
  await knex.schema.dropTable('wahoo_imports')
  await knex.schema.alterTable('fitness_settings', function (table) {
    table.dropIndex('wahooWebhookTokenHash', 'fitness_settings_wahoo_token_idx')
    table.dropColumn('providerUserId')
    table.dropColumn('providerEnvironment')
    table.dropColumn('grantedScopes')
    table.dropColumn('wahooWebhookToken')
    table.dropColumn('wahooWebhookTokenHash')
    table.dropColumn('lastWebhookAt')
    table.dropColumn('lastImportAt')
    table.dropColumn('connectionError')
  })
}
