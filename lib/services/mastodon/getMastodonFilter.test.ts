import knex, { Knex } from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'
import {
  getMastodonFilter,
  getMastodonFilters
} from '@/lib/services/mastodon/getMastodonFilter'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

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
