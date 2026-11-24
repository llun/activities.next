import { NextRequest } from 'next/server'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import {
  type BlueskyAgent,
  BlueskyRequestError,
  getBlueskyAgent
} from '@/lib/services/bluesky/agent'
import { getQueue } from '@/lib/services/queue'
import { storeBlueskyPost } from '@/lib/stub/blueskyPost'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
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

const unreblog = (statusId: string) =>
  POST(
    new NextRequest(
      `https://llun.test/api/v1/statuses/${urlToId(statusId)}/unreblog`,
      { method: 'POST', headers: { Origin: 'https://llun.test' } }
    ),
    { params: Promise.resolve({ id: urlToId(statusId) }) }
  )

describe('POST /api/v1/statuses/[id]/unreblog', () => {
  const { database, prepare } = createTestDatabase()

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
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  // The signed-in actor (actor1) boosts a status by actor2.
  const seedBoost = async (suffix: string, to: string[]) => {
    const originalId = `${ACTOR2_ID}/statuses/unreblog-original-${suffix}`
    await database.createNote({
      id: originalId,
      url: originalId,
      actorId: ACTOR2_ID,
      text: 'boost me',
      to,
      cc: []
    })
    const announceId = `${ACTOR1_ID}/statuses/unreblog-announce-${suffix}`
    await database.createAnnounce({
      id: announceId,
      actorId: ACTOR1_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      originalStatusId: originalId
    })
    return { originalId, announceId }
  }

  it('undoes the boost and returns the status', async () => {
    const { originalId, announceId } = await seedBoost('readable', [
      ACTIVITY_STREAM_PUBLIC
    ])

    const response = await unreblog(originalId)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).not.toEqual({ status: 'OK' })
    expect(body).toMatchObject({ id: expect.toBeString() })
    expect(await database.getStatus({ statusId: announceId })).toBeNull()
  })

  // The original was narrowed after the boost, so the serializer withholds
  // it. The undo itself succeeded and must be acknowledged, not reported as
  // a failure or answered with an empty body.
  it('acknowledges the undo when the boosted status is no longer readable', async () => {
    const { originalId, announceId } = await seedBoost('narrowed', [])

    const response = await unreblog(originalId)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'OK' })
    expect(await database.getStatus({ statusId: announceId })).toBeNull()
  })

  it('returns 404 when the actor has no boost of a status it cannot read', async () => {
    const originalId = `${ACTOR2_ID}/statuses/unreblog-never-boosted`
    await database.createNote({
      id: originalId,
      url: originalId,
      actorId: ACTOR2_ID,
      text: 'private',
      to: [],
      cc: []
    })

    const response = await unreblog(originalId)

    expect(response.status).toBe(404)
  })

  it.each(['original', 'announce'] as const)(
    'unreposts a Bluesky post via the Bluesky service by %s id without publishing SEND_UNDO_ANNOUNCE',
    async (lookupBy) => {
      const ownDid = 'did:plc:meaaaaaaaaaaaaaaaaaaaaaa'
      const { statusId: blueskyPostId } = await storeBlueskyPost(
        database,
        `unreblog${lookupBy}`
      )
      const announceId = `${ACTOR1_ID}/statuses/unreblog-bsky-${lookupBy}`
      await database.createAnnounce({
        id: announceId,
        actorId: ACTOR1_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: blueskyPostId
      })
      await database.createBlueskyInteraction({
        actorId: ACTOR1_ID,
        statusId: blueskyPostId,
        kind: 'repost',
        uri: `at://${ownDid}/app.bsky.feed.repost/3k${lookupBy}`
      })
      const post = vi.fn().mockResolvedValue({})
      const get = vi.fn().mockResolvedValue({ posts: [{ viewer: {} }] })
      vi.mocked(getBlueskyAgent).mockResolvedValue({
        did: ownDid,
        pdsUrl: 'https://pds.example.net/',
        get,
        post
      } as unknown as BlueskyAgent)

      const response = await unreblog(
        lookupBy === 'announce' ? announceId : blueskyPostId
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        uri: blueskyPostId,
        reblogged: false,
        reblogs_count: 0
      })
      expect(post).toHaveBeenCalledWith('com.atproto.repo.deleteRecord', {
        repo: ownDid,
        collection: 'app.bsky.feed.repost',
        rkey: `3k${lookupBy}`
      })
      expect(await database.getStatus({ statusId: announceId })).toBeNull()
      expect(
        await database.getBlueskyInteraction({
          actorId: ACTOR1_ID,
          statusId: blueskyPostId,
          kind: 'repost'
        })
      ).toBeNull()
      expect(getQueue().publish).not.toHaveBeenCalled()
    }
  )

  it('maps Bluesky errors to CORS { error } responses on unreblog', async () => {
    const ownDid = 'did:plc:meaaaaaaaaaaaaaaaaaaaaaa'
    const { statusId: blueskyPostId } = await storeBlueskyPost(
      database,
      'unreblogfail'
    )
    await database.createBlueskyInteraction({
      actorId: ACTOR1_ID,
      statusId: blueskyPostId,
      kind: 'repost',
      uri: `at://${ownDid}/app.bsky.feed.repost/3kfail`
    })
    vi.mocked(getBlueskyAgent).mockResolvedValue({
      did: ownDid,
      pdsUrl: 'https://pds.example.net/',
      get: vi.fn(),
      post: vi
        .fn()
        .mockRejectedValue(
          new BlueskyRequestError('com.atproto.repo.deleteRecord', 500)
        )
    } as unknown as BlueskyAgent)

    const response = await unreblog(blueskyPostId)

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: 'Bluesky did not accept the change. Please try again.'
    })
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('refuses unreblogging another actor’s Announce of a Bluesky post with 422', async () => {
    const { statusId: blueskyPostId } = await storeBlueskyPost(
      database,
      'unreblogother'
    )
    const otherAnnounceId = `${ACTOR2_ID}/statuses/unreblog-bsky-other`
    await database.createAnnounce({
      id: otherAnnounceId,
      actorId: ACTOR2_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      originalStatusId: blueskyPostId
    })

    const response = await unreblog(otherAnnounceId)

    expect(response.status).toBe(422)
    expect(
      await database.getStatus({ statusId: otherAnnounceId })
    ).not.toBeNull()
    expect(getQueue().publish).not.toHaveBeenCalled()
  })
})
