import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { createGbifClient } from '@/lib/services/gallery/lookups/gbif'
import { getSubjectProviderConfig } from '@/lib/services/gallery/subjects/subjectProvider'
import {
  SubjectSuggestionError,
  suggestSubjects
} from '@/lib/services/gallery/subjects/suggestSubjects'
import { readStoredImage } from '@/lib/services/medias/readStoredMedia'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import type { MediaSubjectSuggestions } from '@/lib/types/database/gallery'

import { POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase:
  ReturnType<typeof getTestDatabaseWithInstance>['database'] | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => () => ({ where: () => ({ first: () => null }) })
}))

vi.mock('next/headers', () => ({
  cookies: vi
    .fn()
    .mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) })
}))

vi.mock('better-auth/oauth2', () => ({ verifyBearerToken: vi.fn() }))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

vi.mock('@/lib/services/gallery/subjects/subjectProvider', () => ({
  getSubjectProviderConfig: vi.fn()
}))

vi.mock('@/lib/services/gallery/subjects/suggestSubjects', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/services/gallery/subjects/suggestSubjects')
  >('@/lib/services/gallery/subjects/suggestSubjects')
  return { ...actual, suggestSubjects: vi.fn() }
})

const takeMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/gallery/subjects/actorWindow', () => ({
  createActorWindow: () => ({ take: takeMock })
}))

const speciesLookupsAvailable = vi.hoisted(() => ({ value: true }))
vi.mock('@/lib/services/gallery/galleryLookupAvailability', () => ({
  getGalleryLookupAvailability: vi.fn(async () => ({
    subjectSuggestionsAvailable: true,
    subjectModel: 'vision',
    speciesLookupsAvailable: speciesLookupsAvailable.value,
    placeLookupsAvailable: true
  }))
}))

vi.mock('@/lib/services/gallery/lookups/gbif', () => ({
  createGbifClient: vi.fn(() => ({ matchTaxon: vi.fn(), searchTaxa: vi.fn() }))
}))

vi.mock('@/lib/services/medias/readStoredMedia', () => ({
  readStoredImage: vi.fn()
}))

const PROVIDER = { endpoint: 'https://alt.test/v1', apiKey: 'key', model: 'v1' }

const SUGGESTIONS: MediaSubjectSuggestions = {
  model: 'v1',
  generatedAt: '2026-10-08T10:00:00.000Z',
  checkedAgainst: 'gbif',
  candidates: [
    {
      name: 'Warbling White-eye',
      scientificName: 'Zosterops japonicus',
      category: 'bird',
      confidence: 0.81,
      taxonKey: '5232437',
      rank: 'SPECIES',
      taxonPath: ['Animalia', 'Chordata', 'Aves']
    }
  ],
  group: 'bird'
}

describe('POST /api/v1/media/[id]/subject-suggestions', () => {
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
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    takeMock.mockReturnValue(true)
    vi.mocked(getSubjectProviderConfig).mockReturnValue(PROVIDER)
    vi.mocked(readStoredImage).mockResolvedValue({
      buffer: Buffer.from('image-bytes'),
      mimeType: 'image/webp'
    })
    vi.mocked(suggestSubjects).mockResolvedValue(SUGGESTIONS)
  })

  let counter = 0
  const createMediaFor = async (
    actorId: string,
    {
      mimeType = 'image/jpeg',
      thumbnail
    }: { mimeType?: string; thumbnail?: string } = {}
  ) => {
    counter += 1
    const media = await database.createMedia({
      actorId,
      original: {
        path: `medias/suggest-${counter}`,
        bytes: 100,
        mimeType,
        metaData: { width: 10, height: 10 }
      },
      ...(thumbnail
        ? {
            thumbnail: {
              path: thumbnail,
              bytes: 10,
              mimeType: 'image/webp',
              metaData: { width: 5, height: 5 }
            }
          }
        : {})
    })
    return media!.id
  }

  const request = (id: string, body?: unknown) =>
    POST(
      new NextRequest(
        `https://llun.test/api/v1/media/${id}/subject-suggestions`,
        {
          method: 'POST',
          headers: {
            origin: 'https://llun.test',
            'content-type': 'application/json'
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        }
      ),
      { params: Promise.resolve({ id }) }
    )

  const storedSuggestions = async (id: string) => {
    const account = (await database.getActorFromId({ id: ACTOR1_ID }))!.account!
    const stored = await database.getMediaByIdForAccount({
      mediaId: id,
      accountId: account.id
    })
    return stored?.details?.subjectSuggestions ?? null
  }

  it('runs the model, persists the result and returns it', async () => {
    const id = await createMediaFor(ACTOR1_ID)

    const response = await request(id)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ suggestions: SUGGESTIONS })
    expect(readStoredImage).toHaveBeenCalledWith(
      database,
      `medias/suggest-${counter}`
    )
    expect(suggestSubjects).toHaveBeenCalledWith({
      config: PROVIDER,
      image: { buffer: Buffer.from('image-bytes'), mimeType: 'image/webp' },
      gbif: expect.any(Object)
    })
    expect(await storedSuggestions(id)).toEqual(SUGGESTIONS)
  })

  it('returns the stored suggestions without asking the model again', async () => {
    const id = await createMediaFor(ACTOR1_ID)
    await request(id)
    vi.mocked(suggestSubjects).mockClear()
    takeMock.mockClear()

    const response = await request(id, {})

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ suggestions: SUGGESTIONS })
    expect(suggestSubjects).not.toHaveBeenCalled()
    expect(takeMock).not.toHaveBeenCalled()
  })

  it('runs again, and replaces the stored result, on refresh', async () => {
    const id = await createMediaFor(ACTOR1_ID)
    await request(id)
    const fresh = { ...SUGGESTIONS, group: null }
    vi.mocked(suggestSubjects).mockResolvedValue(fresh)

    const response = await request(id, { refresh: true })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ suggestions: fresh })
    expect(await storedSuggestions(id)).toEqual(fresh)
  })

  it('skips the GBIF check when species lookups are off', async () => {
    speciesLookupsAvailable.value = false
    const id = await createMediaFor(ACTOR1_ID)

    await request(id)

    expect(suggestSubjects).toHaveBeenCalledWith(
      expect.objectContaining({ gbif: null })
    )
    expect(createGbifClient).not.toHaveBeenCalled()
  })

  it('reads a video from its poster frame', async () => {
    const id = await createMediaFor(ACTOR1_ID, {
      mimeType: 'video/mp4',
      thumbnail: 'medias/suggest-poster.webp'
    })

    expect((await request(id)).status).toBe(200)
    expect(readStoredImage).toHaveBeenCalledWith(
      database,
      'medias/suggest-poster.webp'
    )
  })

  it.each([
    ['a video with no poster', { mimeType: 'video/mp4' }],
    ['audio', { mimeType: 'audio/mp4', thumbnail: 'medias/audio-art.webp' }]
  ])('answers 422 for %s', async (_, options) => {
    const id = await createMediaFor(ACTOR1_ID, options)

    const response = await request(id)

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: 'This media has no image to look at'
    })
    expect(suggestSubjects).not.toHaveBeenCalled()
  })

  it('answers 404 for another account’s media', async () => {
    const id = await createMediaFor(ACTOR2_ID)

    expect((await request(id)).status).toBe(404)
    expect(suggestSubjects).not.toHaveBeenCalled()
  })

  it.each(['999999999', 'abc', '1.5'])(
    'answers 404 for the id %j',
    async (id) => {
      expect((await request(id)).status).toBe(404)
    }
  )

  it('answers 503 when subject suggestions are not configured', async () => {
    vi.mocked(getSubjectProviderConfig).mockReturnValue(null)
    const id = await createMediaFor(ACTOR1_ID)

    const response = await request(id)

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'Subject suggestions are not configured'
    })
    expect(readStoredImage).not.toHaveBeenCalled()
  })

  it('answers 429 past the per-actor window, without running the model', async () => {
    takeMock.mockReturnValue(false)
    const id = await createMediaFor(ACTOR1_ID)

    const response = await request(id)

    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ error: 'Too many requests' })
    expect(suggestSubjects).not.toHaveBeenCalled()
  })

  it.each([
    [
      'the model fails',
      () => {
        vi.mocked(suggestSubjects).mockRejectedValue(
          new SubjectSuggestionError('boom')
        )
      }
    ],
    [
      'the stored file is gone',
      () => {
        vi.mocked(readStoredImage).mockResolvedValue(null)
      }
    ],
    [
      'reading the stored file throws',
      () => {
        vi.mocked(readStoredImage).mockRejectedValue(new Error('storage down'))
      }
    ]
  ])('answers 503 and stores nothing when %s', async (_, arrange) => {
    arrange()
    const id = await createMediaFor(ACTOR1_ID)

    const response = await request(id)

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'Subjects could not be suggested'
    })
    expect(await storedSuggestions(id)).toBeNull()
  })

  it('rejects a cross-site cookie request', async () => {
    const id = await createMediaFor(ACTOR1_ID)

    const response = await POST(
      new NextRequest(
        `https://llun.test/api/v1/media/${id}/subject-suggestions`,
        { method: 'POST', headers: { origin: 'https://evil.test' } }
      ),
      { params: Promise.resolve({ id }) }
    )

    expect(response.status).not.toBe(200)
    expect(suggestSubjects).not.toHaveBeenCalled()
  })
})
