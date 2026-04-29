import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { seedActor3 } from '@/lib/stub/seed/actor3'
import { FollowStatus } from '@/lib/types/domain/follow'
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

const createRequest = (query = '') =>
  new NextRequest(
    `https://llun.test/api/v1/accounts/${urlToId(ACTOR1_ID)}/statuses${query}`
  )

describe('GET /api/v1/accounts/[id]/statuses', () => {
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
    mockGetServerSession.mockResolvedValue(null)
  })

  it('allows anonymous reads but only returns public and unlisted statuses', async () => {
    const publicStatusId = `${ACTOR1_ID}/statuses/account-public-read`
    const unlistedStatusId = `${ACTOR1_ID}/statuses/account-unlisted-read`
    const privateStatusId = `${ACTOR1_ID}/statuses/account-private-read`
    const directStatusId = `${ACTOR1_ID}/statuses/account-direct-read`

    await database.createNote({
      id: publicStatusId,
      url: publicStatusId,
      actorId: ACTOR1_ID,
      text: 'Account public read',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.createNote({
      id: unlistedStatusId,
      url: unlistedStatusId,
      actorId: ACTOR1_ID,
      text: 'Account unlisted read',
      to: [`${ACTOR1_ID}/followers`],
      cc: [ACTIVITY_STREAM_PUBLIC]
    })
    await database.createNote({
      id: privateStatusId,
      url: privateStatusId,
      actorId: ACTOR1_ID,
      text: 'Account private read',
      to: [`${ACTOR1_ID}/followers`],
      cc: []
    })
    await database.createNote({
      id: directStatusId,
      url: directStatusId,
      actorId: ACTOR1_ID,
      text: 'Account direct read',
      to: [ACTOR2_ID],
      cc: []
    })

    const response = await GET(createRequest('?limit=50'), {
      params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
    })

    expect(response.status).toBe(200)

    const data = (await response.json()) as Array<{ uri: string }>
    const uris = data.map((status) => status.uri)

    expect(uris).toContain(publicStatusId)
    expect(uris).toContain(unlistedStatusId)
    expect(uris).not.toContain(privateStatusId)
    expect(uris).not.toContain(directStatusId)
  })

  it('allows the owner to read their non-public account statuses', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

    const privateStatusId = `${ACTOR1_ID}/statuses/account-private-owner-read`
    const directStatusId = `${ACTOR1_ID}/statuses/account-direct-owner-read`

    await database.createNote({
      id: privateStatusId,
      url: privateStatusId,
      actorId: ACTOR1_ID,
      text: 'Account private owner read',
      to: [`${ACTOR1_ID}/followers`],
      cc: []
    })
    await database.createNote({
      id: directStatusId,
      url: directStatusId,
      actorId: ACTOR1_ID,
      text: 'Account direct owner read',
      to: [ACTOR2_ID],
      cc: []
    })

    const response = await GET(createRequest('?limit=50'), {
      params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
    })

    expect(response.status).toBe(200)

    const data = (await response.json()) as Array<{ uri: string }>
    const uris = data.map((status) => status.uri)

    expect(uris).toContain(privateStatusId)
    expect(uris).toContain(directStatusId)
  })

  it('allows accepted followers to read followers-only account statuses', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })

    await database.createFollow({
      actorId: ACTOR2_ID,
      targetActorId: ACTOR1_ID,
      inbox: `${ACTOR2_ID}/inbox`,
      sharedInbox: `https://${TEST_DOMAIN}/inbox`,
      status: FollowStatus.enum.Accepted
    })

    const privateStatusId = `${ACTOR1_ID}/statuses/account-private-follower-read`
    await database.createNote({
      id: privateStatusId,
      url: privateStatusId,
      actorId: ACTOR1_ID,
      text: 'Account private follower read',
      to: [`${ACTOR1_ID}/followers`],
      cc: []
    })

    const response = await GET(createRequest('?limit=50'), {
      params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
    })

    expect(response.status).toBe(200)

    const data = (await response.json()) as Array<{ uri: string }>
    const uris = data.map((status) => status.uri)

    expect(uris).toContain(privateStatusId)
  })

  it('applies account visibility filtering before limiting results', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor3.email }
    })

    const publicStatusId = `${ACTOR1_ID}/statuses/account-visible-before-limit`
    const privateStatusId = `${ACTOR1_ID}/statuses/account-hidden-before-limit`
    await database.createNote({
      id: publicStatusId,
      url: publicStatusId,
      actorId: ACTOR1_ID,
      text: 'Account visible before limit',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.createNote({
      id: privateStatusId,
      url: privateStatusId,
      actorId: ACTOR1_ID,
      text: 'Account hidden before limit',
      to: [`${ACTOR1_ID}/followers`],
      cc: []
    })

    const response = await GET(createRequest('?limit=1'), {
      params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
    })

    expect(response.status).toBe(200)

    const data = (await response.json()) as Array<{ uri: string }>
    const uris = data.map((status) => status.uri)

    expect(uris).toEqual([publicStatusId])
    expect(uris).not.toContain(privateStatusId)
  })

  it('continues scanning when a public announce wraps a non-public original', async () => {
    const now = Date.now() + 10_000
    const publicStatusId = `${ACTOR1_ID}/statuses/account-public-after-unreadable-announce`
    const privateOriginalStatusId = `${ACTOR2_ID}/statuses/account-private-original-for-announce`
    const unreadableAnnounceId = `${ACTOR1_ID}/statuses/account-unreadable-announce`

    await database.createNote({
      id: publicStatusId,
      url: publicStatusId,
      actorId: ACTOR1_ID,
      text: 'Account public after unreadable announce',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      createdAt: now
    })
    await database.createNote({
      id: privateOriginalStatusId,
      url: privateOriginalStatusId,
      actorId: ACTOR2_ID,
      text: 'Private original for unreadable announce',
      to: [`${ACTOR2_ID}/followers`],
      cc: [],
      createdAt: now + 1
    })
    await database.createAnnounce({
      id: unreadableAnnounceId,
      actorId: ACTOR1_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      originalStatusId: privateOriginalStatusId,
      createdAt: now + 2
    })

    const response = await GET(createRequest('?limit=1'), {
      params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
    })

    expect(response.status).toBe(200)

    const data = (await response.json()) as Array<{ uri: string }>
    const uris = data.map((status) => status.uri)

    expect(uris).toEqual([publicStatusId])
    expect(uris).not.toContain(unreadableAnnounceId)
  })

  it('returns bad request for invalid query params', async () => {
    const response = await GET(createRequest('?limit=0'), {
      params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
    })

    expect(response.status).toBe(400)
  })
})
