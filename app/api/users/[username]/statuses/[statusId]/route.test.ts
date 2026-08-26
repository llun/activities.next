import { NextRequest } from 'next/server'

import { resolveStatusFromPath } from '@/app/(timeline)/[actor]/[status]/resolveStatusFromPath'
import { QUOTE_ACTIVITY_CONTEXT } from '@/lib/activities/quoteContext'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { type Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { generatePublicId } from '@/lib/utils/publicId'

import { GET } from './route'

const mockDatabase = {
  getActorStatusFromPathSegment: vi.fn(),
  getStatusReplies: vi.fn()
}
const mockActor: Actor = {
  id: 'https://example.com/users/test',
  username: 'test',
  domain: 'example.com',
  name: 'Test Actor',
  summary: '',
  followersUrl: 'https://example.com/users/test/followers',
  inboxUrl: 'https://example.com/users/test/inbox',
  sharedInboxUrl: 'https://example.com/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 1,
  updatedAt: 1,
  publicKey: 'public-key'
}
const mockToActivityPubObject = vi.fn()

// OnlyLocalUserGuard is mocked, so the database and actor the route runs
// against are injected from here. The redirect round-trip suite at the bottom
// swaps in a real SQLite database and the actor that owns the seeded statuses.
let routeDatabase: unknown = mockDatabase
let routeActor: Actor = mockActor

vi.mock('@/lib/services/guards/OnlyLocalUserGuard', async () => ({
  OnlyLocalUserGuard:
    (handle: (...params: unknown[]) => Promise<Response> | Response) =>
    (req: NextRequest, query: unknown) =>
      handle(routeDatabase, routeActor, req, query)
}))

vi.mock('@/lib/types/domain/status', async () => {
  const actual = await vi.importActual('@/lib/types/domain/status')
  return {
    ...actual,
    toActivityPubObject: (...params: unknown[]) =>
      mockToActivityPubObject(...params)
  }
})

const createRequest = (accept: string) =>
  new NextRequest('https://example.com/api/users/test/statuses/123', {
    headers: { accept }
  })

// The web detail page for a local status is keyed by the sha256 of its `url`,
// which is what getStatusDetailPath emits and what `statuses.urlHash` stores.
const webDetailUrl = (mention: string, statusUrl: string) =>
  `https://example.com/${mention}/${getHashFromString(statusUrl)}`

describe('GET /api/users/[username]/statuses/[statusId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getActorStatusFromPathSegment.mockResolvedValue({
      id: 'https://example.com/users/test/statuses/123',
      // A local status stores the web detail page as its url, not its AP URI.
      url: 'https://example.com/@test/123',
      type: 'Note',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      isLocalActor: true,
      actor: { username: 'test', domain: 'example.com' }
    })
    mockDatabase.getStatusReplies.mockResolvedValue([])
    mockToActivityPubObject.mockReturnValue({
      id: 'https://example.com/users/test/statuses/123',
      type: 'Note',
      attributedTo: 'https://example.com/users/test'
    })
  })

  it('returns generic JSON when that is the negotiated ActivityPub type', async () => {
    const response = await GET(
      createRequest('application/json, text/html;q=0.5'),
      { params: Promise.resolve({ username: 'test', statusId: '123' }) }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(mockDatabase.getActorStatusFromPathSegment).toHaveBeenCalledWith({
      actorId: mockActor.id,
      pathSegment: '123',
      withReplies: false
    })

    const data = await response.json()
    expect(data).toMatchObject({
      // QUOTE_ACTIVITY_CONTEXT, not the bare AS2 url: the note carries FEP-044f
      // terms, and a receiver that compacts drops any term the document's own
      // context never defined.
      '@context': QUOTE_ACTIVITY_CONTEXT,
      id: 'https://example.com/users/test/statuses/123',
      type: 'Note'
    })
  })

  it('redirects to the status page when HTML is preferred', async () => {
    const response = await GET(createRequest('text/html, */*;q=0.8'), {
      params: Promise.resolve({ username: 'test', statusId: '123' })
    })

    expect(response.status).toBe(302)
    // The full `@user@domain` handle, never the single-@ form `status.url`
    // carries — the web page splits the actor segment on `@` and needs both
    // halves.
    expect(response.headers.get('location')).toBe(
      webDetailUrl('@test@example.com', 'https://example.com/@test/123')
    )
    expect(response.headers.get('server')).toBe('activities.next')
    expect(response.headers.get('vary')).toBe('Accept')
  })

  it('redirects an announce to the boosted status page', async () => {
    const announceUri = 'https://example.com/users/test/statuses/announce-tail'
    const originalUrl = 'https://example.com/@other/original'
    mockDatabase.getActorStatusFromPathSegment.mockResolvedValue({
      id: announceUri,
      url: null,
      type: 'Announce',
      actorId: mockActor.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      isLocalActor: true,
      actor: { username: 'test', domain: 'example.com' },
      originalStatus: {
        id: 'https://example.com/users/other/statuses/original',
        url: originalUrl,
        type: 'Note',
        actorId: 'https://example.com/users/other',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        isLocalActor: true,
        actor: { username: 'other', domain: 'example.com' }
      }
    })
    mockToActivityPubObject.mockReturnValue({
      id: `${announceUri}/activity`,
      type: 'Announce'
    })

    const response = await GET(createRequest('text/html, */*;q=0.8'), {
      params: Promise.resolve({ username: 'test', statusId: 'announce-tail' })
    })

    expect(response.status).toBe(302)
    // An announce stores no url of its own, and this route already serves the
    // BOOSTED note as its ActivityPub body — so the HTML twin is that note's
    // page, exactly where the web UI's own boost link goes.
    expect(response.headers.get('location')).toBe(
      webDetailUrl('@other@example.com', originalUrl)
    )
  })

  it('falls back to the status uri when the status carries no actor profile', async () => {
    const statusUri = 'https://example.com/users/test/statuses/123'
    mockDatabase.getActorStatusFromPathSegment.mockResolvedValue({
      id: statusUri,
      url: 'https://example.com/@test/123',
      type: 'Note',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      isLocalActor: true,
      actor: null
    })

    const response = await GET(createRequest('text/html, */*;q=0.8'), {
      params: Promise.resolve({ username: 'test', statusId: '123' })
    })

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      `https://example.com/@test@example.com/${encodeURIComponent(statusUri)}`
    )
  })

  it('returns not found for a non-public ActivityPub object request', async () => {
    mockDatabase.getActorStatusFromPathSegment.mockResolvedValue({
      id: 'https://example.com/users/test/statuses/123',
      url: 'https://example.com/users/test/statuses/123',
      type: 'Note',
      to: ['https://example.com/users/test/followers'],
      cc: [],
      actor: { username: 'test', domain: 'example.com' }
    })

    const response = await GET(createRequest('application/activity+json'), {
      params: Promise.resolve({ username: 'test', statusId: '123' })
    })

    expect(response.status).toBe(404)
    expect(mockDatabase.getStatusReplies).not.toHaveBeenCalled()
    expect(mockToActivityPubObject).not.toHaveBeenCalled()
  })

  it('filters non-public replies from public ActivityPub object responses', async () => {
    const publicReply = {
      id: 'https://example.com/users/other/statuses/public-reply',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    }
    const privateReply = {
      id: 'https://example.com/users/other/statuses/private-reply',
      to: ['https://example.com/users/other/followers'],
      cc: []
    }
    mockDatabase.getStatusReplies.mockResolvedValue([publicReply, privateReply])

    await GET(createRequest('application/activity+json'), {
      params: Promise.resolve({ username: 'test', statusId: '123' })
    })

    expect(mockDatabase.getStatusReplies).toHaveBeenCalledWith({
      statusId: 'https://example.com/users/test/statuses/123',
      url: 'https://example.com/@test/123',
      publicOnly: true,
      limit: 100
    })
    expect(mockToActivityPubObject).toHaveBeenCalledWith(
      expect.objectContaining({
        replies: [publicReply]
      })
    )
  })

  describe('publicId path segment', () => {
    // The route hands the raw path segment to the database, which resolves it
    // as either a status URI tail or a publicId and scopes it to this actor.
    const legacyUri = 'https://example.com/users/test/statuses/legacy-tail'

    it('serves the status the database resolved from a publicId segment', async () => {
      const publicId = generatePublicId()
      mockDatabase.getActorStatusFromPathSegment.mockResolvedValue({
        id: legacyUri,
        url: legacyUri,
        actorId: mockActor.id,
        type: 'Note',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        isLocalActor: true,
        actor: { username: 'test', domain: 'example.com' }
      })
      mockToActivityPubObject.mockReturnValue({
        id: legacyUri,
        type: 'Note',
        attributedTo: mockActor.id
      })

      const response = await GET(createRequest('application/activity+json'), {
        params: Promise.resolve({ username: 'test', statusId: publicId })
      })

      expect(response.status).toBe(200)
      expect(mockDatabase.getActorStatusFromPathSegment).toHaveBeenCalledWith({
        actorId: mockActor.id,
        pathSegment: publicId,
        withReplies: false
      })

      const data = await response.json()
      expect(data.id).toBe(legacyUri)
    })

    it('redirects an HTML request to the web detail page, not the publicId path', async () => {
      const publicId = generatePublicId()
      const legacyWebUrl = 'https://example.com/@test/legacy-tail'
      mockDatabase.getActorStatusFromPathSegment.mockResolvedValue({
        id: legacyUri,
        url: legacyWebUrl,
        actorId: mockActor.id,
        type: 'Note',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        isLocalActor: true,
        actor: { username: 'test', domain: 'example.com' }
      })
      mockToActivityPubObject.mockReturnValue({
        id: legacyUri,
        type: 'Note',
        attributedTo: mockActor.id
      })

      const response = await GET(createRequest('text/html, */*;q=0.8'), {
        params: Promise.resolve({ username: 'test', statusId: publicId })
      })

      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe(
        webDetailUrl('@test@example.com', legacyWebUrl)
      )
      expect(response.headers.get('location')).not.toContain(publicId)
    })

    it('returns not found when the database resolves the segment to nothing', async () => {
      const publicId = generatePublicId()
      mockDatabase.getActorStatusFromPathSegment.mockResolvedValue(null)

      const response = await GET(createRequest('application/activity+json'), {
        params: Promise.resolve({ username: 'test', statusId: publicId })
      })

      expect(response.status).toBe(404)
      expect(mockToActivityPubObject).not.toHaveBeenCalled()
    })

    it('returns not found for a non-public status resolved from a publicId segment', async () => {
      const publicId = generatePublicId()
      mockDatabase.getActorStatusFromPathSegment.mockResolvedValue({
        id: legacyUri,
        url: legacyUri,
        actorId: mockActor.id,
        type: 'Note',
        to: ['https://example.com/users/test/followers'],
        cc: [],
        actor: { username: 'test', domain: 'example.com' }
      })

      const response = await GET(createRequest('application/activity+json'), {
        params: Promise.resolve({ username: 'test', statusId: publicId })
      })

      expect(response.status).toBe(404)
      expect(mockToActivityPubObject).not.toHaveBeenCalled()
    })
  })

  // The redirect only does its job if the URL it emits is one the web status
  // page can actually resolve, so follow it there for real: run the route
  // against a live database, then feed the Location's own path segments to the
  // page's resolver and check it finds the same status back.
  describe('html redirect resolves through the web status page', () => {
    const database = getTestSQLDatabase()
    const legacyUri = `${ACTOR1_ID}/statuses/legacy-tail`
    // Strava fallback notes take a deterministic sha256 as their URI tail, so
    // the tail itself looks exactly like a web-page url hash.
    const stravaUri = `${ACTOR1_ID}/statuses/${getHashFromString('strava-activity-1')}`
    const announceUri = `${ACTOR1_ID}/statuses/announce-tail`
    const publicIds = new Map<string, string>()

    const seedNote = async (id: string) => {
      const status = await database.createNote({
        id,
        url: `https://llun.test/@test1/${id.slice(id.lastIndexOf('/') + 1)}`,
        actorId: ACTOR1_ID,
        text: 'round trip',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      return status
    }

    beforeAll(async () => {
      await database.migrate()
      await seedDatabase(database)

      await seedNote(legacyUri)
      await seedNote(stravaUri)
      await database.createAnnounce({
        id: announceUri,
        actorId: ACTOR1_ID,
        originalStatusId: legacyUri,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const stored = await database.getStatusPublicIds({
        statusIds: [legacyUri, stravaUri, announceUri]
      })
      for (const [statusId, publicId] of stored) {
        publicIds.set(statusId, publicId)
      }
      if (publicIds.size !== 3) {
        throw new Error('seeded statuses are missing a publicId')
      }

      const actor = await database.getActorFromId({ id: ACTOR1_ID })
      if (!actor) throw new Error('seeded actor1 is missing')
      routeDatabase = database
      routeActor = actor
    })

    afterAll(async () => {
      routeDatabase = mockDatabase
      routeActor = mockActor
      await database.destroy()
    })

    beforeEach(() => {
      // The outer suite clears mocks; toActivityPubObject only has to be
      // truthy for the route to reach its redirect.
      mockToActivityPubObject.mockReturnValue({ id: legacyUri, type: 'Note' })
    })

    const followRedirect = async (location: string | null) => {
      expect(location).not.toBeNull()
      const { pathname } = new URL(location as string)
      const [actorParam, statusParam] = pathname.slice(1).split('/')
      return resolveStatusFromPath({
        database,
        actorParam,
        statusParam
      })
    }

    it.each([
      {
        description: 'a legacy uri tail requested by its own tail',
        statusUri: () => legacyUri,
        segment: () => 'legacy-tail',
        expectedUri: () => legacyUri
      },
      {
        description: 'a legacy uri tail requested by publicId',
        statusUri: () => legacyUri,
        segment: () => publicIds.get(legacyUri) as string,
        expectedUri: () => legacyUri
      },
      {
        description: 'a 64-hex strava tail requested by publicId',
        statusUri: () => stravaUri,
        segment: () => publicIds.get(stravaUri) as string,
        expectedUri: () => stravaUri
      },
      {
        description: 'an announce requested by publicId',
        statusUri: () => announceUri,
        segment: () => publicIds.get(announceUri) as string,
        // An announce redirects to the status it boosted.
        expectedUri: () => legacyUri
      }
    ])(
      'resolves the redirect for $description',
      async ({ segment, expectedUri }) => {
        const response = await GET(createRequest('text/html, */*;q=0.8'), {
          params: Promise.resolve({ username: 'test1', statusId: segment() })
        })

        expect(response.status).toBe(302)
        const location = response.headers.get('location')
        // The Location is built from the resolved status, never echoed from the
        // requested segment: it always carries the publicId of the status the
        // reader lands on (for an announce, the status it boosted).
        expect(new URL(location as string).pathname).toBe(
          `/@test1@llun.test/${publicIds.get(expectedUri())}`
        )

        const resolved = await followRedirect(location)
        expect(resolved?.status?.id).toBe(expectedUri())
      }
    )
  })
})
