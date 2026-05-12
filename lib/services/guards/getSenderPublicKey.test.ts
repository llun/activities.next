import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import {
  getSenderPublicKey,
  getSenderPublicKeyDetails
} from '@/lib/services/guards/getSenderPublicKey'
import { mockRequests } from '@/lib/stub/activities'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { logger } from '@/lib/utils/logger'

enableFetchMocks()

const mockSpan = {
  end: jest.fn(),
  recordException: jest.fn()
}
const mockStartActiveSpan = jest.fn((...params: unknown[]) => {
  const callback = params[params.length - 1] as (
    span: typeof mockSpan
  ) => unknown
  return callback(mockSpan)
})
const mockWarn = logger.warn as jest.Mock

jest.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
  }
}))

jest.mock('@/lib/utils/trace', () => ({
  getTracer: () => ({
    startActiveSpan: mockStartActiveSpan
  })
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
    mockStartActiveSpan.mockClear()
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
      { status: 200 }
    )

    const publicKey = await getSenderPublicKeyDetails(database, keyId)

    expect(publicKey).toEqual({
      owner,
      publicKey: 'fragment-public-key'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
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
      { status: 200 }
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
      { status: 200 }
    )
    fetchMock.mockResponseOnce(
      JSON.stringify(
        createActorDocument({
          id: owner,
          publicKeyId: keyId,
          publicKeyPem: 'path-public-key'
        })
      ),
      { status: 200 }
    )

    const publicKey = await getSenderPublicKeyDetails(database, keyId)

    expect(publicKey).toEqual({
      owner,
      publicKey: 'path-public-key'
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
      { status: 200 }
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
      { status: 200 }
    )
    fetchMock.mockResponseOnce(
      JSON.stringify(
        createActorDocument({
          id: owner,
          publicKeyId: 'https://remote.test/users/test1/keys/other',
          publicKeyPem: 'path-public-key'
        })
      ),
      { status: 200 }
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
      { status: 200 }
    )
    fetchMock.mockResponseOnce(
      JSON.stringify(
        createActorDocument({
          id: owner,
          publicKeyId: keyId,
          publicKeyPem: 'different-public-key'
        })
      ),
      { status: 200 }
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
      { status: 200 }
    )
    fetchMock.mockResponseOnce(
      JSON.stringify(
        createActorDocument({
          id: 'https://remote.test/users/other',
          publicKeyId: keyId,
          publicKeyPem: 'path-public-key'
        })
      ),
      { status: 200 }
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
      { status: 200 }
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
      { status: 200 }
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
      { status: 200 }
    )
    fetchMock.mockResponseOnce(
      JSON.stringify(
        createActorDocument({
          id: owner,
          publicKeyId: keyId,
          publicKeyPem: 'fragment-owner-public-key'
        })
      ),
      { status: 200 }
    )

    const publicKey = await getSenderPublicKeyDetails(database, keyId)

    expect(publicKey).toEqual({
      owner,
      publicKey: 'fragment-owner-public-key'
    })
    expect(fetchMock.mock.calls.at(1)?.[0]).toBe(owner)
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
      { status: 200 }
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
      { status: 200 }
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
      { status: 200 }
    )
    fetchMock.mockResponseOnce(
      JSON.stringify(
        createActorDocument({
          id: owner,
          publicKeyId: keyId,
          publicKeyPem: 'path-public-key'
        })
      ),
      { status: 200 }
    )

    const publicKey = await getSenderPublicKeyDetails(database, keyId)

    expect(publicKey).toEqual({
      owner,
      publicKey: 'path-public-key'
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([keyId, owner])
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
      { status: 200 }
    )
    fetchMock.mockResponseOnce(
      JSON.stringify(
        createActorDocument({
          id: owner,
          publicKeyId: `${owner}#main-key`,
          publicKeyPem: 'victim-public-key'
        })
      ),
      { status: 200 }
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

    expect(mockStartActiveSpan).toHaveBeenCalledWith(
      'guard.getSenderPublicKey',
      { attributes: { actorId } },
      expect.any(Function)
    )
    expect(mockSpan.end).toHaveBeenCalled()
  })

  it('logs malformed sender public key responses', async () => {
    const actorId = 'https://remote.test/users/test1'
    fetchMock.mockResponseOnce('{', { status: 200 })

    const publicKey = await getSenderPublicKeyDetails(database, actorId)

    expect(publicKey).toEqual({
      owner: null,
      publicKey: ''
    })
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId,
        err: expect.any(SyntaxError),
        message: 'Unable to parse sender public key response'
      })
    )
    expect(mockWarn.mock.calls[0][0]).not.toHaveProperty('body')
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

  it('returns empty string when remote actor not found', async () => {
    fetchMock.mockResponseOnce('', { status: 404 })
    const actorId = 'https://unknown.test/users/nonexistent'
    const publicKey = await getSenderPublicKey(database, actorId)
    expect(publicKey).toBe('')
  })
})
