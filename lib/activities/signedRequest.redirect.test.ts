import crypto from 'node:crypto'
import { Readable } from 'node:stream'

import { signedActivityPubRequest } from '@/lib/activities/signedRequest'
import { MOCK_SECRET_PHASES } from '@/lib/stub/actor'
import type { Actor } from '@/lib/types/domain/actor'
import type {
  SafeRemoteFetchOptions,
  SafeRemoteFetchTransport
} from '@/lib/utils/safeRemoteFetch'

const { mockTransport, mockResolveHost } = vi.hoisted(() => ({
  mockTransport: vi.fn<SafeRemoteFetchTransport>(),
  mockResolveHost: vi.fn(async () => [
    { address: '93.184.216.34', family: 4 as const }
  ])
}))

vi.mock('@/lib/utils/safeRemoteFetch', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/utils/safeRemoteFetch')>()
  const testFetch = actual.createSafeRemoteFetch({
    resolveHost: mockResolveHost,
    transport: mockTransport
  })
  return {
    ...actual,
    safeRemoteFetch: (options: SafeRemoteFetchOptions) => testFetch(options)
  }
})

vi.mock('@/lib/database', () => ({
  getDatabase: () => null
}))

vi.mock('@/lib/config', async () => {
  const { MOCK_SECRET_PHASES } =
    await vi.importActual<typeof import('@/lib/stub/actor')>('@/lib/stub/actor')
  return {
    getConfig: () => ({
      host: 'local.test',
      secretPhase: MOCK_SECRET_PHASES,
      trustedHosts: ['remote.test']
    })
  }
})

vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: vi.fn().mockResolvedValue({
    network: {
      requestTimeoutMs: 5000,
      requestRetries: 0,
      maxResponseSizeBytes: 1024 * 1024
    }
  })
}))

const keyPair = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
    cipher: 'aes-256-cbc',
    passphrase: MOCK_SECRET_PHASES
  }
})

const actor = {
  id: 'https://local.test/users/alice',
  privateKey: keyPair.privateKey,
  publicKey: keyPair.publicKey
} as Actor

describe('signedActivityPubRequest redirect refusal onto bsky.app', () => {
  beforeEach(() => {
    mockTransport.mockReset()
    mockResolveHost.mockClear()
  })

  it('refuses a 307 redirect from a delivery inbox onto bsky.app without contacting bsky.app', async () => {
    mockTransport
      .mockResolvedValueOnce({
        statusCode: 307,
        headers: {
          location: 'https://bsky.app/profile/did:plc:abcdefghijklmnopqrstuvwx'
        },
        body: Readable.from([])
      })
      .mockResolvedValueOnce({
        statusCode: 202,
        headers: {},
        body: Readable.from(['accepted'])
      })

    await expect(
      signedActivityPubRequest({
        actor,
        method: 'POST',
        url: 'https://remote.test/inbox',
        body: JSON.stringify({ type: 'Create', id: 'https://local.test/a/1' }),
        persistScheme: true
      })
    ).rejects.toMatchObject({ code: 'ERR_CROSS_HOST_REDIRECT' })

    expect(mockTransport).toHaveBeenCalledTimes(1)
    expect(mockTransport.mock.calls[0]?.[0].url.href).toBe(
      'https://remote.test/inbox'
    )
    expect(mockResolveHost).toHaveBeenCalledTimes(1)
    expect(mockResolveHost).toHaveBeenCalledWith('remote.test')
  })

  it('refuses a redirect onto bsky.app even when caller policy returns true', async () => {
    const callerPolicy = vi.fn(() => true)
    mockTransport
      .mockResolvedValueOnce({
        statusCode: 307,
        headers: { location: 'https://BSKY.APP./inbox' },
        body: Readable.from([])
      })
      .mockResolvedValueOnce({
        statusCode: 202,
        headers: {},
        body: Readable.from(['accepted'])
      })

    await expect(
      signedActivityPubRequest({
        actor,
        method: 'POST',
        url: 'https://remote.test/inbox',
        body: '{}',
        requestOptions: { allowCrossHostRedirects: callerPolicy }
      })
    ).rejects.toMatchObject({ code: 'ERR_CROSS_HOST_REDIRECT' })

    expect(mockTransport).toHaveBeenCalledTimes(1)
    expect(callerPolicy).not.toHaveBeenCalled()
  })

  it('still follows a 307 redirect onto a non-Bluesky host under default policy', async () => {
    mockTransport
      .mockResolvedValueOnce({
        statusCode: 307,
        headers: { location: 'https://other.test/inbox' },
        body: Readable.from([])
      })
      .mockResolvedValueOnce({
        statusCode: 202,
        headers: {},
        body: Readable.from(['accepted'])
      })

    const result = await signedActivityPubRequest({
      actor,
      method: 'POST',
      url: 'https://remote.test/inbox',
      body: '{}'
    })

    expect(result.statusCode).toBe(202)
    expect(mockTransport).toHaveBeenCalledTimes(2)
    expect(mockTransport.mock.calls[1]?.[0].url.href).toBe(
      'https://other.test/inbox'
    )
  })
})
