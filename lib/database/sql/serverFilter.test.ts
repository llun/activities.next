import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

describe('ServerFilterDatabase', () => {
  const testDb = createTestDatabase()
  const { database, knex: knexDatabase } = testDb

  beforeAll(async () => {
    await testDb.prepare()
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

    expect(await database.getServerFilterRecord({ id: filter.id })).toBeNull()
    expect(await database.getServerFilterKeywords({ id: filter.id })).toBeNull()
  })

  it('skips a keyword rename that duplicates another keyword and applies the rest', async () => {
    const filter = await database.createServerFilter({
      title: 'Rename collision',
      context: ['home'],
      filterAction: 'warn',
      expiresAt: null,
      keywords: [
        { keyword: 'alpha', wholeWord: false },
        { keyword: 'beta', wholeWord: false }
      ]
    })
    const existing = await database.getServerFilterKeywords({ id: filter.id })
    const alpha = existing!.find((keyword) => keyword.keyword === 'alpha')!

    await database.updateServerFilter({
      id: filter.id,
      keywords: [
        // Collides with "beta": skipped, not an error...
        { id: alpha.id, keyword: 'beta' },
        // ...and the changes after it still go through.
        { keyword: 'gamma' }
      ]
    })

    const keywords = await database.getServerFilterKeywords({ id: filter.id })
    expect(keywords?.map((keyword) => keyword.keyword).sort()).toEqual([
      'alpha',
      'beta',
      'gamma'
    ])
  })

  it('creates a server filter with more keywords than one insert statement can bind', async () => {
    const unique = Array.from({ length: 400 }, (_, i) => `bulk-${i}`)
    const filter = await database.createServerFilter({
      title: 'Many keywords',
      context: ['home'],
      filterAction: 'warn',
      expiresAt: null,
      // Repeats inside a batch and across batches are ignored.
      keywords: [
        { keyword: 'bulk-0' },
        ...unique.map((keyword) => ({ keyword })),
        { keyword: 'bulk-1' }
      ]
    })

    const keywords = await database.getServerFilterKeywords({ id: filter.id })
    expect(keywords?.map((keyword) => keyword.keyword).sort()).toEqual(
      [...unique].sort()
    )
  })

  it('hydrates more server filters than fit in one IN list', async () => {
    const total = 1200
    const base = Date.UTC(2026, 0, 1)
    const rows = Array.from({ length: total }, (_, i) => ({
      id: `bulk-server-filter-${String(i).padStart(4, '0')}`,
      title: `Bulk ${i}`,
      context: JSON.stringify(['public']),
      filterAction: 'warn',
      expiresAt: null,
      createdAt: new Date(base + i),
      updatedAt: new Date(base + i)
    }))
    for (let start = 0; start < total; start += 100) {
      await knexDatabase('server_filters').insert(
        rows.slice(start, start + 100)
      )
    }
    await knexDatabase('server_filter_keywords').insert(
      [rows[0].id, rows[total - 1].id].map((filterId) => ({
        id: `keyword-of-${filterId}`,
        filterId,
        keyword: `keyword of ${filterId}`,
        wholeWord: false,
        createdAt: new Date(base),
        updatedAt: new Date(base)
      }))
    )

    const records = await database.getServerFilterRecords()
    const bulk = records.filter((record) =>
      record.filter.id.startsWith('bulk-server-filter-')
    )
    expect(bulk).toHaveLength(total)
    expect(bulk[0].keywords.map((keyword) => keyword.keyword)).toEqual([
      `keyword of ${rows[0].id}`
    ])
    expect(bulk[total - 1].keywords.map((keyword) => keyword.keyword)).toEqual([
      `keyword of ${rows[total - 1].id}`
    ])
    expect(
      bulk.slice(1, total - 1).every((record) => record.keywords.length === 0)
    ).toBe(true)

    const active = await database.getActiveServerFilters({ context: 'public' })
    expect(
      active.filter((record) =>
        record.filter.id.startsWith('bulk-server-filter-')
      )
    ).toHaveLength(total)
  })

  describe('row scoping', () => {
    const createServerFilter = (
      title: string,
      keywords: string[],
      expiresAt: number | null = null
    ) =>
      database.createServerFilter({
        title,
        context: ['home'],
        filterAction: 'warn',
        expiresAt,
        keywords: keywords.map((keyword) => ({ keyword }))
      })
    const keywordIds = async (id: string) =>
      Object.fromEntries(
        (await database.getServerFilterKeywords({ id }))!.map((keyword) => [
          keyword.keyword,
          keyword.id
        ])
      )

    it('update and delete touch only the targeted server filter and keyword', async () => {
      const target = await createServerFilter('scope-target', ['a', 'b', 'c'])
      const sibling = await createServerFilter('scope-sibling', ['x', 'y'])
      const targetIds = await keywordIds(target.id)
      const siblingIds = await keywordIds(sibling.id)

      await database.updateServerFilter({
        id: target.id,
        title: 'scope-target-2',
        keywords: [
          { id: targetIds.a, _destroy: true }, // only a; b and c stay
          { id: targetIds.b, keyword: 'b2' }, // only b
          { keyword: 'b2' }, // already present after the rename: no-op
          { id: siblingIds.x, _destroy: true }, // another filter's keyword: ignored
          { id: siblingIds.y, keyword: 'hijacked' } // another filter's keyword: ignored
        ]
      })
      expect(Object.keys(await keywordIds(target.id)).sort()).toEqual([
        'b2',
        'c'
      ])
      const siblingRecord = (await database.getServerFilterRecord({
        id: sibling.id
      }))!
      expect(siblingRecord.filter.title).toBe('scope-sibling')
      expect(siblingRecord.keywords.map((keyword) => keyword.keyword)).toEqual([
        'x',
        'y'
      ])

      await database.deleteServerFilter({ id: target.id })
      expect(
        (await database.getServerFilterRecord({
          id: sibling.id
        }))!.keywords.map((keyword) => keyword.keyword)
      ).toEqual(['x', 'y'])
    })

    describe('with a frozen clock', () => {
      // createdAt decides the order and the expiry boundary, so Date is frozen
      // and stepped by hand.
      const T0 = Date.UTC(2026, 0, 1)
      let tick = 0
      const advance = () => vi.setSystemTime(T0 + ++tick * 1000)

      beforeEach(() => {
        tick = 0
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(T0)
      })

      afterEach(() => {
        vi.useRealTimers()
      })

      it('lists keywords oldest first', async () => {
        const filter = await createServerFilter('scope-keyword-order', [])
        advance()
        await database.updateServerFilter({
          id: filter.id,
          keywords: [{ keyword: 'zz' }]
        })
        advance()
        await database.updateServerFilter({
          id: filter.id,
          keywords: [{ keyword: 'aa' }]
        })
        expect(
          (await database.getServerFilterKeywords({ id: filter.id }))!.map(
            (keyword) => keyword.keyword
          )
        ).toEqual(['zz', 'aa'])
      })

      it('a server filter expiring exactly now is still active', async () => {
        advance()
        const filter = await createServerFilter(
          'scope-boundary',
          [],
          Date.now()
        )
        const active = await database.getActiveServerFilters()
        expect(active.map((record) => record.filter.id)).toContain(filter.id)
      })
    })
  })
})
