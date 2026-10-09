import { trace } from '@opentelemetry/api'
import { NextRequest } from 'next/server'
import crypto from 'node:crypto'

import { getConfig } from '@/lib/config'
import { setupRecordingTracer } from '@/lib/testing/recordingTracer'
import { createContentDigestHeader } from '@/lib/utils/contentDigest'
import { logger } from '@/lib/utils/logger'

import { ActivityPubVerifySenderGuard } from './ActivityPubVerifyGuard'
import {
  createSignedPostRequest,
  createSignedRawPostRequest
} from './ActivityPubVerifyGuard.testUtils'

const mockCanFederateWithDomain = vi.fn()
const mockGetActorFromId = vi.fn()
const mockDatabase = {
  getActorFromId: (...params: unknown[]) => mockGetActorFromId(...params)
}
const mockGetSenderPublicKey = vi.fn()
const mockGetSenderPublicKeyDetails = vi.fn()
const mockVerify = vi.fn()
const mockRefreshSenderPublicKeyDetails = vi.fn()
const mockPersistRefreshedSenderPublicKey = vi.fn()

vi.mock('@/lib/database', async () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/services/federation/domainPolicy', async () => ({
  canFederateWithDomain: (...params: unknown[]) =>
    mockCanFederateWithDomain(...params)
}))

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

vi.mock('@/lib/utils/signature', async () => {
  const actual = await vi.importActual('@/lib/utils/signature')

  return {
    ...actual,
    verify: (...params: unknown[]) => mockVerify(...params)
  }
})

const RFC9421_KEY_ID = 'https://remote.test/users/alice#main-key'
// The guard rebuilds the target URI from the trusted host, which in tests is
// the configured one: an untrusted Host header falls back to it.
const getLocalTargetUri = () => `https://${getConfig().host}/api/inbox`
const rsaKeyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const ed25519KeyPair = crypto.generateKeyPairSync('ed25519')
const exportPublicPem = (key: crypto.KeyObject) =>
  key.export({ type: 'spki', format: 'pem' }).toString()
const rsaPublicPem = exportPublicPem(rsaKeyPair.publicKey)
const ed25519PublicPem = exportPublicPem(ed25519KeyPair.publicKey)

const defaultRfc9421Body = JSON.stringify({
  id: 'https://remote.test/users/alice/activities/1',
  type: 'Follow',
  actor: 'https://remote.test/users/alice'
})

// Signs a POST the way an RFC 9421 sender would, building the signature base
// independently of the code under test.
const createRfc9421PostRequest = ({
  bodyText = defaultRfc9421Body,
  components = ['@method', '@target-uri', 'content-digest'],
  privateKey = rsaKeyPair.privateKey,
  alg = 'rsa-v1_5-sha256',
  keyId = RFC9421_KEY_ID,
  createdSec = Math.floor(Date.now() / 1000),
  expiresSec = null,
  signedTargetUri = getLocalTargetUri(),
  contentDigest = createContentDigestHeader(Buffer.from(bodyText)),
  signatureInput,
  extraHeaders = {}
}: {
  bodyText?: string
  components?: string[]
  privateKey?: crypto.KeyObject
  alg?: string | null
  keyId?: string
  createdSec?: number | null
  expiresSec?: number | null
  signedTargetUri?: string
  contentDigest?: string | null
  signatureInput?: string
  extraHeaders?: Record<string, string>
} = {}) => {
  const signedUrl = new URL(signedTargetUri)
  const signatureParams = [
    `(${components.map((component) => `"${component}"`).join(' ')})`,
    createdSec === null ? null : `created=${createdSec}`,
    expiresSec === null ? null : `expires=${expiresSec}`,
    `keyid="${keyId}"`,
    alg === null ? null : `alg="${alg}"`
  ]
    .filter((part): part is string => part !== null)
    .join(';')
  const componentValue = (component: string) => {
    switch (component) {
      case '@method':
        return 'POST'
      case '@target-uri':
        return signedTargetUri
      case '@authority':
        return signedUrl.host
      case '@path':
        return signedUrl.pathname
      case 'content-digest':
        return contentDigest ?? ''
      default:
        return extraHeaders[component] ?? ''
    }
  }
  const signatureBase = [
    ...components.map(
      (component) => `"${component}": ${componentValue(component)}`
    ),
    `"@signature-params": ${signatureParams}`
  ].join('\n')
  const signatureBytes = crypto.sign(
    privateKey.asymmetricKeyType === 'ed25519' ? null : 'sha256',
    Buffer.from(signatureBase),
    privateKey
  )

  const localTargetUri = getLocalTargetUri()
  return new NextRequest(localTargetUri, {
    method: 'POST',
    headers: {
      host: new URL(localTargetUri).host,
      'content-type': 'application/activity+json',
      ...(contentDigest === null ? {} : { 'content-digest': contentDigest }),
      'signature-input': signatureInput ?? `sig1=${signatureParams}`,
      signature: `sig1=:${signatureBytes.toString('base64')}:`,
      ...extraHeaders
    },
    body: bodyText
  })
}

describe('ActivityPubVerifySenderGuard', () => {
  let harness: ReturnType<typeof setupRecordingTracer>

  beforeEach(() => {
    harness = setupRecordingTracer()
    vi.clearAllMocks()
    mockCanFederateWithDomain.mockResolvedValue(true)
    mockGetSenderPublicKey.mockResolvedValue('public-key')
    mockGetSenderPublicKeyDetails.mockResolvedValue({
      owner: 'https://remote.test/users/alice',
      publicKey: 'public-key'
    })
    mockVerify.mockResolvedValue(true)
    mockRefreshSenderPublicKeyDetails.mockResolvedValue(null)
    mockPersistRefreshedSenderPublicKey.mockResolvedValue(undefined)
  })

  afterEach(() => {
    harness.cleanup()
  })

  describe('rotated sender keys', () => {
    const followRequest = () =>
      createSignedPostRequest({
        body: {
          id: 'https://remote.test/users/alice/activities/1',
          type: 'Follow',
          actor: 'https://remote.test/users/alice'
        }
      })

    it('retries with the refreshed key and persists it once it verifies', async () => {
      const refreshed = {
        owner: 'https://remote.test/users/alice',
        publicKey: 'new-key',
        isDefaultKey: true
      }
      mockVerify.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
      mockRefreshSenderPublicKeyDetails.mockResolvedValue(refreshed)
      const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
      const guard = ActivityPubVerifySenderGuard(handler)

      const response = await guard(followRequest(), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(200)
      expect(mockVerify).toHaveBeenCalledTimes(2)
      expect(mockVerify.mock.calls[0]?.[2]).toBe('public-key')
      expect(mockVerify.mock.calls[1]?.[2]).toBe('new-key')
      expect(mockRefreshSenderPublicKeyDetails).toHaveBeenCalledWith(
        mockDatabase,
        'https://remote.test/users/alice#main-key',
        { owner: 'https://remote.test/users/alice', publicKey: 'public-key' }
      )
      expect(mockPersistRefreshedSenderPublicKey).toHaveBeenCalledWith(
        mockDatabase,
        refreshed
      )
      expect(handler).toHaveBeenCalled()
    })

    it('accepts but does not persist a non-default key of a multi-key actor', async () => {
      mockVerify.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
      mockRefreshSenderPublicKeyDetails.mockResolvedValue({
        owner: 'https://remote.test/users/alice',
        publicKey: 'second-key',
        isDefaultKey: false
      })
      const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
      const guard = ActivityPubVerifySenderGuard(handler)

      const response = await guard(followRequest(), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(200)
      expect(mockPersistRefreshedSenderPublicKey).not.toHaveBeenCalled()
    })

    it('still accepts a verified request when persisting the key fails', async () => {
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})
      mockVerify.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
      mockRefreshSenderPublicKeyDetails.mockResolvedValue({
        owner: 'https://remote.test/users/alice',
        publicKey: 'new-key',
        isDefaultKey: true
      })
      mockPersistRefreshedSenderPublicKey.mockRejectedValue(
        new Error('db down')
      )
      const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
      const guard = ActivityPubVerifySenderGuard(handler)

      const response = await guard(followRequest(), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(200)
      expect(handler).toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) })
      )
      errorSpy.mockRestore()
    })

    it('rejects and does not persist when the refreshed key also fails', async () => {
      mockVerify.mockResolvedValue(false)
      mockRefreshSenderPublicKeyDetails.mockResolvedValue({
        owner: 'https://remote.test/users/alice',
        publicKey: 'new-key',
        isDefaultKey: true
      })
      const handler = vi.fn()
      const guard = ActivityPubVerifySenderGuard(handler)

      const response = await guard(followRequest(), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(401)
      expect(mockVerify).toHaveBeenCalledTimes(2)
      expect(mockPersistRefreshedSenderPublicKey).not.toHaveBeenCalled()
      expect(handler).not.toHaveBeenCalled()
    })

    it('does not refresh when no key is available', async () => {
      mockGetSenderPublicKeyDetails.mockResolvedValue({
        owner: null,
        publicKey: ''
      })
      mockVerify.mockResolvedValue(false)
      const guard = ActivityPubVerifySenderGuard(vi.fn())

      const response = await guard(followRequest(), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(401)
      expect(mockRefreshSenderPublicKeyDetails).not.toHaveBeenCalled()
    })

    it('does not refresh when the first verification passes', async () => {
      const guard = ActivityPubVerifySenderGuard(
        vi.fn().mockResolvedValue(Response.json({ ok: true }))
      )

      const response = await guard(followRequest(), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(200)
      expect(mockRefreshSenderPublicKeyDetails).not.toHaveBeenCalled()
      expect(mockPersistRefreshedSenderPublicKey).not.toHaveBeenCalled()
    })
  })

  describe('RFC 9421 signatures', () => {
    const runGuard = async (
      request: NextRequest,
      handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    ) => {
      const guard = ActivityPubVerifySenderGuard(handler)
      const response = await trace
        .getTracer('test')
        .startActiveSpan('api.inbox', async (span) => {
          try {
            return await guard(request, { params: Promise.resolve({}) })
          } finally {
            span.end()
          }
        })
      const inboxSpan = harness.recordedSpans.find(
        (span) => span.name === 'api.inbox'
      )
      return { handler, inboxSpan, response }
    }

    beforeEach(() => {
      mockGetSenderPublicKeyDetails.mockResolvedValue({
        owner: 'https://remote.test/users/alice',
        publicKey: rsaPublicPem
      })
    })

    it('accepts an rsa-v1_5-sha256 signature over @method, @target-uri and content-digest', async () => {
      const { handler, inboxSpan, response } = await runGuard(
        createRfc9421PostRequest()
      )

      expect(response.status).toBe(200)
      expect(mockVerify).not.toHaveBeenCalled()
      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler.mock.calls[0]?.[1]).toMatchObject({
        activityBody: {
          type: 'Follow',
          actor: 'https://remote.test/users/alice'
        },
        forwarded: false,
        verifiedSenderActorId: 'https://remote.test/users/alice'
      })
      expect(inboxSpan?.attributes['inbox.reject_reason']).toBeUndefined()
    })

    it('treats an explicit :443 in Host like @authority does for @target-uri', async () => {
      const { handler, response } = await runGuard(
        createRfc9421PostRequest({
          extraHeaders: { host: `${getConfig().host}:443` }
        })
      )

      expect(response.status).toBe(200)
      expect(handler).toHaveBeenCalled()
    })

    it('accepts a signature covering @authority and @path instead of @target-uri', async () => {
      const { handler, response } = await runGuard(
        createRfc9421PostRequest({
          components: ['@method', '@authority', '@path', 'content-digest']
        })
      )

      expect(response.status).toBe(200)
      expect(handler).toHaveBeenCalled()
    })

    it('accepts an ed25519 signature without an alg parameter', async () => {
      mockGetSenderPublicKeyDetails.mockResolvedValue({
        owner: 'https://remote.test/users/alice',
        publicKey: ed25519PublicPem
      })

      const { handler, response } = await runGuard(
        createRfc9421PostRequest({
          privateKey: ed25519KeyPair.privateKey,
          alg: null
        })
      )

      expect(response.status).toBe(200)
      expect(handler).toHaveBeenCalled()
    })

    it.each([
      {
        description: 'a POST signature that does not cover content-digest',
        request: () =>
          createRfc9421PostRequest({ components: ['@method', '@target-uri'] }),
        expectedReason: 'missing_signed_headers',
        expectedAttributes: {
          'inbox.signed_headers': ['@method', '@target-uri']
        }
      },
      {
        description: 'a Content-Digest that does not match the body',
        request: () =>
          createRfc9421PostRequest({
            contentDigest: createContentDigestHeader(
              Buffer.from('{"tampered":true}')
            )
          }),
        expectedReason: 'digest_mismatch',
        expectedAttributes: {}
      },
      {
        description: 'a covered Content-Digest header that is missing',
        request: () => createRfc9421PostRequest({ contentDigest: null }),
        expectedReason: 'digest_mismatch',
        expectedAttributes: {}
      },
      {
        description: 'a signature without a created parameter',
        request: () => createRfc9421PostRequest({ createdSec: null }),
        expectedReason: 'stale_date',
        expectedAttributes: {}
      },
      {
        description: 'a signature created 14 hours ago',
        request: () =>
          createRfc9421PostRequest({
            createdSec: Math.floor(Date.now() / 1000) - 14 * 60 * 60
          }),
        expectedReason: 'stale_date',
        expectedAttributes: {
          'inbox.created_param': expect.any(String)
        }
      },
      {
        description: 'a signature created 2 hours in the future',
        request: () =>
          createRfc9421PostRequest({
            createdSec: Math.floor(Date.now() / 1000) + 2 * 60 * 60
          }),
        expectedReason: 'stale_date',
        expectedAttributes: {
          'inbox.created_param': expect.any(String)
        }
      },
      {
        description: 'a signature that expired 2 hours ago',
        request: () =>
          createRfc9421PostRequest({
            createdSec: Math.floor(Date.now() / 1000) - 3 * 60 * 60,
            expiresSec: Math.floor(Date.now() / 1000) - 2 * 60 * 60
          }),
        expectedReason: 'stale_date',
        expectedAttributes: {}
      },
      {
        description: 'an unparseable Signature-Input',
        request: () =>
          createRfc9421PostRequest({
            signatureInput: 'sig1=("@method" "@target-uri"'
          }),
        expectedReason: 'unparseable_signature',
        expectedAttributes: {}
      }
    ])(
      'rejects $description before fetching the key',
      async ({ request, expectedReason, expectedAttributes }) => {
        const { handler, inboxSpan, response } = await runGuard(request())

        expect(response.status).toBe(401)
        expect(handler).not.toHaveBeenCalled()
        expect(mockCanFederateWithDomain).not.toHaveBeenCalled()
        expect(mockGetSenderPublicKeyDetails).not.toHaveBeenCalled()
        expect(mockVerify).not.toHaveBeenCalled()
        expect(inboxSpan?.attributes).toMatchObject({
          'inbox.reject_reason': expectedReason,
          'inbox.signature_scheme': 'rfc9421',
          ...expectedAttributes
        })
      }
    )

    it.each([
      { description: 'another host', uri: 'https://evil.test/api/inbox' },
      {
        description: 'another path',
        uri: () => getLocalTargetUri().replace('/api/inbox', '/api/other')
      },
      {
        description: 'an untrusted Host header rather than ours',
        uri: 'https://activities.local/api/inbox'
      }
    ])('rejects a signature made for $description', async ({ uri }) => {
      const { handler, inboxSpan, response } = await runGuard(
        createRfc9421PostRequest({
          signedTargetUri: typeof uri === 'function' ? uri() : uri,
          extraHeaders: { host: 'activities.local' }
        })
      )

      expect(response.status).toBe(401)
      expect(handler).not.toHaveBeenCalled()
      expect(inboxSpan?.attributes).toMatchObject({
        'inbox.reject_reason': 'signature_invalid',
        'inbox.signature_scheme': 'rfc9421',
        'inbox.key_id': RFC9421_KEY_ID
      })
    })

    it('rejects an alg that does not match the key type', async () => {
      const { handler, inboxSpan, response } = await runGuard(
        createRfc9421PostRequest({ alg: 'ed25519' })
      )

      expect(response.status).toBe(401)
      expect(handler).not.toHaveBeenCalled()
      expect(inboxSpan?.attributes['inbox.reject_reason']).toBe(
        'signature_invalid'
      )
    })

    it('rejects with key_unavailable when no key resolves', async () => {
      mockGetSenderPublicKeyDetails.mockResolvedValue({
        owner: null,
        publicKey: ''
      })

      const { inboxSpan, response } = await runGuard(createRfc9421PostRequest())

      expect(response.status).toBe(401)
      expect(mockRefreshSenderPublicKeyDetails).not.toHaveBeenCalled()
      expect(inboxSpan?.attributes['inbox.reject_reason']).toBe(
        'key_unavailable'
      )
    })

    it('resolves the keyid exactly as the draft-cavage path does', async () => {
      const keyId = 'https://remote.test/users/alice/main-key'

      const { response } = await runGuard(createRfc9421PostRequest({ keyId }))

      expect(response.status).toBe(200)
      expect(mockCanFederateWithDomain).toHaveBeenCalledWith(
        mockDatabase,
        keyId
      )
      expect(mockGetSenderPublicKeyDetails).toHaveBeenCalledWith(
        mockDatabase,
        keyId
      )
    })

    it('rejects with 403 when the keyid domain is not federatable', async () => {
      mockCanFederateWithDomain.mockResolvedValue(false)

      const { handler, inboxSpan, response } = await runGuard(
        createRfc9421PostRequest()
      )

      expect(response.status).toBe(403)
      expect(handler).not.toHaveBeenCalled()
      expect(mockGetSenderPublicKeyDetails).not.toHaveBeenCalled()
      expect(inboxSpan?.attributes).toMatchObject({
        'inbox.reject_reason': 'domain_not_federatable',
        'inbox.signature_scheme': 'rfc9421'
      })
    })

    it('marks a delivery signed by another actor as forwarded', async () => {
      mockGetSenderPublicKeyDetails.mockResolvedValue({
        owner: 'https://remote.test/users/bob',
        publicKey: rsaPublicPem
      })

      const { handler, response } = await runGuard(
        createRfc9421PostRequest({
          keyId: 'https://remote.test/users/bob#main-key'
        })
      )

      expect(response.status).toBe(200)
      expect(handler.mock.calls[0]?.[1]).toMatchObject({
        forwarded: true,
        verifiedSenderActorId: 'https://remote.test/users/bob'
      })
    })

    it('retries with a refreshed key when the sender rotated its key', async () => {
      const oldKeyPair = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048
      })
      const storedKey = {
        owner: 'https://remote.test/users/alice',
        publicKey: exportPublicPem(oldKeyPair.publicKey)
      }
      const refreshed = {
        owner: 'https://remote.test/users/alice',
        publicKey: rsaPublicPem,
        isDefaultKey: true
      }
      mockGetSenderPublicKeyDetails.mockResolvedValue(storedKey)
      mockRefreshSenderPublicKeyDetails.mockResolvedValue(refreshed)

      const { handler, response } = await runGuard(createRfc9421PostRequest())

      expect(response.status).toBe(200)
      expect(handler).toHaveBeenCalled()
      expect(mockRefreshSenderPublicKeyDetails).toHaveBeenCalledWith(
        mockDatabase,
        RFC9421_KEY_ID,
        storedKey
      )
      expect(mockPersistRefreshedSenderPublicKey).toHaveBeenCalledWith(
        mockDatabase,
        refreshed
      )
    })

    it('never attaches the raw signature bytes to any span', async () => {
      mockGetSenderPublicKeyDetails.mockResolvedValue({
        owner: 'https://remote.test/users/alice',
        publicKey: ed25519PublicPem
      })
      const request = createRfc9421PostRequest()
      const signatureHeader = request.headers.get('signature') ?? ''
      const encodedSignature = signatureHeader.slice(
        'sig1=:'.length,
        signatureHeader.length - 1
      )

      const { response } = await runGuard(request)

      expect(response.status).toBe(401)
      expect(encodedSignature.length).toBeGreaterThan(100)
      const serialized = JSON.stringify(
        harness.recordedSpans.map((span) => span.attributes)
      )
      expect(serialized).not.toContain(encodedSignature)
      expect(serialized).not.toContain(
        Buffer.from(encodedSignature, 'base64').toString('hex')
      )
    })

    describe('draft-cavage requests that also send Content-Digest', () => {
      const bodyText = defaultRfc9421Body

      it('rejects a Content-Digest that contradicts the body', async () => {
        const request = createSignedRawPostRequest({ bodyText })
        request.headers.set(
          'content-digest',
          createContentDigestHeader(Buffer.from('{"other":true}'))
        )

        const { handler, inboxSpan, response } = await runGuard(request)

        expect(response.status).toBe(401)
        expect(handler).not.toHaveBeenCalled()
        expect(mockVerify).not.toHaveBeenCalled()
        expect(inboxSpan?.attributes['inbox.reject_reason']).toBe(
          'digest_mismatch'
        )
        expect('inbox.signature_scheme' in (inboxSpan?.attributes ?? {})).toBe(
          false
        )
      })

      it('rejects a malformed Content-Digest', async () => {
        const request = createSignedRawPostRequest({ bodyText })
        request.headers.set('content-digest', 'sha-256=not-bytes')

        const { response } = await runGuard(request)

        expect(response.status).toBe(401)
      })

      it('accepts a Content-Digest that matches the body', async () => {
        const request = createSignedRawPostRequest({ bodyText })
        request.headers.set(
          'content-digest',
          createContentDigestHeader(Buffer.from(bodyText))
        )

        const { handler, response } = await runGuard(request)

        expect(response.status).toBe(200)
        expect(mockVerify).toHaveBeenCalled()
        expect(handler).toHaveBeenCalled()
      })
    })
  })
})
