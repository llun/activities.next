import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'

import { GET, POST } from './route'

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

describe('/api/v1/markers', () => {
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

  it('GET requires authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/markers'),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(401)
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
        body: new URLSearchParams({ 'notifications[last_read_id]': '9999' })
      }),
      { params: Promise.resolve({}) }
    )
    expect(formResponse.status).toBe(200)
    const formPosted = await formResponse.json()
    expect(formPosted.notifications).toEqual(
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

  it('POST requires authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const response = await POST(
      new NextRequest('https://llun.test/api/v1/markers', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: JSON.stringify({ home: { last_read_id: 'A1' } })
      }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(401)
  })

  it('POST writes both home and notifications in one call', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
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
          notifications: { last_read_id: 'N1' }
        })
      }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.home.last_read_id).toBe('H1')
    expect(data.notifications.last_read_id).toBe('N1')
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

  it('POST with malformed body returns 200 and empty object', async () => {
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
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({})
  })
})
