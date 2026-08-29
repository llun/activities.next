import { trace } from '@opentelemetry/api'
import { NextRequest } from 'next/server'
import crypto from 'node:crypto'

import { setupRecordingTracer } from '@/lib/testing/recordingTracer'
import { HttpMethod } from '@/lib/utils/http-headers'

import { ActivityPubVerifySenderGuard } from './ActivityPubVerifyGuard'

const mockCanFederateWithDomain = vi.fn()
const mockDatabase = {}
const mockGetSenderPublicKey = vi.fn()
const mockGetSenderPublicKeyDetails = vi.fn()
const mockVerify = vi.fn()

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
    mockGetSenderPublicKeyDetails(...params)
}))

vi.mock('@/lib/utils/signature', async () => {
  const actual = await vi.importActual('@/lib/utils/signature')

  return {
    ...actual,
    verify: (...params: unknown[]) => mockVerify(...params)
  }
})

const createSignedRawPostRequest = ({
  bodyText,
  keyId = 'https://remote.test/users/alice#main-key',
  signatureHeaders = '(request-target) host date digest',
  host = 'activities.local',
  date = new Date().toUTCString()
}: {
  bodyText: string
  keyId?: string
  signatureHeaders?: string
  host?: string
  date?: string
}) => {
  const digest = crypto.createHash('sha256').update(bodyText).digest('base64')

  return new NextRequest('https://activities.local/api/inbox', {
    method: 'POST',
    headers: {
      date,
      digest: `SHA-256=${digest}`,
      ...(host ? { host } : {}),
      signature: `keyId="${keyId}",algorithm="rsa-sha256",headers="${signatureHeaders}",signature="signature"`
    },
    body: bodyText
  })
}

const createSignedPostRequest = ({
  body,
  keyId
}: {
  body: unknown
  keyId?: string
}) =>
  createSignedRawPostRequest({
    bodyText: JSON.stringify(body),
    keyId
  })

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
  })

  afterEach(() => {
    harness.cleanup()
  })

  it('returns CORS headers on verification errors when methods are provided', async () => {
    const handler = vi.fn()
    const guard = ActivityPubVerifySenderGuard(handler, [
      HttpMethod.enum.OPTIONS,
      HttpMethod.enum.POST
    ])

    const response = await guard(
      new NextRequest('https://activities.local/api/inbox', {
        method: 'POST',
        headers: {
          host: 'activities.local',
          origin: 'https://remote.test'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://remote.test'
    )
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
      'OPTIONS,POST'
    )
    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects stale signed dates', async () => {
    const handler = vi.fn()
    const guard = ActivityPubVerifySenderGuard(handler)

    const response = await guard(
      new NextRequest('https://activities.local/api/inbox', {
        method: 'POST',
        headers: {
          date: 'Wed, 09 Nov 2022 18:28:37 GMT',
          signature:
            'keyId="https://remote.test/users/alice#main-key",algorithm="rsa-sha256",headers="(request-target) host date",signature="signature"'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
    expect(handler).not.toHaveBeenCalled()
    expect(mockCanFederateWithDomain).not.toHaveBeenCalled()
    expect(mockGetSenderPublicKeyDetails).not.toHaveBeenCalled()
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('rejects signed dates too far in the future', async () => {
    const handler = vi.fn()
    const guard = ActivityPubVerifySenderGuard(handler)
    const bodyText = JSON.stringify({
      actor: 'https://remote.test/users/alice',
      type: 'Follow'
    })
    const digest = crypto.createHash('sha256').update(bodyText).digest('base64')
    const futureDate = new Date(Date.now() + 10 * 60 * 1000).toUTCString()

    const response = await guard(
      new NextRequest('https://activities.local/api/inbox', {
        method: 'POST',
        headers: {
          date: futureDate,
          digest: `SHA-256=${digest}`,
          host: 'activities.local',
          signature:
            'keyId="https://remote.test/users/alice#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="signature"'
        },
        body: bodyText
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
    expect(handler).not.toHaveBeenCalled()
    expect(mockCanFederateWithDomain).not.toHaveBeenCalled()
    expect(mockGetSenderPublicKeyDetails).not.toHaveBeenCalled()
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('rejects POST requests without a host header', async () => {
    const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    const guard = ActivityPubVerifySenderGuard(handler)

    const response = await guard(
      createSignedRawPostRequest({
        bodyText: JSON.stringify({
          actor: 'https://remote.test/users/alice',
          type: 'Follow'
        }),
        host: ''
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
    expect(handler).not.toHaveBeenCalled()
    expect(mockCanFederateWithDomain).not.toHaveBeenCalled()
    expect(mockGetSenderPublicKeyDetails).not.toHaveBeenCalled()
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('rejects mutating signatures that do not cover host', async () => {
    const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    const guard = ActivityPubVerifySenderGuard(handler)

    const response = await guard(
      createSignedRawPostRequest({
        bodyText: JSON.stringify({
          actor: 'https://remote.test/users/alice',
          type: 'Follow'
        }),
        signatureHeaders: '(request-target) date digest'
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
    expect(handler).not.toHaveBeenCalled()
    expect(mockCanFederateWithDomain).not.toHaveBeenCalled()
    expect(mockGetSenderPublicKeyDetails).not.toHaveBeenCalled()
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('rejects mutating signatures that do not cover request-target', async () => {
    const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    const guard = ActivityPubVerifySenderGuard(handler)

    const response = await guard(
      createSignedRawPostRequest({
        bodyText: JSON.stringify({
          actor: 'https://remote.test/users/alice',
          type: 'Follow'
        }),
        signatureHeaders: 'host date digest'
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
    expect(handler).not.toHaveBeenCalled()
    expect(mockCanFederateWithDomain).not.toHaveBeenCalled()
    expect(mockGetSenderPublicKeyDetails).not.toHaveBeenCalled()
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('rejects POST requests without a digest header', async () => {
    const handler = vi.fn()
    const guard = ActivityPubVerifySenderGuard(handler)

    const response = await guard(
      new NextRequest('https://activities.local/api/inbox', {
        method: 'POST',
        headers: {
          date: new Date().toUTCString(),
          signature:
            'keyId="https://remote.test/users/alice#main-key",algorithm="rsa-sha256",headers="(request-target) host date",signature="signature"'
        },
        body: JSON.stringify({ type: 'Follow' })
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
    expect(handler).not.toHaveBeenCalled()
    expect(mockCanFederateWithDomain).not.toHaveBeenCalled()
  })

  it('rejects mismatched signed digest headers', async () => {
    const handler = vi.fn()
    const guard = ActivityPubVerifySenderGuard(handler)

    const response = await guard(
      new NextRequest('https://activities.local/api/inbox', {
        method: 'POST',
        headers: {
          date: new Date().toUTCString(),
          digest: 'SHA-256=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          signature:
            'keyId="https://remote.test/users/alice#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="signature"'
        },
        body: JSON.stringify({ type: 'Follow' })
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects POST activities with invalid JSON after validating the digest', async () => {
    const handler = vi.fn()
    const guard = ActivityPubVerifySenderGuard(handler)

    const response = await guard(
      createSignedRawPostRequest({
        bodyText: '{"actor":"https://remote.test/users/alice",'
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
    expect(handler).not.toHaveBeenCalled()
    expect(mockCanFederateWithDomain).not.toHaveBeenCalled()
    expect(mockGetSenderPublicKeyDetails).not.toHaveBeenCalled()
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('accepts a matching sha-256 value from a multi-value signed digest header', async () => {
    const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    const guard = ActivityPubVerifySenderGuard(handler)
    const body = JSON.stringify({
      actor: 'https://remote.test/users/alice',
      type: 'Follow'
    })
    const digest = crypto.createHash('sha256').update(body).digest('base64')

    const response = await guard(
      new NextRequest('https://activities.local/api/inbox', {
        method: 'POST',
        headers: {
          date: new Date().toUTCString(),
          digest: `SHA-512=ignored, SHA-256=${digest}`,
          host: 'activities.local',
          signature:
            'keyId="https://remote.test/users/alice#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="signature"'
        },
        body
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalled()
    expect(handler.mock.calls[0]?.[1]).toMatchObject({
      verifiedSenderActorId: 'https://remote.test/users/alice',
      activityBody: {
        actor: 'https://remote.test/users/alice',
        type: 'Follow'
      }
    })
  })

  it('accepts POST activities whose actor is an object with an id', async () => {
    const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    const guard = ActivityPubVerifySenderGuard(handler)

    const response = await guard(
      createSignedPostRequest({
        body: {
          id: 'https://remote.test/users/alice/activities/create-1',
          type: 'Create',
          actor: {
            id: 'https://remote.test/users/alice',
            type: 'Person'
          }
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalled()
    expect(handler.mock.calls[0]?.[1]).toMatchObject({
      activityBody: {
        actor: 'https://remote.test/users/alice'
      }
    })
  })

  it('includes query strings when verifying GET request targets', async () => {
    const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    const guard = ActivityPubVerifySenderGuard(handler)

    const response = await guard(
      new NextRequest(
        'https://activities.local/api/users/alice/outbox?page=true&min_id=0',
        {
          method: 'GET',
          headers: {
            date: new Date().toUTCString(),
            signature:
              'keyId="https://remote.test/users/alice#main-key",algorithm="rsa-sha256",headers="(request-target) host date",signature="signature"'
          }
        }
      ),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(mockVerify).toHaveBeenCalledWith(
      'get /api/users/alice/outbox?page=true&min_id=0',
      expect.any(Headers),
      'public-key'
    )
  })

  it('rejects POST activities without a string actor', async () => {
    const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    const guard = ActivityPubVerifySenderGuard(handler)

    const response = await guard(
      createSignedPostRequest({
        body: {
          id: 'https://remote.test/users/alice/activities/create-1',
          type: 'Create'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
    expect(handler).not.toHaveBeenCalled()
    expect(mockCanFederateWithDomain).not.toHaveBeenCalled()
    expect(mockGetSenderPublicKeyDetails).not.toHaveBeenCalled()
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('rejects POST activities without a non-empty actor identity', async () => {
    const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    const guard = ActivityPubVerifySenderGuard(handler)

    const response = await guard(
      createSignedPostRequest({
        body: {
          id: 'https://remote.test/users/alice/activities/create-1',
          type: 'Create',
          actor: ''
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
    expect(handler).not.toHaveBeenCalled()
    expect(mockCanFederateWithDomain).not.toHaveBeenCalled()
    expect(mockGetSenderPublicKeyDetails).not.toHaveBeenCalled()
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('rejects POST activities when the signing key owner does not match the activity actor', async () => {
    const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    const guard = ActivityPubVerifySenderGuard(handler)

    const response = await guard(
      createSignedPostRequest({
        body: {
          id: 'https://remote.test/users/mallory/activities/create-1',
          type: 'Create',
          actor: 'https://remote.test/users/mallory'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })

  it('accepts POST activities when a path-based signing key is owned by the activity actor', async () => {
    const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    const guard = ActivityPubVerifySenderGuard(handler)
    const keyId = 'https://remote.test/users/alice/keys/main'

    const response = await guard(
      createSignedPostRequest({
        keyId,
        body: {
          id: 'https://remote.test/users/alice/activities/create-1',
          type: 'Create',
          actor: 'https://remote.test/users/alice'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(mockGetSenderPublicKeyDetails).toHaveBeenCalledWith(
      mockDatabase,
      keyId
    )
    expect(handler).toHaveBeenCalled()
  })

  it('accepts POST activities when actor and key owner only differ by fragment', async () => {
    const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    const guard = ActivityPubVerifySenderGuard(handler)
    mockGetSenderPublicKeyDetails.mockResolvedValue({
      owner: 'https://remote.test/users/alice#main-key',
      publicKey: 'public-key'
    })

    const response = await guard(
      createSignedPostRequest({
        body: {
          id: 'https://remote.test/users/alice/activities/create-1',
          type: 'Create',
          actor: 'https://remote.test/users/alice#activity'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalled()
  })

  describe('rejection trace annotations', () => {
    const runGuardInSpan = async (
      guard: ReturnType<typeof ActivityPubVerifySenderGuard>,
      req: NextRequest
    ) => {
      return trace.getTracer('test').startActiveSpan('api.inbox', async () => {
        return guard(req, { params: Promise.resolve({}) })
      })
    }

    it.each([
      {
        description: 'missing signature header',
        setup: () => {},
        request: () =>
          new NextRequest('https://activities.local/api/inbox', {
            method: 'POST',
            headers: { host: 'activities.local' }
          }),
        expectedStatus: 400,
        expectedReason: 'missing_signature',
        expectedAttributes: {}
      },
      {
        description: 'unparseable signature header without keyId',
        setup: () => {},
        request: () =>
          new NextRequest('https://activities.local/api/inbox', {
            method: 'POST',
            headers: {
              host: 'activities.local',
              signature: 'algorithm="rsa-sha256",signature="signature"'
            }
          }),
        expectedStatus: 400,
        expectedReason: 'unparseable_signature',
        expectedAttributes: {}
      },
      {
        description: 'missing required signed headers',
        setup: () => {},
        request: () =>
          createSignedRawPostRequest({
            bodyText: JSON.stringify({
              actor: 'https://remote.test/users/alice',
              type: 'Follow'
            }),
            signatureHeaders: '(request-target) date digest'
          }),
        expectedStatus: 400,
        expectedReason: 'missing_signed_headers',
        expectedAttributes: {
          'inbox.signed_headers': ['(request-target)', 'date', 'digest'],
          'inbox.has_host_header': true
        }
      },
      {
        description: 'stale date header',
        setup: () => {},
        request: () =>
          createSignedRawPostRequest({
            bodyText: JSON.stringify({
              actor: 'https://remote.test/users/alice',
              type: 'Follow'
            }),
            date: 'Wed, 09 Nov 2022 18:28:37 GMT'
          }),
        expectedStatus: 400,
        expectedReason: 'stale_date',
        expectedAttributes: {
          'inbox.date_header': 'Wed, 09 Nov 2022 18:28:37 GMT',
          'inbox.server_time': expect.any(String)
        }
      },
      {
        description: 'mismatched digest header',
        setup: () => {},
        request: () =>
          new NextRequest('https://activities.local/api/inbox', {
            method: 'POST',
            headers: {
              host: 'activities.local',
              date: new Date().toUTCString(),
              digest: 'SHA-256=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
              signature:
                'keyId="https://remote.test/users/alice#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="signature"'
            },
            body: JSON.stringify({ type: 'Follow' })
          }),
        expectedStatus: 400,
        expectedReason: 'digest_mismatch',
        expectedAttributes: {}
      },
      {
        description: 'invalid activity body JSON',
        setup: () => {},
        request: () =>
          createSignedRawPostRequest({
            bodyText: '{"actor":"https://remote.test/users/alice",'
          }),
        expectedStatus: 400,
        expectedReason: 'invalid_activity_body',
        expectedAttributes: {}
      },
      {
        description: 'domain not federatable',
        setup: () => {
          mockCanFederateWithDomain.mockResolvedValue(false)
        },
        request: () =>
          createSignedPostRequest({
            body: {
              id: 'https://remote.test/users/alice/activities/1',
              type: 'Follow',
              actor: 'https://remote.test/users/alice'
            }
          }),
        expectedStatus: 403,
        expectedReason: 'domain_not_federatable',
        expectedAttributes: {
          'inbox.key_id': 'https://remote.test/users/alice#main-key'
        }
      },
      {
        description: 'key unavailable when sender public key details are empty',
        setup: () => {
          mockGetSenderPublicKeyDetails.mockResolvedValue({
            owner: null,
            publicKey: ''
          })
          mockVerify.mockResolvedValue(false)
        },
        request: () =>
          createSignedPostRequest({
            body: {
              id: 'https://remote.test/users/alice/activities/1',
              type: 'Follow',
              actor: 'https://remote.test/users/alice'
            }
          }),
        expectedStatus: 400,
        expectedReason: 'key_unavailable',
        expectedAttributes: {
          'inbox.key_id': 'https://remote.test/users/alice#main-key'
        }
      },
      {
        description: 'signature invalid when public key is present',
        setup: () => {
          mockGetSenderPublicKeyDetails.mockResolvedValue({
            owner: 'https://remote.test/users/alice',
            publicKey: 'public-key'
          })
          mockVerify.mockResolvedValue(false)
        },
        request: () =>
          createSignedPostRequest({
            body: {
              id: 'https://remote.test/users/alice/activities/1',
              type: 'Follow',
              actor: 'https://remote.test/users/alice'
            }
          }),
        expectedStatus: 400,
        expectedReason: 'signature_invalid',
        expectedAttributes: {
          'inbox.key_id': 'https://remote.test/users/alice#main-key'
        }
      },
      {
        description: 'key owner unresolvable to a valid actor id',
        setup: () => {
          mockGetSenderPublicKeyDetails.mockResolvedValue({
            owner: '_:b0',
            publicKey: 'public-key'
          })
          mockVerify.mockResolvedValue(true)
        },
        request: () =>
          createSignedPostRequest({
            body: {
              id: 'https://remote.test/users/alice/activities/1',
              type: 'Follow',
              actor: 'https://remote.test/users/alice'
            }
          }),
        expectedStatus: 400,
        expectedReason: 'key_owner_unresolvable',
        expectedAttributes: {
          'inbox.key_id': 'https://remote.test/users/alice#main-key',
          'inbox.key_owner': '_:b0'
        }
      },
      {
        description: 'sender actor mismatch with activity actor',
        setup: () => {
          mockGetSenderPublicKeyDetails.mockResolvedValue({
            owner: 'https://remote.test/users/alice',
            publicKey: 'public-key'
          })
          mockVerify.mockResolvedValue(true)
        },
        request: () =>
          createSignedPostRequest({
            body: {
              id: 'https://remote.test/users/mallory/activities/1',
              type: 'Follow',
              actor: 'https://remote.test/users/mallory'
            }
          }),
        expectedStatus: 403,
        expectedReason: 'sender_actor_mismatch',
        expectedAttributes: {
          'inbox.verified_sender': 'https://remote.test/users/alice',
          'inbox.activity_actor': 'https://remote.test/users/mallory'
        }
      }
    ])(
      'annotates $expectedReason for $description',
      async ({
        setup,
        request,
        expectedStatus,
        expectedReason,
        expectedAttributes
      }) => {
        setup()
        const handler = vi.fn()
        const guard = ActivityPubVerifySenderGuard(handler)

        const response = await runGuardInSpan(guard, request())

        expect(response.status).toBe(expectedStatus)
        expect(handler).not.toHaveBeenCalled()
        expect(harness.recordedSpans).toHaveLength(1)
        expect(harness.recordedSpans[0].attributes['inbox.reject_reason']).toBe(
          expectedReason
        )
        if (Object.keys(expectedAttributes).length > 0) {
          expect(harness.recordedSpans[0].attributes).toMatchObject(
            expectedAttributes
          )
        }
      }
    )

    it('does not set reject_reason on a fully valid request', async () => {
      const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
      const guard = ActivityPubVerifySenderGuard(handler)

      const response = await runGuardInSpan(
        guard,
        createSignedPostRequest({
          body: {
            id: 'https://remote.test/users/alice/activities/1',
            type: 'Follow',
            actor: 'https://remote.test/users/alice'
          }
        })
      )

      expect(response.status).toBe(200)
      expect(handler).toHaveBeenCalled()
      expect(harness.recordedSpans).toHaveLength(1)
      expect(
        harness.recordedSpans[0].attributes['inbox.reject_reason']
      ).toBeUndefined()
    })

    it('returns the rejection status without throwing when no span is active', async () => {
      harness.cleanup()
      const handler = vi.fn()
      const guard = ActivityPubVerifySenderGuard(handler)

      const response = await guard(
        new NextRequest('https://activities.local/api/inbox', {
          method: 'POST',
          headers: { host: 'activities.local' }
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(400)
      expect(handler).not.toHaveBeenCalled()
    })

    it('never attaches the raw signature string to span attributes', async () => {
      const secretSignature = 'super-secret-signature-string-12345'
      mockGetSenderPublicKeyDetails.mockResolvedValue({
        owner: 'https://remote.test/users/alice',
        publicKey: 'public-key'
      })
      mockVerify.mockResolvedValue(false)

      const handler = vi.fn()
      const guard = ActivityPubVerifySenderGuard(handler)

      const digest = crypto
        .createHash('sha256')
        .update('{"type":"Follow"}')
        .digest('base64')

      const req = new NextRequest('https://activities.local/api/inbox', {
        method: 'POST',
        headers: {
          date: new Date().toUTCString(),
          digest: `SHA-256=${digest}`,
          host: 'activities.local',
          signature: `keyId="https://remote.test/users/alice#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${secretSignature}"`
        },
        body: '{"type":"Follow"}'
      })

      const response = await runGuardInSpan(guard, req)

      expect(response.status).toBe(400)
      expect(harness.recordedSpans).toHaveLength(1)
      const serializedAttributes = JSON.stringify(
        harness.recordedSpans[0].attributes
      )
      expect(serializedAttributes).not.toContain(secretSignature)
    })

    it('truncates oversized attributes to 500 characters', async () => {
      const longKeyId = 'https://remote.test/users/alice#' + 'a'.repeat(600)
      mockCanFederateWithDomain.mockResolvedValue(false)

      const handler = vi.fn()
      const guard = ActivityPubVerifySenderGuard(handler)

      const response = await runGuardInSpan(
        guard,
        createSignedPostRequest({
          keyId: longKeyId,
          body: {
            id: 'https://remote.test/users/alice/activities/1',
            type: 'Follow',
            actor: 'https://remote.test/users/alice'
          }
        })
      )

      expect(response.status).toBe(403)
      expect(harness.recordedSpans).toHaveLength(1)
      const keyIdAttr = harness.recordedSpans[0].attributes['inbox.key_id']
      expect(typeof keyIdAttr).toBe('string')
      expect((keyIdAttr as string).length).toBe(500)
    })
  })
})
