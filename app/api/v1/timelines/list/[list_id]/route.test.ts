import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
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

describe('GET /api/v1/timelines/list/[list_id]', () => {
  const database = getTestSQLDatabase()
  let listId: string
  let listStatus: Status

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)

    const list = await database.createList({
      actorId: ACTOR1_ID,
      title: 'Test list'
    })
    listId = list.id

    listStatus = await database.createNote({
      id: `${ACTOR1_ID}/statuses/list-1`,
      url: `${ACTOR1_ID}/statuses/list-1`,
      actorId: ACTOR1_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'list timeline post'
    })

    mockDatabase = database
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    jest.restoreAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  const request = (params: Record<string, string> = {}) => {
    const url = new URL(`https://llun.test/api/v1/timelines/list/${listId}`)
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
    return new NextRequest(url.toString())
  }

  it('returns the list timeline for a valid request with Link headers', async () => {
    jest.spyOn(database, 'getListTimeline').mockResolvedValue([listStatus])

    const response = await GET(request(), {
      params: Promise.resolve({ list_id: listId })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.map((status: { id: string }) => status.id)).toEqual([
      urlToId(listStatus.id)
    ])
    const link = response.headers.get('Link') || ''
    expect(link).toContain('rel="next"')
    expect(link).toContain('rel="prev"')
  })

  it('returns 404 for a non-existent list', async () => {
    const response = await GET(request(), {
      params: Promise.resolve({ list_id: 'does-not-exist' })
    })
    expect(response.status).toBe(404)
  })

  it.each([
    { description: 'max_id', field: 'max_id' },
    { description: 'min_id', field: 'min_id' },
    { description: 'since_id', field: 'since_id' }
  ])(
    'returns 400 (not 500) for a malformed $description cursor',
    async ({ field }) => {
      const response = await GET(request({ [field]: 'apurl_@@@@' }), {
        params: Promise.resolve({ list_id: listId })
      })
      expect(response.status).toBe(400)
    }
  )

  it('returns 200 with the bad row skipped when one status is un-hydratable', async () => {
    // A status whose shape throws during Mastodon serialization (here a Note
    // missing its tags/attachments arrays) must be dropped, not 500 the page.
    const brokenStatus = {
      id: `${ACTOR1_ID}/statuses/list-broken`,
      actorId: ACTOR1_ID,
      type: 'Note',
      reply: '',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    } as unknown as Status
    jest
      .spyOn(database, 'getListTimeline')
      .mockResolvedValue([listStatus, brokenStatus])

    const response = await GET(request(), {
      params: Promise.resolve({ list_id: listId })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.map((status: { id: string }) => status.id)).toEqual([
      urlToId(listStatus.id)
    ])
  })

  it('returns an empty array and no Link header when there are no statuses', async () => {
    jest.spyOn(database, 'getListTimeline').mockResolvedValue([])

    const response = await GET(request(), {
      params: Promise.resolve({ list_id: listId })
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
    expect(response.headers.get('Link')).toBeNull()
  })
})
