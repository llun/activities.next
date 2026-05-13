import { NextRequest } from 'next/server'
import crypto from 'node:crypto'

import { HttpMethod } from '@/lib/utils/getCORSHeaders'

import { ActivityPubVerifySenderGuard } from './ActivityPubVerifyGuard'

const mockCanFederateWithDomain = jest.fn()
const mockDatabase = {}
const mockGetSenderPublicKey = jest.fn()
const mockGetSenderPublicKeyDetails = jest.fn()
const mockVerify = jest.fn()

jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: (...params: unknown[]) =>
    mockCanFederateWithDomain(...params)
}))

jest.mock('@/lib/services/guards/getSenderPublicKey', () => ({
  getSenderPublicKey: (...params: unknown[]) =>
    mockGetSenderPublicKey(...params),
  getSenderPublicKeyDetails: (...params: unknown[]) =>
    mockGetSenderPublicKeyDetails(...params)
}))

jest.mock('@/lib/utils/signature', () => {
  const actual = jest.requireActual('@/lib/utils/signature')

  return {
    ...actual,
    verify: (...params: unknown[]) => mockVerify(...params)
  }
})

const createSignedRawPostRequest = ({
  bodyText,
  keyId = 'https://remote.test/users/alice#main-key',
  signatureHeaders = '(request-target) host date digest',
  host = 'activities.local'
}: {
  bodyText: string
  keyId?: string
  signatureHeaders?: string
  host?: string
}) => {
  const digest = crypto.createHash('sha256').update(bodyText).digest('base64')

  return new NextRequest('https://activities.local/api/inbox', {
    method: 'POST',
    headers: {
      date: new Date().toUTCString(),
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
  beforeEach(() => {
    jest.clearAllMocks()
    mockCanFederateWithDomain.mockResolvedValue(true)
    mockGetSenderPublicKey.mockResolvedValue('public-key')
    mockGetSenderPublicKeyDetails.mockResolvedValue({
      owner: 'https://remote.test/users/alice',
      publicKey: 'public-key'
    })
    mockVerify.mockResolvedValue(true)
  })

  it('returns CORS headers on verification errors when methods are provided', async () => {
    const handler = jest.fn()
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
    const handler = jest.fn()
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
    const handler = jest.fn()
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
    const handler = jest.fn().mockResolvedValue(Response.json({ ok: true }))
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
    const handler = jest.fn().mockResolvedValue(Response.json({ ok: true }))
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
    const handler = jest.fn().mockResolvedValue(Response.json({ ok: true }))
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
    const handler = jest.fn()
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
    const handler = jest.fn()
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
    const handler = jest.fn()
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
    const handler = jest.fn().mockResolvedValue(Response.json({ ok: true }))
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
      activityBody: {
        actor: 'https://remote.test/users/alice',
        type: 'Follow'
      }
    })
  })

  it('accepts POST activities whose actor is an object with an id', async () => {
    const handler = jest.fn().mockResolvedValue(Response.json({ ok: true }))
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
    const handler = jest.fn().mockResolvedValue(Response.json({ ok: true }))
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
    const handler = jest.fn().mockResolvedValue(Response.json({ ok: true }))
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
    const handler = jest.fn().mockResolvedValue(Response.json({ ok: true }))
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
    const handler = jest.fn().mockResolvedValue(Response.json({ ok: true }))
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
    const handler = jest.fn().mockResolvedValue(Response.json({ ok: true }))
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
    const handler = jest.fn().mockResolvedValue(Response.json({ ok: true }))
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
})
