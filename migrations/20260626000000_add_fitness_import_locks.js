/**
 * Adds a small advisory-style lock table used to serialize fitness imports per
 * actor. Strava fires one webhook per activity, so recording a single ride on
 * two devices delivers two activities at nearly the same time; without
 * serialization the two imports run concurrently, neither sees the other's
 * not-yet-assigned status, and each creates its own post (duplicate same-ride
 * posts). A short-lived row keyed by the actor lets the second import wait for
 * the first to finish assigning its status, so the overlap merge can collapse
 * them into one post. Rows are ephemeral: they are deleted on release and
 * stolen once `expiresAt` passes (covers a worker killed mid-import).
 *
 * The column is named `lockKey` rather than `key` to avoid the reserved word in
 * MySQL-compatible backends. `expiresAt` is epoch milliseconds.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  const hasTable = await knex.schema.hasTable('fitness_import_locks')
  if (hasTable) return

  await knex.schema.createTable('fitness_import_locks', (table) => {
    table.string('lockKey').primary()
    table.string('token').notNullable()
    table.bigInteger('expiresAt').notNullable()
    table.timestamp('createdAt').defaultTo(knex.fn.now())
    table.index(['expiresAt'])
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  const hasTable = await knex.schema.hasTable('fitness_import_locks')
  if (!hasTable) return

  await knex.schema.dropTable('fitness_import_locks')
}
