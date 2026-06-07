import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { Status } from '@/lib/types/domain/status'
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
  cookies: jest.fn().mockImplementation(() =>
    Promise.resolve({
      get: () => undefined
    })
  )
}))

jest.mock('better-auth/oauth2', () => ({
  verifyAccessToken: jest.fn()
}))

jest.mock('@/lib/config', () => ({
  getConfig: () => ({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('GET /api/v1/timelines/public', () => {
  const database = getTestSQLDatabase()
  let publicStatus: Status

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    publicStatus = await database.createNote({
      id: `${ACTOR1_ID}/statuses/public-1`,
      url: `${ACTOR1_ID}/statuses/public-1`,
      actorId: ACTOR1_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'public timeline post'
    })
    mockDatabase = database
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    jest.restoreAllMocks()
    // No session → optional auth resolves currentActor = null (anonymous).
    mockGetServerSession.mockResolvedValue(null)
  })

  const request = (params: Record<string, string> = {}) => {
    const url = new URL('https://llun.test/api/v1/timelines/public')
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
    return new NextRequest(url.toString())
  }

  it('returns the public timeline for a valid request', async () => {
    jest.spyOn(database, 'getTimeline').mockResolvedValue([publicStatus])

    const response = await GET(request(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.map((status: { id: string }) => status.id)).toEqual([
      urlToId(publicStatus.id)
    ])
  })

  it.each([
    { description: 'junk opaque id', value: 'apurl_@@@@' },
    { description: 'percent signs', value: '%%%' },
    { description: 'spaces', value: 'a b c' }
  ])(
    'returns 400 (not 500) for a malformed max_id cursor ($description)',
    async ({ value }) => {
      const response = await GET(request({ max_id: value }), {
        params: Promise.resolve({})
      })
      expect(response.status).toBe(400)
    }
  )

  it('returns 200 with the bad row skipped when one status is un-hydratable', async () => {
    // A status whose shape throws during Mastodon serialization (here a Note
    // missing its tags/attachments arrays) must be dropped, not 500 the page.
    const brokenStatus = {
      id: `${ACTOR1_ID}/statuses/public-broken`,
      actorId: ACTOR1_ID,
      type: 'Note',
      reply: '',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    } as unknown as Status
    jest
      .spyOn(database, 'getTimeline')
      .mockResolvedValue([publicStatus, brokenStatus])

    const response = await GET(request(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.map((status: { id: string }) => status.id)).toEqual([
      urlToId(publicStatus.id)
    ])
  })

  it('returns an empty array and no Link header when there are no statuses', async () => {
    jest.spyOn(database, 'getTimeline').mockResolvedValue([])

    const response = await GET(request(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
    expect(response.headers.get('Link')).toBeNull()
  })
})
