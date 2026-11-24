import { NextRequest } from 'next/server'

import { sendUndoLike } from '@/lib/activities'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import {
  type BlueskyAgent,
  BlueskyRequestError,
  getBlueskyAgent
} from '@/lib/services/bluesky/agent'
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

const { mockSendUndoLike } = vi.hoisted(() => ({
  mockSendUndoLike: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/activities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/activities')>()
  return {
    ...actual,
    sendUndoLike: mockSendUndoLike
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
    secretPhase: 'secret phases'
  })
}))

const unfavourite = (statusId: string) =>
  POST(
    new NextRequest(
      `https://llun.test/api/v1/statuses/${urlToId(statusId)}/unfavourite`,
      { method: 'POST', headers: { Origin: 'https://llun.test' } }
    ),
    { params: Promise.resolve({ id: urlToId(statusId) }) }
  )

describe('POST /api/v1/statuses/[id]/unfavourite', () => {
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

  it('removes a fediverse like and federates Undo Like', async () => {
    const statusId = `${ACTOR2_ID}/statuses/unfavourite-fediverse`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR2_ID,
      text: 'unlike me',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.createLike({ actorId: ACTOR1_ID, statusId })

    const response = await unfavourite(statusId)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      favourited: false,
      favourites_count: 0
    })
    expect(sendUndoLike).toHaveBeenCalledTimes(1)
  })

  it('unlikes a Bluesky post via the Bluesky service without calling sendUndoLike', async () => {
    const ownDid = 'did:plc:meaaaaaaaaaaaaaaaaaaaaaa'
    const { statusId } = await storeBlueskyPost(database, 'unfavourite')
    await database.createBlueskyInteraction({
      actorId: ACTOR1_ID,
      statusId,
      kind: 'like',
      uri: `at://${ownDid}/app.bsky.feed.like/3klike`
    })
    await database.createLike({ actorId: ACTOR1_ID, statusId })
    const post = vi.fn().mockResolvedValue({})
    const get = vi.fn().mockResolvedValue({ posts: [{ viewer: {} }] })
    vi.mocked(getBlueskyAgent).mockResolvedValue({
      did: ownDid,
      pdsUrl: 'https://pds.example.net/',
      get,
      post
    } as unknown as BlueskyAgent)

    const response = await unfavourite(statusId)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      favourited: false,
      favourites_count: 0
    })
    expect(post).toHaveBeenCalledWith('com.atproto.repo.deleteRecord', {
      repo: ownDid,
      collection: 'app.bsky.feed.like',
      rkey: '3klike'
    })
    expect(sendUndoLike).not.toHaveBeenCalled()
    await expect(
      database.getBlueskyInteraction({
        actorId: ACTOR1_ID,
        statusId,
        kind: 'like'
      })
    ).resolves.toBeNull()
  })

  it('maps Bluesky service failures to CORS { error } responses on unfavourite', async () => {
    const ownDid = 'did:plc:meaaaaaaaaaaaaaaaaaaaaaa'
    const { statusId } = await storeBlueskyPost(database, 'unfavfail')
    await database.createBlueskyInteraction({
      actorId: ACTOR1_ID,
      statusId,
      kind: 'like',
      uri: `at://${ownDid}/app.bsky.feed.like/3kfail`
    })
    await database.createLike({ actorId: ACTOR1_ID, statusId })
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

    const response = await unfavourite(statusId)

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: 'Bluesky did not accept the change. Please try again.'
    })
    expect(sendUndoLike).not.toHaveBeenCalled()
  })
})
