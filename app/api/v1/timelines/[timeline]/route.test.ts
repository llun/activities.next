import { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Timeline } from '@/lib/services/timelines/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { Status } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { GET } from './route'

// Mock auth session
const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

// Mock database getter
let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

// Mock cookies from next/headers
const mockCookieValue: { value?: string } = {}
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(() =>
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

// Mock better-auth/oauth2 (ESM-only module, not needed for session-based tests)
vi.mock('better-auth/oauth2', () => ({
  verifyAccessToken: vi.fn()
}))

// Mock config
vi.mock('@/lib/config', () => ({
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
  let accountId: string

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)

    // Get the primary actor's account
    const account = await database.getAccountFromEmail({
      email: seedActor1.email
    })
    if (!account) throw new Error('Account not found')
    accountId = account.id

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

  const createIsolatedActor = async () =>
    database.createActorForAccount({
      accountId,
      username: `timeline-${randomUUID()}`,
      domain: 'llun.test',
      publicKey: 'timeline-public-key',
      privateKey: 'timeline-private-key'
    })

  const createTimelineNote = async ({
    actorId,
    timelineActorId,
    name
  }: {
    actorId: string
    timelineActorId: string
    name: string
  }) => {
    const statusId = `${actorId}/statuses/${name}-${randomUUID()}`
    const status = await database.createNote({
      id: statusId,
      url: statusId,
      actorId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: name
    })
    await database.createTimelineStatus({
      actorId: timelineActorId,
      status,
      timeline: Timeline.MAIN
    })
    return status
  }

  describe('moderation state on the home timeline', () => {
    test('keeps posts from a silenced author on the home timeline', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      await database.setActorSilenced({ actorId: ACTOR1_ID, silenced: true })

      try {
        const response = await GET(createRequest(), {
          params: Promise.resolve({ timeline: 'main' })
        })

        expect(response.status).toBe(200)
        const statusIds = (await response.json()).statuses.map(
          (s: { id: string }) => s.id
        )
        // Silence only hides an author from public surfaces; a follower's home
        // timeline still shows them.
        expect(statusIds).toContain(actor1TimelinePost1Id)
      } finally {
        await database.setActorSilenced({ actorId: ACTOR1_ID, silenced: false })
      }
    })
  })

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

  describe('timeline pagination with blocked statuses', () => {
    test('fills an older page after filtering blocked statuses', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      const actorId = await createIsolatedActor()
      mockCookieValue.value = actorId

      const visibleStatus = await createTimelineNote({
        actorId,
        timelineActorId: actorId,
        name: 'visible-older'
      })
      await createTimelineNote({
        actorId: EXTERNAL_ACTOR1,
        timelineActorId: actorId,
        name: 'blocked-newer'
      })
      await database.createBlock({
        actorId,
        targetActorId: EXTERNAL_ACTOR1,
        uri: `${actorId}#blocks/${randomUUID()}`
      })

      const response = await GET(createRequest({ limit: '1' }), {
        params: Promise.resolve({ timeline: 'main' })
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.statuses.map((status: { id: string }) => status.id)).toEqual([
        visibleStatus.id
      ])
    })

    test('fills a newer page after filtering blocked statuses', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      const actorId = await createIsolatedActor()
      mockCookieValue.value = actorId

      const cursorStatus = await createTimelineNote({
        actorId,
        timelineActorId: actorId,
        name: 'cursor'
      })
      const visibleStatus = await createTimelineNote({
        actorId,
        timelineActorId: actorId,
        name: 'visible-newer'
      })
      await createTimelineNote({
        actorId: EXTERNAL_ACTOR1,
        timelineActorId: actorId,
        name: 'blocked-newest'
      })
      await database.createBlock({
        actorId,
        targetActorId: EXTERNAL_ACTOR1,
        uri: `${actorId}#blocks/${randomUUID()}`
      })

      const response = await GET(
        createRequest({ limit: '1', min_id: urlToId(cursorStatus.id) }),
        { params: Promise.resolve({ timeline: 'main' }) }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.statuses.map((status: { id: string }) => status.id)).toEqual([
        visibleStatus.id
      ])
    })

    test('caps mastodon timeline limits and omits next when exhausted', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      const actorId = await createIsolatedActor()
      mockCookieValue.value = actorId

      await createTimelineNote({
        actorId,
        timelineActorId: actorId,
        name: 'only-status'
      })

      const url = new URL('https://llun.test/api/v1/timelines/main')
      url.searchParams.set('limit', '500')
      const response = await GET(new NextRequest(url.toString()), {
        params: Promise.resolve({ timeline: 'main' })
      })

      expect(response.status).toBe(200)
      const link = response.headers.get('Link') || ''
      expect(link).not.toContain('rel="next"')
      expect(link).toContain('limit=80')
    })

    test('omits next when a final short batch exactly fills the visible page', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      const actorId = await createIsolatedActor()
      mockCookieValue.value = actorId

      await createTimelineNote({
        actorId,
        timelineActorId: actorId,
        name: 'older-visible'
      })
      await createTimelineNote({
        actorId,
        timelineActorId: actorId,
        name: 'newer-visible'
      })
      await createTimelineNote({
        actorId: EXTERNAL_ACTOR1,
        timelineActorId: actorId,
        name: 'newest-blocked'
      })
      await database.createBlock({
        actorId,
        targetActorId: EXTERNAL_ACTOR1,
        uri: `${actorId}#blocks/${randomUUID()}`
      })

      const url = new URL('https://llun.test/api/v1/timelines/main')
      url.searchParams.set('limit', '2')
      const response = await GET(new NextRequest(url.toString()), {
        params: Promise.resolve({ timeline: 'main' })
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toHaveLength(2)
      expect(response.headers.get('Link') || '').not.toContain('rel="next"')
    })

    test('returns an activities_next continuation cursor when capped scans find no visible statuses', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      const actorId = await createIsolatedActor()
      mockCookieValue.value = actorId

      const blockedStatusIds: string[] = []
      for (let index = 0; index < 6; index++) {
        const status = await createTimelineNote({
          actorId: EXTERNAL_ACTOR1,
          timelineActorId: actorId,
          name: `blocked-${index}`
        })
        blockedStatusIds.push(status.id)
      }
      await database.createBlock({
        actorId,
        targetActorId: EXTERNAL_ACTOR1,
        uri: `${actorId}#blocks/${randomUUID()}`
      })

      const response = await GET(createRequest({ limit: '1' }), {
        params: Promise.resolve({ timeline: 'main' })
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.statuses).toEqual([])
      expect(data.nextMaxStatusId).toBe(blockedStatusIds[1])
    })

    test('hides statuses from a domain the viewer blocked', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      const actorId = await createIsolatedActor()
      mockCookieValue.value = actorId

      const visibleStatus = await createTimelineNote({
        actorId,
        timelineActorId: actorId,
        name: 'domain-visible'
      })
      await createTimelineNote({
        actorId: EXTERNAL_ACTOR1,
        timelineActorId: actorId,
        name: 'domain-blocked'
      })
      await database.createActorDomainBlock({ actorId, domain: 'llun.dev' })

      const response = await GET(createRequest(), {
        params: Promise.resolve({ timeline: 'main' })
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.statuses.map((status: { id: string }) => status.id)).toEqual([
        visibleStatus.id
      ])
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

  describe('query param validation', () => {
    test.each([['max_id'], ['min_id'], ['since_id']])(
      'returns 400 (not 500) for a malformed %s cursor',
      async (field) => {
        mockGetServerSession.mockResolvedValue({
          user: { email: seedActor1.email }
        })

        const response = await GET(createRequest({ [field]: 'apurl_@@@@' }), {
          params: Promise.resolve({ timeline: 'main' })
        })

        expect(response.status).toBe(400)
      }
    )

    test('min_id takes precedence over since_id and drives the adjacent-page (ascending) scan', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      const sinceUrl = 'https://llun.test/users/test1/statuses/since-cursor'
      const minUrl = 'https://llun.test/users/test1/statuses/min-cursor'
      const spy = vi.spyOn(database, 'getTimeline').mockResolvedValue([])

      await GET(
        createRequest({
          since_id: urlToId(sinceUrl),
          min_id: urlToId(minUrl)
        }),
        { params: Promise.resolve({ timeline: 'main' }) }
      )

      // min_id is the adjacent-page cursor, so it wins and reaches getTimeline
      // as minStatusId (ascending seek then reversed) — never collapsed into the
      // DESC since path.
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ minStatusId: minUrl })
      )
      spy.mockRestore()
    })

    test('since_id alone reaches getTimeline as the DESC sinceStatusId lower bound', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      const sinceUrl = 'https://llun.test/users/test1/statuses/since-only'
      const spy = vi.spyOn(database, 'getTimeline').mockResolvedValue([])

      await GET(createRequest({ since_id: urlToId(sinceUrl) }), {
        params: Promise.resolve({ timeline: 'main' })
      })

      const call = spy.mock.calls[0][0] as Record<string, unknown>
      expect(call.sinceStatusId).toBe(sinceUrl)
      // since_id keeps newest-first ordering, so the DESC backfill never drives
      // it as min_id.
      expect(call.minStatusId).toBeUndefined()
      spy.mockRestore()
    })
  })

  describe('hydration resilience', () => {
    test('returns 200 with the un-hydratable row skipped, not 500', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const goodStatus = (await database.getStatus({
        statusId: actor1TimelinePost1Id
      })) as Status
      // A status whose shape throws during Mastodon serialization (a Note
      // missing its tags/attachments arrays) must be dropped, not 500 the page.
      const brokenStatus = {
        id: `${ACTOR1_ID}/statuses/timeline-broken`,
        actorId: ACTOR1_ID,
        type: 'Note',
        reply: '',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      } as unknown as Status
      const spy = vi
        .spyOn(database, 'getTimeline')
        .mockResolvedValue([goodStatus, brokenStatus])

      // No `format=activities_next` → the Mastodon hydration path runs.
      const response = await GET(
        new NextRequest('https://llun.test/api/v1/timelines/main'),
        { params: Promise.resolve({ timeline: 'main' }) }
      )
      spy.mockRestore()

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.map((status: { id: string }) => status.id)).toEqual([
        urlToId(goodStatus.id)
      ])
    })
  })
})
