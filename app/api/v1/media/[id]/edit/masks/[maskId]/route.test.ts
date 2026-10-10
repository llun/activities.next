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

const MASK_ID = 'subj0001'

describe('GET /api/v1/media/[id]/edit/masks/[maskId]', () => {
  const { database, prepare } = getTestDatabaseWithInstance()
  const BYTES = Buffer.from('mask-png-bytes')
  const accountIdOf = async (actorId: string) =>
    (await database.getActorFromId({ id: actorId }))!.account!.id

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
    vi.mocked(readStoredImage).mockResolvedValue({
      buffer: BYTES,
      mimeType: 'image/png'
    })
  })

  let counter = 0
  // A photo edited with one stored mask.
  const createMaskedMediaFor = async (actorId: string) => {
    counter += 1
    const media = await database.createMedia({
      actorId,
      original: {
        path: `medias/mask-source-${counter}.jpg`,
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: { width: 400, height: 300 }
      }
    })
    const maskPath = `medias/mask-${counter}.png`
    await database.applyMediaEdit({
      mediaId: media!.id,
      accountId: await accountIdOf(actorId),
      baseVersion: 0,
      saveId: `mask-edit-${counter}`,
      recipe: JSON.stringify({ v: 1 }),
      render: {
        path: `medias/mask-render-${counter}.webp`,
        bytes: 100,
        mimeType: 'image/webp',
        width: 400,
        height: 300,
        blurhash: null,
        focus: null
      },
      masks: [
        {
          id: MASK_ID,
          image: {
            path: maskPath,
            bytes: 14,
            mimeType: 'image/png',
            width: 1024,
            height: 768
          }
        }
      ]
    })
    return { id: media!.id, maskPath }
  }

  const get = (id: string, maskId = MASK_ID) =>
    GET(
      new NextRequest(
        `https://llun.test/api/v1/media/${id}/edit/masks/${maskId}?v=1`,
        { headers: { origin: 'https://llun.test' } }
      ),
      { params: Promise.resolve({ id, maskId }) }
    )

  it('answers 401 without a session', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const { id } = await createMaskedMediaFor(ACTOR1_ID)
    expect((await get(id)).status).toBe(401)
  })

  it('answers 404 for a mask of another account', async () => {
    const { id } = await createMaskedMediaFor(ACTOR2_ID)
    const response = await get(id)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Record not found' })
    expect(readStoredImage).not.toHaveBeenCalled()
  })

  it.each([
    ['a mask the photo does not have', 'zzzz9999'],
    ['a malformed mask id', '..%2Fx'],
    ['an upper-case mask id', 'SUBJ0001']
  ])('answers 404 for %s', async (_, maskId) => {
    const { id } = await createMaskedMediaFor(ACTOR1_ID)
    const response = await get(id, maskId)
    expect(response.status).toBe(404)
    expect(readStoredImage).not.toHaveBeenCalled()
  })

  it('answers 404 when the stored file is gone', async () => {
    vi.mocked(readStoredImage).mockResolvedValue(null)
    const { id } = await createMaskedMediaFor(ACTOR1_ID)
    expect((await get(id)).status).toBe(404)
  })

  it('serves the stored mask PNG, cached privately', async () => {
    const { id, maskPath } = await createMaskedMediaFor(ACTOR1_ID)

    const response = await get(id)

    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(BYTES)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control')).toBe('private, max-age=300')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(readStoredImage).toHaveBeenCalledWith(
      database,
      maskPath,
      8 * 1024 * 1024
    )
  })

  it('answers 404 once a revert removed the mask', async () => {
    const { id } = await createMaskedMediaFor(ACTOR1_ID)
    await database.revertMediaEdit({
      mediaId: id,
      accountId: await accountIdOf(ACTOR1_ID),
      baseVersion: 1,
      saveId: 'revert'
    })

    expect((await get(id)).status).toBe(404)
  })
})
