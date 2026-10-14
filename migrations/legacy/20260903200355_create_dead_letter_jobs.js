/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.schema.createTable('dead_letter_jobs', (table) => {
    table.string('id', 255).primary()
    table.string('job_name', 255).notNullable()
    table.jsonb('payload').notNullable()
    table.text('error_message').notNullable()
    table.text('error_stack').nullable()
    table.integer('attempts').notNullable().defaultTo(1)
    table.string('status', 32).notNullable().defaultTo('failed')
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now())

    table.index(['job_name'], 'dead_letter_jobs_job_name_idx')
    table.index(['status'], 'dead_letter_jobs_status_idx')
    table.index(['created_at'], 'dead_letter_jobs_created_at_idx')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.schema.dropTableIfExists('dead_letter_jobs')
}
