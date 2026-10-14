/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.schema.createTable('queue_jobs', (table) => {
    table.string('id', 255).primary()
    table.string('name', 255).notNullable()
    table.jsonb('payload').notNullable()
    table.integer('attempts').notNullable().defaultTo(0)
    table.integer('max_retries').notNullable().defaultTo(16)
    table
      .timestamp('next_run_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now())
    table.string('status', 32).notNullable().defaultTo('pending')
    table.text('last_error_message').nullable()
    table.text('last_error_stack').nullable()
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now())

    table.index(['status', 'next_run_at'], 'queue_jobs_status_next_run_at_idx')
    table.index(['name'], 'queue_jobs_name_idx')
    table.index(['created_at'], 'queue_jobs_created_at_idx')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.schema.dropTableIfExists('queue_jobs')
}
