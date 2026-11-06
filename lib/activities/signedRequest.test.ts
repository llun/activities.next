import crypto from 'node:crypto'

import type { Database } from '@/lib/database/types'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { MOCK_SECRET_PHASES } from '@/lib/stub/actor'
import { Actor } from '@/lib/types/domain/actor'
import { verify } from '@/lib/utils/signature'

import {
  REMOTE_SIGNATURE_SCHEME_REFRESH_INTERVAL_MS,
  REMOTE_SIGNATURE_SCHEME_TTL_MS,
  SIGNATURE_SCHEME_CACHE_TTL_MS,
  clearRememberedSignatureSchemes,
  getRememberedSignatureScheme,
  rememberSignatureScheme,
  signedActivityPubRequest
} from './signedRequest'

const { mockGetDatabase } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn<() => Database | null>(() => null)
}))
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockGetDatabase()
}))

vi.mock('@/lib/config', async () => {
  const { MOCK_SECRET_PHASES } =
    await vi.importActual<typeof import('@/lib/stub/actor')>('@/lib/stub/actor')
  return {
    getConfig: () => ({
      host: 'local.test',
      secretPhase: MOCK_SECRET_PHASES,
      // `verify` rebuilds the cavage `host:` line through `headerHost`, which
      // only echoes a header host it trusts.
      trustedHosts: ['remote.test']
    })
  }
})

const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }))
vi.mock('@/lib/utils/request', () => ({
  request: (...params: unknown[]) => mockRequest(...params)
}))
const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }))
vi.mock('@/lib/utils/logger', () => ({
  logger: { warn: mockWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: vi.fn().mockResolvedValue({
    network: { requestTimeoutMs: 1000 }
  })
}))

type CapturedCall = {
  body?: string
  headers: Record<string, string>
  method: string
  url: string
}

type RequestOptionsLike = {
  body?: string
  headers:
    | Record<string, string>
    | ((request: {
        body?: string
        method: string
        url: URL
      }) => Record<string, string>)
  method: string
  url: string
}

type FakeResponse = { statusCode: number; url?: string } | Error

const calls: CapturedCall[] = []
let responses: FakeResponse[] = []
let afterCall: (() => void) | undefined

const resolveHeaders = (options: RequestOptionsLike) =>
  typeof options.headers === 'function'
    ? options.headers({
        body: options.body,
        method: options.method,
        url: new URL(options.url)
      })
    : options.headers

const respond = (statusCode: number, url?: string) => ({
  body: '',
  headers: {},
  statusCode,
  url
})

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

const unsignedActor = {
  id: 'https://local.test/users/alice',
  publicKey: keyPair.publicKey
} as Actor

const INBOX = 'https://remote.test/inbox'
const BODY = JSON.stringify({ type: 'Follow', actor: actor.id })

const isRfc9421 = (headers: Record<string, string>) =>
  typeof headers['signature-input'] === 'string'
const isCavage = (headers: Record<string, string>) =>
  typeof headers.signature === 'string' &&
  headers.signature.startsWith('keyId=')

const send = (
  overrides: Partial<Parameters<typeof signedActivityPubRequest>[0]> = {}
) =>
  signedActivityPubRequest({
    actor,
    method: 'POST',
    url: INBOX,
    body: BODY,
    ...overrides
  })

describe('signedActivityPubRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetDatabase.mockReturnValue(null)
    clearRememberedSignatureSchemes()
    calls.length = 0
    responses = []
    afterCall = undefined
    mockRequest.mockImplementation(async (options: RequestOptionsLike) => {
      calls.push({
        body: options.body,
        headers: resolveHeaders(options),
        method: options.method,
        url: options.url
      })
      const hook = afterCall
      afterCall = undefined
      hook?.()
      const next = responses.shift()
      if (next instanceof Error) throw next
      return next ?? respond(202, options.url)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends one cavage request to an unknown host that answers 2xx', async () => {
    await expect(send()).resolves.toMatchObject({ statusCode: 202 })

    expect(calls).toHaveLength(1)
    expect(isCavage(calls[0].headers)).toBe(true)
    expect(isRfc9421(calls[0].headers)).toBe(false)
    expect(getRememberedSignatureScheme('remote.test')).toBeNull()
  })

  it('knocks with rfc9421 after a POST 401 and remembers it', async () => {
    responses = [respond(401, INBOX), respond(202, INBOX)]

    await expect(send()).resolves.toMatchObject({ statusCode: 202 })

    expect(calls).toHaveLength(2)
    expect(isCavage(calls[0].headers)).toBe(true)
    expect(isRfc9421(calls[1].headers)).toBe(true)
    expect(getRememberedSignatureScheme('remote.test')).toBe('rfc9421')

    calls.length = 0
    await send()
    expect(calls).toHaveLength(1)
    expect(isRfc9421(calls[0].headers)).toBe(true)
  })

  it('does not knock after a POST 403', async () => {
    responses = [respond(403, INBOX)]

    await expect(send()).resolves.toMatchObject({ statusCode: 403 })
    expect(calls).toHaveLength(1)
  })

  it('knocks after a GET 403', async () => {
    responses = [respond(403, INBOX), respond(200, INBOX)]

    await expect(
      send({
        method: 'GET',
        body: undefined,
        url: 'https://remote.test/users/alice'
      })
    ).resolves.toMatchObject({ statusCode: 200 })

    expect(calls).toHaveLength(2)
    expect(isCavage(calls[0].headers)).toBe(true)
    expect(isRfc9421(calls[1].headers)).toBe(true)
  })

  it('downgrades a remembered rfc9421 host back to cavage', async () => {
    rememberSignatureScheme('remote.test', 'rfc9421')
    responses = [respond(401, INBOX), respond(202, INBOX)]

    await expect(send()).resolves.toMatchObject({ statusCode: 202 })

    expect(calls).toHaveLength(2)
    expect(isRfc9421(calls[0].headers)).toBe(true)
    expect(isCavage(calls[1].headers)).toBe(true)
    expect(getRememberedSignatureScheme('remote.test')).toBe('cavage')
  })

  it('returns the first response when both knocks fail', async () => {
    responses = [respond(401, INBOX), respond(400, INBOX)]

    await expect(send()).resolves.toMatchObject({ statusCode: 401 })
    expect(calls).toHaveLength(2)
    expect(getRememberedSignatureScheme('remote.test')).toBeNull()
  })

  it('returns the first response unchanged when Knock 2 throws ECONNRESET', async () => {
    const first = respond(401, INBOX)
    responses = [
      first,
      Object.assign(new Error('reset'), { code: 'ECONNRESET' })
    ]

    await expect(send()).resolves.toBe(first)
    expect(calls).toHaveLength(2)
    expect(getRememberedSignatureScheme('remote.test')).toBeNull()
    // Swallowed for the caller, but not silent.
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'remote.test',
        scheme: 'rfc9421',
        err: expect.objectContaining({ message: 'reset' })
      })
    )
  })

  it.each([false, true])(
    'does not remember when Knock 2 crosses hosts (returns to initial host: %s)',
    async (returnsToInitialHost) => {
      mockRequest.mockImplementationOnce(async () => respond(401, INBOX))
      mockRequest.mockImplementationOnce(
        async (options: RequestOptionsLike) => {
          resolveHeaders(options)
          const otherUrl = 'https://other.test/inbox'
          resolveHeaders({ ...options, url: otherUrl })
          if (returnsToInitialHost) resolveHeaders(options)
          return respond(202, returnsToInitialHost ? INBOX : otherUrl)
        }
      )

      await expect(send()).resolves.toMatchObject({ statusCode: 202 })
      expect(mockRequest).toHaveBeenCalledTimes(2)
      expect(getRememberedSignatureScheme('remote.test')).toBeNull()
    }
  )

  it('does not knock when Knock 1 crosses hosts and returns to the initial host', async () => {
    mockRequest.mockImplementationOnce(async (options: RequestOptionsLike) => {
      resolveHeaders(options)
      resolveHeaders({ ...options, url: 'https://other.test/inbox' })
      resolveHeaders(options)
      return respond(401, INBOX)
    })

    await expect(send()).resolves.toMatchObject({ statusCode: 401 })
    expect(mockRequest).toHaveBeenCalledTimes(1)
    expect(getRememberedSignatureScheme('remote.test')).toBeNull()
  })

  it.each([404, 410, 429, 500])(
    'does not knock after HTTP %i',
    async (statusCode) => {
      responses = [respond(statusCode, INBOX)]

      await expect(send()).resolves.toMatchObject({ statusCode })
      expect(calls).toHaveLength(1)
    }
  )

  it('does not knock after a timeout', async () => {
    responses = [Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })]

    await expect(send()).rejects.toThrow('timed out')
    expect(calls).toHaveLength(1)
  })

  it('does not knock when a cross-host redirect ends in 401', async () => {
    responses = [respond(401, 'https://other.test/inbox')]

    await expect(send()).resolves.toMatchObject({ statusCode: 401 })
    expect(calls).toHaveLength(1)

    // The hop onto the other host is never signed.
    const options = mockRequest.mock.calls[0][0] as RequestOptionsLike
    const otherHostHeaders = resolveHeaders({
      ...options,
      url: 'https://other.test/inbox'
    })
    expect(otherHostHeaders).not.toHaveProperty('signature')
    expect(otherHostHeaders).not.toHaveProperty('signature-input')
    // A redirected POST keeps its unsigned base headers off-host.
    expect(otherHostHeaders).toEqual({
      accept: expect.any(String),
      host: 'other.test',
      date: expect.any(String),
      digest: expect.stringMatching(/^SHA-256=/),
      'content-type': 'application/activity+json'
    })
  })

  it('re-signs a same-host 307 over the new URL', async () => {
    responses = [respond(202, 'https://remote.test/inbox-2')]

    await send()

    const options = mockRequest.mock.calls[0][0] as RequestOptionsLike
    const first = resolveHeaders(options)
    const second = resolveHeaders({
      ...options,
      url: 'https://remote.test/inbox-2'
    })

    await expect(verify('post /inbox', first, keyPair.publicKey)).resolves.toBe(
      true
    )
    await expect(
      verify('post /inbox-2', second, keyPair.publicKey)
    ).resolves.toBe(true)
    await expect(
      verify('post /inbox', second, keyPair.publicKey)
    ).resolves.toBe(false)
  })

  it('sends an unsigned request when there is no signing key', async () => {
    await send({ actor: unsignedActor })

    expect(calls).toHaveLength(1)
    expect(calls[0].headers).not.toHaveProperty('signature')
    expect(calls[0].headers).not.toHaveProperty('signature-input')
    expect(calls[0].headers).toMatchObject({
      date: expect.any(String),
      digest: `SHA-256=${crypto.createHash('sha256').update(BODY).digest('base64')}`,
      'content-type': 'application/activity+json'
    })
    expect(Number.isNaN(Date.parse(calls[0].headers.date))).toBe(false)
  })

  it.each([400, 1000])(
    'uses the resolved default timeout when no caller budget is set (%i ms elapsed)',
    async (elapsed) => {
      let now = 1_000_000
      vi.spyOn(Date, 'now').mockImplementation(() => now)
      afterCall = () => {
        now += elapsed
      }
      responses = [respond(401, INBOX), respond(202, INBOX)]

      await send()

      expect(calls).toHaveLength(elapsed < 1000 ? 2 : 1)
      if (elapsed < 1000) {
        expect(mockRequest.mock.calls[1][0]).toMatchObject({
          numberOfRetry: 0,
          responseTimeout: 1000 - elapsed
        })
      }
      expect(getResolvedServerSettings).toHaveBeenCalled()
    }
  )

  it('does not knock when the caller budget is already spent', async () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    afterCall = () => {
      now += 1500
    }
    responses = [respond(401, INBOX)]

    await expect(
      send({ requestOptions: { responseTimeout: 1000 } })
    ).resolves.toMatchObject({ statusCode: 401 })
    expect(calls).toHaveLength(1)
  })

  it('caps the second knock to the remaining budget', async () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    afterCall = () => {
      now += 400
    }
    responses = [respond(401, INBOX), respond(202, INBOX)]

    await send({ requestOptions: { responseTimeout: 1000 } })

    expect(calls).toHaveLength(2)
    expect(mockRequest.mock.calls[1][0]).toMatchObject({
      numberOfRetry: 0,
      responseTimeout: 600
    })
  })

  it('forgets a remembered scheme after its TTL', () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    rememberSignatureScheme('remote.test', 'rfc9421')
    expect(getRememberedSignatureScheme('remote.test')).toBe('rfc9421')

    now += SIGNATURE_SCHEME_CACHE_TTL_MS + 1
    expect(getRememberedSignatureScheme('remote.test')).toBeNull()
  })

  describe('shared database persistence and caching', () => {
    const createMemorySchemeDb = () => {
      const rows = new Map<
        string,
        {
          createdAt: number
          domain: string
          expiresAt: number
          scheme: 'cavage' | 'rfc9421'
          updatedAt: number
        }
      >()
      const getRemoteSignatureScheme = vi.fn(
        async ({
          domain,
          now = Date.now()
        }: {
          domain: string
          now?: number | Date
        }) => {
          const key = domain.trim().toLowerCase()
          const row = rows.get(key)
          const nowMs = now instanceof Date ? now.getTime() : now
          if (!row || row.expiresAt <= nowMs) return null
          return { ...row }
        }
      )
      const upsertRemoteSignatureScheme = vi.fn(
        async ({
          domain,
          scheme,
          expiresAt,
          now = Date.now()
        }: {
          domain: string
          expiresAt: number | Date
          now?: number | Date
          scheme: 'cavage' | 'rfc9421'
        }) => {
          const key = domain.trim().toLowerCase()
          const nowMs = now instanceof Date ? now.getTime() : now
          const expMs =
            expiresAt instanceof Date ? expiresAt.getTime() : expiresAt
          const existing = rows.get(key)
          rows.set(key, {
            domain: key,
            scheme,
            expiresAt: expMs,
            createdAt: existing?.createdAt ?? nowMs,
            updatedAt: nowMs
          })
        }
      )
      const db = {
        getRemoteSignatureScheme,
        upsertRemoteSignatureScheme
      } as unknown as Database
      return { db, rows, getRemoteSignatureScheme, upsertRemoteSignatureScheme }
    }

    it('reloads a remembered scheme from the database after clearing the in-process cache', async () => {
      const { db, getRemoteSignatureScheme, upsertRemoteSignatureScheme } =
        createMemorySchemeDb()
      mockGetDatabase.mockReturnValue(db)
      responses = [respond(401, INBOX), respond(202, INBOX)]

      await expect(send()).resolves.toMatchObject({ statusCode: 202 })
      expect(upsertRemoteSignatureScheme).toHaveBeenCalledTimes(1)
      expect(upsertRemoteSignatureScheme).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'remote.test',
          scheme: 'rfc9421'
        })
      )

      // Simulate a cold start or another worker with an empty in-process cache.
      clearRememberedSignatureSchemes()
      expect(getRememberedSignatureScheme('remote.test')).toBeNull()
      calls.length = 0

      await expect(send()).resolves.toMatchObject({ statusCode: 202 })
      expect(getRemoteSignatureScheme).toHaveBeenCalledTimes(2)
      expect(calls).toHaveLength(1)
      expect(isRfc9421(calls[0].headers)).toBe(true)
      expect(getRememberedSignatureScheme('remote.test')).toBe('rfc9421')
    })

    it('caches negative database lookups and does not write when cavage works', async () => {
      let now = 1_000_000
      vi.spyOn(Date, 'now').mockImplementation(() => now)
      const { db, getRemoteSignatureScheme, upsertRemoteSignatureScheme } =
        createMemorySchemeDb()
      mockGetDatabase.mockReturnValue(db)

      await send()
      await send()
      now += SIGNATURE_SCHEME_CACHE_TTL_MS - 1
      await send()

      expect(getRemoteSignatureScheme).toHaveBeenCalledTimes(1)
      expect(upsertRemoteSignatureScheme).not.toHaveBeenCalled()
      expect(getRememberedSignatureScheme('remote.test')).toBeNull()

      // Once the short cache TTL expires, the next call re-checks the database.
      now += 2
      await send()
      expect(getRemoteSignatureScheme).toHaveBeenCalledTimes(2)
    })

    it('falls back without failing the request when database reads or writes fail', async () => {
      let now = 1_000_000
      vi.spyOn(Date, 'now').mockImplementation(() => now)
      const brokenDb = {
        getRemoteSignatureScheme: vi
          .fn()
          .mockRejectedValue(new Error('read ECONNREFUSED')),
        upsertRemoteSignatureScheme: vi
          .fn()
          .mockRejectedValue(new Error('write ECONNREFUSED'))
      } as unknown as Database
      mockGetDatabase.mockReturnValue(brokenDb)

      responses = [respond(401, INBOX), respond(202, INBOX)]
      await expect(send()).resolves.toMatchObject({ statusCode: 202 })
      expect(calls).toHaveLength(2)
      expect(isCavage(calls[0].headers)).toBe(true)
      expect(isRfc9421(calls[1].headers)).toBe(true)
      expect(getRememberedSignatureScheme('remote.test')).toBe('rfc9421')

      // Warnings never leak signing keys, passphrases or request bodies.
      expect(mockWarn).toHaveBeenCalledTimes(2)
      for (const [entry] of mockWarn.mock.calls) {
        const serialized = JSON.stringify(entry)
        expect(serialized).not.toContain(BODY)
        expect(serialized).not.toContain(MOCK_SECRET_PHASES)
        expect(serialized).not.toContain('PRIVATE KEY')
      }

      // If the short cache TTL expires while the DB is still down, the stale
      // in-memory scheme still serves as fallback before the 7-day DB TTL ends.
      now += SIGNATURE_SCHEME_CACHE_TTL_MS + 1
      calls.length = 0
      await expect(send()).resolves.toMatchObject({ statusCode: 202 })
      expect(calls).toHaveLength(1)
      expect(isRfc9421(calls[0].headers)).toBe(true)
    })

    it('forgets a database-backed scheme once its stored expiry passes', async () => {
      let now = 1_000_000
      vi.spyOn(Date, 'now').mockImplementation(() => now)
      const { db } = createMemorySchemeDb()
      mockGetDatabase.mockReturnValue(db)

      responses = [respond(401, INBOX), respond(202, INBOX)]
      await send()
      expect(getRememberedSignatureScheme('remote.test')).toBe('rfc9421')

      now += REMOTE_SIGNATURE_SCHEME_TTL_MS + 1
      calls.length = 0
      await send()
      expect(calls).toHaveLength(1)
      expect(isCavage(calls[0].headers)).toBe(true)
      expect(getRememberedSignatureScheme('remote.test')).toBeNull()
    })

    it('lazily refreshes a working stored scheme at most once per refresh interval', async () => {
      let now = 1_000_000
      vi.spyOn(Date, 'now').mockImplementation(() => now)
      const { db, upsertRemoteSignatureScheme } = createMemorySchemeDb()
      mockGetDatabase.mockReturnValue(db)

      responses = [respond(401, INBOX), respond(202, INBOX)]
      await send()
      expect(upsertRemoteSignatureScheme).toHaveBeenCalledTimes(1)

      // Within 24h: working Knock 1 does not write to the DB.
      now += REMOTE_SIGNATURE_SCHEME_REFRESH_INTERVAL_MS - 1000
      await send()
      expect(upsertRemoteSignatureScheme).toHaveBeenCalledTimes(1)

      // Past 24h: working same-host Knock 1 refreshes expiry once, then
      // suppresses further writes for another 24h.
      now += 2000
      await send()
      expect(upsertRemoteSignatureScheme).toHaveBeenCalledTimes(2)
      expect(upsertRemoteSignatureScheme).toHaveBeenLastCalledWith({
        domain: 'remote.test',
        scheme: 'rfc9421',
        expiresAt: now + REMOTE_SIGNATURE_SCHEME_TTL_MS,
        now
      })

      now += 60_000
      await send()
      expect(upsertRemoteSignatureScheme).toHaveBeenCalledTimes(2)
    })
  })
})
