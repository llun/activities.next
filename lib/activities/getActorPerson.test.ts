/** @vitest-size medium */
import { enableFetchMocks } from 'jest-fetch-mock'

import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { FederationPolicyUnavailableError } from '@/lib/services/federation/policyUnavailable'
import { ACTIVITY_JSON_HEADERS, mockRequests } from '@/lib/stub/activities'
import { MockActor } from '@/lib/stub/actor'
import { MockActivityPubPerson } from '@/lib/stub/person'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { logger } from '@/lib/utils/logger'

import { getActorPerson } from './getActorPerson'

const mockDatabase = {}
let currentDatabase: object | null = mockDatabase
vi.mock('@/lib/database', () => ({ getDatabase: () => currentDatabase }))
vi.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: vi.fn()
}))

// The real span, with the attributes each call is given kept for assertions.
const { spanAttributes } = vi.hoisted(() => ({
  spanAttributes: [] as unknown[]
}))
vi.mock('@/lib/utils/trace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/trace')>()
  return {
    ...actual,
    withSpan: ((op, name, data, fn) => {
      spanAttributes.push(data)
      return actual.withSpan(op, name, data, fn)
    }) as typeof actual.withSpan
  }
})

enableFetchMocks()

describe('getActorPerson', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
    vi.mocked(canFederateWithDomain).mockReset().mockResolvedValue(true)
    currentDatabase = mockDatabase
  })

  // A failed assertion must not leave `logger.warn` mocked for the rest of the
  // file: `vi.spyOn` would hand the next test that same spy back.
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns person from user id', async () => {
    const person = await getActorPerson({
      actorId: ACTOR1_ID
    })
    const expected = MockActivityPubPerson({
      id: ACTOR1_ID,
      withContext: false
    })
    expect(person).toMatchObject({
      ...expected,
      published: expect.any(String)
    })
  })

  it('returns null for not found actor', async () => {
    const person = await getActorPerson({
      actorId: 'notexist'
    })
    expect(person).toBeNull()
  })

  it('signs GET requests when a signing actor is provided', async () => {
    const remoteActorId = 'https://remote.test/users/signed'
    const person = await getActorPerson({
      actorId: remoteActorId,
      signingActor: MockActor({ id: 'https://llun.test/users/local' })
    })

    expect(person).not.toBeNull()

    const call = fetchMock.mock.calls.find(([url]) => url === remoteActorId)
    expect(call).toBeDefined()
    const request = call?.[1]
    expect(request?.headers).toMatchObject({
      host: 'remote.test',
      signature: expect.stringContaining('headers="(request-target) host date"')
    })
  })

  describe('binds the document id to the origin that served it', () => {
    const victimId = 'https://victim.test/users/alice'
    const attackerUrl = 'https://evil.test/users/setup'

    const actorDocument = (id: string, publicKeyPem: string) =>
      JSON.stringify({
        ...MockActivityPubPerson({ id }),
        publicKey: {
          id: `${id}#main-key`,
          owner: id,
          publicKeyPem
        }
      })

    const serve = (
      routes: Record<
        string,
        { body?: string; status?: number; headers?: Record<string, string> }
      >
    ) => {
      fetchMock.resetMocks()
      fetchMock.mockResponse(async (req) => {
        const route = routes[req.url]
        if (!route) return { status: 404, body: 'Not Found' }
        return {
          status: route.status ?? 200,
          body: route.body ?? '',
          headers: { ...ACTIVITY_JSON_HEADERS, ...route.headers }
        }
      })
    }

    it('never returns a foreign-origin id with the key the impostor supplied', async () => {
      serve({
        [attackerUrl]: { body: actorDocument(victimId, 'ATTACKER KEY') },
        [victimId]: { body: actorDocument(victimId, 'VICTIM KEY') }
      })

      const person = await getActorPerson({ actorId: attackerUrl })

      // The claimed id is re-fetched from its own origin, so what comes back
      // is what victim.test publishes — never the impostor's key.
      expect(person?.id).toBe(victimId)
      expect(person?.publicKey.publicKeyPem).toBe('VICTIM KEY')
    })

    it('rejects a foreign-origin id the claimed origin does not confirm', async () => {
      serve({
        [attackerUrl]: { body: actorDocument(victimId, 'ATTACKER KEY') }
      })

      expect(await getActorPerson({ actorId: attackerUrl })).toBeNull()
    })

    it('logs a failed lookup by error name, not the remote body', async () => {
      // `JSON.parse` quotes this body in its error message.
      serve({ [attackerUrl]: { body: 'secret-body' } })
      const error = vi.spyOn(logger, 'error')

      expect(await getActorPerson({ actorId: attackerUrl })).toBeNull()
      expect(error).toHaveBeenCalledWith({
        message: '[getActorProfile] Actor lookup failed',
        requestedOrigin: 'https://evil.test',
        err: expect.objectContaining({
          message: 'Actor lookup failed: SyntaxError'
        })
      })
    })

    it('records only the origin of the requested URL on its span', async () => {
      spanAttributes.length = 0
      serve({})

      await getActorPerson({ actorId: `${attackerUrl}?token=secret` })

      expect(spanAttributes).toEqual([{ actorId: 'https://evil.test' }])
    })

    it('logs a rejected actor document by the origin of each URL', async () => {
      const requested = `${attackerUrl}?token=secret`
      serve({
        [requested]: {
          body: actorDocument(`${victimId}?claim=secret`, 'ATTACKER KEY')
        }
      })
      const warn = vi.spyOn(logger, 'warn')

      expect(await getActorPerson({ actorId: requested })).toBeNull()
      expect(warn).toHaveBeenCalledWith({
        message:
          'Rejected actor document whose id is not served by its own origin',
        requestedActorId: 'https://evil.test',
        servedFrom: 'https://evil.test',
        claimedActorId: 'https://victim.test'
      })
    })

    it('rejects when the claimed origin answers with a different id', async () => {
      serve({
        [attackerUrl]: { body: actorDocument(victimId, 'ATTACKER KEY') },
        [victimId]: {
          body: actorDocument('https://victim.test/users/bob', 'BOB KEY')
        }
      })

      expect(await getActorPerson({ actorId: attackerUrl })).toBeNull()
    })

    it('accepts a split-domain alias whose canonical id its own origin serves', async () => {
      const aliasUrl = 'https://llun.test/users/llun'
      const canonicalId = 'https://social.llun.test/users/llun'
      serve({
        [aliasUrl]: { body: actorDocument(canonicalId, 'LLUN KEY') },
        [canonicalId]: { body: actorDocument(canonicalId, 'LLUN KEY') }
      })

      const person = await getActorPerson({ actorId: aliasUrl })

      expect(person?.id).toBe(canonicalId)
      expect(canFederateWithDomain).toHaveBeenCalledWith(
        mockDatabase,
        canonicalId
      )
    })

    it('binds to the redirect-resolved URL rather than the requested one', async () => {
      serve({
        [attackerUrl]: { status: 302, headers: { location: victimId } },
        [victimId]: { body: actorDocument(victimId, 'VICTIM KEY') }
      })

      const person = await getActorPerson({ actorId: attackerUrl })

      expect(person?.id).toBe(victimId)
      expect(person?.publicKey.publicKeyPem).toBe('VICTIM KEY')
      // Served by victim.test itself, so no confirming re-fetch is needed.
      expect(
        fetchMock.mock.calls.filter(([url]) => url === victimId)
      ).toHaveLength(1)
      expect(canFederateWithDomain).toHaveBeenCalledWith(mockDatabase, victimId)
    })

    it('does not follow a redirect onto a host federation policy refuses', async () => {
      const blockedId = 'https://blocked.test/users/alice'
      serve({
        [attackerUrl]: { status: 302, headers: { location: blockedId } },
        [blockedId]: { body: actorDocument(blockedId, 'BLOCKED KEY') }
      })
      vi.mocked(canFederateWithDomain).mockImplementation(
        async (_database, value) => !value.startsWith('https://blocked.test/')
      )

      const warn = vi.spyOn(logger, 'warn')

      expect(await getActorPerson({ actorId: attackerUrl })).toBeNull()
      expect(
        fetchMock.mock.calls.filter(([url]) => url === blockedId)
      ).toHaveLength(0)
      expect(warn).toHaveBeenCalledWith({
        message: 'Refused an actor fetch that redirects to another host',
        requestedHost: 'evil.test',
        refusedRedirectHost: 'blocked.test'
      })
    })

    it('caps the hosts it logs for a refused redirect', async () => {
      const requestedHost = `${'r'.repeat(1000)}.evil.test`
      const requestedUrl = `https://${requestedHost}/users/alice`
      const longHost = `${'a'.repeat(1000)}.blocked.test`
      serve({
        [requestedUrl]: {
          status: 302,
          headers: { location: `https://${longHost}/users/alice` }
        }
      })
      vi.mocked(canFederateWithDomain).mockResolvedValue(false)

      const warn = vi.spyOn(logger, 'warn')

      expect(await getActorPerson({ actorId: requestedUrl })).toBeNull()
      expect(warn).toHaveBeenCalledWith({
        message: 'Refused an actor fetch that redirects to another host',
        requestedHost: requestedHost.slice(0, 512),
        refusedRedirectHost: longHost.slice(0, 512)
      })
    })

    it('caps the host it logs when the redirect policy cannot be read', async () => {
      const longHost = `${'a'.repeat(1000)}.victim.test`
      serve({
        [attackerUrl]: {
          status: 302,
          headers: { location: `https://${longHost}/users/alice` }
        }
      })
      vi.mocked(canFederateWithDomain).mockRejectedValue(new Error('db down'))

      const warn = vi.spyOn(logger, 'warn')

      expect(await getActorPerson({ actorId: attackerUrl })).toBeNull()
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            'Refused a redirect whose federation policy could not be read',
          redirectHost: longHost.slice(0, 512)
        })
      )
    })

    it('does not follow a cross-host redirect when no database can supply the policy', async () => {
      currentDatabase = null
      serve({
        [attackerUrl]: { status: 302, headers: { location: victimId } },
        [victimId]: { body: actorDocument(victimId, 'VICTIM KEY') }
      })

      expect(await getActorPerson({ actorId: attackerUrl })).toBeNull()
      expect(
        fetchMock.mock.calls.filter(([url]) => url === victimId)
      ).toHaveLength(0)
    })

    it('refuses a redirect whose policy lookup throws, without retrying', async () => {
      serve({
        [attackerUrl]: { status: 302, headers: { location: victimId } },
        [victimId]: { body: actorDocument(victimId, 'VICTIM KEY') }
      })
      vi.mocked(canFederateWithDomain).mockRejectedValue(
        Object.assign(new Error('connect ECONNREFUSED'), {
          code: 'ECONNREFUSED'
        })
      )

      const warn = vi.spyOn(logger, 'warn')

      expect(await getActorPerson({ actorId: attackerUrl })).toBeNull()
      expect(
        fetchMock.mock.calls.filter(([url]) => url === victimId)
      ).toHaveLength(0)
      expect(
        fetchMock.mock.calls.filter(([url]) => url === attackerUrl)
      ).toHaveLength(1)
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            'Refused a redirect whose federation policy could not be read',
          redirectHost: 'victim.test',
          err: expect.any(Error)
        })
      )
    })

    it('follows a same-host redirect without consulting policy', async () => {
      const aliasUrl = 'https://victim.test/@alice'
      serve({
        [aliasUrl]: { status: 301, headers: { location: victimId } },
        [victimId]: { body: actorDocument(victimId, 'VICTIM KEY') }
      })

      expect((await getActorPerson({ actorId: aliasUrl }))?.id).toBe(victimId)
      expect(canFederateWithDomain).not.toHaveBeenCalled()
    })

    it('does not re-fetch a canonical id on a domain federation policy refuses', async () => {
      const blockedId = 'https://blocked.test/users/alice'
      serve({
        [attackerUrl]: { body: actorDocument(blockedId, 'ATTACKER KEY') },
        [blockedId]: { body: actorDocument(blockedId, 'BLOCKED KEY') }
      })
      vi.mocked(canFederateWithDomain).mockImplementation(
        async (_database, value) => !value.startsWith('https://blocked.test/')
      )

      expect(await getActorPerson({ actorId: attackerUrl })).toBeNull()
      expect(canFederateWithDomain).toHaveBeenCalledWith(
        mockDatabase,
        blockedId
      )
      expect(
        fetchMock.mock.calls.filter(([url]) => url === blockedId)
      ).toHaveLength(0)
    })

    it('judges the claimed id as the URL the request would go to', async () => {
      // WHATWG parsing turns `https:/host/...` into `https://host/...`; the
      // policy must see that host, not a string with no `://` in it.
      const claimedId = 'https:/blocked.test/users/alice'
      const requestUrl = 'https://blocked.test/users/alice'
      serve({
        [attackerUrl]: { body: actorDocument(claimedId, 'ATTACKER KEY') },
        [requestUrl]: { body: actorDocument(requestUrl, 'BLOCKED KEY') }
      })
      vi.mocked(canFederateWithDomain).mockImplementation(
        async (_database, value) => !value.startsWith('https://blocked.test/')
      )

      expect(await getActorPerson({ actorId: attackerUrl })).toBeNull()
      expect(canFederateWithDomain).toHaveBeenCalledWith(
        mockDatabase,
        requestUrl
      )
      expect(
        fetchMock.mock.calls.filter(([url]) => url === requestUrl)
      ).toHaveLength(0)
    })

    it('does not follow the canonical re-fetch onto another host', async () => {
      const claimedId = 'https://allowed.test/users/alice'
      const redirectTarget = 'https://blocked.test/users/alice'
      serve({
        [attackerUrl]: { body: actorDocument(claimedId, 'ATTACKER KEY') },
        [claimedId]: { status: 302, headers: { location: redirectTarget } },
        [redirectTarget]: { body: actorDocument(claimedId, 'BLOCKED KEY') }
      })
      const warn = vi.spyOn(logger, 'warn')

      expect(await getActorPerson({ actorId: attackerUrl })).toBeNull()
      expect(
        fetchMock.mock.calls.filter(([url]) => url === redirectTarget)
      ).toHaveLength(0)
      expect(warn).toHaveBeenCalledWith({
        message: 'Refused an actor fetch that redirects to another host',
        requestedHost: 'allowed.test',
        refusedRedirectHost: 'blocked.test'
      })
    })

    it('does not re-fetch when no database can supply the policy', async () => {
      currentDatabase = null
      serve({
        [attackerUrl]: { body: actorDocument(victimId, 'ATTACKER KEY') },
        [victimId]: { body: actorDocument(victimId, 'VICTIM KEY') }
      })

      expect(await getActorPerson({ actorId: attackerUrl })).toBeNull()
      expect(
        fetchMock.mock.calls.filter(([url]) => url === victimId)
      ).toHaveLength(0)
    })

    it('resolves to null when the claimed-id policy lookup is unavailable', async () => {
      serve({
        [attackerUrl]: { body: actorDocument(victimId, 'ATTACKER KEY') },
        [victimId]: { body: actorDocument(victimId, 'VICTIM KEY') }
      })
      vi.mocked(canFederateWithDomain).mockRejectedValue(
        new FederationPolicyUnavailableError()
      )

      await expect(getActorPerson({ actorId: attackerUrl })).resolves.toBeNull()
      expect(
        fetchMock.mock.calls.filter(([url]) => url === victimId)
      ).toHaveLength(0)
    })

    it('does not consult policy when the document is served by its own origin', async () => {
      serve({ [victimId]: { body: actorDocument(victimId, 'VICTIM KEY') } })

      expect((await getActorPerson({ actorId: victimId }))?.id).toBe(victimId)
      expect(canFederateWithDomain).not.toHaveBeenCalled()
    })
  })

  it('refuses a Bluesky id without any request', async () => {
    fetchMock.resetMocks()
    await expect(
      getActorPerson({ actorId: 'https://bsky.app/profile/did:plc:abc' })
    ).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
