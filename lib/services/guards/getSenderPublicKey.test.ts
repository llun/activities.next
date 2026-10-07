import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'
import crypto from 'node:crypto'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import {
  getSenderPublicKey,
  getSenderPublicKeyDetails
} from '@/lib/services/guards/getSenderPublicKey'
import {
  ACTIVITY_JSON_HEADERS,
  JRD_JSON_HEADERS,
  mockRequests
} from '@/lib/stub/activities'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { MockWebfinger } from '@/lib/stub/webfinger'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { parse } from '@/lib/utils/signature'

enableFetchMocks()

const mockSpan = {
  end: vi.fn(),
  recordException: vi.fn(),
  setAttribute: vi.fn(),
  setStatus: vi.fn()
}
const mockWithSpan = vi.fn(
  (
    _op: string,
    _name: string,
    _data: unknown,
    fn: (span: typeof mockSpan) => unknown
  ) => fn(mockSpan)
)
const mockWarn = logger.warn as jest.Mock

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}))

// Pass-through spy: every fetch still goes through the real `request` (and so
// through fetchMock), but the options the key lookup chose are observable.
vi.mock('@/lib/utils/request', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/request')>()
  return { ...actual, request: vi.fn(actual.request) }
})

vi.mock('@/lib/utils/trace', () => ({
  withSpan: (
    op: string,
    name: string,
    data: unknown,
    fn: (span: typeof mockSpan) => unknown
  ) => mockWithSpan(op, name, data, fn)
}))

const createActorDocument = ({
  id,
  publicKeyId = `${id}#main-key`,
  publicKeyOwner = id,
  publicKeyPem = 'public-key'
}: {
  id: string
  publicKeyId?: string
  publicKeyOwner?: string
  publicKeyPem?: string
}) => ({
  id,
  type: 'Person',
  inbox: `${id}/inbox`,
  outbox: `${id}/outbox`,
  preferredUsername: id.split('/').at(-1) ?? 'actor',
  publicKey: {
    id: publicKeyId,
    owner: publicKeyOwner,
    publicKeyPem
  }
})

// The WebFinger lookup an unknown sender's key is confirmed by: the owner's
// `preferredUsername` at the owner's host.
const webfingerUrl = (account: string) => {
  const url = new URL(`https://${account.split('@')[1]}/.well-known/webfinger`)
  url.searchParams.set('resource', `acct:${account}`)
  return url.toString()
}

const webfingerResponse = (account: string, self: string) =>
  [
    JSON.stringify(MockWebfinger({ account, userUrl: self })),
    { status: 200, headers: JRD_JSON_HEADERS }
  ] as const

const verifySignedRequestTarget = async ({
  headers,
  publicKey,
  requestTarget
}: {
  headers: Record<string, string>
  publicKey: string
  requestTarget: string
}) => {
  const parsedSignature = await parse(headers.signature)
  const signedString = (parsedSignature.headers ?? '')
    .split(' ')
    .map((header) => {
      if (header === '(request-target)') {
        return `(request-target): ${requestTarget}`
      }

      return `${header}: ${headers[header]}`
    })
    .join('\n')
  const verifier = crypto.createVerify(parsedSignature.algorithm)
  verifier.update(signedString)
  return verifier.verify(publicKey, parsedSignature.signature, 'base64')
}

describe('getSenderPublicKey', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    await database.createAccount({
      ...seedActor1,
      email: `signed-key-signer@${TEST_DOMAIN}`,
      username: 'signed-key-signer',
      domain: TEST_DOMAIN
    })
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
    mockSpan.end.mockClear()
    mockSpan.recordException.mockClear()
    mockWithSpan.mockClear()
    mockWarn.mockReset()
  })

  it('returns public key for local actor', async () => {
    const actor = await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })
    if (!actor) fail('Actor is required')

    const publicKey = await getSenderPublicKey(database, actor.id)
    expect(publicKey).toBe(actor.publicKey)
  })

  it('returns public key from remote actor', async () => {
    const actorId = 'https://remote.test/users/test1'
    const publicKey = await getSenderPublicKey(database, actorId)

    expect(publicKey).toBeTruthy()
  })

  it('returns public key owner details from remote actor', async () => {
    const actorId = 'https://remote.test/users/test1'
    const publicKey = await getSenderPublicKeyDetails(database, actorId)

    expect(publicKey).toMatchObject({
      owner: actorId,
      publicKey: expect.any(String)
    })
  })

  it('accepts actor documents fetched by fragment key id without refetching the owner actor', async () => {
    const owner = 'https://remote.test/users/test1'
    const keyId = `${owner}#main-key`
    fetchMock.mockResponseOnce(
      JSON.stringify(
        createActorDocument({
          id: owner,
          publicKeyId: keyId,
          publicKeyPem: 'fragment-public-key'
        })
      ),
      { status: 200, headers: ACTIVITY_JSON_HEADERS }
    )

    const publicKey = await getSenderPublicKeyDetails(database, keyId)

    expect(publicKey).toEqual({
      owner,
      publicKey: 'fragment-public-key'
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      keyId,
      webfingerUrl('test1@remote.test')
    ])
  })

  // A keyId can name any URL on the sender's origin. A JSON upload there (a
  // Pleroma/Akkoma media path) is served as `application/json`, never as
  // ActivityPub, so it must not mint a signing key even though its id, owner
  // and key all agree with the keyId. WebFinger would confirm it here, so only
  // the content type can refuse it — and it does so before WebFinger is asked.
  it.each(['application/json', 'application/octet-stream', 'text/plain'])(
    'refuses a self-consistent key document served as %s',
    async (contentType) => {
      const uploadId = 'https://remote.test/media/forged.json'
      fetchMock.resetMocks()
      fetchMock
        .mockResponseOnce(
          JSON.stringify(
            createActorDocument({
              id: uploadId,
              publicKeyId: `${uploadId}#main-key`,
              publicKeyPem: 'forged-public-key'
            })
          ),
          { status: 200, headers: { 'content-type': contentType } }
        )
        .mockResponseOnce(
          ...webfingerResponse('forged.json@remote.test', uploadId)
        )

      await expect(
        getSenderPublicKeyDetails(database, `${uploadId}#main-key`)
      ).resolves.toEqual({ owner: null, publicKey: '' })
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        `${uploadId}#main-key`
      ])
    }
  )

  it('accepts a key document served as JSON-LD with the ActivityStreams profile', async () => {
    const owner = 'https://remote.test/users/test1'
    fetchMock.mockResponseOnce(
      JSON.stringify(
        createActorDocument({
          id: owner,
          publicKeyId: `${owner}#main-key`,
          publicKeyPem: 'json-ld-public-key'
        })
      ),
      {
        status: 200,
        headers: {
          'content-type':
            'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
        }
      }
    )

    await expect(
      getSenderPublicKeyDetails(database, `${owner}#main-key`)
    ).resolves.toEqual({ owner, publicKey: 'json-ld-public-key' })
  })

  // The content-type gate is not enough on its own: a host that serves user
  // bytes AS ActivityPub (a media proxy re-serving the upstream type) would
  // still let an upload sign as itself, and a status from a signer with no row
  // renders under that host's name. An unknown sender's key counts only once
  // its host's WebFinger names it for its handle — Mastodon's order.
  describe('confirms an unknown sender through its host WebFinger', () => {
    const uploadId = 'https://remote.test/media/forged'
    const forgedKeyDocument = () =>
      fetchMock.mockResponseOnce(
        JSON.stringify({
          ...createActorDocument({
            id: uploadId,
            publicKeyPem: 'forged-public-key'
          }),
          preferredUsername: 'admin'
        }),
        { status: 200, headers: ACTIVITY_JSON_HEADERS }
      )

    it('refuses a key whose handle WebFinger names another actor', async () => {
      forgedKeyDocument()
      fetchMock.mockResponseOnce(
        ...webfingerResponse(
          'admin@remote.test',
          'https://remote.test/users/admin'
        )
      )

      await expect(
        getSenderPublicKeyDetails(database, `${uploadId}#main-key`)
      ).resolves.toEqual({ owner: null, publicKey: '' })
    })

    it('refuses a key whose host has no WebFinger answer', async () => {
      forgedKeyDocument()
      fetchMock.mockResponseOnce('Not Found', { status: 404 })

      await expect(
        getSenderPublicKeyDetails(database, `${uploadId}#main-key`)
      ).resolves.toEqual({ owner: null, publicKey: '' })
    })

    it('accepts a key whose handle WebFinger names its owner', async () => {
      forgedKeyDocument()
      fetchMock.mockResponseOnce(
        ...webfingerResponse('admin@remote.test', uploadId)
      )

      await expect(
        getSenderPublicKeyDetails(database, `${uploadId}#main-key`)
      ).resolves.toEqual({ owner: uploadId, publicKey: 'forged-public-key' })
    })

    // Like the key fetch, the lookup runs inside the unauthenticated inbox
    // request against a host the sender chose, so it gets the same budget.
    it('bounds the WebFinger lookup like the key fetch', async () => {
      forgedKeyDocument()
      fetchMock.mockResponseOnce(
        ...webfingerResponse('admin@remote.test', uploadId)
      )
      vi.mocked(request).mockClear()

      await getSenderPublicKeyDetails(database, `${uploadId}#main-key`)

      expect(vi.mocked(request)).toHaveBeenCalledWith(
        expect.objectContaining({
          url: webfingerUrl('admin@remote.test'),
          numberOfRetry: 0,
          responseTimeout: 3000,
          allowCrossHostRedirects: false
        })
      )
    })

    it('trusts a stored sender without asking WebFinger', async () => {
      const actor = await database.getActorFromUsername({
        username: seedActor1.username,
        domain: seedActor1.domain
      })
      if (!actor) fail('Actor is required')
      fetchMock.resetMocks()

      await expect(getSenderPublicKey(database, actor.id)).resolves.toBe(
        actor.publicKey
      )
      expect(fetchMock).not.toHaveBeenCalled()
    })

    // The owner's host may redirect to the handle's domain with its
    // `subject`, which is then asked on the same budget.
    it('accepts a key whose host redirects to a handle domain naming its owner', async () => {
      forgedKeyDocument()
      fetchMock.mockResponseOnce(
        JSON.stringify({
          ...MockWebfinger({
            account: 'admin@remote.test',
            userUrl: 'https://remote.test/users/other'
          }),
          subject: 'acct:admin@handle.test'
        }),
        { status: 200, headers: JRD_JSON_HEADERS }
      )
      fetchMock.mockResponseOnce(
        ...webfingerResponse('admin@handle.test', uploadId)
      )
      vi.mocked(request).mockClear()

      await expect(
        getSenderPublicKeyDetails(database, `${uploadId}#main-key`)
      ).resolves.toEqual({ owner: uploadId, publicKey: 'forged-public-key' })
      expect(vi.mocked(request)).toHaveBeenLastCalledWith(
        expect.objectContaining({
          url: webfingerUrl('admin@handle.test'),
          numberOfRetry: 0,
          responseTimeout: 3000,
          allowCrossHostRedirects: false
        })
      )
    })

    // FEP-2c59, as Mastodon follows it: an owner whose host does not know
    // its handle names the handle's domain, asked on the same budget.
    it('accepts a key whose webfinger property domain names its owner', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          ...createActorDocument({
            id: uploadId,
            publicKeyPem: 'handle-domain-key'
          }),
          preferredUsername: 'admin',
          webfinger: 'admin@handle.test'
        }),
        { status: 200, headers: ACTIVITY_JSON_HEADERS }
      )
      fetchMock.mockResponseOnce('Not Found', { status: 404 })
      fetchMock.mockResponseOnce(
        ...webfingerResponse('admin@handle.test', uploadId)
      )
      vi.mocked(request).mockClear()

      await expect(
        getSenderPublicKeyDetails(database, `${uploadId}#main-key`)
      ).resolves.toEqual({ owner: uploadId, publicKey: 'handle-domain-key' })
      expect(vi.mocked(request)).toHaveBeenLastCalledWith(
        expect.objectContaining({
          url: webfingerUrl('admin@handle.test'),
          numberOfRetry: 0,
          responseTimeout: 3000,
          allowCrossHostRedirects: false
        })
      )
    })

    // A relay's actor never gets a row, so without this every relayed post
    // would pay a WebFinger lookup, and a slow one would refuse it.
    it('trusts an accepted relay without asking WebFinger', async () => {
      const relayActorId = 'https://relay.test/actor'
      const relay = await database.createRelay({
        inboxUrl: 'https://relay.test/inbox'
      })
      await database.updateRelay({
        id: relay.id,
        state: 'accepted',
        actorId: relayActorId
      })
      fetchMock.resetMocks()
      fetchMock.mockResponseOnce(
        JSON.stringify(
          createActorDocument({
            id: relayActorId,
            publicKeyPem: 'relay-public-key'
          })
        ),
        { status: 200, headers: ACTIVITY_JSON_HEADERS }
      )

      await expect(
        getSenderPublicKeyDetails(database, `${relayActorId}#main-key`)
      ).resolves.toEqual({ owner: relayActorId, publicKey: 'relay-public-key' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    // The Accept that makes a relay known is itself verified, so a pending
    // relay is confirmed like any other unknown sender.
    it('asks WebFinger about a relay that is not accepted yet', async () => {
      const relayActorId = 'https://pending-relay.test/actor'
      const relay = await database.createRelay({
        inboxUrl: 'https://pending-relay.test/inbox'
      })
      await database.updateRelay({ id: relay.id, actorId: relayActorId })
      fetchMock.resetMocks()
      fetchMock.mockResponseOnce(
        JSON.stringify(
          createActorDocument({
            id: relayActorId,
            publicKeyPem: 'relay-public-key'
          })
        ),
        { status: 200, headers: ACTIVITY_JSON_HEADERS }
      )
      fetchMock.mockResponseOnce('Not Found', { status: 404 })

      await expect(
        getSenderPublicKeyDetails(database, `${relayActorId}#main-key`)
      ).resolves.toEqual({ owner: null, publicKey: '' })
      expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain(
        webfingerUrl('actor@pending-relay.test')
      )
    })
  })

  it('accepts actor key identifiers that only differ by URI casing', async () => {
    const owner = 'https://remote.test/users/test1'
    const keyId = 'HTTPS://REMOTE.TEST/users/test1#main-key'
    fetchMock.mockResponseOnce(
      JSON.stringify(
        createActorDocument({
          id: owner,
          publicKeyId: `${owner}#main-key`,
          publicKeyPem: 'case-normalized-public-key'
        })
      ),
      { status: 200, headers: ACTIVITY_JSON_HEADERS }
    )

    const publicKey = await getSenderPublicKeyDetails(database, keyId)

    expect(publicKey).toEqual({
      owner,
      publicKey: 'case-normalized-public-key'
    })
  })

  it('returns public key details from path-based key documents', async () => {
    const keyId = 'https://remote.test/users/test1/keys/main'
    const owner = 'https://remote.test/users/test1'
    fetchMock.mockResponseOnce(
      JSON.stringify({
        id: keyId,
        owner,
        publicKeyPem: 'path-public-key'
      }),
      { status: 200, headers: ACTIVITY_JSON_HEADERS }
    )
    fetchMock.mockResponseOnce(
      JSON.stringify(
        createActorDocument({
          id: owner,
          publicKeyId: keyId,
          publicKeyPem: 'path-public-key'
        })
      ),
      { status: 200, headers: ACTIVITY_JSON_HEADERS }
    )

    const publicKey = await getSenderPublicKeyDetails(database, keyId)

    expect(publicKey).toEqual({
      owner,
      publicKey: 'path-public-key'
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      keyId,
      owner,
      webfingerUrl('test1@remote.test')
    ])
  })

  // The other side of the test above: a path-based keyId never matches a
  // stored row, so it is fetched on every request, but an owner that already
  // has a row holds its handle there and is not WebFingered again.
  it('does not ask WebFinger about a path-based key whose owner is stored', async () => {
    const owner = 'https://remote.test/users/stored-path-key'
    const keyId = `${owner}/main-key`
    await database.createActor({
      actorId: owner,
      type: 'Person',
      username: 'stored-path-key',
      domain: 'remote.test',
      followersUrl: `${owner}/followers`,
      inboxUrl: `${owner}/inbox`,
      sharedInboxUrl: 'https://remote.test/inbox',
      publicKey: 'previously-stored-public-key',
      createdAt: Date.now()
    })
    fetchMock.resetMocks()
    fetchMock
      .mockResponseOnce(
        JSON.stringify({
          id: keyId,
          owner,
          publicKeyPem: 'stored-path-public-key'
        }),
        { status: 200, headers: ACTIVITY_JSON_HEADERS }
      )
      .mockResponseOnce(
        JSON.stringify(
          createActorDocument({
            id: owner,
            publicKeyId: keyId,
            publicKeyPem: 'stored-path-public-key'
          })
        ),
        { status: 200, headers: ACTIVITY_JSON_HEADERS }
      )

    await expect(getSenderPublicKeyDetails(database, keyId)).resolves.toEqual({
      owner,
      publicKey: 'stored-path-public-key'
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([keyId, owner])
  })

  it('rejects public key documents that do not match the requested key id', async () => {
    const keyId = 'https://remote.test/users/test1/keys/main'
    fetchMock.mockResponseOnce(
      JSON.stringify({
        id: 'https://remote.test/users/test1/keys/other',
        owner: 'https://remote.test/users/test1',
        publicKeyPem: 'wrong-key'
      }),
      { status: 200, headers: ACTIVITY_JSON_HEADERS }
    )

    const publicKey = await getSenderPublicKeyDetails(database, keyId)

    expect(publicKey).toEqual({
      owner: null,
      publicKey: ''
    })
  })

  it('rejects public key documents whose owner actor does not publish that key', async () => {
    const keyId = 'https://remote.test/users/test1/keys/main'
    const owner = 'https://remote.test/users/test1'
    fetchMock.mockResponseOnce(
      JSON.stringify({
        id: keyId,
        owner,
        publicKeyPem: 'path-public-key'
      }),
      { status: 200, headers: ACTIVITY_JSON_HEADERS }
    )
    fetchMock.mockResponseOnce(
      JSON.stringify(
        createActorDocument({
          id: owner,
          publicKeyId: 'https://remote.test/users/test1/keys/other',
          publicKeyPem: 'path-public-key'
        })
      ),
      { status: 200, headers: ACTIVITY_JSON_HEADERS }
    )

    const publicKey = await getSenderPublicKeyDetails(database, keyId)

    expect(publicKey).toEqual({
      owner: null,
      publicKey: ''
    })
  })

  it('rejects public key documents whose owner actor publishes a different public key', async () => {
    const keyId = 'https://remote.test/users/test1/keys/main'
    const owner = 'https://remote.test/users/test1'
    fetchMock.mockResponseOnce(
      JSON.stringify({
        id: keyId,
        owner,
        publicKeyPem: 'path-public-key'
      }),
      { status: 200, headers: ACTIVITY_JSON_HEADERS }
    )
    fetchMock.mockResponseOnce(
      JSON.stringify(
        createActorDocument({
          id: owner,
          publicKeyId: keyId,
          publicKeyPem: 'different-public-key'
        })
      ),
      { status: 200, headers: ACTIVITY_JSON_HEADERS }
    )

    const publicKey = await getSenderPublicKeyDetails(database, keyId)

    expect(publicKey).toEqual({
      owner: null,
      publicKey: ''
    })
  })

  it('rejects public key documents whose claimed owner resolves to another actor', async () => {
    const keyId = 'https://remote.test/users/test1/keys/main'
    const owner = 'https://remote.test/users/test1'
    fetchMock.mockResponseOnce(
      JSON.stringify({
        id: keyId,
        owner,
        publicKeyPem: 'path-public-key'
      }),
      { status: 200, headers: ACTIVITY_JSON_HEADERS }
    )
    fetchMock.mockResponseOnce(
      JSON.stringify(
        createActorDocument({
          id: 'https://remote.test/users/other',
          publicKeyId: keyId,
          publicKeyPem: 'path-public-key'
        })
      ),
      { status: 200, headers: ACTIVITY_JSON_HEADERS }
    )

    const publicKey = await getSenderPublicKeyDetails(database, keyId)

    expect(publicKey).toEqual({
      owner: null,
      publicKey: ''
    })
  })

  it('rejects public key documents whose owner actor delegates the key to another owner', async () => {
    const keyId = 'https://remote.test/users/test1/keys/main'
    const owner = 'https://remote.test/users/test1'
    fetchMock.mockResponseOnce(
      JSON.stringify({
        id: keyId,
        owner,
        publicKeyPem: 'path-public-key'
      }),
      { status: 200, headers: ACTIVITY_JSON_HEADERS }
    )
    fetchMock.mockResponseOnce(
      JSON.stringify(
        createActorDocument({
          id: owner,
          publicKeyId: keyId,
          publicKeyOwner: 'https://remote.test/users/other',
          publicKeyPem: 'path-public-key'
        })
      ),
      { status: 200, headers: ACTIVITY_JSON_HEADERS }
    )

    const publicKey = await getSenderPublicKeyDetails(database, keyId)

    expect(publicKey).toEqual({
      owner: null,
      publicKey: ''
    })
  })

  it('accepts public key documents whose owner differs from the actor id only by fragment', async () => {
    const keyId = 'https://remote.test/users/test1/keys/main'
    const owner = 'https://remote.test/users/test1'
    fetchMock.mockResponseOnce(
      JSON.stringify({
        id: keyId,
        owner: `${owner}#owner`,
        publicKeyPem: 'fragment-owner-public-key'
      }),
      { status: 200, headers: ACTIVITY_JSON_HEADERS }
    )
    fetchMock.mockResponseOnce(
      JSON.stringify(
        createActorDocument({
          id: owner,
          publicKeyId: keyId,
          publicKeyPem: 'fragment-owner-public-key'
        })
      ),
      { status: 200, headers: ACTIVITY_JSON_HEADERS }
    )

    const publicKey = await getSenderPublicKeyDetails(database, keyId)

    expect(publicKey).toEqual({
      owner,
      publicKey: 'fragment-owner-public-key'
    })
    expect(fetchMock.mock.calls.at(1)?.[0]).toBe(owner)
  })

  it('does not fetch owner actors from blocked domains', async () => {
    const keyId = 'https://remote.test/users/test1/keys/main'
    const owner = 'https://blocked-owner.test/users/test1'
    await database.createDomainBlock({
      domain: 'blocked-owner.test',
      severity: 'suspend'
    })
    fetchMock.mockResponseOnce(
      JSON.stringify({
        id: keyId,
        owner,
        publicKeyPem: 'blocked-owner-public-key'
      }),
      { status: 200, headers: ACTIVITY_JSON_HEADERS }
    )

    const publicKey = await getSenderPublicKeyDetails(database, keyId)

    expect(publicKey).toEqual({
      owner: null,
      publicKey: ''
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([keyId])
  })

  it('does not refetch blocked owner actors from actor documents served at key URLs', async () => {
    const keyId = 'https://remote.test/users/test1/keys/main'
    const owner = 'https://blocked-actor.test/users/test1'
    await database.createDomainBlock({
      domain: 'blocked-actor.test',
      severity: 'suspend'
    })
    fetchMock.mockResponseOnce(
      JSON.stringify(
        createActorDocument({
          id: owner,
          publicKeyId: keyId,
          publicKeyPem: 'blocked-owner-public-key'
        })
      ),
      { status: 200, headers: ACTIVITY_JSON_HEADERS }
    )

    const publicKey = await getSenderPublicKeyDetails(database, keyId)

    expect(publicKey).toEqual({
      owner: null,
      publicKey: ''
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([keyId])
  })

  it('rejects actor documents whose public key owner differs from the actor id', async () => {
    const actorId = 'https://remote.test/users/test1'
    fetchMock.mockResponseOnce(
      JSON.stringify(
        createActorDocument({
          id: actorId,
          publicKeyOwner: 'https://remote.test/users/other'
        })
      ),
      { status: 200, headers: ACTIVITY_JSON_HEADERS }
    )

    const publicKey = await getSenderPublicKeyDetails(database, actorId)

    expect(publicKey).toEqual({
      owner: null,
      publicKey: ''
    })
  })

  it('accepts actor documents whose public key owner differs from the actor id only by fragment', async () => {
    const actorId = 'https://remote.test/users/test1'
    fetchMock.mockResponseOnce(
      JSON.stringify(
        createActorDocument({
          id: actorId,
          publicKeyOwner: `${actorId}#owner`,
          publicKeyPem: 'fragment-owner-public-key'
        })
      ),
      { status: 200, headers: ACTIVITY_JSON_HEADERS }
    )

    const publicKey = await getSenderPublicKeyDetails(database, actorId)

    expect(publicKey).toEqual({
      owner: actorId,
      publicKey: 'fragment-owner-public-key'
    })
  })

  it('accepts actor documents from key URLs only when the owner actor publishes the same key', async () => {
    const keyId = 'https://remote.test/users/test1/keys/main'
    const owner = 'https://remote.test/users/test1'
    fetchMock.mockResponseOnce(
      JSON.stringify(
        createActorDocument({
          id: owner,
          publicKeyId: keyId,
          publicKeyPem: 'path-public-key'
        })
      ),
      { status: 200, headers: ACTIVITY_JSON_HEADERS }
    )
    fetchMock.mockResponseOnce(
      JSON.stringify(
        createActorDocument({
          id: owner,
          publicKeyId: keyId,
          publicKeyPem: 'path-public-key'
        })
      ),
      { status: 200, headers: ACTIVITY_JSON_HEADERS }
    )

    const publicKey = await getSenderPublicKeyDetails(database, keyId)

    expect(publicKey).toEqual({
      owner,
      publicKey: 'path-public-key'
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      keyId,
      owner,
      webfingerUrl('test1@remote.test')
    ])
  })

  it('rejects actor documents from key URLs when the owner actor does not confirm the key', async () => {
    const keyId = 'https://attacker.test/keys/main'
    const owner = 'https://victim.test/users/alice'
    fetchMock.mockResponseOnce(
      JSON.stringify(
        createActorDocument({
          id: owner,
          publicKeyId: keyId,
          publicKeyPem: 'attacker-public-key'
        })
      ),
      { status: 200, headers: ACTIVITY_JSON_HEADERS }
    )
    fetchMock.mockResponseOnce(
      JSON.stringify(
        createActorDocument({
          id: owner,
          publicKeyId: `${owner}#main-key`,
          publicKeyPem: 'victim-public-key'
        })
      ),
      { status: 200, headers: ACTIVITY_JSON_HEADERS }
    )

    const publicKey = await getSenderPublicKeyDetails(database, keyId)

    expect(publicKey).toEqual({
      owner: null,
      publicKey: ''
    })
  })

  it('traces sender public key detail lookups', async () => {
    const actorId = 'https://remote.test/users/test1'

    await getSenderPublicKeyDetails(database, actorId)

    expect(mockWithSpan).toHaveBeenCalledWith(
      'guard',
      'getSenderPublicKey',
      { actorId },
      expect.any(Function)
    )
  })

  it('logs malformed sender public key responses', async () => {
    const actorId = 'https://remote.test/users/test1'
    fetchMock.mockResponseOnce('{', {
      status: 200,
      headers: ACTIVITY_JSON_HEADERS
    })

    const publicKey = await getSenderPublicKeyDetails(database, actorId)

    expect(publicKey).toEqual({
      owner: null,
      publicKey: ''
    })
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(SyntaxError),
        keyId: actorId,
        message: 'Unable to parse sender public key response'
      })
    )
    expect(mockWarn.mock.calls[0][0]).not.toHaveProperty('body')
  })

  it('falls back to the instance actor key after a gone actor response', async () => {
    const actorId = 'https://remote.test/users/deleted'
    const fallbackActorId = 'https://remote.test/actor'
    fetchMock.resetMocks()
    fetchMock
      .mockResponseOnce('', { status: 410 })
      .mockResponseOnce(
        JSON.stringify(createActorDocument({ id: fallbackActorId })),
        { status: 200, headers: ACTIVITY_JSON_HEADERS }
      )
      .mockResponseOnce(
        ...webfingerResponse('actor@remote.test', fallbackActorId)
      )

    const publicKey = await getSenderPublicKeyDetails(database, actorId)

    expect(publicKey).toEqual({
      owner: fallbackActorId,
      publicKey: 'public-key'
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      actorId,
      `${fallbackActorId}#main-key`,
      webfingerUrl('actor@remote.test')
    ])
  })

  it('does not retry a failing key fetch inside the unauthenticated inbox request', async () => {
    const actorId = 'https://remote.test/users/flaky'
    fetchMock.resetMocks()
    fetchMock
      .mockResponseOnce('', { status: 503 })
      .mockResponseOnce(JSON.stringify(createActorDocument({ id: actorId })), {
        status: 200,
        headers: ACTIVITY_JSON_HEADERS
      })

    const publicKey = await getSenderPublicKeyDetails(database, actorId)

    // One attempt only: a retry would wait out a backoff before verifying.
    expect(publicKey).toEqual({ owner: null, publicKey: '' })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([actorId])
  })

  it('bounds the key fetch with its own short timeout, not the global one', async () => {
    const actorId = 'https://remote.test/users/slow-key-host'
    fetchMock.resetMocks()
    fetchMock.mockResponseOnce(
      JSON.stringify(createActorDocument({ id: actorId })),
      { status: 200, headers: ACTIVITY_JSON_HEADERS }
    )
    vi.mocked(request).mockClear()

    await getSenderPublicKeyDetails(database, actorId)

    // The fetch runs inside an unauthenticated inbox request against a host
    // the sender chose; the global network timeout would let it hold the
    // request open far longer.
    expect(vi.mocked(request)).toHaveBeenCalledWith(
      expect.objectContaining({
        url: actorId,
        numberOfRetry: 0,
        responseTimeout: 3000
      })
    )
  })

  it('records sender public key lookup exceptions before returning empty details', async () => {
    const actorId = 'https://remote.test/users/test1'
    const error = new Error('network failed')
    fetchMock.mockRejectOnce(error)

    const publicKey = await getSenderPublicKeyDetails(database, actorId)

    expect(publicKey).toEqual({
      owner: null,
      publicKey: ''
    })
    expect(mockSpan.recordException).toHaveBeenCalledWith(error)
    expect(mockWarn).toHaveBeenCalledWith({
      actorId,
      err: error,
      message: 'Unable to resolve sender public key'
    })
  })

  it('signs remote public key fetches with a local actor', async () => {
    const actorId = 'https://remote.test/users/signed-key'
    const publicKey = await getSenderPublicKey(database, actorId)

    expect(publicKey).toBeTruthy()

    const call = fetchMock.mock.calls.find(([url]) => url === actorId)
    expect(call).toBeDefined()
    const request = call?.[1]
    expect(request?.headers).toMatchObject({
      host: 'remote.test',
      signature: expect.stringContaining('headers="(request-target) host date"')
    })
  })

  it('signs redirected remote public key fetches for the redirect target', async () => {
    const actorId = 'https://remote.test/users/redirected-key'
    const keyId = `${actorId}#main-key`
    const redirectTarget = 'https://remote.test/@redirected-key'
    fetchMock.resetMocks()
    fetchMock.mockResponse(async (request) => {
      const url = new URL(request.url)

      if (url.pathname === '/.well-known/webfinger') {
        const [body, init] = webfingerResponse(
          'redirected-key@remote.test',
          actorId
        )
        return { body, ...init }
      }

      if (url.pathname === '/users/redirected-key') {
        return {
          headers: { location: redirectTarget },
          status: 302
        }
      }

      if (url.pathname === '/@redirected-key') {
        return {
          body: JSON.stringify(
            createActorDocument({
              id: actorId,
              publicKeyId: keyId,
              publicKeyPem: 'redirected-public-key'
            })
          ),
          headers: ACTIVITY_JSON_HEADERS,
          status: 200
        }
      }

      return { status: 404 }
    })

    const publicKey = await getSenderPublicKeyDetails(database, keyId)
    const signingActor = await database.getFederationSigningActor()
    if (!signingActor) fail('Federation signing actor is required')

    const redirectedCall = fetchMock.mock.calls.find(
      ([url]) => url === redirectTarget
    )
    expect(redirectedCall).toBeDefined()
    const redirectedRequest = redirectedCall?.[1]
    const redirectedHeaders = redirectedRequest?.headers as Record<
      string,
      string
    >

    expect(publicKey).toEqual({
      owner: actorId,
      publicKey: 'redirected-public-key'
    })
    expect(
      await verifySignedRequestTarget({
        headers: redirectedHeaders,
        publicKey: signingActor.publicKey,
        requestTarget: 'get /@redirected-key'
      })
    ).toBe(true)
  })

  // The key document is trusted only because the keyId's own origin served
  // it (its id must equal the requested owner). An open redirect on that
  // origin must not let another host — one a domain block or allowlist never
  // checked — answer with a key for an id on it.
  it('refuses a key document served after a cross-host redirect', async () => {
    const actorId = 'https://remote.test/users/statuses-redirect'
    const keyId = `${actorId}#main-key`
    const redirectTarget = 'https://elsewhere.test/k'
    fetchMock.resetMocks()
    fetchMock.mockResponse(async (request) => {
      const url = new URL(request.url)
      url.hash = ''
      if (url.toString() === actorId) {
        return { headers: { location: redirectTarget }, status: 302 }
      }
      if (url.toString() === redirectTarget) {
        return {
          body: JSON.stringify(
            createActorDocument({
              id: actorId,
              publicKeyId: keyId,
              publicKeyPem: 'attacker-public-key'
            })
          ),
          headers: ACTIVITY_JSON_HEADERS,
          status: 200
        }
      }
      return { status: 404 }
    })
    vi.mocked(request).mockClear()

    const publicKey = await getSenderPublicKeyDetails(database, keyId)

    expect(publicKey).toEqual({ owner: null, publicKey: '' })
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain(
      redirectTarget
    )
  })

  it('returns empty string when remote actor not found', async () => {
    fetchMock.mockResponseOnce('', { status: 404 })
    const actorId = 'https://unknown.test/users/nonexistent'
    const publicKey = await getSenderPublicKey(database, actorId)
    expect(publicKey).toBe('')
  })
})
