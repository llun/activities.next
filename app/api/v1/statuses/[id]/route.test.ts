import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { statusPublicId } from '@/lib/stub/publicIds'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { seedActor3 } from '@/lib/stub/seed/actor3'
import { FollowStatus } from '@/lib/types/domain/follow'
import { urlToId } from '@/lib/utils/urlToId'

import { GET } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', async () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
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
  const database = getTestSQLDatabase()

  beforeAll(async () => {
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

    it('returns the same body for a publicId-form id as for the colon-form id', async () => {
      const statusId = `${ACTOR1_ID}/statuses/post-1`
      const status = await database.getStatus({ statusId })
      if (!status?.publicId) {
        throw new Error('seeded status is missing a publicId')
      }

      const colonFormResponse = await GET(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )
      const publicIdResponse = await GET(
        new NextRequest(`https://llun.test/api/v1/statuses/${status.publicId}`),
        { params: Promise.resolve({ id: status.publicId }) }
      )

      expect(publicIdResponse.status).toBe(200)
      expect(await publicIdResponse.json()).toEqual(
        await colonFormResponse.json()
      )
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
})
