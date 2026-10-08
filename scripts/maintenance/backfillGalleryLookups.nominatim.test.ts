import { Knex } from 'knex'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getTestSQLDatabaseWithInstance } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import nominatimNone from '@/lib/services/gallery/lookups/__fixtures__/nominatim-reverse-none.json'

import { runBackfill } from './backfillGalleryLookups'

// The backfill with the real place job, Nominatim client and lookup cache,
// and only the network stubbed. Every backfill lookup is a retry, and a
// retry must still answer a remembered cell with no name: a place `no-match`
// is final, so photos in one no-match cell (a boat trip over open sea) cost
// one request, as Nominatim's usage policy asks.

const mockFetch = vi.fn(async ({ url }: { url: string }) => ({
  body: JSON.stringify(nominatimNone),
  bodyTruncated: false,
  headers: {},
  statusCode: 200,
  url
}))
vi.mock('@/lib/utils/safeRemoteFetch', () => ({
  safeRemoteFetch: (params: { url: string }) => mockFetch(params)
}))

vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config')>()),
  getConfig: () => ({
    host: 'llun.test',
    languages: ['en'],
    secretPhase: 'test-secret',
    gallery: {
      nominatim: { endpoint: 'https://nominatim.test', email: null }
    }
  })
}))

vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: async () => ({
    network: { placeLookups: true, speciesLookups: true }
  })
}))

// The script reads the database at import time only when run as a script.
vi.mock('@/lib/database', () => ({ getDatabase: vi.fn(), getKnex: vi.fn() }))

const closedBreaker = () => ({
  isOpen: () => false,
  remainingMs: () => 0,
  open: vi.fn(),
  close: vi.fn()
})

describe('runBackfill with the real place lookup', () => {
  let database: Database
  let knex: Knex

  beforeEach(async () => {
    mockFetch.mockClear()
    const created = getTestSQLDatabaseWithInstance()
    database = created.database
    knex = created.instance
    await database.migrate()
  })

  afterEach(async () => {
    await database.destroy()
  })

  const createMediaAt = async (latitude: number, longitude: number) => {
    const media = await database.createMedia({
      actorId: 'https://llun.test/users/sea',
      original: {
        path: `medias/sea-${latitude}-${longitude}`,
        bytes: 100,
        mimeType: 'image/jpeg',
        metaData: { width: 10, height: 10 }
      },
      details: { placeLatitude: latitude, placeLongitude: longitude }
    })
    return media!.id
  }

  const placeStatusOf = async (id: string) => {
    const row = await knex('medias').where({ id }).first('placeLookupStatus')
    return row?.placeLookupStatus ?? null
  }

  const run = () =>
    runBackfill({
      database,
      knex,
      options: { apply: true, pruneCache: false },
      log: () => {},
      providers: { places: closedBreaker(), subjects: closedBreaker() },
      sleep: async () => {}
    })

  it('asks Nominatim once for two photos in one no-match cell', async () => {
    // Two points in the same 0.05 degree cell over the Gulf of Thailand.
    const first = await createMediaAt(10.5112, 101.5131)
    const second = await createMediaAt(10.5243, 101.5208)

    const summary = await run()

    expect(summary.placeLookups).toBe(2)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(await placeStatusOf(first)).toBe('no-match')
    expect(await placeStatusOf(second)).toBe('no-match')

    // A place `no-match` is final: the next run asks about neither again.
    const again = await run()

    expect(again.placeLookups).toBe(0)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
