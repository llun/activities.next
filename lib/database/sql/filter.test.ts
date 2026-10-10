import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

const OTHER_ACTOR_ID = 'https://llun.test/users/other'

describe('FilterDatabase', () => {
  const testDb = createTestDatabase()
  const { database, knex: knexDatabase } = testDb

  beforeAll(async () => {
    await testDb.prepare()
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

  it('returns expired filters via getFilter but excludes them from getActiveFiltersForActor', async () => {
    const filter = await database.createFilter({
      actorId: ACTOR1_ID,
      title: 'ExpiredFilter',
      context: ['home'],
      filterAction: 'warn',
      expiresAt: Date.now() - 60_000
    })

    // getFilter (ownership check) still returns expired filters so clients can extend/delete them
    const fetched = await database.getFilter({
      actorId: ACTOR1_ID,
      id: filter.id
    })
    expect(fetched).not.toBeNull()
    expect(fetched?.id).toBe(filter.id)

    // getActiveFiltersForActor excludes expired filters (timeline/notification filtering)
    const active = await database.getActiveFiltersForActor({
      actorId: ACTOR1_ID,
      context: 'home'
    })
    expect(active.find((r) => r.filter.id === filter.id)).toBeUndefined()
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

  it('skips a keyword rename that duplicates another keyword and applies the rest', async () => {
    const filter = await database.createFilter({
      actorId: ACTOR1_ID,
      title: 'Rename collision',
      context: ['home'],
      filterAction: 'warn',
      expiresAt: null,
      keywords: [{ keyword: 'alpha' }, { keyword: 'beta' }]
    })
    const existing = await database.getFilterKeywords({
      actorId: ACTOR1_ID,
      filterId: filter.id
    })
    const alpha = existing!.find((kw) => kw.keyword === 'alpha')!

    await database.updateFilter({
      actorId: ACTOR1_ID,
      id: filter.id,
      keywords: [
        // Collides with "beta": skipped, not an error...
        { id: alpha.id, keyword: 'beta' },
        // ...and the changes after it still go through.
        { keyword: 'gamma' }
      ]
    })

    const keywords = await database.getFilterKeywords({
      actorId: ACTOR1_ID,
      filterId: filter.id
    })
    expect(keywords?.map((kw) => kw.keyword).sort()).toEqual([
      'alpha',
      'beta',
      'gamma'
    ])
  })

  it('updateFilterKeyword reports a duplicate keyword and leaves the keyword unchanged', async () => {
    const filter = await database.createFilter({
      actorId: ACTOR1_ID,
      title: 'Duplicate rename',
      context: ['home'],
      filterAction: 'warn',
      expiresAt: null,
      keywords: [{ keyword: 'one' }, { keyword: 'two' }]
    })
    const keywords = await database.getFilterKeywords({
      actorId: ACTOR1_ID,
      filterId: filter.id
    })
    const one = keywords!.find((kw) => kw.keyword === 'one')!

    await expect(
      database.updateFilterKeyword({
        actorId: ACTOR1_ID,
        id: one.id,
        keyword: 'two'
      })
    ).resolves.toBe('duplicate')

    const unchanged = await database.getFilterKeyword({
      actorId: ACTOR1_ID,
      id: one.id
    })
    expect(unchanged?.keyword).toBe('one')

    const renamed = await database.updateFilterKeyword({
      actorId: ACTOR1_ID,
      id: one.id,
      keyword: 'three',
      wholeWord: true
    })
    expect(renamed).toMatchObject({
      id: one.id,
      keyword: 'three',
      wholeWord: true
    })
  })

  it('creates a filter with more keywords than one insert statement can bind', async () => {
    const unique = Array.from({ length: 400 }, (_, i) => `bulk-${i}`)
    const filter = await database.createFilter({
      actorId: ACTOR1_ID,
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

    const keywords = await database.getFilterKeywords({
      actorId: ACTOR1_ID,
      filterId: filter.id
    })
    expect(keywords?.map((kw) => kw.keyword).sort()).toEqual([...unique].sort())
  })

  it('hydrates more filters than fit in one IN list', async () => {
    const bulkActorId = 'https://llun.test/users/bulk-filters'
    const total = 1200
    const base = Date.UTC(2026, 0, 1)
    const rows = Array.from({ length: total }, (_, i) => ({
      id: `bulk-filter-${String(i).padStart(4, '0')}`,
      actorId: bulkActorId,
      title: `Bulk ${i}`,
      context: JSON.stringify(['home']),
      filterAction: 'warn',
      expiresAt: null,
      createdAt: new Date(base + i),
      updatedAt: new Date(base + i)
    }))
    for (let start = 0; start < total; start += 100) {
      await knexDatabase('filters').insert(rows.slice(start, start + 100))
    }
    for (const id of [rows[0].id, rows[total - 1].id]) {
      await database.addFilterKeyword({
        actorId: bulkActorId,
        filterId: id,
        keyword: `keyword of ${id}`
      })
      await database.addFilterStatus({
        actorId: bulkActorId,
        filterId: id,
        statusId: `https://llun.test/statuses/${id}`
      })
    }

    const records = await database.getFilterRecordsForActor({
      actorId: bulkActorId
    })
    expect(records).toHaveLength(total)
    expect(records[0].filter.id).toBe(rows[0].id)
    expect(records[total - 1].filter.id).toBe(rows[total - 1].id)
    for (const record of [records[0], records[total - 1]]) {
      expect(record.keywords.map((kw) => kw.keyword)).toEqual([
        `keyword of ${record.filter.id}`
      ])
      expect(record.statuses.map((status) => status.statusId)).toEqual([
        `https://llun.test/statuses/${record.filter.id}`
      ])
    }
    expect(
      records
        .slice(1, total - 1)
        .every(
          (record) =>
            record.keywords.length === 0 && record.statuses.length === 0
        )
    ).toBe(true)

    const active = await database.getActiveFiltersForActor({
      actorId: bulkActorId
    })
    expect(active).toHaveLength(total)
  })

  describe('row scoping', () => {
    const actorOf = (name: string) => `https://llun.test/users/${name}`
    const createFilter = (
      actorId: string,
      title: string,
      keywords: string[] = []
    ) =>
      database.createFilter({
        actorId,
        title,
        context: ['home'],
        filterAction: 'warn',
        expiresAt: null,
        keywords: keywords.map((keyword) => ({ keyword }))
      })
    const keywordIds = async (actorId: string, filterId: string) =>
      Object.fromEntries(
        (await database.getFilterKeywords({ actorId, filterId }))!.map((kw) => [
          kw.keyword,
          kw.id
        ])
      )

    it('updateFilter and deleteFilter touch only the targeted filter', async () => {
      const actorId = actorOf('scope-target')
      const target = await createFilter(actorId, 'target', ['t1'])
      const sibling = await createFilter(actorId, 'sibling', ['s1'])
      await database.addFilterStatus({
        actorId,
        filterId: target.id,
        statusId: 'https://llun.test/statuses/scope-target'
      })
      await database.addFilterStatus({
        actorId,
        filterId: sibling.id,
        statusId: 'https://llun.test/statuses/scope-sibling'
      })

      await database.updateFilter({
        actorId,
        id: target.id,
        title: 'renamed'
      })
      expect(
        (await database.getFilter({ actorId, id: sibling.id }))!.title
      ).toBe('sibling')

      await database.deleteFilter({ actorId, id: target.id })
      const records = await database.getFilterRecordsForActor({ actorId })
      const kept = records.find((record) => record.filter.id === sibling.id)!
      expect(kept.keywords.map((kw) => kw.keyword)).toEqual(['s1'])
      expect(kept.statuses.map((status) => status.statusId)).toEqual([
        'https://llun.test/statuses/scope-sibling'
      ])
    })

    it("keywords_attributes cannot destroy or rename another account's keyword", async () => {
      const ownerId = actorOf('scope-owner')
      const victimId = actorOf('scope-victim')
      const mine = await createFilter(ownerId, 'mine', ['m1'])
      const theirs = await createFilter(victimId, 'theirs', ['secret', 'other'])
      const their = await keywordIds(victimId, theirs.id)

      await database.updateFilter({
        actorId: ownerId,
        id: mine.id,
        keywords: [
          { id: their.secret, _destroy: true },
          { id: their.other, keyword: 'hijacked' }
        ]
      })
      expect(Object.keys(await keywordIds(victimId, theirs.id)).sort()).toEqual(
        ['other', 'secret']
      )
    })

    it('updateFilter re-adding an existing keyword is a no-op', async () => {
      const actorId = actorOf('scope-readd')
      const filter = await createFilter(actorId, 'readd', ['dup'])
      await database.updateFilter({
        actorId,
        id: filter.id,
        title: 'readd-2',
        keywords: [{ keyword: 'dup' }]
      })
      expect(
        (await database.getFilter({ actorId, id: filter.id }))!.title
      ).toBe('readd-2')
      expect(Object.keys(await keywordIds(actorId, filter.id))).toEqual(['dup'])
    })

    it('updateFilter with expiresAt null clears the expiry', async () => {
      const actorId = actorOf('scope-expiry')
      const filter = await database.createFilter({
        actorId,
        title: 'expiring',
        context: ['home'],
        filterAction: 'warn',
        expiresAt: Date.now() + 60_000
      })
      const updated = await database.updateFilter({
        actorId,
        id: filter.id,
        expiresAt: null
      })
      expect(updated!.expiresAt).toBeNull()
    })

    it('duplicate addFilterKeyword / addFilterStatus return the row of this filter', async () => {
      const otherId = actorOf('scope-dups-other')
      const actorId = actorOf('scope-dups')
      const other = await createFilter(otherId, 'other-first', ['shared'])
      await database.addFilterStatus({
        actorId: otherId,
        filterId: other.id,
        statusId: 'https://llun.test/statuses/dups-shared'
      })
      const filter = await createFilter(actorId, 'dups', ['first', 'shared'])
      const ids = await keywordIds(actorId, filter.id)
      const firstStatus = await database.addFilterStatus({
        actorId,
        filterId: filter.id,
        statusId: 'https://llun.test/statuses/dups-first'
      })
      const sharedStatus = await database.addFilterStatus({
        actorId,
        filterId: filter.id,
        statusId: 'https://llun.test/statuses/dups-shared'
      })
      expect(firstStatus!.id).not.toBe(sharedStatus!.id)

      const again = await database.addFilterKeyword({
        actorId,
        filterId: filter.id,
        keyword: 'shared'
      })
      expect(again!.id).toBe(ids.shared)
      const statusAgain = await database.addFilterStatus({
        actorId,
        filterId: filter.id,
        statusId: 'https://llun.test/statuses/dups-shared'
      })
      expect(statusAgain!.id).toBe(sharedStatus!.id)
    })

    describe('with a frozen clock', () => {
      // createdAt decides the order, so Date is frozen and stepped by hand.
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

      it('statuses are listed per filter, oldest first, and deleted one at a time', async () => {
        const actorId = actorOf('scope-statuses')
        const filter = await createFilter(actorId, 'statuses')
        const sibling = await createFilter(actorId, 'statuses-other')
        advance()
        const first = await database.addFilterStatus({
          actorId,
          filterId: filter.id,
          statusId: 'https://llun.test/statuses/order-1'
        })
        advance()
        await database.addFilterStatus({
          actorId,
          filterId: filter.id,
          statusId: 'https://llun.test/statuses/order-2'
        })
        await database.addFilterStatus({
          actorId,
          filterId: sibling.id,
          statusId: 'https://llun.test/statuses/order-sibling'
        })
        const listed = async () =>
          (await database.getFilterStatuses({
            actorId,
            filterId: filter.id
          }))!.map((status) => status.statusId)
        expect(await listed()).toEqual([
          'https://llun.test/statuses/order-1',
          'https://llun.test/statuses/order-2'
        ])
        await database.deleteFilterStatus({ actorId, id: first!.id })
        expect(await listed()).toEqual(['https://llun.test/statuses/order-2'])
      })

      it('keywords are listed oldest first', async () => {
        const actorId = actorOf('scope-keyword-order')
        const filter = await createFilter(actorId, 'kw-order')
        advance()
        await database.addFilterKeyword({
          actorId,
          filterId: filter.id,
          keyword: 'zz'
        })
        advance()
        await database.addFilterKeyword({
          actorId,
          filterId: filter.id,
          keyword: 'aa'
        })
        expect(
          (await database.getFilterKeywords({
            actorId,
            filterId: filter.id
          }))!.map((kw) => kw.keyword)
        ).toEqual(['zz', 'aa'])
      })

      it('active filters: newest first, and a filter expiring exactly now is still active', async () => {
        const actorId = actorOf('scope-active')
        advance()
        const older = await createFilter(actorId, 'older')
        advance()
        const newer = await database.createFilter({
          actorId,
          title: 'newer',
          context: ['home'],
          filterAction: 'warn',
          expiresAt: Date.now() + 1000
        })
        advance() // now === newer.expiresAt
        const active = await database.getActiveFiltersForActor({
          actorId,
          context: 'home'
        })
        expect(active.map((record) => record.filter.id)).toEqual([
          newer.id,
          older.id
        ])
      })
    })
  })
})
