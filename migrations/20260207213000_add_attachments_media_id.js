/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
    // 1. Add mediaId column
    await knex.schema.alterTable('attachments', function (table) {
        table.string('mediaId')
        table.index(['mediaId'], 'attachments_mediaId_idx')
    })

    // 2. Backfill mediaId using the existing URL matching logic
    // We use a raw query for the UPDATE with JOIN logic which is most efficient
    await knex.raw(`
    UPDATE attachments
    SET "mediaId" = medias.id
    FROM medias
    WHERE 
      (attachments.url = medias.original)
      OR (attachments.url LIKE '%' || medias.original)
      OR (attachments.url LIKE '%' || medias.thumbnail)
  `)

    // 3. Drop the url index as it's no longer needed for the main query
    // We keep it in the down migration of the previous file, but drop it here to clean up
    await knex.schema.alterTable('attachments', function (table) {
        table.dropIndex(['url'], 'attachments_url_idx')
    })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => {
    return knex.schema.alterTable('attachments', function (table) {
        table.dropIndex(['mediaId'], 'attachments_mediaId_idx')
        table.dropColumn('mediaId')
    })
}
