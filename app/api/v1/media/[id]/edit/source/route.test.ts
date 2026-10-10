import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { readStoredImage } from '@/lib/services/medias/readStoredMedia'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'

import { GET } from './route'

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

vi.mock('@/lib/services/medias/readStoredMedia', () => ({
  readStoredImage: vi.fn()
}))

describe('GET /api/v1/media/[id]/edit/source', () => {
  const { database, prepare } = getTestDatabaseWithInstance()
  let accountId = ''
  const BYTES = Buffer.from('original-bytes')

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
    accountId = (await database.getActorFromId({ id: ACTOR1_ID }))!.account!.id
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
    vi.mocked(readStoredImage).mockResolvedValue({
      buffer: BYTES,
      mimeType: 'image/jpeg'
    })
  })

  let counter = 0
  const createMediaFor = async (actorId: string, mimeType = 'image/jpeg') => {
    counter += 1
    const media = await database.createMedia({
      actorId,
      original: {
        path: `medias/source-${counter}.jpg`,
        bytes: 1000,
        mimeType,
        metaData: { width: 400, height: 300 }
      }
    })
    return media!
  }

  const get = (id: string) =>
    GET(
      new NextRequest(`https://llun.test/api/v1/media/${id}/edit/source`, {
        headers: { origin: 'https://llun.test' }
      }),
      { params: Promise.resolve({ id }) }
    )

  it('answers 401 without a session', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const media = await createMediaFor(ACTOR1_ID)
    expect((await get(media.id)).status).toBe(401)
  })

  it('answers 404 for a media of another account', async () => {
    const media = await createMediaFor(ACTOR2_ID)
    const response = await get(media.id)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Record not found' })
    expect(readStoredImage).not.toHaveBeenCalled()
  })

  it('answers 422 for a video', async () => {
    const media = await createMediaFor(ACTOR1_ID, 'video/mp4')
    expect((await get(media.id)).status).toBe(422)
  })

  it('answers 422 when the stored file is gone', async () => {
    vi.mocked(readStoredImage).mockResolvedValue(null)
    const media = await createMediaFor(ACTOR1_ID)
    expect((await get(media.id)).status).toBe(422)
  })

  it('serves the uploaded bytes of an unedited photo, cached privately', async () => {
    const media = await createMediaFor(ACTOR1_ID)

    const response = await get(media.id)

    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(BYTES)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('cache-control')).toBe('private, max-age=300')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(readStoredImage).toHaveBeenCalledWith(
      database,
      media.original.path,
      100 * 1024 * 1024
    )
  })

  it('serves the original slot of an edited photo, not the render', async () => {
    const media = await createMediaFor(ACTOR1_ID)
    await database.applyMediaEdit({
      mediaId: media.id,
      accountId,
      baseVersion: 0,
      saveId: 'source-edit',
      recipe: JSON.stringify({ v: 1 }),
      render: {
        path: `medias/source-render-${media.id}.webp`,
        bytes: 100,
        mimeType: 'image/webp',
        width: 400,
        height: 300,
        blurhash: null,
        focus: null
      }
    })

    const response = await get(media.id)

    expect(response.status).toBe(200)
    expect(readStoredImage).toHaveBeenCalledWith(
      database,
      media.original.path,
      100 * 1024 * 1024
    )
  })
})
