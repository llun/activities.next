import knex, { Knex } from 'knex'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Database } from '@/lib/database/types'
import { resolveMediaPlaceJob } from '@/lib/jobs/resolveMediaPlaceJob'
import { resolveMediaSubjectJob } from '@/lib/jobs/resolveMediaSubjectJob'

import {
  BackfillOptions,
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
  it('wants a place with coordinates and no status', () => {
    expect(needsPlaceLookup(row({ placeLatitude: 1, placeLongitude: 2 }))).toBe(
      true
    )
    expect(needsPlaceLookup(row({ placeLatitude: 1 }))).toBe(false)
    expect(
      needsPlaceLookup(
        row({
          placeLatitude: 1,
          placeLongitude: 2,
          placeLookupStatus: 'failed'
        })
      )
    ).toBe(false)
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
  const prune = vi.fn()
  const database = { pruneGalleryLookups: prune } as unknown as Database
  const log = vi.fn()

  beforeEach(async () => {
    vi.clearAllMocks()
    testDb = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    await testDb.schema.createTable('medias', (t) => {
      t.increments('id')
      t.string('actorId')
      t.double('placeLatitude')
      t.double('placeLongitude')
      t.string('placeLookupStatus')
      t.string('subjectName')
      t.string('subjectScientificName')
      t.string('subjectCategory')
      t.string('subjectTaxonKey')
      t.string('subjectLookupStatus')
    })
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
      { actorId: 'a' }
    ])
  })

  afterEach(async () => {
    await testDb.destroy()
  })

  const run = (options: Partial<BackfillOptions> = {}) =>
    runBackfill({
      database,
      knex: testDb,
      options: { ...defaults, ...options },
      log
    })

  it('reports what it would do in a dry run and calls no job', async () => {
    const summary = await run()

    expect(summary).toEqual({
      mediaSeen: 3,
      placeLookups: 2,
      subjectLookups: 2,
      prunedCacheRows: 0
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

    expect(order).toEqual(['place:1', 'subject:3', 'subject:6', 'place:6'])
    expect(resolveMediaPlaceJob).toHaveBeenCalledWith(database, {
      id: 'backfill-place-1',
      name: 'ResolveMediaPlaceJob',
      data: { mediaId: '1' }
    })
  })

  it('narrows to one kind with --only', async () => {
    expect(await run({ only: 'places' })).toMatchObject({
      mediaSeen: 2,
      placeLookups: 2,
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
