import { NextRequest } from 'next/server'
import crypto from 'node:crypto'

import { getConfig } from '@/lib/config'
import { signHttpMessage } from '@/lib/utils/httpMessageSignature'

import { ActivityPubVerifySenderGuard } from './ActivityPubVerifyGuard'

const mockCanFederateWithDomain = vi.fn()
const mockClearDeliveryFailuresForDomain = vi.fn()
const mockGetActorFromId = vi.fn()
const mockDatabase = {
  clearDeliveryFailuresForDomain: (...params: unknown[]) =>
    mockClearDeliveryFailuresForDomain(...params),
  getActorFromId: (...params: unknown[]) => mockGetActorFromId(...params)
}
const mockGetSenderPublicKey = vi.fn()
const mockGetSenderPublicKeyDetails = vi.fn()
const mockRefreshSenderPublicKeyDetails = vi.fn()
const mockPersistRefreshedSenderPublicKey = vi.fn()

vi.mock('@/lib/database', async () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/services/federation/domainPolicy', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/lib/services/federation/domainPolicy')
    >()
  return {
    ...actual,
    canFederateWithDomain: (...params: unknown[]) =>
      mockCanFederateWithDomain(...params)
  }
})

vi.mock('@/lib/services/guards/getSenderPublicKey', async () => ({
  getSenderPublicKey: (...params: unknown[]) =>
    mockGetSenderPublicKey(...params),
  getSenderPublicKeyDetails: (...params: unknown[]) =>
    mockGetSenderPublicKeyDetails(...params),
  refreshSenderPublicKeyDetails: (...params: unknown[]) =>
    mockRefreshSenderPublicKeyDetails(...params),
  persistRefreshedSenderPublicKey: (...params: unknown[]) =>
    mockPersistRefreshedSenderPublicKey(...params)
}))

// The draft-cavage path is not under test here; it must never pass.
vi.mock('@/lib/utils/signature', async () => {
  const actual = await vi.importActual('@/lib/utils/signature')
  return { ...actual, verify: () => false }
})

const ACTOR_ID = 'https://remote.test/users/alice'
const KEY_ID = `${ACTOR_ID}#main-key`
const keyPair = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
})

const localUrl = (path: string) => `https://${getConfig().host}${path}`

const signFor = ({
  body,
  method,
  path
}: {
  body?: string
  method: 'GET' | 'POST'
  path: string
}) =>
  signHttpMessage({
    body,
    keyId: KEY_ID,
    method,
    privateKey: keyPair.privateKey,
    url: localUrl(path)
  })

const buildRequest = ({
  body,
  method,
  path,
  signed
}: {
  body?: string
  method: string
  path: string
  signed: ReturnType<typeof signFor>
}) =>
  new NextRequest(localUrl(path), {
    method,
    headers: {
      host: new URL(localUrl(path)).host,
      ...signed.headers
    },
    ...(body === undefined ? {} : { body })
  })

const runGuard = async (request: NextRequest) => {
  const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
  const guard = ActivityPubVerifySenderGuard(handler)
  const response = await guard(request, { params: Promise.resolve({}) })
  return { response, handler }
}

describe('ActivityPubVerifySenderGuard self-interop with signHttpMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCanFederateWithDomain.mockResolvedValue(true)
    mockClearDeliveryFailuresForDomain.mockResolvedValue(undefined)
    mockGetSenderPublicKey.mockResolvedValue(keyPair.publicKey)
    mockGetSenderPublicKeyDetails.mockResolvedValue({
      owner: ACTOR_ID,
      publicKey: keyPair.publicKey
    })
    mockRefreshSenderPublicKeyDetails.mockResolvedValue(null)
    mockPersistRefreshedSenderPublicKey.mockResolvedValue(undefined)
    mockGetActorFromId.mockResolvedValue(null)
  })

  it('accepts a signed GET with a query string', async () => {
    const path = '/api/users/alice/outbox?page=true'
    const signed = signFor({ method: 'GET', path })
    const { response, handler } = await runGuard(
      buildRequest({ method: 'GET', path, signed })
    )

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalled()
  })

  it('accepts a signed POST', async () => {
    const path = '/api/inbox'
    const body = JSON.stringify({
      id: `${ACTOR_ID}/activities/1`,
      type: 'Follow',
      actor: ACTOR_ID
    })
    const signed = signFor({ body, method: 'POST', path })
    const { response, handler } = await runGuard(
      buildRequest({ body, method: 'POST', path, signed })
    )

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalled()
  })

  it('rejects a tampered body', async () => {
    const path = '/api/inbox'
    const signed = signFor({
      body: JSON.stringify({ type: 'Follow', actor: ACTOR_ID }),
      method: 'POST',
      path
    })
    const { response, handler } = await runGuard(
      buildRequest({
        body: JSON.stringify({ type: 'Undo', actor: ACTOR_ID }),
        method: 'POST',
        path,
        signed
      })
    )

    expect(response.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects a tampered method', async () => {
    const path = '/api/inbox'
    const body = JSON.stringify({ type: 'Follow', actor: ACTOR_ID })
    const signed = signFor({ body, method: 'POST', path })
    const { response, handler } = await runGuard(
      buildRequest({ body, method: 'PUT', path, signed })
    )

    expect(response.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects a tampered query', async () => {
    const signed = signFor({
      method: 'GET',
      path: '/api/users/alice/outbox?page=true'
    })
    const { response, handler } = await runGuard(
      buildRequest({
        method: 'GET',
        path: '/api/users/alice/outbox?page=false',
        signed
      })
    )

    expect(response.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects a signature made for another target', async () => {
    const signed = signFor({ method: 'GET', path: '/api/users/alice/outbox' })
    const { response, handler } = await runGuard(
      buildRequest({ method: 'GET', path: '/api/users/bob/outbox', signed })
    )

    expect(response.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })
})
