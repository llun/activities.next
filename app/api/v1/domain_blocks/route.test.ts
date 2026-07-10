import crypto from 'crypto'
import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { FollowStatus } from '@/lib/types/domain/follow'

import { DELETE, GET, POST } from './route'

const hashToken = (token: string) =>
  crypto
    .createHash('sha256')
    .update(token)
    .digest()
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

// Token store consulted by the guard's getKnex() lookup.
const mockStoredTokens = new Map<string, Record<string, unknown>>()

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => (_table: string) => ({
    where: (_field: string, value: string) => ({
      first: () => Promise.resolve(mockStoredTokens.get(value) ?? null)
    })
  })
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyAccessToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

// POST severs follows through applyDomainBlock, which publishes queue jobs.
vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

describe('/api/v1/domain_blocks', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    mockStoredTokens.clear()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    // Isolate every test from previously created blocks.
    const existing = await database.getActorDomainBlocks({
      actorId: ACTOR1_ID
    })
    for (const block of existing) {
      await database.deleteActorDomainBlock({
        actorId: ACTOR1_ID,
        domain: block.domain
      })
    }
  })

  const setToken = (token: string, scopes: string[]) => {
    mockStoredTokens.set(hashToken(token), {
      token: hashToken(token),
      referenceId: ACTOR1_ID,
      clientId: 'client-app-1',
      expiresAt: new Date(Date.now() + 3600000),
      scopes: JSON.stringify(scopes)
    })
  }

  const getRequest = (query = '', headers: Record<string, string> = {}) =>
    new NextRequest(`https://llun.test/api/v1/domain_blocks${query}`, {
      headers
    })

  const formRequest = (
    method: 'POST' | 'DELETE',
    body: URLSearchParams | null,
    headers: Record<string, string> = {}
  ) =>
    new NextRequest('https://llun.test/api/v1/domain_blocks', {
      method,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://llun.test',
        ...headers
      },
      ...(body ? { body } : {})
    })

  const params = { params: Promise.resolve({}) }

  describe('GET /api/v1/domain_blocks', () => {
    it('requires authentication', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const response = await GET(getRequest(), params)

      expect(response.status).toBe(401)
    })

    it.each(['read', 'read:blocks'])(
      'accepts a token holding the %s scope',
      async (scope) => {
        mockGetServerSession.mockResolvedValue(null)
        setToken('domain-blocks-read', [scope])

        const response = await GET(
          getRequest('', { Authorization: 'Bearer domain-blocks-read' }),
          params
        )

        expect(response.status).toBe(200)
      }
    )

    it('rejects a token holding only an unrelated read scope', async () => {
      mockGetServerSession.mockResolvedValue(null)
      setToken('statuses-token', ['read:statuses'])

      const response = await GET(
        getRequest('', { Authorization: 'Bearer statuses-token' }),
        params
      )

      expect(response.status).toBe(401)
    })

    it('returns the blocked domains as an array of strings', async () => {
      await database.createActorDomainBlock({
        actorId: ACTOR1_ID,
        domain: 'nsfw.social'
      })
      await database.createActorDomainBlock({
        actorId: ACTOR1_ID,
        domain: 'artalley.social'
      })

      const response = await GET(getRequest(), params)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.sort()).toEqual(['artalley.social', 'nsfw.social'])
    })

    it('emits a Link header with max_id when the page is full', async () => {
      await database.createActorDomainBlock({
        actorId: ACTOR1_ID,
        domain: 'page-a.test'
      })
      await database.createActorDomainBlock({
        actorId: ACTOR1_ID,
        domain: 'page-b.test'
      })

      const response = await GET(getRequest('?limit=1'), params)

      expect(response.status).toBe(200)
      expect(await response.json()).toHaveLength(1)
      const linkHeader = response.headers.get('Link')
      expect(linkHeader).toContain('rel="next"')
      expect(linkHeader).toContain('max_id=')
    })

    it('clamps the limit to the documented maximum of 200', async () => {
      await database.createActorDomainBlock({
        actorId: ACTOR1_ID,
        domain: 'clamped.test'
      })

      const response = await GET(getRequest('?limit=500'), params)

      expect(response.status).toBe(200)
      // The prev link echoes the effective (clamped) limit.
      expect(response.headers.get('Link')).toContain('limit=200')
    })
  })

  describe('POST /api/v1/domain_blocks', () => {
    it('blocks a domain from a form body and returns an empty object', async () => {
      const response = await POST(
        formRequest('POST', new URLSearchParams({ domain: 'blocked.test' })),
        params
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({})
      await expect(
        database.isDomainBlockedByActor({
          actorId: ACTOR1_ID,
          domain: 'blocked.test'
        })
      ).resolves.toBe(true)
    })

    it('blocks a domain from a JSON body', async () => {
      const response = await POST(
        new NextRequest('https://llun.test/api/v1/domain_blocks', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'https://llun.test'
          },
          body: JSON.stringify({ domain: 'json-blocked.test' })
        }),
        params
      )

      expect(response.status).toBe(200)
      await expect(
        database.isDomainBlockedByActor({
          actorId: ACTOR1_ID,
          domain: 'json-blocked.test'
        })
      ).resolves.toBe(true)
    })

    it.each(['write', 'write:blocks'])(
      'accepts a token holding the %s scope',
      async (scope) => {
        mockGetServerSession.mockResolvedValue(null)
        setToken('domain-blocks-write', [scope])

        const response = await POST(
          formRequest(
            'POST',
            new URLSearchParams({ domain: `scope-${scope.length}.test` }),
            { Authorization: 'Bearer domain-blocks-write' }
          ),
          params
        )

        expect(response.status).toBe(200)
      }
    )

    it('rejects a token holding only an unrelated write scope', async () => {
      mockGetServerSession.mockResolvedValue(null)
      setToken('write-statuses-token', ['write:statuses'])

      const response = await POST(
        formRequest('POST', new URLSearchParams({ domain: 'nope.test' }), {
          Authorization: 'Bearer write-statuses-token'
        }),
        params
      )

      expect(response.status).toBe(401)
    })

    it.each([
      ['a missing domain', null],
      ['an empty domain', ''],
      ['a bare wildcard', '*'],
      ['a wildcard domain', '*.example.com'],
      ['an unparseable domain', 'not a domain !!']
    ])('returns 422 for %s', async (_label, domain) => {
      const response = await POST(
        formRequest(
          'POST',
          domain === null ? null : new URLSearchParams({ domain })
        ),
        params
      )

      expect(response.status).toBe(422)
    })

    it('normalizes the domain before storing it', async () => {
      const response = await POST(
        formRequest('POST', new URLSearchParams({ domain: 'NSFW.Social.' })),
        params
      )

      expect(response.status).toBe(200)
      await expect(
        database.isDomainBlockedByActor({
          actorId: ACTOR1_ID,
          domain: 'nsfw.social'
        })
      ).resolves.toBe(true)
    })

    it('re-blocking an already blocked domain succeeds and stays deduplicated', async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await POST(
          formRequest('POST', new URLSearchParams({ domain: 'twice.test' })),
          params
        )
        expect(response.status).toBe(200)
      }

      const listed = await GET(getRequest(), params)
      const domains = await listed.json()
      expect(
        domains.filter((domain: string) => domain === 'twice.test')
      ).toHaveLength(1)
    })

    it('severs an existing follow of an account on the blocked domain', async () => {
      const targetActorId = 'https://severed-by-post.test/users/followed'
      await database.createFollow({
        actorId: ACTOR1_ID,
        targetActorId,
        inbox: `${targetActorId}/inbox`,
        sharedInbox: 'https://severed-by-post.test/inbox',
        status: FollowStatus.enum.Accepted
      })

      const response = await POST(
        formRequest(
          'POST',
          new URLSearchParams({ domain: 'severed-by-post.test' })
        ),
        params
      )

      expect(response.status).toBe(200)
      await expect(
        database.getAcceptedOrRequestedFollow({
          actorId: ACTOR1_ID,
          targetActorId
        })
      ).resolves.toBeNull()
    })

    it('stores a port-bearing domain in the host form used at read sites', async () => {
      // The stored block must equal `new URL(actorId).host` (non-default port
      // retained) so the timeline filter, relationship lookup, and severing
      // query — all keyed on that `.host` form — actually match. Normalizing via
      // URL.hostname (port dropped) would silently no-op every port-bearing
      // block.
      const response = await POST(
        formRequest(
          'POST',
          new URLSearchParams({ domain: 'dev.example:8443' })
        ),
        params
      )

      expect(response.status).toBe(200)
      await expect(
        database.isDomainBlockedByActor({
          actorId: ACTOR1_ID,
          domain: 'dev.example:8443'
        })
      ).resolves.toBe(true)
    })

    it('severs a follow whose target is served on a non-default port', async () => {
      const targetActorId = 'https://ported.test:8443/users/followed'
      await database.createFollow({
        actorId: ACTOR1_ID,
        targetActorId,
        inbox: `${targetActorId}/inbox`,
        sharedInbox: 'https://ported.test:8443/inbox',
        status: FollowStatus.enum.Accepted
      })

      const response = await POST(
        formRequest(
          'POST',
          new URLSearchParams({ domain: 'ported.test:8443' })
        ),
        params
      )

      expect(response.status).toBe(200)
      // follows.targetActorHost is stored as `ported.test:8443`; the block must
      // be stored in the same port-bearing form for the severing query to hit.
      await expect(
        database.getAcceptedOrRequestedFollow({
          actorId: ACTOR1_ID,
          targetActorId
        })
      ).resolves.toBeNull()
    })
  })

  describe('DELETE /api/v1/domain_blocks', () => {
    it('unblocks a domain from a form body and returns an empty object', async () => {
      await database.createActorDomainBlock({
        actorId: ACTOR1_ID,
        domain: 'unblock-me.test'
      })

      const response = await DELETE(
        formRequest(
          'DELETE',
          new URLSearchParams({ domain: 'unblock-me.test' })
        ),
        params
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({})
      await expect(
        database.isDomainBlockedByActor({
          actorId: ACTOR1_ID,
          domain: 'unblock-me.test'
        })
      ).resolves.toBe(false)
    })

    it('accepts the domain as a query parameter', async () => {
      await database.createActorDomainBlock({
        actorId: ACTOR1_ID,
        domain: 'query-unblock.test'
      })

      const response = await DELETE(
        new NextRequest(
          'https://llun.test/api/v1/domain_blocks?domain=query-unblock.test',
          {
            method: 'DELETE',
            headers: { origin: 'https://llun.test' }
          }
        ),
        params
      )

      expect(response.status).toBe(200)
      await expect(
        database.isDomainBlockedByActor({
          actorId: ACTOR1_ID,
          domain: 'query-unblock.test'
        })
      ).resolves.toBe(false)
    })

    it('succeeds even when the domain was not blocked', async () => {
      const response = await DELETE(
        formRequest(
          'DELETE',
          new URLSearchParams({ domain: 'never-blocked.test' })
        ),
        params
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({})
    })

    it('returns 422 when the domain is missing', async () => {
      const response = await DELETE(formRequest('DELETE', null), params)

      expect(response.status).toBe(422)
    })
  })
})
