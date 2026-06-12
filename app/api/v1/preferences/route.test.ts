import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'

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

describe('/api/v1/preferences', () => {
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
      new NextRequest('https://llun.test/api/v1/preferences'),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(401)
  })

  it('returns the documented default payload when no preferences are set', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/preferences'),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      'posting:default:visibility': 'public',
      'posting:default:sensitive': false,
      'posting:default:language': 'en',
      'reading:expand:media': 'default',
      'reading:expand:spoilers': false,
      'reading:autoplay:gifs': false
    })
  })

  it('reflects the actor posting defaults and reading preferences', async () => {
    await database.updateActor({
      actorId: ACTOR1_ID,
      defaultPrivacy: 'private',
      defaultSensitive: true,
      defaultLanguage: 'th',
      readingExpandMedia: 'show_all',
      readingExpandSpoilers: true,
      readingAutoplayGifs: true
    })
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/preferences'),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      'posting:default:visibility': 'private',
      'posting:default:sensitive': true,
      'posting:default:language': 'th',
      'reading:expand:media': 'show_all',
      'reading:expand:spoilers': true,
      'reading:autoplay:gifs': true
    })
  })
})
