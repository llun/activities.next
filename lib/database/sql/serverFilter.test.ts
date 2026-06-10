import knex, { Knex } from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'

describe('ServerFilterDatabase', () => {
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
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('creates a server filter with keywords and lists it with keywords', async () => {
    const filter = await database.createServerFilter({
      title: 'Spam campaigns',
      context: ['home', 'notifications', 'public', 'thread', 'account'],
      filterAction: 'hide',
      expiresAt: null,
      keywords: [
        { keyword: 'free followers', wholeWord: false },
        { keyword: 'dm for promo', wholeWord: false }
      ]
    })

    expect(filter.title).toBe('Spam campaigns')
    expect(filter.context).toHaveLength(5)
    expect(filter.filterAction).toBe('hide')

    const records = await database.getServerFilterRecords()
    const record = records.find((entry) => entry.filter.id === filter.id)
    expect(record).toBeTruthy()
    expect(record?.keywords).toHaveLength(2)
    expect(record?.keywords.map((keyword) => keyword.keyword).sort()).toEqual([
      'dm for promo',
      'free followers'
    ])
  })

  it('updates a server filter and removes a keyword via _destroy', async () => {
    const filter = await database.createServerFilter({
      title: 'Known scam links',
      context: ['public'],
      filterAction: 'warn',
      expiresAt: null,
      keywords: [{ keyword: 'wallet-verify', wholeWord: false }]
    })
    const keywords = await database.getServerFilterKeywords({ id: filter.id })
    const keywordId = keywords?.[0]?.id as string

    const updated = await database.updateServerFilter({
      id: filter.id,
      title: 'Scam links',
      context: ['public', 'notifications'],
      keywords: [
        { id: keywordId, _destroy: true },
        { keyword: 'airdrop', wholeWord: true }
      ]
    })
    expect(updated?.title).toBe('Scam links')
    expect(updated?.context).toEqual(['public', 'notifications'])

    const remaining = await database.getServerFilterKeywords({ id: filter.id })
    expect(remaining?.map((keyword) => keyword.keyword)).toEqual(['airdrop'])
  })

  it('returns a single hydrated record via getServerFilterRecord', async () => {
    const filter = await database.createServerFilter({
      title: 'Single record',
      context: ['home'],
      filterAction: 'warn',
      expiresAt: null,
      keywords: [{ keyword: 'lookup', wholeWord: false }]
    })

    const record = await database.getServerFilterRecord({ id: filter.id })
    expect(record?.filter.id).toBe(filter.id)
    expect(record?.keywords.map((keyword) => keyword.keyword)).toEqual([
      'lookup'
    ])

    expect(
      await database.getServerFilterRecord({ id: 'does-not-exist' })
    ).toBeNull()
  })

  it('excludes expired server filters from the active set but keeps them in records', async () => {
    const expired = await database.createServerFilter({
      title: 'Old promo',
      context: ['home'],
      filterAction: 'warn',
      expiresAt: Date.now() - 1000,
      keywords: [{ keyword: 'expired-keyword', wholeWord: false }]
    })

    const active = await database.getActiveServerFilters()
    expect(active.find((entry) => entry.filter.id === expired.id)).toBeFalsy()

    const records = await database.getServerFilterRecords()
    expect(records.find((entry) => entry.filter.id === expired.id)).toBeTruthy()
  })

  it('filters the active set by context', async () => {
    const filter = await database.createServerFilter({
      title: 'Notifications only',
      context: ['notifications'],
      filterAction: 'warn',
      expiresAt: null,
      keywords: [{ keyword: 'ping', wholeWord: false }]
    })

    const homeActive = await database.getActiveServerFilters({
      context: 'home'
    })
    expect(
      homeActive.find((entry) => entry.filter.id === filter.id)
    ).toBeFalsy()

    const notificationsActive = await database.getActiveServerFilters({
      context: 'notifications'
    })
    expect(
      notificationsActive.find((entry) => entry.filter.id === filter.id)
    ).toBeTruthy()
  })

  it('deletes a server filter and cascades its keywords', async () => {
    const filter = await database.createServerFilter({
      title: 'Temporary',
      context: ['home'],
      filterAction: 'warn',
      expiresAt: null,
      keywords: [{ keyword: 'temp', wholeWord: false }]
    })

    const deleted = await database.deleteServerFilter({ id: filter.id })
    expect(deleted?.id).toBe(filter.id)

    expect(await database.getServerFilter({ id: filter.id })).toBeNull()
    expect(await database.getServerFilterKeywords({ id: filter.id })).toBeNull()
  })
})
