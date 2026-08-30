import { trace } from '@opentelemetry/api'
import { NextRequest } from 'next/server'
import crypto from 'node:crypto'

import { setupRecordingTracer } from '@/lib/testing/recordingTracer'
import { HttpMethod } from '@/lib/utils/http-headers'

import { ActivityPubVerifySenderGuard } from './ActivityPubVerifyGuard'

const mockCanFederateWithDomain = vi.fn()
const mockGetActorFromId = vi.fn()
const mockDatabase = {
  getActorFromId: (...params: unknown[]) => mockGetActorFromId(...params)
}
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

    expect(response.status).toBe(401)
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
            'keyId="https://remote.test/users/alice#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="signature"'
        }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(401)
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
    // 2 hours in the future exceeds the 1 hour clock skew margin
    const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toUTCString()

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

    expect(response.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
    expect(mockCanFederateWithDomain).not.toHaveBeenCalled()
    expect(mockGetSenderPublicKeyDetails).not.toHaveBeenCalled()
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('accepts POST requests without a host header', async () => {
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

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalled()
  })

  it('accepts POST signatures that do not cover host', async () => {
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

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalled()
  })

  it('rejects POST signatures that do not cover digest', async () => {
    const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    const guard = ActivityPubVerifySenderGuard(handler)

    const response = await guard(
      createSignedRawPostRequest({
        bodyText: JSON.stringify({
          actor: 'https://remote.test/users/alice',
          type: 'Follow'
        }),
        signatureHeaders: '(request-target) host date'
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(401)
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

    expect(response.status).toBe(401)
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

    expect(response.status).toBe(401)
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

    expect(response.status).toBe(401)
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
      forwarded: false,
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

  it('includes query strings when verifying GET request targets and enforces host header for GET', async () => {
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

  it('rejects GET requests when host is not in signed headers', async () => {
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
              'keyId="https://remote.test/users/alice#main-key",algorithm="rsa-sha256",headers="(request-target) date",signature="signature"'
          }
        }
      ),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
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

    expect(response.status).toBe(401)
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

    expect(response.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
    expect(mockCanFederateWithDomain).not.toHaveBeenCalled()
    expect(mockGetSenderPublicKeyDetails).not.toHaveBeenCalled()
    expect(mockVerify).not.toHaveBeenCalled()
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

  describe('freshness window', () => {
    const fixedNow = new Date('2026-08-29T12:00:00.000Z').getTime()

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(fixedNow)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('accepts date signed 11 hours ago (within 12h limit + 1h margin)', async () => {
      const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
      const guard = ActivityPubVerifySenderGuard(handler)
      const date11hAgo = new Date(fixedNow - 11 * 60 * 60 * 1000).toUTCString()

      const response = await guard(
        createSignedRawPostRequest({
          bodyText: JSON.stringify({
            actor: 'https://remote.test/users/alice',
            type: 'Follow'
          }),
          date: date11hAgo
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(handler).toHaveBeenCalled()
    })

    it('rejects date signed 14 hours and 1 second ago (> 12h limit + 1h margin)', async () => {
      const handler = vi.fn()
      const guard = ActivityPubVerifySenderGuard(handler)
      const date14h1sAgo = new Date(
        fixedNow - (14 * 60 * 60 * 1000 + 1000)
      ).toUTCString()

      const response = await guard(
        createSignedRawPostRequest({
          bodyText: JSON.stringify({
            actor: 'https://remote.test/users/alice',
            type: 'Follow'
          }),
          date: date14h1sAgo
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(401)
      expect(handler).not.toHaveBeenCalled()
    })

    it('accepts date signed 30 minutes in the future (within 1h future margin)', async () => {
      const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
      const guard = ActivityPubVerifySenderGuard(handler)
      const date30mFuture = new Date(fixedNow + 30 * 60 * 1000).toUTCString()

      const response = await guard(
        createSignedRawPostRequest({
          bodyText: JSON.stringify({
            actor: 'https://remote.test/users/alice',
            type: 'Follow'
          }),
          date: date30mFuture
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(handler).toHaveBeenCalled()
    })

    it('rejects date signed 2 hours in the future (> 1h future margin)', async () => {
      const handler = vi.fn()
      const guard = ActivityPubVerifySenderGuard(handler)
      const date2hFuture = new Date(fixedNow + 2 * 60 * 60 * 1000).toUTCString()

      const response = await guard(
        createSignedRawPostRequest({
          bodyText: JSON.stringify({
            actor: 'https://remote.test/users/alice',
            type: 'Follow'
          }),
          date: date2hFuture
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(401)
      expect(handler).not.toHaveBeenCalled()
    })

    it('accepts hs2019 (created) timestamp signed 11 hours ago', async () => {
      const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
      const guard = ActivityPubVerifySenderGuard(handler)
      const created11hAgo = Math.floor((fixedNow - 11 * 60 * 60 * 1000) / 1000)
      const bodyText = JSON.stringify({
        actor: 'https://remote.test/users/alice',
        type: 'Follow'
      })
      const digest = crypto
        .createHash('sha256')
        .update(bodyText)
        .digest('base64')

      const response = await guard(
        new NextRequest('https://activities.local/api/inbox', {
          method: 'POST',
          headers: {
            digest: `SHA-256=${digest}`,
            signature: `keyId="https://remote.test/users/alice#main-key",algorithm="hs2019",headers="(request-target) (created) digest",signature="sig",created=${created11hAgo}`
          },
          body: bodyText
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(handler).toHaveBeenCalled()
    })

    it('rejects when (expires) timestamp was in the past beyond margin', async () => {
      const handler = vi.fn()
      const guard = ActivityPubVerifySenderGuard(handler)
      const created2hAgo = Math.floor((fixedNow - 2 * 60 * 60 * 1000) / 1000)
      const expires1h30mAgo = Math.floor(
        (fixedNow - (1 * 60 * 60 * 1000 + 30 * 60 * 1000)) / 1000
      )
      const bodyText = JSON.stringify({
        actor: 'https://remote.test/users/alice',
        type: 'Follow'
      })
      const digest = crypto
        .createHash('sha256')
        .update(bodyText)
        .digest('base64')

      const response = await guard(
        new NextRequest('https://activities.local/api/inbox', {
          method: 'POST',
          headers: {
            digest: `SHA-256=${digest}`,
            signature: `keyId="https://remote.test/users/alice#main-key",algorithm="hs2019",headers="(request-target) (created) digest",signature="sig",created=${created2hAgo},expires=${expires1h30mAgo}`
          },
          body: bodyText
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(401)
      expect(handler).not.toHaveBeenCalled()
    })

    it('clamps (expires) to created + 12h when expires is set far into the future', async () => {
      const handler = vi.fn()
      const guard = ActivityPubVerifySenderGuard(handler)
      // created 14 hours ago, with expires set 48h in future -> clamped effectiveExpiry = created + 12h = 2h ago.
      // With 1h skew margin, effectiveExpiry + 1h = 1h ago, so now > effectiveExpiry + 1h -> rejected!
      const created14hAgo = Math.floor((fixedNow - 14 * 60 * 60 * 1000) / 1000)
      const expires48hFuture = Math.floor(
        (fixedNow + 48 * 60 * 60 * 1000) / 1000
      )
      const bodyText = JSON.stringify({
        actor: 'https://remote.test/users/alice',
        type: 'Follow'
      })
      const digest = crypto
        .createHash('sha256')
        .update(bodyText)
        .digest('base64')

      const response = await guard(
        new NextRequest('https://activities.local/api/inbox', {
          method: 'POST',
          headers: {
            digest: `SHA-256=${digest}`,
            signature: `keyId="https://remote.test/users/alice#main-key",algorithm="hs2019",headers="(request-target) (created) digest",signature="sig",created=${created14hAgo},expires=${expires48hFuture}`
          },
          body: bodyText
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(401)
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('unknown-actor fast-path (unknown_affected_account?)', () => {
    it('returns 202 immediately for Delete of unknown actor without fetching public key', async () => {
      mockGetActorFromId.mockResolvedValue(null)
      const handler = vi.fn()
      const guard = ActivityPubVerifySenderGuard(handler)

      const deleteBody = {
        id: 'https://remote.test/users/deleted-user#delete',
        type: 'Delete',
        actor: 'https://remote.test/users/deleted-user',
        object: 'https://remote.test/users/deleted-user'
      }

      const response = await guard(
        createSignedPostRequest({
          keyId: 'https://remote.test/users/deleted-user#main-key',
          body: deleteBody
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(202)
      expect(handler).not.toHaveBeenCalled()
      expect(mockGetSenderPublicKeyDetails).not.toHaveBeenCalled()
      expect(mockVerify).not.toHaveBeenCalled()
    })

    it('returns 202 immediately for Update of unknown actor when object is an embedded { id } object', async () => {
      mockGetActorFromId.mockResolvedValue(null)
      const handler = vi.fn()
      const guard = ActivityPubVerifySenderGuard(handler)

      const updateBody = {
        id: 'https://remote.test/users/deleted-user#update',
        type: 'Update',
        actor: 'https://remote.test/users/deleted-user',
        object: {
          id: 'https://remote.test/users/deleted-user',
          type: 'Person'
        }
      }

      const response = await guard(
        createSignedPostRequest({
          keyId: 'https://remote.test/users/deleted-user#main-key',
          body: updateBody
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(202)
      expect(handler).not.toHaveBeenCalled()
      expect(mockGetSenderPublicKeyDetails).not.toHaveBeenCalled()
      expect(mockVerify).not.toHaveBeenCalled()
    })

    it('falls through to full verification when Delete is for a KNOWN actor in the local database', async () => {
      mockGetActorFromId.mockResolvedValue({
        id: 'https://remote.test/users/alice',
        username: 'alice'
      })
      const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
      const guard = ActivityPubVerifySenderGuard(handler)

      const deleteBody = {
        id: 'https://remote.test/users/alice#delete',
        type: 'Delete',
        actor: 'https://remote.test/users/alice',
        object: 'https://remote.test/users/alice'
      }

      const response = await guard(
        createSignedPostRequest({
          keyId: 'https://remote.test/users/alice#main-key',
          body: deleteBody
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(mockGetSenderPublicKeyDetails).toHaveBeenCalled()
      expect(mockVerify).toHaveBeenCalled()
      expect(handler).toHaveBeenCalled()
    })

    it('falls through to full verification when Update actor does not match object id', async () => {
      mockGetActorFromId.mockResolvedValue(null)
      const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
      const guard = ActivityPubVerifySenderGuard(handler)

      const updateNoteBody = {
        id: 'https://remote.test/users/alice/activities/update-note',
        type: 'Update',
        actor: 'https://remote.test/users/alice',
        object: 'https://remote.test/users/alice/statuses/123'
      }

      const response = await guard(
        createSignedPostRequest({
          keyId: 'https://remote.test/users/alice#main-key',
          body: updateNoteBody
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(mockGetSenderPublicKeyDetails).toHaveBeenCalled()
      expect(mockVerify).toHaveBeenCalled()
      expect(handler).toHaveBeenCalled()
    })
  })

  describe('payload cap (MAX_ACTIVITY_JSON_BYTES)', () => {
    it('rejects with 413 when content-length exceeds 1 MB', async () => {
      const handler = vi.fn()
      const guard = ActivityPubVerifySenderGuard(handler)

      const response = await guard(
        new NextRequest('https://activities.local/api/inbox', {
          method: 'POST',
          headers: {
            'content-length': '1048577',
            signature:
              'keyId="https://remote.test/users/alice#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="signature"'
          },
          body: '{"type":"Follow"}'
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(413)
      expect(handler).not.toHaveBeenCalled()
    })

    it('passes when content-length header is absent', async () => {
      const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
      const guard = ActivityPubVerifySenderGuard(handler)

      const response = await guard(
        createSignedPostRequest({
          body: {
            id: 'https://remote.test/users/alice/activities/1',
            type: 'Follow',
            actor: 'https://remote.test/users/alice'
          }
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(handler).toHaveBeenCalled()
    })
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
        expectedStatus: 401,
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
        expectedStatus: 401,
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
            signatureHeaders: '(request-target) host date'
          }),
        expectedStatus: 401,
        expectedReason: 'missing_signed_headers',
        expectedAttributes: {
          'inbox.signed_headers': ['(request-target)', 'host', 'date']
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
        expectedStatus: 401,
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
        expectedStatus: 401,
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
        expectedStatus: 401,
        expectedReason: 'invalid_activity_body',
        expectedAttributes: {
          'inbox.error': 'json_parse_error'
        }
      },
      {
        description: 'activity body without actor',
        setup: () => {},
        request: () =>
          createSignedPostRequest({
            body: {
              id: 'https://remote.test/users/alice/activities/1',
              type: 'Follow'
            }
          }),
        expectedStatus: 401,
        expectedReason: 'invalid_activity_body',
        expectedAttributes: {
          'inbox.error': 'missing_actor'
        }
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
          'inbox.key_id': 'https://remote.test/users/alice#main-key',
          'inbox.activity_id': 'https://remote.test/users/alice/activities/1',
          'inbox.activity_type': 'Follow',
          'inbox.activity_actor': 'https://remote.test/users/alice'
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
        expectedStatus: 401,
        expectedReason: 'key_unavailable',
        expectedAttributes: {
          'inbox.key_id': 'https://remote.test/users/alice#main-key',
          'inbox.activity_id': 'https://remote.test/users/alice/activities/1',
          'inbox.activity_type': 'Follow',
          'inbox.activity_actor': 'https://remote.test/users/alice'
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
        expectedStatus: 401,
        expectedReason: 'signature_invalid',
        expectedAttributes: {
          'inbox.key_id': 'https://remote.test/users/alice#main-key',
          'inbox.activity_id': 'https://remote.test/users/alice/activities/1',
          'inbox.activity_type': 'Follow',
          'inbox.activity_actor': 'https://remote.test/users/alice'
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
        expectedStatus: 401,
        expectedReason: 'key_owner_unresolvable',
        expectedAttributes: {
          'inbox.key_id': 'https://remote.test/users/alice#main-key',
          'inbox.key_owner': '_:b0',
          'inbox.activity_id': 'https://remote.test/users/alice/activities/1',
          'inbox.activity_type': 'Follow',
          'inbox.activity_actor': 'https://remote.test/users/alice'
        }
      },
      {
        description: 'payload too large when content-length exceeds 1 MB',
        setup: () => {},
        request: () =>
          new NextRequest('https://activities.local/api/inbox', {
            method: 'POST',
            headers: {
              host: 'activities.local',
              'content-length': '1048577',
              signature:
                'keyId="https://remote.test/users/alice#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="signature"'
            },
            body: '{"type":"Follow"}'
          }),
        expectedStatus: 413,
        expectedReason: 'payload_too_large',
        expectedAttributes: {
          'inbox.content_length': 1048577
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

      expect(response.status).toBe(401)
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

      const bodyText = JSON.stringify({
        type: 'Follow',
        actor: 'https://remote.test/users/alice'
      })
      const digest = crypto
        .createHash('sha256')
        .update(bodyText)
        .digest('base64')

      const req = new NextRequest('https://activities.local/api/inbox', {
        method: 'POST',
        headers: {
          date: new Date().toUTCString(),
          digest: `SHA-256=${digest}`,
          host: 'activities.local',
          signature: `keyId="https://remote.test/users/alice#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${secretSignature}"`
        },
        body: bodyText
      })

      const response = await runGuardInSpan(guard, req)

      expect(response.status).toBe(401)
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

    it('skips undefined extra attributes without stamping them on the span', async () => {
      mockGetSenderPublicKeyDetails.mockResolvedValue({
        owner: null,
        publicKey: ''
      })
      mockVerify.mockResolvedValue(false)

      const handler = vi.fn()
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

      expect(response.status).toBe(401)
      expect(harness.recordedSpans).toHaveLength(1)
      expect('inbox.key_owner' in harness.recordedSpans[0].attributes).toBe(
        false
      )
    })

    it('does not set attributes when the active span is not recording', async () => {
      const handler = vi.fn()
      const guard = ActivityPubVerifySenderGuard(handler)

      const setAttributeSpy = vi.fn()
      const nonRecordingSpan = {
        isRecording: () => false,
        setAttribute: setAttributeSpy,
        setStatus: vi.fn()
      }

      const spy = vi
        .spyOn(trace, 'getActiveSpan')
        .mockReturnValue(nonRecordingSpan as never)

      const response = await guard(
        new NextRequest('https://activities.local/api/inbox', {
          method: 'POST',
          headers: { host: 'activities.local' }
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(401)
      expect(setAttributeSpy).not.toHaveBeenCalled()
      spy.mockRestore()
    })

    it('passes a forwarded delivery to the handler with forwarded true', async () => {
      mockGetSenderPublicKeyDetails.mockResolvedValue({
        owner: 'https://remote.test/users/alice',
        publicKey: 'public-key'
      })
      mockVerify.mockResolvedValue(true)

      const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
      const guard = ActivityPubVerifySenderGuard(handler)

      const response = await runGuardInSpan(
        guard,
        createSignedPostRequest({
          body: {
            id: 'https://remote.test/users/mallory/activities/1',
            type: 'Follow',
            actor: 'https://remote.test/users/mallory',
            object: 'https://activities.local/users/bob'
          }
        })
      )

      expect(response.status).toBe(200)
      expect(handler).toHaveBeenCalled()
      expect(handler.mock.calls[0]?.[1]).toMatchObject({
        forwarded: true,
        verifiedSenderActorId: 'https://remote.test/users/alice',
        activityBody: {
          id: 'https://remote.test/users/mallory/activities/1',
          type: 'Follow',
          actor: 'https://remote.test/users/mallory',
          object: 'https://activities.local/users/bob'
        }
      })
      expect(harness.recordedSpans).toHaveLength(1)
      expect(harness.recordedSpans[0].attributes).toMatchObject({
        'inbox.forwarded': true,
        'inbox.verified_sender': 'https://remote.test/users/alice',
        'inbox.activity_actor': 'https://remote.test/users/mallory'
      })
      expect('inbox.reject_reason' in harness.recordedSpans[0].attributes).toBe(
        false
      )
    })

    it('passes a direct delivery with forwarded false', async () => {
      mockGetSenderPublicKeyDetails.mockResolvedValue({
        owner: 'https://remote.test/users/alice',
        publicKey: 'public-key'
      })
      mockVerify.mockResolvedValue(true)

      const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }))
      const guard = ActivityPubVerifySenderGuard(handler)

      const response = await guard(
        createSignedPostRequest({
          body: {
            id: 'https://remote.test/users/alice/activities/1',
            type: 'Follow',
            actor: 'https://remote.test/users/alice'
          }
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect(handler).toHaveBeenCalled()
      expect(handler.mock.calls[0]?.[1]).toMatchObject({
        forwarded: false,
        verifiedSenderActorId: 'https://remote.test/users/alice'
      })
    })
  })
})
