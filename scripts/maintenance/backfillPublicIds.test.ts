import knex from 'knex'

import { getPublicIdTimestamp, isPublicId } from '@/lib/utils/publicId'
import * as migration from '@/migrations/20260808000000_add_public_ids'

import { mintPublicId, parseArgs } from './backfillPublicIds'

describe('backfillPublicIds parseArgs', () => {
  it('defaults to a live run with the standard batch size', () => {
    expect(parseArgs([])).toEqual({ dryRun: false, batchSize: 500 })
  })

  it('accepts bare, inline, and space-separated boolean flags', () => {
    expect(parseArgs(['--dry-run'])).toEqual({ dryRun: true, batchSize: 500 })
    expect(parseArgs(['--dry-run=false'])).toEqual({
      dryRun: false,
      batchSize: 500
    })
    expect(parseArgs(['--dry-run', 'true'])).toEqual({
      dryRun: true,
      batchSize: 500
    })
  })

  it('accepts a batch size inline or space-separated', () => {
    expect(parseArgs(['--batch-size', '50'])).toEqual({
      dryRun: false,
      batchSize: 50
    })
    expect(parseArgs(['--batch-size=50', '--dry-run'])).toEqual({
      dryRun: true,
      batchSize: 50
    })
  })

  it.each([
    { description: 'a non-flag argument', args: ['statuses'] },
    { description: 'an unknown flag', args: ['--tables', 'statuses'] },
    {
      description: 'a boolean that is not true or false',
      args: ['--dry-run', 'maybe']
    },
    { description: 'a zero batch size', args: ['--batch-size', '0'] },
    { description: 'a fractional batch size', args: ['--batch-size', '1.5'] },
    { description: 'a batch size with no value', args: ['--batch-size'] }
  ])('rejects $description', ({ args }) => {
    expect(() => parseArgs(args)).toThrow()
  })
})

describe('backfillPublicIds mintPublicId', () => {
  it.each([
    { description: 'a Date', createdAt: new Date(Date.UTC(2024, 2, 4)) },
    { description: 'epoch milliseconds', createdAt: Date.UTC(2024, 2, 4) },
    {
      description: 'a SQLite naive UTC string',
      createdAt: '2024-03-04 05:06:07'
    },
    { description: 'an ISO string', createdAt: '2024-03-04T05:06:07.000Z' },
    { description: 'an unparseable value', createdAt: 'not-a-date' },
    {
      description: 'a pre-epoch date',
      createdAt: new Date(Date.UTC(1969, 0, 1))
    }
  ])(
    'mints from $description exactly as the migration does',
    async ({ createdAt }) => {
      // The migration is plain ESM JavaScript run by the knex CLI, which resolves
      // no `@/` aliases and compiles no TypeScript, so it cannot import the
      // script's helper and carries its own copy. Comparing the two by the
      // timestamp they encode is what keeps the copies honest: a row the script
      // repairs after the rollout must sort with the rows the migration filled.
      const database = knex({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: { filename: ':memory:' }
      })
      try {
        await database.schema.createTable('statuses', (table) => {
          table.string('id').primary()
          table.datetime('createdAt')
        })
        await database.schema.createTable('actors', (table) => {
          table.string('id')
          table.datetime('createdAt')
        })
        await database('statuses').insert([
          { id: 'https://llun.test/users/a/statuses/1', createdAt }
        ])

        vi.spyOn(console, 'log').mockImplementation(() => undefined)
        await migration.up(database)

        const [row] = await database('statuses').select('createdAt', 'publicId')
        const scriptPublicId = mintPublicId(row.createdAt)
        expect(isPublicId(scriptPublicId)).toBe(true)
        expect(getPublicIdTimestamp(scriptPublicId)).toBe(
          getPublicIdTimestamp(row.publicId)
        )
      } finally {
        await database.destroy()
      }
    }
  )

  it('keeps lexicographic order matching chronological order', () => {
    const older = mintPublicId(new Date(Date.UTC(2020, 0, 1)))
    const newer = mintPublicId(new Date(Date.UTC(2023, 5, 15)))
    expect(older < newer).toBe(true)
  })
})
