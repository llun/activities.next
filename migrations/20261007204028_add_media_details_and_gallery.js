/**
 * Media details and the gallery foundation (PR 1 of the media gallery).
 *
 * `medias` gains the columns a photo or video is described by beyond alt text:
 * the subject (`subjectName`, `subjectScientificName`, `subjectCategory`), when
 * it was taken (`takenAt`, from EXIF `DateTimeOriginal`), the gear it was shot
 * with (`cameraGearId`, `lensGearId`), the exposure settings (`exposure`, a
 * JSON-encoded text column so SQLite, PostgreSQL and MySQL-compatible backends
 * all behave the same), the place (`placeName`, `placeLatitude`,
 * `placeLongitude`, `placePrecision`) and whether the owner shows it in their
 * gallery (`inGallery`, NOT NULL, default false). Every other column is
 * nullable: an existing row, and any upload that carries no EXIF, simply has no
 * details.
 *
 * `cameraGearId` and `lensGearId` are plain columns with no database-level
 * foreign key, for the same reason `fitness_files.gearId` has none: adding an
 * FK through `alterTable` requires a table rebuild on SQLite, which no
 * migration in this repo does. Ownership is enforced in
 * `lib/database/sql/gallery.ts` and the media routes.
 *
 * `gallery_gears` mirrors `fitness_gears`: soft-deleted rows, and
 * `deviceKey` (`camera:<make>|<model>` / `lens:<lensModel>`) as the immutable
 * identity an upload's EXIF resolves against, unique per actor. NULLs compare
 * as distinct on both PostgreSQL and SQLite, so gear a person adds by hand —
 * which carries no `deviceKey` — is unconstrained by it.
 *
 * `gallery_settings` is one row per actor (the primary key is the foreign key);
 * a missing row means every default applies. `hiddenLocations` is a JSON text
 * column that the gallery map reads in a later change.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  const columns = [
    ['subjectName', (table) => table.string('subjectName', 255).nullable()],
    [
      'subjectScientificName',
      (table) => table.string('subjectScientificName', 255).nullable()
    ],
    [
      'subjectCategory',
      (table) => table.string('subjectCategory', 32).nullable()
    ],
    [
      'takenAt',
      (table) => table.timestamp('takenAt', { useTz: true }).nullable()
    ],
    ['cameraGearId', (table) => table.string('cameraGearId').nullable()],
    ['lensGearId', (table) => table.string('lensGearId').nullable()],
    ['exposure', (table) => table.text('exposure').nullable()],
    ['placeName', (table) => table.string('placeName', 255).nullable()],
    ['placeLatitude', (table) => table.double('placeLatitude').nullable()],
    ['placeLongitude', (table) => table.double('placeLongitude').nullable()],
    [
      'placePrecision',
      (table) => table.string('placePrecision', 16).nullable()
    ],
    [
      'inGallery',
      (table) => table.boolean('inGallery').notNullable().defaultTo(false)
    ]
  ]

  for (const [name, addColumn] of columns) {
    const hasColumn = await knex.schema.hasColumn('medias', name)
    if (!hasColumn) {
      await knex.schema.alterTable('medias', function (table) {
        addColumn(table)
      })
    }
  }

  const hasGearTable = await knex.schema.hasTable('gallery_gears')
  if (!hasGearTable) {
    await knex.schema.createTable('gallery_gears', function (table) {
      table.string('id').primary()
      table
        .string('actorId')
        .notNullable()
        .references('id')
        .inTable('actors')
        .onDelete('CASCADE')
      table.string('kind').notNullable()
      table.string('name').notNullable()
      table.string('brand').nullable()
      table.string('model').nullable()
      table.string('productUrl').nullable()
      table.string('deviceKey').nullable()
      table.timestamp('retiredAt', { useTz: true }).nullable()
      table.timestamp('createdAt', { useTz: true }).notNullable()
      table.timestamp('updatedAt', { useTz: true }).notNullable()
      table.timestamp('deletedAt', { useTz: true }).nullable()

      table.index(['actorId'], 'gallery_gears_actor_id_idx')
      table.unique(['actorId', 'deviceKey'], {
        indexName: 'gallery_gears_actor_device_key_unique'
      })
    })
  }

  const hasSettingsTable = await knex.schema.hasTable('gallery_settings')
  if (!hasSettingsTable) {
    await knex.schema.createTable('gallery_settings', function (table) {
      table
        .string('actorId')
        .primary()
        .references('id')
        .inTable('actors')
        .onDelete('CASCADE')
      table.boolean('autoDescribe').notNullable().defaultTo(true)
      table.boolean('allowEmptyDescription').notNullable().defaultTo(true)
      table.boolean('subjectHashtags').notNullable().defaultTo(true)
      table.string('galleryDefault').notNullable().defaultTo('subject')
      table.string('defaultPlacePrecision').notNullable().defaultTo('area')
      table.boolean('showGear').notNullable().defaultTo(true)
      table.boolean('mapPublic').notNullable().defaultTo(true)
      table.boolean('lifeListPublic').notNullable().defaultTo(false)
      table.text('hiddenLocations').notNullable().defaultTo('[]')
      table.timestamp('createdAt', { useTz: true }).notNullable()
      table.timestamp('updatedAt', { useTz: true }).notNullable()
    })
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  await knex.schema.dropTableIfExists('gallery_settings')

  const hasGearTable = await knex.schema.hasTable('gallery_gears')
  if (hasGearTable) {
    await knex.schema.dropTable('gallery_gears')
  }

  const columns = [
    'inGallery',
    'placePrecision',
    'placeLongitude',
    'placeLatitude',
    'placeName',
    'exposure',
    'lensGearId',
    'cameraGearId',
    'takenAt',
    'subjectCategory',
    'subjectScientificName',
    'subjectName'
  ]
  for (const name of columns) {
    const hasColumn = await knex.schema.hasColumn('medias', name)
    if (hasColumn) {
      await knex.schema.alterTable('medias', function (table) {
        table.dropColumn(name)
      })
    }
  }
}
