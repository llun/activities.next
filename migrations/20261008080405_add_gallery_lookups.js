/**
 * Smart subjects and place lookups (PR 3 of the media gallery). Additive only.
 *
 * `medias` gains what the subject and place lookups resolve, all nullable:
 *
 * - `subjectTaxonKey` (GBIF usage key), `subjectTaxonPath` (JSON text,
 *   kingdom to family names, stored at resolve time so public reads never
 *   trigger a lookup), `subjectIucnCategory` (CR/EN/VU/NT/LC/DD/NE/EW/EX),
 *   `subjectLookupStatus` (`pending`, `resolved`, `no-match`, `failed`,
 *   `disabled`; null = never attempted or not species-like) and
 *   `subjectLookupAt` (the last attempt).
 * - `subjectSuggestions`: the vision model's candidates as JSON text. Owner-only
 *   and never applied to the `subject*` columns by itself.
 * - `placeCountryCode` (ISO 3166-1 alpha-2), `placeNameSource` (`owner` or
 *   `geocoder`; null = a name from before this migration, treated as the
 *   owner's) and `placeLookupStatus` (the same enum as the subject's).
 *
 * `gallery_settings` gains `hideThreatenedPlaces` (default on: a species-like
 * subject's place is withheld from everyone but the owner until a lookup says
 * it is not CR, EN or VU), `subjectSuggestionMode` (`model` or `off`;
 * `classifier` is reserved) and `subjectConfidenceThreshold` (percent).
 *
 * `gallery_lookup_cache` is a read-through cache of GBIF and Nominatim answers,
 * keyed by (`kind`, `key`), with an `outcome` of `ok`, `miss` or `error` and an
 * expiry. It is not linked to any actor, but geocode keys are ~5 km grid cells,
 * so the table is a coarse trace of where photos were taken.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  const mediaColumns = [
    [
      'subjectTaxonKey',
      (table) => table.string('subjectTaxonKey', 32).nullable()
    ],
    ['subjectTaxonPath', (table) => table.text('subjectTaxonPath').nullable()],
    [
      'subjectIucnCategory',
      (table) => table.string('subjectIucnCategory', 2).nullable()
    ],
    [
      'subjectLookupStatus',
      (table) => table.string('subjectLookupStatus', 16).nullable()
    ],
    [
      'subjectLookupAt',
      (table) => table.timestamp('subjectLookupAt', { useTz: true }).nullable()
    ],
    [
      'subjectSuggestions',
      (table) => table.text('subjectSuggestions').nullable()
    ],
    [
      'placeCountryCode',
      (table) => table.string('placeCountryCode', 2).nullable()
    ],
    [
      'placeNameSource',
      (table) => table.string('placeNameSource', 16).nullable()
    ],
    [
      'placeLookupStatus',
      (table) => table.string('placeLookupStatus', 16).nullable()
    ]
  ]

  for (const [name, addColumn] of mediaColumns) {
    const hasColumn = await knex.schema.hasColumn('medias', name)
    if (!hasColumn) {
      await knex.schema.alterTable('medias', function (table) {
        addColumn(table)
      })
    }
  }

  const settingsColumns = [
    [
      'hideThreatenedPlaces',
      (table) =>
        table.boolean('hideThreatenedPlaces').notNullable().defaultTo(true)
    ],
    [
      'subjectSuggestionMode',
      (table) =>
        table
          .string('subjectSuggestionMode', 16)
          .notNullable()
          .defaultTo('model')
    ],
    [
      'subjectConfidenceThreshold',
      (table) =>
        table.integer('subjectConfidenceThreshold').notNullable().defaultTo(70)
    ]
  ]

  for (const [name, addColumn] of settingsColumns) {
    const hasColumn = await knex.schema.hasColumn('gallery_settings', name)
    if (!hasColumn) {
      await knex.schema.alterTable('gallery_settings', function (table) {
        addColumn(table)
      })
    }
  }

  const hasCacheTable = await knex.schema.hasTable('gallery_lookup_cache')
  if (!hasCacheTable) {
    await knex.schema.createTable('gallery_lookup_cache', function (table) {
      table.string('kind', 32).notNullable()
      table.string('key', 255).notNullable()
      table.string('outcome', 8).notNullable()
      table.text('value').nullable()
      table.timestamp('fetchedAt', { useTz: true }).notNullable()
      table.timestamp('expiresAt', { useTz: true }).notNullable()

      table.primary(['kind', 'key'])
      table.index(['expiresAt'], 'gallery_lookup_cache_expires_at_idx')
    })
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  await knex.schema.dropTableIfExists('gallery_lookup_cache')

  const settingsColumns = [
    'subjectConfidenceThreshold',
    'subjectSuggestionMode',
    'hideThreatenedPlaces'
  ]
  for (const name of settingsColumns) {
    const hasColumn = await knex.schema.hasColumn('gallery_settings', name)
    if (hasColumn) {
      await knex.schema.alterTable('gallery_settings', function (table) {
        table.dropColumn(name)
      })
    }
  }

  const mediaColumns = [
    'placeLookupStatus',
    'placeNameSource',
    'placeCountryCode',
    'subjectSuggestions',
    'subjectLookupAt',
    'subjectLookupStatus',
    'subjectIucnCategory',
    'subjectTaxonPath',
    'subjectTaxonKey'
  ]
  for (const name of mediaColumns) {
    const hasColumn = await knex.schema.hasColumn('medias', name)
    if (hasColumn) {
      await knex.schema.alterTable('medias', function (table) {
        table.dropColumn(name)
      })
    }
  }
}
