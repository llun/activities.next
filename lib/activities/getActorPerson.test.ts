/** @vitest-size medium */
import { enableFetchMocks } from 'jest-fetch-mock'

import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { ACTIVITY_JSON_HEADERS, mockRequests } from '@/lib/stub/activities'
import { MockActor } from '@/lib/stub/actor'
import { MockActivityPubPerson } from '@/lib/stub/person'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

import { getActorPerson } from './getActorPerson'

const mockDatabase = {}
vi.mock('@/lib/database', () => ({ getDatabase: () => mockDatabase }))
vi.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: vi.fn()
}))

enableFetchMocks()

describe('getActorPerson', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
    vi.mocked(canFederateWithDomain).mockReset().mockResolvedValue(true)
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

    it('does not consult policy when the document is served by its own origin', async () => {
      serve({ [victimId]: { body: actorDocument(victimId, 'VICTIM KEY') } })

      expect((await getActorPerson({ actorId: victimId }))?.id).toBe(victimId)
      expect(canFederateWithDomain).not.toHaveBeenCalled()
    })
  })
})
