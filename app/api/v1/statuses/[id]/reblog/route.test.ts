import { NextRequest } from 'next/server'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import {
  type BlueskyAgent,
  getBlueskyAgent
} from '@/lib/services/bluesky/agent'
import { getQueue } from '@/lib/services/queue'
import { storeBlueskyPost } from '@/lib/stub/blueskyPost'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getStatusVisibility } from '@/lib/utils/getVisibility'
import { urlToId } from '@/lib/utils/urlToId'

import { POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: Database | null = null
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

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

const { mockGetNote } = vi.hoisted(() => ({
  mockGetNote: vi.fn()
}))

vi.mock('@/lib/activities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/activities')>()
  return {
    ...actual,
    getNote: mockGetNote
  }
})

vi.mock('@/lib/services/bluesky/agent', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getBlueskyAgent: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const reblog = (statusId: string, body: Record<string, unknown> = {}) =>
  POST(
    new NextRequest(
      `https://llun.test/api/v1/statuses/${urlToId(statusId)}/reblog`,
      {
        method: 'POST',
        headers: {
          Origin: 'https://llun.test',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    ),
    { params: Promise.resolve({ id: urlToId(statusId) }) }
  )

describe('POST /api/v1/statuses/[id]/reblog', () => {
  const { database, prepare } = createTestDatabase()
  const remoteActorId = EXTERNAL_ACTOR1
  const remoteStatusId = `${remoteActorId}/statuses/reblog-remote-public-1`

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    if (!database) return
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getBlueskyAgent).mockReset()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    // llun.dev is the one fixture domain that answers on the real internet:
    // it served HTTP 404 for the fixture actor's document. Serve the same 404
    // at the fetch boundary so the refresh path fails the same way without a
    // connection.
    fetchMock.resetMocks()
    fetchMock.doMock()
    fetchMock.mockResponse(async () => ({ status: 404, body: 'Not Found' }))
  })

  afterEach(() => {
    fetchMock.resetMocks()
    fetchMock.dontMock()
  })

  it('unstored remote public status → fetched, stored, 200', async () => {
    mockGetNote.mockResolvedValueOnce({
      id: remoteStatusId,
      type: 'Note',
      attributedTo: remoteActorId,
      content: 'hello boostable world',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      published: '2026-04-26T10:00:00Z'
    })

    const response = await reblog(remoteStatusId)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      reblog: expect.objectContaining({
        uri: remoteStatusId
      })
    })
    const stored = await database.getStatus({ statusId: remoteStatusId })
    expect(stored?.type).toBe(StatusType.enum.Note)
    if (stored?.type === StatusType.enum.Note) {
      expect(stored.text).toBe('hello boostable world')
    }
  })

  it('reposts a Bluesky post via the Bluesky service with a local-only boost and no federation job', async () => {
    const ownDid = 'did:plc:meaaaaaaaaaaaaaaaaaaaaaa'
    const { statusId } = await storeBlueskyPost(database, 'reblog')
    await database.saveBlueskyAccount({
      actorId: ACTOR1_ID,
      did: ownDid,
      handle: 'me.bsky.social',
      pdsUrl: 'https://pds.example.net/',
      authType: 'app_password',
      domainHandle: false
    })
    const post = vi.fn().mockResolvedValue({
      uri: `at://${ownDid}/app.bsky.feed.repost/3kreblog`
    })
    const get = vi.fn().mockResolvedValue({ posts: [{ viewer: {} }] })
    vi.mocked(getBlueskyAgent).mockResolvedValue({
      did: ownDid,
      pdsUrl: 'https://pds.example.net/',
      get,
      post
    } as unknown as BlueskyAgent)

    const response = await reblog(statusId)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      reblog: expect.objectContaining({
        uri: statusId,
        reblogged: true,
        reblogs_count: 1
      })
    })
    expect(
      await database.getActorAnnounceStatus({
        statusId,
        actorId: ACTOR1_ID
      })
    ).not.toBeNull()
    expect(post).toHaveBeenCalledWith(
      'com.atproto.repo.createRecord',
      expect.objectContaining({ collection: 'app.bsky.feed.repost' })
    )
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('refuses reposting a Bluesky post with visibility private with 422', async () => {
    const { statusId } = await storeBlueskyPost(database, 'reblogprivate')

    const response = await reblog(statusId, { visibility: 'private' })

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Bluesky reposts are public: Bluesky has no followers-only posts.'
    })
    expect(getBlueskyAgent).not.toHaveBeenCalled()
    expect(
      await database.getActorAnnounceStatus({
        statusId,
        actorId: ACTOR1_ID
      })
    ).toBeNull()
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('passes unlisted visibility through to the local-only Bluesky boost', async () => {
    const ownDid = 'did:plc:meaaaaaaaaaaaaaaaaaaaaaa'
    const { statusId } = await storeBlueskyPost(database, 'reblogunlisted')
    await database.saveBlueskyAccount({
      actorId: ACTOR1_ID,
      did: ownDid,
      handle: 'me.bsky.social',
      pdsUrl: 'https://pds.example.net/',
      authType: 'app_password',
      domainHandle: false
    })
    const post = vi.fn().mockResolvedValue({
      uri: `at://${ownDid}/app.bsky.feed.repost/3kunlisted`
    })
    const get = vi.fn().mockResolvedValue({ posts: [{ viewer: {} }] })
    vi.mocked(getBlueskyAgent).mockResolvedValue({
      did: ownDid,
      pdsUrl: 'https://pds.example.net/',
      get,
      post
    } as unknown as BlueskyAgent)

    const response = await reblog(statusId, { visibility: 'unlisted' })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      reblog: expect.objectContaining({
        uri: statusId,
        reblogged: true
      })
    })
    const localAnnounce = await database.getActorAnnounceStatus({
      statusId,
      actorId: ACTOR1_ID
    })
    expect(localAnnounce).not.toBeNull()
    expect(getStatusVisibility(localAnnounce!)).toBe('unlisted')
    expect(localAnnounce?.to).not.toContain(ACTIVITY_STREAM_PUBLIC)
    expect(localAnnounce?.cc).toContain(ACTIVITY_STREAM_PUBLIC)
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('returns 422 when reposting a Bluesky post without a linked account', async () => {
    const { statusId } = await storeBlueskyPost(database, 'reblogunlinked')
    vi.mocked(getBlueskyAgent).mockResolvedValueOnce(null)

    const response = await reblog(statusId)

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error:
        'Link a Bluesky account in Settings › Other networks to interact with Bluesky posts.'
    })
    expect(
      await database.getActorAnnounceStatus({
        statusId,
        actorId: ACTOR1_ID
      })
    ).toBeNull()
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('a local-domain id → 404, nothing stored, no fetch', async () => {
    const localStatusId =
      'https://llun.test/users/test2/statuses/local-missing-reblog'
    const response = await reblog(localStatusId)

    expect(response.status).toBe(404)
    expect(mockGetNote).not.toHaveBeenCalled()
    const stored = await database.getStatus({ statusId: localStatusId })
    expect(stored).toBeNull()
  })

  it('a non-public note → 404, nothing stored', async () => {
    const nonPublicId = `${remoteActorId}/statuses/reblog-remote-private-1`
    mockGetNote.mockResolvedValueOnce({
      id: nonPublicId,
      type: 'Note',
      attributedTo: remoteActorId,
      content: 'followers only',
      to: [`${remoteActorId}/followers`],
      cc: [],
      published: '2026-04-26T10:00:00Z'
    })

    const response = await reblog(nonPublicId)

    expect(response.status).toBe(404)
    const stored = await database.getStatus({ statusId: nonPublicId })
    expect(stored).toBeNull()
  })

  it('an origin-mismatched note → 404, nothing stored', async () => {
    const mismatchedId = `${remoteActorId}/statuses/reblog-remote-mismatched-1`
    mockGetNote.mockResolvedValueOnce({
      id: 'https://evil.test/users/bob/statuses/reblog-remote-mismatched-1',
      type: 'Note',
      attributedTo: remoteActorId,
      content: 'forged reblog target',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      published: '2026-04-26T10:00:00Z'
    })

    const response = await reblog(mismatchedId)

    expect(response.status).toBe(404)
    const stored = await database.getStatus({ statusId: mismatchedId })
    expect(stored).toBeNull()
  })

  it('an existing row the viewer cannot read → 404 and no fetch', async () => {
    // A remote actor the signed-in actor1 does not follow, so the seeded
    // followers-only row is genuinely unreadable to the viewer.
    const unfollowedActorId = 'https://llun.dev/users/unfollowed'
    await database.createActor({
      actorId: unfollowedActorId,
      username: 'unfollowed',
      domain: 'llun.dev',
      publicKey: 'publicKey-unfollowed',
      inboxUrl: `${unfollowedActorId}/inbox`,
      sharedInboxUrl: 'https://llun.dev/inbox',
      followersUrl: `${unfollowedActorId}/followers`,
      createdAt: Date.now()
    })
    const unreadableId = `${unfollowedActorId}/statuses/unreadable-reblog-existing-1`
    await database.createNote({
      id: unreadableId,
      url: unreadableId,
      actorId: unfollowedActorId,
      text: 'private note',
      to: [`${unfollowedActorId}/followers`],
      cc: []
    })

    const response = await reblog(unreadableId)

    expect(response.status).toBe(404)
    expect(mockGetNote).not.toHaveBeenCalled()
  })
})
