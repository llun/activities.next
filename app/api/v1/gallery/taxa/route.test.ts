import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { createGbifClient } from '@/lib/services/gallery/lookups/gbif'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'

import { GET } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase:
  ReturnType<typeof getTestDatabaseWithInstance>['database'] | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined })
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    secretPhase: 'test-secret',
    allowEmails: [],
    allowActorDomains: []
  })
}))

const takeMock = vi.hoisted(() => vi.fn())
const counterOptions = vi.hoisted(() => [] as unknown[])
vi.mock('@/lib/services/gallery/lookups/rateLimit', () => ({
  createWindowCounter: (options: unknown) => {
    counterOptions.push(options)
    return { tryHit: takeMock, reset: vi.fn() }
  }
}))

const speciesLookupsAvailable = vi.hoisted(() => ({ value: true }))
vi.mock('@/lib/services/gallery/galleryLookupAvailability', () => ({
  getGalleryLookupAvailability: vi.fn(async () => ({
    subjectSuggestionsAvailable: false,
    subjectModel: null,
    speciesLookupsAvailable: speciesLookupsAvailable.value,
    placeLookupsAvailable: true
  }))
}))

vi.mock('@/lib/services/gallery/lookups/gbif', () => ({
  createGbifClient: vi.fn()
}))

const searchTaxa = vi.fn()

const TAXON = {
  taxonKey: '5232437',
  scientificName: 'Zosterops japonicus',
  vernacularName: 'Warbling White-eye',
  vernacularNames: ['Warbling White-eye', 'Japanese White-eye'],
  rank: 'SPECIES',
  category: 'bird',
  taxonPath: ['Animalia', 'Chordata', 'Aves', 'Passeriformes', 'Zosteropidae']
}

describe('GET /api/v1/gallery/taxa', () => {
  const { database, prepare } = getTestDatabaseWithInstance()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    speciesLookupsAvailable.value = true
    takeMock.mockReturnValue(true)
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    searchTaxa.mockResolvedValue([TAXON])
    vi.mocked(createGbifClient).mockReturnValue({
      matchTaxon: vi.fn(),
      lookupMatch: vi.fn(),
      getTaxon: vi.fn(),
      getIucnCategory: vi.fn(),
      searchTaxa
    })
  })

  const request = (q?: string) =>
    GET(
      new NextRequest(
        `https://llun.test/api/v1/gallery/taxa${q === undefined ? '' : `?q=${encodeURIComponent(q)}`}`,
        { method: 'GET' }
      ),
      { params: Promise.resolve({}) }
    )

  it('returns the matching species without the extra vernacular names', async () => {
    const response = await request('  white-eye ')

    expect(response.status).toBe(200)
    expect(searchTaxa).toHaveBeenCalledWith('white-eye')
    expect(await response.json()).toEqual({
      taxa: [
        {
          taxonKey: '5232437',
          scientificName: 'Zosterops japonicus',
          vernacularName: 'Warbling White-eye',
          rank: 'SPECIES',
          category: 'bird',
          taxonPath: TAXON.taxonPath
        }
      ]
    })
  })

  it.each([
    ['missing', undefined],
    ['one character', 'a'],
    ['blank', '   '],
    ['over 100 characters', 'x'.repeat(101)]
  ])('answers 422 when q is %s', async (_, q) => {
    expect((await request(q)).status).toBe(422)
    expect(searchTaxa).not.toHaveBeenCalled()
  })

  it('answers 503 when species lookups are switched off', async () => {
    speciesLookupsAvailable.value = false

    expect((await request('kingfisher')).status).toBe(503)
    expect(searchTaxa).not.toHaveBeenCalled()
  })

  it('answers 503 when GBIF fails', async () => {
    searchTaxa.mockRejectedValue(new Error('GBIF down'))

    expect((await request('kingfisher')).status).toBe(503)
  })

  it('limits each actor to 60 searches a minute', () => {
    // The limit docs/mastodon-api-compatibility.md states.
    expect(counterOptions).toEqual([{ limit: 60, windowMs: 60 * 1000 }])
  })

  it('answers 429 past 60 searches a minute', async () => {
    takeMock.mockReturnValue(false)

    expect((await request('kingfisher')).status).toBe(429)
    expect(searchTaxa).not.toHaveBeenCalled()
  })
})
