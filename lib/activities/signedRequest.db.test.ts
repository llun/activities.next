import crypto from 'node:crypto'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'

import {
  REMOTE_SIGNATURE_SCHEME_TTL_MS,
  clearRememberedSignatureSchemes,
  getRememberedSignatureScheme,
  signedActivityPubRequest
} from '@/lib/activities/signedRequest'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { MOCK_SECRET_PHASES } from '@/lib/stub/actor'
import { Actor } from '@/lib/types/domain/actor'

const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }))
vi.mock('@/lib/utils/request', () => ({
  request: (...params: unknown[]) => mockRequest(...params)
}))
vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: vi.fn().mockResolvedValue({
    network: { requestTimeoutMs: 1000 }
  })
}))
vi.mock('@/lib/config', async () => {
  const { MOCK_SECRET_PHASES } =
    await vi.importActual<typeof import('@/lib/stub/actor')>('@/lib/stub/actor')
  return {
    getConfig: () => ({
      host: 'local.example',
      secretPhase: MOCK_SECRET_PHASES,
      trustedHosts: []
    })
  }
})

type RequestOptionsLike = {
  body?: string
  headers:
    | Record<string, string>
    | ((hop: {
        body?: string
        method: string
        url: URL
      }) => Record<string, string>)
  method: string
  url: string
}

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
  id: 'https://local.example/users/alice',
  privateKey: keyPair.privateKey,
  publicKey: keyPair.publicKey
} as Actor

describe('signedActivityPubRequest with SQL database', () => {
  const { database, db, prepare, destroy } = createTestDatabase()
  const headersSent: Record<string, string>[] = []
  let statuses: number[] = []
  let contentTypes: (string | undefined)[] = []
  let finalUrls: (string | undefined)[] = []

  beforeAll(async () => {
    await prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await destroy()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    clearRememberedSignatureSchemes()
    headersSent.length = 0
    statuses = []
    contentTypes = []
    finalUrls = []
    await db.deleteFrom('remote_signature_schemes').execute()
    mockRequest.mockImplementation(async (options: RequestOptionsLike) => {
      const resolved =
        typeof options.headers === 'function'
          ? options.headers({
              body: options.body,
              method: options.method,
              url: new URL(options.url)
            })
          : options.headers
      headersSent.push(resolved)
      const statusCode = statuses.shift() ?? 202
      const contentType = contentTypes.shift()
      return {
        body: '',
        headers: contentType ? { 'content-type': contentType } : {},
        statusCode,
        url: finalUrls.shift() ?? options.url
      }
    })
  })

  it('persists learned scheme in remote_signature_schemes and survives cache clears', async () => {
    const url = 'https://Peer.Example:443/inbox'
    statuses = [401, 202]

    const firstResult = await signedActivityPubRequest({
      actor,
      database,
      method: 'POST',
      persistScheme: true,
      url,
      body: '{"type":"Follow"}'
    })
    expect(firstResult.statusCode).toBe(202)
    expect(headersSent).toHaveLength(2)
    expect(headersSent[0]['signature-input']).toBeUndefined()
    expect(headersSent[1]['signature-input']).toEqual(expect.any(String))

    const stored = await database.getRemoteSignatureScheme({
      domain: 'peer.example'
    })
    expect(stored).not.toBeNull()
    expect(stored?.scheme).toBe('rfc9421')
    expect(stored!.expiresAt - stored!.updatedAt).toBe(
      REMOTE_SIGNATURE_SCHEME_TTL_MS
    )

    // Wipe the in-process cache and verify the next request uses rfc9421 on
    // the first knock directly from the SQL table.
    clearRememberedSignatureSchemes()
    expect(getRememberedSignatureScheme('peer.example')).toBeNull()
    headersSent.length = 0
    statuses = [202]

    const secondResult = await signedActivityPubRequest({
      actor,
      database,
      method: 'POST',
      url: 'https://peer.example/inbox',
      body: '{"type":"Follow"}'
    })
    expect(secondResult.statusCode).toBe(202)
    expect(headersSent).toHaveLength(1)
    expect(headersSent[0]['signature-input']).toEqual(expect.any(String))
  })

  it('falls back to cavage when the stored database row has expired', async () => {
    const expiredAt = Date.now() - 1000
    await database.upsertRemoteSignatureScheme({
      domain: 'expired.example',
      scheme: 'rfc9421',
      expiresAt: expiredAt,
      now: expiredAt - 60_000
    })

    statuses = [202]
    await signedActivityPubRequest({
      actor,
      database,
      method: 'POST',
      url: 'https://expired.example/inbox',
      body: '{"type":"Follow"}'
    })

    expect(headersSent).toHaveLength(1)
    expect(headersSent[0]['signature-input']).toBeUndefined()
    expect(headersSent[0].signature).toMatch(/^keyId=/)
  })

  it('does not store a scheme from a GET whose 2xx is not an ActivityPub document', async () => {
    statuses = [401, 200]
    contentTypes = ['text/html', 'text/html']
    const result = await signedActivityPubRequest({
      actor,
      database,
      method: 'GET',
      persistScheme: true,
      url: 'https://html.example/about'
    })

    expect(result.statusCode).toBe(200)
    expect(headersSent).toHaveLength(2)
    expect(
      await database.getRemoteSignatureScheme({ domain: 'html.example' })
    ).toBeNull()
    expect(getRememberedSignatureScheme('html.example')).toBeNull()
  })

  it('stores a scheme from a GET that returned an ActivityPub document', async () => {
    statuses = [401, 200]
    contentTypes = ['text/html', 'application/activity+json']
    await signedActivityPubRequest({
      actor,
      database,
      method: 'GET',
      persistScheme: true,
      url: 'https://ap.example/users/bob'
    })

    const stored = await database.getRemoteSignatureScheme({
      domain: 'ap.example'
    })
    expect(stored?.scheme).toBe('rfc9421')
  })

  it('does not write the table unless the caller opts in', async () => {
    statuses = [401, 202]
    await signedActivityPubRequest({
      actor,
      database,
      method: 'POST',
      url: 'https://default.example/inbox',
      body: '{"type":"Follow"}'
    })

    expect(
      await database.getRemoteSignatureScheme({ domain: 'default.example' })
    ).toBeNull()
    expect(getRememberedSignatureScheme('default.example')).toBe('rfc9421')
  })

  it('writes a scheme a lookup learned once a delivery succeeds with it', async () => {
    // The actor lookup learns RFC 9421 into this process only.
    statuses = [401, 200]
    contentTypes = ['text/html', 'application/activity+json']
    await signedActivityPubRequest({
      actor,
      database,
      method: 'GET',
      url: 'https://follow.example/users/bob'
    })
    expect(
      await database.getRemoteSignatureScheme({ domain: 'follow.example' })
    ).toBeNull()

    // The Follow delivery succeeds with it on its first knock.
    headersSent.length = 0
    statuses = [202]
    await signedActivityPubRequest({
      actor,
      database,
      method: 'POST',
      persistScheme: true,
      url: 'https://follow.example/inbox',
      body: '{"type":"Follow"}'
    })

    expect(headersSent).toHaveLength(1)
    expect(headersSent[0]['signature-input']).toEqual(expect.any(String))
    const stored = await database.getRemoteSignatureScheme({
      domain: 'follow.example'
    })
    expect(stored?.scheme).toBe('rfc9421')
  })

  it('learns nothing from a GET refused with 403 and read on the other knock', async () => {
    statuses = [403, 200]
    contentTypes = ['text/html', 'application/activity+json']
    const result = await signedActivityPubRequest({
      actor,
      database,
      method: 'GET',
      persistScheme: true,
      url: 'https://anon.example/users/bob'
    })

    expect(result.statusCode).toBe(200)
    expect(headersSent).toHaveLength(2)
    expect(
      await database.getRemoteSignatureScheme({ domain: 'anon.example' })
    ).toBeNull()
    expect(getRememberedSignatureScheme('anon.example')).toBeNull()
  })

  it('falls back to draft-cavage when an RFC 9421 POST is refused with 400', async () => {
    await database.upsertRemoteSignatureScheme({
      domain: 'rollback.example',
      scheme: 'rfc9421',
      expiresAt: Date.now() + REMOTE_SIGNATURE_SCHEME_TTL_MS
    })
    statuses = [400, 202]
    const result = await signedActivityPubRequest({
      actor,
      database,
      method: 'POST',
      persistScheme: true,
      url: 'https://rollback.example/inbox',
      body: '{"type":"Follow"}'
    })

    expect(result.statusCode).toBe(202)
    expect(headersSent).toHaveLength(2)
    expect(headersSent[0]['signature-input']).toEqual(expect.any(String))
    expect(headersSent[1].signature).toMatch(/^keyId=/)
    const stored = await database.getRemoteSignatureScheme({
      domain: 'rollback.example'
    })
    expect(stored?.scheme).toBe('cavage')
  })

  it('does not count a POST redirected to a GET page as proof', async () => {
    statuses = [401, 200]
    contentTypes = [undefined, 'text/html']
    finalUrls = [undefined, 'https://redirect.example/thanks']
    await signedActivityPubRequest({
      actor,
      database,
      method: 'POST',
      persistScheme: true,
      url: 'https://redirect.example/inbox',
      body: '{"type":"Follow"}'
    })

    expect(
      await database.getRemoteSignatureScheme({ domain: 'redirect.example' })
    ).toBeNull()
  })

  it.each([403, 415, 422])(
    'also falls back to draft-cavage when an RFC 9421 POST is refused with %i',
    async (status) => {
      await database.upsertRemoteSignatureScheme({
        domain: `refuse-${status}.example`,
        scheme: 'rfc9421',
        expiresAt: Date.now() + REMOTE_SIGNATURE_SCHEME_TTL_MS
      })
      statuses = [status, 202]
      const result = await signedActivityPubRequest({
        actor,
        database,
        method: 'POST',
        persistScheme: true,
        url: `https://refuse-${status}.example/inbox`,
        body: '{"type":"Follow"}'
      })
      expect(result.statusCode).toBe(202)
      expect(headersSent).toHaveLength(2)
    }
  )

  it.each([404, 410, 429])(
    'does not re-knock an RFC 9421 POST answered %i',
    async (status) => {
      await database.upsertRemoteSignatureScheme({
        domain: `gone-${status}.example`,
        scheme: 'rfc9421',
        expiresAt: Date.now() + REMOTE_SIGNATURE_SCHEME_TTL_MS
      })
      statuses = [status]
      const result = await signedActivityPubRequest({
        actor,
        database,
        method: 'POST',
        persistScheme: true,
        url: `https://gone-${status}.example/inbox`,
        body: '{"type":"Follow"}'
      })
      expect(result.statusCode).toBe(status)
      expect(headersSent).toHaveLength(1)
    }
  )

  it('a lookup never overrides the scheme the table holds for a host', async () => {
    await database.upsertRemoteSignatureScheme({
      domain: 'stored.example',
      scheme: 'rfc9421',
      expiresAt: Date.now() + REMOTE_SIGNATURE_SCHEME_TTL_MS
    })
    // Knock 1 (RFC 9421, from the table) is refused, Knock 2 (cavage) reads.
    statuses = [401, 200]
    contentTypes = ['text/html', 'application/activity+json']
    await signedActivityPubRequest({
      actor,
      database,
      method: 'GET',
      url: 'https://stored.example/users/bob'
    })

    expect(getRememberedSignatureScheme('stored.example')).toBe('rfc9421')
  })

  it('keeps a scheme learned with persistScheme false in process only', async () => {
    statuses = [401, 200]
    contentTypes = ['text/html', 'application/activity+json']
    await signedActivityPubRequest({
      actor,
      database,
      method: 'GET',
      persistScheme: false,
      url: 'https://stranger.example/users/eve'
    })

    expect(
      await database.getRemoteSignatureScheme({ domain: 'stranger.example' })
    ).toBeNull()
    expect(getRememberedSignatureScheme('stranger.example')).toBe('rfc9421')
  })

  it('reads a failing database once per cache TTL, not once per request', async () => {
    const getRemoteSignatureScheme = vi
      .fn()
      .mockRejectedValue(new Error('database is down'))
    const failing = {
      getRemoteSignatureScheme,
      upsertRemoteSignatureScheme: vi.fn()
    } as unknown as Database

    for (let i = 0; i < 3; i++) {
      const result = await signedActivityPubRequest({
        actor,
        database: failing,
        method: 'POST',
        url: 'https://down.example/inbox',
        body: '{"type":"Follow"}'
      })
      expect(result.statusCode).toBe(202)
    }
    expect(getRemoteSignatureScheme).toHaveBeenCalledTimes(1)
  })
})
