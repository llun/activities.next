/**
 * Recording devices become a third `fitness_gears.kind`, alongside `bike` and
 * `shoes`. `kind` is an unconstrained varchar on both backends, so the new value
 * itself needs no schema change — what this migration adds is the identity a
 * device row is keyed on and the link from an activity to it.
 *
 * `deviceKey` is the immutable recorded identity of the device, derived from the
 * activity's own `deviceName`/`deviceManufacturer` (`name:<normalized name>`, or
 * `mfr:<brand key>` when only a recognised manufacturer is known). It is the
 * idempotency key an import resolves against, which is why it is separate from
 * `name`/`brand`/`model`/`productUrl` — those four are display fields the owner
 * may rewrite freely without forking a duplicate row on the next upload. The
 * unique index is composite with `actorId` because a device is per-athlete;
 * NULLs compare as distinct on both PostgreSQL and SQLite, so bikes and shoes —
 * which never carry a `deviceKey` — are unconstrained by it.
 *
 * `productUrl` is seeded from the brand map when a device row is auto-created,
 * so the manufacturer link the activity page used to render inline moves onto
 * the device itself. The owner can replace it with the actual product page.
 *
 * `fitness_files.deviceGearId` is a plain indexed column with no database-level
 * foreign key, for the same reason `gearId` beside it has none: adding an FK
 * through `alterTable` requires a table rebuild on SQLite, which no migration in
 * this repo does. Ownership is enforced in `lib/database/sql/fitnessGear.ts`,
 * and deleting gear detaches the column in the same transaction.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  const hasDeviceKey = await knex.schema.hasColumn('fitness_gears', 'deviceKey')
  const hasProductUrl = await knex.schema.hasColumn(
    'fitness_gears',
    'productUrl'
  )
  if (!hasDeviceKey || !hasProductUrl) {
    await knex.schema.alterTable('fitness_gears', function (table) {
      if (!hasDeviceKey) table.string('deviceKey').nullable()
      if (!hasProductUrl) table.string('productUrl').nullable()
    })
  }

  // The unique index is created in its own alterTable, after the column exists:
  // SQLite adds a column with `ALTER TABLE … ADD COLUMN` and creates an index
  // with a separate statement, and knex builds the whole batch before running
  // any of it.
  if (!hasDeviceKey) {
    await knex.schema.alterTable('fitness_gears', function (table) {
      table.unique(['actorId', 'deviceKey'], {
        indexName: 'fitness_gears_actor_device_key_unique'
      })
    })
  }

  const hasDeviceGearId = await knex.schema.hasColumn(
    'fitness_files',
    'deviceGearId'
  )
  if (!hasDeviceGearId) {
    await knex.schema.alterTable('fitness_files', function (table) {
      table.string('deviceGearId').nullable()
      table.index(['deviceGearId'], 'fitness_files_device_gear_id_idx')
    })
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  const hasDeviceGearId = await knex.schema.hasColumn(
    'fitness_files',
    'deviceGearId'
  )
  if (hasDeviceGearId) {
    await knex.schema.alterTable('fitness_files', function (table) {
      // No explicit dropIndex: both backends drop a column's indexes with it,
      // and dropping one that a partially-applied `up` never created would make
      // the rollback throw.
      table.dropColumn('deviceGearId')
    })
  }

  const hasDeviceKey = await knex.schema.hasColumn('fitness_gears', 'deviceKey')
  if (hasDeviceKey) {
    // The unique index is dropped in its own alterTable before the column:
    // SQLite rebuilds the table to drop a column, and an index still naming the
    // departing column is not something that survives the rebuild.
    await knex.schema.alterTable('fitness_gears', function (table) {
      table.dropUnique(
        ['actorId', 'deviceKey'],
        'fitness_gears_actor_device_key_unique'
      )
    })
    await knex.schema.alterTable('fitness_gears', function (table) {
      table.dropColumn('deviceKey')
    })
  }

  const hasProductUrl = await knex.schema.hasColumn(
    'fitness_gears',
    'productUrl'
  )
  if (hasProductUrl) {
    await knex.schema.alterTable('fitness_gears', function (table) {
      table.dropColumn('productUrl')
    })
  }
}
