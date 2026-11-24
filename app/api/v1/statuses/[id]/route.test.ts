import { NextRequest } from 'next/server'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import {
  type BlueskyAgent,
  BlueskyRequestError,
  getBlueskyAgent
} from '@/lib/services/bluesky/agent'
import { BLUESKY_EDIT_REFUSED_MESSAGE } from '@/lib/services/bluesky/reply'
import { getQueue } from '@/lib/services/queue'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { statusPublicId } from '@/lib/stub/publicIds'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { seedActor3 } from '@/lib/stub/seed/actor3'
import { FollowStatus } from '@/lib/types/domain/follow'
import { urlToId } from '@/lib/utils/urlToId'

import { DELETE, GET, PUT } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', async () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: Database | null = null
vi.mock('@/lib/database', async () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', async () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', async () => ({
  verifyBearerToken: vi.fn()
}))

vi.mock('@/lib/services/bluesky/agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/bluesky/agent')>()),
  getBlueskyAgent: vi.fn().mockResolvedValue(null)
}))

vi.mock('@/lib/services/queue', async () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

// No `deleteStatus` here on purpose: status deletion federates through
// SendDeleteNoteJob now, so the request path never reaches the sender.
vi.mock('@/lib/activities', async () => ({
  sendLike: vi.fn().mockResolvedValue(undefined),
  sendUndoLike: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/services/medias', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/medias')>()),
  deleteMediaFile: vi.fn().mockResolvedValue(true)
}))

vi.mock('@/lib/config', async () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

/**
 * Tests for GET /api/v1/statuses/[id]
 *
 * This tests the underlying Mastodon status format returned by the API.
 * The actual API handler with authentication is tested separately.
 */
describe('GET /api/v1/statuses/[id]', () => {
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

  describe('status retrieval and format', () => {
    it('allows anonymous reads for public statuses', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const statusId = `${ACTOR1_ID}/statuses/post-1`
      const response = await GET(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toMatchObject({
        id: await statusPublicId(database, statusId),
        uri: statusId,
        visibility: 'public'
      })
    })

    it('returns not found for anonymous reads of followers-only statuses', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const statusId = `${ACTOR1_ID}/statuses/api-private-anonymous-read`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Private anonymous read target',
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })

      const response = await GET(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(404)
    })

    it('shows a Bluesky post to signed-in viewers only', async () => {
      const did = `did:plc:${'g'.repeat(24)}`
      const actorId = (await database.upsertBlueskyActor({
        did,
        handle: 'getstatus.bsky.social'
      })) as string
      const { statusId } = await database.upsertBlueskyPost({
        uri: `at://${did}/app.bsky.feed.post/one`,
        cid: 'cid-get',
        did,
        rkey: 'one',
        actorId,
        text: '<p>Stored Bluesky post</p>',
        createdAt: Date.now(),
        attachments: []
      })
      const get = () =>
        GET(
          new NextRequest(
            `https://llun.test/api/v1/statuses/${urlToId(statusId)}`
          ),
          { params: Promise.resolve({ id: urlToId(statusId) }) }
        )

      expect((await get()).status).toBe(200)
      mockGetServerSession.mockResolvedValue(null)
      expect((await get()).status).toBe(404)
    })

    it('allows the status owner to read followers-only statuses', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-private-owner-read`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Private owner read target',
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })

      const response = await GET(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.visibility).toBe('private')
    })

    it('allows accepted followers to read followers-only statuses', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor2.email }
      })

      await database.createFollow({
        actorId: ACTOR2_ID,
        targetActorId: ACTOR1_ID,
        inbox: `${ACTOR1_ID}/inbox`,
        sharedInbox: `https://${TEST_DOMAIN}/inbox`,
        status: FollowStatus.enum.Accepted
      })

      const statusId = `${ACTOR1_ID}/statuses/api-private-follower-read`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Private follower read target',
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })

      const response = await GET(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.visibility).toBe('private')
    })

    it('returns not found for authenticated non-followers reading followers-only statuses by id', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor3.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-private-non-follower-read`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Private non-follower read target',
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })

      const response = await GET(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(404)
    })

    it('returns not found for authenticated non-recipients of direct statuses', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor2.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-direct-non-recipient-read`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Direct non-recipient read target',
        to: ['https://llun.test/users/third-user'],
        cc: []
      })

      const response = await GET(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(404)
    })

    it('allows direct recipients to read direct statuses', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor2.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-direct-recipient-read`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Direct recipient read target',
        to: [ACTOR2_ID],
        cc: []
      })

      const response = await GET(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.visibility).toBe('direct')
    })
  })

  describe('Bluesky delete and edit', () => {
    const OWN_DID = `did:plc:${'d'.repeat(24)}`
    const OTHER_DID = `did:plc:${'e'.repeat(24)}`

    const storeBluesky = async (did: string, handle: string, rkey: string) => {
      const actorId = (await database.upsertBlueskyActor({
        did,
        handle
      })) as string
      const uri = `at://${did}/app.bsky.feed.post/${rkey}`
      const { statusId } = await database.upsertBlueskyPost({
        uri,
        cid: `cid-${rkey}`,
        did,
        rkey,
        actorId,
        text: `<p>Bluesky post ${rkey}</p>`,
        createdAt: Date.now(),
        attachments: []
      })
      return { statusId, uri }
    }

    afterEach(async () => {
      await database.deleteBlueskyAccount({ actorId: ACTOR1_ID })
    })

    it('deletes the viewer own Bluesky post on the PDS and locally without ActivityPub delivery', async () => {
      const { statusId } = await storeBluesky(
        OWN_DID,
        'own.bsky.social',
        '3kowndel1'
      )
      await database.saveBlueskyAccount({
        actorId: ACTOR1_ID,
        did: OWN_DID,
        handle: 'own.bsky.social',
        pdsUrl: 'https://pds.example.net/',
        authType: 'app_password',
        domainHandle: false
      })
      const post = vi.fn().mockResolvedValue({})
      vi.mocked(getBlueskyAgent).mockResolvedValueOnce({
        did: OWN_DID,
        pdsUrl: 'https://pds.example.net/',
        get: vi.fn(),
        post
      } as unknown as BlueskyAgent)

      const response = await DELETE(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          { method: 'DELETE', headers: { Origin: 'https://llun.test' } }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.uri).toBe(statusId)
      expect(post).toHaveBeenCalledWith('com.atproto.repo.deleteRecord', {
        repo: OWN_DID,
        collection: 'app.bsky.feed.post',
        rkey: '3kowndel1'
      })
      expect(await database.getStatus({ statusId })).toBeNull()
      expect(getQueue().publish).not.toHaveBeenCalled()
    })

    it('maps PDS failures on Bluesky delete to 502 and keeps the local row', async () => {
      const { statusId } = await storeBluesky(
        OWN_DID,
        'own.bsky.social',
        '3kowndel502'
      )
      await database.saveBlueskyAccount({
        actorId: ACTOR1_ID,
        did: OWN_DID,
        handle: 'own.bsky.social',
        pdsUrl: 'https://pds.example.net/',
        authType: 'app_password',
        domainHandle: false
      })
      vi.mocked(getBlueskyAgent).mockResolvedValueOnce({
        did: OWN_DID,
        pdsUrl: 'https://pds.example.net/',
        get: vi.fn(),
        post: vi
          .fn()
          .mockRejectedValue(
            new BlueskyRequestError('com.atproto.repo.deleteRecord', 503)
          )
      } as unknown as BlueskyAgent)

      const response = await DELETE(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          { method: 'DELETE', headers: { Origin: 'https://llun.test' } }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(502)
      expect(await database.getStatus({ statusId })).not.toBeNull()
    })

    it('returns 403 when deleting another user Bluesky post', async () => {
      const { statusId } = await storeBluesky(
        OTHER_DID,
        'other.bsky.social',
        '3kotherdel'
      )
      await database.saveBlueskyAccount({
        actorId: ACTOR1_ID,
        did: OWN_DID,
        handle: 'own.bsky.social',
        pdsUrl: 'https://pds.example.net/',
        authType: 'app_password',
        domainHandle: false
      })

      const response = await DELETE(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          { method: 'DELETE', headers: { Origin: 'https://llun.test' } }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(403)
      expect(await database.getStatus({ statusId })).not.toBeNull()
    })

    it('refuses editing a Bluesky post with 422', async () => {
      const { statusId } = await storeBluesky(
        OWN_DID,
        'own.bsky.social',
        '3keditbsky'
      )

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            },
            body: JSON.stringify({ status: 'Edited text' })
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(422)
      await expect(response.json()).resolves.toEqual({
        error: BLUESKY_EDIT_REFUSED_MESSAGE
      })
    })
  })
})
