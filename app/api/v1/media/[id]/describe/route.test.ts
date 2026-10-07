import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { generateAltText } from '@/lib/services/altText/openai'
import { readStoredImage } from '@/lib/services/medias/readStoredMedia'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'

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
  getConfig: vi.fn()
}))

vi.mock('@/lib/services/altText/openai', () => ({
  generateAltText: vi.fn()
}))

vi.mock('@/lib/services/medias/readStoredMedia', () => ({
  readStoredImage: vi.fn()
}))

const ALT_TEXT = {
  endpoint: 'https://alt.test/v1',
  apiKey: 'key',
  model: 'vision'
}

const configWith = (altText: typeof ALT_TEXT | undefined) => ({
  allowEmails: [],
  host: 'llun.test',
  secretPhase: 'test-secret',
  ...(altText ? { altText } : {})
})

describe('POST /api/v1/media/[id]/describe', () => {
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
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    vi.mocked(getConfig).mockReturnValue(configWith(ALT_TEXT) as never)
    vi.mocked(readStoredImage).mockResolvedValue({
      buffer: Buffer.from('image-bytes'),
      mimeType: 'image/webp'
    })
    vi.mocked(generateAltText).mockResolvedValue('A kingfisher on a branch')
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
        path: `medias/describe-${counter}`,
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

  const request = (id: string) =>
    POST(
      new NextRequest(`https://llun.test/api/v1/media/${id}/describe`, {
        method: 'POST',
        headers: { origin: 'https://llun.test' }
      }),
      { params: Promise.resolve({ id }) }
    )

  it('returns generated alt text for an image without saving it', async () => {
    const id = await createMediaFor(ACTOR1_ID)

    const response = await request(id)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      description: 'A kingfisher on a branch'
    })
    expect(readStoredImage).toHaveBeenCalledWith(
      database,
      `medias/describe-${counter}`
    )
    expect(generateAltText).toHaveBeenCalledWith(
      ALT_TEXT,
      Buffer.from('image-bytes'),
      'image/webp'
    )
    const stored = await database.getMediaByIdForAccount({
      mediaId: id,
      accountId: (await database.getActorFromId({ id: ACTOR1_ID }))!.account!.id
    })
    expect(stored?.description).toBeUndefined()
  })

  it('describes a video from its stored poster frame', async () => {
    const id = await createMediaFor(ACTOR1_ID, {
      mimeType: 'video/mp4',
      thumbnail: 'medias/describe-poster.webp'
    })

    const response = await request(id)

    expect(response.status).toBe(200)
    expect(readStoredImage).toHaveBeenCalledWith(
      database,
      'medias/describe-poster.webp'
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
      error: 'This media has no image to describe'
    })
    expect(generateAltText).not.toHaveBeenCalled()
  })

  it('answers 404 for another account’s media', async () => {
    const id = await createMediaFor(ACTOR2_ID)

    expect((await request(id)).status).toBe(404)
    expect(generateAltText).not.toHaveBeenCalled()
  })

  it.each(['999999999', 'abc', '1.5'])(
    'answers 404 for the id %j',
    async (id) => {
      expect((await request(id)).status).toBe(404)
    }
  )

  it('answers 503 when alt text is not configured', async () => {
    vi.mocked(getConfig).mockReturnValue(configWith(undefined) as never)
    const id = await createMediaFor(ACTOR1_ID)

    const response = await request(id)

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'Alt text generation is not configured'
    })
    expect(readStoredImage).not.toHaveBeenCalled()
  })

  it.each([
    [
      'the alt text service returns nothing',
      () => {
        vi.mocked(generateAltText).mockResolvedValue(null)
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
  ])('answers 503 when %s', async (_, arrange) => {
    arrange()
    const id = await createMediaFor(ACTOR1_ID)

    const response = await request(id)

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'Alt text could not be generated'
    })
  })

  it('rejects a cross-site cookie request', async () => {
    const id = await createMediaFor(ACTOR1_ID)

    const response = await POST(
      new NextRequest(`https://llun.test/api/v1/media/${id}/describe`, {
        method: 'POST',
        headers: { origin: 'https://evil.test' }
      }),
      { params: Promise.resolve({ id }) }
    )

    expect(response.status).not.toBe(200)
    expect(generateAltText).not.toHaveBeenCalled()
  })
})
