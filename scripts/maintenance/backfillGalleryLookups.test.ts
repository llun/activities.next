import { Knex } from 'knex'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getTestSQLDatabaseWithInstance } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { resolveMediaPlaceJob } from '@/lib/jobs/resolveMediaPlaceJob'
import { resolveMediaSubjectJob } from '@/lib/jobs/resolveMediaSubjectJob'

import {
  BackfillOptions,
  MAX_CONSECUTIVE_OUTAGES,
  needsPlaceLookup,
  needsSubjectLookup,
  parseArgs,
  runBackfill
} from './backfillGalleryLookups'

vi.mock('@/lib/jobs/resolveMediaPlaceJob', () => ({
  resolveMediaPlaceJob: vi.fn()
}))
vi.mock('@/lib/jobs/resolveMediaSubjectJob', () => ({
  resolveMediaSubjectJob: vi.fn()
}))
// The script reads the database at import time only when run as a script.
vi.mock('@/lib/database', () => ({ getDatabase: vi.fn(), getKnex: vi.fn() }))

const defaults: BackfillOptions = { apply: false, pruneCache: false }

describe('backfillGalleryLookups parseArgs', () => {
  it('defaults to a dry run over everything', () => {
    expect(parseArgs([])).toEqual({ apply: false, pruneCache: false })
  })

  it('reads every flag', () => {
    expect(
      parseArgs([
        '--apply',
        '--actor',
        'https://llun.test/users/me',
        '--limit',
        '25',
        '--only',
        'places',
        '--prune-cache'
      ])
    ).toEqual({
      apply: true,
      actorId: 'https://llun.test/users/me',
      limit: 25,
      only: 'places',
      pruneCache: true
    })
  })

  it('lets --dry-run after --apply win, as the last flag does', () => {
    expect(parseArgs(['--apply', '--dry-run']).apply).toBe(false)
  })

  it.each([
    [['--limit', '0']],
    [['--limit', 'x']],
    [['--limit']],
    [['--only', 'albums']],
    [['--only']],
    [['--actor']],
    [['--nope']]
  ])('rejects %j', (args) => {
    expect(() => parseArgs(args)).toThrow()
  })
})

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  placeLatitude: null,
  placeLongitude: null,
  placeLookupStatus: null,
  subjectName: null,
  subjectScientificName: null,
  subjectCategory: null,
  subjectTaxonKey: null,
  subjectLookupStatus: null,
  ...overrides
})

describe('needsPlaceLookup / needsSubjectLookup', () => {
  it('wants a place only with both coordinates', () => {
    expect(needsPlaceLookup(row({ placeLatitude: 1, placeLongitude: 2 }))).toBe(
      true
    )
    expect(needsPlaceLookup(row({ placeLatitude: 1 }))).toBe(false)
  })

  it.each([
    [null, true],
    ['pending', true],
    ['failed', true],
    ['disabled', true],
    ['resolved', false],
    ['no-match', false]
  ])('place status %s -> %s', (placeLookupStatus, expected) => {
    expect(
      needsPlaceLookup(
        row({ placeLatitude: 1, placeLongitude: 2, placeLookupStatus })
      )
    ).toBe(expected)
  })

  it.each([
    [null, true],
    ['pending', true],
    ['failed', true],
    ['disabled', true],
    ['resolved', false],
    ['no-match', false]
  ])('subject status %s -> %s', (subjectLookupStatus, expected) => {
    expect(
      needsSubjectLookup(
        row({ subjectScientificName: 'Alcedo atthis', subjectLookupStatus })
      )
    ).toBe(expected)
  })

  it('skips a subject that is not species-like', () => {
    expect(
      needsSubjectLookup(
        row({ subjectName: 'Mountain', subjectCategory: 'landscape' })
      )
    ).toBe(false)
  })
})

describe('runBackfill', () => {
  let testDb: Knex
  let realDatabase: Database
  const prune = vi.fn()
  const database = { pruneGalleryLookups: prune } as unknown as Database
  const log = vi.fn()
  const closedBreaker = () => ({
    isOpen: () => false,
    remainingMs: () => 0,
    open: vi.fn(),
    close: vi.fn()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    // The real `medias` table, from the same schema dump the app migrates
    // with, so a renamed column breaks this test too.
    const { database: sqlDatabase, instance } = getTestSQLDatabaseWithInstance()
    realDatabase = sqlDatabase
    testDb = instance
    await realDatabase.migrate()
    await testDb('medias').insert([
      // 1: GPS, never looked up
      { actorId: 'a', placeLatitude: 14.5, placeLongitude: 101.4 },
      // 2: GPS, already looked up
      {
        actorId: 'a',
        placeLatitude: 1,
        placeLongitude: 2,
        placeLookupStatus: 'resolved'
      },
      // 3: species, pending
      {
        actorId: 'a',
        subjectScientificName: 'Alcedo atthis',
        subjectLookupStatus: 'pending'
      },
      // 4: species, final
      {
        actorId: 'a',
        subjectScientificName: 'Corvus corax',
        subjectLookupStatus: 'resolved'
      },
      // 5: not species-like
      { actorId: 'a', subjectName: 'Mountain', subjectCategory: 'landscape' },
      // 6: both, another actor
      {
        actorId: 'b',
        placeLatitude: 3,
        placeLongitude: 4,
        subjectName: 'Otter',
        subjectCategory: 'mammal'
      },
      // 7: nothing at all
      { actorId: 'a' },
      // 8: GPS, failed in an earlier run
      {
        actorId: 'c',
        placeLatitude: 5,
        placeLongitude: 6,
        placeLookupStatus: 'failed'
      },
      // 9: GPS, looked up while place lookups were switched off
      {
        actorId: 'c',
        placeLatitude: 7,
        placeLongitude: 8,
        placeLookupStatus: 'disabled'
      }
    ])
  })

  afterEach(async () => {
    await realDatabase.destroy()
  })

  const run = (
    options: Partial<BackfillOptions> = {},
    extra: Partial<Parameters<typeof runBackfill>[0]> = {}
  ) =>
    runBackfill({
      database,
      knex: testDb,
      options: { ...defaults, ...options },
      log,
      providers: { places: closedBreaker(), subjects: closedBreaker() },
      sleep: async () => {},
      ...extra
    })

  it('reports what it would do in a dry run and calls no job', async () => {
    const summary = await run()

    expect(summary).toEqual({
      mediaSeen: 5,
      placeLookups: 4,
      subjectLookups: 2,
      prunedCacheRows: 0,
      gaveUp: []
    })
    expect(resolveMediaPlaceJob).not.toHaveBeenCalled()
    expect(resolveMediaSubjectJob).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      'Dry run: nothing was changed. Use --apply to run.'
    )
  })

  it('applies one media at a time, in id order, through the job handlers', async () => {
    const order: string[] = []
    vi.mocked(resolveMediaPlaceJob).mockImplementation(async (_db, message) => {
      order.push(`place:${(message.data as { mediaId: string }).mediaId}`)
    })
    vi.mocked(resolveMediaSubjectJob).mockImplementation(
      async (_db, message) => {
        order.push(`subject:${(message.data as { mediaId: string }).mediaId}`)
      }
    )

    await run({ apply: true })

    expect(order).toEqual([
      'place:1',
      'subject:3',
      'subject:6',
      'place:6',
      'place:8',
      'place:9'
    ])
    expect(resolveMediaPlaceJob).toHaveBeenCalledWith(database, {
      id: 'backfill-place-1',
      name: 'ResolveMediaPlaceJob',
      // Always a retry: a failure the cache remembers is asked again.
      data: { mediaId: '1', retry: true }
    })
  })

  it('narrows to one kind with --only', async () => {
    expect(await run({ only: 'places' })).toMatchObject({
      mediaSeen: 4,
      placeLookups: 4,
      subjectLookups: 0
    })
    expect(await run({ only: 'subjects' })).toMatchObject({
      mediaSeen: 2,
      placeLookups: 0,
      subjectLookups: 2
    })
  })

  it('narrows to one actor with --actor', async () => {
    expect(await run({ actorId: 'b' })).toMatchObject({
      mediaSeen: 1,
      placeLookups: 1,
      subjectLookups: 1
    })
  })

  it('stops after --limit media', async () => {
    expect(await run({ limit: 2, apply: true })).toMatchObject({ mediaSeen: 2 })
    expect(resolveMediaPlaceJob).toHaveBeenCalledTimes(1)
    expect(resolveMediaSubjectJob).toHaveBeenCalledTimes(1)
  })

  it('picks up places an earlier run left failed or disabled', async () => {
    expect(await run({ actorId: 'c' })).toMatchObject({
      mediaSeen: 2,
      placeLookups: 2
    })
  })

  // The cascade: one Nominatim timeout opened the circuit for five minutes,
  // and every later row failed on the spot as `circuit-open`.
  it('waits for an open circuit to close instead of failing the rest', async () => {
    let openUntil = 0
    let now = 0
    const breaker = {
      isOpen: () => now < openUntil,
      remainingMs: () => Math.max(0, openUntil - now),
      open: vi.fn(),
      close: vi.fn()
    }
    const sleep = vi.fn(async (ms: number) => {
      now += ms
    })
    const calls: { mediaId: string; retry?: boolean; at: number }[] = []
    vi.mocked(resolveMediaPlaceJob).mockImplementation(async (_db, message) => {
      const data = message.data as { mediaId: string; retry?: boolean }
      calls.push({ ...data, at: now })
      // The first lookup times out and opens the circuit for five minutes.
      if (calls.length === 1) openUntil = now + 5 * 60 * 1000
    })

    await run(
      { apply: true, only: 'places' },
      { providers: { places: breaker, subjects: closedBreaker() }, sleep }
    )

    // No lookup ran while the circuit was open; the one that failed under
    // it was asked again as a retry once it closed, then the rest went on.
    expect(calls).toEqual([
      { mediaId: '1', retry: true, at: 0 },
      { mediaId: '1', retry: true, at: 300_000 },
      { mediaId: '6', retry: true, at: 300_000 },
      { mediaId: '8', retry: true, at: 300_000 },
      { mediaId: '9', retry: true, at: 300_000 }
    ])
    expect(sleep).toHaveBeenCalledWith(300_000)
    expect(log).toHaveBeenCalledWith(
      'Nominatim is unavailable; waiting 300 s before going on'
    )
  })

  // A provider that never comes back (an air-gapped server with the switch
  // still on) must not stall the run for ten minutes per photo.
  it('gives up on a provider after a persistent outage', async () => {
    let now = 0
    let openUntil = 0
    const breaker = {
      isOpen: () => now < openUntil,
      remainingMs: () => Math.max(0, openUntil - now),
      open: vi.fn(),
      close: vi.fn()
    }
    const sleep = vi.fn(async (ms: number) => {
      now += ms
    })
    // Every attempt fails and opens the circuit again: it never closes for
    // long enough to succeed.
    vi.mocked(resolveMediaPlaceJob).mockImplementation(async () => {
      openUntil = now + 5 * 60 * 1000
    })

    const summary = await run(
      { apply: true },
      { providers: { places: breaker, subjects: closedBreaker() }, sleep }
    )

    // Three photos, each asked twice, then no more place lookups.
    expect(resolveMediaPlaceJob).toHaveBeenCalledTimes(
      MAX_CONSECUTIVE_OUTAGES * 2
    )
    expect(summary.gaveUp).toEqual(['Nominatim'])
    // The subject lookups still ran.
    expect(resolveMediaSubjectJob).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^Gave up on Nominatim: 3 lookups in a row failed/)
    )
    // Bounded: at most two circuit waits per given-up lookup.
    expect(now).toBeLessThanOrEqual(MAX_CONSECUTIVE_OUTAGES * 2 * 300_000)
  })

  it('resets the outage count after a lookup that succeeds', async () => {
    let now = 0
    let openUntil = 0
    const breaker = {
      isOpen: () => now < openUntil,
      remainingMs: () => Math.max(0, openUntil - now),
      open: vi.fn(),
      close: vi.fn()
    }
    const sleep = vi.fn(async (ms: number) => {
      now += ms
    })
    let attempt = 0
    // Fails twice (one double failure), then works.
    vi.mocked(resolveMediaPlaceJob).mockImplementation(async () => {
      attempt++
      if (attempt <= 2) openUntil = now + 5 * 60 * 1000
    })

    const summary = await run(
      { apply: true, only: 'places' },
      { providers: { places: breaker, subjects: closedBreaker() }, sleep }
    )

    expect(summary.gaveUp).toEqual([])
    expect(resolveMediaPlaceJob).toHaveBeenCalledTimes(5)
  })

  it('does not wait on the other provider’s circuit', async () => {
    const open = {
      isOpen: () => true,
      remainingMs: () => 1000,
      open: vi.fn(),
      close: vi.fn()
    }
    const sleep = vi.fn(async () => {})

    await run(
      { apply: true, only: 'places' },
      { providers: { places: closedBreaker(), subjects: open }, sleep }
    )

    expect(sleep).not.toHaveBeenCalled()
    expect(resolveMediaPlaceJob).toHaveBeenCalledTimes(4)
  })

  it('prunes expired cache rows only with --apply', async () => {
    prune.mockResolvedValueOnce(500).mockResolvedValueOnce(120)

    await run({ pruneCache: true })
    expect(prune).not.toHaveBeenCalled()

    const summary = await run({ pruneCache: true, apply: true })
    expect(prune).toHaveBeenCalledTimes(2)
    expect(prune).toHaveBeenCalledWith({
      before: expect.any(Number),
      limit: 500
    })
    expect(summary.prunedCacheRows).toBe(620)
  })
})
