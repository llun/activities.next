import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'

import { GET, PUT } from './route'

const mockGetServerSession = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: jest.fn().mockReturnValue(undefined)
  })
}))

jest.mock('better-auth/oauth2', () => ({
  verifyAccessToken: jest.fn()
}))

jest.mock('@/lib/config', () => ({
  getBaseURL: jest.fn().mockReturnValue('https://llun.test'),
  getConfig: jest.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('/api/v1/media/[id]', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  const createMediaFor = async (actorId: string, name: string) => {
    const media = await database.createMedia({
      actorId,
      description: 'before',
      original: {
        path: `medias/route-${name}.jpg`,
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: { width: 320, height: 240 }
      }
    })
    // Route params always arrive as strings; normalise to mirror production.
    return String(media!.id)
  }

  const putRequest = (id: string, body: Record<string, unknown>) =>
    new NextRequest(`https://llun.test/api/v1/media/${id}`, {
      method: 'PUT',
      // Same-origin proof for the cookie-session path (CSRF protection); bearer
      // clients bypass this in OAuthGuard.
      headers: {
        'content-type': 'application/json',
        origin: 'https://llun.test'
      },
      body: JSON.stringify(body)
    })

  const getRequest = (id: string) =>
    new NextRequest(`https://llun.test/api/v1/media/${id}`)

  it('requires authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const id = await createMediaFor(ACTOR1_ID, 'auth')

    const response = await GET(getRequest(id), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(401)
  })

  it('GET returns the media attachment for the owner', async () => {
    const id = await createMediaFor(ACTOR1_ID, 'get-owner')

    const response = await GET(getRequest(id), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({
      id,
      type: 'image',
      description: 'before',
      url: `https://llun.test/api/v1/files/medias/route-get-owner.jpg`
    })
  })

  it('GET returns 404 for media owned by another account', async () => {
    const id = await createMediaFor(ACTOR2_ID, 'get-foreign')

    const response = await GET(getRequest(id), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(404)
  })

  it('PUT updates the description', async () => {
    const id = await createMediaFor(ACTOR1_ID, 'put-update')

    const response = await PUT(
      putRequest(id, { description: 'a new alt text' }),
      {
        params: Promise.resolve({ id })
      }
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({ id, description: 'a new alt text' })

    const stored = await database.getMediaByIdForAccount({
      mediaId: id,
      accountId: (await database.getActorFromId({ id: ACTOR1_ID }))!.account!.id
    })
    expect(stored?.description).toBe('a new alt text')
  })

  it('PUT clears the description when null is sent', async () => {
    const id = await createMediaFor(ACTOR1_ID, 'put-clear')

    const response = await PUT(putRequest(id, { description: null }), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.description).toBe('')
  })

  it('PUT leaves the description untouched when not provided', async () => {
    const id = await createMediaFor(ACTOR1_ID, 'put-omit')

    const response = await PUT(putRequest(id, { focus: '0.0,0.0' }), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.description).toBe('before')
  })

  it('PUT returns 404 for media owned by another account', async () => {
    const id = await createMediaFor(ACTOR2_ID, 'put-foreign')

    const response = await PUT(putRequest(id, { description: 'nope' }), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(404)
  })
})
