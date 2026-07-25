/**
 * Status emoji reactions (Misskey/Pleroma interop). One row per
 * (status, actor, reaction name); `name` is a unicode emoji, a local
 * custom-emoji shortcode, or `shortcode@domain` for remote custom emoji.
 * `url` stores the remote emoji image; local emoji resolve live from
 * `customEmojis`. Also adds `notifications.reactionName` for the
 * `pleroma:emoji_reaction` notification payload.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.schema.createTable('status_reactions', (table) => {
    table.string('statusId').notNullable()
    table.string('actorId').notNullable()
    table.string('name').notNullable()
    table.text('url').nullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())
    table.primary(['statusId', 'actorId', 'name'])
    table.index(['statusId', 'createdAt'], 'status_reactions_status_created')
    table.index(['actorId'], 'status_reactions_actor')
  })
  await knex.schema.alterTable('notifications', (table) => {
    table.string('reactionName').nullable()
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.schema.alterTable('notifications', (table) => {
    table.dropColumn('reactionName')
  })
  await knex.schema.dropTable('status_reactions')
}
