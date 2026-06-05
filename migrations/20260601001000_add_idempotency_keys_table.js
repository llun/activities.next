/**
 * Idempotency keys for `POST /api/v1/statuses`. Mastodon honors an
 * `Idempotency-Key` header so a retried create returns the original status
 * instead of duplicating it. A row maps one actor's key to the status it
 * created.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) =>
  knex.schema.createTable('idempotency_keys', (table) => {
    table.string('actorId').notNullable()
    table.string('key').notNullable()
    table.string('statusId').notNullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())

    table.primary(['actorId', 'key'])
    // Indexed so deletion by statusId (orphan cleanup when a status is removed)
    // and expiry sweeps by createdAt stay efficient.
    table.index(['statusId'], 'idempotency_keys_status')
    table.index(['createdAt'], 'idempotency_keys_created')
  })

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => knex.schema.dropTable('idempotency_keys')
