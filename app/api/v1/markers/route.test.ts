import { NextRequest } from 'next/server'

import { getTestSQLDatabaseWithInstance } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { NotificationType } from '@/lib/types/database/operations'

import { GET, POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase:
  ReturnType<typeof getTestSQLDatabaseWithInstance>['database'] | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyBearerToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('/api/v1/markers', () => {
  const { database, instance } = getTestSQLDatabaseWithInstance()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    await instance('markers').delete()
  })

  it('GET returns an empty object when nothing is set', async () => {
    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/markers?timeline[]=home&timeline[]=notifications'
      ),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({})
  })

  it('POST accepts form-encoded body and upserts the marker', async () => {
    const formResponse = await POST(
      new NextRequest('https://llun.test/api/v1/markers', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'https://llun.test'
        },
        body: new URLSearchParams({ 'home[last_read_id]': '9999' })
      }),
      { params: Promise.resolve({}) }
    )
    expect(formResponse.status).toBe(200)
    const formPosted = await formResponse.json()
    expect(formPosted.home).toEqual(
      expect.objectContaining({ last_read_id: '9999' })
    )
  })

  it('POST upserts and GET reads back the marker', async () => {
    const postResponse = await POST(
      new NextRequest('https://llun.test/api/v1/markers', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: JSON.stringify({ home: { last_read_id: '4321' } })
      }),
      { params: Promise.resolve({}) }
    )
    expect(postResponse.status).toBe(200)
    const posted = await postResponse.json()
    expect(posted.home).toEqual(
      expect.objectContaining({ last_read_id: '4321', version: 1 })
    )

    const getResponse = await GET(
      new NextRequest('https://llun.test/api/v1/markers?timeline[]=home'),
      { params: Promise.resolve({}) }
    )
    const fetched = await getResponse.json()
    expect(fetched.home.last_read_id).toBe('4321')
  })

  it('POST writes both home and notifications in one call', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })
    const notification = await database.createNotification({
      actorId: ACTOR2_ID,
      type: NotificationType.enum.follow,
      sourceActorId: ACTOR1_ID
    })
    const response = await POST(
      new NextRequest('https://llun.test/api/v1/markers', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: JSON.stringify({
          home: { last_read_id: 'H1' },
          notifications: { last_read_id: notification.id }
        })
      }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.home.last_read_id).toBe('H1')
    expect(data.notifications.last_read_id).toBe(notification.id)
  })

  describe('notifications marker guard', () => {
    const postNotificationsMarker = (lastReadId: string) =>
      POST(
        new NextRequest('https://llun.test/api/v1/markers', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'https://llun.test'
          },
          body: JSON.stringify({
            notifications: { last_read_id: lastReadId }
          })
        }),
        { params: Promise.resolve({}) }
      )

    // A v4 id that names no notification: what a client still holding ids
    // cached before notification ids became time-ordered would send.
    const staleId = '5f0c2a54-3d55-4e57-9d3c-0b8e7f6a1c2d'

    it('accepts a time-ordered (UUIDv7) id', async () => {
      const id = '019a0000-0000-7000-8000-000000000001'
      const response = await postNotificationsMarker(id)
      expect(response.status).toBe(200)
      expect((await response.json()).notifications.last_read_id).toBe(id)
    })

    it("accepts a non-v7 id naming one of the caller's own notifications", async () => {
      // A v4 row the previous build wrote and nothing has rewritten yet.
      const id = 'c0ffee00-0000-4000-8000-000000000000'
      await instance('notifications').insert({
        id,
        actorId: ACTOR1_ID,
        type: NotificationType.enum.follow,
        sourceActorId: ACTOR2_ID
      })

      const response = await postNotificationsMarker(id)
      expect((await response.json()).notifications.last_read_id).toBe(id)
    })

    it('keeps the stored marker when given a stale id, without an error', async () => {
      const kept = '019a0000-0000-7000-8000-000000000002'
      await postNotificationsMarker(kept)

      const response = await postNotificationsMarker(staleId)

      expect(response.status).toBe(200)
      const posted = await response.json()
      expect(posted.notifications).toEqual(
        expect.objectContaining({ last_read_id: kept, version: 1 })
      )
      const [stored] = await database.getMarkers({
        actorId: ACTOR1_ID,
        timelines: ['notifications']
      })
      expect(stored).toMatchObject({ lastReadId: kept, version: 1 })
    })

    it("does not accept another actor's notification id", async () => {
      const othersId = 'beef0000-0000-4000-8000-000000000000'
      await instance('notifications').insert({
        id: othersId,
        actorId: ACTOR2_ID,
        type: NotificationType.enum.follow,
        sourceActorId: ACTOR1_ID
      })

      const response = await postNotificationsMarker(othersId)

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({})
      await expect(
        database.getMarkers({
          actorId: ACTOR1_ID,
          timelines: ['notifications']
        })
      ).resolves.toEqual([])
    })
  })

  it('GET ignores invalid timeline values', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/markers?timeline[]=garbage'),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({})
  })

  it('GET accepts bare timeline param (no brackets)', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })
    await POST(
      new NextRequest('https://llun.test/api/v1/markers', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: JSON.stringify({ home: { last_read_id: 'Z' } })
      }),
      { params: Promise.resolve({}) }
    )
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/markers?timeline=home'),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.home.last_read_id).toBe('Z')
  })

  it('GET without timeline[] returns empty object even when markers exist', async () => {
    // First POST a marker so one exists for this actor
    await POST(
      new NextRequest('https://llun.test/api/v1/markers', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: JSON.stringify({ home: { last_read_id: 'X1' } })
      }),
      { params: Promise.resolve({}) }
    )
    // GET with no timeline[] param must return {}
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/markers'),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({})
  })

  it('POST with malformed JSON body returns 400', async () => {
    const response = await POST(
      new NextRequest('https://llun.test/api/v1/markers', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: 'not json'
      }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(400)
  })

  it('POST with empty body returns 200 and empty object', async () => {
    const response = await POST(
      new NextRequest('https://llun.test/api/v1/markers', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: ''
      }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({})
  })

  it('POST rejects an oversized last_read_id with 422 and stores nothing', async () => {
    const response = await POST(
      new NextRequest('https://llun.test/api/v1/markers', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: JSON.stringify({ home: { last_read_id: 'x'.repeat(5000) } })
      }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(422)
    expect(await instance('markers').select('id')).toHaveLength(0)
  })

  it('POST rejects a body over the size cap with 413 before parsing it', async () => {
    const response = await POST(
      new NextRequest('https://llun.test/api/v1/markers', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: JSON.stringify({ home: { last_read_id: 'x'.repeat(200_000) } })
      }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(413)
  })

  it('POST accepts a multipart body', async () => {
    const form = new FormData()
    form.set('home[last_read_id]', 'MP1')
    const response = await POST(
      new NextRequest('https://llun.test/api/v1/markers', {
        method: 'POST',
        headers: { origin: 'https://llun.test' },
        body: form
      }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(200)
    expect((await response.json()).home.last_read_id).toBe('MP1')
  })
})
