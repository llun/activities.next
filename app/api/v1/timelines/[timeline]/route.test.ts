import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Timeline } from '@/lib/services/timelines/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { GET } from './route'

// Mock next-auth session
const mockGetServerSession = jest.fn()
jest.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args)
}))

// Mock database getter
let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

// Mock cookies from next/headers
const mockCookieValue: { value?: string } = {}
jest.mock('next/headers', () => ({
  cookies: jest.fn().mockImplementation(() =>
    Promise.resolve({
      get: (name: string) => {
        if (name === 'activities.actor-id') {
          return mockCookieValue.value
            ? { value: mockCookieValue.value }
            : undefined
        }
        return undefined
      }
    })
  )
}))

// Mock config
jest.mock('@/lib/config', () => ({
  getConfig: () => ({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('GET /api/v1/timelines/[timeline]', () => {
  const database = getTestSQLDatabase()
  let subActorId: string
  let actor1TimelinePost1Id: string
  let actor1TimelinePost2Id: string
  let subActorTimelinePost1Id: string
  let subActorTimelinePost2Id: string

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)

    // Get the primary actor's account
    const account = await database.getAccountFromEmail({
      email: seedActor1.email
    })
    if (!account) throw new Error('Account not found')

    // Create a sub-actor for the same account (simulates actor navigation switch)
    subActorId = await database.createActorForAccount({
      accountId: account.id,
      username: 'subactor',
      domain: 'llun.test',
      publicKey: 'subactor-public-key',
      privateKey: 'subactor-private-key'
    })

    // Create timeline posts for the primary actor (actor1)
    const actor1Post1 = await database.createNote({
      id: `${ACTOR1_ID}/statuses/timeline-post-1`,
      url: `${ACTOR1_ID}/statuses/timeline-post-1`,
      actorId: ACTOR1_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Actor1 timeline post 1'
    })
    const actor1Post2 = await database.createNote({
      id: `${ACTOR1_ID}/statuses/timeline-post-2`,
      url: `${ACTOR1_ID}/statuses/timeline-post-2`,
      actorId: ACTOR1_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Actor1 timeline post 2'
    })

    // Create timeline posts for the sub-actor
    const subActorPost1 = await database.createNote({
      id: `${subActorId}/statuses/timeline-post-1`,
      url: `${subActorId}/statuses/timeline-post-1`,
      actorId: subActorId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'SubActor timeline post 1'
    })
    const subActorPost2 = await database.createNote({
      id: `${subActorId}/statuses/timeline-post-2`,
      url: `${subActorId}/statuses/timeline-post-2`,
      actorId: subActorId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'SubActor timeline post 2'
    })

    // Add actor1's posts to actor1's MAIN timeline
    await database.createTimelineStatus({
      actorId: ACTOR1_ID,
      status: actor1Post1,
      timeline: Timeline.MAIN
    })
    await database.createTimelineStatus({
      actorId: ACTOR1_ID,
      status: actor1Post2,
      timeline: Timeline.MAIN
    })

    // Add sub-actor's posts to sub-actor's MAIN timeline
    await database.createTimelineStatus({
      actorId: subActorId,
      status: subActorPost1,
      timeline: Timeline.MAIN
    })
    await database.createTimelineStatus({
      actorId: subActorId,
      status: subActorPost2,
      timeline: Timeline.MAIN
    })

    actor1TimelinePost1Id = actor1Post1.id
    actor1TimelinePost2Id = actor1Post2.id
    subActorTimelinePost1Id = subActorPost1.id
    subActorTimelinePost2Id = subActorPost2.id

    mockDatabase = database
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    mockGetServerSession.mockReset()
    mockCookieValue.value = undefined
  })

  const createRequest = (params: Record<string, string> = {}) => {
    const url = new URL('https://llun.test/api/v1/timelines/main')
    url.searchParams.set('format', 'activities_next')
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
    return new NextRequest(url.toString())
  }

  describe('actor selection via cookie', () => {
    test('returns primary actor timeline when no cookie is set', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      mockCookieValue.value = undefined

      const req = createRequest()
      const response = await GET(req, {
        params: Promise.resolve({ timeline: 'main' })
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      const statusIds = data.statuses.map((s: { id: string }) => s.id)

      expect(statusIds).toContain(actor1TimelinePost1Id)
      expect(statusIds).toContain(actor1TimelinePost2Id)
      expect(statusIds).not.toContain(subActorTimelinePost1Id)
      expect(statusIds).not.toContain(subActorTimelinePost2Id)
    })

    test('returns sub-actor timeline when actor-id cookie is set to sub-actor', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      mockCookieValue.value = subActorId

      const req = createRequest()
      const response = await GET(req, {
        params: Promise.resolve({ timeline: 'main' })
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      const statusIds = data.statuses.map((s: { id: string }) => s.id)

      expect(statusIds).toContain(subActorTimelinePost1Id)
      expect(statusIds).toContain(subActorTimelinePost2Id)
      expect(statusIds).not.toContain(actor1TimelinePost1Id)
      expect(statusIds).not.toContain(actor1TimelinePost2Id)
    })
  })

  describe('timeline pagination with actor switching', () => {
    test('next page uses cookie actor timeline, not the login actor timeline', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      mockCookieValue.value = subActorId

      // Load first page for sub-actor
      const firstPageReq = createRequest()
      const firstPageResponse = await GET(firstPageReq, {
        params: Promise.resolve({ timeline: 'main' })
      })
      expect(firstPageResponse.status).toBe(200)
      const firstPageData = await firstPageResponse.json()
      expect(firstPageData.statuses.length).toBeGreaterThan(0)

      // All first-page statuses must belong to sub-actor, not the login actor
      const firstPageActorIds = firstPageData.statuses.map(
        (s: { actorId: string }) => s.actorId
      )
      expect(firstPageActorIds.every((id: string) => id === subActorId)).toBe(
        true
      )

      // Use the last status on page 1 as the max_id cursor for page 2
      const lastStatus =
        firstPageData.statuses[firstPageData.statuses.length - 1]
      const maxIdParam = urlToId(lastStatus.id)

      // Load next page with max_id — this is where the bug manifested:
      // before the fix, OAuthGuard resolved the actor from email (actor1)
      // ignoring the cookie, so the timeline query used actor1's actorId
      // and returned actor1's posts instead of the sub-actor's.
      const nextPageReq = createRequest({ max_id: maxIdParam })
      const nextPageResponse = await GET(nextPageReq, {
        params: Promise.resolve({ timeline: 'main' })
      })
      expect(nextPageResponse.status).toBe(200)
      const nextPageData = await nextPageResponse.json()

      // The next page must NOT contain any actor1 statuses
      const nextPageStatusIds = nextPageData.statuses.map(
        (s: { id: string }) => s.id
      )
      expect(nextPageStatusIds).not.toContain(actor1TimelinePost1Id)
      expect(nextPageStatusIds).not.toContain(actor1TimelinePost2Id)
    })

    test('next page with primary actor (no cookie) stays on primary actor timeline', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      mockCookieValue.value = undefined

      // Load first page for primary actor
      const firstPageReq = createRequest()
      const firstPageResponse = await GET(firstPageReq, {
        params: Promise.resolve({ timeline: 'main' })
      })
      expect(firstPageResponse.status).toBe(200)
      const firstPageData = await firstPageResponse.json()
      expect(firstPageData.statuses.length).toBeGreaterThan(0)

      const lastStatus =
        firstPageData.statuses[firstPageData.statuses.length - 1]
      const maxIdParam = urlToId(lastStatus.id)

      // Load next page — should still use actor1's timeline
      const nextPageReq = createRequest({ max_id: maxIdParam })
      const nextPageResponse = await GET(nextPageReq, {
        params: Promise.resolve({ timeline: 'main' })
      })
      expect(nextPageResponse.status).toBe(200)
      const nextPageData = await nextPageResponse.json()

      // Next page must not bleed into sub-actor's timeline
      const nextPageStatusIds = nextPageData.statuses.map(
        (s: { id: string }) => s.id
      )
      expect(nextPageStatusIds).not.toContain(subActorTimelinePost1Id)
      expect(nextPageStatusIds).not.toContain(subActorTimelinePost2Id)
    })
  })

  describe('unsupported and invalid timelines', () => {
    test('returns 404 for unsupported local-public timeline', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const req = new NextRequest(
        'https://llun.test/api/v1/timelines/local-public?format=activities_next'
      )
      const response = await GET(req, {
        params: Promise.resolve({ timeline: 'local-public' })
      })

      expect(response.status).toBe(404)
    })

    test('returns 404 for unknown timeline type', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const req = new NextRequest(
        'https://llun.test/api/v1/timelines/unknown?format=activities_next'
      )
      const response = await GET(req, {
        params: Promise.resolve({ timeline: 'unknown' })
      })

      expect(response.status).toBe(404)
    })

    test('returns 401 when no session and no token', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const req = createRequest()
      const response = await GET(req, {
        params: Promise.resolve({ timeline: 'main' })
      })

      expect(response.status).toBe(401)
    })
  })
})
