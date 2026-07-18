import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_QUOTE_REVOKE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
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

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyAccessToken: vi.fn()
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const REMOTE_QUOTER_ID = 'https://remote.example/users/quoter'

const revokeRequest = (encodedQuotedId: string, encodedQuotingId: string) =>
  new NextRequest(
    `https://llun.test/api/v1/statuses/${encodedQuotedId}/quotes/${encodedQuotingId}/revoke`,
    { method: 'POST', headers: { Origin: 'https://llun.test' } }
  )

describe('POST /api/v1/statuses/[id]/quotes/[quoting_status_id]/revoke', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    await database.createActor({
      actorId: REMOTE_QUOTER_ID,
      username: 'quoter',
      domain: 'remote.example',
      followersUrl: `${REMOTE_QUOTER_ID}/followers`,
      inboxUrl: `${REMOTE_QUOTER_ID}/inbox`,
      sharedInboxUrl: 'https://remote.example/inbox',
      publicKey: 'public-key',
      createdAt: Date.now()
    })
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

  const seedAcceptedQuote = async (
    suffix: string,
    quoterId: string,
    authorizationUri: string | null
  ) => {
    const quotedId = `${ACTOR1_ID}/statuses/revoke-quoted-${suffix}`
    await database.createNote({
      id: quotedId,
      url: quotedId,
      actorId: ACTOR1_ID,
      text: 'quote me',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    const quotingId = `${quoterId}/statuses/revoke-quoting-${suffix}`
    await database.createNote({
      id: quotingId,
      url: quotingId,
      actorId: quoterId,
      text: 'quoting you',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.createStatusQuote({
      statusId: quotingId,
      quotedStatusId: quotedId,
      state: 'accepted',
      authorizationUri
    })
    return { quotedId, quotingId }
  }

  it('revokes an accepted quote and federates a stamp Delete to the quoting author', async () => {
    const stampUri = `${ACTOR1_ID}/quote_authorizations/revoke-1`
    const { quotedId, quotingId } = await seedAcceptedQuote(
      'federated',
      REMOTE_QUOTER_ID,
      stampUri
    )

    const response = await POST(
      revokeRequest(urlToId(quotedId), urlToId(quotingId)),
      {
        params: Promise.resolve({
          id: urlToId(quotedId),
          quoting_status_id: urlToId(quotingId)
        })
      }
    )

    expect(response.status).toBe(200)
    const status = await response.json()
    expect(status.quote.state).toBe('revoked')
    expect(getQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: SEND_QUOTE_REVOKE_JOB_NAME,
        data: expect.objectContaining({
          actorId: ACTOR1_ID,
          quotingActorId: REMOTE_QUOTER_ID,
          quotingStatusId: quotingId,
          stampId: stampUri
        })
      })
    )
    const edge = await database.getStatusQuote({ statusId: quotingId })
    expect(edge?.state).toBe('revoked')
  })

  it('is idempotent for an already-revoked quote', async () => {
    const { quotedId, quotingId } = await seedAcceptedQuote(
      'idempotent',
      REMOTE_QUOTER_ID,
      `${ACTOR1_ID}/quote_authorizations/revoke-2`
    )
    await database.updateStatusQuoteState({
      statusId: quotingId,
      state: 'revoked'
    })

    const response = await POST(
      revokeRequest(urlToId(quotedId), urlToId(quotingId)),
      {
        params: Promise.resolve({
          id: urlToId(quotedId),
          quoting_status_id: urlToId(quotingId)
        })
      }
    )

    expect(response.status).toBe(200)
    const status = await response.json()
    expect(status.quote.state).toBe('revoked')
  })

  it('does not federate when the accepted quote has no hosted stamp', async () => {
    const { quotedId, quotingId } = await seedAcceptedQuote(
      'no-stamp',
      ACTOR2_ID,
      null
    )

    const response = await POST(
      revokeRequest(urlToId(quotedId), urlToId(quotingId)),
      {
        params: Promise.resolve({
          id: urlToId(quotedId),
          quoting_status_id: urlToId(quotingId)
        })
      }
    )

    expect(response.status).toBe(200)
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller does not own the quoted status', async () => {
    const quotedId = `${ACTOR2_ID}/statuses/revoke-not-mine`
    await database.createNote({
      id: quotedId,
      url: quotedId,
      actorId: ACTOR2_ID,
      text: 'not my post',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    const quotingId = `${REMOTE_QUOTER_ID}/statuses/revoke-not-mine-quoting`
    await database.createNote({
      id: quotingId,
      url: quotingId,
      actorId: REMOTE_QUOTER_ID,
      text: 'quoting',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.createStatusQuote({
      statusId: quotingId,
      quotedStatusId: quotedId,
      state: 'accepted'
    })

    const response = await POST(
      revokeRequest(urlToId(quotedId), urlToId(quotingId)),
      {
        params: Promise.resolve({
          id: urlToId(quotedId),
          quoting_status_id: urlToId(quotingId)
        })
      }
    )

    expect(response.status).toBe(403)
  })

  it('returns 404 when no quote edge links the two statuses', async () => {
    const quotedId = `${ACTOR1_ID}/statuses/revoke-no-edge`
    await database.createNote({
      id: quotedId,
      url: quotedId,
      actorId: ACTOR1_ID,
      text: 'my post',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    const response = await POST(
      revokeRequest(
        urlToId(quotedId),
        urlToId(`${REMOTE_QUOTER_ID}/statuses/x`)
      ),
      {
        params: Promise.resolve({
          id: urlToId(quotedId),
          quoting_status_id: urlToId(`${REMOTE_QUOTER_ID}/statuses/x`)
        })
      }
    )

    expect(response.status).toBe(404)
  })
})
