/**
 * Albums (PR 1 of the gallery albums). Additive only.
 *
 * `gallery_albums` is one owner-curated album: a title, an optional
 * description, an optional explicit cover (`coverMediaId`, which must be one of
 * the album's own items; it is a plain column with no foreign key, like
 * `medias.cameraGearId`, because it is cleared by the store when its media
 * goes), who may open it (`visibility`: `public` or `private`) and how its
 * photos are ordered by default (`sortOrder`: `taken_desc`, `taken_asc` or
 * `added_desc`).
 *
 * `gallery_album_items` joins an album to the media in it, `(albumId, mediaId)`
 * being the primary key so one photo is in an album at most once and in as many
 * albums as the owner likes. `actorId` repeats the album's owner so a read can
 * be scoped without the join. An item says nothing about who may see the photo:
 * that is decided at read time by the gallery scope.
 *
 * Both foreign keys cascade, but SQLite runs without foreign keys, so
 * `lib/database/sql/galleryAlbums.ts` and the media delete paths remove items
 * and null covers themselves.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  const hasAlbums = await knex.schema.hasTable('gallery_albums')
  if (!hasAlbums) {
    await knex.schema.createTable('gallery_albums', function (table) {
      table.string('id').primary()
      table
        .string('actorId')
        .notNullable()
        .references('id')
        .inTable('actors')
        .onDelete('CASCADE')
      table.string('title', 120).notNullable()
      table.text('description').nullable()
      table.integer('coverMediaId').nullable()
      table.string('visibility', 16).notNullable().defaultTo('public')
      table.string('sortOrder', 16).notNullable().defaultTo('taken_desc')
      table.timestamp('createdAt', { useTz: true }).notNullable()
      table.timestamp('updatedAt', { useTz: true }).notNullable()

      table.index(['actorId', 'updatedAt'], 'gallery_albums_actor_updated_idx')
    })
  }

  const hasItems = await knex.schema.hasTable('gallery_album_items')
  if (!hasItems) {
    await knex.schema.createTable('gallery_album_items', function (table) {
      table
        .string('albumId')
        .notNullable()
        .references('id')
        .inTable('gallery_albums')
        .onDelete('CASCADE')
      table
        .integer('mediaId')
        .notNullable()
        .references('id')
        .inTable('medias')
        .onDelete('CASCADE')
      table.string('actorId').notNullable()
      table.timestamp('createdAt', { useTz: true }).notNullable()

      table.primary(['albumId', 'mediaId'])
      table.index(['mediaId'], 'gallery_album_items_media_idx')
    })
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  await knex.schema.dropTableIfExists('gallery_album_items')
  await knex.schema.dropTableIfExists('gallery_albums')
}
