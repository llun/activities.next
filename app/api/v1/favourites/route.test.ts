import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { GET } from './route'

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

describe('GET /api/v1/favourites', () => {
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

  const createRequest = (query = '') =>
    new NextRequest(`https://llun.test/api/v1/favourites${query}`)

  const createFavouritedStatus = async (name: string, actorId = ACTOR1_ID) => {
    const statusId = `${ACTOR2_ID}/statuses/favourite-route-${name}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR2_ID,
      text: `Favourited route ${name}`,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.createLike({ actorId, statusId })
    return statusId
  }

  it('requires authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(401)
  })

  it('returns favourited statuses with favourited=true', async () => {
    const statusId = await createFavouritedStatus('list-one')

    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toContainEqual(
      expect.objectContaining({
        id: urlToId(statusId),
        favourited: true
      })
    )
  })

  it('returns activities_next statuses with favourite cursors when requested', async () => {
    const statusId = await createFavouritedStatus('activities-next')

    const response = await GET(
      createRequest('?format=activities_next&limit=1'),
      {
        params: Promise.resolve({})
      }
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({
      statuses: [
        expect.objectContaining({
          id: statusId,
          isActorLiked: true
        })
      ],
      nextMaxFavouriteId: expect.any(String),
      prevMinFavouriteId: expect.any(String)
    })
  })

  it('paginates with Mastodon Link headers using favourite cursors', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })

    await createFavouritedStatus('page-one', ACTOR2_ID)
    await createFavouritedStatus('page-two', ACTOR2_ID)

    const firstResponse = await GET(createRequest('?limit=1'), {
      params: Promise.resolve({})
    })
    expect(firstResponse.status).toBe(200)
    const firstPage = await firstResponse.json()
    expect(firstPage).toHaveLength(1)

    const linkHeader = firstResponse.headers.get('Link')
    expect(linkHeader).toContain('rel="next"')
    expect(linkHeader).toContain('rel="prev"')

    const maxId = linkHeader?.match(/[?&]max_id=([^&>]+)/)?.[1]
    expect(maxId).toBeTruthy()

    const secondResponse = await GET(
      createRequest(`?limit=1&max_id=${maxId}`),
      {
        params: Promise.resolve({})
      }
    )
    expect(secondResponse.status).toBe(200)
    const secondPage = await secondResponse.json()
    expect(secondPage).toHaveLength(1)
    expect(secondPage[0].id).not.toBe(firstPage[0].id)
  })

  it('returns an empty list for invalid pagination cursors', async () => {
    await createFavouritedStatus('invalid-cursor')

    const response = await GET(createRequest('?max_id=@@@'), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([])
  })
})
