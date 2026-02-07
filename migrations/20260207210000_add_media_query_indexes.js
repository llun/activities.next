/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) => {
    return knex.schema
        .alterTable('actors', function (table) {
            // Index for filtering actors by accountId in media queries
            table.index(['accountId'], 'actors_accountId_idx')
        })
        .alterTable('medias', function (table) {
            // Composite index for JOIN on actorId and ORDER BY createdAt DESC
            table.index(['actorId', 'createdAt'], 'medias_actorId_createdAt_idx')
        })
        .alterTable('attachments', function (table) {
            // Index for LEFT JOIN on attachments.url
            table.index(['url'], 'attachments_url_idx')
        })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => {
    return knex.schema
        .alterTable('actors', function (table) {
            table.dropIndex(['accountId'], 'actors_accountId_idx')
        })
        .alterTable('medias', function (table) {
            table.dropIndex(['actorId', 'createdAt'], 'medias_actorId_createdAt_idx')
        })
        .alterTable('attachments', function (table) {
            table.dropIndex(['url'], 'attachments_url_idx')
        })
}
