/**
 * Non-destructive photo edits (phase 1 of the photo editor).
 *
 * `medias` gains the edit state of a photo: `editRecipe` (the JSON recipe the
 * client rendered, null when the photo is unedited), `editVersion` (an
 * optimistic version every save and revert bumps, NOT NULL, default 0),
 * `editedAt` (null when unedited) and `editSaveId` (the client's id for the
 * last save or revert, so a retried request whose answer was lost can tell it
 * already landed).
 *
 * `media_edit_files` holds the stored files an edit keeps beside the live one:
 * the `original` slot (the file the photo was uploaded as, moved here by the
 * first save, so `medias.original` can point at the render), `superseded:<id>`
 * slots (earlier renders a "Gallery only" post may still show) and, in a later
 * phase, `mask:<id>` slots. One row per slot per media; the rows go with the
 * media through the foreign key on PostgreSQL, and the delete paths remove
 * them explicitly as well because SQLite may run without foreign keys.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  const columns = [
    ['editRecipe', (table) => table.text('editRecipe').nullable()],
    [
      'editVersion',
      (table) => table.integer('editVersion').notNullable().defaultTo(0)
    ],
    [
      'editedAt',
      (table) => table.timestamp('editedAt', { useTz: true }).nullable()
    ],
    ['editSaveId', (table) => table.string('editSaveId', 36).nullable()]
  ]

  for (const [name, addColumn] of columns) {
    const hasColumn = await knex.schema.hasColumn('medias', name)
    if (!hasColumn) {
      await knex.schema.alterTable('medias', function (table) {
        addColumn(table)
      })
    }
  }

  const hasTable = await knex.schema.hasTable('media_edit_files')
  if (!hasTable) {
    await knex.schema.createTable('media_edit_files', function (table) {
      table.string('id', 36).primary()
      table
        .integer('mediaId')
        .notNullable()
        .references('id')
        .inTable('medias')
        .onDelete('CASCADE')
      table.string('actorId').notNullable()
      // 'original' | 'superseded:<uuid>' | 'mask:<id>'
      table.string('slot', 64).notNullable()
      table.string('path', 255).notNullable()
      table.bigInteger('bytes').notNullable()
      table.string('mimeType', 64).notNullable()
      table.text('metaData').notNullable()
      table
        .timestamp('createdAt', { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now())

      table.unique(['mediaId', 'slot'], {
        indexName: 'media_edit_files_media_slot_unique'
      })
      table.index(['actorId'], 'media_edit_files_actor_id_idx')
    })
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  await knex.schema.dropTableIfExists('media_edit_files')

  const columns = ['editSaveId', 'editedAt', 'editVersion', 'editRecipe']
  for (const name of columns) {
    const hasColumn = await knex.schema.hasColumn('medias', name)
    if (hasColumn) {
      await knex.schema.alterTable('medias', function (table) {
        table.dropColumn(name)
      })
    }
  }
}
