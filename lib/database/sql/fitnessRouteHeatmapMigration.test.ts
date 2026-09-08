import knex from 'knex'

import * as migration from '@/migrations/20260502190000_replace_fitness_heatmaps_with_route_cache'
import * as cursorMigration from '@/migrations/20260503120000_add_fitness_route_heatmap_cursor'
import * as partialFlagMigration from '@/migrations/20260503140000_add_fitness_route_heatmap_partial_flag'

describe('route heatmap migration', () => {
  it('captures legacy image paths and replaces the old heatmap table', async () => {
    const database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })

    try {
      await database.schema.createTable('actors', (table) => {
        table.string('id').primary()
      })
      await database.schema.createTable('fitness_heatmaps', (table) => {
        table.string('id').primary()
        table.string('actorId').notNullable()
        table.string('activityType')
        table.string('periodType').notNullable()
        table.string('periodKey').notNullable()
        table.string('region').notNullable().defaultTo('')
        table.string('imagePath')
      })
      await database('actors').insert({ id: 'actor-1' })
      await database('fitness_heatmaps').insert([
        {
          id: 'heatmap-1',
          actorId: 'actor-1',
          periodType: 'yearly',
          periodKey: '2026',
          region: '',
          imagePath: 'medias/heatmap-1.png'
        },
        {
          id: 'heatmap-2',
          actorId: 'actor-1',
          periodType: 'monthly',
          periodKey: '2026-04',
          region: '',
          imagePath: null
        }
      ])

      await migration.up(database)

      await expect(database.schema.hasTable('fitness_heatmaps')).resolves.toBe(
        false
      )
      await expect(
        database.schema.hasTable('fitness_route_heatmaps')
      ).resolves.toBe(true)
      await expect(
        database.schema.hasColumn('fitness_route_heatmaps', 'cursorOffset')
      ).resolves.toBe(true)
      await expect(
        database.schema.hasColumn('fitness_route_heatmaps', 'isPartial')
      ).resolves.toBe(true)
      await expect(
        database('legacy_fitness_heatmap_media_cleanup').select(
          'actorId',
          'imagePath'
        )
      ).resolves.toEqual([
        { actorId: 'actor-1', imagePath: 'medias/heatmap-1.png' }
      ])
    } finally {
      await database.destroy()
    }
  })

  it('can resume when legacy cleanup capture already exists', async () => {
    const database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })

    try {
      await database.schema.createTable('actors', (table) => {
        table.string('id').primary()
      })
      await database.schema.createTable('fitness_heatmaps', (table) => {
        table.string('id').primary()
        table.string('actorId').notNullable()
        table.string('activityType')
        table.string('periodType').notNullable()
        table.string('periodKey').notNullable()
        table.string('region').notNullable().defaultTo('')
        table.string('imagePath')
      })
      await database.schema.createTable(
        'legacy_fitness_heatmap_media_cleanup',
        (table) => {
          table.string('actorId').notNullable()
          table.string('imagePath').notNullable()
          table.timestamp('createdAt', { useTz: true }).notNullable()
          table.timestamp('deletedAt', { useTz: true })
          table.text('error')

          table.primary(['actorId', 'imagePath'])
        }
      )
      await database('actors').insert({ id: 'actor-1' })
      await database('fitness_heatmaps').insert({
        id: 'heatmap-1',
        actorId: 'actor-1',
        periodType: 'yearly',
        periodKey: '2026',
        region: '',
        imagePath: 'medias/heatmap-1.png'
      })
      await database('legacy_fitness_heatmap_media_cleanup').insert({
        actorId: 'actor-1',
        imagePath: 'medias/heatmap-1.png',
        createdAt: new Date(),
        deletedAt: null,
        error: null
      })

      await migration.up(database)

      await expect(database.schema.hasTable('fitness_heatmaps')).resolves.toBe(
        false
      )
      await expect(
        database.schema.hasTable('fitness_route_heatmaps')
      ).resolves.toBe(true)
      await expect(
        database('legacy_fitness_heatmap_media_cleanup').select(
          'actorId',
          'imagePath'
        )
      ).resolves.toEqual([
        { actorId: 'actor-1', imagePath: 'medias/heatmap-1.png' }
      ])
    } finally {
      await database.destroy()
    }
  })

  it('adds a cursor column to existing route heatmap tables', async () => {
    const database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })

    try {
      await database.schema.createTable('fitness_route_heatmaps', (table) => {
        table.string('id').primary()
      })

      await cursorMigration.up(database)

      await expect(
        database.schema.hasColumn('fitness_route_heatmaps', 'cursorOffset')
      ).resolves.toBe(true)
    } finally {
      await database.destroy()
    }
  })

  it('adds a partial flag column to existing route heatmap tables', async () => {
    const database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })

    try {
      await database.schema.createTable('fitness_route_heatmaps', (table) => {
        table.string('id').primary()
      })

      await partialFlagMigration.up(database)

      await expect(
        database.schema.hasColumn('fitness_route_heatmaps', 'isPartial')
      ).resolves.toBe(true)
    } finally {
      await database.destroy()
    }
  })

  it('keeps a baseline cursor column when rolling back the cursor backfill', async () => {
    const database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })

    try {
      await database.schema.createTable('actors', (table) => {
        table.string('id').primary()
      })
      await migration.up(database)

      await cursorMigration.down(database)

      await expect(
        database.schema.hasColumn('fitness_route_heatmaps', 'cursorOffset')
      ).resolves.toBe(true)
    } finally {
      await database.destroy()
    }
  })

  it('keeps a baseline partial flag column when rolling back the partial flag backfill', async () => {
    const database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })

    try {
      await database.schema.createTable('actors', (table) => {
        table.string('id').primary()
      })
      await migration.up(database)

      await partialFlagMigration.down(database)

      await expect(
        database.schema.hasColumn('fitness_route_heatmaps', 'isPartial')
      ).resolves.toBe(true)
    } finally {
      await database.destroy()
    }
  })
})
