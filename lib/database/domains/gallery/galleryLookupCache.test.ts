import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'

describe('GalleryLookupCacheDatabase', () => {
  const table = getTestDatabaseTable()
  const NOW = Date.UTC(2026, 9, 8, 8, 0, 0)
  const MINUTE = 60_000

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe.each(table)('%s', (_, database) => {
    afterAll(async () => {
      await database.destroy()
    })

    it('stores an entry and reads it back while it is fresh', async () => {
      await database.putGalleryLookup({
        kind: 'gbif-match',
        key: 'alcedo atthis',
        outcome: 'ok',
        value: { taxonKey: '2475532', path: ['Animalia', 'Aves'] },
        ttlMs: 10 * MINUTE,
        now: NOW
      })

      expect(
        await database.getGalleryLookup({
          kind: 'gbif-match',
          key: 'alcedo atthis',
          now: NOW + MINUTE
        })
      ).toEqual({
        kind: 'gbif-match',
        key: 'alcedo atthis',
        outcome: 'ok',
        value: { taxonKey: '2475532', path: ['Animalia', 'Aves'] },
        fetchedAt: NOW,
        expiresAt: NOW + 10 * MINUTE
      })
    })

    it('reads nothing once the entry has expired', async () => {
      await database.putGalleryLookup({
        kind: 'geocode',
        key: 'en:14.40,101.40',
        outcome: 'miss',
        ttlMs: MINUTE,
        now: NOW
      })

      expect(
        await database.getGalleryLookup({
          kind: 'geocode',
          key: 'en:14.40,101.40',
          now: NOW + MINUTE
        })
      ).toBeNull()
      expect(
        await database.getGalleryLookup({
          kind: 'geocode',
          key: 'en:14.40,101.40',
          now: NOW + MINUTE - 1
        })
      ).toMatchObject({ outcome: 'miss', value: null })
    })

    it('replaces an entry on the same kind and key (upsert)', async () => {
      const put = (outcome: 'ok' | 'error', value: unknown, now: number) =>
        database.putGalleryLookup({
          kind: 'gbif-taxon',
          key: '5228',
          outcome,
          value,
          ttlMs: 10 * MINUTE,
          now
        })

      await put('error', null, NOW)
      await put('ok', { iucn: 'LC' }, NOW + MINUTE)

      expect(
        await database.getGalleryLookup({
          kind: 'gbif-taxon',
          key: '5228',
          now: NOW + 2 * MINUTE
        })
      ).toMatchObject({
        outcome: 'ok',
        value: { iucn: 'LC' },
        fetchedAt: NOW + MINUTE,
        expiresAt: NOW + 11 * MINUTE
      })
    })

    it('races two writers of one key without an error', async () => {
      await Promise.all(
        ['a', 'b', 'c'].map((value) =>
          database.putGalleryLookup({
            kind: 'gbif-search',
            key: 'race',
            outcome: 'ok',
            value,
            ttlMs: MINUTE,
            now: NOW
          })
        )
      )

      const entry = await database.getGalleryLookup({
        kind: 'gbif-search',
        key: 'race',
        now: NOW
      })
      expect(['a', 'b', 'c']).toContain(entry?.value)
    })

    it('keeps kinds apart under the same key', async () => {
      await database.putGalleryLookup({
        kind: 'gbif-match',
        key: 'shared',
        outcome: 'ok',
        value: 1,
        ttlMs: MINUTE,
        now: NOW
      })
      await database.putGalleryLookup({
        kind: 'gbif-search',
        key: 'shared',
        outcome: 'miss',
        ttlMs: MINUTE,
        now: NOW
      })

      expect(
        (
          await database.getGalleryLookup({
            kind: 'gbif-match',
            key: 'shared',
            now: NOW
          })
        )?.outcome
      ).toBe('ok')
      expect(
        (
          await database.getGalleryLookup({
            kind: 'gbif-search',
            key: 'shared',
            now: NOW
          })
        )?.outcome
      ).toBe('miss')
    })

    it('writes nothing for a key over its column length', async () => {
      const key = 'k'.repeat(256)
      await database.putGalleryLookup({
        kind: 'gbif-search',
        key,
        outcome: 'ok',
        value: 1,
        ttlMs: MINUTE,
        now: NOW
      })

      expect(
        await database.getGalleryLookup({ kind: 'gbif-search', key, now: NOW })
      ).toBeNull()
    })

    it('refuses an unknown outcome', async () => {
      await expect(
        database.putGalleryLookup({
          kind: 'gbif-search',
          key: 'bad',
          outcome: 'maybe' as never,
          ttlMs: MINUTE,
          now: NOW
        })
      ).rejects.toThrow('Unknown gallery lookup outcome')
    })

    it('prunes only expired entries, up to the limit', async () => {
      const PRUNE_NOW = Date.UTC(2030, 0, 1)
      for (const [key, ttlMs] of [
        ['old-1', 0],
        ['old-2', MINUTE],
        ['old-3', 2 * MINUTE],
        ['fresh', 365 * 24 * 60 * MINUTE]
      ] as const) {
        await database.putGalleryLookup({
          kind: 'prune-test',
          key,
          outcome: 'ok',
          value: key,
          ttlMs,
          now: PRUNE_NOW - 10 * MINUTE
        })
      }

      expect(
        await database.pruneGalleryLookups({ before: PRUNE_NOW, limit: 2 })
      ).toBe(2)
      expect(
        await database.pruneGalleryLookups({ before: PRUNE_NOW, limit: 100 })
      ).toBeGreaterThanOrEqual(1)
      expect(
        await database.pruneGalleryLookups({ before: PRUNE_NOW, limit: 100 })
      ).toBe(0)

      for (const key of ['old-1', 'old-2', 'old-3']) {
        expect(
          await database.getGalleryLookup({
            kind: 'prune-test',
            key,
            now: 0
          })
        ).toBeNull()
      }
      expect(
        await database.getGalleryLookup({
          kind: 'prune-test',
          key: 'fresh',
          now: PRUNE_NOW
        })
      ).toMatchObject({ value: 'fresh' })
      expect(
        await database.pruneGalleryLookups({ before: PRUNE_NOW, limit: 0 })
      ).toBe(0)
    })
  })
})
