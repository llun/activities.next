/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('tags', function (table) {
    table.string('nameNormalized')
    table.index(['nameNormalized', 'type'], 'tags_nameNormalized_type_idx')
  })

  const isPg =
    knex.client.config.client === 'pg' ||
    knex.client.config.client === 'postgresql'
  if (isPg) {
    await knex.raw(
      `UPDATE tags SET "nameNormalized" = LOWER(name) WHERE type = 'hashtag'`
    )
  } else {
    await knex.raw(
      `UPDATE tags SET nameNormalized = LOWER(name) WHERE type = 'hashtag'`
    )
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async (knex) => {
  await knex.schema.alterTable('tags', function (table) {
    table.dropIndex(['nameNormalized', 'type'], 'tags_nameNormalized_type_idx')
    table.dropColumn('nameNormalized')
  })
}
