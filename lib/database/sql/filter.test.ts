import knex, { Knex } from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

const OTHER_ACTOR_ID = 'https://llun.test/users/other'

describe('FilterDatabase', () => {
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

  it('creates a filter with initial keywords and returns the row', async () => {
    const filter = await database.createFilter({
      actorId: ACTOR1_ID,
      title: 'Spoilers',
      context: ['home', 'public'],
      filterAction: 'warn',
      expiresAt: null,
      keywords: [{ keyword: 'spoiler', wholeWord: true }]
    })

    expect(filter.title).toBe('Spoilers')
    expect(filter.context).toEqual(['home', 'public'])
    expect(filter.filterAction).toBe('warn')

    const fetched = await database.getFilter({
      actorId: ACTOR1_ID,
      id: filter.id
    })
    expect(fetched?.id).toBe(filter.id)

    const keywords = await database.getFilterKeywords({
      actorId: ACTOR1_ID,
      filterId: filter.id
    })
    expect(keywords).toHaveLength(1)
    expect(keywords?.[0].keyword).toBe('spoiler')
    expect(keywords?.[0].wholeWord).toBe(true)
  })

  it('skips filters whose expiry has passed', async () => {
    const filter = await database.createFilter({
      actorId: ACTOR1_ID,
      title: 'ExpiredFilter',
      context: ['home'],
      filterAction: 'warn',
      expiresAt: Date.now() - 60_000
    })

    const fetched = await database.getFilter({
      actorId: ACTOR1_ID,
      id: filter.id
    })
    expect(fetched).toBeNull()

    const all = await database.getFilters({ actorId: ACTOR1_ID })
    expect(all.find((entry) => entry.id === filter.id)).toBeUndefined()
  })

  it('returns null cross-actor access for filters, keywords, and statuses', async () => {
    const filter = await database.createFilter({
      actorId: ACTOR1_ID,
      title: 'Private',
      context: ['home'],
      filterAction: 'warn',
      expiresAt: null,
      keywords: [{ keyword: 'private' }]
    })

    const keyword = await database.addFilterKeyword({
      actorId: ACTOR1_ID,
      filterId: filter.id,
      keyword: 'topsecret',
      wholeWord: false
    })
    expect(keyword).not.toBeNull()

    const status = await database.addFilterStatus({
      actorId: ACTOR1_ID,
      filterId: filter.id,
      statusId: 'https://llun.test/users/test1/statuses/1'
    })
    expect(status).not.toBeNull()

    await expect(
      database.getFilter({ actorId: OTHER_ACTOR_ID, id: filter.id })
    ).resolves.toBeNull()
    await expect(
      database.getFilterKeyword({
        actorId: OTHER_ACTOR_ID,
        id: keyword!.id
      })
    ).resolves.toBeNull()
    await expect(
      database.getFilterStatuses({
        actorId: OTHER_ACTOR_ID,
        filterId: filter.id
      })
    ).resolves.toBeNull()
    await expect(
      database.deleteFilterKeyword({
        actorId: OTHER_ACTOR_ID,
        id: keyword!.id
      })
    ).resolves.toBeNull()
  })

  it('cascade-deletes keywords and statuses with the filter', async () => {
    const filter = await database.createFilter({
      actorId: ACTOR1_ID,
      title: 'Cascading',
      context: ['home'],
      filterAction: 'hide',
      expiresAt: null,
      keywords: [{ keyword: 'cascade' }]
    })
    await database.addFilterStatus({
      actorId: ACTOR1_ID,
      filterId: filter.id,
      statusId: 'https://llun.test/statuses/cascade-1'
    })

    await database.deleteFilter({ actorId: ACTOR1_ID, id: filter.id })

    expect(
      await knexDatabase('filters').where({ id: filter.id }).first()
    ).toBeUndefined()
    expect(
      await knexDatabase('filter_keywords')
        .where({ filterId: filter.id })
        .first()
    ).toBeUndefined()
    expect(
      await knexDatabase('filter_statuses')
        .where({ filterId: filter.id })
        .first()
    ).toBeUndefined()
  })

  it('addFilterStatus is idempotent on the same (filter, status) pair', async () => {
    const filter = await database.createFilter({
      actorId: ACTOR1_ID,
      title: 'Unique',
      context: ['home'],
      filterAction: 'warn',
      expiresAt: null
    })
    const statusId = 'https://llun.test/users/test1/statuses/dup'
    const first = await database.addFilterStatus({
      actorId: ACTOR1_ID,
      filterId: filter.id,
      statusId
    })
    const second = await database.addFilterStatus({
      actorId: ACTOR1_ID,
      filterId: filter.id,
      statusId
    })
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    const count = await knexDatabase('filter_statuses')
      .where({ filterId: filter.id, statusId })
      .count('id as n')
      .first()
    expect(Number(count?.n)).toBe(1)
  })

  it('updateFilter with keywords_attributes adds, updates, and destroys', async () => {
    const filter = await database.createFilter({
      actorId: ACTOR1_ID,
      title: 'Mutate',
      context: ['home'],
      filterAction: 'warn',
      expiresAt: null,
      keywords: [{ keyword: 'old' }]
    })
    const existing = await database.getFilterKeywords({
      actorId: ACTOR1_ID,
      filterId: filter.id
    })
    expect(existing).toHaveLength(1)

    await database.updateFilter({
      actorId: ACTOR1_ID,
      id: filter.id,
      keywords: [
        { id: existing![0].id, keyword: 'updated' },
        { keyword: 'added' }
      ]
    })

    const afterUpdate = await database.getFilterKeywords({
      actorId: ACTOR1_ID,
      filterId: filter.id
    })
    expect(afterUpdate?.map((kw) => kw.keyword).sort()).toEqual([
      'added',
      'updated'
    ])

    const addedKw = afterUpdate!.find((kw) => kw.keyword === 'added')!
    await database.updateFilter({
      actorId: ACTOR1_ID,
      id: filter.id,
      keywords: [{ id: addedKw.id, _destroy: true }]
    })

    const afterDestroy = await database.getFilterKeywords({
      actorId: ACTOR1_ID,
      filterId: filter.id
    })
    expect(afterDestroy?.map((kw) => kw.keyword)).toEqual(['updated'])
  })

  it('getActiveFiltersForActor returns filters for matching context with keywords and statuses', async () => {
    const filter = await database.createFilter({
      actorId: ACTOR1_ID,
      title: 'ActiveCtx',
      context: ['home', 'notifications'],
      filterAction: 'warn',
      expiresAt: null,
      keywords: [{ keyword: 'hi' }]
    })
    await database.addFilterStatus({
      actorId: ACTOR1_ID,
      filterId: filter.id,
      statusId: 'https://llun.test/users/test1/statuses/active'
    })

    const home = await database.getActiveFiltersForActor({
      actorId: ACTOR1_ID,
      context: 'home'
    })
    const account = await database.getActiveFiltersForActor({
      actorId: ACTOR1_ID,
      context: 'account'
    })

    expect(home.find((rec) => rec.filter.id === filter.id)).toBeDefined()
    expect(account.find((rec) => rec.filter.id === filter.id)).toBeUndefined()
    const target = home.find((rec) => rec.filter.id === filter.id)!
    expect(target.keywords).toHaveLength(1)
    expect(target.statuses).toHaveLength(1)
  })
})
