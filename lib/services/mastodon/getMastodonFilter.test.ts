import knex, { Knex } from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'
import {
  getMastodonFilter,
  getMastodonFilters,
  getV1Filter
} from '@/lib/services/mastodon/getMastodonFilter'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { V1Filter } from '@/lib/types/mastodon'

describe('getMastodonFilter', () => {
  let knexDatabase: Knex
  let database: Database

  beforeAll(async () => {
    knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    database = getSQLDatabase(knexDatabase)
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('serializes a domain filter into the Mastodon API shape', async () => {
    const expiresAt = Date.now() + 60_000
    const filter = await database.createFilter({
      actorId: ACTOR1_ID,
      title: 'Apple',
      context: ['home', 'public'],
      filterAction: 'warn',
      expiresAt,
      keywords: [{ keyword: 'apple', wholeWord: true }]
    })
    await database.addFilterStatus({
      actorId: ACTOR1_ID,
      filterId: filter.id,
      statusId: 'https://llun.test/users/test1/statuses/100'
    })

    const result = await getMastodonFilter(database, filter)

    expect(result.id).toBe(filter.id)
    expect(result.title).toBe('Apple')
    expect(result.context.sort()).toEqual(['home', 'public'])
    expect(result.filter_action).toBe('warn')
    expect(result.expires_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    )
    expect(result.keywords).toHaveLength(1)
    expect(result.keywords[0]).toMatchObject({
      keyword: 'apple',
      whole_word: true
    })
    expect(result.statuses).toHaveLength(1)
    expect(result.statuses[0].status_id).toBe(
      'https://llun.test/users/test1/statuses/100'
    )
  })

  it('serializes multiple filters via the batched helper', async () => {
    const a = await database.createFilter({
      actorId: ACTOR1_ID,
      title: 'A',
      context: ['home'],
      filterAction: 'hide',
      expiresAt: null
    })
    const b = await database.createFilter({
      actorId: ACTOR1_ID,
      title: 'B',
      context: ['public'],
      filterAction: 'warn',
      expiresAt: null
    })

    const result = await getMastodonFilters(database, [a, b])

    expect(result.map((entry) => entry.title)).toEqual(['A', 'B'])
    expect(result[0].expires_at).toBeNull()
    expect(result[0].filter_action).toBe('hide')
  })
})

describe('getV1Filter', () => {
  const baseKeyword = {
    id: 'keyword-1',
    filterId: 'filter-1',
    keyword: 'apple',
    wholeWord: true,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000
  }

  it('builds the v1 row from the keyword and its parent filter', () => {
    const result = getV1Filter(
      {
        context: ['home', 'public'],
        expiresAt: Date.UTC(2026, 0, 2, 3, 4, 5, 6),
        filterAction: 'warn'
      },
      baseKeyword
    )

    expect(result).toEqual({
      id: 'keyword-1',
      phrase: 'apple',
      context: ['home', 'public'],
      expires_at: '2026-01-02T03:04:05.006Z',
      irreversible: false,
      whole_word: true
    })
    expect(V1Filter.safeParse(result).success).toBe(true)
  })

  it.each([
    {
      description: 'maps filter_action warn to irreversible=false',
      filterAction: 'warn' as const,
      expected: false
    },
    {
      description: 'maps filter_action hide to irreversible=true',
      filterAction: 'hide' as const,
      expected: true
    }
  ])('$description', ({ filterAction, expected }) => {
    const result = getV1Filter(
      { context: ['home'], expiresAt: null, filterAction },
      baseKeyword
    )

    expect(result.irreversible).toBe(expected)
    expect(result.expires_at).toBeNull()
  })
})
