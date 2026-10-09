import knex, { Knex } from 'knex'
import { NextRequest } from 'next/server'

import { getSQLDatabase } from '@/lib/database/sql'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { StatusNote, StatusType } from '@/lib/types/domain/status'
import { urlToId } from '@/lib/utils/urlToId'

import { POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getSQLDatabase> | null = null
let mockKnex: Knex | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => mockKnex
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

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('POST /api/v1/statuses', () => {
  const knexInstance = knex({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: { filename: ':memory:' }
  })
  const database = getSQLDatabase(knexInstance)

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
    mockKnex = knexInstance
  })

  afterAll(async () => {
    mockDatabase = null
    mockKnex = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  it('creates a status quoting the authors own public status', async () => {
    const quoted = await database.createNote({
      id: `${ACTOR1_ID}/statuses/route-quote-self`,
      url: `${ACTOR1_ID}/statuses/route-quote-self`,
      actorId: ACTOR1_ID,
      text: 'quoted target',
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: []
    })

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: 'quoting my own post',
          quoted_status_id: urlToId(quoted.id)
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const mastodonStatus = await response.json()
    expect(mastodonStatus.quote?.state).toBe('accepted')
    expect(mastodonStatus.quote?.quoted_status?.id).toBe(quoted.publicId)
  })

  it('creates a status quoting another status via a publicId quoted_status_id', async () => {
    const quoted = await database.createNote({
      id: `${ACTOR1_ID}/statuses/route-quote-publicid`,
      url: `${ACTOR1_ID}/statuses/route-quote-publicid`,
      actorId: ACTOR1_ID,
      text: 'quoted via publicId',
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: []
    })
    if (!quoted.publicId) {
      throw new Error('seeded quoted status is missing a publicId')
    }

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: 'quoting by publicId',
          quoted_status_id: quoted.publicId
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const mastodonStatus = await response.json()
    expect(mastodonStatus.quote?.state).toBe('accepted')
    expect(mastodonStatus.quote?.quoted_status?.id).toBe(quoted.publicId)
  })

  it('rejects a quote the policy denies with 422', async () => {
    const quoted = await database.createNote({
      id: `${ACTOR2_ID}/statuses/route-quote-nobody`,
      url: `${ACTOR2_ID}/statuses/route-quote-nobody`,
      actorId: ACTOR2_ID,
      text: 'no quoting allowed',
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      quoteApprovalPolicy: 'nobody'
    })

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: 'quoting a nobody-policy post',
          quoted_status_id: urlToId(quoted.id)
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(422)
  })

  it('404s when the quoted status does not exist', async () => {
    const response = await POST(
      new NextRequest('https://llun.test/api/v1/statuses', {
        method: 'POST',
        body: JSON.stringify({
          status: 'quoting nothing',
          quoted_status_id: 'this-status-does-not-exist'
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(404)
  })

  it('fetches and quotes an unstored remote public status on demand', async () => {
    fetchMock.doMock()
    mockRequests(fetchMock)
    try {
      const remoteStatusUrl =
        'https://somewhere.test/s/remoteuser/remote-quote-test'
      const response = await POST(
        new NextRequest('https://llun.test/api/v1/statuses', {
          method: 'POST',
          body: JSON.stringify({
            status: 'quoting remote post',
            quoted_status_id: remoteStatusUrl
          }),
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://llun.test'
          }
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      const mastodonStatus = await response.json()
      expect(mastodonStatus.quote?.state).toBe('pending')
      expect(mastodonStatus.quote?.quoted_status).toBeNull()
      expect(mastodonStatus.content).toContain(remoteStatusUrl)

      const stored = await database.getStatus({ statusId: remoteStatusUrl })
      expect(stored).not.toBeNull()
      expect(stored?.type).toBe(StatusType.enum.Note)
      expect((stored as StatusNote).text).toBe('This is status')
    } finally {
      fetchMock.resetMocks()
      fetchMock.dontMock()
    }
  })

  it('defaults an omitted quote_approval_policy to the actor setting', async () => {
    await database.updateActor({
      actorId: ACTOR1_ID,
      defaultQuotePolicy: 'followers'
    })
    try {
      const response = await POST(
        new NextRequest('https://llun.test/api/v1/statuses', {
          method: 'POST',
          body: JSON.stringify({ status: 'inherits my default quote policy' }),
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://llun.test'
          }
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      const mastodonStatus = await response.json()
      expect(mastodonStatus.quote_approval.automatic).toEqual(['followers'])
    } finally {
      // Restore the public default so later tests keep their expectations.
      await database.updateActor({
        actorId: ACTOR1_ID,
        defaultQuotePolicy: 'public'
      })
    }
  })
})
