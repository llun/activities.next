import crypto from 'node:crypto'

import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { MOCK_SECRET_PHASES } from '@/lib/stub/actor'
import { Actor } from '@/lib/types/domain/actor'
import { verify } from '@/lib/utils/signature'

import {
  clearRememberedSignatureSchemes,
  getRememberedSignatureScheme,
  rememberSignatureScheme,
  signedActivityPubRequest
} from './signedRequest'

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
    expect(otherHostHeaders).toEqual({ accept: expect.any(String) })
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

    now += 6 * 60 * 60 * 1000 + 1
    expect(getRememberedSignatureScheme('remote.test')).toBeNull()
  })
})
