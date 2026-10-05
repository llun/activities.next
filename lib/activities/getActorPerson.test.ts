import { enableFetchMocks } from 'jest-fetch-mock'

import { mockRequests } from '@/lib/stub/activities'
import { MockActor } from '@/lib/stub/actor'
import { MockActivityPubPerson } from '@/lib/stub/person'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

import { getActorPerson } from './getActorPerson'

enableFetchMocks()

describe('getActorPerson', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
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
          headers: route.headers
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
  })
})
